// Notificações do app (Web Push). Rode SOMENTE contra banco de TESTE e servidor local:
//   BASE_URL=http://localhost:3000 DATABASE_URL_UNPOOLED=<branch de teste> CRON_SECRET=<o do .env.local> PASS=<senha> node tests/e2e/push.mjs
// O envio real ao serviço de push é simulado com endpoints https públicos que respondem 201 (aceito) e 410 (aparelho não existe mais).
import crypto from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASS = process.env.PASS; if (!PASS) { console.error('Defina PASS'); process.exit(2); }
const RUN = Math.random().toString(36).slice(2, 8);
const U = {
  client: { name: 'Cliente Push', email: `cliente.push.${RUN}@example.com`, phone: '(11) 93333-0001' },
  barber: { name: 'Barbeiro Push', email: `barbeiro.push.${RUN}@example.com`, phone: '(11) 93333-0002' },
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await db.connect();
const browser = await chromium.launch();
const fails = [];
const step = async (name, fn) => { try { await fn(); console.log('  ok -', name); } catch (e) { fails.push(name); console.log('  FALHOU -', name, '→', String(e.message).split('\n')[0]); } };
const expect = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = async (email) => (await db.query('select id from profiles where email = $1', [email])).rows[0].id;
const fakeKeys = () => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
};
const dispatch = async () => {
  const r = await fetch(`${BASE}/api/cron/renewals`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(r.ok, `rotina de envio respondeu ${r.status}`);
};

async function signup(u) {
  const c = await browser.newContext({ baseURL: BASE }); const p = await c.newPage();
  await p.goto('/cadastro');
  await p.getByLabel('Nome completo').fill(u.name); await p.locator('input[type=email]').fill(u.email);
  await p.getByLabel('Telefone / WhatsApp').fill(u.phone); await p.locator('input[type=password]').fill(PASS);
  await p.locator('.consent input[type=checkbox]').first().check(); await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/\/conta/, { timeout: 30000 }); await c.close();
}

console.log(`\nMR.LUDER — notificações do app em ${BASE}\n`);
let clientId, barberProfile, barberId;

await step('cadastro do cliente e do barbeiro de teste', async () => {
  for (const u of Object.values(U)) await signup(u);
  clientId = await prof(U.client.email); barberProfile = await prof(U.barber.email);
  barberId = (await db.query(`insert into barbers (display_name, profile_id, active, accepts_online_booking, sort_order)
    values ('Barbeiro Push', $1, true, true, 98) returning id`, [barberProfile])).rows[0].id;
  await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'barbeiro' on conflict do nothing", [barberProfile]);
});

await step('chave pública do app disponível (privada nunca sai do servidor)', async () => {
  const r = await (await fetch(`${BASE}/api/push`)).json();
  expect(/^[A-Za-z0-9_-]{80,90}$/.test(r.publicKey) && !('privateKey' in r), 'chave pública');
});

await step('na conta, o cliente vê "Ativar notificações" e o aparelho é inscrito ao tocar', async () => {
  // Chromium "completo" em modo sem tela: concede a permissão (o modo enxuto padrão nega notificações)
  const full = await chromium.launch({ channel: 'chromium' });
  const c = await full.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
  await c.grantPermissions(['notifications'], { origin: BASE });
  const p = await c.newPage();
  await p.goto('/entrar'); await p.locator('input[type=email]').fill(U.client.email); await p.locator('input[type=password]').fill(PASS);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForURL((u) => !u.pathname.startsWith('/entrar'));
  await p.goto('/conta?aba=avisos');
  await p.getByRole('button', { name: 'Ativar notificações' }).click();
  // O navegador de teste pode não alcançar o serviço de push do Google; nesse caso a tela mostra o erro sem travar.
  await p.getByText(/Ativas neste aparelho|Não foi possível ativar as notificações neste navegador/).first().waitFor({ timeout: 20000 });
  const on = await p.getByText('Ativas neste aparelho').isVisible();
  await p.screenshot({ path: '/tmp/shots/push-conta.jpg', type: 'jpeg', quality: 70 });
  if (on) {
    const n = (await db.query('select count(*)::int n from push_subscriptions where user_id = $1', [clientId])).rows[0].n;
    expect(n >= 1, 'inscrição não gravada');
    console.log('     (inscrição real no serviço de push do navegador)');
    await db.query('delete from push_subscriptions where user_id = $1', [clientId]); // segue com o simulador
  } else {
    // Sem acesso ao serviço de push do Google (normal em servidor de teste): a tela precisa explicar, sem travar.
    expect(await p.getByRole('button', { name: 'Ativar notificações' }).isVisible(), 'botão sumiu após a falha');
    console.log('     (servidor de teste sem serviço de push do Google: a tela avisou com clareza)');
  }
  await c.close(); await full.close();
});

await step('segurança: inscrição só pela própria conta, e ninguém lê aparelhos de outros', async () => {
  const c = await browser.newContext({ baseURL: BASE }); const p = await c.newPage(); await p.goto('/');
  const r = await p.evaluate(async () => (await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'rpc', fn: 'save_push_subscription', args: { p_endpoint: 'https://example.com/x', p_p256dh: 'a', p_auth: 'b' } }) })).status);
  expect(r === 401 || r === 403, `visitante inscreveu aparelho (${r})`);
  const s = await p.evaluate(async () => (await (await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'select', table: 'push_subscriptions' }) })).json()));
  expect(!s.data || s.data.length === 0, 'visitante leu inscrições');
  await c.close();
});

