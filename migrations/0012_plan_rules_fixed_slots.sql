-- =====================================================================
-- 0012: regras dos planos (dias da semana e limite semanal), horário fixo
--       do assinante com aprovação do barbeiro e aviso de vencimento
--       para o cliente e para o barbeiro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Regras do plano
-- ---------------------------------------------------------------------
alter table public.plans
  add column if not exists allowed_weekdays smallint[],      -- 0 = domingo … 6 = sábado; nulo = todos os dias
  add column if not exists max_per_week integer;             -- nulo = sem limite semanal
alter table public.plans drop constraint if exists plans_allowed_weekdays_check;
alter table public.plans add constraint plans_allowed_weekdays_check
  check (allowed_weekdays is null or (cardinality(allowed_weekdays) between 1 and 7 and allowed_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]));
alter table public.plans drop constraint if exists plans_max_per_week_check;
alter table public.plans add constraint plans_max_per_week_check check (max_per_week is null or max_per_week between 1 and 14);

create or replace function app.weekday_name(p int) returns text language sql immutable as $$
  select (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[p + 1]
$$;

-- "de segunda a quinta", "todos os dias" ou "segunda, quarta, sexta"
create or replace function app.weekdays_label(p smallint[]) returns text language sql immutable as $$
  select case
    when p is null or cardinality(p) = 0 or (select count(distinct x) from unnest(p) x) = 7 then 'todos os dias'
    when (select max(x) - min(x) + 1 from unnest(p) x) = (select count(distinct x) from unnest(p) x) and cardinality(p) > 2
      then 'de ' || app.weekday_name((select min(x) from unnest(p) x)) || ' a ' || app.weekday_name((select max(x) from unnest(p) x))
    else (select string_agg(app.weekday_name(x), ', ' order by x) from (select distinct x from unnest(p) x) d)
  end
$$;

-- Devolve o motivo (texto para o cliente) se o horário não pode usar o plano; nulo se pode.
create or replace function app.plan_rule_error(p_sub uuid, p_starts_at timestamptz, p_ignore uuid default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare su subscriptions; pl plans; tz text; v_local timestamp; v_dow int; v_n int;
begin
  select * into su from subscriptions where id = p_sub;
  select * into pl from plans where id = su.plan_id;
  select coalesce(timezone, 'America/Sao_Paulo') into tz from business_settings where id = 1;
  v_local := p_starts_at at time zone tz;
  v_dow := extract(dow from v_local)::int;
  if su.current_period_end is not null and p_starts_at >= su.current_period_end then
    return 'Este dia fica depois do vencimento do seu plano (' || to_char(su.current_period_end at time zone tz, 'DD/MM') || '). Renove o plano ou agende sem usá-lo.';
  end if;
  if pl.allowed_weekdays is not null and not (v_dow::smallint = any (pl.allowed_weekdays)) then
    return 'O plano ' || pl.name || ' vale ' || app.weekdays_label(pl.allowed_weekdays) || '. Escolha outro dia ou agende sem usar o plano.';
  end if;
  if pl.max_per_week is not null then
    select count(distinct a.id) into v_n from appointments a
    where a.subscription_id = p_sub and a.id is distinct from p_ignore
      and a.status = any (active_appointment_statuses())
      and date_trunc('week', a.starts_at at time zone tz) = date_trunc('week', v_local)
      and exists (select 1 from appointment_services x where x.appointment_id = a.id and x.covered_by_subscription);
    if v_n >= pl.max_per_week then
      return 'O plano ' || pl.name || ' permite ' || pl.max_per_week || case when pl.max_per_week = 1 then ' atendimento' else ' atendimentos' end
        || ' por semana (de segunda a domingo) e essa semana já está usada. Escolha outra semana ou agende sem usar o plano.';
    end if;
  end if;
  return null;
end $$;
revoke execute on function app.plan_rule_error(uuid, timestamptz, uuid) from public, app_user;

-- agendamentos gerados pelo horário fixo do plano
alter table public.appointments drop constraint if exists appointments_source_check;
alter table public.appointments add constraint appointments_source_check
  check (source in ('online','balcao','telefone','whatsapp','plano'));

create or replace function public.book_appointment(
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_barber_id uuid default null,
  p_customer_notes text default null,
  p_customer_id uuid default null,      -- somente equipe
  p_source text default 'online',
  p_use_subscription boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s business_settings;
  v_customer uuid;
  v_barber uuid;
  w record;
  v_id uuid;
  v_staff boolean := has_permission('agenda', 'criar');
  v_sub uuid;
  v_total numeric := 0;
  svc record;
  v_covered boolean;
  v_rule text;
begin
  if app.uid() is null then raise exception 'Faça login para agendar' using errcode = '42501'; end if;
  select * into s from business_settings where id = 1;

  if p_customer_id is not null and p_customer_id is distinct from my_customer_id() then
    if not v_staff then raise exception 'Acesso negado' using errcode = '42501'; end if;
    v_customer := p_customer_id;
  else
    v_customer := my_customer_id();
  end if;
  if v_customer is null then raise exception 'Cadastro de cliente não encontrado'; end if;
  if exists (select 1 from customers where id = v_customer and status = 'bloqueado') then
    raise exception 'Cliente impedido de agendar. Entre em contato com a barbearia.';
  end if;
  if not v_staff and exists (select 1 from services where id = any(p_service_ids) and not bookable_online) then
    raise exception 'Este serviço não está disponível para agendamento online';
  end if;

  -- escolhe o barbeiro (ou o primeiro disponível)
  if p_barber_id is not null then
    if not is_slot_available(p_barber_id, p_service_ids, p_starts_at, null, not v_staff) then
      raise exception 'Horário indisponível. Escolha outro horário.' using errcode = 'P0001';
    end if;
    v_barber := p_barber_id;
  else
    select br.id into v_barber from barbers br
    where br.active and br.accepts_online_booking
      and is_slot_available(br.id, p_service_ids, p_starts_at, null, not v_staff)
    order by (select count(*) from appointments a where a.barber_id = br.id and a.starts_at::date = p_starts_at::date
              and a.status = any(active_appointment_statuses())), br.sort_order
    limit 1;
    if v_barber is null then
      raise exception 'Nenhum profissional disponível neste horário.' using errcode = 'P0001';
    end if;
  end if;

  select * into w from booking_window(v_barber, p_service_ids);

  if p_use_subscription then
    select id into v_sub from subscriptions
    where customer_id = v_customer and status = 'ativa' and now() < current_period_end
    order by current_period_end desc limit 1;
    if v_sub is null then raise exception 'Nenhuma assinatura ativa encontrada'; end if;
    -- regras do plano: dias permitidos, limite por semana e vigência
    v_rule := app.plan_rule_error(v_sub, p_starts_at, null);
    if v_rule is not null then raise exception '%', v_rule using errcode = 'P0001'; end if;
  end if;

  begin
    insert into appointments (customer_id, barber_id, starts_at, ends_at, blocked_until, status,
                              total_price, total_duration_minutes, customer_notes, source, created_by, subscription_id)
    values (v_customer, v_barber, p_starts_at,
            p_starts_at + make_interval(mins => w.duration_minutes),
            p_starts_at + make_interval(mins => w.block_minutes),
            case when s.auto_confirm_bookings or v_staff then 'confirmado' else 'pendente' end::appointment_status,
            0, w.duration_minutes, nullif(trim(p_customer_notes), ''),
            case when v_staff then coalesce(p_source, 'balcao') else 'online' end,
            app.uid(), v_sub)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Este horário acabou de ser reservado por outra pessoa. Escolha outro horário.' using errcode = 'P0001';
  end;

  for svc in select * from services where id = any(p_service_ids) order by sort_order loop
    v_covered := false;
    if v_sub is not null then
      v_covered := consume_subscription_benefit(v_sub, svc.id, v_id);
    end if;
    insert into appointment_services (appointment_id, service_id, service_name, price, list_price, duration_minutes, covered_by_subscription)
    values (v_id, svc.id, svc.name, case when v_covered then 0 else svc.price end, svc.price, svc.duration_minutes, v_covered);
    v_total := v_total + case when v_covered then 0 else svc.price end;
  end loop;
  if v_sub is not null and not exists (select 1 from appointment_services where appointment_id = v_id and covered_by_subscription) then
    raise exception 'Os serviços escolhidos não estão incluídos no seu plano ou o limite do período foi atingido';
  end if;

  update appointments set total_price = v_total where id = v_id;
  perform notify_user((select profile_id from customers where id = v_customer), 'agendamento_realizado',
    'Agendamento recebido', 'Seu horário em ' || to_char(p_starts_at at time zone s.timezone, 'DD/MM "às" HH24:MI') || ' foi registrado.', v_id);
  return v_id;
end $$;

create or replace function public.reschedule_appointment(p_id uuid, p_new_starts_at timestamptz, p_barber_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a appointments; s business_settings; v_services uuid[]; v_staff boolean := has_permission('agenda','editar');
        v_barber uuid; w record; v_new uuid; v_cust_profile uuid; v_rule text;
begin
  select * into s from business_settings where id = 1;
  select * into a from appointments where id = p_id for update;
  if a.id is null then raise exception 'Agendamento não encontrado'; end if;
  if not v_staff and a.customer_id is distinct from my_customer_id() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if a.status not in ('pendente','confirmado') then raise exception 'Este agendamento não pode ser reagendado'; end if;
  if not v_staff and a.starts_at < now() + make_interval(hours => s.reschedule_min_hours) then
    raise exception 'Reagendamento online permitido até % hora(s) antes.', s.reschedule_min_hours;
  end if;

  select array_agg(service_id) into v_services from appointment_services where appointment_id = p_id;
  -- agendamento coberto pelo plano: o novo dia também precisa respeitar as regras do plano
  if a.subscription_id is not null and exists (select 1 from appointment_services where appointment_id = p_id and covered_by_subscription) then
    v_rule := app.plan_rule_error(a.subscription_id, p_new_starts_at, p_id);
    if v_rule is not null then raise exception '%', v_rule using errcode = 'P0001'; end if;
  end if;
  v_barber := coalesce(p_barber_id, a.barber_id);
  if not is_slot_available(v_barber, v_services, p_new_starts_at, p_id, not v_staff) then
    raise exception 'Novo horário indisponível' using errcode = 'P0001';
  end if;
  select * into w from booking_window(v_barber, v_services);

  update appointments set status = case when v_staff and a.customer_id is distinct from my_customer_id()
      then 'cancelado_barbearia' else 'cancelado_cliente' end::appointment_status,
    cancelled_at = now(), cancel_reason = 'Reagendado' where id = p_id;

  begin
    insert into appointments (customer_id, barber_id, starts_at, ends_at, blocked_until, status, total_price,
      total_duration_minutes, customer_notes, source, created_by, subscription_id, rescheduled_from)
    values (a.customer_id, v_barber, p_new_starts_at, p_new_starts_at + make_interval(mins => w.duration_minutes),
      p_new_starts_at + make_interval(mins => w.block_minutes), a.status, a.total_price, w.duration_minutes,
      a.customer_notes, a.source, app.uid(), a.subscription_id, p_id)
    returning id into v_new;
  exception when exclusion_violation then
    raise exception 'Este horário acabou de ser reservado. Escolha outro.' using errcode = 'P0001';
  end;

  insert into appointment_services (appointment_id, service_id, service_name, price, list_price, duration_minutes, covered_by_subscription)
  select v_new, service_id, service_name, price, list_price, duration_minutes, covered_by_subscription
  from appointment_services where appointment_id = p_id;
  update subscription_usages set appointment_id = v_new where appointment_id = p_id;

  select profile_id into v_cust_profile from customers where id = a.customer_id;
  perform notify_user(v_cust_profile, 'reagendamento', 'Agendamento reagendado',
    'Novo horário: ' || to_char(p_new_starts_at at time zone s.timezone, 'DD/MM "às" HH24:MI') || '.', v_new);
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- Horário fixo do assinante: o cliente pede (ex.: toda quinta às 19:20),
-- o barbeiro aprova e o sistema reserva todas as datas do período pago.
-- A cada renovação do plano, as datas do novo período são reservadas.
-- ---------------------------------------------------------------------
create table if not exists public.subscription_fixed_slots (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  barber_id uuid not null references public.barbers(id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  service_ids uuid[] not null check (cardinality(service_ids) > 0),
  status text not null default 'pendente' check (status in ('pendente','aprovado','recusado','cancelado')),
  customer_note text,
  decision_note text,
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists one_open_fixed_slot_per_sub on public.subscription_fixed_slots (subscription_id)
  where status in ('pendente','aprovado');
create index if not exists fixed_slots_barber_idx on public.subscription_fixed_slots (barber_id, status);
drop trigger if exists trg_fixed_slots_touch on public.subscription_fixed_slots;
create trigger trg_fixed_slots_touch before update on public.subscription_fixed_slots
  for each row execute function public.touch_updated_at();

alter table public.subscription_fixed_slots enable row level security;
drop policy if exists fixed_slots_select on public.subscription_fixed_slots;
create policy fixed_slots_select on public.subscription_fixed_slots for select using (
  barber_id = my_barber_id() or can('agenda','visualizar')
  or exists (select 1 from subscriptions s where s.id = subscription_id and s.customer_id = my_customer_id()));
-- escrita somente pelas funções abaixo

alter table public.appointments add column if not exists fixed_slot_id uuid references public.subscription_fixed_slots(id) on delete set null;
create index if not exists appointments_fixed_slot_idx on public.appointments (fixed_slot_id) where fixed_slot_id is not null;

insert into public.notification_settings (event, label, internal_enabled, email_enabled, sms_enabled) values
  ('horario_fixo_solicitado', 'Horário fixo: pedido recebido (barbeiro)', true, true, false),
  ('horario_fixo_aprovado', 'Horário fixo: aprovado (cliente)', true, true, true),
  ('horario_fixo_recusado', 'Horário fixo: recusado (cliente)', true, true, false),
  ('horario_fixo_cancelado', 'Horário fixo: cancelado', true, true, false),
  ('horario_fixo_renovado', 'Horário fixo: datas do novo mês reservadas (cliente)', true, true, false),
  ('plano_vencendo_equipe', 'Plano de cliente vencendo (barbeiro)', true, true, false)
on conflict (event) do nothing;
update public.notification_settings set email_enabled = true, sms_enabled = true where event = 'plano_vencendo';

-- Avisa a equipe: o barbeiro do horário (se tiver conta) ou, sem conta, os proprietários.
create or replace function app.notify_barber_or_owners(p_barber uuid, p_event text, p_title text, p_body text, p_related uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_profile uuid; r record;
begin
  select profile_id into v_profile from barbers where id = p_barber;
  if v_profile is not null then
    perform notify_user(v_profile, p_event, p_title, p_body, p_related);
  else
    for r in select distinct ur.user_id from user_roles ur join roles ro on ro.id = ur.role_id where ro.key = 'proprietario' loop
      perform notify_user(r.user_id, p_event, p_title, p_body, p_related);
    end loop;
  end if;
end $$;
revoke execute on function app.notify_barber_or_owners(uuid, text, text, text, uuid) from public, app_user;

-- Reserva as datas do período atual do plano para um horário fixo aprovado.
-- Datas já tratadas (inclusive canceladas ou reagendadas) não são recriadas.
create or replace function app.materialize_fixed_slot(p_slot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sl subscription_fixed_slots; su subscriptions; tz text; d date; v_to date; v_ts timestamptz;
        v_created int := 0; v_skipped text[] := '{}'; v_reason text; v_id uuid; w record; svc record;
        v_cov boolean; v_total numeric; v_limit boolean := false;
begin
  select * into sl from subscription_fixed_slots where id = p_slot;
  if sl.id is null or sl.status <> 'aprovado' then return jsonb_build_object('created', 0, 'skipped', '[]'::jsonb); end if;
  select * into su from subscriptions where id = sl.subscription_id;
  if su.status <> 'ativa' or su.current_period_end is null or su.current_period_end <= now() then
    return jsonb_build_object('created', 0, 'skipped', '[]'::jsonb);
  end if;
  select coalesce(timezone, 'America/Sao_Paulo') into tz from business_settings where id = 1;
  d := greatest((now() at time zone tz)::date, (su.current_period_start at time zone tz)::date);
  v_to := ((su.current_period_end at time zone tz) - interval '1 minute')::date;
  while d <= v_to loop
    if extract(dow from d)::int = sl.weekday then
      v_ts := (d + sl.start_time) at time zone tz;
      if v_ts > now() and v_ts < su.current_period_end
         and not exists (select 1 from appointments a where a.fixed_slot_id = sl.id and (a.starts_at at time zone tz)::date = d) then
        v_reason := null;
        if v_limit then
          v_reason := 'limite';
        elsif exists (
          select 1 from plan_benefits b
          where b.plan_id = su.plan_id and b.service_id = any (sl.service_ids) and b.quantity_per_period is not null
            and (select count(*) from subscription_usages u where u.subscription_id = su.id and u.service_id = b.service_id
                 and u.period_start = su.current_period_start) >= b.quantity_per_period) then
          v_limit := true; v_reason := 'limite';
        elsif app.plan_rule_error(su.id, v_ts, null) is not null then
          v_reason := 'regra';
        elsif not is_slot_available(sl.barber_id, sl.service_ids, v_ts, null, false) then
          v_reason := 'ocupado';
        end if;
        if v_reason is null then
          begin
            select * into w from booking_window(sl.barber_id, sl.service_ids);
            insert into appointments (customer_id, barber_id, starts_at, ends_at, blocked_until, status, total_price,
                                      total_duration_minutes, customer_notes, source, created_by, subscription_id, fixed_slot_id)
            values (su.customer_id, sl.barber_id, v_ts, v_ts + make_interval(mins => w.duration_minutes),
                    v_ts + make_interval(mins => w.block_minutes), 'confirmado', 0, w.duration_minutes,
                    'Horário fixo do plano', 'plano', coalesce(sl.decided_by, sl.requested_by), su.id, sl.id)
            returning id into v_id;
            v_total := 0;
            for svc in select * from services where id = any (sl.service_ids) order by sort_order loop
              v_cov := consume_subscription_benefit(su.id, svc.id, v_id);
              insert into appointment_services (appointment_id, service_id, service_name, price, list_price, duration_minutes, covered_by_subscription)
              values (v_id, svc.id, svc.name, case when v_cov then 0 else svc.price end, svc.price, svc.duration_minutes, v_cov);
              v_total := v_total + case when v_cov then 0 else svc.price end;
            end loop;
            update appointments set total_price = v_total where id = v_id;
            v_created := v_created + 1;
          exception when exclusion_violation then
            v_reason := 'ocupado';
          end;
        end if;
        if v_reason is not null then v_skipped := v_skipped || to_char(d, 'DD/MM'); end if;
      end if;
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', to_jsonb(v_skipped));
end $$;
revoke execute on function app.materialize_fixed_slot(uuid) from public, app_user;

-- Cancela as datas futuras de um horário fixo (libera o benefício do plano)
create or replace function app.release_fixed_slot_dates(p_slot uuid, p_by_customer boolean, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with c as (
    update appointments set status = case when p_by_customer then 'cancelado_cliente' else 'cancelado_barbearia' end::appointment_status,
      cancelled_at = now(), cancel_reason = p_reason
    where fixed_slot_id = p_slot and status in ('pendente','confirmado') and starts_at > now()
    returning id)
  , u as (delete from subscription_usages where appointment_id in (select id from c) returning 1)
  select count(*) into n from c;
  return n;
end $$;
revoke execute on function app.release_fixed_slot_dates(uuid, boolean, text) from public, app_user;

create or replace function app.slot_label(p_weekday int, p_time time) returns text language sql immutable as $$
  select case when p_weekday in (0, 6) then 'todo ' else 'toda ' end || app.weekday_name(p_weekday) || ' às ' || to_char(p_time, 'HH24:MI')
$$;

-- Cliente pede o horário fixo
create or replace function public.request_fixed_slot(p_sub uuid, p_barber uuid, p_weekday int, p_time time, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare su subscriptions; pl plans; v_services uuid[]; w record; v_id uuid; v_name text;
begin
  if app.uid() is null then raise exception 'Faça login' using errcode = '42501'; end if;
  select * into su from subscriptions where id = p_sub for update;
  if su.id is null or su.customer_id is distinct from my_customer_id() then raise exception 'Plano não encontrado' using errcode = '42501'; end if;
  if su.status <> 'ativa' then raise exception 'O horário fixo fica disponível quando o plano estiver ativo (pagamento confirmado).'; end if;
  select * into pl from plans where id = su.plan_id;
  if p_weekday is null or p_weekday not between 0 and 6 or p_time is null then raise exception 'Escolha o dia e o horário'; end if;
  if pl.allowed_weekdays is not null and not (p_weekday::smallint = any (pl.allowed_weekdays)) then
    raise exception 'O plano % vale %.', pl.name, app.weekdays_label(pl.allowed_weekdays);
  end if;
  select array_agg(distinct b.service_id) into v_services from plan_benefits b where b.plan_id = pl.id and b.service_id is not null;
  if v_services is null then raise exception 'Este plano não inclui serviços para horário fixo'; end if;
  if not exists (select 1 from barbers where id = p_barber and active) then raise exception 'Profissional indisponível'; end if;
  if (select count(*) from barber_services where barber_id = p_barber and service_id = any (v_services)) <> cardinality(v_services) then
    raise exception 'Este profissional não realiza os serviços do plano';
  end if;
  select * into w from booking_window(p_barber, v_services);
  if not exists (select 1 from business_hours bh where bh.weekday = p_weekday and bh.is_open
                 and p_time >= bh.opens_at and p_time + make_interval(mins => w.duration_minutes) <= bh.closes_at) then
    raise exception 'Fora do horário de funcionamento nesse dia';
  end if;
  begin
    insert into subscription_fixed_slots (subscription_id, barber_id, weekday, start_time, service_ids, customer_note, requested_by)
    values (su.id, p_barber, p_weekday, p_time, v_services, nullif(trim(p_note), ''), app.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Você já tem um horário fixo (ou um pedido em análise) neste plano. Cancele o atual para pedir outro.';
  end;
  select full_name into v_name from customers where id = su.customer_id;
  perform app.notify_barber_or_owners(p_barber, 'horario_fixo_solicitado', 'Pedido de horário fixo',
    v_name || ' (plano ' || pl.name || ') pediu ' || app.slot_label(p_weekday, p_time) || ' com você. Aprove ou recuse no painel do barbeiro.', v_id);
  return v_id;
end $$;

-- Barbeiro (do horário) ou equipe com permissão de agenda decide
create or replace function public.decide_fixed_slot(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sl subscription_fixed_slots; su subscriptions; pl plans; v_res jsonb := '{}'::jsonb; v_profile uuid; v_body text; v_sk text;
begin
  select * into sl from subscription_fixed_slots where id = p_id for update;
  if sl.id is null then raise exception 'Pedido não encontrado'; end if;
  if sl.barber_id is distinct from my_barber_id() and not has_permission('agenda','editar') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if sl.status <> 'pendente' then raise exception 'Este pedido já foi respondido'; end if;
  select * into su from subscriptions where id = sl.subscription_id;
  select * into pl from plans where id = su.plan_id;
  select profile_id into v_profile from customers where id = su.customer_id;
  if p_approve then
    update subscription_fixed_slots set status = 'aprovado', decided_by = app.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
    v_res := app.materialize_fixed_slot(p_id);
    select string_agg(x, ', ') into v_sk from jsonb_array_elements_text(v_res -> 'skipped') x;
    v_body := 'Seu horário fixo foi aprovado: ' || app.slot_label(sl.weekday, sl.start_time) || ' com '
      || (select display_name from barbers where id = sl.barber_id) || '. '
      || case when (v_res ->> 'created')::int > 0 then (v_res ->> 'created') || ' data(s) já reservada(s) até o vencimento do plano. ' else '' end
      || case when v_sk is not null then 'Não deu para reservar: ' || v_sk || ' (horário ocupado ou limite do plano). ' else '' end
      || 'A cada renovação do plano, as datas do novo mês são reservadas automaticamente.';
    perform notify_user(v_profile, 'horario_fixo_aprovado', 'Horário fixo aprovado', v_body, p_id);
  else
    update subscription_fixed_slots set status = 'recusado', decided_by = app.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_id;
    perform notify_user(v_profile, 'horario_fixo_recusado', 'Horário fixo não aprovado',
      'O pedido de ' || app.slot_label(sl.weekday, sl.start_time) || ' não foi aprovado'
      || coalesce(': ' || nullif(trim(p_note), ''), '.') || ' Você pode pedir outro dia ou horário pela sua conta.', p_id);
  end if;
  return v_res;
end $$;

-- Cliente, barbeiro do horário ou equipe cancela; datas futuras são liberadas
create or replace function public.cancel_fixed_slot(p_id uuid, p_reason text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare sl subscription_fixed_slots; su subscriptions; v_by_customer boolean; n int; v_name text; v_profile uuid;
begin
  select * into sl from subscription_fixed_slots where id = p_id for update;
  if sl.id is null then raise exception 'Horário fixo não encontrado'; end if;
  select * into su from subscriptions where id = sl.subscription_id;
  v_by_customer := su.customer_id = my_customer_id();
  if not v_by_customer and sl.barber_id is distinct from my_barber_id() and not has_permission('agenda','editar') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if sl.status not in ('pendente','aprovado') then raise exception 'Este horário fixo já está encerrado'; end if;
  update subscription_fixed_slots set status = 'cancelado', decided_by = coalesce(decided_by, app.uid()), decided_at = coalesce(decided_at, now()),
    decision_note = coalesce(nullif(trim(p_reason), ''), decision_note) where id = p_id;
  n := app.release_fixed_slot_dates(p_id, v_by_customer, 'Horário fixo cancelado');
  select full_name, profile_id into v_name, v_profile from customers where id = su.customer_id;
  if v_by_customer then
    perform app.notify_barber_or_owners(sl.barber_id, 'horario_fixo_cancelado', 'Horário fixo cancelado pelo cliente',
      v_name || ' cancelou o horário fixo de ' || app.slot_label(sl.weekday, sl.start_time) || '. ' || n || ' data(s) futura(s) liberada(s) na sua agenda.', p_id);
  else
    perform notify_user(v_profile, 'horario_fixo_cancelado', 'Horário fixo cancelado',
      'O horário fixo de ' || app.slot_label(sl.weekday, sl.start_time) || ' foi cancelado pela barbearia'
      || coalesce(': ' || nullif(trim(p_reason), ''), '.') || ' Você pode pedir outro horário pela sua conta.', p_id);
  end if;
  return n;
end $$;

-- Lista para o painel: barbeiro vê os seus; equipe com agenda vê todos
create or replace function public.fixed_slots_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sl.id, 'status', sl.status, 'weekday', sl.weekday, 'start_time', to_char(sl.start_time, 'HH24:MI'),
      'label', app.slot_label(sl.weekday, sl.start_time), 'barber_id', sl.barber_id, 'barber_name', b.display_name,
      'customer_name', c.full_name, 'customer_phone', c.phone, 'plan', pl.name, 'customer_note', sl.customer_note,
      'period_end', su.current_period_end, 'created_at', sl.created_at,
      'next_date', (select min(a.starts_at) from appointments a where a.fixed_slot_id = sl.id and a.starts_at > now() and a.status in ('pendente','confirmado')))
    order by (sl.status = 'pendente') desc, sl.weekday, sl.start_time), '[]')
  from subscription_fixed_slots sl
  join subscriptions su on su.id = sl.subscription_id
  join plans pl on pl.id = su.plan_id
  join customers c on c.id = su.customer_id
  join barbers b on b.id = sl.barber_id
  where sl.status in ('pendente','aprovado')
    and (sl.barber_id = my_barber_id() or has_permission('agenda','visualizar'))
$$;

-- Planos de clientes vencendo nos próximos dias (barbeiro: clientes dele; equipe de planos: todos)
create or replace function public.expiring_subscriptions(p_days int default 7) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', su.id, 'customer_name', c.full_name, 'customer_phone', c.phone, 'plan', pl.name, 'period_end', su.current_period_end,
      'auto_renew', su.auto_renew,
      'fixed_slot', (select app.slot_label(sl.weekday, sl.start_time) || ' com ' || b.display_name
                     from subscription_fixed_slots sl join barbers b on b.id = sl.barber_id
                     where sl.subscription_id = su.id and sl.status = 'aprovado' limit 1))
    order by su.current_period_end), '[]')
  from subscriptions su join plans pl on pl.id = su.plan_id join customers c on c.id = su.customer_id
  where su.status = 'ativa' and su.current_period_end > now()
    and su.current_period_end <= now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 31))
    and (has_permission('planos','visualizar')
         or exists (select 1 from subscription_fixed_slots sl where sl.subscription_id = su.id and sl.status = 'aprovado' and sl.barber_id = my_barber_id())
         or exists (select 1 from appointments a where a.subscription_id = su.id and a.barber_id = my_barber_id()
                    and a.starts_at >= su.current_period_start))
$$;

-- Ao ativar ou renovar o plano: reserva as datas do novo período.
-- Ao cancelar/expirar: encerra o horário fixo e libera as datas futuras.
create or replace function app.on_subscription_period_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare sl record; r jsonb; v_profile uuid; v_total int := 0; v_sk text[] := '{}';
begin
  if new.status = 'ativa' and (old.status is distinct from 'ativa' or new.current_period_start is distinct from old.current_period_start) then
    for sl in select * from subscription_fixed_slots where subscription_id = new.id and status = 'aprovado' loop
      r := app.materialize_fixed_slot(sl.id);
      v_total := v_total + (r ->> 'created')::int;
      v_sk := v_sk || array(select jsonb_array_elements_text(r -> 'skipped'));
      if (r ->> 'created')::int > 0 then
        select profile_id into v_profile from customers where id = new.customer_id;
        perform notify_user(v_profile, 'horario_fixo_renovado', 'Seus horários do novo período estão reservados',
          'Reservamos ' || (r ->> 'created') || ' data(s) do seu horário fixo (' || app.slot_label(sl.weekday, sl.start_time) || ').'
          || case when cardinality(v_sk) > 0 then ' Não deu para reservar: ' || array_to_string(v_sk, ', ') || '.' else '' end, sl.id);
      end if;
    end loop;
  elsif new.status in ('cancelada','expirada') and old.status not in ('cancelada','expirada') then
    for sl in select * from subscription_fixed_slots where subscription_id = new.id and status in ('pendente','aprovado') loop
      update subscription_fixed_slots set status = 'cancelado', decision_note = 'Plano ' || new.status where id = sl.id;
      perform app.release_fixed_slot_dates(sl.id, false, 'Plano ' || new.status);
    end loop;
  end if;
  return new;
end $$;
revoke execute on function app.on_subscription_period_change() from public, app_user;
drop trigger if exists trg_subscription_period_change on public.subscriptions;
create trigger trg_subscription_period_change after update of status, current_period_start on public.subscriptions
  for each row execute function app.on_subscription_period_change();

-- ---------------------------------------------------------------------
-- Aviso de vencimento: cliente e barbeiro, 3 dias antes, uma vez por período
-- ---------------------------------------------------------------------
create or replace function public.queue_subscription_expiry_notices() returns integer
language plpgsql security definer set search_path = public as $$
declare su record; n int := 0; tz text; v_date text; v_body text; b record; v_any boolean;
begin
  select coalesce(timezone, 'America/Sao_Paulo') into tz from business_settings where id = 1;
  for su in
    select s.id, s.current_period_start, s.current_period_end, s.auto_renew, s.gateway, s.customer_id, c.profile_id, c.full_name, pl.name as plan_name
    from subscriptions s join customers c on c.id = s.customer_id join plans pl on pl.id = s.plan_id
    where s.status = 'ativa' and s.current_period_end > now() and s.current_period_end <= now() + interval '3 days'
      and not exists (select 1 from notification_logs l where l.related_id = s.id and l.event in ('plano_vencendo','plano_vencendo_equipe')
                      and l.created_at >= s.current_period_end - interval '5 days')
  loop
    v_date := to_char(su.current_period_end at time zone tz, 'DD/MM');
    v_body := case when su.auto_renew and su.gateway = 'asaas'
      then 'Seu plano ' || su.plan_name || ' renova em ' || v_date || '. A nova fatura chega por e-mail: pague em dia para manter os benefícios e o seu horário fixo.'
      when su.auto_renew
      then 'Seu plano ' || su.plan_name || ' vence em ' || v_date || '. Renove na barbearia ou pela sua conta para manter os benefícios e o seu horário fixo.'
      else 'Seu plano ' || su.plan_name || ' termina em ' || v_date || ' e não será renovado. Para continuar, contrate novamente pela sua conta.' end;
    perform notify_user(su.profile_id, 'plano_vencendo', 'Seu plano vence em ' || v_date, v_body, su.id);
    v_any := false;
    for b in
      select distinct br.id from barbers br
      where br.id in (select sl.barber_id from subscription_fixed_slots sl where sl.subscription_id = su.id and sl.status = 'aprovado')
         or br.id in (select a.barber_id from appointments a where a.subscription_id = su.id and a.starts_at >= su.current_period_start
                      and a.status = any (active_appointment_statuses()))
    loop
      v_any := true;
      perform app.notify_barber_or_owners(b.id, 'plano_vencendo_equipe', 'Plano de cliente vencendo',
        'O plano ' || su.plan_name || ' de ' || su.full_name || ' vence em ' || v_date || '.'
        || case when su.auto_renew then '' else ' O cliente cancelou a renovação.' end, su.id);
    end loop;
    if not v_any then
      perform app.notify_barber_or_owners(null, 'plano_vencendo_equipe', 'Plano de cliente vencendo',
        'O plano ' || su.plan_name || ' de ' || su.full_name || ' vence em ' || v_date || '.', su.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_subscription_expiry_notices() from public, app_user;

-- A rotina de renovação deixa de gravar o aviso direto (agora é a função acima, que também avisa o barbeiro e manda e-mail)
create or replace function public.process_subscription_renewals() returns integer
language plpgsql security definer set search_path = public as $$
declare su record; n int := 0;
begin
  for su in select s.*, p.price, p.name from subscriptions s join plans p on p.id = s.plan_id
            where s.status = 'ativa' and s.current_period_end <= now() loop
    if su.auto_renew then
      update subscriptions set status = 'inadimplente' where id = su.id;
      if not exists (select 1 from transactions where subscription_id = su.id and status = 'pendente') then
        insert into transactions (kind, category, description, amount, subscription_id, due_date)
        values ('receita', 'plano', 'Renovação ' || su.name, su.price, su.id, current_date);
      end if;
    else
      update subscriptions set status = 'expirada' where id = su.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.process_subscription_renewals() from public, app_user;

-- Conta do cliente: regras do plano e horário fixo junto de cada assinatura
create or replace function public.my_subscriptions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'plan', pl.name, 'plan_id', pl.id, 'status', s.status, 'auto_renew', s.auto_renew,
    'period_start', s.current_period_start, 'period_end', s.current_period_end, 'price', pl.price,
    'allowed_weekdays', pl.allowed_weekdays, 'weekdays_label', app.weekdays_label(pl.allowed_weekdays), 'max_per_week', pl.max_per_week,
    'benefits', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'service_id', b.service_id, 'quantity', b.quantity_per_period,
        'used', (select count(*) from subscription_usages u where u.subscription_id = s.id and u.service_id = b.service_id and u.period_start = s.current_period_start))), '[]')
      from plan_benefits b where b.plan_id = pl.id),
    'fixed_slot', (select jsonb_build_object('id', sl.id, 'status', sl.status, 'weekday', sl.weekday, 'start_time', to_char(sl.start_time, 'HH24:MI'),
        'label', app.slot_label(sl.weekday, sl.start_time), 'barber_id', sl.barber_id, 'barber_name', br.display_name,
        'decision_note', sl.decision_note,
        'next_dates', (select coalesce(jsonb_agg(a.starts_at order by a.starts_at), '[]') from appointments a
                       where a.fixed_slot_id = sl.id and a.starts_at > now() and a.status in ('pendente','confirmado')))
      from subscription_fixed_slots sl join barbers br on br.id = sl.barber_id
      where sl.subscription_id = s.id order by (sl.status in ('pendente','aprovado')) desc, sl.created_at desc limit 1)
    ) order by s.created_at desc), '[]')
  from subscriptions s join plans pl on pl.id = s.plan_id where s.customer_id = my_customer_id()
$$;
