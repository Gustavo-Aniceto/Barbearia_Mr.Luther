-- =====================================================================
-- MR.LUDER — 0001 Fundação: extensões, utilitários, perfis, papéis,
-- permissões e configurações do estabelecimento.
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Perfis. auth_user_id = id do usuário no Neon Auth (schema neon_auth,
-- gerenciado pelo Neon). Sem FK para o schema do provedor: o vínculo é
-- resolvido no servidor a partir da sessão validada.
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id text not null unique,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  email text not null,
  phone text check (phone is null or phone ~ '^[0-9()+\- ]{8,20}$'),
  birth_date date check (birth_date is null or birth_date > date '1900-01-01'),
  communication_email boolean not null default false,
  communication_whatsapp boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Papéis e permissões
-- ---------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  -- papéis privilegiados só podem ser atribuídos pelo proprietário
  is_privileged boolean not null default false,
  is_staff boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null check (action in ('visualizar','criar','editar','excluir','aprovar','gerenciar','exportar')),
  description text,
  unique (module, action)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index on public.user_roles (role_id);

-- ---------------------------------------------------------------------
-- Funções de autorização (usadas por RLS e por todas as RPCs)
-- SECURITY DEFINER para não depender das políticas das próprias tabelas.
-- ---------------------------------------------------------------------
create or replace function public.has_role(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = app.uid() and r.key = p_key
  )
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('proprietario')
$$;

create or replace function public.has_permission(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.uid() is not null and (
    public.is_owner() or exists (
      select 1
      from user_roles ur
      join role_permissions rp on rp.role_id = ur.role_id
      join permissions p on p.id = rp.permission_id
      where ur.user_id = app.uid()
        and p.module = p_module
        and (p.action = p_action or p.action = 'gerenciar')
    )
  )
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = app.uid() and r.is_staff
  )
$$;

create or replace function public.require_permission(p_module text, p_action text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_module, p_action) then
    raise exception 'Acesso negado: permissão %.% necessária', p_module, p_action
      using errcode = '42501';
  end if;
end $$;

-- Lista de permissões do usuário atual (consumida pela interface)
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', app.uid(),
    'is_owner', public.is_owner(),
    'is_staff', public.is_staff(),
    'roles', coalesce((select jsonb_agg(r.key order by r.key) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = app.uid()), '[]'),
    'permissions', case when public.is_owner()
      then (select jsonb_agg(module || '.' || action) from permissions)
      else coalesce((
        select jsonb_agg(distinct p.module || '.' || p.action)
        from user_roles ur
        join role_permissions rp on rp.role_id = ur.role_id
        join permissions p on p.id = rp.permission_id
        where ur.user_id = app.uid()), '[]')
      end
  )
$$;

-- ---------------------------------------------------------------------
-- Configurações do estabelecimento (linha única)
-- ---------------------------------------------------------------------
create table public.business_settings (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'MR.LUDER BARBEARIA',
  address text,
  maps_url text,
  phone text,
  whatsapp text,
  instagram_url text,          -- configurável; não inventado
  privacy_email text,          -- canal de privacidade (LGPD)
  timezone text not null default 'America/Sao_Paulo',
  -- reputação informada (não simulada)
  rating_value numeric(2,1) check (rating_value between 0 and 5),
  rating_count integer check (rating_count >= 0),
  rating_source text,
  rating_updated_at date,
  -- conteúdo editorial
  hero_title text,
  hero_subtitle text,
  hero_image_url text,
  about_title text,
  about_text text,
  about_highlights jsonb not null default '[]'::jsonb,
  -- políticas de agenda
  slot_step_minutes integer not null default 15 check (slot_step_minutes between 5 and 60),
  min_advance_minutes integer not null default 60 check (min_advance_minutes >= 0),
  booking_window_days integer not null default 30 check (booking_window_days between 1 and 365),
  default_buffer_minutes integer not null default 0 check (default_buffer_minutes between 0 and 120),
  cancel_min_hours integer not null default 2 check (cancel_min_hours >= 0),
  reschedule_min_hours integer not null default 2 check (reschedule_min_hours >= 0),
  late_tolerance_minutes integer not null default 10 check (late_tolerance_minutes >= 0),
  auto_confirm_bookings boolean not null default false,
  -- loja
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  -- indicação
  referral_enabled boolean not null default true,
  referral_reward_kind text not null default 'desconto_percentual'
    check (referral_reward_kind in ('desconto_percentual','desconto_fixo','credito','servico_gratuito','produto','beneficio')),
  referral_reward_value numeric(10,2) not null default 0 check (referral_reward_value >= 0),
  referral_reward_description text,
  referral_validation_days integer not null default 60 check (referral_validation_days > 0),
  referral_reward_validity_days integer not null default 90 check (referral_reward_validity_days > 0),
  referral_max_rewards integer check (referral_max_rewards is null or referral_max_rewards > 0),
  referral_min_referrals integer not null default 1 check (referral_min_referrals >= 1),
  updated_at timestamptz not null default now()
);
create trigger trg_settings_touch before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- Horário de funcionamento: nenhum dia é presumido aberto.
create table public.business_hours (
  weekday smallint primary key check (weekday between 0 and 6), -- 0 = domingo
  is_open boolean not null default false,
  opens_at time,
  closes_at time,
  check (not is_open or (opens_at is not null and closes_at is not null and opens_at < closes_at))
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'outro' check (kind in ('dinheiro','pix','cartao_credito','cartao_debito','outro')),
  active boolean not null default true,
  sort_order integer not null default 0
);

