// =====================================================================
// Testes ponta a ponta (navegador real + API) — MR.LUDER em Next.js + Neon.
// Rode SOMENTE contra um ambiente de teste (branch do Neon + servidor local).
//   BASE_URL=http://localhost:3000 DATABASE_URL_UNPOOLED=<branch de teste> \
//   ADM_PASS=... BARBER_PASS=... CLIENT_PASS=... node tests/e2e/flows.mjs
// Requer: npm i --no-save playwright && npx playwright install chromium
// =====================================================================
import { chromium, request as pwRequest } from 'playwright';
import pg from 'pg';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const U = {
  adm: { name: 'Administrador Teste', email: 'adm.teste@example.com', phone: '(11) 91111-0001', pass: process.env.ADM_PASS },
  barber: { name: 'Barbeiro Teste', email: 'barbeiro.teste@example.com', phone: '(11) 91111-0002', pass: process.env.BARBER_PASS },
  client: { name: 'Cliente Teste', email: 'cliente.teste@example.com', phone: '(11) 91111-0003', pass: process.env.CLIENT_PASS },
  client2: { name: 'Cliente Concorrente', email: 'cliente2.teste@example.com', phone: '(11) 91111-0004', pass: process.env.CLIENT_PASS },
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await db.connect();
const results = []; const fails = [];
const ok = (m) => { results.push(m); console.log('  ok -', m); };
async function step(name, fn) {
  try { await fn(); ok(name); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); console.log('  FALHOU -', name, '→', e.message.split('\n')[0]); }
}
const expectTrue = (c, msg) => { if (!c) throw new Error(msg); };

const browser = await chromium.launch();
async function ctx(viewport = { width: 1366, height: 900 }) { return browser.newContext({ viewport, baseURL: BASE }); }
async function waitToast(pg, text) { await pg.locator('.toast', { hasText: text }).first().waitFor({ timeout: 15000 }); }

async function signup(u) {
  const c = await ctx(); const p = await c.newPage();
  await p.goto('/cadastro');
  await p.getByLabel('Nome completo').fill(u.name);
  await p.locator('input[type=email]').fill(u.email);
  await p.getByLabel('Telefone / WhatsApp').fill(u.phone);
  await p.locator('input[type=password]').fill(u.pass);
  await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.locator('.field-error', { hasText: 'aceitar os termos' }).waitFor();
  await p.locator('.consent input[type=checkbox]').first().check();
  await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/\/conta/, { timeout: 30000 });
  await c.close();
}
async function login(u, viewport) {
  const c = await ctx(viewport); const p = await c.newPage();
  await p.goto('/entrar');
  await p.locator('input[type=email]').fill(u.email);
  await p.locator('input[type=password]').fill(u.pass);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL((url) => !url.pathname.startsWith('/entrar'), { timeout: 30000 });
  await p.waitForLoadState('networkidle');
  return { c, p };
}
// chamada de API com o cookie de sessão do contexto (mesma origem)
async function api(p, body, origin = BASE) {
  return p.evaluate(async ({ body, origin }) => {
    const r = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? {} : {}) }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, { body, origin });
}

console.log(`\nMR.LUDER — testes ponta a ponta em ${BASE}\n`);

