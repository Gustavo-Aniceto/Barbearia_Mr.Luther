import { NextResponse } from 'next/server';
import { vapidKeys } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

/** Chave pública VAPID: o navegador precisa dela para inscrever o aparelho. (A chave privada nunca sai do servidor.) */
export async function GET() {
  const { publicKey } = await vapidKeys();
  return NextResponse.json({ publicKey }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
