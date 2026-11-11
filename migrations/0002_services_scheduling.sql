-- =====================================================================
-- MR.LUDER — 0002 Serviços e agenda
-- Regras: sem conflito por barbeiro (constraint de exclusão no banco),
-- duração + intervalo, horário de funcionamento, escala do barbeiro,
-- folgas/bloqueios, antecedência, cancelamento e reagendamento.
-- =====================================================================

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 80),
  description text,
  photo_url text,
  price numeric(10,2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  extra_buffer_minutes integer not null default 0 check (extra_buffer_minutes between 0 and 120),
  is_combo boolean not null default false,
  bookable_online boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_services_touch before update on public.services
  for each row execute function public.touch_updated_at();

-- Itens que compõem um combo (informativo; preço/duração são do combo)
create table public.service_combo_items (
  combo_id uuid not null references public.services(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  primary key (combo_id, service_id),
  check (combo_id <> service_id)
);

create table public.barber_services (
  barber_id uuid not null references public.barbers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  -- comissão específica por serviço (sobrepõe a do barbeiro)
  commission_type text check (commission_type in ('percentual','fixo')),
  commission_value numeric(10,2) check (commission_value >= 0),
  primary key (barber_id, service_id)
);
create index on public.barber_services (service_id);

-- Escala semanal do barbeiro. Sem linhas para um dia = segue o horário da barbearia.
create table public.barber_schedules (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  check (starts_at < ends_at)
);
create index on public.barber_schedules (barber_id, weekday);

-- Folgas, indisponibilidades e bloqueios (barber_id nulo = barbearia toda)
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid references public.barbers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'bloqueio' check (kind in ('folga','bloqueio','indisponibilidade','feriado')),
  reason text,
  status text not null default 'aprovado' check (status in ('pendente','aprovado','recusado')),
  requested_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index on public.time_off using gist (barber_id, tstzrange(starts_at, ends_at));

create type public.appointment_status as enum (
  'pendente','confirmado','cliente_chegou','em_atendimento','finalizado',
  'cancelado_cliente','cancelado_barbearia','nao_compareceu'
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  customer_id uuid not null references public.customers(id) on delete restrict,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,   -- fim + intervalo entre atendimentos
  status public.appointment_status not null default 'pendente',
  total_price numeric(10,2) not null default 0 check (total_price >= 0),
  total_duration_minutes integer not null check (total_duration_minutes > 0),
  customer_notes text check (length(customer_notes) <= 500),
  professional_notes text,
  source text not null default 'online' check (source in ('online','balcao','telefone','whatsapp')),
  subscription_id uuid,       -- FK no módulo de planos
  created_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  rescheduled_from uuid references public.appointments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at and ends_at <= blocked_until),
  -- Garantia definitiva contra conflitos, inclusive em requisições simultâneas:
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status not in ('cancelado_cliente','cancelado_barbearia','nao_compareceu'))
);
create index on public.appointments (customer_id, starts_at desc);
create index on public.appointments (barber_id, starts_at);
create index on public.appointments (starts_at);
create index on public.appointments (status);
create trigger trg_appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  service_name text not null,
  price numeric(10,2) not null check (price >= 0),
  list_price numeric(10,2) not null check (list_price >= 0),
  duration_minutes integer not null,
  covered_by_subscription boolean not null default false
);
create index on public.appointment_services (appointment_id);

create table public.appointment_status_history (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  from_status public.appointment_status,
  to_status public.appointment_status not null,
  changed_by uuid references public.profiles(id),
  note text,
  changed_at timestamptz not null default now()
);
create index on public.appointment_status_history (appointment_id);

create or replace function public.log_appointment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into appointment_status_history (appointment_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, app.uid());
  elsif new.status is distinct from old.status then
    insert into appointment_status_history (appointment_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, app.uid());
  end if;
  return new;
end $$;
create trigger trg_appointment_status_log after insert or update of status on public.appointments
  for each row execute function public.log_appointment_status();

