-- =====================================================================
-- Testes de regras de negócio e segurança (executar em banco recém-criado)
-- Dados exclusivamente fictícios de teste (@teste.local). Nenhum dado real.
-- Uso: scripts/test-db.sh
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

create schema test;
grant usage on schema test to app_user;
create table test.ctx (k text primary key, v uuid);
grant select, insert on test.ctx to app_user;

create function test.login(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  if p_email is null then perform set_config('app.profile_id', '', false); return; end if;
  select id into v from public.profiles where email = p_email;
  if v is null then raise exception 'usuário de teste % inexistente', p_email; end if;
  perform set_config('app.profile_id', v::text, false);
end $$;
create function test.id(p_key text) returns uuid language sql stable as $$ select v from test.ctx where k = p_key $$;
create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHOU: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
create function test.throws(p_sql text, p_pattern text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'ok - %', p_msg; return; end if;
    raise exception 'FALHOU: % (erro inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALHOU: % (nenhum erro lançado)', p_msg;
end $$;
grant execute on all functions in schema test to app_user;
set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Usuários de teste (cadastro passa pelos triggers reais)
-- ---------------------------------------------------------------------
select app.ensure_profile('auth-dono@teste.local', 'dono@teste.local', null, '{"full_name":"Dono Teste","accepted_terms":true}'::jsonb);
select app.ensure_profile('auth-gerente@teste.local', 'gerente@teste.local', null, '{"full_name":"Gerente Teste","accepted_terms":true}'::jsonb);
select app.ensure_profile('auth-recepcao@teste.local', 'recepcao@teste.local', null, '{"full_name":"Recepção Teste","accepted_terms":true}'::jsonb);
select app.ensure_profile('auth-barbeiro1@teste.local', 'barbeiro1@teste.local', null, '{"full_name":"Barbeiro Um","accepted_terms":true}'::jsonb);
select app.ensure_profile('auth-barbeiro2@teste.local', 'barbeiro2@teste.local', null, '{"full_name":"Barbeiro Dois","accepted_terms":true}'::jsonb);
select app.ensure_profile('auth-cliente1@teste.local', 'cliente1@teste.local', null, '{"full_name":"Cliente Um","phone":"(11) 90000-0001","accepted_terms":true,"marketing_email":true}'::jsonb);
select app.ensure_profile('auth-cliente2@teste.local', 'cliente2@teste.local', null, '{"full_name":"Cliente Dois","phone":"(11) 90000-0002","accepted_terms":true}'::jsonb);

select public.bootstrap_owner('dono@teste.local');
select test.throws($$select public.bootstrap_owner('gerente@teste.local')$$, 'Já existe um proprietário', 'bootstrap só funciona uma vez');
select test.ok((select count(*) from consent_records c join profiles p on p.id = c.user_id where p.email = 'cliente1@teste.local' and purpose = 'marketing_email' and granted) = 1,
  'consentimento de marketing registrado somente quando marcado');
select test.ok((select count(*) from consent_records c join profiles p on p.id = c.user_id where p.email = 'cliente2@teste.local' and purpose = 'marketing_email' and not granted) = 1,
  'marketing não marcado fica registrado como não concedido');

-- ---------------------------------------------------------------------
-- Proprietário configura a operação (pelas mesmas permissões da aplicação)
-- ---------------------------------------------------------------------
select test.login('dono@teste.local');
set role app_user;

update business_hours set is_open = true, opens_at = '08:00', closes_at = '20:00';
update business_settings set min_advance_minutes = 60, cancel_min_hours = 2, slot_step_minutes = 15, default_buffer_minutes = 0;
select assign_role((select id from profiles where email = 'gerente@teste.local'), 'gerente');
select assign_role((select id from profiles where email = 'recepcao@teste.local'), 'recepcionista');
select assign_role((select id from profiles where email = 'barbeiro1@teste.local'), 'barbeiro');
select assign_role((select id from profiles where email = 'barbeiro2@teste.local'), 'barbeiro');

with x as (insert into services (name, price, duration_minutes) values ('Serviço Teste A', 60, 30) returning id) insert into test.ctx select 'svc_corte', id from x;
with x as (insert into services (name, price, duration_minutes, extra_buffer_minutes) values ('Serviço Teste B', 40, 20, 10) returning id) insert into test.ctx select 'svc_barba', id from x;
with x as (insert into barbers (profile_id, display_name, commission_type, commission_value)
  values ((select id from profiles where email = 'barbeiro1@teste.local'), 'Barbeiro Um', 'percentual', 40) returning id) insert into test.ctx select 'b1', id from x;
with x as (insert into barbers (profile_id, display_name, commission_type, commission_value)
  values ((select id from profiles where email = 'barbeiro2@teste.local'), 'Barbeiro Dois', 'fixo', 15) returning id) insert into test.ctx select 'b2', id from x;
insert into barber_services (barber_id, service_id) values
  (test.id('b1'), test.id('svc_corte')), (test.id('b1'), test.id('svc_barba')), (test.id('b2'), test.id('svc_corte'));
-- comissão específica por serviço (sobrepõe a do barbeiro)
update barber_services set commission_type = 'fixo', commission_value = 10 where barber_id = test.id('b1') and service_id = test.id('svc_barba');

insert into test.ctx values ('d1', null);  -- marcador
reset role;
insert into test.ctx select 'pix', id from payment_methods where name = 'Pix';
insert into test.ctx select 'c1', id from customers where email = 'cliente1@teste.local';
insert into test.ctx select 'c2', id from customers where email = 'cliente2@teste.local';

-- horário de referência: amanhã às 10:00 (São Paulo)
create function test.at(p_hhmm text, p_days int default 1) returns timestamptz language sql stable as $$
  select ((now() at time zone 'America/Sao_Paulo')::date + p_days + p_hhmm::time) at time zone 'America/Sao_Paulo'
$$;
grant execute on function test.at(text, int) to app_user;

-- ---------------------------------------------------------------------
-- 7/8. Agendamento e bloqueio de conflitos
-- ---------------------------------------------------------------------
select test.login(null);
set role app_user;
select test.ok((select count(*) from get_available_slots(((now() at time zone 'America/Sao_Paulo')::date + 1), array[test.id('svc_corte')])) > 0,
  'visitante consulta horários livres');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('10:00'), test.id('b1'))$$, 'login', 'visitante não agenda sem login');