-- Configurações do gateway: somente dados NÃO secretos.
-- Chaves secretas ficam em variáveis de ambiente / secrets das Edge Functions.
create table public.payment_settings (
  id smallint primary key default 1 check (id = 1),
  provider text check (provider in ('mercado_pago','asaas')),
  environment text not null default 'sandbox' check (environment in ('sandbox','producao')),
  public_key text,
  online_payments_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Conteúdo público editável
-- ---------------------------------------------------------------------
create table public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  caption text,
  category text not null default 'ambiente' check (category in ('ambiente','cortes','barba','resultados','eventos')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes, barbeiros e funcionários
-- ---------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  email text,
  phone text,
  notes text,                 -- observações internas (somente equipe)
  status text not null default 'ativo' check (status in ('ativo','inativo','bloqueado')),
  referred_by_affiliate uuid,  -- FK adicionada no módulo de afiliados
  last_visit_at timestamptz,
  visits_count integer not null default 0,
  created_by uuid references public.profiles(id),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.customers (lower(full_name));
create index on public.customers (phone);
create trigger trg_customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  display_name text not null,
  bio text,
  specialties text[] not null default '{}',
  photo_url text,
  active boolean not null default true,
  accepts_online_booking boolean not null default true,
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  commission_type text not null default 'percentual' check (commission_type in ('percentual','fixo')),
  commission_value numeric(10,2) not null default 0 check (commission_value >= 0),
  product_commission_percent numeric(5,2) not null default 0 check (product_commission_percent between 0 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (commission_type <> 'percentual' or commission_value <= 100)
);
create trigger trg_barbers_touch before update on public.barbers
  for each row execute function public.touch_updated_at();

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  job_title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from customers where profile_id = app.uid()
$$;

create or replace function public.my_barber_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from barbers where profile_id = app.uid()
$$;

-- ---------------------------------------------------------------------
-- Provisionamento do perfil (chamado SOMENTE pelo servidor, com a conexão
-- do proprietário do banco, após validar a sessão do Neon Auth).
-- Cria perfil, papel "cliente", ficha de cliente, consentimentos e indicação.
-- ---------------------------------------------------------------------
create or replace function app.ensure_profile(p_auth_user_id text, p_email text, p_name text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := coalesce(nullif(trim(p_meta ->> 'full_name'), ''), nullif(trim(p_name), ''), split_part(p_email, '@', 1));
  v_phone text := nullif(trim(p_meta ->> 'phone'), '');
begin
  select id into v_id from profiles where auth_user_id = p_auth_user_id;
  if v_id is not null then return v_id; end if;

  insert into profiles (auth_user_id, full_name, email, phone, birth_date, communication_email, communication_whatsapp)
  values (p_auth_user_id, v_name, lower(p_email), v_phone,
          nullif(p_meta ->> 'birth_date', '')::date,
          coalesce((p_meta ->> 'marketing_email')::boolean, false),
          coalesce((p_meta ->> 'marketing_whatsapp')::boolean, false))
  on conflict (auth_user_id) do nothing
  returning id into v_id;
  if v_id is null then  -- corrida entre duas requisições simultâneas
    select id into v_id from profiles where auth_user_id = p_auth_user_id;
    return v_id;
  end if;

  insert into user_roles (user_id, role_id) select v_id, id from roles where key = 'cliente';

  -- reaproveita ficha criada pela recepção com o mesmo e-mail, se existir
  update customers set profile_id = v_id where profile_id is null and lower(email) = lower(p_email);
  if not found then
    insert into customers (profile_id, full_name, email, phone) values (v_id, v_name, lower(p_email), v_phone);
  end if;

  perform app.record_signup_consents(v_id, p_meta);
  perform app.apply_referral(v_id, p_meta ->> 'ref_code');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Cadastro administrativo inicial seguro.
-- Executável apenas pelo SQL Editor do Neon / psql com o papel proprietário
-- (nunca pelo navegador):   select public.bootstrap_owner('email@dominio.com');
-- Só funciona enquanto não existir nenhum proprietário.
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_owner(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where r.key = 'proprietario') then
    raise exception 'Já existe um proprietário cadastrado. Use o painel para gerenciar acessos.';
  end if;
  select id into v_uid from profiles where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'Usuário % não encontrado. Crie a conta pelo site antes.', p_email;
  end if;
  insert into user_roles (user_id, role_id) select v_uid, id from roles where key = 'proprietario'
  on conflict do nothing;
end $$;
revoke execute on function public.bootstrap_owner(text) from public, app_user;

-- ---------------------------------------------------------------------
-- Gestão de acessos (somente via RPC; tabelas sem escrita direta)
-- ---------------------------------------------------------------------
create or replace function public.assign_role(p_user_id uuid, p_role_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role roles;
begin
  perform require_permission('usuarios', 'gerenciar');
  select * into v_role from roles where key = p_role_key;
  if v_role.id is null then raise exception 'Perfil inexistente: %', p_role_key; end if;
  if v_role.is_privileged and not is_owner() then
    raise exception 'Somente o proprietário pode atribuir o perfil %', v_role.name using errcode = '42501';
  end if;
  insert into user_roles (user_id, role_id, granted_by) values (p_user_id, v_role.id, app.uid())
  on conflict do nothing;
end $$;

create or replace function public.revoke_role(p_user_id uuid, p_role_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role roles;
begin
  perform require_permission('usuarios', 'gerenciar');
  select * into v_role from roles where key = p_role_key;
  if v_role.id is null then raise exception 'Perfil inexistente'; end if;
  if v_role.is_privileged and not is_owner() then
    raise exception 'Somente o proprietário pode remover o perfil %', v_role.name using errcode = '42501';
  end if;
  if p_role_key = 'proprietario' and (select count(*) from user_roles where role_id = v_role.id) <= 1 then
    raise exception 'A barbearia precisa de pelo menos um proprietário';
  end if;
  delete from user_roles where user_id = p_user_id and role_id = v_role.id;
end $$;

create or replace function public.set_role_permission(p_role_key text, p_module text, p_action text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_role roles; v_perm uuid;
begin
  if not is_owner() then
    raise exception 'Somente o proprietário altera permissões de perfis' using errcode = '42501';
  end if;
  select * into v_role from roles where key = p_role_key;
  if v_role.key = 'proprietario' then raise exception 'O proprietário possui acesso total e não é editável'; end if;
  select id into v_perm from permissions where module = p_module and action = p_action;
  if v_role.id is null or v_perm is null then raise exception 'Perfil ou permissão inexistente'; end if;
  if p_enabled then
    insert into role_permissions values (v_role.id, v_perm) on conflict do nothing;
  else
    delete from role_permissions where role_id = v_role.id and permission_id = v_perm;
  end if;
end $$;

create or replace function public.create_custom_role(p_key text, p_name text, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_owner() then raise exception 'Somente o proprietário cria perfis' using errcode = '42501'; end if;
  insert into roles (key, name, description, is_system, is_privileged, is_staff)
  values (p_key, p_name, p_description, false, false, true) returning id into v_id;
  return v_id;
end $$;
