import 'server-only';

/**
 * Cliente mínimo da API v3 do Asaas (somente servidor).
 * Docs: https://docs.asaas.com/reference — autenticação pelo header `access_token`.
 * O ambiente sai do prefixo da chave: $aact_prod_ → produção; $aact_hmlg_ → sandbox.
 */
const key = () => process.env.ASAAS_API_KEY || '';
export const asaasEnv = () => (key().startsWith('$aact_prod_') ? 'producao' : 'sandbox');
const base = () => (asaasEnv() === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3');
export const asaasReady = () => process.env.PAYMENT_PROVIDER === 'asaas' && /^\$aact_(prod|hmlg)_/.test(key());

export class AsaasError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(base() + path, {
    method,
    headers: { access_token: key(), 'Content-Type': 'application/json', 'User-Agent': 'MRLUDER-Barbearia/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const txt = await res.text();
  let json: any = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* resposta não JSON */ }
  if (!res.ok) {
    const msg = json?.errors?.map((e: { description?: string }) => e.description).filter(Boolean).join(' ') || `Asaas respondeu ${res.status}`;
    throw new AsaasError(msg, res.status);
  }
  return json as T;
}

export type AsaasPayment = { id: string; status: string; value: number; dueDate: string; invoiceUrl: string; subscription?: string | null; externalReference?: string | null };

export const asaas = {
  createCustomer: (c: { name: string; cpfCnpj: string; email?: string; mobilePhone?: string; externalReference: string }) =>
    call<{ id: string }>('POST', '/customers', { ...c, notificationDisabled: false }),
  createSubscription: (s: { customer: string; value: number; nextDueDate: string; cycle: string; description: string; externalReference: string; successUrl: string }) =>
    call<{ id: string }>('POST', '/subscriptions', {
      customer: s.customer, billingType: 'UNDEFINED', value: s.value, nextDueDate: s.nextDueDate, cycle: s.cycle,
      description: s.description, externalReference: s.externalReference, callback: { successUrl: s.successUrl, autoRedirect: true },
    }),
  subscriptionPayments: (id: string) => call<{ data: AsaasPayment[] }>('GET', `/subscriptions/${encodeURIComponent(id)}/payments`),
  deleteSubscription: (id: string) => call<unknown>('DELETE', `/subscriptions/${encodeURIComponent(id)}`),
  createPayment: (p: { customer: string; value: number; dueDate: string; description: string; externalReference: string; successUrl: string }) =>
    call<AsaasPayment>('POST', '/payments', {
      customer: p.customer, billingType: 'UNDEFINED', value: p.value, dueDate: p.dueDate,
      description: p.description, externalReference: p.externalReference, callback: { successUrl: p.successUrl, autoRedirect: true },
    }),
  listWebhooks: () => call<{ data: { id: string; url: string; enabled: boolean; interrupted: boolean }[] }>('GET', '/webhooks'),
  createWebhook: (w: { url: string; email: string; authToken: string }) =>
    call<{ id: string }>('POST', '/webhooks', {
      name: 'MR.LUDER site', url: w.url, email: w.email, enabled: true, interrupted: false, apiVersion: 3,
      authToken: w.authToken, sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'],
    }),
};

/** Ciclo do Asaas a partir da duração do plano em meses. */
export function cycleFor(months: number): string {
  return ({ 1: 'MONTHLY', 2: 'BIMONTHLY', 3: 'QUARTERLY', 6: 'SEMIANNUALLY', 12: 'YEARLY' } as Record<number, string>)[months] || '';
}

/** Valida CPF (dígitos verificadores). Retorna só os dígitos, ou null. */
export function cleanCpf(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}

/** Data de hoje em São Paulo (YYYY-MM-DD). */
export const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
