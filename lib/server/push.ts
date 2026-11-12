import 'server-only';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import type { PoolClient } from 'pg';
import { asOwner } from './db';

/**
 * Notificações do próprio app (Web Push, padrão aberto dos navegadores).
 * O servidor assina com a chave VAPID da barbearia e entrega direto ao serviço de push do aparelho,
 * sem intermediário pago. Chave gerada uma única vez e guardada no banco (schema "app", fora do navegador).
 */
let cached: { publicKey: string; privateKey: string } | null = null;

export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  cached = await asOwner(async (c) => {
    const r = await c.query<{ public_key: string; private_key: string }>(`select public_key, private_key from app.push_keys where id = 1`);
    if (r.rows[0]) return { publicKey: r.rows[0].public_key, privateKey: r.rows[0].private_key };
    const k = generateVAPIDKeys();
    // "on conflict do nothing" + releitura: duas instâncias subindo juntas usam a mesma chave
    await c.query(`insert into app.push_keys (id, public_key, private_key) values (1, $1, $2) on conflict (id) do nothing`, [k.publicKey, k.privateKey]);
    const again = await c.query<{ public_key: string; private_key: string }>(`select public_key, private_key from app.push_keys where id = 1`);
    return { publicKey: again.rows[0].public_key, privateKey: again.rows[0].private_key };
  });
  return cached;
}

const subject = () => {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://mrluder-barbearia.vercel.app';
  return site.startsWith('https://') ? site : 'mailto:' + (process.env.NOTIFY_EMAIL_FROM || 'contato@example.com');
};

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/**
 * Envia para todos os aparelhos do usuário. Aparelho que não existe mais (404/410) é removido.
 * Retorna quantos receberam; lança erro se nenhum recebeu (para a fila tentar de novo ou encerrar).
 */
export async function sendPushToUser(c: PoolClient, userId: string, payload: PushPayload): Promise<number> {
  const keys = await vapidKeys();
  const subs = (await c.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1`, [userId])).rows;
  if (!subs.length) throw new PushError('Nenhum aparelho com notificações ativas', true);
  let ok = 0; let lastErr = '';
  for (const s of subs) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        TTL: 60 * 60 * 24, urgency: 'high', topic: payload.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') || undefined,
        vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      });
      ok++;
      await c.query(`update push_subscriptions set last_success_at = now() where id = $1`, [s.id]);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await c.query(`delete from push_subscriptions where id = $1`, [s.id]);
      lastErr = `${status || ''} ${(e as Error).message}`.trim();
    }
  }
  if (!ok) {
    const left = (await c.query<{ n: number }>(`select count(*)::int n from push_subscriptions where user_id = $1`, [userId])).rows[0].n;
    throw new PushError(lastErr || 'Falha no envio', left === 0); // sem aparelho válido: não adianta tentar de novo
  }
  return ok;
}

export class PushError extends Error { constructor(msg: string, public permanent = false) { super(msg); } }
