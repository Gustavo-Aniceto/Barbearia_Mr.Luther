import { NextResponse } from 'next/server';
import { asOwner, asUser } from '@/lib/server/db';
import { getIdentity } from '@/lib/server/identity';
import { sameOrigin } from '@/lib/server/http';
import { asaas, asaasReady, AsaasError, cleanCpf, cycleFor, todaySP } from '@/lib/server/asaas';

export const dynamic = 'force-dynamic';

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mrluder-barbearia.vercel.app').replace(/\/$/, '');
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** GET: informa se o pagamento online está disponível (para mostrar o botão). */
export async function GET() {
  if (!asaasReady()) return json({ enabled: false });
  const r = await asOwner((c) => c.query<{ on: boolean }>(`select online_payments_enabled and provider = 'asaas' as on from payment_settings where id = 1`));
  return json({ enabled: !!r.rows[0]?.on });
}

/**
 * POST { kind: 'plano' | 'pedido', id, cpf? } → { url } da fatura no Asaas (Pix, boleto ou cartão).
 * A posse do plano/pedido é conferida com as regras do banco (RLS) usando a sessão do usuário.
 * O CPF só é pedido na primeira vez (cadastro do pagador no Asaas) e não é guardado no site.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ message: 'Origem não permitida' }, 403);
  const me = await getIdentity();
  if (!me) return json({ message: 'Faça login para pagar' }, 401);
  if (!(await GET().then((r) => r.json())).enabled) return json({ message: 'Pagamento online indisponível no momento. Pague na barbearia.' }, 503);
  let body: { kind?: string; id?: string; cpf?: string };
  try { body = await req.json(); } catch { return json({ message: 'Requisição inválida' }, 400); }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id) || !['plano', 'pedido'].includes(String(body.kind))) return json({ message: 'Requisição inválida' }, 400);

  try {
    // 1) Posse e situação, com as permissões do próprio usuário.
    const item = await asUser(me.profileId, async (c) => {
      if (body.kind === 'plano') {
        return (await c.query(`select s.id, s.status, s.customer_id, s.gateway_subscription_id, pl.name, pl.price::float8 price, pl.period_months
          from subscriptions s join plans pl on pl.id = s.plan_id where s.id = $1`, [body.id])).rows[0];
      }
      return (await c.query(`select o.id, o.code, o.status, o.customer_id, o.total::float8 total from orders o where o.id = $1`, [body.id])).rows[0];
    });
    if (!item) return json({ message: 'Não encontrado' }, 404);

    // 2) Pagador no Asaas (criado uma vez por cliente).
    const cust = (await asOwner((c) => c.query(`select c.id, c.full_name, c.gateway_customer_id, coalesce(c.email, p.email) email, coalesce(c.phone, p.phone) phone
      from customers c left join profiles p on p.id = c.profile_id where c.id = $1`, [item.customer_id]))).rows[0];
    let customerId: string = cust.gateway_customer_id;
    if (!customerId) {
      const cpf = cleanCpf(body.cpf);
      if (!cpf) return json({ needCpf: true, message: body.cpf ? 'CPF inválido. Confira os números.' : 'Informe o CPF do pagador para gerar a cobrança.' }, 422);
      const phone = String(cust.phone || '').replace(/\D/g, '');
      customerId = (await asaas.createCustomer({ name: cust.full_name, cpfCnpj: cpf, email: cust.email || undefined,
        mobilePhone: /^\d{10,11}$/.test(phone) ? phone : undefined, externalReference: cust.id })).id;
      await asOwner((c) => c.query(`update customers set gateway_customer_id = $2 where id = $1`, [cust.id, customerId]));
    }

    // 3a) Plano: assinatura recorrente no Asaas; devolve a fatura em aberto.
    if (body.kind === 'plano') {
      if (!['pendente', 'inadimplente', 'ativa'].includes(item.status)) return json({ message: 'Este plano não tem pagamento em aberto.' }, 409);
      let subId: string = item.gateway_subscription_id;
      if (!subId) {
        const cycle = cycleFor(Number(item.period_months));
        if (!cycle) return json({ message: 'Duração do plano sem cobrança recorrente no Asaas. Fale com a barbearia.' }, 409);
        subId = (await asaas.createSubscription({ customer: customerId, value: Number(item.price), nextDueDate: todaySP(), cycle,
          description: `Plano ${item.name} · MR.LUDER`, externalReference: item.id, successUrl: `${site()}/conta?aba=planos&pago=1` })).id;
        await asOwner((c) => c.query(`update subscriptions set gateway = 'asaas', gateway_subscription_id = $2 where id = $1`, [item.id, subId]));
      }
      const pays = (await asaas.subscriptionPayments(subId)).data || [];
      const open = pays.filter((p) => ['PENDING', 'OVERDUE'].includes(p.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      if (!open) return json({ message: item.status === 'ativa' ? 'Seu plano está em dia. A próxima fatura chega por e-mail.' : 'A fatura ainda está sendo gerada. Tente de novo em instantes.' }, 409);
      return json({ url: open.invoiceUrl });
    }

    // 3b) Pedido da loja: cobrança avulsa ligada ao lançamento pendente do pedido.
    if (item.status !== 'aguardando_pagamento') return json({ message: 'Este pedido não está aguardando pagamento.' }, 409);
    const t = (await asOwner((c) => c.query(`select id, amount::float8 amount, gateway_invoice_url from transactions
      where order_id = $1 and status = 'pendente' order by created_at limit 1`, [item.id]))).rows[0];
    if (!t) return json({ message: 'Não há valor em aberto neste pedido.' }, 409);
    if (t.gateway_invoice_url) return json({ url: t.gateway_invoice_url });
    const pay = await asaas.createPayment({ customer: customerId, value: Number(t.amount), dueDate: todaySP(),
      description: `Pedido #${item.code} · MR.LUDER`, externalReference: t.id, successUrl: `${site()}/conta?aba=pedidos&pago=1` });
    await asOwner((c) => c.query(`update transactions set gateway_payment_id = $2, gateway_invoice_url = $3 where id = $1`, [t.id, pay.id, pay.invoiceUrl]));
    return json({ url: pay.invoiceUrl });
  } catch (e) {
    if (e instanceof AsaasError) {
      console.error('asaas checkout:', e.status, e.message);
      return json({ message: e.status === 400 ? `Não foi possível gerar a cobrança: ${e.message}` : 'O sistema de pagamento não respondeu. Tente de novo em instantes.' }, 502);
    }
    console.error('checkout:', e);
    return json({ message: 'Erro ao gerar o pagamento' }, 500);
  }
}
