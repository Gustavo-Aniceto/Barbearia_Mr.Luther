import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getPool } from '@/lib/server/db';
import { getStorage } from '@/lib/server/storage';

export const runtime = 'nodejs';

/** Entrega imagens do Neon Object Storage. Só serve objetos registrados em media_files. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join('/');
  if (!/^[a-z0-9_-]{2,30}\/[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/.test(key)) return new Response('Não encontrado', { status: 404 });
  const r = await getPool().query<{ bucket: string; content_type: string }>('select bucket, content_type from media_files where object_key = $1', [key]);
  if (!r.rows[0]) return new Response('Não encontrado', { status: 404 });
  try {
    const obj = await getStorage().send(new GetObjectCommand({ Bucket: r.rows[0].bucket, Key: key }));
    const body = obj.Body?.transformToWebStream();
    if (!body) return new Response('Não encontrado', { status: 404 });
    return new Response(body, { headers: { 'Content-Type': r.rows[0].content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Não encontrado', { status: 404 });
  }
}
