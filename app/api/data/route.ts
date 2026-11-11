import { NextResponse } from 'next/server';
import { asUser } from '@/lib/server/db';
import { executeData, toHttpError, type DataRequest } from '@/lib/server/data-api';
import { getIdentity } from '@/lib/server/identity';
import { sameOrigin } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Operações de dados da interface. Identidade vem da sessão (servidor); autorização é aplicada pelo banco (RLS + funções). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  let body: DataRequest;
  try { body = await req.json(); } catch { return NextResponse.json({ message: 'Requisição inválida' }, { status: 400 }); }
  try {
    const me = await getIdentity();
    const data = await asUser(me?.profileId ?? null, (c) => executeData(c, body));
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const { status, body: b } = toHttpError(e);
    return NextResponse.json(b, { status });
  }
}