// ---------------------------------------------------------------- 1. Cadastro, login, sessão
await step('cadastro de adm, barbeiro e clientes com aceite obrigatório dos termos', async () => {
  for (const u of Object.values(U)) {
    const exists = (await db.query('select 1 from profiles where email = $1', [u.email])).rowCount;
    if (!exists) await signup(u);
  }
  const n = (await db.query("select count(*)::int n from profiles where email like '%.teste@example.com'")).rows[0].n;
  expectTrue(n === 4, `perfis criados: ${n}`);
});
await step('consentimentos LGPD registrados com versão dos termos; marketing desmarcado', async () => {
  const r = await db.query("select purpose, granted, document_version from consent_records c join profiles p on p.id = c.user_id where p.email = $1", [U.client.email]);
  expectTrue(r.rows.find((x) => x.purpose === 'termos')?.granted === true && r.rows.find((x) => x.purpose === 'termos')?.document_version === '1.0', 'termos');
  expectTrue(r.rows.find((x) => x.purpose === 'marketing_email')?.granted === false, 'marketing');
});
await step('senha errada é recusada com mensagem clara', async () => {
  const c = await ctx(); const p = await c.newPage();
  await p.goto('/entrar'); await p.locator('input[type=email]').fill(U.client.email); await p.locator('input[type=password]').fill('SenhaErrada999');
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.locator('.toast-error').first().waitFor({ timeout: 15000 });
  await c.close();
});
await step('proprietário inicial definido com bootstrap seguro (somente SQL)', async () => {
  const has = (await db.query("select 1 from user_roles ur join roles r on r.id = ur.role_id where r.key = 'proprietario'")).rowCount;
  if (!has) await db.query('select public.bootstrap_owner($1)', [U.adm.email]);
  else { // ambiente copiado da produção (já tem proprietário): concede o perfil à conta de teste só neste banco de testes
    await db.query("insert into user_roles (user_id, role_id) select p.id, r.id from profiles p, roles r where lower(p.email) = $1 and r.key = 'proprietario' on conflict do nothing", [U.adm.email]);
  }
  // barbeiros reais copiados da produção não atendem online aqui, para o teste usar o Barbeiro Teste
  await db.query("update barbers set accepts_online_booking = false where display_name <> 'Barbeiro Teste'");
});

