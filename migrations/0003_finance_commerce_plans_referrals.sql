-- =====================================================================
-- MR.LUDER — 0003 Financeiro, comissões, loja/estoque, planos, afiliados
-- =====================================================================

-- ---------------------------------------------------------------------
-- Notificações (usadas por vários módulos)
-- ---------------------------------------------------------------------
create table public.notification_settings (
  event text primary key,
  label text not null,
  internal_enabled boolean not null default true,
  email_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false
);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  event text not null,
  channel text not null check (channel in ('interno','email','whatsapp')),
  title text not null,
  body text,
  related_id uuid,
  -- externo: 'aguardando_integracao' até um provedor ser configurado. Nunca marcado como enviado sem envio real.
  status text not null default 'registrada' check (status in ('registrada','lida','aguardando_integracao','enviada','falhou')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notification_logs (user_id, created_at desc);

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
  if ns.whatsapp_enabled then
    insert into notification_logs (user_id, event, channel, title, body, related_id, status) values (p_user, p_event, 'whatsapp', p_title, p_body, p_related, 'aguardando_integracao');
  end if;
end $$;
revoke execute on function public.notify_user(uuid, text, text, text, uuid) from public, app_user;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notification_logs set status = 'lida', read_at = now()
  where user_id = app.uid() and channel = 'interno' and status = 'registrada'
$$;

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receita','despesa')),
  category text not null check (category in ('servico','produto','plano','despesa_fixa','despesa_variavel','fornecedor','comissao','outros')),
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  -- faturado (pendente) x efetivamente recebido/pago
  status text not null default 'pendente' check (status in ('pendente','recebido','pago','cancelado')),
  competence_date date not null default current_date,
  due_date date,
  settled_at timestamptz,
  payment_method_id uuid references public.payment_methods(id),
  appointment_id uuid references public.appointments(id) on delete restrict,
  order_id uuid,
  subscription_id uuid,
  barber_id uuid references public.barbers(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'receita' and status in ('pendente','recebido','cancelado')) or (kind = 'despesa' and status in ('pendente','pago','cancelado')))
);
create index on public.transactions (competence_date);
create index on public.transactions (status, kind);
create unique index transactions_one_per_appointment on public.transactions (appointment_id) where appointment_id is not null and status <> 'cancelado';

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  payment_method_id uuid references public.payment_methods(id),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'aprovado' check (status in ('pendente','aprovado','recusado','estornado')),
  gateway text,              -- mercado_pago | asaas | manual
  gateway_reference text,    -- id externo (nunca dados de cartão)
  registered_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.payment_transactions (transaction_id);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id),
  amount numeric(12,2) not null check (amount >= 0),
  period_start date not null,
  period_end date not null,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id),
  notes text
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id),
  appointment_id uuid references public.appointments(id) on delete restrict,
  order_item_id uuid,
  source text not null check (source in ('servico','produto')),
  description text not null,
  base_amount numeric(12,2) not null,
  rate_type text not null check (rate_type in ('percentual','fixo')),
  rate_value numeric(10,2) not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pendente' check (status in ('pendente','pago','cancelado')),
  payout_id uuid references public.payouts(id),
  created_at timestamptz not null default now()
);
create index on public.commissions (barber_id, created_at);

create table public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('diario','mensal')),
  period_start date not null,
  period_end date not null,
  totals jsonb not null,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  unique (period_type, period_start)
);

