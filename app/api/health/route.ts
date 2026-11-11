import { NextResponse } from 'next/server';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { getPool } from '@/lib/server/db';
import { bucket, getStorage } from '@/lib/server/storage';

export const dynamic = 'force-dynamic';

/** Verificação de saúde para monitoramento externo (uptime). Não expõe dados. */
export async function GET() {
  const checks: Record<string, string> = {};
  const t0 = Date.now();
  try {
    const r = await getPool().query("select max(version) as v from app.schema_migrations");
    checks.database = 'ok'; checks.migration = r.rows[0].v ?? 'nenhuma';
  } catch { checks.database = 'erro'; }
  try { await getStorage().send(new HeadBucketCommand({ Bucket: bucket() })); checks.storage = 'ok'; }
  catch { checks.storage = 'erro'; }
  checks.auth = process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET ? 'configurado' : 'não configurado';
  const ok = checks.database === 'ok' && checks.storage === 'ok' && checks.auth === 'configurado';
  return NextResponse.json({ status: ok ? 'ok' : 'degradado', checks, ms: Date.now() - t0 }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