// ---------------------------------------------------------------- 2. Proprietário configura a operação
const { c: oc, p: owner } = await login(U.adm);
await step('proprietário cai no painel administrativo', async () => { await owner.goto('/admin'); await owner.getByRole('heading', { name: 'Visão geral' }).waitFor(); });
await step('define horários de funcionamento (seg–sáb 09h–20h)', async () => {
  await owner.goto('/admin/configuracoes'); await owner.getByRole('tab', { name: 'Horário de funcionamento' }).click();
  const rows = owner.locator('.hours-editor .row');
  await rows.first().waitFor();
  for (let i = 0; i < 6; i++) {
    const r = rows.nth(i);
    if (!(await r.locator('input[type=checkbox]').isChecked())) await r.locator('.toggle').click();
    await r.locator('input[type=time]').nth(0).fill('09:00'); await r.locator('input[type=time]').nth(1).fill('20:00');
  }
  await owner.getByRole('button', { name: 'Salvar alterações' }).click(); await waitToast(owner, 'Alterações salvas');
});
await step('cadastra o barbeiro vinculado à conta (perfil Barbeiro atribuído)', async () => {
  if ((await db.query("select 1 from barbers where display_name = 'Barbeiro Teste'")).rowCount) return;
  await owner.goto('/admin/equipe'); await owner.getByRole('button', { name: 'Cadastrar barbeiro' }).click();
  const m = owner.getByRole('dialog');
  await m.getByLabel('Nome de exibição').fill('Barbeiro Teste');
  await m.getByLabel('Especialidades').fill('Degradê, Barba');
  await m.getByLabel('Descrição profissional').fill('Perfil de teste do ambiente de homologação.');
  await m.getByLabel('Comissão em serviços (% ou R$)').fill('40');
  await m.getByLabel('Comissão em produtos (%)').fill('10');
  await m.getByLabel('E-mail da conta do barbeiro').fill(U.barber.email);
  await m.getByRole('button', { name: 'Salvar' }).click(); await waitToast(owner, 'Barbeiro salvo');
  const r = await db.query("select 1 from user_roles ur join roles r on r.id = ur.role_id join profiles p on p.id = ur.user_id where r.key = 'barbeiro' and p.email = $1", [U.barber.email]);
  expectTrue(r.rowCount === 1, 'papel barbeiro não atribuído');
});
await step('cadastra serviços (corte e barba) e vincula o profissional', async () => {
  for (const [name, price, dur] of [['Corte (teste)', '50', '30'], ['Barba (teste)', '35', '20']]) {
    if ((await db.query('select 1 from services where name = $1', [name])).rowCount) continue;
    await owner.goto('/admin/servicos'); await owner.getByRole('button', { name: 'Novo serviço' }).click();
    const m = owner.getByRole('dialog');
    await m.locator('input').first().fill(name);
    await m.locator('.input-affix input').fill(price); await m.getByLabel('Duração (minutos)').fill(dur);
    await m.getByRole('button', { name: 'Salvar' }).click();
    const link = owner.getByRole('dialog', { name: /Quem realiza/ });
    await link.locator('input[type=checkbox]').first().check(); await link.getByRole('button', { name: 'Salvar' }).click();
    await waitToast(owner, 'Profissionais vinculados');
  }
});
await step('envia foto do barbeiro para o Neon Object Storage (referência salva no banco)', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync('/tmp/foto.png', png);
  await owner.goto('/admin/equipe');
  await owner.getByRole('row', { name: /Barbeiro Teste/ }).getByRole('button', { name: 'Editar' }).click();
  const m = owner.getByRole('dialog');
  await m.locator('input[type=file]').setInputFiles('/tmp/foto.png');
  await m.locator('.image-input img').waitFor({ timeout: 20000 });
  const src = await m.locator('.image-input img').getAttribute('src');
  expectTrue(/^\/api\/media\/equipe\//.test(src || ''), `url ${src}`);
  await m.getByRole('button', { name: 'Salvar' }).click(); await waitToast(owner, 'Barbeiro salvo');
  const r = await owner.request.get(src); expectTrue(r.status() === 200 && r.headers()['content-type'] === 'image/png', `GET media ${r.status()}`);
  const meta = await db.query('select bucket, size_bytes from media_files where object_key = $1', [src.replace('/api/media/', '')]);
  expectTrue(meta.rows[0]?.bucket === 'mrluder-media', 'metadados');
});
await step('cadastra produto com estoque inicial', async () => {
  if ((await db.query("select 1 from products where sku = 'TST-POMADA'")).rowCount) return;
  await owner.goto('/admin/produtos'); await owner.getByRole('button', { name: 'Novo produto' }).click();
  const m = owner.getByRole('dialog');
  await m.locator('input').first().fill('Pomada modeladora (teste)');
  await m.getByLabel('Código / SKU').fill('TST-POMADA');
  await m.locator('.input-affix input').nth(0).fill('45'); await m.locator('.input-affix input').nth(1).fill('20');
  await m.getByLabel('Estoque inicial').fill('5'); await m.getByLabel('Estoque mínimo (alerta)').fill('2');
  await m.getByRole('button', { name: 'Salvar' }).click(); await waitToast(owner, 'Produto salvo');
  const s = (await db.query("select stock from products where sku = 'TST-POMADA'")).rows[0].stock;
  expectTrue(s === 5, `estoque ${s}`);
});
await step('cria plano mensal com benefício (1 corte por mês)', async () => {
  if ((await db.query("select 1 from plans where name = 'Plano Teste'")).rowCount) return;
  await owner.goto('/admin/planos'); await owner.getByRole('button', { name: 'Novo plano' }).click();
  let m = owner.getByRole('dialog');
  await m.locator('input').first().fill('Plano Teste'); await m.locator('.input-affix input').fill('80');
  await m.getByLabel('Periodicidade').selectOption('1');
  await m.getByRole('button', { name: 'Salvar' }).click(); await waitToast(owner, 'Plano salvo');
  await owner.getByRole('button', { name: 'Adicionar benefício' }).first().click();
  m = owner.getByRole('dialog');
  await m.getByLabel('Serviço incluído').selectOption({ label: 'Corte (teste)' });
  await m.getByLabel('Quantidade por período').fill('1'); await m.getByLabel('Descrição exibida').fill('1 corte por mês');
  await m.getByRole('button', { name: 'Salvar' }).click();
});

