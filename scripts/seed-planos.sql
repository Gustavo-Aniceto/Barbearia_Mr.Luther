-- Planos mensais da MR.LUDER (informados pelo proprietário em 11/11/2026).
-- Idempotente: só cria o que ainda não existe (pelo nome). Editáveis depois em Gestão → Planos.
with novos(name, price, wd, service_name, benefit, descr, sort_order) as (values
  ('Plano Corte · seg a qui', 112.00, array[1,2,3,4]::smallint[], 'Corte', '4 cortes por mês (1 por semana)',
   '4 cortes por mês, 1 por semana, de segunda a quinta.', 1),
  ('Plano Corte · todos os dias', 135.00, null::smallint[], 'Corte', '4 cortes por mês (1 por semana)',
   '4 cortes por mês, 1 por semana, em qualquer dia de funcionamento.', 2),
  ('Plano Corte e Barba · seg a qui', 130.00, array[1,2,3,4]::smallint[], 'Combo', '4 cortes com barba por mês (1 por semana)',
   '4 atendimentos de corte e barba por mês, 1 por semana, de segunda a quinta.', 3),
  ('Plano Corte e Barba · todos os dias', 150.00, null::smallint[], 'Combo', '4 cortes com barba por mês (1 por semana)',
   '4 atendimentos de corte e barba por mês, 1 por semana, em qualquer dia de funcionamento.', 4)
), ins as (
  insert into public.plans (name, description, price, period_months, allowed_weekdays, max_per_week, usage_rules, active, sort_order)
  select n.name, n.descr, n.price, 1, n.wd, 1,
    'Vale ' || app.weekdays_label(n.wd) || ', no máximo 1 atendimento por semana (segunda a domingo). '
      || 'Você pode pedir um horário fixo pela sua conta: depois que o barbeiro aprovar, as datas do mês ficam reservadas para você.',
    true, n.sort_order
  from novos n where not exists (select 1 from public.plans p where p.name = n.name)
  returning id, name
)
insert into public.plan_benefits (plan_id, service_id, quantity_per_period, description)
select i.id, s.id, 4, n.benefit
from ins i join novos n on n.name = i.name
join lateral (select id from public.services where name = n.service_name and active order by created_at limit 1) s on true;
