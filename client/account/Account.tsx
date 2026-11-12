'use client';
import React, { useEffect, useState } from 'react';
import { db } from '../lib/api';
import { APPT_STATUS, ORDER_STATUS, SUB_STATUS, WEEKDAYS, Link, money, fmtDate, fmtTime, fmtDateTime, fmtLongDate, isoDay, addDays, useAuth, useLoad, useQuery, navigate } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Icon, Input, Loading, Modal, Select, Stars, Textarea, Toggle, useConfirm, useToast } from '../lib/ui';
import { SiteLayout } from '../site/Home';
import { useSite } from '../site/data';

type Tab = 'agendamentos' | 'pedidos' | 'planos' | 'club' | 'avisos' | 'dados' | 'privacidade';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'agendamentos', label: 'Agendamentos', icon: 'calendar' }, { id: 'pedidos', label: 'Pedidos', icon: 'bag' },
  { id: 'planos', label: 'Planos', icon: 'crown' }, { id: 'club', label: 'Club e cupons', icon: 'gift' },
  { id: 'avisos', label: 'Avisos', icon: 'bell' }, { id: 'dados', label: 'Meus dados', icon: 'user' }, { id: 'privacidade', label: 'Privacidade', icon: 'shield' },
];

export function Account() {
  const { session, loading, access, signOut } = useAuth();
  const q = useQuery();
  const [tab, setTab] = useState<Tab>((q.get('aba') as Tab) || 'agendamentos');
  useEffect(() => { if (!loading && !session) navigate(`/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`, true); }, [loading, session]);
  // "Club e cupons" só aparece quando o proprietário ativa o programa de indicação ou quando o cliente tem algum cupom.
  const { site } = useSite();
  const [hasCoupons, setHasCoupons] = useState(false);
  useEffect(() => { if (session) db.select<any>('coupons', {}, { limit: 1 }).then((r) => setHasCoupons(r.length > 0)).catch(() => {}); }, [session]);
  const clubOn = !!site?.settings.referral_enabled || hasCoupons;
  const tabs = TABS.filter((t) => t.id !== 'club' || clubOn);
  useEffect(() => { if (site && tab === 'club' && !clubOn) setTab('agendamentos'); }, [site, tab, clubOn]);
  if (!session) return <SiteLayout><Loading /></SiteLayout>;
  return (
    <SiteLayout>
      <div className="wrap page">
        <div className="toolbar" style={{ marginBottom: 28 }}>
          <div><h1 className="page-title" style={{ marginBottom: 0 }}>Minha conta</h1><span className="muted">{session.user.email}</span></div>
          <span className="spacer" />
          {access?.is_staff && <Link to="/admin" className="btn btn-line btn-sm">Painel da equipe</Link>}
          <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate('/'))}>Sair</Button>
        </div>
        <div className="account">
          <nav className="account-nav" aria-label="Seções da conta">
            {tabs.map((t) => <button key={t.id} aria-current={tab === t.id} onClick={() => { setTab(t.id); history.replaceState(null, '', `/conta?aba=${t.id}`); }}><Icon name={t.icon} size={17} />{t.label}</button>)}
          </nav>
          <div>
            {tab === 'agendamentos' && <Appointments />}
            {tab === 'pedidos' && <Orders />}
            {tab === 'planos' && <Plans />}
            {tab === 'club' && <Club />}
            {tab === 'avisos' && <Notifications />}
            {tab === 'dados' && <Profile />}
            {tab === 'privacidade' && <Privacy />}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

