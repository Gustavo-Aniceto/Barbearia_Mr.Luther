// Restaura um backup diário (db/mrluder-*.json.gz do bucket mrluder-backups) num banco que já
// tem a estrutura aplicada pelas migrations (node scripts/migrate.mjs).
// Uso: DATABASE_URL="postgres://... (conexão direta)" node scripts/restore-backup.mjs mrluder-AAAAMMDDTHHMM.json.gz
//
// Tudo numa única transação: se algo falhar, nada muda. Os dados atuais das tabelas do schema public
// são SUBSTITUÍDOS pelos do backup. Use num branch novo do Neon e só depois aponte a Vercel para ele.
import fs from 'node:fs';
import zlib from 'node:zlib';
import pg from 'pg';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('Uso: DATABASE_URL=... node scripts/restore-backup.mjs <arquivo.json.gz>');
  process.exit(1);
}
const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
if (dump.format !== 'mrluder-backup/1') throw new Error('Arquivo não é um backup da MR.LUDER');
const q = (t) => '"' + t.replace(/"/g, '""') + '"';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query('begin');
  const existing = new Set((await c.query(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')`)).rows.map((r) => r.t));
  const tables = Object.keys(dump.tables).filter((t) => existing.has(t));
  const missing = Object.keys(dump.tables).filter((t) => !existing.has(t));
  if (missing.length) console.warn('Tabelas do backup que não existem neste banco (ignoradas):', missing.join(', '));

  // Ordem de inserção respeitando as chaves estrangeiras (pais antes dos filhos).
  const deps = new Map(tables.map((t) => [t, new Set()]));
  const fk = await c.query(`select cl.relname child, pr.relname parent from pg_constraint k
    join pg_class cl on cl.oid = k.conrelid join pg_class pr on pr.oid = k.confrelid
    join pg_namespace n on n.oid = cl.relnamespace where k.contype = 'f' and n.nspname = 'public'`);
  for (const { child, parent } of fk.rows) if (deps.has(child) && deps.has(parent) && child !== parent) deps.get(child).add(parent);
  const order = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((t) => [...deps.get(t)].every((p) => !pending.has(p)));
    const batch = ready.length ? ready : [...pending]; // ciclo: insere o restante (uma instrução por tabela)
    for (const t of batch) { order.push(t); pending.delete(t); }
  }

  // Gatilhos de usuário desligados durante a carga (auditoria, avisos, vínculos automáticos).
  for (const t of tables) await c.query(`alter table public.${q(t)} disable trigger user`);
  await c.query(`truncate ${tables.map((t) => 'public.' + q(t)).join(', ')} cascade`);
  let total = 0;
  for (const t of order) {
    const rows = dump.tables[t];
    if (!rows.length) continue;
    // Colunas gravadas (sem as calculadas); ids de identidade mantêm o valor original (OVERRIDING SYSTEM VALUE).
    const cols = (await c.query(`select a.attname from pg_attribute a where a.attrelid = ('public.' || quote_ident($1))::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum`, [t])).rows.map((r) => q(r.attname)).join(', ');
    // Uma instrução por tabela: referências da tabela para ela mesma são verificadas no fim da instrução.
    await c.query(`insert into public.${q(t)} (${cols}) overriding system value
      select ${cols} from json_populate_recordset(null::public.${q(t)}, $1::json)`, [JSON.stringify(rows)]);
    total += rows.length;
    console.log(`  ${t}: ${rows.length}`);
  }
  for (const t of tables) await c.query(`alter table public.${q(t)} enable trigger user`);

  // Sequências (se houver) continuam a partir do maior valor restaurado.
  const seqs = await c.query(`select s.relname seq, t.relname tbl, a.attname col from pg_class s
    join pg_depend d on d.objid = s.oid and d.deptype in ('a','i') join pg_class t on t.oid = d.refobjid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid join pg_namespace n on n.oid = s.relnamespace
    where s.relkind = 'S' and n.nspname = 'public'`);
  for (const s of seqs.rows) {
    await c.query(`select setval('public.${q(s.seq)}', coalesce((select max(${q(s.col)}) from public.${q(s.tbl)}), 0) + 1, false)`);
  }
  await c.query('commit');
  console.log(`\nRestaurado: ${total} registros em ${order.length} tabelas (backup de ${dump.created_at}, estrutura ${dump.migration}).`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('Falhou, nada foi alterado:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
