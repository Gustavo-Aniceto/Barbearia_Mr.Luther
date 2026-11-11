import { NextResponse } from 'next/server';
import { getIdentity } from '@/lib/server/identity';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const me = await getIdentity();
    return NextResponse.json({ user: me ? { id: me.profileId, email: me.email } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[me]', e);
    return NextResponse.json({ user: null }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
