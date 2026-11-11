import { NextResponse, after } from 'next/server';
import { asUser } from '@/lib/server/db';
import { executeData, toHttpError, type DataRequest } from '@/lib/server/data-api';
import { getIdentity } from '@/lib/server/identity';
import { sameOrigin } from '@/lib/server/http';
import { dispatchNotifications } from '@/lib/server/notify';
import { cancelGatewaySubscription } from '@/lib/server/payments';

// Operações que geram avisos ao cliente: o envio acontece logo depois da resposta, sem atrasá-la.
const NOTIFYING = new Set(['book_appointment', 'cancel_appointment', 'reschedule_appointment', 'set_appointment_status',
  'subscribe_plan', 'set_subscription_status', 'receive_payment', 'place_order', 'update_order_status', 'register_payment']);

export const dynamic = 'force-dynamic';

/** Operações de dados da interface. Identidade vem da sessão (servidor); autorização é aplicada pelo banco (RLS + funções). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  let body: DataRequest;
  try { body = await req.json(); } catch { return NextResponse.json({ message: 'Requisição inválida' }, { status: 400 }); }
  try {
    const me = await getIdentity();
    const data = await asUser(me?.profileId ?? null, (c) => executeData(c, body));
    if (body.op === 'rpc' && NOTIFYING.has(String((body as { fn?: string }).fn))) {
      after(() => dispatchNotifications().catch((e) => console.error('notificações:', e)));
    }
    // Plano cancelado no site: encerra também a recorrência no Asaas (para de gerar faturas).
    if (body.op === 'rpc' && body.fn === 'set_subscription_status' && ['cancelada', 'expirada'].includes(String(body.args?.p_status))) {
      const subId = String(body.args?.p_sub || '');
      after(() => cancelGatewaySubscription(subId).catch((e) => console.error('asaas cancelamento:', e)));
    }
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const { status, body: b } = toHttpError(e);
    return NextResponse.json(b, { status });
  }
}
