-- =====================================================================
-- MR.LUDER — 0005 Row Level Security em TODAS as tabelas + RPCs de leitura
-- Regra geral: leitura e escrita sempre verificadas no banco.
-- Escritas sensíveis (agenda, pedidos, pagamentos, papéis) só via funções.
-- O servidor Next.js executa cada requisição como a role app_user, com
-- app.profile_id definido na transação: o RLS vale mesmo para o backend.
-- =====================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- helpers curtos
create or replace function public.can(p_module text, p_action text) returns boolean
language sql stable as $$ select public.has_permission(p_module, p_action) $$;

-- ---------- Acesso ----------
create policy profiles_select on public.profiles for select using (id = app.uid() or can('clientes','visualizar') or can('usuarios','visualizar'));
-- o próprio usuário altera dados via update_my_profile() (colunas controladas)
create policy profiles_update_staff on public.profiles for update using (can('usuarios','editar')) with check (can('usuarios','editar'));

create policy roles_select on public.roles for select using (is_staff());
create policy permissions_select on public.permissions for select using (is_staff());
create policy role_permissions_select on public.role_permissions for select using (is_staff());
create policy user_roles_select on public.user_roles for select using (user_id = app.uid() or can('usuarios','visualizar'));
-- sem políticas de escrita: somente via assign_role / revoke_role / set_role_permission

-- ---------- Configurações ----------
create policy settings_select on public.business_settings for select using (true);
create policy settings_update on public.business_settings for update using (can('configuracoes','editar')) with check (can('configuracoes','editar'));
create policy hours_select on public.business_hours for select using (true);
create policy hours_write on public.business_hours for all using (can('configuracoes','editar')) with check (can('configuracoes','editar'));
create policy pm_select on public.payment_methods for select using (app.uid() is not null);
create policy pm_write on public.payment_methods for all using (can('financeiro','gerenciar')) with check (can('financeiro','gerenciar'));
create policy pay_settings_all on public.payment_settings for all using (can('financeiro','gerenciar')) with check (can('financeiro','gerenciar'));
create policy notif_settings_select on public.notification_settings for select using (is_staff());
create policy notif_settings_write on public.notification_settings for update using (can('configuracoes','editar')) with check (can('configuracoes','editar'));
create policy gallery_select on public.gallery_images for select using (active or can('site','visualizar'));
create policy gallery_insert on public.gallery_images for insert with check (can('site','criar'));
create policy gallery_update on public.gallery_images for update using (can('site','editar')) with check (can('site','editar'));
create policy gallery_delete on public.gallery_images for delete using (can('site','excluir'));

-- ---------- Pessoas ----------
create policy customers_select on public.customers for select using (
  profile_id = app.uid() or can('clientes','visualizar')
  or exists (select 1 from appointments a where a.customer_id = customers.id and a.barber_id = my_barber_id()));
create policy customers_insert on public.customers for insert with check (can('clientes','criar'));
create policy customers_update on public.customers for update using (can('clientes','editar')) with check (can('clientes','editar'));
create policy customers_delete on public.customers for delete using (can('clientes','excluir'));

create policy barbers_select on public.barbers for select using (profile_id = app.uid() or is_staff());
create policy barbers_insert on public.barbers for insert with check (can('equipe','criar'));
create policy barbers_update on public.barbers for update using (can('equipe','editar')) with check (can('equipe','editar'));
create policy barbers_delete on public.barbers for delete using (can('equipe','excluir'));
create policy employees_select on public.employees for select using (profile_id = app.uid() or can('equipe','visualizar'));
create policy employees_write on public.employees for all using (can('equipe','editar')) with check (can('equipe','editar'));

-- ---------- Serviços e agenda ----------
create policy svc_cat_select on public.service_categories for select using (true);
create policy svc_cat_write on public.service_categories for all using (can('servicos','editar')) with check (can('servicos','editar'));
create policy services_select on public.services for select using (active or can('servicos','visualizar'));
create policy services_insert on public.services for insert with check (can('servicos','criar'));
create policy services_update on public.services for update using (can('servicos','editar')) with check (can('servicos','editar'));
create policy services_delete on public.services for delete using (can('servicos','excluir'));
create policy combo_select on public.service_combo_items for select using (true);
create policy combo_write on public.service_combo_items for all using (can('servicos','editar')) with check (can('servicos','editar'));
create policy barber_services_select on public.barber_services for select using (is_staff());
create policy barber_services_write on public.barber_services for all using (can('servicos','editar') or can('equipe','editar'))
  with check (can('servicos','editar') or can('equipe','editar'));