-- ---------------------------------------------------------------------
-- Motor de disponibilidade
-- ---------------------------------------------------------------------
create or replace function public.active_appointment_statuses() returns public.appointment_status[]
language sql immutable as $$
  select array['pendente','confirmado','cliente_chegou','em_atendimento','finalizado']::public.appointment_status[]
$$;

-- Duração/bloqueio de um conjunto de serviços para um barbeiro
create or replace function public.booking_window(p_barber_id uuid, p_service_ids uuid[],
  out duration_minutes integer, out block_minutes integer, out price numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_count int; v_buffer int;
begin
  select count(*), coalesce(sum(s.duration_minutes),0), coalesce(max(s.extra_buffer_minutes),0), coalesce(sum(s.price),0)
    into v_count, duration_minutes, v_buffer, price
  from services s where s.id = any(p_service_ids) and s.active;
  if v_count = 0 or v_count <> cardinality(array(select distinct unnest(p_service_ids))) then
    raise exception 'Serviço inválido ou inativo';
  end if;
  select greatest(v_buffer, b.buffer_minutes, (select default_buffer_minutes from business_settings where id = 1))
    into v_buffer from barbers b where b.id = p_barber_id;
  block_minutes := duration_minutes + coalesce(v_buffer, 0);
end $$;

-- Verifica se um barbeiro pode atender em [start, start+duração) com bloqueio até start+block
create or replace function public.is_slot_available(p_barber_id uuid, p_service_ids uuid[],
  p_starts_at timestamptz, p_ignore_appointment uuid default null, p_enforce_advance boolean default true)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s business_settings;
  w record;
  v_local timestamp;
  v_day date;
  v_dow int;
  v_start_t time;
  v_end_t timestamp;
  v_block timestamptz;
  v_has_sched boolean;
begin
  select * into s from business_settings where id = 1;
  select * into w from booking_window(p_barber_id, p_service_ids);

  -- barbeiro ativo e habilitado para todos os serviços
  if not exists (select 1 from barbers where id = p_barber_id and active) then return false; end if;
  if (select count(*) from barber_services where barber_id = p_barber_id and service_id = any(p_service_ids))
     <> cardinality(array(select distinct unnest(p_service_ids))) then return false; end if;

  if p_enforce_advance then
    if p_starts_at < now() + make_interval(mins => s.min_advance_minutes) then return false; end if;
    if p_starts_at > now() + make_interval(days => s.booking_window_days) then return false; end if;
  end if;

  v_local := p_starts_at at time zone s.timezone;
  v_day := v_local::date;
  v_dow := extract(dow from v_local)::int;
  v_start_t := v_local::time;
  v_end_t := v_local + make_interval(mins => w.duration_minutes);
  v_block := p_starts_at + make_interval(mins => w.block_minutes);

  -- atendimento deve terminar no mesmo dia
  if v_end_t::date <> v_day and v_end_t::time <> time '00:00' then return false; end if;

  -- horário de funcionamento
  if not exists (
    select 1 from business_hours bh
    where bh.weekday = v_dow and bh.is_open
      and v_start_t >= bh.opens_at
      and v_end_t <= v_day + bh.closes_at
  ) then return false; end if;

  -- escala do barbeiro (se definida para o dia)
  select exists (select 1 from barber_schedules where barber_id = p_barber_id and weekday = v_dow) into v_has_sched;
  if v_has_sched and not exists (
    select 1 from barber_schedules bs
    where bs.barber_id = p_barber_id and bs.weekday = v_dow
      and v_start_t >= bs.starts_at and v_end_t <= v_day + bs.ends_at
  ) then return false; end if;

  -- folgas e bloqueios aprovados (do barbeiro ou da barbearia)
  if exists (
    select 1 from time_off t
    where t.status = 'aprovado'
      and (t.barber_id = p_barber_id or t.barber_id is null)
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, p_starts_at + make_interval(mins => w.duration_minutes), '[)')
  ) then return false; end if;

  -- conflito com outros agendamentos
  if exists (
    select 1 from appointments a
    where a.barber_id = p_barber_id
      and a.status = any(active_appointment_statuses())
      and (p_ignore_appointment is null or a.id <> p_ignore_appointment)
      and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, v_block, '[)')
  ) then return false; end if;

  return true;
