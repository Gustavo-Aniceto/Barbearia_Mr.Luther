import { getAuth } from '@/lib/server/auth';

// Encaminha as rotas do Managed Better Auth (cookies httpOnly) — docs: neon.com/docs/auth/reference/nextjs-server
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ path: string[] }> };
const h = () => getAuth().handler() as unknown as Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', (req: Request, ctx: Ctx) => Promise<Response>>;
export const GET = (req: Request, ctx: Ctx) => h().GET(req, ctx);
export const POST = (req: Request, ctx: Ctx) => h().POST(req, ctx);
export const PUT = (req: Request, ctx: Ctx) => h().PUT(req, ctx);
export const PATCH = (req: Request, ctx: Ctx) => h().PATCH(req, ctx);
export const DELETE = (req: Request, ctx: Ctx) => h().DELETE(req, ctx);
