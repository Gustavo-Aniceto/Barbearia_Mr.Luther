import 'server-only';
import { asOwner } from './db';
import { asaas, asaasReady } from './asaas';

/** Encerra no Asaas a assinatura ligada a um plano cancelado no site (se houver). */
export async function cancelGatewaySubscription(subscriptionId: string): Promise<void> {
  if (!asaasReady() || !/^[0-9a-f-]{36}$/i.test(subscriptionId)) return;
  const r = await asOwner((c) => c.query<{ gid: string | null; auto_renew: boolean; status: string }>(
    `select gateway_subscription_id gid, auto_renew, status from subscriptions where id = $1 and gateway = 'asaas'`, [subscriptionId]));
  const s = r.rows[0];
  // Só se o cancelamento foi aceito pelo banco (renovação desligada). Benefícios já pagos continuam até o fim do período.
  if (!s?.gid || (s.auto_renew && !['cancelada', 'expirada'].includes(s.status))) return;
  await asaas.deleteSubscription(s.gid);
}
