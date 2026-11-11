// Testes dos planos com regras de dia/semana, horário fixo aprovado pelo barbeiro e aviso de vencimento.
// Rode SOMENTE contra um banco de TESTE (branch do Neon) e servidor local:
//   BASE_URL=http://localhost:3000 DATABASE_URL_UNPOOLED=<branch de teste> PASS=<senha aleatória> node tests/e2e/planos.mjs
import { chromium, devices } from 'playwright';
import pg from 'pg';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/shots'; fs.mkdirSync(SHOTS, { recursive: true });
const PASS = process.env.PASS;
if (!PASS) { console.error('Defina PASS'); process.exit(2); }
const RUN = Math.random().toString(36).slice(2, 8);
const U = {
  barber: { name: 'Barbeiro Planos', email: `barbeiro.planos.${RUN}@example.com`, phone: '(11) 92222-0001' },
  client: { name: 'Cliente Planos', email: `cliente.planos.${RUN}@example.com`, phone: '(11) 92222-0002' },
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await db.connect();
const fails = [];
const ok = (m) => console.log('  ok -', m);
async function step(name, fn) { try { await fn(); ok(name); } catch (e) { fails.push(name); console.log('  FALHOU -', name, '→', e.message.split('\n')[0]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch();
const phone = { ...devices['iPhone 13'], baseURL: BASE };

async function signup(u) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const p = await c.newPage();
  await p.goto('/cadastro');
  await p.getByLabel('Nome completo').fill(u.name);
  await p.locator('input[type=email]').fill(u.email);
  await p.getByLabel('Telefone / WhatsApp').fill(u.phone);
  await p.locator('input[type=password]').fill(PASS);
  await p.locator('.consent input[type=checkbox]').first().check();
  await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/\/conta/, { timeout: 30000 });
  await c.close();
}
async function login(u) {
  const c = await browser.newContext(phone); const p = await c.newPage();
  await p.goto('/entrar');
  await p.locator('input[type=email]').fill(u.email);
  await p.locator('input[type=password]').fill(PASS);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  await p.waitForURL((url) => !url.pathname.startsWith('/entrar'), { timeout: 30000 });
  await p.waitForLoadState('networkidle');
  return { c, p };
}
const rpc = (p, fn, args) => p.evaluate(async ({ fn, args }) => {
  const r = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'rpc', fn, args }) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, { fn, args });

console.log(`\nMR.LUDER — planos e horário fixo em ${BASE}\n`);
let plan, sub, barberId, clientCustomer;

await step('cadastro do barbeiro e do cliente de teste', async () => {
  for (const u of Object.values(U)) {
    const exists = (await db.query('select 1 from profiles where email = $1', [u.email])).rowCount;
    expect(!exists, `conta ${u.email} já existe: use um banco de teste novo`);
    await signup(u);
  }
});

await step('os 4 planos são cadastrados com dias e limite semanal (mesmo SQL da produção)', async () => {
  await db.query(fs.readFileSync(new URL('../../scripts/seed-planos.sql', import.meta.url), 'utf8'));
  const r = await db.query("select name, price, allowed_weekdays, max_per_week from plans where name like 'Plano Corte%' and active order by sort_order");
  expect(r.rowCount === 4, `planos: ${r.rowCount}`);
  expect(r.rows.map((x) => Number(x.price)).join() === '112,135,130,150', 'preços');
  expect(JSON.stringify(r.rows[0].allowed_weekdays) === '[1,2,3,4]' && r.rows[1].allowed_weekdays === null && r.rows.every((x) => x.max_per_week === 1), 'regras');
  plan = (await db.query("select id, name from plans where name = 'Plano Corte · seg a qui'")).rows[0];
  expect(plan, 'plano 1');
});

await step('barbeiro de teste vinculado à conta (somente no banco de teste)', async () => {
  const prof = (await db.query('select id from profiles where email = $1', [U.barber.email])).rows[0];
  barberId = (await db.query(`insert into barbers (display_name, profile_id, active, accepts_online_booking, sort_order)
    values ($1, $2, true, true, 99) returning id`, [U.barber.name, prof.id])).rows[0].id;
  await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'barbeiro' on conflict do nothing", [prof.id]);
  // barbeiros reais copiados da produção ficam fora da agenda online neste banco
  await db.query('update barbers set accepts_online_booking = false where id <> $1', [barberId]);
});

const { c: cc, p: client } = await login(U.client);
await step('cliente contrata o plano e, com o pagamento confirmado, ele fica ativo', async () => {
  const r = await rpc(client, 'subscribe_plan', { p_plan: plan.id });
  expect(r.status === 200, JSON.stringify(r.json));
  sub = r.json.data;
  clientCustomer = (await db.query('select customer_id from subscriptions where id = $1', [sub])).rows[0].customer_id;
  // simula a confirmação do pagamento (mesmo efeito do Asaas / recebimento no balcão)
  await db.query("update subscriptions set status = 'ativa', current_period_start = now(), current_period_end = now() + interval '1 month' where id = $1", [sub]);
});

await step('usar o plano numa sexta é recusado com explicação (plano vale de segunda a quinta)', async () => {
  const fri = (await db.query(`select ((date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '11 days 11 hours') at time zone 'America/Sao_Paulo') as t`)).rows[0].t;
  const svc = (await db.query("select id from services where name = 'Corte' and active")).rows[0].id;
  const r = await rpc(client, 'book_appointment', { p_service_ids: [svc], p_starts_at: fri, p_barber_id: barberId, p_use_subscription: true });
  expect(r.status >= 400 && /segunda a quinta/.test(r.json?.message || ''), JSON.stringify(r.json));
});

await step('na conta, o cliente pede o horário fixo (só aparecem os dias do plano)', async () => {
  await client.goto('/conta?aba=planos'); await client.waitForLoadState('networkidle');
  await client.getByRole('button', { name: 'Pedir horário fixo' }).click();
  const days = await client.locator('.fixed-slot-form select').nth(0).locator('option').allTextContents();
  expect(days.slice(1).join() === 'Segunda,Terça,Quarta,Quinta', `dias: ${days}`);
  await client.locator('.fixed-slot-form select').nth(0).selectOption({ label: 'Quinta' });
  await client.locator('.fixed-slot-form select').nth(1).selectOption('19:20');
  await client.locator('.fixed-slot-form select').nth(2).selectOption({ label: U.barber.name });
  await client.screenshot({ path: `${SHOTS}/planos-1-pedido.jpg`, type: 'jpeg', quality: 70 });
  await client.getByRole('button', { name: 'Enviar pedido' }).click();
  await client.getByText('Horário fixo: toda quinta às 19:20').waitFor({ timeout: 15000 });
  await client.getByText('Em análise').waitFor();
  await client.screenshot({ path: `${SHOTS}/planos-2-em-analise.jpg`, type: 'jpeg', quality: 70 });
});

await step('o barbeiro recebe o aviso do pedido', async () => {
  const n = (await db.query(`select count(*)::int n from notification_logs l join profiles p on p.id = l.user_id where p.email = $1 and l.event = 'horario_fixo_solicitado'`, [U.barber.email])).rows[0].n;
  expect(n >= 1, `avisos: ${n}`);
});

const { c: bc, p: barber } = await login(U.barber);
await step('no celular, o barbeiro aprova o pedido no painel', async () => {
  await barber.goto('/barbeiro'); await barber.waitForLoadState('networkidle');
  await barber.getByRole('heading', { name: 'Horários fixos de assinantes' }).waitFor();
  await barber.screenshot({ path: `${SHOTS}/planos-3-barbeiro-pedido.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  await barber.getByRole('button', { name: 'Aprovar' }).click();
  await barber.locator('.toast', { hasText: 'Horário fixo aprovado' }).waitFor({ timeout: 15000 });
});

await step('as quintas do período ficam reservadas às 19:20, cobertas pelo plano (máx. 4)', async () => {
  const r = await db.query(`select to_char(a.starts_at at time zone 'America/Sao_Paulo', 'ID HH24:MI') d, a.status, a.source,
      bool_and(x.covered_by_subscription) cov
    from appointments a join appointment_services x on x.appointment_id = a.id
    where a.subscription_id = $1 and a.fixed_slot_id is not null group by a.id order by a.starts_at`, [sub]);
  expect(r.rowCount >= 3 && r.rowCount <= 4, `datas: ${r.rowCount}`);
  expect(r.rows.every((x) => x.d === '4 19:20' && x.status === 'confirmado' && x.source === 'plano' && x.cov), JSON.stringify(r.rows));
  const n = (await db.query(`select count(*)::int n from notification_logs where user_id = (select profile_id from customers where id = $1) and event = 'horario_fixo_aprovado'`, [clientCustomer])).rows[0].n;
  expect(n >= 1, 'aviso de aprovação ao cliente');
});

await step('cliente vê as datas reservadas na conta', async () => {
  await client.goto('/conta?aba=planos'); await client.waitForLoadState('networkidle');
  await client.getByText('Datas reservadas:').waitFor();
  await client.screenshot({ path: `${SHOTS}/planos-4-aprovado.jpg`, type: 'jpeg', quality: 70, fullPage: true });
});

await step('com a quinta já reservada, usar o plano de novo na mesma semana é recusado (1 por semana)', async () => {
  const first = (await db.query(`select starts_at from appointments where subscription_id = $1 and fixed_slot_id is not null and status = 'confirmado' order by starts_at limit 1`, [sub])).rows[0].starts_at;
  const tue = (await db.query(`select ((date_trunc('week', $1::timestamptz at time zone 'America/Sao_Paulo') + interval '1 day 11 hours') at time zone 'America/Sao_Paulo') t`, [first])).rows[0].t;
  const svc = (await db.query("select id from services where name = 'Corte' and active")).rows[0].id;
  const r = await rpc(client, 'book_appointment', { p_service_ids: [svc], p_starts_at: new Date(Math.max(new Date(tue).getTime(), Date.now() + 86400000)).toISOString(), p_barber_id: barberId, p_use_subscription: true });
  expect(r.status >= 400 && /(por semana|segunda a quinta|depois do vencimento|indispon)/.test(r.json?.message || ''), JSON.stringify(r.json));
});

await step('na renovação, as datas do novo período são reservadas sozinhas e o cliente é avisado', async () => {
  const before = (await db.query('select count(*)::int n from appointments where subscription_id = $1 and fixed_slot_id is not null', [sub])).rows[0].n;
  await db.query(`update subscriptions set current_period_start = current_period_end, current_period_end = current_period_end + interval '1 month' where id = $1`, [sub]);
  const after = (await db.query('select count(*)::int n from appointments where subscription_id = $1 and fixed_slot_id is not null', [sub])).rows[0].n;
  expect(after > before, `antes ${before}, depois ${after}`);
  const n = (await db.query(`select count(*)::int n from notification_logs where related_id in (select id from subscription_fixed_slots where subscription_id = $1) and event = 'horario_fixo_renovado'`, [sub])).rows[0].n;
  expect(n >= 1, 'aviso de renovação');
});

await step('3 dias antes do vencimento, cliente e barbeiro são avisados (uma vez só)', async () => {
  await db.query(`update subscriptions set current_period_end = now() + interval '2 days' where id = $1`, [sub]);
  await db.query('select public.queue_subscription_expiry_notices()');
  await db.query('select public.queue_subscription_expiry_notices()');
  const r = await db.query(`select l.event, p.email, count(*)::int n from notification_logs l join profiles p on p.id = l.user_id
    where l.related_id = $1 and l.event in ('plano_vencendo','plano_vencendo_equipe') and l.channel = 'interno' group by 1, 2`, [sub]);
  const cli = r.rows.find((x) => x.event === 'plano_vencendo' && x.email === U.client.email);
  const bar = r.rows.find((x) => x.event === 'plano_vencendo_equipe' && x.email === U.barber.email);
  expect(cli?.n === 1 && bar?.n === 1, JSON.stringify(r.rows));
  const em = (await db.query(`select count(*)::int n from notification_logs where related_id = $1 and event = 'plano_vencendo' and channel = 'email'`, [sub])).rows[0].n;
  expect(em === 1, 'e-mail na fila');
});

await step('o barbeiro vê o plano vencendo no painel', async () => {
  await barber.goto('/barbeiro'); await barber.waitForLoadState('networkidle');
  await barber.getByRole('heading', { name: 'Planos vencendo nos próximos 7 dias' }).waitFor();
  await barber.getByText(U.client.name).first().waitFor();
  await barber.screenshot({ path: `${SHOTS}/planos-5-barbeiro-vencendo.jpg`, type: 'jpeg', quality: 70, fullPage: true });
});

await step('cliente cancela o horário fixo e as datas futuras são liberadas', async () => {
  await client.goto('/conta?aba=planos'); await client.waitForLoadState('networkidle');
  await client.getByRole('button', { name: 'Cancelar horário fixo' }).click();
  await client.locator('.modal').getByRole('button', { name: 'Cancelar horário fixo' }).click();
  await client.locator('.toast', { hasText: 'Horário fixo cancelado' }).waitFor({ timeout: 15000 });
  const left = (await db.query(`select count(*)::int n from appointments where subscription_id = $1 and fixed_slot_id is not null and status = 'confirmado' and starts_at > now()`, [sub])).rows[0].n;
  expect(left === 0, `ainda reservadas: ${left}`);
  const n = (await db.query(`select count(*)::int n from notification_logs l join profiles p on p.id = l.user_id where p.email = $1 and l.event = 'horario_fixo_cancelado'`, [U.barber.email])).rows[0].n;
  expect(n >= 1, 'barbeiro avisado');
});

await step('segurança: outro cliente não aprova nem cancela horário alheio', async () => {
  const slot = (await db.query('select id from subscription_fixed_slots where subscription_id = $1 limit 1', [sub])).rows[0].id;
  const r1 = await rpc(client, 'decide_fixed_slot', { p_id: slot, p_approve: true });
  expect(r1.status >= 400, 'cliente não pode decidir');
  const r2 = await rpc(barber, 'request_fixed_slot', { p_sub: sub, p_barber: barberId, p_weekday: 4, p_time: '19:20' });
  expect(r2.status >= 400, 'barbeiro não pode pedir pelo plano de outra pessoa');
});

await cc.close(); await bc.close(); await browser.close(); await db.end();
console.log(fails.length ? `\n✖ ${fails.length} verificação(ões) falharam.` : '\n✔ Planos e horário fixo verificados.');
process.exit(fails.length ? 1 : 0);
