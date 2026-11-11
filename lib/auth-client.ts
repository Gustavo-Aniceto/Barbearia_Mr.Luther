'use client';
import { createAuthClient } from '@neon/auth/next';

// Cliente do Managed Better Auth no navegador. Fala com /api/auth/* (mesma origem);
// não contém segredos. Docs: neon.com/docs/auth/quick-start/nextjs
export const authClient = createAuthClient();
