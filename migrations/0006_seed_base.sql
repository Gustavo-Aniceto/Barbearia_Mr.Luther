-- =====================================================================
-- MR.LUDER — 0006 Dados-base (sem serviços, preços, horários ou profissionais
-- inventados: esses são cadastrados pelo administrador)
-- =====================================================================

insert into public.roles (key, name, description, is_system, is_privileged, is_staff) values
  ('proprietario', 'Proprietário / Master Admin', 'Controle total do sistema', true, true, true),
  ('administrador', 'Administrador', 'Gestão completa, exceto alterar permissões de perfis', true, true, true),
  ('gerente', 'Gerente', 'Acessa os módulos liberados pelo proprietário', true, false, true),
  ('recepcionista', 'Recepcionista', 'Clientes, agenda, balcão e pedidos', true, false, true),
  ('barbeiro', 'Barbeiro', 'Própria agenda, atendimentos e comissões', true, false, true),
  ('cliente', 'Cliente', 'Área do cliente', true, false, false),
  ('afiliado', 'Afiliado', 'MR.LUDER CLUB — programa de indicação', true, false, false);

insert into public.permissions (module, action)
select m, a from unnest(array['agenda','disponibilidade','clientes','servicos','equipe','financeiro','produtos','pedidos',
  'planos','afiliados','lgpd','configuracoes','usuarios','relatorios','site','auditoria']) m
cross join unnest(array['visualizar','criar','editar','excluir','aprovar','gerenciar','exportar']) a;

-- Administrador: tudo
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p where r.key = 'administrador';

-- Gerente
insert into public.role_permissions select r.id, p.id from public.roles r join public.permissions p on
  (p.module in ('agenda','disponibilidade','clientes','produtos','pedidos') and p.action = 'gerenciar')
  or (p.module in ('servicos','site') and p.action in ('visualizar','criar','editar'))
  or (p.module = 'equipe' and p.action in ('visualizar','aprovar'))
  or (p.module in ('planos','afiliados','relatorios','lgpd') and p.action = 'visualizar')
where r.key = 'gerente';

-- Recepcionista
insert into public.role_permissions select r.id, p.id from public.roles r join public.permissions p on
  (p.module in ('agenda','clientes','pedidos') and p.action in ('visualizar','criar','editar'))
  or (p.module in ('servicos','produtos') and p.action = 'visualizar')
  or (p.module = 'planos' and p.action in ('visualizar','criar','editar'))
where r.key = 'recepcionista';

-- Barbeiro: configura a própria disponibilidade
insert into public.role_permissions select r.id, p.id from public.roles r join public.permissions p on
  p.module = 'disponibilidade' and p.action in ('visualizar','criar','editar','excluir')
where r.key = 'barbeiro';

-- Configurações com dados informados pelo estabelecimento
insert into public.business_settings (id, address, maps_url, phone, whatsapp, rating_value, rating_count, rating_source, rating_updated_at,
  hero_title, hero_subtitle, about_title, about_text, about_highlights)
values (1,
  'Av. Emílio Ribas, 797 - Vila Tijuco, Guarulhos - SP, 07020-010',
  'https://www.google.com/maps/search/?api=1&query=Av.+Em%C3%ADlio+Ribas%2C+797+-+Vila+Tijuco%2C+Guarulhos+-+SP%2C+07020-010',
  '(11) 98276-1017', '5511982761017',
  4.9, 61, 'Google — informação cadastrada pelo estabelecimento', current_date,
  'MAIS QUE UM CORTE. UMA EXPERIÊNCIA.',
  'Seu estilo merece atenção aos detalhes. Viva a experiência MR.LUDER.',
  'Um lugar feito para homens que valorizam o detalhe',
  'A MR.LUDER nasceu para unir técnica, cuidado e um ambiente onde dá vontade de ficar. Cada atendimento é personalizado, feito por profissionais detalhistas, com música boa, café e água à disposição — e uma cerveja gelada para quem quiser. (Texto inicial editável no painel administrativo.)',
  '[{"title":"Atendimento personalizado","text":"Cada cliente é atendido com tempo e atenção ao que pede."},
    {"title":"Profissionais detalhistas","text":"Acabamento preciso do primeiro ao último fio."},
    {"title":"Ambiente moderno","text":"Decoração contemporânea, plantas, luz quente e identidade própria."},
    {"title":"Música, café e cerveja","text":"Café e água como cortesia, e cervejas à venda no local."}]'::jsonb);

