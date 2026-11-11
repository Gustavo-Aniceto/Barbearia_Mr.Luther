import { NextResponse, after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { asOwner } from '@/lib/server/db';
import { dispatchNotifications } from '@/lib/server/notify';

export const dynamic = 'force-dynamic';

// Webhook do gateway (Asaas ou Mercado Pago), ativo quando PAYMENT_PROVIDER estiver definido.
// Asaas: cobranças avulsas usam externalReference = transactions.id; mensalidades são ligadas pelo id da assinatura.
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  after(() => dispatchNotifications().catch((e) => console.error('notificações:', e)));
  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider) return new Response('Gateway não configurado', { status: 503 });
  try {
    if (provider === 'asaas') {
      // Autenticação: token definido por nós ao registrar o webhook (header asaas-access-token).
      const token = process.env.ASAAS_WEBHOOK_TOKEN || '';
      if (!token || !eq(req.headers.get('asaas-access-token') || '', token)) return new Response('Não autorizado', { status: 401 });
      const body = await req.json();
      const run = (sql: string, args: unknown[]) => asOwner(async (c) => (await c.query(sql, args)).rows[0].r as string);
      const p = body?.payment;
      const sub = body?.subscription;
      let result = 'ignorado';
      // Idempotente: eventos repetidos não pagam duas vezes (gateway_reference único por pagamento aprovado).
      if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(body?.event) && p?.id) {
        if (p.subscription) {
          result = await run('select public.gateway_confirm_subscription_payment($1, $2, $3, $4) as r', ['asaas', p.subscription, p.id, p.value]);
        } else if (typeof p.externalReference === 'string' && /^[0-9a-f-]{36}$/i.test(p.externalReference)) {
          result = await run('select public.gateway_confirm_payment($1::uuid, $2, $3, $4) as r', [p.externalReference, 'asaas', p.id, p.value]);
        }
      } else if (body?.event === 'PAYMENT_OVERDUE' && p?.subscription) {
        result = await run('select public.gateway_subscription_overdue($1, $2) as r', ['asaas', p.subscription]);
      } else if (['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'].includes(body?.event) && sub?.id) {
        result = await run('select public.gateway_subscription_ended($1, $2) as r', ['asaas', sub.id]);
      }
      return NextResponse.json({ received: true, result });
    }
    if (provider === 'mercado_pago') {
      // A notificação traz só o id: o status é sempre consultado na API do provedor.
      const body = await req.json();
      const id = body?.data?.id;
      if (!id || body.type !== 'payment') return NextResponse.json({ ignored: true });
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` } });
      const pay = await res.json();
      if (pay.status !== 'approved') return NextResponse.json({ status: pay.status });
      const r = await asOwner((c) => c.query('select public.gateway_confirm_payment($1, $2, $3, $4) as r', [pay.external_reference, 'mercado_pago', String(pay.id), pay.transaction_amount]));
      return NextResponse.json({ result: r.rows[0].r });
    }
    return new Response('Provedor desconhecido', { status: 400 });
  } catch (e) {
    // Regra de negócio recusou (ex.: lançamento inexistente ou já cancelado): registra e confirma o recebimento,
    // para o Asaas não pausar a fila. Falha técnica (banco fora do ar etc.): 500, e o provedor reenvia.
    const code = (e as { code?: string }).code;
    console.error('[webhook]', code, (e as Error).message);
    if (code === 'P0001' || code === '22P02') return NextResponse.json({ received: true, result: 'recusado', reason: (e as Error).message });
    return new Response('Erro', { status: 500 });
  }
}
