import { NextResponse } from 'next/server';
import { asOwner } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Rotina diária (Vercel Cron, ver vercel.json): vencimentos e renovações de planos. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Não autorizado', { status: 401 });
  const n = await asOwner(async (c) => (await c.query('select public.process_subscription_renewals() as n')).rows[0].n);
  return NextResponse.json({ processed: n });
}
