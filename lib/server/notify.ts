import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './db';

/**
 * Envio das notificações da fila (notification_logs) por e-mail e SMS via Brevo.
 * Docs: https://developers.brevo.com/reference/send-transac-email
 *       https://developers.brevo.com/reference/send-async-transactional-sms
 *
 * - Só envia canais configurados; sem configuração, as mensagens ficam na fila (nunca são marcadas como enviadas).
 * - Mensagens com mais de 48 h na fila expiram (evita avisos atrasados quando o provedor é ligado depois).
 * - Cada linha é "reservada" com FOR UPDATE SKIP LOCKED: duas execuções simultâneas não enviam em dobro.
 */
const BREVO = 'https://api.brevo.com/v3';
const MAX_ATTEMPTS = 5;

export const emailReady = () => !!(process.env.BREVO_API_KEY && process.env.NOTIFY_EMAIL_FROM);
export const smsReady = () => !!(process.env.BREVO_API_KEY && process.env.NOTIFY_SMS_SENDER);

type Row = { id: string; user_id: string; event: string; channel: 'email' | 'sms'; title: string; body: string | null; related_id: string | null; attempts: number };
type Ctx = {
  profile: { full_name: string; email: string; phone: string | null; anonymized_at: string | null } | undefined;
  biz: { name: string; address: string | null; maps_url: string | null; whatsapp: string | null; timezone: string };
  appt?: { code: string; starts_at: string; total: string; is_minimum: boolean; barber: string; services: string; status: string } | undefined;
  plan?: { name: string; price: string; period_months: number } | undefined;
};

const APPT_EVENTS = new Set(['agendamento_realizado', 'agendamento_confirmado', 'lembrete_atendimento', 'cancelamento', 'reagendamento']);
const PLAN_EVENTS = new Set(['plano_contratado', 'plano_vencendo']);

export async function dispatchNotifications(limit = 25): Promise<{ sent: number; failed: number; pending: number }> {
  const channels = [emailReady() && 'email', smsReady() && 'sms'].filter(Boolean) as string[];
  if (!channels.length) return { sent: 0, failed: 0, pending: 0 };
  const c = await getPool().connect();
  let sent = 0, failed = 0;
  try {
    await c.query(`update notification_logs set status = 'aguardando_integracao' where status = 'enviando' and created_at < now() - interval '10 minutes' and attempts < $1`, [MAX_ATTEMPTS]);
    await c.query(`update notification_logs set status = 'falhou', last_error = 'Expirada: não enviada em 48 h'
      where status = 'aguardando_integracao' and channel = any($1) and created_at < now() - interval '48 hours'`, [channels]);
    const { rows } = await c.query<Row>(`update notification_logs n set status = 'enviando', attempts = n.attempts + 1
      where n.id in (select id from notification_logs where status = 'aguardando_integracao' and channel = any($1)
                     order by created_at limit $2 for update skip locked)
      returning n.id, n.user_id, n.event, n.channel, n.title, n.body, n.related_id, n.attempts`, [channels, limit]);
    for (const r of rows) {
      try {
        const ctx = await loadContext(c, r);
        const id = r.channel === 'email' ? await sendEmail(r, ctx) : await sendSms(r, ctx);
        await c.query(`update notification_logs set status = 'enviada', sent_at = now(), provider_message_id = $2, last_error = null where id = $1`, [r.id, id]);
        sent++;
      } catch (e) {
        const err = e as SendError;
        const final = err.permanent || r.attempts >= MAX_ATTEMPTS;
        await c.query(`update notification_logs set status = $2, last_error = $3 where id = $1`, [r.id, final ? 'falhou' : 'aguardando_integracao', String(err.message).slice(0, 500)]);
        if (final) failed++;
      }
    }
    const p = await c.query<{ n: number }>(`select count(*)::int n from notification_logs where status = 'aguardando_integracao' and channel = any($1)`, [channels]);
    return { sent, failed, pending: p.rows[0].n };
  } finally {
    c.release();
  }
}

class SendError extends Error { constructor(msg: string, public permanent = false) { super(msg); } }

async function loadContext(c: PoolClient, r: Row): Promise<Ctx> {
  const profile = (await c.query(`select full_name, email, phone, anonymized_at from profiles where id = $1`, [r.user_id])).rows[0];
  const biz = (await c.query(`select name, address, maps_url, whatsapp, timezone from business_settings where id = 1`)).rows[0];
  const ctx: Ctx = { profile, biz };
  if (r.related_id && APPT_EVENTS.has(r.event)) {
    ctx.appt = (await c.query(`select a.code, a.starts_at, a.total_price::text total, a.status::text,
        b.display_name barber, string_agg(s.service_name, ', ' order by s.service_name) services,
        bool_or(coalesce(sv.price_is_minimum, false)) is_minimum
      from appointments a join barbers b on b.id = a.barber_id
      left join appointment_services s on s.appointment_id = a.id left join services sv on sv.id = s.service_id
      where a.id = $1 group by a.id, b.display_name`, [r.related_id])).rows[0];
  }
  if (r.related_id && PLAN_EVENTS.has(r.event)) {
    ctx.plan = (await c.query(`select pl.name, pl.price::text price, pl.period_months from subscriptions su join plans pl on pl.id = su.plan_id where su.id = $1`, [r.related_id])).rows[0];
  }
  return ctx;
}

// ---------------------------------------------------------------- formatação
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mrluder-barbearia.vercel.app').replace(/\/$/, '');
const money = (v: string | number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const when = (iso: string, tz: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long' });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return { day, time, short: `${d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' })} as ${time}` };
};
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const firstName = (n: string) => n.trim().split(/\s+/)[0];
const waLink = (n: string | null) => { const d = (n || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.startsWith('55') ? d : '55' + d}` : null; };