select test.ok((select count(*) from customers) = 0, 'visitante não lê clientes (RLS)');
reset role;

select test.login('cliente1@teste.local');
set role app_user;
insert into test.ctx select 'a1', book_appointment(array[test.id('svc_corte'), test.id('svc_barba')], test.at('10:00'), test.id('b1'), 'Teste');
select test.ok((select total_price from appointments where id = test.id('a1')) = 100, 'preço total soma os serviços');
select test.ok((select blocked_until - starts_at from appointments where id = test.id('a1')) = interval '60 minutes',
  'duração 50min + intervalo 10min bloqueia 60min');
select test.ok((select status from appointments where id = test.id('a1')) = 'pendente', 'agendamento online nasce pendente');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('10:30'), test.id('b1'))$$, 'indispon', 'não permite sobreposição no mesmo barbeiro');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('10:45'), test.id('b1'))$$, 'indispon', 'respeita o intervalo entre atendimentos');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('19:45'), test.id('b1'))$$, 'indispon', 'não ultrapassa o horário de fechamento');
select test.throws($$select book_appointment(array[test.id('svc_corte')], now() + interval '10 minutes', test.id('b1'))$$, 'indispon', 'respeita antecedência mínima');
select test.throws($$select book_appointment(array[test.id('svc_barba')], test.at('15:00'), test.id('b2'))$$, 'indispon', 'barbeiro só faz serviços vinculados');
select test.ok(not exists (select 1 from get_available_slots(((now() at time zone 'America/Sao_Paulo')::date + 1), array[test.id('svc_corte')], test.id('b1'))
  where starts_at = test.at('10:15')), 'horário ocupado não aparece na lista');