create policy schedules_select on public.barber_schedules for select using (is_staff());
create policy schedules_write on public.barber_schedules for all
  using (can('equipe','editar') or (barber_id = my_barber_id() and can('disponibilidade','editar')))
  with check (can('equipe','editar') or (barber_id = my_barber_id() and can('disponibilidade','editar')));

create policy time_off_select on public.time_off for select using (can('agenda','visualizar') or barber_id = my_barber_id());
create policy time_off_insert on public.time_off for insert with check (can('agenda','criar'));
create policy time_off_update on public.time_off for update using (can('agenda','editar')) with check (can('agenda','editar'));
create policy time_off_delete on public.time_off for delete using (can('agenda','excluir') or (barber_id = my_barber_id() and status = 'pendente'));

create policy appt_select on public.appointments for select using (
  customer_id = my_customer_id() or barber_id = my_barber_id() or can('agenda','visualizar'));
create policy appt_services_select on public.appointment_services for select using (
  exists (select 1 from appointments a where a.id = appointment_id));
create policy appt_history_select on public.appointment_status_history for select using (
  exists (select 1 from appointments a where a.id = appointment_id));

-- ---------- Notificações ----------
create policy notif_select on public.notification_logs for select using (user_id = app.uid() or can('configuracoes','visualizar'));

-- ---------- Financeiro ----------
create policy tx_select on public.transactions for select using (can('financeiro','visualizar'));
create policy tx_insert on public.transactions for insert with check (can('financeiro','criar') and status in ('pendente','pago','recebido') and appointment_id is null and order_id is null and subscription_id is null);
create policy tx_update on public.transactions for update using (can('financeiro','editar')) with check (can('financeiro','editar'));
create policy ptx_select on public.payment_transactions for select using (can('financeiro','visualizar'));
create policy commissions_select on public.commissions for select using (barber_id = my_barber_id() or can('financeiro','visualizar'));
create policy payouts_select on public.payouts for select using (barber_id = my_barber_id() or can('financeiro','visualizar'));
create policy closings_select on public.cash_closings for select using (can('financeiro','visualizar'));

-- ---------- Produtos / loja ----------
create policy prod_cat_select on public.product_categories for select using (true);
create policy prod_cat_write on public.product_categories for all using (can('produtos','editar')) with check (can('produtos','editar'));
create policy products_select on public.products for select using (can('produtos','visualizar'));
create policy products_insert on public.products for insert with check (can('produtos','criar'));
create policy products_update on public.products for update using (can('produtos','editar')) with check (can('produtos','editar'));
create policy products_delete on public.products for delete using (can('produtos','excluir'));
create policy inventory_select on public.inventory_movements for select using (can('produtos','visualizar'));
create policy coupons_select on public.coupons for select using (customer_id = my_customer_id() or can('afiliados','visualizar') or can('pedidos','visualizar'));
create policy coupons_write on public.coupons for all using (can('afiliados','editar')) with check (can('afiliados','editar'));
create policy orders_select on public.orders for select using (customer_id = my_customer_id() or can('pedidos','visualizar'));
create policy order_items_select on public.order_items for select using (exists (select 1 from orders o where o.id = order_id));

-- ---------- Planos ----------
create policy plans_select on public.plans for select using (active or can('planos','visualizar'));
create policy plans_insert on public.plans for insert with check (can('planos','criar'));
create policy plans_update on public.plans for update using (can('planos','editar')) with check (can('planos','editar'));
create policy plans_delete on public.plans for delete using (can('planos','excluir'));
create policy benefits_select on public.plan_benefits for select using (exists (select 1 from plans p where p.id = plan_id));
create policy benefits_write on public.plan_benefits for all using (can('planos','editar')) with check (can('planos','editar'));
create policy subs_select on public.subscriptions for select using (customer_id = my_customer_id() or can('planos','visualizar'));
create policy usages_select on public.subscription_usages for select using (exists (select 1 from subscriptions s where s.id = subscription_id));

