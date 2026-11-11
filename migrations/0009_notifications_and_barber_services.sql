-- =====================================================================
-- 0009: envio real de notificações (e-mail e SMS) e barbeiros
--       vinculados automaticamente a todos os serviços.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fila de envio: canal SMS, controle de tentativas e status "enviando"
-- ---------------------------------------------------------------------
alter table public.notification_settings add column if not exists sms_enabled boolean not null default false;

alter table public.notification_logs drop constraint if exists notification_logs_channel_check;
alter table public.notification_logs add constraint notification_logs_channel_check
  check (channel in ('interno','email','whatsapp','sms'));
alter table public.notification_logs drop constraint if exists notification_logs_status_check;
alter table public.notification_logs add constraint notification_logs_status_check
  check (status in ('registrada','lida','aguardando_integracao','enviando','enviada','falhou'));
alter table public.notification_logs
  add column if not exists attempts integer not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error text,
  add column if not exists provider_message_id text;
create index if not exists notification_logs_queue_idx on public.notification_logs (created_at)
  where status in ('aguardando_integracao','enviando');

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
  if ns.sms_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'sms', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
  if ns.whatsapp_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'whatsapp', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
end $$;
revoke execute on function public.notify_user(uuid, text, text, text, uuid) from public, app_user;

-- ---------------------------------------------------------------------
-- Novo evento: plano contratado (aviso ao cliente ao assinar)
-- ---------------------------------------------------------------------
insert into public.notification_settings (event, label) values ('plano_contratado', 'Plano contratado')
on conflict (event) do nothing;

create or replace function app.on_subscription_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl plans;
begin
  select * into pl from plans where id = new.plan_id;
  perform notify_user((select profile_id from customers where id = new.customer_id), 'plano_contratado',
    'Plano contratado', 'Recebemos a contratação do plano ' || pl.name || '. Ele fica ativo assim que o pagamento for confirmado.', new.id);
  return new;
end $$;
revoke execute on function app.on_subscription_created() from public, app_user;
drop trigger if exists trg_subscription_created on public.subscriptions;
create trigger trg_subscription_created after insert on public.subscriptions
  for each row execute function app.on_subscription_created();

-- ---------------------------------------------------------------------
-- Lembrete na véspera (chamado pela rotina diária)
-- ---------------------------------------------------------------------
create or replace function public.queue_appointment_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare a record; n integer := 0; tz text;
begin
  select timezone into tz from business_settings where id = 1;
  tz := coalesce(tz, 'America/Sao_Paulo');
  for a in
    select ap.id, ap.starts_at, c.profile_id
    from appointments ap join customers c on c.id = ap.customer_id
    where ap.status in ('pendente','confirmado')
      and (ap.starts_at at time zone tz)::date = (now() at time zone tz)::date + 1
      and not exists (select 1 from notification_logs l where l.related_id = ap.id and l.event = 'lembrete_atendimento')
  loop
    perform notify_user(a.profile_id, 'lembrete_atendimento', 'Lembrete: seu horário é amanhã',
      'Seu horário é amanhã, ' || to_char(a.starts_at at time zone tz, 'DD/MM "às" HH24:MI') || '.', a.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_appointment_reminders() from public, app_user;

-- Avisos ao cliente: e-mail ligado nos eventos de agendamento, planos e pedidos.
-- SMS ligado só nos eventos de agenda (cada SMS consome créditos do provedor).
update public.notification_settings set email_enabled = true
  where event in ('agendamento_realizado','agendamento_confirmado','lembrete_atendimento','cancelamento','reagendamento',
                  'plano_contratado','plano_vencendo','pagamento_aprovado','pedido_realizado');
update public.notification_settings set sms_enabled = true
  where event in ('agendamento_realizado','lembrete_atendimento','cancelamento','reagendamento');

-- ---------------------------------------------------------------------
-- Todos os barbeiros realizam todos os serviços (regra da casa).
-- O vínculo continua editável no painel; isto só preenche ao cadastrar.
-- ---------------------------------------------------------------------
create or replace function app.link_new_barber_to_services() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into barber_services (barber_id, service_id) select new.id, s.id from services s where s.active
  on conflict do nothing;
  return new;
end $$;
create or replace function app.link_new_service_to_barbers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into barber_services (barber_id, service_id) select b.id, new.id from barbers b where b.active
  on conflict do nothing;
  return new;
end $$;
revoke execute on function app.link_new_barber_to_services() from public, app_user;
revoke execute on function app.link_new_service_to_barbers() from public, app_user;
drop trigger if exists trg_barber_all_services on public.barbers;
create trigger trg_barber_all_services after insert on public.barbers
  for each row execute function app.link_new_barber_to_services();
drop trigger if exists trg_service_all_barbers on public.services;
create trigger trg_service_all_barbers after insert on public.services
  for each row execute function app.link_new_service_to_barbers();

insert into public.barber_services (barber_id, service_id)
select b.id, s.id from public.barbers b cross join public.services s where b.active and s.active
on conflict do nothing;
