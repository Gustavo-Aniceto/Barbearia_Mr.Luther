import { NextResponse } from 'next/server';
import { asOwner } from '@/lib/server/db';
import { dispatchNotifications } from '@/lib/server/notify';

export const dynamic = 'force-dynamic';

/** Rotina diária (Vercel Cron, ver vercel.json): renovações de planos, lembretes da véspera e envio da fila de avisos. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Não autorizado', { status: 401 });
  const n = await asOwner(async (c) => (await c.query('select public.process_subscription_renewals() as n')).rows[0].n);
  const reminders = await asOwner(async (c) => (await c.query('select public.queue_appointment_reminders() as n')).rows[0].n);
  const notifications = await dispatchNotifications(200);
  return NextResponse.json({ processed: n, reminders, notifications });
}
