// Verifica a tela "Meus ganhos" do barbeiro em um ambiente de TESTES (nunca em produção).
// Uso: BASE_URL=http://localhost:3000 BARBER_ID=<uuid do barbeiro> PASS=<senha> node --env-file=.env.local tests/e2e/ganhos.mjs
import fs from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/shots'; fs.mkdirSync(SHOTS, { recursive: true });
const email = 'barbeiro.ganhos@example.com';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await db.connect();
const browser = await chromium.launch();
const ok = (m) => console.log('  ok -', m);
let fails = 0; const fail = (m) => { fails++; console.log('  FALHOU -', m); };

// conta de teste
let ctx = await browser.newContext({ baseURL: BASE }); let p = await ctx.newPage();
if (!(await db.query('select 1 from profiles where email = $1', [email])).rowCount) {
  await p.goto('/cadastro');
  await p.getByLabel('Nome completo').fill('Barbeiro Ganhos'); await p.locator('input[type=email]').fill(email);
  await p.getByLabel('Telefone / WhatsApp').fill('(11) 91111-0009'); await p.locator('input[type=password]').fill(process.env.PASS);
  await p.locator('.consent input[type=checkbox]').first().check(); await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/\/conta/, { timeout: 30000 });
}
const prof = (await db.query('select id from profiles where email = $1', [email])).rows[0].id;
await db.query('update barbers set profile_id = null where profile_id = $1 and id <> $2', [prof, process.env.BARBER_ID]);
await db.query('update barbers set profile_id = $1 where id = $2', [prof, process.env.BARBER_ID]);
await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'barbeiro' on conflict do nothing", [prof]);
await ctx.close();

const expected = (await db.query("select coalesce(sum(amount),0)::numeric s from commissions where barber_id = $1 and status = 'pendente'", [process.env.BARBER_ID])).rows[0].s;
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
for (const [name, viewport] of [['desktop', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  ctx = await browser.newContext({ baseURL: BASE, viewport }); p = await ctx.newPage();
  await p.goto('/entrar'); await p.locator('input[type=email]').fill(email); await p.locator('input[type=password]').fill(process.env.PASS);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForURL((u) => !u.pathname.startsWith('/entrar'), { timeout: 30000 });
  await p.goto('/barbeiro/comissoes'); await p.locator('.earn-total').waitFor({ timeout: 20000 });
  const total = ((await p.locator('.earn-total').textContent()) || '').replace(/ /g, ' ');
  total === brl(expected) ? ok(`${name}: a receber ${total}`) : fail(`${name}: a receber ${total}, esperado ${brl(expected)}`);
  (await p.getByRole('heading', { name: 'Repasses recebidos' }).count()) ? ok(`${name}: seção de repasses`) : fail(`${name}: sem repasses`);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  over <= 1 ? ok(`${name}: sem rolagem lateral`) : fail(`${name}: página ${over}px mais larga que a tela`);
  await p.screenshot({ path: `${SHOTS}/ganhos-${name}.png`, fullPage: true });
  await ctx.close();
}
// cliente não acessa
ctx = await browser.newContext({ baseURL: BASE }); p = await ctx.newPage();
const r = await p.request.post('/api/data', { headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: { op: 'rpc', fn: 'my_earnings', args: { p_from: '2026-11-01', p_to: '2026-11-30' } } });
r.status() === 403 ? ok('visitante não vê ganhos (403)') : fail(`visitante recebeu ${r.status()}`);
await browser.close(); await db.end();
console.log(fails ? `✘ ${fails} falha(s)` : '✔ tela Meus ganhos ok'); process.exit(fails ? 1 : 0);