// ---------------------------------------------------------------- 3. Cliente: site, agendamento, compra, plano
const { c: cc, p: client } = await login(U.client, { width: 390, height: 844 });
let bookedSlot = '';
await step('site público lista serviço, profissional e produto cadastrados', async () => {
  await client.goto('/'); await client.locator('#servicos').getByText('Corte (teste)').waitFor();
  await client.locator('#profissionais').getByText('Barbeiro Teste').waitFor();
  await client.screenshot({ path: `${SHOTS}/cliente-home-mobile.png` });
});
await step('cliente agenda pelo celular em 4 passos e recebe confirmação', async () => {
  await client.goto('/agendar');
  await client.getByRole('button', { name: /Corte \(teste\)/ }).click(); await client.getByRole('button', { name: 'Continuar' }).click();
  await client.getByRole('radio', { name: /Qualquer profissional/ }).click(); await client.getByRole('button', { name: 'Continuar' }).click();
  await client.locator('.slot').first().waitFor({ timeout: 20000 });
  bookedSlot = (await client.locator('.slot').first().textContent()) || '';
  await client.locator('.slot').first().click(); await client.getByRole('button', { name: 'Continuar' }).click();
  await client.getByLabel('Observações para o barbeiro').fill('Degradê baixo, por favor');
  await client.getByRole('button', { name: 'Confirmar reserva' }).click();
  await client.getByRole('heading', { name: 'Horário reservado' }).waitFor({ timeout: 20000 });
  await client.screenshot({ path: `${SHOTS}/cliente-agendado-mobile.png` });
});
await step('agendamento aparece na área do cliente', async () => {
  await client.goto('/conta'); await client.locator('.appt', { hasText: 'Corte (teste)' }).first().waitFor();
});
await step('cliente compra produto pela loja (retirada)', async () => {
  await client.goto('/loja'); await client.locator('.product', { hasText: 'Pomada modeladora' }).getByRole('button', { name: 'Comprar' }).click();
  await client.goto('/carrinho'); await client.getByRole('button', { name: 'Finalizar pedido' }).click();
  await client.getByRole('heading', { name: 'Pedido recebido' }).waitFor({ timeout: 20000 });
  const s = (await db.query("select stock from products where sku = 'TST-POMADA'")).rows[0].stock;
  expectTrue(s === 5, 'pedido não pago não pode baixar estoque');
});
await step('cliente contrata o plano (aguardando pagamento)', async () => {
  const planId = (await db.query("select id from plans where name = 'Plano Teste'")).rows[0].id;
  await client.goto(`/conta?aba=planos&assinar=${planId}`);
  await client.getByRole('button', { name: 'Confirmar contratação' }).click(); await waitToast(client, 'Assinatura registrada');
});
await step('Club e cupons ficam ocultos para o cliente enquanto o programa está desligado', async () => {
  await db.query('update business_settings set referral_enabled = false where id = 1');
  await client.goto('/conta'); await client.locator('.account-nav button').first().waitFor();
  expectTrue(!(await client.locator('.account-nav button', { hasText: 'Club e cupons' }).count()), 'aba Club visível com o programa desligado');
  await db.query('update business_settings set referral_enabled = true where id = 1'); // liga de novo para o teste seguinte
});
await step('cliente gera código do MR.LUDER Club', async () => {
  await client.goto('/conta?aba=club'); await client.getByRole('button', { name: 'Gerar meu código' }).click();
  await client.locator('.code-box code').waitFor();
});
await step('cliente baixa cópia dos próprios dados (LGPD)', async () => {
  const r = await api(client, { op: 'rpc', fn: 'export_my_data' });
  expectTrue(r.status === 200 && r.json.data.agendamentos.length >= 1, 'export');
});