reset role;

select test.login('cliente2@teste.local');
set role app_user;
insert into test.ctx select 'a2', book_appointment(array[test.id('svc_corte')], test.at('10:00'), null);
select test.ok((select barber_id from appointments where id = test.id('a2')) = test.id('b2'), '"qualquer profissional" escolhe o barbeiro livre');
select test.ok((select count(*) from appointments) = 1, 'cliente só vê os próprios agendamentos');
select test.ok((select count(*) from customers) = 1, 'cliente não acessa dados de outra conta');
select test.throws($$select * from agenda_view(now(), now() + interval '7 days')$$, 'Acesso negado', 'cliente não acessa a agenda interna');
select test.throws($$select cancel_appointment(test.id('a1'))$$, 'Acesso negado', 'cliente não cancela agendamento de outro');
select test.throws($$select dashboard_metrics(current_date, current_date)$$, 'Acesso negado', 'cliente não acessa indicadores');
reset role;

-- folga bloqueia agenda
select test.login('dono@teste.local'); set role app_user;
insert into time_off (barber_id, starts_at, ends_at, kind) values (test.id('b2'), test.at('14:00'), test.at('16:00'), 'folga');
reset role;
select test.login('cliente2@teste.local'); set role app_user;
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('14:30'), test.id('b2'))$$, 'indispon', 'folga aprovada bloqueia horários');
reset role;

-- ---------------------------------------------------------------------
-- 9. Cancelamento e reagendamento
-- ---------------------------------------------------------------------
select test.login('cliente2@teste.local'); set role app_user;
insert into test.ctx select 'a2b', reschedule_appointment(test.id('a2'), test.at('11:00'));
select test.ok((select status from appointments where id = test.id('a2')) = 'cancelado_cliente', 'reagendamento encerra o registro anterior');
select test.ok((select rescheduled_from from appointments where id = test.id('a2b')) = test.id('a2'), 'reagendamento preserva histórico');
select cancel_appointment(test.id('a2b'), 'Imprevisto');
select test.ok((select status from appointments where id = test.id('a2b')) = 'cancelado_cliente', 'cliente cancela dentro da política');
insert into test.ctx select 'a_hoje', book_appointment(array[test.id('svc_corte')], test.at('13:00'), test.id('b2'));
reset role;
update business_settings set cancel_min_hours = 72;
select test.login('cliente2@teste.local'); set role app_user;
select test.throws($$select cancel_appointment(test.id('a_hoje'))$$, 'Cancelamento online permitido até', 'bloqueia cancelamento fora do prazo');
reset role;
update business_settings set cancel_min_hours = 2;

-- ---------------------------------------------------------------------
-- 3. Permissões
-- ---------------------------------------------------------------------
select test.login('recepcao@teste.local'); set role app_user;
select test.ok((select count(*) from customers) >= 2, 'recepção lista clientes');
select test.ok((select count(*) from transactions) = 0, 'recepção não visualiza o financeiro');
select test.throws($$select dashboard_metrics(current_date, current_date)$$, 'Acesso negado', 'recepção não vê faturamento');
select test.throws($$select assign_role(app.uid(), 'administrador')$$, 'Acesso negado', 'recepção não atribui perfis');
update business_settings set name = 'Invasão' where id = 1;
reset role;
select test.ok((select name from business_settings) = 'MR.LUDER BARBEARIA', 'RLS ignora update de configurações sem permissão');