// ------------------------------------------------------------------ Agendamentos
function Appointments() {
  const { data, error, loading, reload } = useLoad(() => db.rpc<any[]>('my_appointments'));
  const { site } = useSite();
  const confirm = useConfirm();
  const toast = useToast();
  const [resched, setResched] = useState<any>(null);
  const [review, setReview] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const now = Date.now();
  const upcoming = data!.filter((a) => new Date(a.starts_at).getTime() > now - 3600e3 && ['pendente', 'confirmado', 'cliente_chegou', 'em_atendimento'].includes(a.status)).reverse();
  const history = data!.filter((a) => !upcoming.includes(a));
  const cancelHours = Number(site?.settings.cancel_min_hours || 0);
  const canChange = (a: any) => ['pendente', 'confirmado'].includes(a.status) && new Date(a.starts_at).getTime() - now > cancelHours * 3600e3;
  const hasFinished = data!.some((a) => a.status === 'finalizado');

  const row = (a: any, actions: boolean) => (
    <div className="appt" key={a.id}>
      <div className="appt-date"><strong>{fmtDate(a.starts_at, { day: '2-digit' })}</strong><span>{fmtDate(a.starts_at, { month: 'short' }).replace('.', '')}</span></div>
      <div>
        <h3>{a.services}</h3>
        <div className="muted" style={{ fontSize: 14 }}>{fmtLongDate(a.starts_at)}, {fmtTime(a.starts_at)} · {a.barber_name} · {money(a.total_price)}</div>
        <div style={{ marginTop: 6 }}><Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge> <span className="cell-sub">#{a.code}</span></div>
      </div>
      {actions && (
        <div className="appt-actions">
          {canChange(a) ? (<>
            <Button size="sm" variant="line" onClick={() => setResched(a)}>Reagendar</Button>
            <Button size="sm" variant="ghost" onClick={async () => {
              if (!(await confirm({ title: 'Cancelar agendamento?', text: `${a.services} em ${fmtDateTime(a.starts_at)}. O horário será liberado para outros clientes.`, confirm: 'Cancelar agendamento', danger: true }))) return;
              try { await db.rpc('cancel_appointment', { p_id: a.id, p_reason: 'Cancelado pelo cliente no site' }); toast.ok('Agendamento cancelado'); reload(); } catch (e) { toast.error((e as Error).message); }
            }}>Cancelar</Button>
          </>) : ['pendente', 'confirmado'].includes(a.status) && <span className="cell-sub">Alterações com menos de {cancelHours}h: fale com a barbearia</span>}
        </div>
      )}
    </div>
  );

  return (
    <>
      <section className="panel">
        <div className="card-head"><h2>Próximos</h2><Link to="/agendar" className="btn btn-primary btn-sm">Novo agendamento</Link></div>
        {upcoming.length === 0 ? <Empty title="Nenhum horário marcado" text="Escolha os serviços e reserve em poucos passos." /> : upcoming.map((a) => row(a, true))}
      </section>
      <section className="panel">
        <div className="card-head"><h2>Histórico de atendimentos</h2>{hasFinished && <Button size="sm" variant="line" onClick={() => setReview(true)}>Deixar depoimento</Button>}</div>
        {history.length === 0 ? <p className="muted">Seu histórico aparecerá aqui.</p> : history.map((a) => row(a, false))}
      </section>
      {resched && <Reschedule appt={resched} onClose={() => setResched(null)} onDone={() => { setResched(null); reload(); }} />}
      <ReviewModal open={review} onClose={() => setReview(false)} />
    </>
  );
}

function Reschedule({ appt, onClose, onDone }: { appt: any; onClose: () => void; onDone: () => void }) {
  const [day, setDay] = useState(isoDay(new Date(appt.starts_at)));
  const [slots, setSlots] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setSlots(null); setSel(null);
    db.rpc<any[]>('get_available_slots', { p_date: day, p_service_ids: appt.service_ids, p_barber_id: appt.barber_id }).then(setSlots).catch((e) => { toast.error(e.message); setSlots([]); });
  }, [day]);
  return (
    <Modal open onClose={onClose} title="Reagendar" footer={<><Button variant="ghost" onClick={onClose}>Voltar</Button>
      <Button disabled={!sel} loading={busy} onClick={async () => {
        setBusy(true);
        try { await db.rpc('reschedule_appointment', { p_id: appt.id, p_new_starts_at: sel }); toast.ok('Agendamento reagendado'); onDone(); } catch (e) { toast.error((e as Error).message); }
        setBusy(false);
      }}>Confirmar novo horário</Button></>}>
      <p className="muted">{appt.services} com {appt.barber_name}. Atual: {fmtDateTime(appt.starts_at)}.</p>
      <Field label="Nova data"><Input type="date" value={day} min={isoDay()} max={addDays(isoDay(), 60)} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
      {!slots ? <Loading label="Buscando horários" /> : slots.length === 0 ? <p className="muted">Sem horários livres neste dia.</p> : (
        <div className="slots">{slots.map((s) => <button key={s.starts_at} className="slot" aria-pressed={sel === s.starts_at} onClick={() => setSel(s.starts_at)}>{fmtTime(s.starts_at)}</button>)}</div>
      )}
    </Modal>
  );
}

function ReviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rating, setRating] = useState(5); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Seu depoimento" footer={<Button loading={busy} disabled={text.trim().length < 10} onClick={async () => {
      setBusy(true);
      try { await db.rpc('submit_testimonial', { p_rating: rating, p_content: text }); toast.ok('Obrigado! Seu depoimento será publicado após revisão.'); onClose(); setText(''); } catch (e) { toast.error((e as Error).message); }
      setBusy(false);
    }}>Enviar depoimento</Button>}>
      <Field label="Nota">
        <div style={{ display: 'flex', gap: 6 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="icon-btn" aria-label={`${n} estrelas`} onClick={() => setRating(n)}><Stars value={n <= rating ? 1 : 0} size={22} /></button>)}</div>
      </Field>
      <Field label="Como foi sua experiência?" hint="Publicamos apenas seu primeiro nome e a inicial do sobrenome."><Textarea maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ Pagamento online (Asaas)
let payEnabledCache: Promise<boolean> | null = null;
function usePayOnline() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    payEnabledCache ??= fetch('/api/payments/checkout', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => !!j.enabled).catch(() => false);
    payEnabledCache.then(setOn);
  }, []);
  return on;
}

/** Gera a fatura no Asaas e leva o cliente até ela (Pix, boleto ou cartão). O CPF é pedido só na primeira vez. */
function PayOnline({ kind, id, label = 'Pagar online' }: { kind: 'plano' | 'pedido'; id: string; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [askCpf, setAskCpf] = useState(false);
  const [cpf, setCpf] = useState('');
  const [err, setErr] = useState('');
  const go = async (withCpf?: string) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/payments/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, cpf: withCpf }) });
      const j = await res.json().catch(() => ({}));
      if (j.needCpf) { setAskCpf(true); if (withCpf) setErr(j.message); }
      else if (!res.ok || !j.url) toast.error(j.message || 'Não foi possível gerar o pagamento');
      else window.location.assign(j.url);
    } catch { toast.error('Sem conexão. Tente de novo.'); }
    setBusy(false);
  };
  return (<>
    <Button size="sm" loading={busy && !askCpf} onClick={() => go()}><Icon name="wallet" size={16} /> {label}</Button>
    <Modal open={askCpf} onClose={() => setAskCpf(false)} title="CPF do pagador"
      footer={<><Button variant="ghost" onClick={() => setAskCpf(false)}>Voltar</Button><Button loading={busy} onClick={() => go(cpf)}>Continuar para o pagamento</Button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>O Asaas, que processa o pagamento, exige o CPF de quem paga. Ele é enviado só ao Asaas e não fica guardado no site. Você escolhe Pix, boleto ou cartão na próxima tela.</p>
      <Field label="CPF" error={err}><Input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} /></Field>
    </Modal>
  </>);
}

