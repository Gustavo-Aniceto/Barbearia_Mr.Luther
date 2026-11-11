import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { asOwner } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// Webhook do gateway (Asaas ou Mercado Pago). Preparado, ativo somente quando PAYMENT_PROVIDER estiver definido.
// A cobrança deve ser criada com externalReference/external_reference = transactions.id.
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const provider = process.env.PAYMENT_PROVIDER;
  if (!provider) return new Response('Gateway não configurado', { status: 503 });
  try {
    if (provider === 'asaas') {
      const token = process.env.ASAAS_WEBHOOK_TOKEN || '';
      if (!token || !eq(req.headers.get('asaas-access-token') || '', token)) return new Response('Não autorizado', { status: 401 });
      const body = await req.json();
      if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(body.event)) return NextResponse.json({ ignored: body.event });
      const p = body.payment;
      const r = await asOwner((c) => c.query('select public.gateway_confirm_payment($1, $2, $3, $4) as r', [p.externalReference, 'asaas', p.id, p.value]));
      return NextResponse.json({ result: r.rows[0].r });
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
    console.error('[webhook]', e);
    return new Response('Erro', { status: 500 }); // o provedor reenvia
  }
}
