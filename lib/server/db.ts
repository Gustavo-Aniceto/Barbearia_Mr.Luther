import 'server-only';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { env } from './env';

// Conexão TCP com pool, recomendada pela Neon e pela Vercel para Fluid compute.
// Docs: https://neon.com/docs/guides/vercel-connection-methods
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env('DATABASE_URL'), max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 });
    attachDatabasePool(pool);
  }
  return pool;
}

/**
 * Executa `fn` numa TRANSAÇÃO como o usuário informado:
 *   SET LOCAL ROLE app_user  → as políticas RLS passam a valer
 *   app.profile_id           → identidade lida por app.uid() nas políticas e funções
 * Qualquer erro desfaz tudo (rollback). Usado em todas as operações de usuário,
 * inclusive agendamentos e lançamentos financeiros.
 */
export async function asUser<T>(profileId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local role app_user');
    await client.query("select set_config('app.profile_id', $1, true)", [profileId ?? '']);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Transação com o papel proprietário. Somente para rotinas internas do servidor (webhook, cron, provisionamento). */
export async function asOwner<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
