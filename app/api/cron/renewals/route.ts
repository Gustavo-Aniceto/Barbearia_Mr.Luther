import { NextResponse } from 'next/server';
import { asOwner } from '@/lib/server/db';
import { dispatchNotifications } from '@/lib/server/notify';
import { runBackup } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';

export const maxDuration = 120;

/** Rotina diária (Vercel Cron, ver vercel.json): backup, renovações de planos, lembretes da véspera, aviso de plano vencendo e envio da fila de avisos. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Não autorizado', { status: 401 });
  // Backup primeiro; uma falha nele é registrada mas não impede o restante da rotina.
  let backup: unknown;
  try { backup = await runBackup(); } catch (e) { console.error('backup:', e); backup = { error: (e as Error).message }; }
  const n = await asOwner(async (c) => (await c.query('select public.process_subscription_renewals() as n')).rows[0].n);
  const reminders = await asOwner(async (c) => (await c.query('select public.queue_appointment_reminders() as n')).rows[0].n);
  // Plano vencendo em até 3 dias: avisa o cliente e o barbeiro (uma vez por período)
  const expiring = await asOwner(async (c) => (await c.query('select public.queue_subscription_expiry_notices() as n')).rows[0].n);
  const notifications = await dispatchNotifications(200);
  return NextResponse.json({ backup, processed: n, reminders, expiring, notifications }, { status: backup && (backup as { error?: string }).error ? 500 : 200 });
}
