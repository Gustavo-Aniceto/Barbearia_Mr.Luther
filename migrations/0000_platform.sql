-- =====================================================================
-- MR.LUDER — 0000 Plataforma (Neon PostgreSQL)
--
-- Modelo de segurança:
--   * O servidor Next.js conecta com o papel proprietário (DATABASE_URL,
--     nunca exposto ao navegador).
--   * Toda operação de usuário roda numa transação que executa
--       SET LOCAL ROLE app_user;
--       SELECT set_config('app.profile_id', '<uuid do perfil>', true);
--     então as políticas RLS e as checagens de permissão das funções
--     valem também para o backend (defesa em profundidade).
--   * app.uid() devolve o perfil da transação (NULL = visitante).
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin noinherit;
  end if;
end $$;
-- permite que o papel do servidor assuma app_user (SET ROLE)
grant app_user to current_user;

create or replace function app.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.profile_id', true), '')::uuid
$$;

grant usage on schema app to app_user;
grant execute on function app.uid() to app_user;
grant usage on schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public grant usage, select on sequences to app_user;
-- funções novas não ficam executáveis por padrão no schema app
alter default privileges in schema app revoke execute on functions from public;
