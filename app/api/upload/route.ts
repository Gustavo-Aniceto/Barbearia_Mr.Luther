import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { asUser } from '@/lib/server/db';
import { getIdentity } from '@/lib/server/identity';
import { bucket, getStorage } from '@/lib/server/storage';
import { sameOrigin } from '@/lib/server/http';
import { toHttpError } from '@/lib/server/data-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const MAX = 4 * 1024 * 1024; // abaixo do limite de corpo das funções da Vercel

// Verifica o conteúdo real do arquivo (não só o tipo declarado)
function sniff(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.subarray(4, 12).toString() === 'ftypavif') return 'image/avif';
  return null;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  const me = await getIdentity().catch(() => null);
  if (!me) return NextResponse.json({ message: 'Faça login' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const folder = String(form?.get('folder') || 'geral');
  if (!(file instanceof File)) return NextResponse.json({ message: 'Arquivo ausente' }, { status: 400 });
  if (!/^[a-z0-9_-]{2,30}$/.test(folder)) return NextResponse.json({ message: 'Pasta inválida' }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ message: 'A imagem deve ter até 4 MB' }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type || !TYPES[type]) return NextResponse.json({ message: 'Envie uma imagem JPG, PNG, WEBP ou AVIF' }, { status: 415 });

  try {
    const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${TYPES[type]}`;
    // 1) permissão verificada no banco antes de gravar no storage
    const allowed = await asUser(me.profileId, async (c) => (await c.query(
      `select public.has_permission('site','criar') or public.has_permission('servicos','editar')
          or public.has_permission('produtos','editar') or public.has_permission('equipe','editar') as ok`)).rows[0].ok);
    if (!allowed) return NextResponse.json({ message: 'Sem permissão para enviar imagens' }, { status: 403 });
    // 2) binário no Neon Object Storage
    await getStorage().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buf, ContentType: type, CacheControl: 'public, max-age=31536000, immutable' }));
    // 3) referência + metadados no banco (RLS confere novamente)
    await asUser(me.profileId, (c) => c.query(
      'insert into media_files (bucket, object_key, content_type, size_bytes, original_name, folder, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7)',
      [bucket(), key, type, buf.length, file.name.slice(0, 200), folder, me.profileId]));
    return NextResponse.json({ url: `/api/media/${key}` });
  } catch (e) {
    const { status, body } = toHttpError(e);
    return NextResponse.json(body, { status });
  }
}