// ---------------------------------------------------------------- 4. Segurança (servidor + RLS)
await step('cliente não lê financeiro, nem dados de outras contas', async () => {
  const t = await api(client, { op: 'select', table: 'transactions' }); expectTrue(t.status === 200 && t.json.data.length === 0, 'transactions');
  const p = await api(client, { op: 'select', table: 'profiles' }); expectTrue(p.json.data.length === 1, 'profiles');
});
await step('cliente não acessa indicadores nem funções internas', async () => {
  const d = await api(client, { op: 'rpc', fn: 'dashboard_metrics', args: { p_from: '2026-11-01', p_to: '2026-11-30' } }); expectTrue(d.status === 403, `dashboard ${d.status}`);
  const e = await api(client, { op: 'rpc', fn: 'bootstrap_owner', args: { p_email: U.client.email } }); expectTrue(e.status === 404, `bootstrap ${e.status}`);
});
await step('API rejeita tabela/coluna inexistente e injeção em identificadores', async () => {
  const a = await api(client, { op: 'select', table: 'profiles; drop table x' }); expectTrue(a.status === 400, 'tabela');
  const b = await api(client, { op: 'select', table: 'profiles', filters: [['id) or (1=1', 'eq.x']] }); expectTrue(b.status === 400, 'coluna');
  const c = await api(client, { op: 'select', table: 'profiles', filters: [['email', "eq.' or '1'='1"]] }); expectTrue(c.status === 200 && c.json.data.length === 0, 'valor parametrizado');
});
await step('requisição de outra origem (CSRF) é bloqueada', async () => {
  const rc = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: 'https://site-malicioso.example' } });
  const r = await rc.post('/api/data', { data: { op: 'select', table: 'services' } }); expectTrue(r.status() === 403, `status ${r.status()}`);
  await rc.dispose();
});
await step('visitante sem login não envia arquivos nem agenda', async () => {
  const rc = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const up = await rc.post('/api/upload', { multipart: { folder: 'site', file: { name: 'a.png', mimeType: 'image/png', buffer: fs.readFileSync('/tmp/foto.png') } } });
  expectTrue(up.status() === 401, `upload ${up.status()}`);
  const svc = (await db.query("select id from services where name = 'Corte (teste)'")).rows[0].id;
  const bk = await rc.post('/api/data', { data: { op: 'rpc', fn: 'book_appointment', args: { p_service_ids: [svc], p_starts_at: new Date(Date.now() + 86400e3).toISOString() } } });
  expectTrue(bk.status() === 403, `book ${bk.status()}`);
  await rc.dispose();
});
await step('mídia só é servida se registrada no banco', async () => {
  const r = await owner.request.get('/api/media/site/2026-11/00000000-0000-0000-0000-000000000000.png'); expectTrue(r.status() === 404, `${r.status()}`);
});

// ---------------------------------------------------------------- 5. Concorrência
await step('dois clientes reservando o MESMO horário ao mesmo tempo → só 1 reserva', async () => {
  const { c: c2, p: client2 } = await login(U.client2);
  const svc = (await db.query("select id from services where name = 'Barba (teste)'")).rows[0].id;
  const b = (await db.query("select id from barbers where display_name = 'Barbeiro Teste'")).rows[0].id;
  const slots = await api(client, { op: 'rpc', fn: 'get_available_slots', args: { p_date: new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10), p_service_ids: [svc], p_barber_id: b } });
  let target = slots.json.data?.[3]?.starts_at;
  if (!target) { const s3 = await api(client, { op: 'rpc', fn: 'get_available_slots', args: { p_date: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), p_service_ids: [svc], p_barber_id: b } }); target = s3.json.data?.[3]?.starts_at; }
  expectTrue(!!target, 'sem horário livre para o teste');
  const args = { op: 'rpc', fn: 'book_appointment', args: { p_service_ids: [svc], p_starts_at: target, p_barber_id: b } };
  const [r1, r2] = await Promise.all([api(client, args), api(client2, args)]);
  const okCount = [r1, r2].filter((r) => r.status === 200).length;
  const n = (await db.query("select count(*)::int n from appointments where barber_id = $1 and starts_at = $2 and status not in ('cancelado_cliente','cancelado_barbearia')", [b, target])).rows[0].n;
  expectTrue(okCount === 1 && n === 1, `sucessos=${okCount} registros=${n} (${r1.status}/${r2.status})`);
  await c2.close();
});

