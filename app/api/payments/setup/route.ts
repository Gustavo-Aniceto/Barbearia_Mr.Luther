import { NextResponse } from 'next/server';
import { asaas, asaasEnv, asaasReady } from '@/lib/server/asaas';

export const dynamic = 'force-dynamic';

/**
 * Registra (uma vez) o webhook do site no Asaas, com o token secreto ASAAS_WEBHOOK_TOKEN.
 * Protegido pelo mesmo segredo da rotina diária (Authorization: Bearer CRON_SECRET). Idempotente.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Não autorizado', { status: 401 });
  if (!asaasReady()) return NextResponse.json({ message: 'Configure PAYMENT_PROVIDER=asaas e ASAAS_API_KEY' }, { status: 503 });
  const token = process.env.ASAAS_WEBHOOK_TOKEN || '';
  if (token.length < 32) return NextResponse.json({ message: 'ASAAS_WEBHOOK_TOKEN ausente ou curto (mínimo 32)' }, { status: 503 });
  const url = `${(process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')}/api/webhooks/payments`;
  const existing = (await asaas.listWebhooks()).data || [];
  const found = existing.find((w) => w.url === url);
  if (found) return NextResponse.json({ environment: asaasEnv(), webhook: found.id, created: false, enabled: found.enabled, interrupted: found.interrupted });
  const email = process.env.NOTIFY_REPLY_TO || process.env.NOTIFY_EMAIL_FROM || '';
  const w = await asaas.createWebhook({ url, email, authToken: token });
  return NextResponse.json({ environment: asaasEnv(), webhook: w.id, created: true });
}
