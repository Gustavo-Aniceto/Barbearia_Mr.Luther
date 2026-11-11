'use server';
import { getAuth } from '@/lib/server/auth';
import { provisionProfile } from '@/lib/server/identity';

// Server actions de autenticação (Managed Better Auth). Rodam só no servidor e
// gravam o cookie de sessão httpOnly. Docs: neon.com/docs/auth/quick-start/nextjs

const META_KEYS = ['full_name', 'phone', 'birth_date', 'accepted_terms', 'marketing_email', 'marketing_whatsapp', 'ref_code', 'user_agent'] as const;
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

type Result = { error?: string; needsVerification?: boolean };
const message = (error: unknown) => (error as { message?: string; code?: string })?.message || (error as { code?: string })?.code || 'Não foi possível concluir. Tente novamente.';

export async function signUpAction(input: { email: string; password: string; meta: Record<string, unknown> }): Promise<Result> {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!emailOk(email)) return { error: 'E-mail inválido' };
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return { error: 'A senha deve ter ao menos 8 caracteres, com letras e números' };
  if (input.meta?.accepted_terms !== true) return { error: 'É preciso aceitar os termos para criar a conta' };
  const meta: Record<string, unknown> = {};
  for (const k of META_KEYS) if (input.meta?.[k] !== undefined && input.meta?.[k] !== null) meta[k] = typeof input.meta[k] === 'string' ? String(input.meta[k]).slice(0, 300) : input.meta[k];
  const name = String(meta.full_name || email.split('@')[0]).slice(0, 120);

  const { data, error } = await getAuth().signUp.email({ email, password, name });
  if (error) return { error: message(error) };
  const user = (data as { user?: { id: string; email: string; name?: string } } | null)?.user;
  if (user?.id) await provisionProfile({ id: user.id, email: user.email || email, name }, meta);
  const token = (data as { token?: string | null } | null)?.token;
  return { needsVerification: !token };
}

export async function signInAction(input: { email: string; password: string }): Promise<Result> {
  const email = String(input.email || '').trim().toLowerCase();
  if (!emailOk(email) || !input.password) return { error: 'E-mail ou senha incorretos' };
  const { error } = await getAuth().signIn.email({ email, password: String(input.password) });
  if (error) return { error: message(error) };
  return {};
}

export async function signOutAction(): Promise<void> {
  await getAuth().signOut();
}