// ---------------------------------------------------------------- 6. Barbeiro atende
const { c: bc, p: barber } = await login(U.barber);
await step('barbeiro entra direto no painel do barbeiro e vê a agenda', async () => {
  await barber.goto('/barbeiro/agenda'); await barber.getByRole('tab', { name: 'Semana' }).click();
  await barber.locator('.week-ev').first().waitFor({ timeout: 20000 });
});
await step('barbeiro confirma, recebe o cliente, inicia e finaliza com Pix', async () => {
  const appt = (await db.query("select a.id from appointments a join customers c on c.id = a.customer_id where c.email = $1 and a.status in ('pendente','confirmado') order by a.starts_at limit 1", [U.client.email])).rows[0];
  expectTrue(!!appt, 'agendamento do cliente');
  for (const st of ['confirmado', 'cliente_chegou', 'em_atendimento']) {
    const r = await api(barber, { op: 'rpc', fn: 'set_appointment_status', args: { p_id: appt.id, p_status: st, p_note: 'Degradê 1, tesoura em cima' } });
    expectTrue(r.status === 200, `${st}: ${r.json?.message}`);
  }
  // finalização pela interface
  await barber.goto('/barbeiro'); await barber.waitForLoadState('networkidle'); await barber.locator('.kpi').first().waitFor({ timeout: 10000 }).catch(() => {});
  const hoje = barber.locator('.next-client').getByRole('button', { name: 'Finalizar atendimento' });
  if (await hoje.count()) await hoje.click();
  else { // atendimento em outro dia: abre pela agenda semanal
    await barber.goto('/barbeiro/agenda'); await barber.getByRole('tab', { name: 'Semana' }).click();
    await barber.locator('.week-ev').first().waitFor({ timeout: 10000 }).catch(() => {}); // espera a semana carregar
    let ev = barber.locator('.week-ev.st-em_atendimento').first();
    if (!(await ev.count())) { await barber.getByRole('button', { name: 'Próximo' }).click(); ev = barber.locator('.week-ev.st-em_atendimento').first(); await ev.waitFor({ timeout: 10000 }); }
    await ev.click();
  }
  const dlg = barber.getByRole('dialog'); await dlg.getByLabel('Pagamento recebido agora?').selectOption({ label: 'Pix' });
  await dlg.getByRole('button', { name: 'Finalizar atendimento' }).click(); await waitToast(barber, 'Atendimento finalizado');
});
await step('comissão de 40% (R$ 20,00) gerada para o barbeiro', async () => {
  await barber.goto('/barbeiro/comissoes'); await barber.locator('.kpi').first().filter({ hasText: 'R$ 20,00' }).waitFor({ timeout: 15000 });
  await barber.screenshot({ path: `${SHOTS}/barbeiro-comissoes.png` });
});
await step('barbeiro não acessa o financeiro nem o painel administrativo', async () => {
  const t = await api(barber, { op: 'select', table: 'transactions' }); expectTrue(t.json.data.length === 0, 'transactions');
  await barber.goto('/admin/financeiro'); await barber.getByText('Acesso restrito').waitFor();
});

