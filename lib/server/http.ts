import 'server-only';

/** Proteção contra CSRF: requisições que alteram estado precisam vir do próprio site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}
