'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/api';
import { APPT_STATUS, addDays, fmtDate, fmtDateTime, fmtLongDate, fmtTime, isoDay, money, spToIso, useAuth, useLoad, whatsappLink, duration } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Icon, Input, Loading, Modal, Select, Tabs, Textarea, useConfirm, useToast } from '../lib/ui';
import { usePaymentMethods } from './Layout';

type Ev = { id: string; code: string; starts_at: string; ends_at: string; status: string; total_price: number; barber_id: string; barber_name: string;
  customer_id: string; customer_name: string; customer_phone: string | null; services: string; customer_notes: string | null; professional_notes: string | null; source: string; covered_by_plan: boolean; visits_count: number };
type View = 'dia' | 'semana' | 'mes';
const START_H = 7, END_H = 22, HOUR_PX = 64;

export function AgendaBoard({ mode }: { mode: 'admin' | 'barbeiro' }) {
  const { can } = useAuth();
  const [view, setView] = useState<View>('dia');
  const [day, setDay] = useState(isoDay());
  const [barberFilter, setBarberFilter] = useState('');
  const [selected, setSelected] = useState<Ev | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const barbers = useLoad(() => (mode === 'admin' ? db.select('barbers', { active: true }, { order: 'sort_order.asc' }) : Promise.resolve([])), []);

  const range = useMemo(() => {
    if (view === 'dia') return [day, addDays(day, 1)];
    if (view === 'semana') { const wd = new Date(day + 'T12:00:00Z').getUTCDay(); const start = addDays(day, -((wd + 6) % 7)); return [start, addDays(start, 7)]; }
    const start = day.slice(0, 8) + '01'; const d = new Date(start + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
    return [start, d.toISOString().slice(0, 10)];
  }, [view, day]);

  const evs = useLoad(() => db.rpc<Ev[]>('agenda_view', { p_from: spToIso(range[0], '00:00'), p_to: spToIso(range[1], '00:00'), p_barber_id: barberFilter || null }), [range[0], range[1], barberFilter]);
  const offs = useLoad(() => db.select('time_off', { status: 'eq.aprovado', starts_at: `lt.${spToIso(range[1], '00:00')}`, ends_at: `gt.${spToIso(range[0], '00:00')}` }), [range[0], range[1]]);

  // atualiza a agenda periodicamente (outras recepções/barbeiros podem alterar)
  useEffect(() => { const t = setInterval(() => evs.reload(), 60000); return () => clearInterval(t); }, [evs.reload]);

  const step = (n: number) => setDay(view === 'dia' ? addDays(day, n) : view === 'semana' ? addDays(day, 7 * n) : (() => { const d = new Date(day + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n, 1); return d.toISOString().slice(0, 10); })());
  const cols = mode === 'admin' && !barberFilter ? (barbers.data || []).map((b: any) => ({ id: b.id, name: b.display_name })) : [{ id: barberFilter || 'me', name: '' }];
  const list = evs.data || [];

  return (
    <>
      <div className="toolbar">
        <Tabs tabs={[{ id: 'dia', label: 'Dia' }, { id: 'semana', label: 'Semana' }, { id: 'mes', label: 'Mês' }]} value={view} onChange={setView} />
        <Button variant="line" size="sm" onClick={() => setDay(isoDay())}>Hoje</Button>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Anterior"><Icon name="arrowLeft" /></button>
          <strong className="first-cap">{view === 'mes' ? new Date(day + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : view === 'semana' ? `${fmtDate(range[0] + 'T12:00:00Z', { day: '2-digit', month: 'short' })} – ${fmtDate(addDays(range[1], -1) + 'T12:00:00Z', { day: '2-digit', month: 'short' })}` : fmtLongDate(day + 'T12:00:00-03:00')}</strong>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Próximo"><Icon name="arrowRight" /></button>
        </div>
        <span className="spacer" />
        {mode === 'admin' && <Select value={barberFilter} onChange={(e) => setBarberFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrar profissional">
          <option value="">Todos os profissionais</option>{(barbers.data || []).map((b: any) => <option key={b.id} value={b.id}>{b.display_name}</option>)}</Select>}
        {mode === 'admin' && can('agenda.criar') && <Button variant="line" size="sm" onClick={() => setBlocking(true)}>Bloquear horário</Button>}
        {mode === 'admin' && can('agenda.criar') && <Button size="sm" onClick={() => setCreating(true)}><Icon name="plus" size={15} />Novo agendamento</Button>}
      </div>

      {evs.error ? <ErrorBox error={evs.error} onRetry={evs.reload} /> : evs.loading && !evs.data ? <Loading /> : (
        <>
          {view === 'dia' && (cols.length === 0 ? <Empty title="Nenhum profissional ativo" text="Cadastre a equipe em Equipe." /> : (
            <div className="agenda-day" style={{ ['--cols' as any]: cols.length }}>
              <div className="agenda-head" style={{ borderLeft: 0 }} />
              {cols.map((c) => <div className="agenda-head" key={c.id}>{c.name || 'Minha agenda'}</div>)}
              <div>{Array.from({ length: END_H - START_H }, (_, i) => <div className="agenda-hour" key={i}>{String(START_H + i).padStart(2, '0')}:00</div>)}</div>
              {cols.map((c) => (
                <div className="agenda-col" key={c.id}>
                  {Array.from({ length: END_H - START_H }, (_, i) => <div className="agenda-slot-line" key={i} />)}
                  {day === isoDay() && <NowLine />}
                  {(offs.data || []).filter((o: any) => !o.barber_id || o.barber_id === c.id || c.id === 'me').map((o: any) => (
                    <Block key={o.id} start={o.starts_at} end={o.ends_at} day={day}><div className="ev off" style={{ inset: 0, position: 'absolute' }}><strong>{o.kind === 'folga' ? 'Folga' : 'Bloqueio'}</strong>{o.reason}</div></Block>
                  ))}
                  {list.filter((e) => c.id === 'me' || e.barber_id === c.id).map((e) => (
                    <Block key={e.id} start={e.starts_at} end={e.ends_at} day={day}>
                      <button className={`ev st-${e.status}`} style={{ inset: 0, position: 'absolute' }} onClick={() => setSelected(e)}>
                        <strong>{fmtTime(e.starts_at)} {e.customer_name}</strong>{e.services}
                      </button>
                    </Block>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {view === 'semana' && (
            <div className="week">
              {Array.from({ length: 7 }, (_, i) => addDays(range[0], i)).map((d) => (
                <div key={d} className={`week-day ${d === isoDay() ? 'today' : ''}`}>
                  <header><span>{new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: 'UTC' })}</span><button className="text-link" onClick={() => { setDay(d); setView('dia'); }}>abrir</button></header>
                  {list.filter((e) => isoDay(new Date(e.starts_at)) === d).map((e) => (
                    <button key={e.id} className={`week-ev ev st-${e.status}`} style={{ position: 'static' }} onClick={() => setSelected(e)}>{fmtTime(e.starts_at)} · {e.customer_name}{mode === 'admin' && <><br /><span className="cell-sub">{e.barber_name}</span></>}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {view === 'mes' && <MonthGrid start={range[0]} list={list} onPick={(d) => { setDay(d); setView('dia'); }} />}
          <Legend />
        </>
      )}

      {selected && <EventModal ev={selected} mode={mode} onClose={() => setSelected(null)} onChanged={() => { evs.reload(); setSelected(null); }} />}
      {creating && <NewAppointment onClose={() => setCreating(false)} onDone={() => { setCreating(false); evs.reload(); }} defaultDay={day} />}
      {blocking && <BlockModal barbers={barbers.data || []} onClose={() => setBlocking(false)} onDone={() => { setBlocking(false); offs.reload(); }} defaultDay={day} />}
    </>
  );
}

function Block({ start, end, day, children }: { start: string; end: string; day: string; children: React.ReactNode }) {
  const dayStart = new Date(spToIso(day, '00:00')).getTime();
  const s = Math.max((new Date(start).getTime() - dayStart) / 60000, START_H * 60);
  const e = Math.min((new Date(end).getTime() - dayStart) / 60000, END_H * 60);
  if (e <= s) return null;
  return <div style={{ position: 'absolute', left: 4, right: 4, top: ((s - START_H * 60) / 60) * HOUR_PX + 1, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 22) }}>{children}</div>;
}
function NowLine() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  const m = (Date.now() - new Date(spToIso(isoDay(), '00:00')).getTime()) / 60000;
  if (m < START_H * 60 || m > END_H * 60) return null;
  return <div className="now-line" style={{ top: ((m - START_H * 60) / 60) * HOUR_PX }} aria-label="Agora" />;
}
function MonthGrid({ start, list, onPick }: { start: string; list: Ev[]; onPick: (d: string) => void }) {
  const wd = (new Date(start + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const first = addDays(start, -wd);
  const month = start.slice(0, 7);
  return (
    <div className="month">
      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => <div className="month-head" key={d}>{d}</div>)}
      {Array.from({ length: 42 }, (_, i) => addDays(first, i)).map((d) => {
        const items = list.filter((e) => isoDay(new Date(e.starts_at)) === d && !e.status.startsWith('cancelado'));
        return (
          <button key={d} className={`month-cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === isoDay() ? 'today' : ''}`} onClick={() => onPick(d)}>
            <strong>{Number(d.slice(8))}</strong>
            {items.length > 0 && <span className="count">{items.length} agend.</span>}
            {items.length > 0 && <span className="cell-sub">{money(items.reduce((a, e) => a + Number(e.total_price), 0))}</span>}
          </button>
        );
      })}
    </div>
  );
}
const Legend = () => (
  <div className="toolbar" style={{ fontSize: 12.5 }}>
    {['pendente', 'confirmado', 'em_atendimento', 'finalizado', 'nao_compareceu'].map((s) => <Badge key={s} tone={APPT_STATUS[s].tone}>{APPT_STATUS[s].label}</Badge>)}
  </div>
);

// ------------------------------------------------------------------ Detalhe do atendimento
export function EventModal({ ev, mode, onClose, onChanged }: { ev: Ev; mode: 'admin' | 'barbeiro'; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const pms = usePaymentMethods();
  const { can } = useAuth();
  const [pm, setPm] = useState('');
  const [note, setNote] = useState(ev.professional_notes || '');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (status: string) => {
    setBusy(status);
    try { await db.rpc('set_appointment_status', { p_id: ev.id, p_status: status, p_payment_method_id: status === 'finalizado' ? pm || null : null, p_note: note || null });
      toast.ok(status === 'finalizado' ? 'Atendimento finalizado' : `Status: ${APPT_STATUS[status].label}`); onChanged(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };
  const next: Record<string, string[]> = { pendente: ['confirmado', 'cliente_chegou', 'nao_compareceu'], confirmado: ['cliente_chegou', 'em_atendimento', 'nao_compareceu'], cliente_chegou: ['em_atendimento', 'nao_compareceu'], em_atendimento: ['finalizado'] };
  const label: Record<string, string> = { confirmado: 'Confirmar', cliente_chegou: 'Cliente chegou', em_atendimento: 'Iniciar atendimento', finalizado: 'Finalizar atendimento', nao_compareceu: 'Não compareceu' };
  const actions = next[ev.status] || [];
  return (
    <Modal open onClose={onClose} title={`${ev.customer_name} · #${ev.code}`}>
      <dl className="kv">
        <dt>Quando</dt><dd>{fmtLongDate(ev.starts_at)}, {fmtTime(ev.starts_at)} – {fmtTime(ev.ends_at)}</dd>
        <dt>Serviços</dt><dd>{ev.services}{ev.covered_by_plan && <> <Badge tone="info">Plano</Badge></>}</dd>
        <dt>Profissional</dt><dd>{ev.barber_name}</dd>
        <dt>Valor</dt><dd>{money(ev.total_price)}</dd>
        <dt>Status</dt><dd><Badge tone={APPT_STATUS[ev.status].tone}>{APPT_STATUS[ev.status].label}</Badge></dd>
        <dt>Cliente</dt><dd>{ev.visits_count > 0 ? `${ev.visits_count} visita(s) anteriores` : 'Primeira visita'}{ev.customer_phone && <> · <a href={whatsappLink(ev.customer_phone, `Olá ${ev.customer_name.split(' ')[0]}, aqui é da MR.LUDER.`)} target="_blank" rel="noreferrer">{ev.customer_phone}</a></>}</dd>
        {ev.customer_notes && <><dt>Observação do cliente</dt><dd>{ev.customer_notes}</dd></>}
      </dl>
      {['cliente_chegou', 'em_atendimento', 'confirmado', 'pendente'].includes(ev.status) && (
        <Field label="Observações profissionais" hint="Visíveis apenas para a equipe. Registre somente o necessário para o atendimento."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      )}
      {ev.status === 'em_atendimento' && (
        <Field label="Pagamento recebido agora?" hint="Deixe em branco para registrar como valor a receber.">
          <Select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">Ainda não recebido</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
      )}
      {ev.status === 'finalizado' && mode === 'admin' && can('agenda.editar') && <PendingPayment ev={ev} onDone={onChanged} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actions.map((s) => <Button key={s} size="sm" variant={s === 'nao_compareceu' ? 'ghost' : s === 'finalizado' || s === 'em_atendimento' ? 'primary' : 'line'} loading={busy === s} onClick={() => act(s)}>{label[s]}</Button>)}
        {mode === 'admin' && can('agenda.editar') && ['pendente', 'confirmado'].includes(ev.status) && (
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!(await confirm({ title: 'Cancelar agendamento?', text: 'O cliente será avisado nas notificações da conta e o horário será liberado.', confirm: 'Cancelar pela barbearia', danger: true }))) return;
            try { await db.rpc('cancel_appointment', { p_id: ev.id, p_reason: 'Cancelado pela barbearia' }); toast.ok('Agendamento cancelado'); onChanged(); } catch (e) { toast.error((e as Error).message); }
          }}>Cancelar</Button>
        )}
      </div>
    </Modal>
  );
}

function PendingPayment({ ev, onDone }: { ev: Ev; onDone: () => void }) {
  const pms = usePaymentMethods();
  const toast = useToast();
  const [pm, setPm] = useState('');
  if (Number(ev.total_price) === 0) return null;
  return (
    <div className="notice"><Icon name="wallet" /><div style={{ display: 'grid', gap: 8, flex: 1 }}>
      <span>Se o pagamento ainda está pendente, registre o recebimento:</span>
      <div style={{ display: 'flex', gap: 8 }}><Select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">Forma de pagamento</option>{pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button size="sm" disabled={!pm} onClick={async () => { try { await db.rpc('receive_payment', { p_ref_type: 'agendamento', p_ref_id: ev.id, p_payment_method_id: pm }); toast.ok('Pagamento registrado'); onDone(); } catch (e) { toast.error((e as Error).message); } }}>Registrar</Button></div>
    </div></div>
  );
}

// ------------------------------------------------------------------ Novo agendamento (balcão / telefone)
function NewAppointment({ onClose, onDone, defaultDay }: { onClose: () => void; onDone: () => void; defaultDay: string }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [newCust, setNewCust] = useState({ full_name: '', phone: '', email: '' });
  const [svcs, setSvcs] = useState<string[]>([]);
  const [barber, setBarber] = useState('');
  const [day, setDay] = useState(defaultDay < isoDay() ? isoDay() : defaultDay);
  const [time, setTime] = useState('');
  const [source, setSource] = useState('balcao');
  const [busy, setBusy] = useState(false);
  const services = useLoad(() => db.select('services', { active: true }, { order: 'sort_order.asc' }));
  const bs = useLoad(() => db.select('barber_services'));
  const barbers = useLoad(() => db.select('barbers', { active: true }, { order: 'sort_order.asc' }));
  const [slots, setSlots] = useState<any[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setCustomers([]); return; }
    const t = setTimeout(() => db.select('customers', { full_name: `ilike.*${q.trim()}*` }, { limit: 8, order: 'full_name.asc' }).then(setCustomers).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!svcs.length || !day) { setSlots(null); return; }
    setSlots(null);
    db.rpc<any[]>('get_available_slots', { p_date: day, p_service_ids: svcs, p_barber_id: barber || null }).then(setSlots).catch(() => setSlots([]));
  }, [svcs.join(), day, barber]);
  const eligible = (barbers.data || []).filter((b: any) => svcs.every((s) => (bs.data || []).some((x: any) => x.barber_id === b.id && x.service_id === s)));
  const uniq = slots ? Array.from(new Map(slots.map((s) => [s.starts_at, s])).values()) : null;

  async function save() {
    setBusy(true);
    try {
      let cid = customer?.id;
      if (!cid) {
        if (newCust.full_name.trim().length < 3) throw new Error('Informe o nome do cliente');
        const c = await db.insert('customers', { full_name: newCust.full_name.trim(), phone: newCust.phone || null, email: newCust.email || null });
        cid = c.id;
      }
      const slot = uniq?.find((s) => s.starts_at === time);
      await db.rpc('book_appointment', { p_service_ids: svcs, p_starts_at: time, p_barber_id: barber || slot?.barber_id || null, p_customer_id: cid, p_source: source });
      toast.ok('Agendamento criado'); onDone();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Novo agendamento" wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!svcs.length || !time || (!customer && !newCust.full_name)} onClick={save}>Agendar</Button></>}>
      <div className="form-grid">
        <div className="span-2">
          {customer ? <div className="notice"><Icon name="user" /><span style={{ flex: 1 }}><strong>{customer.full_name}</strong> {customer.phone}</span><button className="text-link" onClick={() => setCustomer(null)}>trocar</button></div> : (<>
            <Field label="Cliente" hint="Busque pelo nome ou cadastre abaixo"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do cliente" /></Field>
            {customers.length > 0 && <ul className="list-plain">{customers.map((c) => <li key={c.id}><span>{c.full_name} <span className="cell-sub">{c.phone}</span></span><Button size="sm" variant="line" onClick={() => setCustomer(c)}>Selecionar</Button></li>)}</ul>}
            {q.trim().length >= 2 && customers.length === 0 && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Nome do novo cliente"><Input value={newCust.full_name} onChange={(e) => setNewCust({ ...newCust, full_name: e.target.value })} /></Field>
                <Field label="Telefone"><Input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></Field>
              </div>
            )}
          </>)}
        </div>
        <div className="span-2">
          <span className="field-label">Serviços</span>
          <div className="opt-list" style={{ marginTop: 6 }}>
            {(services.data || []).map((s: any) => (
              <button type="button" key={s.id} className="opt" aria-pressed={svcs.includes(s.id)} onClick={() => { setSvcs((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id])); setTime(''); }}>
                <span className="opt-check"><Icon name="check" size={14} /></span><span>{s.name} <span className="cell-sub">{duration(s.duration_minutes)}</span></span><span className="opt-right">{money(s.price)}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Profissional"><Select value={barber} onChange={(e) => { setBarber(e.target.value); setTime(''); }}><option value="">Qualquer disponível</option>{eligible.map((b: any) => <option key={b.id} value={b.id}>{b.display_name}</option>)}</Select></Field>
        <Field label="Origem"><Select value={source} onChange={(e) => setSource(e.target.value)}><option value="balcao">Balcão</option><option value="telefone">Telefone</option><option value="whatsapp">WhatsApp</option></Select></Field>
        <Field label="Data"><Input type="date" value={day} min={isoDay()} onChange={(e) => { setDay(e.target.value); setTime(''); }} /></Field>
        <div className="span-2">
          <span className="field-label">Horário</span>
          {!svcs.length ? <p className="cell-sub">Escolha os serviços para ver os horários livres.</p> : !uniq ? <Loading /> : uniq.length === 0 ? <p className="cell-sub">Sem horários livres.</p> : (
            <div className="slots" style={{ marginTop: 6 }}>{uniq.map((s) => <button type="button" key={s.starts_at} className="slot" aria-pressed={time === s.starts_at} onClick={() => setTime(s.starts_at)}>{fmtTime(s.starts_at)}</button>)}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BlockModal({ barbers, onClose, onDone, defaultDay }: { barbers: any[]; onClose: () => void; onDone: () => void; defaultDay: string }) {
  const toast = useToast();
  const [f, setF] = useState({ barber_id: '', day: defaultDay, start: '12:00', end: '13:00', kind: 'bloqueio', reason: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Bloquear horário" footer={<Button loading={busy} onClick={async () => {
      if (f.end <= f.start) return toast.error('O fim deve ser depois do início');
      setBusy(true);
      try { await db.insert('time_off', { barber_id: f.barber_id || null, starts_at: spToIso(f.day, f.start), ends_at: spToIso(f.day, f.end), kind: f.kind, reason: f.reason || null }); toast.ok('Horário bloqueado'); onDone(); }
      catch (e) { toast.error((e as Error).message); }
      setBusy(false);
    }}>Bloquear</Button>}>
      <div className="form-grid">
        <Field label="Profissional"><Select value={f.barber_id} onChange={(e) => setF({ ...f, barber_id: e.target.value })}><option value="">Barbearia inteira</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.display_name}</option>)}</Select></Field>
        <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bloqueio">Bloqueio</option><option value="folga">Folga</option><option value="feriado">Feriado</option></Select></Field>
        <Field label="Data"><Input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
        <div className="form-grid"><Field label="Início"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field><Field label="Fim"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field></div>
        <Field label="Motivo" className="span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <p className="cell-sub">Agendamentos já existentes no período não são cancelados automaticamente.</p>
    </Modal>
  );
}

export { fmtDateTime };
