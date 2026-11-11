-- =====================================================================
-- 0011: "Meus ganhos" do barbeiro — quanto tem a receber, de onde vem e o que já foi repassado.
-- Só devolve dados do próprio barbeiro (my_barber_id); o financeiro da barbearia continua restrito.
-- =====================================================================
create or replace function public.my_earnings(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := my_barber_id(); tz text := 'America/Sao_Paulo'; b barbers;
begin
  if v_b is null then raise exception 'Acesso restrito a profissionais' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 370 then raise exception 'Período inválido (máximo de 1 ano)'; end if;
  select * into b from barbers where id = v_b;
  return jsonb_build_object(
    'regra', jsonb_build_object('tipo', b.commission_type, 'valor', b.commission_value, 'produto_percentual', b.product_commission_percent,
      'definida', (b.commission_value > 0 or b.product_commission_percent > 0
                   or exists (select 1 from barber_services bs where bs.barber_id = v_b and coalesce(bs.commission_value, 0) > 0))),
    -- tudo o que ainda não foi repassado, independente do período
    'a_receber', jsonb_build_object(
      'total', (select coalesce(sum(amount), 0) from commissions where barber_id = v_b and status = 'pendente'),
      'servicos', (select coalesce(sum(amount), 0) from commissions where barber_id = v_b and status = 'pendente' and source = 'servico'),
      'produtos', (select coalesce(sum(amount), 0) from commissions where barber_id = v_b and status = 'pendente' and source = 'produto'),
      'desde', (select min(created_at) from commissions where barber_id = v_b and status = 'pendente')),
    'periodo', jsonb_build_object(
      'atendimentos', (select count(*) from appointments where barber_id = v_b and status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
      'faltas', (select count(*) from appointments where barber_id = v_b and status = 'nao_compareceu' and (starts_at at time zone tz)::date between p_from and p_to),
      'valor_servicos', (select coalesce(sum(total_price), 0) from appointments where barber_id = v_b and status = 'finalizado' and (starts_at at time zone tz)::date between p_from and p_to),
      'comissao_servicos', (select coalesce(sum(amount), 0) from commissions where barber_id = v_b and status <> 'cancelado' and source = 'servico' and (created_at at time zone tz)::date between p_from and p_to),
      'comissao_produtos', (select coalesce(sum(amount), 0) from commissions where barber_id = v_b and status <> 'cancelado' and source = 'produto' and (created_at at time zone tz)::date between p_from and p_to),
      'recebido', (select coalesce(sum(amount), 0) from payouts where barber_id = v_b and (paid_at at time zone tz)::date between p_from and p_to)),
    'top_servicos', (select coalesce(jsonb_agg(x order by x.qtd desc, x.valor desc), '[]') from (
        select s.service_name nome, count(*) qtd, sum(s.price) valor
        from appointment_services s join appointments a on a.id = s.appointment_id
        where a.barber_id = v_b and a.status = 'finalizado' and (a.starts_at at time zone tz)::date between p_from and p_to
        group by s.service_name order by count(*) desc, sum(s.price) desc limit 5) x),
    'lancamentos', (select coalesce(jsonb_agg(x order by x.data desc), '[]') from (
        select c.id, c.created_at data, c.source origem, c.description descricao, c.base_amount base, c.rate_type tipo, c.rate_value taxa,
               c.amount valor, c.status, a.starts_at atendimento_em,
               split_part(coalesce(cu.full_name, ''), ' ', 1) cliente,
               (select string_agg(s.service_name, ', ') from appointment_services s where s.appointment_id = a.id) servicos
        from commissions c left join appointments a on a.id = c.appointment_id left join customers cu on cu.id = a.customer_id
        where c.barber_id = v_b and c.status <> 'cancelado' and (c.created_at at time zone tz)::date between p_from and p_to
        order by c.created_at desc limit 300) x),
    'repasses', (select coalesce(jsonb_agg(x order by x.pago_em desc), '[]') from (
        select p.paid_at pago_em, p.amount valor, p.period_start inicio, p.period_end fim, p.notes obs,
               (select count(*) from commissions c where c.payout_id = p.id) itens
        from payouts p where p.barber_id = v_b order by p.paid_at desc limit 12) x)
  );
end $$;
revoke execute on function public.my_earnings(date, date) from public;
grant execute on function public.my_earnings(date, date) to app_user;