-- ---------- Afiliados ----------
create policy aff_select on public.affiliates for select using (customer_id = my_customer_id() or can('afiliados','visualizar'));
create policy aff_update on public.affiliates for update using (can('afiliados','editar')) with check (can('afiliados','editar'));
create policy codes_select on public.referral_codes for select using (exists (select 1 from affiliates a where a.id = affiliate_id));
create policy referrals_select on public.referrals for select using (exists (select 1 from affiliates a where a.id = affiliate_id));
create policy referrals_update on public.referrals for update using (can('afiliados','aprovar')) with check (can('afiliados','aprovar'));
create policy rewards_select on public.rewards for select using (exists (select 1 from affiliates a where a.id = affiliate_id));
create policy rewards_update on public.rewards for update using (can('afiliados','editar')) with check (can('afiliados','editar'));

-- ---------- LGPD / auditoria / conteúdo ----------
create policy legal_select on public.legal_documents for select using (true);
create policy legal_write on public.legal_documents for all using (can('lgpd','editar')) with check (can('lgpd','editar'));
create policy consent_select on public.consent_records for select using (user_id = app.uid() or can('lgpd','visualizar'));
create policy privacy_select on public.privacy_requests for select using (user_id = app.uid() or can('lgpd','visualizar'));
create policy privacy_update on public.privacy_requests for update using (can('lgpd','editar')) with check (can('lgpd','editar'));
create policy audit_select on public.audit_logs for select using (can('auditoria','visualizar'));
create policy testimonials_select on public.testimonials for select using (status = 'aprovado' or customer_id = my_customer_id() or can('site','visualizar'));
create policy testimonials_update on public.testimonials for update using (can('site','editar')) with check (can('site','editar'));
create policy testimonials_delete on public.testimonials for delete using (can('site','excluir'));

-- Funções internas não podem ser chamadas pelo navegador
revoke execute on function public.audit_trigger() from public, app_user;

-- =====================================================================
-- RPCs de leitura agregada (expõem somente colunas seguras)
-- =====================================================================

-- Conteúdo público do site (sem custo de produto, comissões ou dados pessoais)
create or replace function public.public_site() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('name', name, 'address', address, 'maps_url', maps_url, 'phone', phone, 'whatsapp', whatsapp,
        'instagram_url', instagram_url, 'privacy_email', privacy_email, 'rating_value', rating_value, 'rating_count', rating_count,
        'rating_source', rating_source, 'rating_updated_at', rating_updated_at, 'hero_title', hero_title, 'hero_subtitle', hero_subtitle,
        'hero_image_url', hero_image_url, 'about_title', about_title, 'about_text', about_text, 'about_highlights', about_highlights,
        'cancel_min_hours', cancel_min_hours, 'reschedule_min_hours', reschedule_min_hours, 'late_tolerance_minutes', late_tolerance_minutes,
        'min_advance_minutes', min_advance_minutes, 'booking_window_days', booking_window_days,
        'pickup_enabled', pickup_enabled, 'delivery_enabled', delivery_enabled, 'delivery_fee', delivery_fee,
        'referral_enabled', referral_enabled, 'referral_reward_description', referral_reward_description,
        'referral_reward_kind', referral_reward_kind, 'referral_reward_value', referral_reward_value)
      from business_settings where id = 1),
    'hours', (select coalesce(jsonb_agg(to_jsonb(h) order by weekday), '[]') from business_hours h),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]') from service_categories where active),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'photo_url', s.photo_url,
        'price', s.price, 'duration_minutes', s.duration_minutes, 'category_id', s.category_id, 'is_combo', s.is_combo,
        'bookable_online', s.bookable_online,
        'barber_ids', (select coalesce(jsonb_agg(bs.barber_id), '[]') from barber_services bs join barbers b on b.id = bs.barber_id where bs.service_id = s.id and b.active))
        order by s.sort_order, s.name), '[]') from services s where s.active),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.display_name, 'bio', b.bio, 'specialties', b.specialties,
        'photo_url', b.photo_url, 'accepts_online_booking', b.accepts_online_booking,
        'service_ids', (select coalesce(jsonb_agg(service_id), '[]') from barber_services where barber_id = b.id)) order by b.sort_order, b.display_name), '[]')
      from barbers b where b.active),
    'gallery', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'image_url', image_url, 'caption', caption, 'category', category) order by sort_order, created_at), '[]') from gallery_images where active),
    'testimonials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'author', author_name, 'rating', rating, 'content', content, 'created_at', created_at) order by created_at desc), '[]') from testimonials where status = 'aprovado'),
    'product_categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]') from product_categories),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'photo_url', p.photo_url,
        'price', p.price, 'category_id', p.category_id, 'track_stock', p.track_stock,
        'stock', case when p.track_stock then p.stock end, 'available', (not p.track_stock or p.stock > 0)) order by p.name), '[]') from products p where p.active),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'description', pl.description, 'price', pl.price,
        'period_months', pl.period_months, 'product_discount_percent', pl.product_discount_percent, 'usage_rules', pl.usage_rules,
        'contract_conditions', pl.contract_conditions,
        'sold_out', pl.max_active_subscriptions is not null and (select count(*) from subscriptions s where s.plan_id = pl.id and s.status in ('ativa','pendente')) >= pl.max_active_subscriptions,
        'benefits', (select coalesce(jsonb_agg(jsonb_build_object('description', pb.description, 'quantity', pb.quantity_per_period, 'service_id', pb.service_id)), '[]') from plan_benefits pb where pb.plan_id = pl.id))
        order by pl.sort_order, pl.price), '[]') from plans pl where pl.active),
    'legal', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('version', version, 'title', title, 'content', content, 'published_at', published_at)), '{}') from legal_documents where is_current)
  )