select test.login('gerente@teste.local'); set role app_user;
select test.throws($$select set_role_permission('recepcionista', 'financeiro', 'visualizar', true)$$, 'Somente o proprietário', 'gerente não altera permissões');
select test.throws($$select assign_role(app.uid(), 'administrador')$$, 'Acesso negado', 'gerente não se promove a administrador');
reset role;

select test.login('dono@teste.local'); set role app_user;
select set_role_permission('gerente', 'usuarios', 'gerenciar', true);
reset role;
select test.login('gerente@teste.local'); set role app_user;
select assign_role((select id from profiles where email = 'cliente2@teste.local'), 'recepcionista');
select test.throws($$select assign_role(app.uid(), 'administrador')$$, 'Somente o proprietário', 'perfil privilegiado só pelo proprietário');
reset role;

-- ---------------------------------------------------------------------
-- 10/11/12. Atendimento, comissão e financeiro
-- ---------------------------------------------------------------------
select test.login('barbeiro2@teste.local'); set role app_user;
select test.throws($$select set_appointment_status(test.id('a1'), 'confirmado')$$, 'Acesso negado', 'barbeiro não altera atendimento de outro');
select test.ok((select count(*) from appointments where barber_id = test.id('b1')) = 0, 'barbeiro não vê agenda de outro');
reset role;

select test.login('barbeiro1@teste.local'); set role app_user;
select test.ok((select count(*) from agenda_view(now() - interval '1 day', now() + interval '7 days')) = 1, 'barbeiro vê a própria agenda');
select test.throws($$select set_appointment_status(test.id('a1'), 'finalizado')$$, 'Transição inválida', 'não finaliza sem iniciar');
select set_appointment_status(test.id('a1'), 'confirmado');
select set_appointment_status(test.id('a1'), 'cliente_chegou');
select set_appointment_status(test.id('a1'), 'em_atendimento');
select set_appointment_status(test.id('a1'), 'finalizado', test.id('pix'), 'Degradê baixo');
select test.ok((select sum(amount) from commissions) = 34.00, 'comissão: 40% de 60 + fixo 10 por serviço = 34');
select test.ok((select count(*) from transactions) = 0, 'barbeiro não visualiza lançamentos financeiros');
select test.ok((select comissao_pendente from jsonb_to_record(my_barber_metrics(current_date - 1, current_date + 7)) as x(comissao_pendente numeric)) = 34,
  'barbeiro consulta as próprias comissões');
reset role;

select test.login('barbeiro2@teste.local'); set role app_user;
select test.ok((select count(*) from commissions) = 0, 'barbeiro não consulta comissões de outro profissional');
reset role;

select test.login('dono@teste.local'); set role app_user;
select test.ok((select status from transactions where appointment_id = test.id('a1')) = 'recebido', 'finalização com pagamento gera receita recebida');
select test.ok((select count(*) from transactions where appointment_id = test.id('a_hoje')) = 0, 'agendamento futuro não é receita');
select test.ok((select (financial_summary(current_date - 30, current_date + 30) ->> 'recebido')::numeric) = 100, 'resumo financeiro separa recebido');
reset role;

