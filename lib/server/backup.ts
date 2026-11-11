import 'server-only';
import { gzipSync } from 'node:zlib';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getPool } from './db';
import { getStorage } from './storage';

/**
 * Backup diário dos DADOS do banco (todas as tabelas do schema public) em JSON compactado,
 * gravado no bucket privado de backups do Neon Object Storage, com retenção de 30 dias.
 * A ESTRUTURA vem das migrations (migrations/*.sql): para restaurar, aplique as migrations num
 * branch novo e importe o arquivo com scripts/restore-backup.mjs (ver docs/OPERACAO.md).
 * A leitura é feita numa transação somente leitura e "repeatable read": todas as tabelas
 * saem do mesmo instante, coerentes entre si.
 */
const RETENTION_DAYS = 30;
export const backupBucket = () => process.env.BACKUP_BUCKET || 'mrluder-backups';

export async function runBackup(): Promise<{ key: string; tables: number; rows: number; bytes: number; removed: number }> {
  const c = await getPool().connect();
  const data: Record<string, unknown[]> = {};
  let migration = '', rows = 0;
  try {
    await c.query('begin isolation level repeatable read read only');
    const tables = (await c.query<{ t: string }>(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t);
    for (const t of tables) {
      const ident = '"' + t.replace(/"/g, '""') + '"';
      const r = (await c.query<{ j: unknown[] }>(`select coalesce(json_agg(x), '[]'::json) j from public.${ident} x`)).rows[0].j;
      data[t] = r; rows += r.length;
    }
    migration = (await c.query<{ v: string }>(`select max(version) v from app.schema_migrations`).catch(() => ({ rows: [{ v: '' }] }))).rows[0].v || '';
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13); // AAAAMMDDTHHMM
  const key = `db/mrluder-${stamp}.json.gz`;
  const body = gzipSync(Buffer.from(JSON.stringify({ format: 'mrluder-backup/1', created_at: now.toISOString(), migration, tables: data })));
  const s3 = getStorage();
  await s3.send(new PutObjectCommand({ Bucket: backupBucket(), Key: key, Body: body, ContentType: 'application/gzip' }));

  // Retenção: apaga cópias com mais de 30 dias (nunca a que acabou de ser gravada).
  let removed = 0;
  const cutoff = now.getTime() - RETENTION_DAYS * 86400e3;
  const list = await s3.send(new ListObjectsV2Command({ Bucket: backupBucket(), Prefix: 'db/' }));
  for (const o of list.Contents || []) {
    if (o.Key && o.Key !== key && o.LastModified && o.LastModified.getTime() < cutoff) {
      await s3.send(new DeleteObjectCommand({ Bucket: backupBucket(), Key: o.Key }));
      removed++;
    }
  }
  return { key, tables: Object.keys(data).length, rows, bytes: body.length, removed };
}