-- Registro de pagamento (dinheiro, Pix, cartão... — manual ou confirmado por gateway)
create or replace function public.register_payment(p_transaction_id uuid, p_payment_method_id uuid, p_amount numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare t transactions; v_paid numeric; v_amount numeric;
begin
  perform require_permission('financeiro', 'criar');
  select * into t from transactions where id = p_transaction_id for update;
  if t.id is null then raise exception 'Lançamento não encontrado'; end if;
  if t.status not in ('pendente') then raise exception 'Lançamento já quitado ou cancelado'; end if;
  select coalesce(sum(amount),0) into v_paid from payment_transactions where transaction_id = t.id and status = 'aprovado';
  v_amount := coalesce(p_amount, t.amount - v_paid);
  if v_amount <= 0 or v_paid + v_amount > t.amount then raise exception 'Valor inválido'; end if;
  insert into payment_transactions (transaction_id, payment_method_id, amount, gateway, registered_by)
  values (t.id, p_payment_method_id, v_amount, 'manual', app.uid());
  if v_paid + v_amount >= t.amount then
    update transactions set status = case when kind = 'receita' then 'recebido' else 'pago' end,
      settled_at = now(), payment_method_id = p_payment_method_id where id = t.id;
    perform on_transaction_settled(t.id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Comissões e finalização de atendimento
-- ---------------------------------------------------------------------
create or replace function public.generate_service_commissions(p_appointment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; b barbers; r record; v_type text; v_val numeric; v_base numeric;
begin
  select * into a from appointments where id = p_appointment;
  select * into b from barbers where id = a.barber_id;
  if exists (select 1 from commissions where appointment_id = a.id and status <> 'cancelado') then return; end if;
  for r in select aps.*, bs.commission_type bs_type, bs.commission_value bs_val
           from appointment_services aps
           left join barber_services bs on bs.barber_id = a.barber_id and bs.service_id = aps.service_id
           where aps.appointment_id = a.id loop
    v_type := coalesce(r.bs_type, b.commission_type);
    v_val := coalesce(r.bs_val, b.commission_value);
    -- serviço coberto por plano: base é o preço de tabela (trabalho realizado)
    v_base := case when r.covered_by_subscription then r.list_price else r.price end;
    if v_val > 0 then
      insert into commissions (barber_id, appointment_id, source, description, base_amount, rate_type, rate_value, amount)
      values (a.barber_id, a.id, 'servico', r.service_name, v_base, v_type, v_val,
              round(case when v_type = 'percentual' then v_base * v_val / 100 else v_val end, 2));
    end if;
  end loop;
end $$;
revoke execute on function public.generate_service_commissions(uuid) from public, app_user;

create or replace function public.set_appointment_status(p_id uuid, p_status public.appointment_status,
  p_payment_method_id uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a appointments; v_allowed boolean; v_is_barber boolean; v_tx uuid; v_cust customers;
begin
  select * into a from appointments where id = p_id for update;
  if a.id is null then raise exception 'Agendamento não encontrado'; end if;
  v_is_barber := a.barber_id = my_barber_id();
  if not (has_permission('agenda', 'editar') or v_is_barber) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_status in ('cancelado_cliente','cancelado_barbearia') then
    raise exception 'Use a função de cancelamento';
  end if;

  v_allowed := case a.status
    when 'pendente' then p_status in ('confirmado','cliente_chegou','em_atendimento','nao_compareceu')
    when 'confirmado' then p_status in ('cliente_chegou','em_atendimento','nao_compareceu')
    when 'cliente_chegou' then p_status in ('em_atendimento','finalizado','nao_compareceu')
    when 'em_atendimento' then p_status in ('finalizado')
    else false end;
  if not v_allowed then raise exception 'Transição inválida: % → %', a.status, p_status; end if;

  update appointments set status = p_status,
    started_at = case when p_status = 'em_atendimento' then now() else started_at end,
    finished_at = case when p_status = 'finalizado' then now() else finished_at end,
    professional_notes = coalesce(nullif(trim(p_note), ''), professional_notes)
  where id = p_id;

  if p_status = 'finalizado' then
    perform generate_service_commissions(p_id);
    if a.total_price > 0 then
      insert into transactions (kind, category, description, amount, competence_date, appointment_id, barber_id, created_by)
      values ('receita', 'servico', 'Atendimento #' || a.code, a.total_price,
              (now() at time zone 'America/Sao_Paulo')::date, a.id, a.barber_id, app.uid())
      returning id into v_tx;
      if p_payment_method_id is not null then
        insert into payment_transactions (transaction_id, payment_method_id, amount, gateway, registered_by)
        values (v_tx, p_payment_method_id, a.total_price, 'manual', app.uid());
        update transactions set status = 'recebido', settled_at = now(), payment_method_id = p_payment_method_id where id = v_tx;
      end if;
    end if;
    update customers set last_visit_at = now(), visits_count = visits_count + 1 where id = a.customer_id;
    perform validate_referral(a.customer_id);
  elsif p_status = 'nao_compareceu' then
    delete from subscription_usages where appointment_id = p_id;
  elsif p_status = 'confirmado' then
    select * into v_cust from customers where id = a.customer_id;
    perform notify_user(v_cust.profile_id, 'agendamento_confirmado', 'Agendamento confirmado',
      'Seu horário de ' || to_char(a.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || ' está confirmado.', p_id);
  end if;
end $$;

create or replace function public.pay_commissions(p_barber_id uuid, p_until date, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_payout uuid; v_from date;
begin
  perform require_permission('financeiro', 'aprovar');
  select coalesce(sum(amount),0), min(created_at)::date into v_total, v_from from commissions
  where barber_id = p_barber_id and status = 'pendente' and created_at::date <= p_until;
  if v_total = 0 then raise exception 'Não há comissões pendentes no período'; end if;
  insert into payouts (barber_id, amount, period_start, period_end, paid_by, notes)
  values (p_barber_id, v_total, v_from, p_until, app.uid(), p_notes) returning id into v_payout;
  update commissions set status = 'pago', payout_id = v_payout
  where barber_id = p_barber_id and status = 'pendente' and created_at::date <= p_until;
  insert into transactions (kind, category, description, amount, status, settled_at, barber_id, created_by)
  values ('despesa', 'comissao', 'Repasse de comissões — ' || (select display_name from barbers where id = p_barber_id),
          v_total, 'pago', now(), p_barber_id, app.uid());
  return v_payout;
end $$;

-- ---------------------------------------------------------------------
-- Produtos e estoque
-- ---------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 120),
  description text,
  photo_url text,
  sku text unique,
  price numeric(10,2) not null check (price >= 0),
  cost numeric(10,2) check (cost >= 0),
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  track_stock boolean not null default true,
  active boolean not null default true,      -- status de venda
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  kind text not null check (kind in ('entrada','saida','ajuste','venda','estorno')),
  quantity integer not null check (quantity <> 0),  -- positivo entra, negativo sai
  unit_cost numeric(10,2),
  reason text,
  order_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.inventory_movements (product_id, created_at desc);

create or replace function public.apply_inventory_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update products set stock = stock + new.quantity where id = new.product_id;
  return new;
exception when check_violation then
  raise exception 'Estoque insuficiente para %', (select name from products where id = new.product_id);
end $$;
create trigger trg_inventory_apply after insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

create or replace function public.record_inventory(p_product uuid, p_kind text, p_quantity integer, p_reason text default null, p_unit_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('produtos', 'editar');
  if p_kind not in ('entrada','saida','ajuste') then raise exception 'Tipo inválido'; end if;
  if p_kind = 'entrada' and p_quantity <= 0 then raise exception 'Entrada deve ser positiva'; end if;
  if p_kind = 'saida' and p_quantity >= 0 then p_quantity := -abs(p_quantity); end if;
  if p_kind = 'ajuste' and coalesce(nullif(trim(p_reason), ''), '') = '' then raise exception 'Informe o motivo do ajuste'; end if;
  insert into inventory_movements (product_id, kind, quantity, unit_cost, reason, created_by)
  values (p_product, p_kind, p_quantity, p_unit_cost, p_reason, app.uid());
  if p_kind = 'entrada' and p_unit_cost is not null then
    update products set cost = p_unit_cost where id = p_product;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Cupons, pedidos
-- ---------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9\-]{4,30}$'),
  description text,
  discount_type text not null check (discount_type in ('percentual','fixo')),
  value numeric(10,2) not null check (value > 0),
  customer_id uuid references public.customers(id) on delete cascade,  -- nulo = qualquer cliente
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0,
  min_order numeric(10,2) not null default 0,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percentual' or value <= 100)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'aguardando_pagamento' check (status in
    ('aguardando_pagamento','pago','em_separacao','pronto_retirada','enviado','entregue','cancelado')),
  fulfillment text not null default 'retirada' check (fulfillment in ('retirada','entrega')),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0 check (total >= 0),
  coupon_id uuid references public.coupons(id),
  delivery_address jsonb,
  notes text,
  sold_by_barber uuid references public.barbers(id),
  paid_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.orders (customer_id, created_at desc);
create trigger trg_orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null check (quantity > 0)
);
create index on public.order_items (order_id);

alter table public.transactions add constraint transactions_order_fk foreign key (order_id) references public.orders(id);
alter table public.inventory_movements add constraint inventory_order_fk foreign key (order_id) references public.orders(id);
alter table public.commissions add constraint commissions_item_fk foreign key (order_item_id) references public.order_items(id);

create or replace function public.place_order(p_items jsonb, p_fulfillment text default 'retirada',
  p_coupon_code text default null, p_address jsonb default null, p_notes text default null,
  p_customer_id uuid default null, p_sold_by_barber uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s business_settings; v_customer uuid; v_order uuid; it record; p products; c coupons;
        v_sub numeric := 0; v_disc numeric := 0; v_fee numeric := 0; v_plan_disc numeric := 0;
begin
  if app.uid() is null then raise exception 'Faça login para comprar' using errcode = '42501'; end if;
  select * into s from business_settings where id = 1;
  if p_customer_id is not null and p_customer_id is distinct from my_customer_id() then
    perform require_permission('pedidos', 'criar');
    v_customer := p_customer_id;
  else
    v_customer := my_customer_id();
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Carrinho vazio'; end if;
  if p_fulfillment = 'entrega' and not s.delivery_enabled then raise exception 'Entrega indisponível no momento'; end if;
  if p_fulfillment = 'retirada' and not s.pickup_enabled then raise exception 'Retirada indisponível no momento'; end if;
  if p_fulfillment = 'entrega' and (p_address is null or coalesce(p_address->>'logradouro','') = '') then
    raise exception 'Informe o endereço de entrega';
  end if;

  insert into orders (customer_id, fulfillment, delivery_address, notes, created_by, sold_by_barber)
  values (v_customer, p_fulfillment, case when p_fulfillment = 'entrega' then p_address end,
          nullif(trim(p_notes), ''), app.uid(), p_sold_by_barber)
  returning id into v_order;

  for it in select (e->>'product_id')::uuid product_id, (e->>'quantity')::int quantity from jsonb_array_elements(p_items) e loop
    select * into p from products where id = it.product_id and active;
    if p.id is null then raise exception 'Produto indisponível'; end if;
    if it.quantity is null or it.quantity <= 0 or it.quantity > 50 then raise exception 'Quantidade inválida'; end if;
    if p.track_stock and p.stock < it.quantity then
      raise exception 'Estoque insuficiente de % (disponível: %)', p.name, p.stock;
    end if;
    insert into order_items (order_id, product_id, product_name, unit_price, quantity)
    values (v_order, p.id, p.name, p.price, it.quantity);
    v_sub := v_sub + p.price * it.quantity;
  end loop;

  -- desconto do plano ativo em produtos
  select coalesce(max(pl.product_discount_percent), 0) into v_plan_disc
  from subscriptions su join plans pl on pl.id = su.plan_id
  where su.customer_id = v_customer and su.status = 'ativa' and now() < su.current_period_end;
  v_disc := round(v_sub * v_plan_disc / 100, 2);

  if nullif(trim(p_coupon_code), '') is not null then
    select * into c from coupons where code = upper(trim(p_coupon_code)) for update;
    if c.id is null or not c.active or (c.valid_until is not null and c.valid_until < now())
       or (c.max_uses is not null and c.used_count >= c.max_uses)
       or (c.customer_id is not null and c.customer_id <> v_customer) then
      raise exception 'Cupom inválido ou expirado';
    end if;
    if v_sub < c.min_order then raise exception 'Pedido mínimo para este cupom: R$ %', c.min_order; end if;
    v_disc := v_disc + case when c.discount_type = 'percentual' then round((v_sub - v_disc) * c.value / 100, 2) else c.value end;
    update coupons set used_count = used_count + 1 where id = c.id;
  end if;

  v_fee := case when p_fulfillment = 'entrega' then s.delivery_fee else 0 end;
  update orders set subtotal = v_sub, discount = least(v_disc, v_sub), delivery_fee = v_fee,
    total = greatest(v_sub - v_disc, 0) + v_fee, coupon_id = c.id
  where id = v_order;

  insert into transactions (kind, category, description, amount, order_id, created_by)
  select 'receita', 'produto', 'Pedido #' || code, total, id, app.uid() from orders where id = v_order;

  perform notify_user((select profile_id from customers where id = v_customer), 'pedido_realizado',
    'Pedido recebido', 'Pedido #' || (select code from orders where id = v_order) || ' registrado. Pagamento na retirada ou conforme combinado.', v_order);
  return v_order;
end $$;

create or replace function public.update_order_status(p_order uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; it record;
begin
  perform require_permission('pedidos', 'editar');
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'Pedido não encontrado'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p_status = 'pago' then raise exception 'Use o registro de pagamento'; end if;
  if p_status = 'cancelado' then
    if o.status <> 'aguardando_pagamento' then
      -- devolve estoque de pedido já pago
      for it in select * from order_items where order_id = o.id loop
        insert into inventory_movements (product_id, kind, quantity, reason, order_id, created_by)
        select it.product_id, 'estorno', it.quantity, 'Cancelamento do pedido #' || o.code, o.id, app.uid()
        from products where id = it.product_id and track_stock;
      end loop;
      update commissions set status = 'cancelado' where order_item_id in (select id from order_items where order_id = o.id) and status = 'pendente';
    end if;
    update transactions set status = 'cancelado' where order_id = o.id and status = 'pendente';
    if o.coupon_id is not null then update coupons set used_count = greatest(used_count - 1, 0) where id = o.coupon_id; end if;
  elsif o.status = 'aguardando_pagamento' then
    raise exception 'Registre o pagamento antes de avançar o pedido';
  end if;
  update orders set status = p_status where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Planos e assinaturas
-- ---------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  period_months integer not null default 1 check (period_months in (1,3,6,12)),
  product_discount_percent numeric(5,2) not null default 0 check (product_discount_percent between 0 and 100),
  usage_rules text,
  contract_conditions text,
  max_active_subscriptions integer check (max_active_subscriptions is null or max_active_subscriptions > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

create table public.plan_benefits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  service_id uuid references public.services(id) on delete restrict,  -- nulo = benefício descritivo
  quantity_per_period integer check (quantity_per_period is null or quantity_per_period > 0), -- nulo = ilimitado
  description text not null
);
create index on public.plan_benefits (plan_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'pendente' check (status in ('pendente','ativa','suspensa','inadimplente','cancelada','expirada')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  auto_renew boolean not null default true,
  gateway text,
  gateway_subscription_id text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.subscriptions (customer_id);
create unique index one_open_subscription_per_plan on public.subscriptions (customer_id, plan_id)
  where status in ('pendente','ativa','suspensa','inadimplente');
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

create table public.subscription_usages (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  service_id uuid not null references public.services(id),
  appointment_id uuid references public.appointments(id) on delete cascade,
  period_start timestamptz not null,
  used_at timestamptz not null default now()
);
create index on public.subscription_usages (subscription_id, service_id, period_start);

alter table public.appointments add constraint appointments_subscription_fk foreign key (subscription_id) references public.subscriptions(id);
alter table public.transactions add constraint transactions_subscription_fk foreign key (subscription_id) references public.subscriptions(id);

create or replace function public.consume_subscription_benefit(p_sub uuid, p_service uuid, p_appointment uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare su subscriptions; b plan_benefits; v_used int;
begin
  select * into su from subscriptions where id = p_sub for update;
  if su.status <> 'ativa' or now() >= su.current_period_end then return false; end if;
  select * into b from plan_benefits where plan_id = su.plan_id and service_id = p_service limit 1;
  if b.id is null then return false; end if;
  select count(*) into v_used from subscription_usages where subscription_id = su.id and service_id = p_service and period_start = su.current_period_start;
  if b.quantity_per_period is not null and v_used >= b.quantity_per_period then return false; end if;
  insert into subscription_usages (subscription_id, service_id, appointment_id, period_start) values (su.id, p_service, p_appointment, su.current_period_start);
  return true;
end $$;
revoke execute on function public.consume_subscription_benefit(uuid, uuid, uuid) from public, app_user;

create or replace function public.subscribe_plan(p_plan uuid, p_customer_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl plans; v_customer uuid; v_sub uuid; v_count int;
begin
  if app.uid() is null then raise exception 'Faça login para assinar' using errcode = '42501'; end if;
  if p_customer_id is not null and p_customer_id is distinct from my_customer_id() then
    perform require_permission('planos', 'criar'); v_customer := p_customer_id;
  else v_customer := my_customer_id(); end if;
  select * into pl from plans where id = p_plan and active;
  if pl.id is null then raise exception 'Plano indisponível'; end if;
  if pl.max_active_subscriptions is not null then
    select count(*) into v_count from subscriptions where plan_id = pl.id and status in ('ativa','pendente');
    if v_count >= pl.max_active_subscriptions then raise exception 'Vagas esgotadas para este plano'; end if;
  end if;
  begin
    insert into subscriptions (customer_id, plan_id) values (v_customer, pl.id) returning id into v_sub;
  exception when unique_violation then
    raise exception 'Você já possui este plano (ativo ou aguardando pagamento)';
  end;
  insert into transactions (kind, category, description, amount, subscription_id, due_date, created_by)
  values ('receita', 'plano', 'Assinatura ' || pl.name, pl.price, v_sub, current_date, app.uid());
  return v_sub;
end $$;

create or replace function public.set_subscription_status(p_sub uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare su subscriptions;
begin
  select * into su from subscriptions where id = p_sub for update;
  if su.id is null then raise exception 'Assinatura não encontrada'; end if;
  if su.customer_id = my_customer_id() and p_status = 'cancelada' and not has_permission('planos','editar') then
    -- cliente: cancela a renovação; benefícios valem até o fim do período pago
    update subscriptions set auto_renew = false, cancelled_at = now(),
      status = case when status = 'pendente' then 'cancelada' else status end where id = p_sub;
    update transactions set status = 'cancelado' where subscription_id = p_sub and status = 'pendente';
    return;
  end if;
  perform require_permission('planos', 'editar');
  if p_status not in ('ativa','suspensa','cancelada') then raise exception 'Status inválido'; end if;
  if p_status = 'ativa' and su.status not in ('suspensa') then raise exception 'Reative apenas assinaturas suspensas; ativações ocorrem pelo pagamento'; end if;
  update subscriptions set status = p_status, cancelled_at = case when p_status = 'cancelada' then now() end,
    auto_renew = case when p_status = 'cancelada' then false else auto_renew end where id = p_sub;
  if p_status = 'cancelada' then update transactions set status = 'cancelado' where subscription_id = p_sub and status = 'pendente'; end if;
end $$;

-- Rotina diária (agendar com pg_cron / Edge Function): vencimentos e renovações
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
  -- aviso de vencimento próximo (3 dias)
  insert into notification_logs (user_id, event, channel, title, body, related_id)
  select c.profile_id, 'plano_vencendo', 'interno', 'Seu plano vence em breve',
         'Seu plano vence em ' || to_char(s.current_period_end at time zone 'America/Sao_Paulo', 'DD/MM') || '.', s.id
  from subscriptions s join customers c on c.id = s.customer_id
  where s.status = 'ativa' and s.current_period_end between now() and now() + interval '3 days'
    and not exists (select 1 from notification_logs n where n.related_id = s.id and n.event = 'plano_vencendo' and n.created_at > now() - interval '3 days');
  return n;
end $$;
revoke execute on function public.process_subscription_renewals() from public, app_user;

-- ---------------------------------------------------------------------
-- Afiliados / MR.LUDER CLUB
-- ---------------------------------------------------------------------
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  status text not null default 'ativo' check (status in ('ativo','suspenso')),
  created_at timestamptz not null default now()
);

create table public.referral_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,20}$'),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.customers add constraint customers_referred_by_fk foreign key (referred_by_affiliate) references public.affiliates(id);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referred_customer_id uuid not null unique references public.customers(id) on delete cascade,
  code text not null,
  status text not null default 'pendente' check (status in ('pendente','validada','rejeitada','expirada')),
  reject_reason text,
  expires_at timestamptz not null,
  validated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.referrals (affiliate_id, status);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referral_id uuid references public.referrals(id),
  kind text not null,
  description text not null,
  value numeric(10,2) not null default 0,
  coupon_id uuid references public.coupons(id),
  status text not null default 'disponivel' check (status in ('disponivel','resgatado','expirado','cancelado')),
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.become_affiliate() returns text
language plpgsql security definer set search_path = public as $$
declare v_customer uuid := my_customer_id(); v_aff uuid; v_code text; v_name text;
begin
  if v_customer is null then raise exception 'Faça login' using errcode = '42501'; end if;
  if not (select referral_enabled from business_settings where id = 1) then raise exception 'Programa de indicação desativado'; end if;
  select id into v_aff from affiliates where customer_id = v_customer;
  if v_aff is not null then
    select code into v_code from referral_codes where affiliate_id = v_aff and active limit 1;
    return v_code;
  end if;
  insert into affiliates (customer_id) values (v_customer) returning id into v_aff;
  select upper(regexp_replace(unaccent_basic(split_part(full_name, ' ', 1)), '[^A-Za-z]', '', 'g')) into v_name from customers where id = v_customer;
  loop
    v_code := left(coalesce(nullif(v_name, ''), 'LUDER'), 8) || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from referral_codes where code = v_code);
  end loop;
  insert into referral_codes (code, affiliate_id) values (v_code, v_aff);
  insert into user_roles (user_id, role_id) select app.uid(), id from roles where key = 'afiliado' on conflict do nothing;
  return v_code;
end $$;

create or replace function public.unaccent_basic(p text) returns text language sql immutable as $$
  select translate(p, 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')
$$;

-- Registra a indicação no cadastro (código informado no link) com regras antifraude
create or replace function app.apply_referral(p_profile uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(nullif(trim(p_code), ''));
        rc referral_codes; af affiliates; ac customers; nc customers; s business_settings; v_status text := 'pendente'; v_reason text;
begin
  if v_code is null then return; end if;
  select * into s from business_settings where id = 1;
  if not s.referral_enabled then return; end if;
  select * into rc from referral_codes where code = v_code and active;
  if rc.code is null then return; end if;
  select * into af from affiliates where id = rc.affiliate_id;
  select * into ac from customers where id = af.customer_id;
  select * into nc from customers where profile_id = p_profile;
  if nc.id is null or nc.id = ac.id then return; end if;
  if exists (select 1 from referrals where referred_customer_id = nc.id) then return; end if;
  if exists (select 1 from appointments where customer_id = nc.id) or exists (select 1 from orders where customer_id = nc.id) then
    v_status := 'rejeitada'; v_reason := 'Cliente já possuía histórico na barbearia';
  elsif af.status <> 'ativo' then
    v_status := 'rejeitada'; v_reason := 'Afiliado suspenso';
  elsif lower(ac.email) = lower(nc.email)
     or (ac.phone is not null and regexp_replace(ac.phone, '\D', '', 'g') = regexp_replace(coalesce(nc.phone, ''), '\D', '', 'g')) then
    v_status := 'rejeitada'; v_reason := 'Possível autoindicação (dados de contato coincidentes)';
  end if;
  insert into referrals (affiliate_id, referred_customer_id, code, status, reject_reason, expires_at)
  values (af.id, nc.id, rc.code, v_status, v_reason, now() + make_interval(days => s.referral_validation_days));
  if v_status = 'pendente' then update customers set referred_by_affiliate = af.id where id = nc.id; end if;
end $$;

-- Valida indicação na primeira compra paga ou atendimento finalizado
create or replace function public.validate_referral(p_customer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r referrals; s business_settings; v_valid int; v_rewards int; v_coupon uuid; v_aff_customer customers; v_desc text;
begin
  select * into r from referrals where referred_customer_id = p_customer and status = 'pendente' for update;
  if r.id is null then return; end if;
  if r.expires_at < now() then update referrals set status = 'expirada' where id = r.id; return; end if;
  select * into s from business_settings where id = 1;
  update referrals set status = 'validada', validated_at = now() where id = r.id;

  select count(*) into v_valid from referrals where affiliate_id = r.affiliate_id and status = 'validada';
  select count(*) into v_rewards from rewards where affiliate_id = r.affiliate_id and status <> 'cancelado';
  if v_valid < s.referral_min_referrals or (v_valid - v_rewards * s.referral_min_referrals) < s.referral_min_referrals then return; end if;
  if s.referral_max_rewards is not null and v_rewards >= s.referral_max_rewards then return; end if;
  if s.referral_reward_value <= 0 and s.referral_reward_kind in ('desconto_percentual','desconto_fixo','credito') then return; end if;

  select c.* into v_aff_customer from customers c join affiliates a on a.customer_id = c.id where a.id = r.affiliate_id;
  v_desc := coalesce(s.referral_reward_description, case s.referral_reward_kind
    when 'desconto_percentual' then s.referral_reward_value || '% de desconto'
    when 'desconto_fixo' then 'R$ ' || s.referral_reward_value || ' de desconto'
    when 'credito' then 'R$ ' || s.referral_reward_value || ' em crédito'
    else 'Benefício por indicação' end);
  if s.referral_reward_kind in ('desconto_percentual','desconto_fixo') then
    insert into coupons (code, description, discount_type, value, customer_id, max_uses, valid_until)
    values ('CLUB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'MR.LUDER CLUB — ' || v_desc,
            case when s.referral_reward_kind = 'desconto_percentual' then 'percentual' else 'fixo' end,
            s.referral_reward_value, v_aff_customer.id, 1, now() + make_interval(days => s.referral_reward_validity_days))
    returning id into v_coupon;
  end if;
  insert into rewards (affiliate_id, referral_id, kind, description, value, coupon_id, expires_at)
  values (r.affiliate_id, r.id, s.referral_reward_kind, v_desc, s.referral_reward_value, v_coupon,
          now() + make_interval(days => s.referral_reward_validity_days));
  perform notify_user(v_aff_customer.profile_id, 'recompensa_recebida', 'Você ganhou uma recompensa!',
    'Sua indicação foi validada: ' || v_desc || '.', r.id);
end $$;
revoke execute on function public.validate_referral(uuid) from public, app_user;

-- ---------------------------------------------------------------------
-- Efeitos de quitação: pedido pago (baixa de estoque), plano ativado
-- ---------------------------------------------------------------------
create or replace function public.on_transaction_settled(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t transactions; o orders; it record; su subscriptions; pl plans; b barbers;
begin
  select * into t from transactions where id = p_tx;
  if t.order_id is not null then
    select * into o from orders where id = t.order_id for update;
    if o.status = 'aguardando_pagamento' then
      for it in select oi.* from order_items oi join products p on p.id = oi.product_id where oi.order_id = o.id and p.track_stock loop
        insert into inventory_movements (product_id, kind, quantity, reason, order_id, created_by)
        values (it.product_id, 'venda', -it.quantity, 'Pedido #' || o.code, o.id, app.uid());
      end loop;
      update orders set status = case when fulfillment = 'retirada' then 'pronto_retirada' else 'pago' end, paid_at = now() where id = o.id;
      if o.sold_by_barber is not null then
        select * into b from barbers where id = o.sold_by_barber;
        if b.product_commission_percent > 0 then
          insert into commissions (barber_id, order_item_id, source, description, base_amount, rate_type, rate_value, amount)
          select b.id, oi.id, 'produto', oi.product_name, oi.unit_price * oi.quantity, 'percentual', b.product_commission_percent,
                 round(oi.unit_price * oi.quantity * b.product_commission_percent / 100, 2)
          from order_items oi where oi.order_id = o.id;
        end if;
      end if;
      perform validate_referral(o.customer_id);
      perform notify_user((select profile_id from customers where id = o.customer_id), 'pagamento_aprovado',
        'Pagamento confirmado', 'Pedido #' || o.code || ' pago.', o.id);
    end if;
  elsif t.subscription_id is not null then
    select * into su from subscriptions where id = t.subscription_id for update;
    select * into pl from plans where id = su.plan_id;
    update subscriptions set status = 'ativa',
      current_period_start = case when su.current_period_end is not null and su.current_period_end > now() - interval '15 days'
                                  then su.current_period_end else now() end,
      current_period_end = case when su.current_period_end is not null and su.current_period_end > now() - interval '15 days'
                                then su.current_period_end else now() end + make_interval(months => pl.period_months)
    where id = su.id;
    perform validate_referral(su.customer_id);
    perform notify_user((select profile_id from customers where id = su.customer_id), 'pagamento_aprovado',
      'Plano ativo', 'Seu plano ' || pl.name || ' está ativo.', su.id);
  end if;
end $$;
revoke execute on function public.on_transaction_settled(uuid) from public, app_user;

-- ---------------------------------------------------------------------
-- Fechamento de caixa
-- ---------------------------------------------------------------------
create or replace function public.financial_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_permission('financeiro', 'visualizar');
  return (
    select jsonb_build_object(
      'faturado', coalesce(sum(amount) filter (where kind = 'receita' and status <> 'cancelado'), 0),
      'recebido', coalesce(sum(amount) filter (where kind = 'receita' and status = 'recebido'), 0),
      'a_receber', coalesce(sum(amount) filter (where kind = 'receita' and status = 'pendente'), 0),
      'despesas_pagas', coalesce(sum(amount) filter (where kind = 'despesa' and status = 'pago'), 0),
      'a_pagar', coalesce(sum(amount) filter (where kind = 'despesa' and status = 'pendente'), 0),
      'por_categoria', coalesce((select jsonb_object_agg(category, total) from (
          select category, sum(amount) total from transactions
          where competence_date between p_from and p_to and status <> 'cancelado' and kind = 'receita' group by category) x), '{}'),
      'por_forma_pagamento', coalesce((select jsonb_object_agg(coalesce(pm.name, 'Não informado'), total) from (
          select pt.payment_method_id, sum(pt.amount) total from payment_transactions pt
          where pt.status = 'aprovado' and (pt.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to group by 1) x
          left join payment_methods pm on pm.id = x.payment_method_id), '{}')
    ) from transactions where competence_date between p_from and p_to
  );
end $$;

create or replace function public.close_cash(p_type text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_from date; v_to date; v_id uuid;
begin
  perform require_permission('financeiro', 'aprovar');
  if p_type = 'diario' then v_from := p_date; v_to := p_date;
  elsif p_type = 'mensal' then v_from := date_trunc('month', p_date)::date; v_to := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  else raise exception 'Tipo inválido'; end if;
  insert into cash_closings (period_type, period_start, period_end, totals, closed_by)
  values (p_type, v_from, v_to, financial_summary(v_from, v_to), app.uid())
  on conflict (period_type, period_start) do update set totals = excluded.totals, closed_by = excluded.closed_by, closed_at = now()
  returning id into v_id;
  return v_id;
end $$;