// ---------------------------------------------------------------- 7. Proprietário: caixa, pedidos, planos, indicadores
await step('recepção do pedido: pagamento baixa o estoque e pedido fica pronto', async () => {
  await owner.goto('/admin/pedidos'); await owner.getByRole('button', { name: 'Receber' }).first().click();
  const m = owner.getByRole('dialog'); await m.getByLabel('Forma de pagamento').selectOption({ label: 'Pix' });
  await m.getByRole('button', { name: 'Confirmar recebimento' }).click(); await waitToast(owner, 'Pagamento registrado');
  const s = (await db.query("select stock from products where sku = 'TST-POMADA'")).rows[0].stock; expectTrue(s === 4, `estoque ${s}`);
});
await step('pagamento do plano ativa a assinatura', async () => {
  await owner.goto('/admin/planos'); await owner.getByRole('tab', { name: /Assinaturas/ }).click();
  await owner.getByRole('button', { name: 'Receber' }).first().click();
  const m = owner.getByRole('dialog'); await m.getByLabel('Forma de pagamento').selectOption({ label: 'Dinheiro' });
  await m.getByRole('button', { name: 'Confirmar recebimento' }).click(); await waitToast(owner, 'Assinatura ativa');
});
await step('dashboard mostra faturamento real (R$ 50 + R$ 45 + R$ 80)', async () => {
  await owner.goto('/admin'); await owner.locator('.kpi.hero-kpi').waitFor();
  // Executa como o proprietário (mesmo caminho do servidor: papel app_user + perfil na sessão).
  // (o id é lido antes de trocar de papel, pois a RLS esconde perfis de quem ainda não está identificado)
  const ownerId = (await db.query('select id::text from profiles where lower(email) = $1', [U.adm.email])).rows[0].id;
  await db.query('begin');
  let m;
  try {
    await db.query('set local role app_user');
    await db.query("select set_config('app.profile_id', $1, true)", [ownerId]);
    m = (await db.query("select (public.financial_summary(current_date - 1, current_date + 1) ->> 'recebido')::numeric r")).rows[0].r;
  } finally { await db.query('rollback'); }
  expectTrue(Number(m) >= 175, `recebido ${m}`);
  await owner.screenshot({ path: `${SHOTS}/admin-dashboard.png`, fullPage: true });
});
await step('agendamento futuro não conta como receita', async () => {
  const r = await db.query("select count(*)::int n from transactions t join appointments a on a.id = t.appointment_id where a.status in ('pendente','confirmado')");
  expectTrue(r.rows[0].n === 0, 'receita de agendamento futuro');
});
await step('matriz de permissões, auditoria e LGPD abrem para o proprietário', async () => {
  await owner.goto('/admin/acessos'); await owner.getByRole('tab', { name: 'Perfis e permissões' }).click(); await owner.locator('.perm-matrix').waitFor();
  await owner.goto('/admin/auditoria'); await owner.locator('table.table').waitFor();
  await owner.goto('/admin/lgpd'); await owner.getByRole('tab', { name: 'Solicitações de titulares' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/admin-lgpd.png` });
});
await step('rotina diária (cron) protegida e funcional', async () => {
  const r1 = await owner.request.get('/api/cron/renewals'); expectTrue(r1.status() === 401, 'sem segredo');
  const r2 = await owner.request.get('/api/cron/renewals', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }); expectTrue(r2.status() === 200, `com segredo ${r2.status()}`);
  const j = await r2.json(); expectTrue(/^db\/mrluder-.*\.json\.gz$/.test(j.backup?.key || '') && j.backup.tables >= 50, `backup ${JSON.stringify(j.backup)}`);
});

// ---------------------------------------------------------------- 8. Funções adicionadas depois (11/11)
await step('novo barbeiro e serviço novo ficam vinculados a todos automaticamente', async () => {
  const r = (await db.query(`select (select count(*) from services where active)::int s,
    (select count(*) from barber_services bs join barbers b on b.id = bs.barber_id where b.display_name = 'Barbeiro Teste')::int l`)).rows[0];
  expectTrue(r.s > 0 && r.l === r.s, `serviços ${r.s}, vínculos ${r.l}`);
});
await step('site mostra preço "a partir de", galeria do Instagram e link do Instagram', async () => {
  await client.goto('/'); await client.waitForLoadState('networkidle');
  const minimo = (await db.query("select count(*)::int n from services where price_is_minimum and active")).rows[0].n;
  if (minimo) await client.locator('#servicos .price-from').first().waitFor({ timeout: 10000 });
  const ig = (await db.query('select instagram_url from business_settings where id = 1')).rows[0].instagram_url;
  if (ig) expectTrue(await client.locator(`a[href="${ig}"]`).count() > 0, 'link do Instagram');
  const g = await client.request.get('/img/galeria/barbeiro-em-acao.jpg'); expectTrue(g.status() === 200, `foto da galeria ${g.status()}`);
  const h = await client.request.get('/'); expectTrue(h.status() === 200, `home ${h.status()} (renderização no servidor)`);
});
await step('aviso por e-mail do agendamento entra na fila (não marcado como enviado sem provedor)', async () => {
  const r = (await db.query(`select status from notification_logs l join profiles p on p.id = l.user_id
    where lower(p.email) = $1 and l.event = 'agendamento_realizado' and l.channel = 'email' order by l.created_at desc limit 1`, [U.client.email])).rows[0];
  expectTrue(!!r, 'sem aviso por e-mail');
  if (!process.env.BREVO_API_KEY) expectTrue(r.status === 'aguardando_integracao', `status ${r.status}`);
});
await step('pagamento online fica oculto quando o Asaas não está configurado', async () => {
  const g = await client.request.get('/api/payments/checkout'); const j = await g.json();
  if (!process.env.ASAAS_API_KEY) expectTrue(j.enabled === false, 'botão deveria estar oculto');
  const p = await client.request.post('/api/payments/checkout', { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { kind: 'plano', id: '00000000-0000-0000-0000-000000000000' } });
  expectTrue([503, 404].includes(p.status()), `checkout ${p.status()}`);
});
await step('aviso do Asaas: token falso recusado; mensalidade paga ativa o plano; aviso repetido não paga 2x', async () => {
  const token = process.env.ASAAS_WEBHOOK_TOKEN; expectTrue(!!token && process.env.PAYMENT_PROVIDER === 'asaas', 'defina PAYMENT_PROVIDER e ASAAS_WEBHOOK_TOKEN para este teste');
  const { c: c2, p: client2 } = await login(U.client2);
  const plan = (await db.query("select id from plans where name = 'Plano Teste'")).rows[0].id;
  let sub = (await db.query("select s.id from subscriptions s join customers c on c.id = s.customer_id where c.email = $1 and s.plan_id = $2 and s.status in ('pendente','ativa')", [U.client2.email, plan])).rows[0]?.id;
  if (!sub) { const r = await api(client2, { op: 'rpc', fn: 'subscribe_plan', args: { p_plan: plan } }); expectTrue(r.status === 200, `contratar ${r.json?.message}`); sub = r.json.data; }
  const gsub = 'sub_e2e_' + sub.slice(0, 8);
  await db.query("update subscriptions set gateway = 'asaas', gateway_subscription_id = $2 where id = $1", [sub, gsub]);
  const hook = (body, tk = token) => client2.request.post('/api/webhooks/payments', { headers: { 'asaas-access-token': tk, 'Content-Type': 'application/json' }, data: body });
  const ev = { id: 'evt_e2e_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_e2e_' + sub.slice(0, 8), subscription: gsub, value: 80, externalReference: null } };
  expectTrue((await hook(ev, 'x'.repeat(64))).status() === 401, 'token falso aceito');
  const r1 = await (await hook(ev)).json(); expectTrue(r1.result === 'ok', `1º aviso ${JSON.stringify(r1)}`);
  const r2 = await (await hook({ ...ev, event: 'PAYMENT_RECEIVED' })).json(); expectTrue(r2.result === 'duplicado', `repetido ${JSON.stringify(r2)}`);
  const st = (await db.query("select status, current_period_end > now() + interval '25 days' ok from subscriptions where id = $1", [sub])).rows[0];
  expectTrue(st.status === 'ativa' && st.ok, `plano ${st.status}`);
  const n = (await db.query("select count(*)::int n from payment_transactions where gateway_reference = $1", [ev.payment.id])).rows[0].n; expectTrue(n === 1, `pagamentos registrados ${n}`);
  const odd = await (await hook({ id: 'evt_e2e_2', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_e2e_x', subscription: null, externalReference: 'nao-e-um-id', value: 1 } })).json();
  expectTrue(odd.result === 'ignorado', `aviso sem referência ${JSON.stringify(odd)}`);
  // cliente cancela no site: renovação desligada, benefícios pagos continuam
  const cx = await api(client2, { op: 'rpc', fn: 'set_subscription_status', args: { p_sub: sub, p_status: 'cancelada' } }); expectTrue(cx.status === 200, `cancelar ${cx.json?.message}`);
  const after = (await db.query('select status, auto_renew from subscriptions where id = $1', [sub])).rows[0];
  expectTrue(after.status === 'ativa' && after.auto_renew === false, `após cancelar ${JSON.stringify(after)}`);
  await c2.close();
});

for (const c of [oc, cc, bc]) await c.close();
await browser.close();
await db.end();
console.log(`\n${fails.length ? '✘' : '✔'} ${results.length} verificações passaram${fails.length ? `, ${fails.length} falharam:\n  - ${fails.join('\n  - ')}` : '.'}`);
process.exit(fails.length ? 1 : 0);