$$;
grant execute on function public.public_site() to app_user;

-- Agenda unificada (equipe vê conforme permissão; barbeiro vê a própria)
create or replace function public.agenda_view(p_from timestamptz, p_to timestamptz, p_barber_id uuid default null)
returns table (id uuid, code text, starts_at timestamptz, ends_at timestamptz, status public.appointment_status, total_price numeric,
  barber_id uuid, barber_name text, customer_id uuid, customer_name text, customer_phone text,
  services text, customer_notes text, professional_notes text, source text, covered_by_plan boolean, visits_count int)
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean := has_permission('agenda','visualizar'); v_me uuid := my_barber_id();
begin
  if not v_all and v_me is null then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_to - p_from > interval '62 days' then raise exception 'Período muito longo'; end if;
  return query
  select a.id, a.code, a.starts_at, a.ends_at, a.status, a.total_price, a.barber_id, b.display_name, c.id, c.full_name, c.phone,
    (select string_agg(service_name, ' + ' order by service_name) from appointment_services where appointment_id = a.id),
    a.customer_notes, a.professional_notes, a.source,
    exists (select 1 from appointment_services x where x.appointment_id = a.id and x.covered_by_subscription), c.visits_count
  from appointments a join barbers b on b.id = a.barber_id join customers c on c.id = a.customer_id
  where a.starts_at >= p_from and a.starts_at < p_to
    and (case when v_all then (p_barber_id is null or a.barber_id = p_barber_id) else a.barber_id = v_me end)
  order by a.starts_at;
end $$;

-- Área do cliente
create or replace function public.my_appointments() returns table (id uuid, code text, starts_at timestamptz, ends_at timestamptz,
  status public.appointment_status, total_price numeric, barber_id uuid, barber_name text, services text, service_ids uuid[], customer_notes text)
language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.starts_at, a.ends_at, a.status, a.total_price, a.barber_id, b.display_name,
    (select string_agg(service_name, ' + ') from appointment_services where appointment_id = a.id),
    (select array_agg(service_id) from appointment_services where appointment_id = a.id), a.customer_notes
  from appointments a join barbers b on b.id = a.barber_id
  where a.customer_id = my_customer_id()
  order by a.starts_at desc limit 200
$$;

create or replace function public.my_club() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'affiliate', (select jsonb_build_object('id', a.id, 'status', a.status, 'code', (select code from referral_codes where affiliate_id = a.id and active limit 1))
                  from affiliates a where a.customer_id = my_customer_id()),
    'referrals', coalesce((select jsonb_agg(jsonb_build_object('name', split_part(c.full_name, ' ', 1), 'status', r.status, 'created_at', r.created_at,
        'validated_at', r.validated_at, 'reason', r.reject_reason) order by r.created_at desc)
      from referrals r join affiliates a on a.id = r.affiliate_id join customers c on c.id = r.referred_customer_id
      where a.customer_id = my_customer_id()), '[]'),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'description', w.description, 'status', w.status, 'expires_at', w.expires_at,
        'coupon', (select code from coupons where id = w.coupon_id)) order by w.created_at desc)
      from rewards w join affiliates a on a.id = w.affiliate_id where a.customer_id = my_customer_id()), '[]')
  )
$$;