-- Nenhum dia presumido aberto. O estabelecimento informou fechamento às 20h; o administrador define os dias.
insert into public.business_hours (weekday, is_open) select d, false from generate_series(0, 6) d;

insert into public.payment_methods (name, kind, sort_order) values
  ('Dinheiro', 'dinheiro', 1), ('Pix', 'pix', 2), ('Cartão de crédito', 'cartao_credito', 3), ('Cartão de débito', 'cartao_debito', 4);

insert into public.payment_settings (id) values (1);

insert into public.notification_settings (event, label) values
  ('agendamento_realizado', 'Agendamento realizado'), ('agendamento_confirmado', 'Agendamento confirmado'),
  ('lembrete_atendimento', 'Lembrete de atendimento'), ('cancelamento', 'Cancelamento'), ('reagendamento', 'Reagendamento'),
  ('plano_vencendo', 'Plano próximo do vencimento'), ('pagamento_aprovado', 'Pagamento aprovado'), ('pagamento_recusado', 'Pagamento recusado'),
  ('pedido_realizado', 'Pedido realizado'), ('produto_disponivel', 'Produto disponível'), ('recompensa_recebida', 'Recompensa recebida');

insert into public.legal_documents (kind, version, title, content, is_current) values
('termos', '1.0', 'Termos de Uso', $t$MODELO INICIAL — deve ser revisado pelos responsáveis da MR.LUDER BARBEARIA com orientação jurídica antes da publicação definitiva.

1. Sobre o serviço. Esta plataforma permite conhecer a MR.LUDER BARBEARIA, agendar atendimentos, comprar produtos, contratar planos e participar do programa de indicação.

2. Conta. Você é responsável pela veracidade dos dados informados e pela guarda da sua senha.

3. Agendamentos. Os horários exibidos consideram a disponibilidade real dos profissionais. Cancelamentos e reagendamentos seguem as políticas informadas no momento do agendamento.

4. Compras e planos. Preços, condições e regras de uso são exibidos antes da contratação. Benefícios de planos são pessoais e intransferíveis.

5. Programa de indicação. Indicações estão sujeitas às regras de elegibilidade e antifraude vigentes; tentativas de autoindicação invalidam a recompensa.

6. Contato. Av. Emílio Ribas, 797 - Vila Tijuco, Guarulhos - SP · (11) 98276-1017.$t$, true),
('privacidade', '1.0', 'Política de Privacidade', $t$MODELO INICIAL — as bases legais, prazos de retenção e o encarregado (DPO) devem ser definidos pelos responsáveis da MR.LUDER BARBEARIA com orientação jurídica. A plataforma oferece recursos técnicos de apoio à LGPD (Lei nº 13.709/2018), mas sua implementação, por si só, não garante conformidade.

Dados coletados: nome, e-mail, telefone, data de nascimento (opcional), histórico de atendimentos, compras e planos, preferências de comunicação e registros de consentimento.

Finalidades: execução de agendamentos, compras e planos (execução de contrato); comunicações de marketing apenas com seu consentimento específico, que pode ser revogado a qualquer momento; cumprimento de obrigações legais e fiscais.

Compartilhamento: provedores de infraestrutura (hospedagem e banco de dados) e, quando habilitados, provedores de pagamento e de mensagens. Dados completos de cartão nunca são armazenados por esta plataforma.

Seus direitos: confirmação e acesso, correção, anonimização ou eliminação, portabilidade, informação sobre compartilhamento e revogação do consentimento — solicite pela Área do Cliente ou pelo canal de privacidade informado no site.

Segurança: acesso controlado por perfil, criptografia em trânsito, registro de atividades administrativas e cópias de segurança.$t$, true);
