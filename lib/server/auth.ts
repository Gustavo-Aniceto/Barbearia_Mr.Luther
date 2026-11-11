import 'server-only';
import { createNeonAuth } from '@neon/auth/next/server';
import { env } from './env';

// Managed Better Auth (Neon). Docs: https://neon.com/docs/auth/reference/nextjs-server
// Instância criada sob demanda para não exigir variáveis de ambiente durante o build.
let instance: ReturnType<typeof createNeonAuth> | undefined;

export function getAuth() {
  instance ??= createNeonAuth({
    baseUrl: env('NEON_AUTH_BASE_URL'),
    cookies: { secret: env('NEON_AUTH_COOKIE_SECRET'), sameSite: 'lax' },
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  });
  return instance;
}