-- ---------------------------------------------------------------------
-- 13/14. Loja e estoque
-- ---------------------------------------------------------------------
select test.login('dono@teste.local'); set role app_user;
with x as (insert into products (name, price, cost, sku, stock, min_stock) values ('Produto Teste', 50, 20, 'TST-1', 0, 1) returning id) insert into test.ctx select 'p1', id from x;
select record_inventory(test.id('p1'), 'entrada', 2, 'Compra de teste', 20);
reset role;
select test.login('cliente1@teste.local'); set role app_user;
select test.ok((select count(*) from products) = 0, 'cliente não lê tabela de produtos com custo (usa public_site)');
select test.ok((public_site() -> 'products' -> 0) ? 'price' and not ((public_site() -> 'products' -> 0) ? 'cost'), 'catálogo público não expõe custo');
select test.throws($$select place_order(jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 3)))$$, 'Estoque insuficiente', 'não vende acima do estoque');
insert into test.ctx select 'o1', place_order(jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 2)));
reset role;
select test.ok((select stock from products where id = test.id('p1')) = 2, 'pedido aguardando pagamento não baixa estoque');
select test.login('recepcao@teste.local'); set role app_user;
select receive_payment('pedido', test.id('o1'), test.id('pix'));
reset role;
select test.ok((select stock from products where id = test.id('p1')) = 0, 'pagamento confirmado baixa o estoque');
select test.ok((select status from orders where id = test.id('o1')) = 'pronto_retirada', 'pedido de retirada fica pronto');
select test.ok((select count(*) from inventory_movements where product_id = test.id('p1') and kind = 'venda') = 1, 'movimentação de venda registrada');
select test.login('dono@teste.local'); set role app_user;
select update_order_status(test.id('o1'), 'cancelado');
reset role;
select test.ok((select stock from products where id = test.id('p1')) = 2, 'cancelamento de pedido pago devolve estoque');

-- ---------------------------------------------------------------------
-- 15/16. Planos e controle de benefícios
-- ---------------------------------------------------------------------
select test.login('dono@teste.local'); set role app_user;
with x as (insert into plans (name, price, period_months) values ('Plano Teste', 90, 1) returning id) insert into test.ctx select 'plan', id from x;
insert into plan_benefits (plan_id, service_id, quantity_per_period, description) values (test.id('plan'), test.id('svc_corte'), 1, '1 serviço A por mês');
reset role;
select test.login('cliente1@teste.local'); set role app_user;
insert into test.ctx select 'sub', subscribe_plan(test.id('plan'));
select test.throws($$select subscribe_plan(test.id('plan'))$$, 'já possui', 'não contrata o mesmo plano duas vezes');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('16:00', 2), test.id('b1'), null, null, 'online', true)$$, 'assinatura ativa', 'benefício só com assinatura paga');
reset role;
select test.login('recepcao@teste.local'); set role app_user;
select receive_payment('assinatura', test.id('sub'), test.id('pix'));
reset role;
select test.login('cliente1@teste.local'); set role app_user;
select test.ok((select status from subscriptions where id = test.id('sub')) = 'ativa', 'pagamento ativa a assinatura');
insert into test.ctx select 'a_plano', book_appointment(array[test.id('svc_corte')], test.at('16:00', 2), test.id('b1'), null, null, 'online', true);
select test.ok((select total_price from appointments where id = test.id('a_plano')) = 0, 'serviço coberto pelo plano sai sem custo');
select test.throws($$select book_appointment(array[test.id('svc_corte')], test.at('17:00', 2), test.id('b1'), null, null, 'online', true)$$, 'limite', 'impede uso acima do limite do plano');
select test.throws($$select book_appointment(array[test.id('svc_barba')], test.at('18:00', 2), test.id('b1'), null, null, 'online', true)$$, 'não estão incluídos', 'impede serviço fora do plano');
select cancel_appointment(test.id('a_plano'));
select test.ok((select count(*) from subscription_usages) = 0, 'cancelar devolve o benefício');
reset role;

-- ---------------------------------------------------------------------
-- 17/18. Indicação, antifraude e recompensa
-- ---------------------------------------------------------------------
select test.login('dono@teste.local'); set role app_user;
update business_settings set referral_reward_kind = 'desconto_percentual', referral_reward_value = 15 where id = 1;
reset role;
select test.login('cliente1@teste.local'); set role app_user;
insert into test.ctx select 'dummy_code', null; -- garante tabela
select become_affiliate() as code \gset
reset role;
select app.ensure_profile('auth-indicado', 'indicado@teste.local', null, json_build_object('full_name', 'Indicado Teste', 'phone', '(11) 90000-0003', 'ref_code', :'code', 'accepted_terms', true)::jsonb);
select app.ensure_profile('auth-fraude', 'fraude@teste.local', null, json_build_object('full_name', 'Fraude Teste', 'phone', '(11) 90000-0001', 'ref_code', :'code', 'accepted_terms', true)::jsonb);
select test.ok((select r.status from referrals r join customers c on c.id = r.referred_customer_id where c.email = 'indicado@teste.local') = 'pendente', 'indicação registrada como pendente');
select test.ok((select r.status from referrals r join customers c on c.id = r.referred_customer_id where c.email = 'fraude@teste.local') = 'rejeitada', 'antifraude: telefone igual ao do afiliado é rejeitado');

