// Cria (se faltarem) contas de dono, barbeiro e cliente num ambiente de TESTES e dá os perfis via SQL.
// Uso: BASE_URL=... OWNER_EMAIL/OWNER_PASS BARBER_EMAIL/BARBER_PASS CLIENT_EMAIL/CLIENT_PASS BARBER_ID=<uuid> node --env-file=.env.local tests/e2e/setup-accounts.mjs
import pg from 'pg';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED }); await db.connect();
const browser = await chromium.launch();
const accounts = [['OWNER', 'Dono Mobile'], ['BARBER', 'Barbeiro Mobile'], ['CLIENT', 'Cliente Mobile']];
for (const [k, nome] of accounts) {
  const email = process.env[`${k}_EMAIL`];
  if ((await db.query('select 1 from profiles where email = $1', [email])).rowCount) continue;
  const ctx = await browser.newContext({ baseURL: BASE }); const p = await ctx.newPage();
  await p.goto('/cadastro');
  await p.getByLabel('Nome completo').fill(nome); await p.locator('input[type=email]').fill(email);
  await p.getByLabel('Telefone / WhatsApp').fill('(11) 91111-0123'); await p.locator('input[type=password]').fill(process.env[`${k}_PASS`]);
  await p.locator('.consent input[type=checkbox]').first().check(); await p.getByRole('button', { name: 'Criar conta' }).click();
  await p.waitForURL(/\/conta/, { timeout: 30000 }); await ctx.close();
}
const id = async (e) => (await db.query('select id from profiles where email = $1', [e])).rows[0].id;
await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'proprietario' on conflict do nothing", [await id(process.env.OWNER_EMAIL)]);
const b = await id(process.env.BARBER_EMAIL);
await db.query('update barbers set profile_id = null where profile_id = $1', [b]);
await db.query('update barbers set profile_id = $1 where id = $2', [b, process.env.BARBER_ID]);
await db.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'barbeiro' on conflict do nothing", [b]);
await browser.close(); await db.end(); console.log('contas de teste prontas');
