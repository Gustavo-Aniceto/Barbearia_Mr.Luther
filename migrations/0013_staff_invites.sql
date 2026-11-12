-- 0013 · Convites da equipe
-- O proprietário (ou o suporte, via SQL) registra o e-mail de um barbeiro/sócio antes de ele se cadastrar.
-- Quando a pessoa cria a conta com esse e-mail — e o Neon Auth já confirmou o e-mail com o código —,
-- o perfil recebe os papéis do convite e é ligado ao card do barbeiro, sem ninguém precisar mexer depois.
-- Nenhuma senha é criada ou guardada aqui: cada um define a própria no cadastro.

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and email like '%@%'),
  full_name text,
  role_keys text[] not null check (cardinality(role_keys) > 0),
  barber_id uuid references public.barbers(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null
);

-- Sem políticas: o navegador (papel app_user) não lê nem altera convites.
alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from app_user;

create or replace function app.apply_staff_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv staff_invites;
begin
  select * into inv from staff_invites where email = lower(new.email) and used_at is null for update;
  if not found then return new; end if;

  insert into user_roles (user_id, role_id)
  select new.id, r.id from roles r where r.key = any(inv.role_keys)
  on conflict do nothing;

  if inv.barber_id is not null then
    update barbers set profile_id = new.id where id = inv.barber_id and profile_id is null;
  end if;

  if inv.full_name is not null and length(trim(inv.full_name)) >= 2 then
    update profiles set full_name = inv.full_name where id = new.id;
  end if;

  update staff_invites set used_at = now(), used_by = new.id where id = inv.id;
  return new;
end $$;
revoke execute on function app.apply_staff_invite() from public;

drop trigger if exists trg_profiles_staff_invite on public.profiles;
-- "after insert": o perfil e a ficha de cliente já existem quando o convite é aplicado
create trigger trg_profiles_staff_invite after insert on public.profiles
  for each row execute function app.apply_staff_invite();
