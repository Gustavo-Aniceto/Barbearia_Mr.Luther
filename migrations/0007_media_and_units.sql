-- =====================================================================
-- MR.LUDER — 0007 Arquivos (Neon Object Storage) e preparação multiunidade
-- =====================================================================

-- ---------------------------------------------------------------------
-- Arquivos: o binário fica no Neon Object Storage (S3); aqui ficam apenas
-- a referência (bucket + chave) e os metadados.
-- ---------------------------------------------------------------------
create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_key text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/avif','application/pdf')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  original_name text,
  folder text not null check (folder ~ '^[a-z0-9_-]{2,30}$'),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, object_key)
);
alter table public.media_files enable row level security;
create policy media_select on public.media_files for select using (true);
create policy media_insert on public.media_files for insert with check (
  uploaded_by = app.uid() and (
    public.has_permission('site','criar') or public.has_permission('servicos','editar')
    or public.has_permission('produtos','editar') or public.has_permission('equipe','editar')));
create policy media_delete on public.media_files for delete using (public.has_permission('site','excluir'));

-- ---------------------------------------------------------------------
-- Unidades: hoje existe uma (a matriz). As tabelas operacionais já
-- carregam unit_id, permitindo abrir filiais sem migrar dados.
-- ---------------------------------------------------------------------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  address text,
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.units enable row level security;
create policy units_select on public.units for select using (true);
create policy units_write on public.units for all using (public.is_owner()) with check (public.is_owner());

insert into public.units (slug, name, address)
values ('matriz', 'MR.LUDER — Vila Tijuco', 'Av. Emílio Ribas, 797 - Vila Tijuco, Guarulhos - SP, 07020-010');

create or replace function app.default_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select id from units where slug = 'matriz'
$$;
grant execute on function app.default_unit() to app_user;

do $$
declare t text;
begin
  foreach t in array array['barbers','employees','services','appointments','time_off','products','inventory_movements',
                           'orders','transactions','cash_closings','plans','subscriptions','gallery_images']
  loop
    execute format('alter table public.%I add column unit_id uuid not null default app.default_unit() references public.units(id)', t);
    execute format('create index on public.%I (unit_id)', t);
  end loop;
end $$;

-- Funções internas: somente o servidor (papel proprietário) executa
revoke execute on function app.ensure_profile(text, text, text, jsonb) from public, app_user;
revoke execute on function app.record_signup_consents(uuid, jsonb) from public, app_user;
revoke execute on function app.apply_referral(uuid, text) from public, app_user;
revoke execute on function public.gateway_confirm_payment(uuid, text, text, numeric) from public, app_user;
revoke execute on function public.bootstrap_owner(text) from public, app_user;
revoke execute on function public.process_subscription_renewals() from public, app_user;

-- Controle de migrations aplicadas (preenchido por scripts/migrate.mjs)
create table if not exists app.schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