await step('aviso ao cliente entra na fila "app" e é entregue (serviço de push aceitou)', async () => {
  const k = fakeKeys();
  await db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $4, $2, $3)`, [clientId, k.p256dh, k.auth, `https://httpbin.org/status/201?r=${RUN}`]);
  await db.query(`select notify_user($1, 'lembrete_atendimento', 'Lembrete: amanhã às 10:00', 'Corte com Barbeiro Push', null)`, [clientId]);
  const q = (await db.query(`select status from notification_logs where user_id = $1 and channel = 'push' order by created_at desc limit 1`, [clientId])).rows[0];
  expect(q && q.status === 'aguardando_integracao', `fila: ${q?.status}`);
  await dispatch();
  const r = (await db.query(`select status, last_error, provider_message_id from notification_logs where user_id = $1 and channel = 'push' order by created_at desc limit 1`, [clientId])).rows[0];
  expect(r.status === 'enviada' && r.provider_message_id === 'push:1', `envio: ${r.status} ${r.last_error || ''}`);
});

await step('quem não ativou não recebe push (só e-mail e aviso interno)', async () => {
  const other = await prof(U.barber.email);
  await db.query('delete from push_subscriptions where user_id = $1', [other]);
  await db.query(`select notify_user($1, 'plano_vencendo_equipe', 't', 'b', null)`, [other]);
  const n = (await db.query(`select count(*)::int n from notification_logs where user_id = $1 and channel = 'push'`, [other])).rows[0].n;
  expect(n === 0, 'push enfileirado sem aparelho');
});

await step('barbeiro é avisado de novo agendamento e de cancelamento pelo cliente', async () => {
  const k = fakeKeys();
  await db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $4, $2, $3)`, [barberProfile, k.p256dh, k.auth, `https://httpbin.org/status/201?b=${RUN}`]);
  const svc = (await db.query(`select id from services where active and bookable_online order by duration_minutes limit 1`)).rows[0].id;
  await db.query('insert into barber_services (barber_id, service_id) values ($1, $2) on conflict do nothing', [barberId, svc]);
  // horário livre daqui a 2 dias, como o cliente (permissões do próprio cliente)
  const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  await db.query('begin'); await db.query('set local role app_user'); await db.query(`select set_config('app.profile_id', $1, true)`, [clientId]);
  const slots = (await db.query(`select * from get_available_slots($1::date, array[$2::uuid], $3::uuid)`, [day, svc, barberId])).rows;
  expect(slots.length, 'sem horário livre para o teste');
  const appt = (await db.query(`select book_appointment(array[$1::uuid], $2::timestamptz, $3::uuid) as id`, [svc, slots[0].starts_at, barberId])).rows[0].id;
  await db.query('commit');
  const novo = (await db.query(`select title, body from notification_logs where user_id = $1 and event = 'novo_agendamento_equipe' and channel = 'push'`, [barberProfile])).rows[0];
  expect(novo && /Cliente Push/.test(novo.body), 'aviso de novo agendamento');
  await db.query('begin'); await db.query('set local role app_user'); await db.query(`select set_config('app.profile_id', $1, true)`, [clientId]);
  await db.query(`select cancel_appointment($1, 'teste')`, [appt]); await db.query('commit');
  const canc = (await db.query(`select count(*)::int n from notification_logs where user_id = $1 and event = 'cancelamento_equipe' and channel = 'push'`, [barberProfile])).rows[0].n;
  expect(canc === 1, 'aviso de cancelamento');
  await dispatch();
  const sent = (await db.query(`select count(*)::int n from notification_logs where user_id = $1 and channel = 'push' and status = 'enviada'`, [barberProfile])).rows[0].n;
  expect(sent === 2, `entregues ao barbeiro: ${sent}`);
});

await step('aparelho que não existe mais (410) é removido e o aviso não fica preso', async () => {
  await db.query('delete from push_subscriptions where user_id = $1', [clientId]);
  const k = fakeKeys();
  await db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $4, $2, $3)`, [clientId, k.p256dh, k.auth, `https://httpbin.org/status/410?r=${RUN}`]);
  await db.query(`select notify_user($1, 'agendamento_confirmado', 'Confirmado', 'x', null)`, [clientId]);
  await dispatch();
  const left = (await db.query('select count(*)::int n from push_subscriptions where user_id = $1', [clientId])).rows[0].n;
  const r = (await db.query(`select status from notification_logs where user_id = $1 and channel = 'push' order by created_at desc limit 1`, [clientId])).rows[0];
  expect(left === 0 && r.status === 'falhou', `aparelhos: ${left}, aviso: ${r.status}`);
});

await step('SMS desligado: nenhum aviso novo vai para a fila de SMS', async () => {
  await db.query(`select notify_user($1, 'agendamento_realizado', 't', 'b', null)`, [clientId]);
  const n = (await db.query(`select count(*)::int n from notification_logs where user_id = $1 and channel = 'sms'`, [clientId])).rows[0].n;
  expect(n === 0, 'SMS enfileirado');
});

await browser.close(); await db.end();
console.log(fails.length ? `\n✖ ${fails.length} verificação(ões) falharam.` : '\n✔ Notificações do app verificadas.');
process.exit(fails.length ? 1 : 0);
