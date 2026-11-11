import 'server-only';
import { getAuth } from './auth';
import { getPool } from './db';

export type Identity = { authUserId: string; email: string; name: string | null; profileId: string };

/**
 * Resolve o usuário a partir da sessão do Neon Auth (cookie httpOnly validado no servidor)
 * e garante o perfil correspondente no banco da aplicação.
 */
export async function getIdentity(meta?: Record<string, unknown>): Promise<Identity | null> {
  const { data } = await getAuth().getSession();
  const user = data?.user as { id: string; email: string; name?: string | null } | undefined;
  if (!user?.id) return null;
  return provisionProfile(user, meta);
}

export async function provisionProfile(user: { id: string; email: string; name?: string | null }, meta: Record<string, unknown> = {}): Promise<Identity> {
  const r = await getPool().query<{ id: string }>(
    'select app.ensure_profile($1, $2, $3, $4::jsonb) as id',
    [String(user.id), user.email, user.name ?? null, JSON.stringify(meta)],
  );
  return { authUserId: String(user.id), email: user.email, name: user.name ?? null, profileId: r.rows[0].id };
}