end $$;

-- Horários disponíveis em uma data (somente horários livres, sem expor dados de terceiros)
create or replace function public.get_available_slots(p_date date, p_service_ids uuid[], p_barber_id uuid default null)
returns table (barber_id uuid, barber_name text, starts_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  s business_settings;
  bh business_hours;
  b record;
  t timestamp;
  v_dur int;
begin
  select * into s from business_settings where id = 1;
  select * into bh from business_hours where weekday = extract(dow from p_date)::int;
  if bh.weekday is null or not bh.is_open then return; end if;
  if p_service_ids is null or cardinality(p_service_ids) = 0 then return; end if;
  select coalesce(sum(duration_minutes),0) into v_dur from services where id = any(p_service_ids);

  for b in
    select br.id, br.display_name from barbers br
    where br.active and br.accepts_online_booking
      and (p_barber_id is null or br.id = p_barber_id)
      and (select count(*) from barber_services x where x.barber_id = br.id and x.service_id = any(p_service_ids))
          = cardinality(array(select distinct unnest(p_service_ids)))
    order by br.sort_order, br.display_name
  loop
    t := p_date + bh.opens_at;
    while t + make_interval(mins => v_dur) <= p_date + bh.closes_at loop
      if is_slot_available(b.id, p_service_ids, t at time zone s.timezone) then
        barber_id := b.id; barber_name := b.display_name; starts_at := t at time zone s.timezone;
        return next;
      end if;
      t := t + make_interval(mins => s.slot_step_minutes);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Criação de agendamento (cliente ou equipe)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Cancelamento
-- ---------------------------------------------------------------------
create or replace function public.cancel_appointment(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; s business_settings; v_is_owner_customer boolean;
begin
  select * into s from business_settings where id = 1;
  select * into a from appointments where id = p_id for update;
  if a.id is null then raise exception 'Agendamento não encontrado'; end if;
  if a.status not in ('pendente','confirmado') then
    raise exception 'Este agendamento não pode mais ser cancelado (status: %)', a.status;
  end if;
  v_is_owner_customer := a.customer_id = my_customer_id();

  if has_permission('agenda', 'editar') then
    update appointments set status = case when v_is_owner_customer then 'cancelado_cliente' else 'cancelado_barbearia' end,
      cancelled_at = now(), cancel_reason = p_reason where id = p_id;
  elsif v_is_owner_customer then
    if a.starts_at < now() + make_interval(hours => s.cancel_min_hours) then
      raise exception 'Cancelamento online permitido até % hora(s) antes. Fale com a barbearia.', s.cancel_min_hours;
    end if;
    update appointments set status = 'cancelado_cliente', cancelled_at = now(), cancel_reason = p_reason where id = p_id;
  else
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  delete from subscription_usages where appointment_id = p_id;
  perform notify_user((select profile_id from customers where id = a.customer_id), 'cancelamento',
    'Agendamento cancelado', 'O horário de ' || to_char(a.starts_at at time zone s.timezone, 'DD/MM "às" HH24:MI') || ' foi cancelado.', p_id);
end $$;

-- ---------------------------------------------------------------------
-- Reagendamento: cria novo registro e cancela o anterior (histórico preservado)
-- ---------------------------------------------------------------------
create or replace function public.reschedule_appointment(p_id uuid, p_new_starts_at timestamptz, p_barber_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a appointments; s business_settings; v_services uuid[]; v_staff boolean := has_permission('agenda','editar');
        v_barber uuid; w record; v_new uuid; v_cust_profile uuid;
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