// ------------------------------------------------------------------ Pedidos
function Orders() {
  const payOn = usePayOnline();
  const { data, error, loading, reload } = useLoad(async () => {
    const orders = await db.select('orders', {}, { order: 'created_at.desc' });
    const items = orders.length ? await db.select('order_items', { order_id: `in.(${orders.map((o: any) => o.id).join(',')})` }) : [];
    return orders.map((o: any) => ({ ...o, items: items.filter((i: any) => i.order_id === o.id) }));
  });
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const active = data!.filter((o) => !['entregue', 'cancelado'].includes(o.status));
  const list = (rows: any[]) => rows.map((o) => (
    <div className="appt" key={o.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
      <div><h3>Pedido #{o.code}</h3>
        <div className="muted" style={{ fontSize: 14 }}>{fmtDateTime(o.created_at)} · {o.items.map((i: any) => `${i.quantity}× ${i.product_name}`).join(', ')}</div>
        <div style={{ marginTop: 6 }}><Badge tone={o.status === 'cancelado' ? 'muted' : o.status === 'aguardando_pagamento' ? 'warn' : 'ok'}>{ORDER_STATUS[o.status]}</Badge> <span className="cell-sub">{o.fulfillment === 'retirada' ? 'Retirada na barbearia' : 'Entrega'}</span></div></div>
      <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
        <strong>{money(o.total)}</strong>
        {payOn && o.status === 'aguardando_pagamento' && <PayOnline kind="pedido" id={o.id} />}
      </div>
    </div>
  ));
  return (<>
    <section className="panel"><h2>Em andamento</h2>{active.length ? list(active) : <Empty title="Nenhum pedido em andamento" action={<Link to="/loja" className="btn btn-line btn-sm">Ver produtos</Link>} />}</section>
    <section className="panel"><h2>Histórico de compras</h2>{data!.length - active.length ? list(data!.filter((o) => !active.includes(o))) : <p className="muted">Nenhuma compra concluída ainda.</p>}</section>
  </>);
}

// ------------------------------------------------------------------ Planos
function Plans() {
  const { site } = useSite();
  const q = useQuery();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useLoad(() => db.rpc<any[]>('my_subscriptions'));
  const want = site?.plans.find((p) => p.id === q.get('assinar'));
  const [busy, setBusy] = useState(false);
  const payOn = usePayOnline();
  useEffect(() => { if (q.get('pago')) toast.ok('Pagamento enviado. Assim que o Asaas confirmar, seu plano é ativado e você recebe um e-mail.'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || !site) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (<>
    {want && !data!.some((s) => s.plan_id === want.id && ['pendente', 'ativa'].includes(s.status)) && (
      <section className="panel">
        <h2>Contratar {want.name}</h2>
        <p>{money(want.price)} por {want.period_months === 1 ? 'mês' : `${want.period_months} meses`}.</p>
        {want.contract_conditions && <p className="muted" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>{want.contract_conditions}</p>}
        <div className="notice" style={{ margin: '14px 0' }}><Icon name="wallet" /><span>{payOn
          ? 'Depois de confirmar, toque em "Pagar online" e escolha Pix, boleto ou cartão. Todo mês a nova fatura chega por e-mail. Se preferir, pague na barbearia.'
          : 'A assinatura é ativada após o pagamento na barbearia.'}</span></div>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try { await db.rpc('subscribe_plan', { p_plan: want.id }); toast.ok(payOn ? 'Plano registrado. Agora é só pagar online.' : 'Assinatura registrada. Ative pagando na barbearia.'); history.replaceState(null, '', '/conta?aba=planos'); reload(); } catch (e) { toast.error((e as Error).message); }
          setBusy(false);
        }}>Confirmar contratação</Button>
      </section>
    )}
    <section className="panel">
      <h2>Meus planos</h2>
      {data!.length === 0 ? <Empty title="Você ainda não tem um plano" text="Veja os planos mensais da MR.LUDER." action={<Link to="/#planos" className="btn btn-line btn-sm">Ver planos</Link>} /> : data!.map((s) => (
        <div key={s.id} className="appt" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <div>
            <h3>{s.plan} <Badge tone={s.status === 'ativa' ? 'ok' : s.status === 'pendente' || s.status === 'inadimplente' ? 'warn' : 'muted'}>{SUB_STATUS[s.status]}</Badge></h3>
            <div className="muted" style={{ fontSize: 14 }}>{s.period_end ? `Válido até ${fmtDate(s.period_end)}` : 'Aguardando primeiro pagamento'} · {money(s.price)} · {s.auto_renew ? 'Renovação automática' : 'Sem renovação'}</div>
            <ul className="list-plain" style={{ marginTop: 8 }}>
              {s.benefits.map((b: any, i: number) => <li key={i}><span>{b.description}</span><span className="cell-sub">{b.service_id ? (b.quantity ? `${b.used} de ${b.quantity} usados` : `${b.used} usados · ilimitado`) : ''}</span></li>)}
            </ul>
            {(s.allowed_weekdays || s.max_per_week) && <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>Vale {s.weekdays_label}{s.max_per_week ? ` · até ${s.max_per_week} por semana` : ''}.</p>}
          </div>
          <div style={{ display: 'grid', gap: 8, justifyItems: 'end', alignContent: 'start' }}>
          {payOn && ['pendente', 'inadimplente'].includes(s.status) && <PayOnline kind="plano" id={s.id} label={s.status === 'inadimplente' ? 'Pagar mensalidade' : 'Pagar online'} />}
          {['ativa', 'pendente', 'inadimplente'].includes(s.status) && s.auto_renew && (
            <Button size="sm" variant="ghost" onClick={async () => {
              if (!(await confirm({ title: 'Cancelar plano?', text: s.status === 'ativa' ? `Os benefícios continuam até ${fmtDate(s.period_end)} e o plano não será renovado.` : 'A contratação será cancelada.', confirm: 'Cancelar plano', danger: true }))) return;
              try { await db.rpc('set_subscription_status', { p_sub: s.id, p_status: 'cancelada' }); toast.ok('Renovação cancelada'); reload(); } catch (e) { toast.error((e as Error).message); }
            }}>Cancelar</Button>
          )}
          </div>
          {s.status === 'ativa' && <div style={{ gridColumn: '1 / -1' }}><FixedSlot sub={s} onChanged={reload} /></div>}
        </div>
      ))}
    </section>
  </>);
}

/** Horário fixo do plano: o cliente escolhe dia, hora e barbeiro; o barbeiro aprova e as datas do mês ficam reservadas. */
function FixedSlot({ sub, onChanged }: { sub: any; onChanged: () => void }) {
  const { site } = useSite();
  const toast = useToast();
  const confirm = useConfirm();
  const fs = sub.fixed_slot && ['pendente', 'aprovado'].includes(sub.fixed_slot.status) ? sub.fixed_slot : null;
  const last = sub.fixed_slot && !fs ? sub.fixed_slot : null;
  const days: number[] = (sub.allowed_weekdays && sub.allowed_weekdays.length ? sub.allowed_weekdays : [0, 1, 2, 3, 4, 5, 6])
    .filter((d: number) => site?.hours.find((h) => h.weekday === d)?.is_open);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<number | ''>('');
  const [time, setTime] = useState('');
  const [barber, setBarber] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const serviceIds: string[] = sub.benefits.map((b: any) => b.service_id).filter(Boolean);
  const barbers = (site?.barbers || []).filter((b) => serviceIds.every((id) => b.service_ids.includes(id)));
  const times = (() => {
    const h = site?.hours.find((x) => x.weekday === day);
    if (!h?.is_open || !h.opens_at || !h.closes_at) return [] as string[];
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const dur = Math.max(...sub.benefits.map((b: any) => site?.services.find((x) => x.id === b.service_id)?.duration_minutes || 0), 30);
    const out: string[] = [];
    for (let m = toMin(h.opens_at); m + dur <= toMin(h.closes_at); m += 10) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    return out;
  })();

  if (fs) return (
    <div className="fixed-slot">
      <div className="fixed-slot-head"><Icon name="clock" /><div>
        <strong>Horário fixo: {fs.label}</strong>
        <span className="muted">com {fs.barber_name} · {fs.status === 'pendente' ? 'aguardando aprovação do barbeiro' : 'aprovado'}</span>
      </div>{fs.status === 'aprovado' ? <Badge tone="ok">Aprovado</Badge> : <Badge tone="warn">Em análise</Badge>}</div>
      {fs.status === 'aprovado' && (fs.next_dates.length
        ? <p className="muted" style={{ fontSize: 14 }}>Datas reservadas: {fs.next_dates.map((d: string) => fmtDate(d).slice(0, 5)).join(', ')}. Ao renovar o plano, o próximo mês é reservado sozinho.</p>
        : <p className="muted" style={{ fontSize: 14 }}>Nenhuma data futura neste período. Ao renovar o plano, as próximas são reservadas sozinhas.</p>)}
      <div><Button size="sm" variant="ghost" onClick={async () => {
        if (!(await confirm({ title: fs.status === 'pendente' ? 'Cancelar o pedido?' : 'Cancelar o horário fixo?', text: fs.status === 'pendente' ? 'O barbeiro deixa de ver este pedido.' : 'As datas futuras reservadas por este horário serão liberadas.', confirm: 'Cancelar horário fixo', danger: true }))) return;
        try { await db.rpc('cancel_fixed_slot', { p_id: fs.id }); toast.ok('Horário fixo cancelado'); onChanged(); } catch (e) { toast.error((e as Error).message); }
      }}>{fs.status === 'pendente' ? 'Cancelar pedido' : 'Cancelar horário fixo'}</Button></div>
    </div>
  );
  return (
    <div className="fixed-slot">
      <div className="fixed-slot-head"><Icon name="clock" /><div>
        <strong>Horário fixo</strong>
        <span className="muted">Corta sempre no mesmo dia e hora? Peça o seu horário fixo: depois que o barbeiro aprovar, as datas do mês ficam reservadas para você.</span>
      </div></div>
      {last?.status === 'recusado' && <p className="muted" style={{ fontSize: 14 }}>Seu último pedido ({last.label}) não foi aprovado{last.decision_note ? `: ${last.decision_note}` : '.'}</p>}
      {!open ? <div><Button size="sm" variant="line" onClick={() => setOpen(true)}>Pedir horário fixo</Button></div> : (
        <form className="fixed-slot-form" onSubmit={async (e) => {
          e.preventDefault();
          if (day === '' || !time || !barber) { setErr('Escolha o dia, o horário e o barbeiro.'); return; }
          setErr(''); setBusy(true);
          try {
            await db.rpc('request_fixed_slot', { p_sub: sub.id, p_barber: barber, p_weekday: day, p_time: time, p_note: note || null });
            toast.ok('Pedido enviado. Você recebe um aviso quando o barbeiro responder.'); setOpen(false); onChanged();
          } catch (e2) { setErr((e2 as Error).message); }
          setBusy(false);
        }}>
          <Field label="Dia da semana"><Select value={day} onChange={(e) => { setDay(e.target.value === '' ? '' : Number(e.target.value)); setTime(''); }}>
            <option value="">Escolha</option>{days.map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}</Select></Field>
          <Field label="Horário"><Select value={time} disabled={day === ''} onChange={(e) => setTime(e.target.value)}>
            <option value="">{day === '' ? 'Escolha o dia primeiro' : 'Escolha'}</option>{times.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Barbeiro"><Select value={barber} onChange={(e) => setBarber(e.target.value)}>
            <option value="">Escolha</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Recado para o barbeiro (opcional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: chego direto do trabalho" /></Field>
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="fixed-slot-actions"><Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setErr(''); }}>Voltar</Button><Button type="submit" size="sm" loading={busy}>Enviar pedido</Button></div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Club
function Club() {
  const { site } = useSite();
  const toast = useToast();
  const club = useLoad(() => db.rpc<any>('my_club'));
  const coupons = useLoad(() => db.select('coupons', {}, { order: 'created_at.desc' }));
  const [busy, setBusy] = useState(false);
  if (club.loading) return <Loading />;
  if (club.error) return <ErrorBox error={club.error} onRetry={club.reload} />;
  const c = club.data;
  const link = c.affiliate?.code ? `${location.origin}/cadastro?ref=${c.affiliate.code}` : '';
  return (<>
    <section className="panel">
      <h2>MR.LUDER Club · Indique e ganhe</h2>
      {!site?.settings.referral_enabled ? <p className="muted">O programa de indicação está pausado no momento.</p> : !c.affiliate ? (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
          <p>Gere seu código exclusivo e ganhe recompensas quando amigos indicados fizerem o primeiro atendimento ou compra.</p>
          <Button loading={busy} onClick={async () => { setBusy(true); try { await db.rpc('become_affiliate'); club.reload(); } catch (e) { toast.error((e as Error).message); } setBusy(false); }}>Gerar meu código</Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="code-box"><span className="muted">Seu código</span><code>{c.affiliate.code}</code>
            <Button size="sm" variant="line" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.ok('Link copiado'), () => toast.error('Não foi possível copiar'))}>Copiar link</Button>
            <a className="btn btn-primary btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Conheça a MR.LUDER Barbearia! Crie sua conta pelo meu link: ${link}`)}`}>Compartilhar no WhatsApp</a>
          </div>
          <p className="cell-sub">{link}</p>
          <h3 style={{ fontSize: 15, marginTop: 8 }}>Indicações</h3>
          {c.referrals.length === 0 ? <p className="muted">Ninguém se cadastrou pelo seu link ainda.</p> : (
            <ul className="list-plain">{c.referrals.map((r: any, i: number) => <li key={i}><span>{r.name} · {fmtDate(r.created_at)}</span><Badge tone={r.status === 'validada' ? 'ok' : r.status === 'pendente' ? 'warn' : 'muted'}>{r.status === 'validada' ? 'Validada' : r.status === 'pendente' ? 'Aguardando 1º atendimento' : r.status === 'rejeitada' ? 'Não elegível' : 'Expirada'}</Badge></li>)}</ul>
          )}
          <h3 style={{ fontSize: 15, marginTop: 8 }}>Recompensas</h3>
          {c.rewards.length === 0 ? <p className="muted">Suas recompensas aparecerão aqui.</p> : (
            <ul className="list-plain">{c.rewards.map((r: any) => <li key={r.id}><span>{r.description}{r.coupon && <> · cupom <strong>{r.coupon}</strong></>}</span><span className="cell-sub">{r.status === 'disponivel' ? `Válida até ${fmtDate(r.expires_at)}` : r.status}</span></li>)}</ul>
          )}
        </div>
      )}
    </section>
    <section className="panel">
      <h2>Meus cupons</h2>
      {coupons.loading ? <Loading /> : !coupons.data?.length ? <p className="muted">Você não tem cupons no momento.</p> : (
        <ul className="list-plain">{coupons.data.map((cp: any) => <li key={cp.id}><span><strong>{cp.code}</strong> · {cp.description || (cp.discount_type === 'percentual' ? `${Number(cp.value)}% off` : `${money(cp.value)} off`)}</span>
          <span className="cell-sub">{!cp.active || (cp.max_uses && cp.used_count >= cp.max_uses) ? 'Utilizado' : cp.valid_until ? `Até ${fmtDate(cp.valid_until)}` : 'Disponível'}</span></li>)}</ul>
      )}
    </section>
  </>);
}

// ------------------------------------------------------------------ Avisos internos
function Notifications() {
  const { data, loading, error, reload } = useLoad(async () => {
    const r = await db.select('notification_logs', { channel: 'interno' }, { order: 'created_at.desc', limit: 50 });
    db.rpc('mark_notifications_read').catch(() => {});
    return r;
  });
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <section className="panel"><h2>Avisos</h2>
      {data!.length === 0 ? <Empty title="Nenhum aviso" text="Confirmações, lembretes e recompensas aparecem aqui." /> : (
        <ul className="list-plain">{data!.map((n: any) => <li key={n.id}><span><strong>{n.title}</strong><br /><span className="muted">{n.body}</span></span><span className="cell-sub">{fmtDateTime(n.created_at)}{n.status === 'registrada' && <> · <Badge tone="info">Novo</Badge></>}</span></li>)}</ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Dados cadastrais
function Profile() {
  const { session } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => db.select('profiles', { id: session!.user.id }));
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.[0]) setF({ full_name: data[0].full_name, phone: data[0].phone || '', birth_date: data[0].birth_date || '' }); }, [data]);
  if (loading || !f) return error ? <ErrorBox error={error} onRetry={reload} /> : <Loading />;
  return (
    <section className="panel">
      <h2>Dados cadastrais</h2>
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        if (f.full_name.trim().length < 3) return toast.error('Informe seu nome completo');
        setBusy(true);
        try { await db.rpc('update_my_profile', { p_full_name: f.full_name, p_phone: f.phone, p_birth_date: f.birth_date || null }); toast.ok('Dados atualizados'); reload(); } catch (er) { toast.error((er as Error).message); }
        setBusy(false);
      }}>
        <Field label="Nome completo" className="span-2"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="E-mail" hint="Para alterar o e-mail, fale com a barbearia."><Input value={data![0].email} disabled /></Field>
        <Field label="Telefone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Data de nascimento" hint="Opcional"><Input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} /></Field>
        <div className="span-2" style={{ display: 'flex', gap: 10 }}><Button type="submit" loading={busy}>Salvar alterações</Button><Link to="/alterar-senha" className="btn btn-ghost btn-md">Alterar senha</Link></div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ Privacidade (LGPD)
function Privacy() {
  const { session } = useAuth();
  const toast = useToast();
  const prof = useLoad(() => db.select('profiles', { id: session!.user.id }));
  const consents = useLoad(() => db.select('consent_records', {}, { order: 'created_at.desc', limit: 30 }));
  const reqs = useLoad(() => db.select('privacy_requests', {}, { order: 'created_at.desc' }));
  const [busy, setBusy] = useState(false);
  const p = prof.data?.[0];
  async function setMk(email: boolean, whats: boolean) {
    try { await db.rpc('update_marketing_consent', { p_email: email, p_whatsapp: whats, p_user_agent: navigator.userAgent }); toast.ok('Preferências atualizadas'); prof.reload(); consents.reload(); } catch (e) { toast.error((e as Error).message); }
  }
  return (<>
    <section className="panel">
      <h2>Preferências de comunicação</h2>
      {!p ? <Loading /> : (<div style={{ display: 'grid', gap: 14 }}>
        <Toggle checked={p.communication_email} onChange={(v) => setMk(v, p.communication_whatsapp)} label="Novidades e ofertas por e-mail" hint="Avisos sobre seus agendamentos e pedidos continuam sendo enviados." />
        <Toggle checked={p.communication_whatsapp} onChange={(v) => setMk(p.communication_email, v)} label="Novidades e ofertas por WhatsApp" />
      </div>)}
    </section>
    <section className="panel">
      <h2>Meus dados</h2>
      <p className="muted" style={{ marginBottom: 14 }}>Baixe uma cópia estruturada (JSON) dos dados vinculados à sua conta: cadastro, agendamentos, pedidos, planos e consentimentos.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button variant="line" loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const data = await db.rpc('export_my_data');
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = `mrluder-meus-dados-${isoDay()}.json`; a.click(); URL.revokeObjectURL(url);
          } catch (e) { toast.error((e as Error).message); }
          setBusy(false);
        }}>Baixar meus dados</Button>
        <Link to="/meus-dados" className="btn btn-ghost btn-md">Solicitar correção, exclusão ou outras informações</Link>
      </div>
    </section>
    <section className="panel">
      <h2>Solicitações</h2>
      {reqs.data?.length ? <ul className="list-plain">{reqs.data.map((r: any) => <li key={r.id}><span>{r.protocol} · {r.kind}</span><Badge tone={r.status === 'concluida' ? 'ok' : 'warn'}>{r.status.replace('_', ' ')}</Badge></li>)}</ul> : <p className="muted">Nenhuma solicitação.</p>}
    </section>
    <section className="panel">
      <h2>Histórico de consentimentos</h2>
      {consents.data?.length ? <ul className="list-plain">{consents.data.map((c: any) => <li key={c.id}><span>{({ termos: 'Termos de uso', privacidade: 'Política de privacidade', marketing_email: 'Marketing por e-mail', marketing_whatsapp: 'Marketing por WhatsApp' } as any)[c.purpose]}{c.document_version && ` (v${c.document_version})`}</span><span className="cell-sub">{c.granted ? 'Concedido' : 'Não concedido'} · {fmtDateTime(c.created_at)}</span></li>)}</ul> : <Loading />}
    </section>
  </>);
}
