-- =====================================================================
-- 0010: pagamentos online pelo Asaas (planos recorrentes e pedidos da loja)
-- O cartão é digitado na fatura do Asaas; o banco guarda só os identificadores.
-- O CPF do pagador vai direto ao Asaas e NÃO é armazenado aqui (minimização, LGPD).
-- =====================================================================

alter table public.customers add column if not exists gateway_customer_id text;
alter table public.transactions
  add column if not exists gateway_payment_id text,
  add column if not exists gateway_invoice_url text;
create unique index if not exists subscriptions_gateway_sub_uq
  on public.subscriptions (gateway, gateway_subscription_id) where gateway_subscription_id is not null;
create unique index if not exists transactions_gateway_payment_uq
  on public.transactions (gateway_payment_id) where gateway_payment_id is not null;

-- Pagamento de uma cobrança gerada por assinatura no gateway (mensalidade).
-- Usa o lançamento pendente da assinatura (contratação ou renovação) ou cria um, e confirma
-- pelo mesmo caminho idempotente dos demais pagamentos (gateway_confirm_payment).
create or replace function public.gateway_confirm_subscription_payment(p_gateway text, p_gateway_subscription text, p_payment_id text, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare su subscriptions; pl plans; v_t uuid;
begin
  select * into su from subscriptions where gateway = p_gateway and gateway_subscription_id = p_gateway_subscription for update;
  if su.id is null then return 'assinatura_desconhecida'; end if;
  if exists (select 1 from payment_transactions where gateway = p_gateway and gateway_reference = p_payment_id and status = 'aprovado') then
    return 'duplicado';
  end if;
  select id into v_t from transactions where subscription_id = su.id and status = 'pendente' order by created_at limit 1 for update;
  if v_t is null then
    select * into pl from plans where id = su.plan_id;
    insert into transactions (kind, category, description, amount, subscription_id, due_date)
    values ('receita', 'plano', 'Renovação ' || pl.name, p_amount, su.id, current_date) returning id into v_t;
  end if;
  update transactions set gateway_payment_id = coalesce(gateway_payment_id, p_payment_id) where id = v_t;
  return gateway_confirm_payment(v_t, p_gateway, p_payment_id, p_amount);
end $$;
revoke execute on function public.gateway_confirm_subscription_payment(text, text, text, numeric) from public, app_user;

-- Mensalidade vencida no gateway: plano fica "inadimplente" (benefícios suspensos) até o pagamento.
create or replace function public.gateway_subscription_overdue(p_gateway text, p_gateway_subscription text)
returns text language plpgsql security definer set search_path = public as $$
begin
  update subscriptions set status = 'inadimplente'
  where gateway = p_gateway and gateway_subscription_id = p_gateway_subscription and status = 'ativa'
    and (current_period_end is null or current_period_end <= now());
  return case when found then 'ok' else 'ignorado' end;
end $$;
revoke execute on function public.gateway_subscription_overdue(text, text) from public, app_user;

-- Assinatura removida/inativada no painel do gateway: encerra a renovação aqui também.
create or replace function public.gateway_subscription_ended(p_gateway text, p_gateway_subscription text)
returns text language plpgsql security definer set search_path = public as $$
begin
  update subscriptions set auto_renew = false,
    status = case when status = 'ativa' and current_period_end > now() then 'ativa' else 'cancelada' end,
    cancelled_at = coalesce(cancelled_at, now())
  where gateway = p_gateway and gateway_subscription_id = p_gateway_subscription and status in ('ativa','pendente','inadimplente','suspensa');
  return case when found then 'ok' else 'ignorado' end;
end $$;
revoke execute on function public.gateway_subscription_ended(text, text) from public, app_user;
