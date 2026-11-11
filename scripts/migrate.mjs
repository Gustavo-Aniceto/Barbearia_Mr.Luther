// Aplica migrations/*.sql em ordem, uma vez cada, dentro de transação e com trava (advisory lock).
// Registra versão + checksum em app.schema_migrations e recusa migrations já aplicadas que foram alteradas.
// Uso: DATABASE_URL=... node scripts/migrate.mjs   (roda automaticamente no build da Vercel)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.warn('[migrate] DATABASE_URL ausente — migrations NÃO aplicadas. Conecte o Neon ao projeto e refaça o deploy.');
  process.exit(process.env.REQUIRE_MIGRATIONS === '1' ? 1 : 0);
}
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations');
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('select pg_advisory_lock(727274)');
  await client.query('create schema if not exists app');
  await client.query(`create table if not exists app.schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const done = new Map((await client.query('select version, checksum from app.schema_migrations')).rows.map((r) => [r.version, r.checksum]));
  let applied = 0;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const sum = crypto.createHash('sha256').update(sql).digest('hex');
    if (done.has(f)) {
      if (done.get(f) !== sum) throw new Error(`Migration ${f} foi alterada depois de aplicada. Crie uma nova migration em vez de editar.`);
      continue;
    }
    console.log(`[migrate] aplicando ${f}`);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into app.schema_migrations (version, checksum) values ($1, $2)', [f, sum]);
      await client.query('commit');
      applied++;
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Falha em ${f}: ${e.message}`);
    }
  }
  console.log(`[migrate] ok — ${applied} nova(s), ${files.length} no total`);
} finally {
  await client.query('select pg_advisory_unlock(727274)').catch(() => {});
  await client.end();
}