function details(ctx: Ctx): [string, string][] {
  const out: [string, string][] = [];
  if (ctx.appt) {
    const w = when(ctx.appt.starts_at, ctx.biz.timezone);
    out.push(['Data', w.day], ['Horário', w.time], ['Profissional', ctx.appt.barber]);
    if (ctx.appt.services) out.push(['Serviços', ctx.appt.services]);
    out.push(['Valor', `${ctx.appt.is_minimum ? 'a partir de ' : ''}${money(ctx.appt.total)}`], ['Código', ctx.appt.code]);
  }
  if (ctx.plan) out.push(['Plano', ctx.plan.name], ['Valor', `${money(ctx.plan.price)} por ${ctx.plan.period_months === 1 ? 'mês' : `${ctx.plan.period_months} meses`}`]);
  return out;
}

// ---------------------------------------------------------------- e-mail
async function sendEmail(r: Row, ctx: Ctx): Promise<string> {
  const p = ctx.profile;
  if (!p || p.anonymized_at || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new SendError('Destinatário sem e-mail válido', true);
  const rows = details(ctx);
  const wa = waLink(ctx.biz.whatsapp);
  const cta = ctx.appt ? 'Ver meus agendamentos' : 'Abrir minha conta';
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F2EC;font-family:Arial,Helvetica,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EC;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3dfd5">
<tr><td style="background:#293328;color:#F4F2EC;padding:22px 28px;font-size:18px;font-weight:bold;letter-spacing:2px">${esc(ctx.biz.name)}</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;font-size:15px">Olá, ${esc(firstName(p.full_name))}.</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#293328">${esc(r.title)}</h1>
${r.body ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${esc(r.body)}</p>` : ''}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3dfd5;margin-bottom:20px">${rows.map(([k, v]) =>
  `<tr><td style="padding:10px 0;border-bottom:1px solid #e3dfd5;color:#6b675e;font-size:14px;width:120px">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #e3dfd5;font-size:15px;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>` : ''}
${ctx.biz.address ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.5"><strong>Endereço:</strong> ${esc(ctx.biz.address)}${ctx.biz.maps_url ? ` · <a href="${esc(ctx.biz.maps_url)}" style="color:#414D3C">ver no mapa</a>` : ''}</p>` : ''}
<a href="${site()}/conta" style="display:inline-block;background:#414D3C;color:#F4F2EC;text-decoration:none;padding:12px 20px;font-size:15px;font-weight:bold">${cta}</a>
${wa ? `<p style="margin:20px 0 0;font-size:14px">Precisa mudar algo? <a href="${wa}" style="color:#414D3C">Fale com a barbearia no WhatsApp</a>.</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;background:#F4F2EC;color:#6b675e;font-size:12px;line-height:1.5">Você recebe este aviso porque tem uma conta na ${esc(ctx.biz.name)}. Avisos sobre seus agendamentos, pedidos e planos são enviados mesmo sem aceitar novidades e ofertas.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Olá, ${firstName(p.full_name)}.`, '', r.title, r.body || '', '', ...rows.map(([k, v]) => `${k}: ${v}`),
    ctx.biz.address ? `\nEndereço: ${ctx.biz.address}` : '', `\n${cta}: ${site()}/conta`, wa ? `WhatsApp: ${wa}` : ''].join('\n');
  const res = await fetch(`${BREVO}/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.NOTIFY_EMAIL_FROM, name: process.env.NOTIFY_EMAIL_NAME || ctx.biz.name },
      to: [{ email: p.email, name: p.full_name }],
      ...(process.env.NOTIFY_REPLY_TO ? { replyTo: { email: process.env.NOTIFY_REPLY_TO } } : {}),
      subject: `${r.title} · ${ctx.biz.name}`,
      htmlContent: html, textContent: text, tags: [r.event],
    }),
  });
  return providerResult(res);
}

// ---------------------------------------------------------------- SMS
/** SMS em texto simples (sem acentos) para caber em 1–2 mensagens. */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
export function normalizeBrPhone(raw: string | null): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return '55' + d;
  return null;
}

async function sendSms(r: Row, ctx: Ctx): Promise<string> {
  const p = ctx.profile;
  const to = p && !p.anonymized_at ? normalizeBrPhone(p.phone) : null;
  if (!to) throw new SendError('Cliente sem celular válido cadastrado', true);
  let msg: string;
  if (ctx.appt) {
    const w = when(ctx.appt.starts_at, ctx.biz.timezone);
    msg = `${ctx.biz.name}: ${r.title}. ${w.short} com ${ctx.appt.barber}${ctx.appt.services ? ` - ${ctx.appt.services}` : ''}. Cod ${ctx.appt.code}.`;
    if (r.event !== 'cancelamento' && ctx.biz.address) msg += ` ${ctx.biz.address.split(' - ')[0]}.`;
  } else {
    msg = `${ctx.biz.name}: ${r.title}. ${r.body || ''}`;
  }
  msg = plain(`${msg} ${site().replace(/^https?:\/\//, '')}/conta`).replace(/\s+/g, ' ').trim().slice(0, 300);
  const res = await fetch(`${BREVO}/transactionalSMS/send`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: process.env.NOTIFY_SMS_SENDER, recipient: to, content: msg, type: 'transactional', tag: r.event }),
  });
  return providerResult(res);
}

async function providerResult(res: Response): Promise<string> {
  const txt = await res.text();
  if (res.ok) { try { return String(JSON.parse(txt).messageId ?? ''); } catch { return ''; } }
  // 4xx (exceto 429) = dados inválidos: não adianta repetir. 429/5xx = tenta de novo depois.
  throw new SendError(`Brevo ${res.status}: ${txt.slice(0, 300)}`, res.status >= 400 && res.status < 500 && res.status !== 429);
}
