-- =====================================================================
-- MR.LUDER — 0004 LGPD, auditoria, avaliações e relatórios
-- =====================================================================

-- ---------------------------------------------------------------------
-- Documentos legais versionados e consentimentos
-- ---------------------------------------------------------------------
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('termos','privacidade')),
  version text not null,
  title text not null,
  content text not null,
  published_at timestamptz not null default now(),
  is_current boolean not null default false,
  unique (kind, version)
);
create unique index legal_documents_one_current on public.legal_documents (kind) where is_current;

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('termos','privacidade','marketing_email','marketing_whatsapp')),
  granted boolean not null,
  document_version text,
  source text not null default 'site',
  user_agent text,
  created_at timestamptz not null default now()
);
create index on public.consent_records (user_id, purpose, created_at desc);

create or replace function app.record_signup_consents(p_profile uuid, m jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into consent_records (user_id, purpose, granted, document_version, user_agent)
  select p_profile, x.purpose, x.granted, x.version, left(m ->> 'user_agent', 300) from (values
    ('termos', coalesce((m ->> 'accepted_terms')::boolean, false), (select version from legal_documents where kind = 'termos' and is_current)),
    ('privacidade', coalesce((m ->> 'accepted_terms')::boolean, false), (select version from legal_documents where kind = 'privacidade' and is_current)),
    ('marketing_email', coalesce((m ->> 'marketing_email')::boolean, false), null),
    ('marketing_whatsapp', coalesce((m ->> 'marketing_whatsapp')::boolean, false), null)
  ) as x(purpose, granted, version);
end $$;

create or replace function public.update_marketing_consent(p_email boolean, p_whatsapp boolean, p_user_agent text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app.uid() is null then raise exception 'Faça login' using errcode = '42501'; end if;
  update profiles set communication_email = p_email, communication_whatsapp = p_whatsapp where id = app.uid();
  insert into consent_records (user_id, purpose, granted, user_agent, source) values
    (app.uid(), 'marketing_email', p_email, left(p_user_agent, 300), 'area_do_cliente'),
    (app.uid(), 'marketing_whatsapp', p_whatsapp, left(p_user_agent, 300), 'area_do_cliente');
end $$;

-- ---------------------------------------------------------------------
-- Solicitações de titulares
-- ---------------------------------------------------------------------
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique default 'LGPD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  user_id uuid references public.profiles(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  kind text not null check (kind in ('copia','correcao','informacoes','portabilidade','exclusao','revogacao')),
  details text check (length(details) <= 2000),
  status text not null default 'aberta' check (status in ('aberta','em_analise','concluida','recusada')),
  response text,
  handled_by uuid references public.profiles(id),
  due_at timestamptz not null default now() + interval '15 days',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.create_privacy_request(p_kind text, p_details text, p_name text default null, p_email text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_prot text; p profiles;
begin
  select * into p from profiles where id = app.uid();
  if p.id is null and (coalesce(trim(p_name), '') = '' or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Informe nome e e-mail válidos';
  end if;
  insert into privacy_requests (user_id, requester_name, requester_email, kind, details)
  values (p.id, coalesce(p.full_name, trim(p_name)), coalesce(p.email, lower(trim(p_email))), p_kind, p_details)
  returning protocol into v_prot;
  return v_prot;
end $$;
grant execute on function public.create_privacy_request(text, text, text, text) to app_user;

-- Cópia/portabilidade dos dados do próprio titular (JSON estruturado)
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c uuid := my_customer_id();
begin
  if app.uid() is null then raise exception 'Faça login' using errcode = '42501'; end if;
  return jsonb_build_object(
    'gerado_em', now(),
    'perfil', (select to_jsonb(p) - 'anonymized_at' from profiles p where id = app.uid()),
    'agendamentos', coalesce((select jsonb_agg(jsonb_build_object('codigo', a.code, 'inicio', a.starts_at, 'status', a.status,
        'profissional', b.display_name, 'valor', a.total_price,
        'servicos', (select jsonb_agg(service_name) from appointment_services where appointment_id = a.id)) order by a.starts_at)
      from appointments a join barbers b on b.id = a.barber_id where a.customer_id = v_c), '[]'),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('codigo', o.code, 'data', o.created_at, 'status', o.status, 'total', o.total,
        'itens', (select jsonb_agg(jsonb_build_object('produto', product_name, 'qtd', quantity, 'preco', unit_price)) from order_items where order_id = o.id)))
      from orders o where o.customer_id = v_c), '[]'),
    'assinaturas', coalesce((select jsonb_agg(jsonb_build_object('plano', pl.name, 'status', s.status, 'inicio', s.current_period_start, 'fim', s.current_period_end))
      from subscriptions s join plans pl on pl.id = s.plan_id where s.customer_id = v_c), '[]'),
    'consentimentos', coalesce((select jsonb_agg(jsonb_build_object('finalidade', purpose, 'concedido', granted, 'versao', document_version, 'data', created_at) order by created_at)
      from consent_records where user_id = app.uid()), '[]'),
    'solicitacoes_privacidade', coalesce((select jsonb_agg(jsonb_build_object('protocolo', protocol, 'tipo', kind, 'status', status, 'data', created_at))
      from privacy_requests where user_id = app.uid()), '[]')
  );
end $$;

-- Anonimização: preserva registros financeiros/fiscais (obrigação legal), remove identificação.
create or replace function public.anonymize_customer(p_customer uuid, p_request uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  perform require_permission('lgpd', 'aprovar');
  select * into c from customers where id = p_customer for update;
  if c.id is null then raise exception 'Cliente não encontrado'; end if;
  if exists (select 1 from appointments where customer_id = c.id and status in ('pendente','confirmado','cliente_chegou','em_atendimento') and starts_at > now() - interval '1 day') then
    raise exception 'Cliente possui agendamentos em aberto. Cancele-os antes de anonimizar.';
  end if;
  update customers set full_name = 'Titular anonimizado', email = null, phone = null, notes = null,
    status = 'inativo', anonymized_at = now() where id = c.id;
  update appointments set customer_notes = null, professional_notes = null where customer_id = c.id;
  update orders set delivery_address = null, notes = null where customer_id = c.id;
  if c.profile_id is not null then
    update profiles set full_name = 'Titular anonimizado', phone = null, birth_date = null,
      email = 'anonimizado+' || substr(id::text, 1, 8) || '@invalid', communication_email = false,
      communication_whatsapp = false, anonymized_at = now() where id = c.profile_id;
    delete from notification_logs where user_id = c.profile_id;
  end if;
  if p_request is not null then
    update privacy_requests set status = 'concluida', resolved_at = now(), handled_by = app.uid(),
      response = coalesce(response, 'Dados anonimizados. Registros fiscais mantidos de forma não identificável.')
    where id = p_request;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (table_name, created_at desc);
create index on public.audit_logs (actor_id, created_at desc);

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb;
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values (app.uid(), lower(tg_op), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id'), v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['business_settings','business_hours','services','barbers','barber_services','employees','user_roles',
    'role_permissions','roles','products','plans','plan_benefits','subscriptions','transactions','payment_transactions','commissions',
    'payouts','coupons','customers','time_off','privacy_requests','payment_settings','legal_documents','affiliates','rewards']
  loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Depoimentos (enviados por clientes reais; publicados após moderação)
-- ---------------------------------------------------------------------
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  content text not null check (length(content) between 10 and 600),
  status text not null default 'pendente' check (status in ('pendente','aprovado','oculto')),
  created_at timestamptz not null default now()
);

create or replace function public.submit_testimonial(p_rating int, p_content text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  select * into c from customers where id = my_customer_id();
  if c.id is null then raise exception 'Faça login' using errcode = '42501'; end if;
  if not exists (select 1 from appointments where customer_id = c.id and status = 'finalizado') then
    raise exception 'Depoimentos são liberados após o primeiro atendimento finalizado';
  end if;
  insert into testimonials (customer_id, author_name, rating, content)
  values (c.id, split_part(c.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(c.full_name, ' ', 2), ''), 1) || '.', ''), p_rating, trim(p_content));