select test.login('indicado@teste.local'); set role app_user;
insert into test.ctx select 'a_ind', book_appointment(array[test.id('svc_corte')], test.at('12:00'), test.id('b2'));
reset role;
select test.login('dono@teste.local'); set role app_user;
select set_appointment_status(test.id('a_ind'), 'em_atendimento');
select set_appointment_status(test.id('a_ind'), 'finalizado');
select test.ok((select status from transactions where appointment_id = test.id('a_ind')) = 'pendente', 'finalizado sem pagamento fica a receber');
reset role;
select test.login('cliente1@teste.local'); set role app_user;
select test.ok((my_club() -> 'referrals' -> 0 ->> 'status') is not null, 'afiliado acompanha indicações');
select test.ok(jsonb_array_length(my_club() -> 'rewards') = 1, 'primeiro atendimento valida e gera recompensa');
select test.ok((select count(*) from coupons where discount_type = 'percentual' and value = 15) = 1, 'recompensa gera cupom exclusivo do afiliado');
reset role;

-- ---------------------------------------------------------------------
-- 19/20. LGPD e isolamento
-- ---------------------------------------------------------------------
select test.login(null); set role app_user;
select test.ok(create_privacy_request('informacoes', 'Quais dados vocês têm?', 'Visitante Teste', 'visitante@teste.local') like 'LGPD-%', 'visitante abre solicitação de privacidade');
select test.ok((select count(*) from privacy_requests) = 0, 'visitante não lê solicitações');
reset role;
select test.login('cliente2@teste.local'); set role app_user;
select test.ok(export_my_data() ? 'agendamentos', 'titular exporta os próprios dados');
select test.ok((select count(*) from consent_records) = 4, 'titular vê apenas os próprios consentimentos');
select update_marketing_consent(true, false);
select test.ok((select count(*) from consent_records where purpose = 'marketing_email' and granted) = 1, 'novo consentimento é registrado com histórico');
reset role;
select test.login('dono@teste.local'); set role app_user;
select test.ok((select count(*) from audit_logs where table_name = 'user_roles') >= 4, 'alterações de acesso ficam auditadas');
reset role;

-- ---------------------------------------------------------------------
-- Modelo Neon: provisionamento idempotente e funções internas protegidas
-- ---------------------------------------------------------------------
select test.ok(app.ensure_profile('auth-cliente1@teste.local', 'cliente1@teste.local', null, '{}') = (select id from profiles where email = 'cliente1@teste.local'), 'ensure_profile é idempotente');
select test.ok((select count(*) from customers where email = 'cliente1@teste.local') = 1, 'não duplica ficha de cliente');
select test.login('dono@teste.local'); set role app_user;
select test.throws($$select app.ensure_profile('x', 'x@x.com', 'x', '{}')$$, 'permission denied', 'app_user não executa ensure_profile');
select test.throws($$select gateway_confirm_payment(gen_random_uuid(), 'asaas', 'x', 1)$$, 'permission denied', 'app_user não confirma pagamento de gateway');
select test.throws($$select bootstrap_owner('cliente1@teste.local')$$, 'permission denied', 'app_user não executa bootstrap');
reset role;
select test.login(null); set role app_user;
select test.ok((select count(*) from profiles) = 0, 'visitante não lê perfis');
reset role;

\echo
\echo '✔ Todos os testes passaram.'
