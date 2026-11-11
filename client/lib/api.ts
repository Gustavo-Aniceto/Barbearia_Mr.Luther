'use client';
// Cliente do navegador. Fala SOMENTE com o servidor Next.js da própria aplicação:
//   /api/data    → operações de dados (validadas no servidor, executadas com RLS)
//   /api/me      → sessão atual (perfil)
//   /api/upload  → envio de imagens para o Neon Object Storage
//   server actions (app/actions/auth.ts) → cadastro, login e logout
// Nenhuma credencial de banco, storage ou auth existe no navegador.
import { signInAction, signOutAction, signUpAction } from '@/app/actions/auth';
import { authClient } from '@/lib/auth-client';

export type Session = { user: { id: string; email: string } };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }

let session: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();
function setSession(s: Session | null) { session = s; listeners.forEach((l) => l(s)); }
export const getSession = () => session;
export const onSession = (fn: (s: Session | null) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export async function loadSession(): Promise<Session | null> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json();
    setSession(j.user ? { user: j.user } : null);
  } catch { setSession(null); }
  return session;
}

function friendly(msg: string): string {
  if (/invalid email or password|invalid_email_or_password|invalid credentials/i.test(msg)) return 'E-mail ou senha incorretos';
  if (/already exists|user_already_exists|already registered/i.test(msg)) return 'Este e-mail já está cadastrado';
  if (/email not verified|email_not_verified/i.test(msg)) return 'Confirme seu e-mail antes de entrar';
  if (/invalid otp|invalid_otp|otp expired/i.test(msg)) return 'Código inválido ou expirado';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet.';
  return msg;
}

// Métodos do plugin Email OTP do Managed Better Auth (docs: neon.com/docs/auth/guides/plugins/email-otp)
const ac = authClient as any;
async function unwrap(p: Promise<{ data: any; error: any }>) {
  const { data, error } = await p;
  if (error) throw new ApiError(friendly(error.message || error.code || 'Erro de autenticação'), error.status || 400, error.code);
  return data;
}

export const auth = {
  async signUp(email: string, password: string, data: Record<string, unknown>) {
    const r = await signUpAction({ email, password, meta: data });
    if (r.error) throw new ApiError(friendly(r.error), 400);
    if (r.needsVerification) return { needsConfirmation: true };
    await loadSession();
    return { needsConfirmation: false };
  },
  async signIn(email: string, password: string) {
    const r = await signInAction({ email, password });
    if (r.error) throw new ApiError(friendly(r.error), 400);
    await loadSession();
  },
  async signOut() { await signOutAction(); setSession(null); },
  async verifyEmail(email: string, otp: string) { await unwrap(ac.emailOtp.verifyEmail({ email, otp })); return loadSession(); },
  resendVerification: (email: string) => unwrap(ac.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })),
  requestPasswordReset: (email: string) => unwrap(ac.forgetPassword.emailOtp({ email })),
  resetPassword: (email: string, otp: string, password: string) => unwrap(ac.emailOtp.resetPassword({ email, otp, password })),
  changePassword: (currentPassword: string, newPassword: string) => unwrap(ac.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })),
};

// ------------------------------------------------------------------ Dados
type Filter = Record<string, string | number | boolean | null | undefined>;
const OPS = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not)\./;
function toFilters(filters: Filter): [string, string][] {
  return Object.entries(filters).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, v === null ? 'is.null' : typeof v === 'string' && OPS.test(v) ? v : `eq.${v}`]);
}
async function call(body: object) {
  let res: Response;
  try {
    res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  } catch (e) { throw new ApiError(friendly((e as Error).message), 0); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setSession(null);
    throw new ApiError(friendly(j.message || `Erro ${res.status}`), res.status, j.code);
  }
  return j.data;
}

export const db = {
  select: <T = any>(table: string, filters: Filter = {}, opts: { select?: string; order?: string; limit?: number; offset?: number } = {}) =>
    call({ op: 'select', table, filters: toFilters(filters), ...opts }) as Promise<T[]>,
  insert: <T = any>(table: string, row: object | object[]) =>
    call({ op: 'insert', table, rows: Array.isArray(row) ? row : [row] }).then((r: T[]) => (Array.isArray(row) ? r : r[0])) as Promise<any>,
  update: <T = any>(table: string, filters: Filter, patch: object) =>
    call({ op: 'update', table, filters: toFilters(filters), patch }).then((r: T[]) => {
      if (r.length === 0) throw new ApiError('Você não tem permissão para alterar este registro', 403);
      return r;
    }),
  remove: (table: string, filters: Filter) =>
    call({ op: 'delete', table, filters: toFilters(filters) }).then((r: unknown[]) => {
      if (r.length === 0) throw new ApiError('Você não tem permissão para excluir este registro', 403);
    }),
  rpc: <T = any>(fn: string, args: object = {}) => call({ op: 'rpc', fn, args }) as Promise<T>,
};

// ------------------------------------------------------------------ Arquivos (Neon Object Storage via servidor)
export async function uploadImage(file: File, folder: string): Promise<string> {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new ApiError('Envie uma imagem JPG, PNG, WEBP ou AVIF', 415);
  if (file.size > 4 * 1024 * 1024) throw new ApiError('A imagem deve ter até 4 MB', 413);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', folder);
  const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(j.message || 'Falha no envio da imagem', res.status);
  return j.url as string;
}