create or replace function public.my_subscriptions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'plan', pl.name, 'plan_id', pl.id, 'status', s.status, 'auto_renew', s.auto_renew,
    'period_start', s.current_period_start, 'period_end', s.current_period_end, 'price', pl.price,
    'benefits', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'service_id', b.service_id, 'quantity', b.quantity_per_period,
        'used', (select count(*) from subscription_usages u where u.subscription_id = s.id and u.service_id = b.service_id and u.period_start = s.current_period_start))), '[]')
      from plan_benefits b where b.plan_id = pl.id)) order by s.created_at desc), '[]')
  from subscriptions s join plans pl on pl.id = s.plan_id where s.customer_id = my_customer_id()
$$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_birth_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app.uid() is null then raise exception 'Faça login' using errcode = '42501'; end if;
  update profiles set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''), birth_date = p_birth_date where id = app.uid();
  update customers set full_name = trim(p_full_name), phone = nullif(trim(p_phone), '') where profile_id = app.uid();
end $$;

-- Recebimento no balcão (agendamento / pedido / assinatura)
create or replace function public.receive_payment(p_ref_type text, p_ref_id uuid, p_payment_method_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_tx uuid; v_amount numeric;
begin
  if p_ref_type = 'pedido' then perform require_permission('pedidos','editar');
    select id, amount into v_tx, v_amount from transactions where order_id = p_ref_id and status = 'pendente';
  elsif p_ref_type = 'assinatura' then perform require_permission('planos','editar');
    select id, amount into v_tx, v_amount from transactions where subscription_id = p_ref_id and status = 'pendente' order by created_at limit 1;
  elsif p_ref_type = 'agendamento' then perform require_permission('agenda','editar');
    select id, amount into v_tx, v_amount from transactions where appointment_id = p_ref_id and status = 'pendente';
  else raise exception 'Tipo inválido'; end if;
  if v_tx is null then raise exception 'Nenhuma cobrança pendente encontrada'; end if;
  insert into payment_transactions (transaction_id, payment_method_id, amount, gateway, registered_by)
  values (v_tx, p_payment_method_id, v_amount - coalesce((select sum(amount) from payment_transactions where transaction_id = v_tx and status = 'aprovado'), 0), 'manual', app.uid());
  update transactions set status = 'recebido', settled_at = now(), payment_method_id = p_payment_method_id where id = v_tx;
  perform on_transaction_settled(v_tx);
end $$;

-- Conteúdo editorial do site: permissão "site.editar" sem acesso às demais configurações
create or replace function public.update_site_content(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('site', 'editar');
  update business_settings set
    hero_title = case when p ? 'hero_title' then p ->> 'hero_title' else hero_title end,
    hero_subtitle = case when p ? 'hero_subtitle' then p ->> 'hero_subtitle' else hero_subtitle end,
    hero_image_url = case when p ? 'hero_image_url' then p ->> 'hero_image_url' else hero_image_url end,
    about_title = case when p ? 'about_title' then p ->> 'about_title' else about_title end,
    about_text = case when p ? 'about_text' then p ->> 'about_text' else about_text end,
    about_highlights = case when p ? 'about_highlights' then p -> 'about_highlights' else about_highlights end,
    rating_value = case when p ? 'rating_value' then (p ->> 'rating_value')::numeric else rating_value end,
    rating_count = case when p ? 'rating_count' then (p ->> 'rating_count')::int else rating_count end,
    rating_source = case when p ? 'rating_source' then p ->> 'rating_source' else rating_source end,
    rating_updated_at = case when p ? 'rating_value' then current_date else rating_updated_at end
  where id = 1;
end $$;

-- Confirmação de pagamento vinda do gateway (somente o servidor, via rota de webhook com a conexão proprietária).
-- Idempotente: o mesmo evento pode chegar mais de uma vez.
create or replace function public.gateway_confirm_payment(p_transaction_id uuid, p_gateway text, p_reference text, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  if exists (select 1 from payment_transactions where gateway = p_gateway and gateway_reference = p_reference and status = 'aprovado') then
    return 'duplicado';
  end if;
  select * into t from transactions where id = p_transaction_id for update;
  if t.id is null then raise exception 'Lançamento não encontrado'; end if;
  if t.status <> 'pendente' then return 'ja_quitado'; end if;
  if p_amount < t.amount then raise exception 'Valor recebido menor que o devido'; end if;
  insert into payment_transactions (transaction_id, amount, gateway, gateway_reference, status)
  values (t.id, t.amount, p_gateway, p_reference, 'aprovado');
  update transactions set status = 'recebido', settled_at = now() where id = t.id;
  perform on_transaction_settled(t.id);
  return 'ok';
end $$;
revoke execute on function public.gateway_confirm_payment(uuid, text, text, numeric) from public, app_user;