end $$;

-- ---------------------------------------------------------------------
-- Indicadores (calculados a partir dos dados reais)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_metrics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Sao_Paulo'; v_today date := (now() at time zone tz)::date; v_avail numeric; v_booked numeric;
begin
  perform require_permission('relatorios', 'visualizar');

  -- minutos disponíveis = horas abertas por dia × barbeiros ativos
  select coalesce(sum(extract(epoch from (bh.closes_at - bh.opens_at)) / 60), 0) * greatest((select count(*) from barbers where active), 0)
    into v_avail
  from generate_series(p_from, p_to, interval '1 day') d
  join business_hours bh on bh.weekday = extract(dow from d)::int and bh.is_open;
  select coalesce(sum(total_duration_minutes), 0) into v_booked from appointments
  where (starts_at at time zone tz)::date between p_from and p_to and status = any(active_appointment_statuses());

  return jsonb_build_object(
    'faturamento_dia', (select coalesce(sum(amount),0) from transactions where kind='receita' and status<>'cancelado' and competence_date = v_today),
    'faturamento_mes', (select coalesce(sum(amount),0) from transactions where kind='receita' and status<>'cancelado' and date_trunc('month', competence_date) = date_trunc('month', v_today)),
    'faturamento_periodo', (select coalesce(sum(amount),0) from transactions where kind='receita' and status<>'cancelado' and competence_date between p_from and p_to),
    'recebido_periodo', (select coalesce(sum(amount),0) from transactions where kind='receita' and status='recebido' and competence_date between p_from and p_to),
    'a_receber', (select coalesce(sum(amount),0) from transactions where kind='receita' and status='pendente'),
    'agendamentos', (select count(*) from appointments where (starts_at at time zone tz)::date between p_from and p_to),
    'pendentes', (select count(*) from appointments where status = 'pendente' and starts_at >= now()),
    'finalizados', (select count(*) from appointments where status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
    'cancelamentos', (select count(*) from appointments where status in ('cancelado_cliente','cancelado_barbearia') and cancel_reason is distinct from 'Reagendado' and (starts_at at time zone tz)::date between p_from and p_to),
    'nao_comparecimentos', (select count(*) from appointments where status = 'nao_compareceu' and (starts_at at time zone tz)::date between p_from and p_to),
    'ticket_medio', (select coalesce(round(avg(total_price), 2), 0) from appointments where status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
    'ocupacao', case when v_avail > 0 then round(v_booked / v_avail * 100, 1) else null end,
    'clientes_novos', (select count(*) from customers where (created_at at time zone tz)::date between p_from and p_to),
    'clientes_recorrentes', (select count(distinct a.customer_id) from appointments a where a.status = 'finalizado'
        and (a.starts_at at time zone tz)::date between p_from and p_to
        and exists (select 1 from appointments x where x.customer_id = a.customer_id and x.status = 'finalizado' and x.starts_at < a.starts_at)),
    'planos_ativos', (select count(*) from subscriptions where status = 'ativa'),
    'mrr', (select coalesce(round(sum(p.price / p.period_months), 2), 0) from subscriptions s join plans p on p.id = s.plan_id where s.status = 'ativa'),
    'vendas_produtos', (select coalesce(sum(total),0) from orders where paid_at is not null and status <> 'cancelado' and (paid_at at time zone tz)::date between p_from and p_to),
    'pedidos_pagos', (select count(*) from orders where paid_at is not null and status <> 'cancelado' and (paid_at at time zone tz)::date between p_from and p_to),
    'estoque_baixo', (select count(*) from products where active and track_stock and stock <= min_stock),
    'serie_diaria', (select coalesce(jsonb_agg(jsonb_build_object('dia', d::date,
        'faturado', (select coalesce(sum(amount),0) from transactions where kind='receita' and status<>'cancelado' and competence_date = d::date),
        'recebido', (select coalesce(sum(amount),0) from transactions where kind='receita' and status='recebido' and competence_date = d::date),
        'atendimentos', (select count(*) from appointments where status='finalizado' and (starts_at at time zone tz)::date = d::date)) order by d), '[]')
      from generate_series(p_from, p_to, interval '1 day') d),
    'profissionais', (select coalesce(jsonb_agg(x order by x.receita desc), '[]') from (
        select b.id, b.display_name nome,
          count(a.id) filter (where a.status = 'finalizado') atendimentos,
          coalesce(sum(a.total_price) filter (where a.status = 'finalizado'), 0) receita,
          (select coalesce(sum(amount),0) from commissions c where c.barber_id = b.id and c.status <> 'cancelado' and (c.created_at at time zone tz)::date between p_from and p_to) comissoes,
          count(a.id) filter (where a.status = 'nao_compareceu') faltas
        from barbers b left join appointments a on a.barber_id = b.id and (a.starts_at at time zone tz)::date between p_from and p_to
        where b.active group by b.id) x)
  );
end $$;

create or replace function public.my_barber_metrics(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := my_barber_id(); tz text := 'America/Sao_Paulo';
begin
  if v_b is null then raise exception 'Acesso restrito a profissionais' using errcode = '42501'; end if;
  return jsonb_build_object(
    'atendimentos', (select count(*) from appointments where barber_id = v_b and status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
    'faltas', (select count(*) from appointments where barber_id = v_b and status = 'nao_compareceu' and (starts_at at time zone tz)::date between p_from and p_to),
    'receita_gerada', (select coalesce(sum(total_price),0) from appointments where barber_id = v_b and status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
    'comissao_periodo', (select coalesce(sum(amount),0) from commissions where barber_id = v_b and status <> 'cancelado' and (created_at at time zone tz)::date between p_from and p_to),
    'comissao_pendente', (select coalesce(sum(amount),0) from commissions where barber_id = v_b and status = 'pendente'),
    'comissao_paga', (select coalesce(sum(amount),0) from commissions where barber_id = v_b and status = 'pago' and (created_at at time zone tz)::date between p_from and p_to)
  );
end $$;

-- Solicitação de folga/indisponibilidade pelo barbeiro
create or replace function public.request_time_off(p_starts timestamptz, p_ends timestamptz, p_kind text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid := my_barber_id(); v_id uuid;
begin
  if v_b is null then raise exception 'Acesso restrito a profissionais' using errcode = '42501'; end if;
  if p_kind not in ('folga','indisponibilidade') then raise exception 'Tipo inválido'; end if;
  insert into time_off (barber_id, starts_at, ends_at, kind, reason, status, requested_by)
  values (v_b, p_starts, p_ends, p_kind, p_reason,
          -- indisponibilidade pontual bloqueia a agenda imediatamente; folga depende de aprovação
          case when p_kind = 'indisponibilidade' then 'aprovado' else 'pendente' end, app.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_time_off(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('equipe', 'aprovar');
  update time_off set status = case when p_approve then 'aprovado' else 'recusado' end, reviewed_by = app.uid()
  where id = p_id and status = 'pendente';
  if not found then raise exception 'Solicitação não encontrada ou já analisada'; end if;
end $$;

-- Lista de usuários com perfis (gestão de acessos)
create or replace function public.admin_list_users(p_search text default null) returns table (
  id uuid, full_name text, email text, phone text, roles text[], created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_permission('usuarios', 'visualizar');
  return query
  select p.id, p.full_name, p.email, p.phone,
    coalesce(array_agg(r.key order by r.key) filter (where r.key is not null), '{}'), p.created_at
  from profiles p left join user_roles ur on ur.user_id = p.id left join roles r on r.id = ur.role_id
  where p_search is null or p.full_name ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%'
  group by p.id order by p.created_at desc limit 200;
end $$;
