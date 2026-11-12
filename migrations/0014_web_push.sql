-- 0014 · Notificações do próprio app (Web Push) no lugar do SMS
-- Grátis e sem intermediário: o servidor envia direto ao serviço de push do aparelho (Google/Apple/Mozilla),
-- assinado com a chave VAPID da barbearia. Funciona no Android (Chrome) e no iPhone com o app na tela de início.

-- Chave VAPID: gerada pelo servidor no primeiro uso. Fica no schema "app" (fora do navegador e fora do backup
-- das tabelas públicas). Se um dia se perder, uma nova é gerada e os aparelhos se inscrevem de novo sozinhos.
create table if not exists app.push_keys (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
revoke all on app.push_keys from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then execute 'revoke all on app.push_keys from app_user'; end if;
end $$;

-- Aparelhos inscritos (um usuário pode ter celular e computador)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select using (user_id = app.uid());
grant select on public.push_subscriptions to app_user;

-- Inscrição e cancelamento só pelas funções (o navegador nunca grava direto na tabela)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if app.uid() is null then raise exception 'Faça login' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Inscrição inválida';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (app.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to app_user;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = app.uid();
$$;
revoke execute on function public.remove_push_subscription(text) from public;
grant execute on function public.remove_push_subscription(text) to app_user;

-- Canal "push" na fila de envio e na configuração de cada evento
alter table public.notification_logs drop constraint if exists notification_logs_channel_check;
alter table public.notification_logs add constraint notification_logs_channel_check
  check (channel in ('interno','email','whatsapp','sms','push'));
alter table public.notification_settings add column if not exists push_enabled boolean not null default true;

create or replace function public.notify_user(p_user uuid, p_event text, p_title text, p_body text, p_related uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare ns notification_settings;
begin
  if p_user is null then return; end if;
  select * into ns from notification_settings where event = p_event;
  if ns.event is null or ns.internal_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id) values (p_user, p_event, 'interno', p_title, p_body, p_related);
  end if;
  if ns.email_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'email', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
  -- push só entra na fila se a pessoa tem algum aparelho inscrito
  if coalesce(ns.push_enabled, true) and exists (select 1 from push_subscriptions where user_id = p_user) then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'push', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
  if ns.sms_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'sms', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
  if ns.whatsapp_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'whatsapp', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
end $$;
revoke execute on function public.notify_user(uuid, text, text, text, uuid) from public, app_user;

-- SMS desligado (sem créditos no Brevo); avisos de SMS parados na fila são encerrados
update public.notification_settings set sms_enabled = false;
update public.notification_logs set status = 'falhou', last_error = 'SMS desativado: substituído pela notificação do app'
  where channel = 'sms' and status in ('aguardando_integracao', 'enviando');

-- ---------------------------------------------------------------------
-- Barbeiro avisado de novo agendamento e de cancelamento feito pelo cliente
-- (só avisa quando quem mexeu não foi o próprio barbeiro; datas do horário fixo não geram aviso a cada semana)
-- ---------------------------------------------------------------------
insert into public.notification_settings (event, label, internal_enabled, email_enabled, push_enabled) values
  ('novo_agendamento_equipe', 'Novo agendamento (barbeiro)', true, false, true),
  ('cancelamento_equipe', 'Cancelamento pelo cliente (barbeiro)', true, false, true)
on conflict (event) do nothing;

create or replace function app.notify_barber_on_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_barber_profile uuid; v_customer text; v_tz text; v_when text;
begin
  select profile_id into v_barber_profile from barbers where id = new.barber_id;
  if v_barber_profile is null then return new; end if;
  select coalesce(timezone, 'America/Sao_Paulo') into v_tz from business_settings where id = 1;
  select full_name into v_customer from customers where id = new.customer_id;
  v_when := to_char(new.starts_at at time zone coalesce(v_tz, 'America/Sao_Paulo'), 'DD/MM "às" HH24:MI');
  if tg_op = 'INSERT' then
    if new.fixed_slot_id is not null or new.created_by is not distinct from v_barber_profile then return new; end if;
    if new.status::text like 'cancelado%' then return new; end if;
    perform notify_user(v_barber_profile, 'novo_agendamento_equipe',
      case when new.rescheduled_from is not null then 'Horário remarcado' else 'Novo agendamento' end,
      coalesce(v_customer, 'Cliente') || ' · ' || v_when, new.id);
  elsif new.status::text = 'cancelado_cliente' and old.status is distinct from new.status then
    perform notify_user(v_barber_profile, 'cancelamento_equipe', 'Cliente cancelou',
      coalesce(v_customer, 'Cliente') || ' cancelou o horário de ' || v_when || '.', new.id);
  end if;
  return new;
end $$;
revoke execute on function app.notify_barber_on_appointment() from public;

drop trigger if exists trg_appointments_notify_barber_ins on public.appointments;
create trigger trg_appointments_notify_barber_ins after insert on public.appointments
  for each row execute function app.notify_barber_on_appointment();
drop trigger if exists trg_appointments_notify_barber_upd on public.appointments;
create trigger trg_appointments_notify_barber_upd after update of status on public.appointments
  for each row execute function app.notify_barber_on_appointment();
