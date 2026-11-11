'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { APPT_STATUS, WEEKDAYS, addDays, fmtDate, fmtDateTime, fmtTime, isoDay, money, spToIso, useAuth, useLoad, usePath } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useConfirm, useToast } from '../lib/ui';
import { AgendaBoard, EventModal } from './Agenda';
import { PanelLayout, RequireStaff, NavItem } from './Layout';

const NAV: NavItem[] = [
  { to: '/barbeiro', label: 'Hoje', icon: 'clock' }, { to: '/barbeiro/agenda', label: 'Minha agenda', icon: 'calendar' },
  { to: '/barbeiro/disponibilidade', label: 'Disponibilidade', icon: 'settings' }, { to: '/barbeiro/comissoes', label: 'Comissões', icon: 'wallet' },
  { to: '/barbeiro/historico', label: 'Histórico', icon: 'log' },
];

export function BarberApp() {
  const path = usePath();
  const page = path.replace('/barbeiro', '').replace(/^\//, '') || 'hoje';
  const titles: Record<string, string> = { hoje: 'Hoje', agenda: 'Minha agenda', disponibilidade: 'Disponibilidade', comissoes: 'Comissões e desempenho', historico: 'Histórico de atendimentos' };
  return (
    <RequireStaff barber>
      <PanelLayout nav={NAV} title={titles[page] || 'Painel'} subtitle="Painel do barbeiro">
        {page === 'hoje' && <Today />}
        {page === 'agenda' && <AgendaBoard mode="barbeiro" />}
        {page === 'disponibilidade' && <Availability />}
        {page === 'comissoes' && <Commissions />}
        {page === 'historico' && <History />}
      </PanelLayout>
    </RequireStaff>
  );
}

function useMyBarber() {
  const { session } = useAuth();
  return useLoad(() => db.select('barbers', { profile_id: session!.user.id }).then((r) => r[0] || null));
}

function Today() {
  const me = useMyBarber();
  const today = isoDay();
  const evs = useLoad(() => db.rpc<any[]>('agenda_view', { p_from: spToIso(today, '00:00'), p_to: spToIso(addDays(today, 1), '00:00') }));
  const metrics = useLoad(() => db.rpc<any>('my_barber_metrics', { p_from: today.slice(0, 8) + '01', p_to: today }));
  const [sel, setSel] = useState<any>(null);
  if (me.loading || evs.loading) return <Loading />;
  if (!me.data) return <Empty title="Perfil profissional não vinculado" text="Peça ao proprietário para vincular sua conta ao cadastro de barbeiro em Equipe." />;
  if (evs.error) return <ErrorBox error={evs.error} onRetry={evs.reload} />;
  const active = evs.data!.filter((e) => !['cancelado_cliente', 'cancelado_barbearia'].includes(e.status));
  const inService = active.find((e) => e.status === 'em_atendimento' || e.status === 'cliente_chegou');
  const next = inService || active.find((e) => ['pendente', 'confirmado'].includes(e.status) && new Date(e.ends_at).getTime() > Date.now());
  const m = metrics.data;
  return (
    <>
      <div className="grid-2">
        {next ? (
          <section className="next-client" aria-label="Próximo atendimento">
            <span className="muted">{next.status === 'em_atendimento' ? 'Em atendimento agora' : next.status === 'cliente_chegou' ? 'Cliente aguardando' : 'Próximo cliente'}</span>
            <div className="when">{fmtTime(next.starts_at)}</div>
            <div><strong style={{ fontSize: 20 }}>{next.customer_name}</strong><div className="muted">{next.services} · {money(next.total_price)}{next.covered_by_plan ? ' · plano' : ''}</div></div>
            {next.customer_notes && <p>“{next.customer_notes}”</p>}
            <p className="muted">{next.visits_count > 0 ? `${next.visits_count} visita(s) anteriores` : 'Primeira visita'}</p>
            <div><Button variant="light" onClick={() => setSel(next)}>{next.status === 'em_atendimento' ? 'Finalizar atendimento' : 'Abrir atendimento'}</Button></div>
          </section>
        ) : <section className="card"><Empty title="Sem próximos atendimentos hoje" text="Novos agendamentos aparecem aqui automaticamente." /></section>}
        <section className="kpis" style={{ alignContent: 'start' }}>
          <div className="kpi"><span>Atendimentos hoje</span><strong>{active.length}</strong><small>{active.filter((e) => e.status === 'finalizado').length} finalizados</small></div>
          <div className="kpi"><span>Comissão no mês</span><strong>{money(m?.comissao_periodo)}</strong><small>{money(m?.comissao_pendente)} a receber</small></div>
          <div className="kpi"><span>Atendimentos no mês</span><strong>{m?.atendimentos ?? '–'}</strong><small>{m?.faltas ?? 0} faltas</small></div>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2>Agenda de hoje</h2><Button size="sm" variant="line" onClick={evs.reload}>Atualizar</Button></div>
        {evs.data!.length === 0 ? <Empty title="Nenhum agendamento hoje" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Horário</th><th>Cliente</th><th>Serviços</th><th className="num">Valor</th><th>Status</th><th /></tr></thead>
            <tbody>{evs.data!.map((e) => (
              <tr key={e.id}><td className="cell-strong">{fmtTime(e.starts_at)}</td><td>{e.customer_name}</td><td>{e.services}</td><td className="num">{money(e.total_price)}</td>
                <td><Badge tone={APPT_STATUS[e.status].tone}>{APPT_STATUS[e.status].label}</Badge></td><td className="actions"><Button size="sm" variant="ghost" onClick={() => setSel(e)}>Abrir</Button></td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      {sel && <EventModal ev={sel} mode="barbeiro" onClose={() => setSel(null)} onChanged={() => { setSel(null); evs.reload(); metrics.reload(); }} />}
    </>
  );
}

function Availability() {
  const { can } = useAuth();
  const me = useMyBarber();
  const toast = useToast();
  const confirm = useConfirm();
  const sched = useLoad(() => (me.data ? db.select('barber_schedules', { barber_id: me.data.id }, { order: 'weekday.asc' }) : Promise.resolve([])), [me.data?.id]);
  const offs = useLoad(() => (me.data ? db.select('time_off', { barber_id: me.data.id }, { order: 'starts_at.desc', limit: 30 }) : Promise.resolve([])), [me.data?.id]);
  const [add, setAdd] = useState(false);
  const [req, setReq] = useState(false);
  if (me.loading) return <Loading />;
  if (!me.data) return <Empty title="Perfil profissional não vinculado" />;
  const editable = can('disponibilidade.editar');
  return (
    <div className="grid-2-even">
      <section className="card">
        <div className="card-head"><h2>Escala semanal</h2>{editable && <Button size="sm" onClick={() => setAdd(true)}>Adicionar faixa</Button>}</div>
        <p className="cell-sub" style={{ marginBottom: 10 }}>Dias sem faixa seguem o horário de funcionamento da barbearia.</p>
        {sched.data?.length === 0 ? <p className="muted">Nenhuma faixa definida.</p> : (
          <ul className="list-plain">{sched.data?.map((s: any) => (
            <li key={s.id}><span>{WEEKDAYS[s.weekday]} · {s.starts_at.slice(0, 5)} – {s.ends_at.slice(0, 5)}</span>
              {editable && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Remover faixa?', text: 'Novos agendamentos deixarão de usar esta faixa.', danger: true, confirm: 'Remover' })) { try { await db.remove('barber_schedules', { id: s.id }); sched.reload(); } catch (e) { toast.error((e as Error).message); } } }}>Remover</Button>}</li>
          ))}</ul>
        )}
      </section>
      <section className="card">
        <div className="card-head"><h2>Folgas e indisponibilidades</h2><Button size="sm" onClick={() => setReq(true)}>Informar</Button></div>
        {offs.data?.length === 0 ? <p className="muted">Nada registrado.</p> : (
          <ul className="list-plain">{offs.data?.map((o: any) => (
            <li key={o.id}><span>{o.kind === 'folga' ? 'Folga' : o.kind === 'indisponibilidade' ? 'Indisponível' : 'Bloqueio'} · {fmtDateTime(o.starts_at)} até {fmtDateTime(o.ends_at)}{o.reason && <><br /><span className="cell-sub">{o.reason}</span></>}</span>
              <Badge tone={o.status === 'aprovado' ? 'ok' : o.status === 'pendente' ? 'warn' : 'bad'}>{o.status}</Badge></li>
          ))}</ul>
        )}
      </section>
      {add && <AddSchedule barberId={me.data.id} onClose={() => setAdd(false)} onDone={() => { setAdd(false); sched.reload(); }} />}
      {req && <RequestOff onClose={() => setReq(false)} onDone={() => { setReq(false); offs.reload(); }} />}
    </div>
  );
}

export function AddSchedule({ barberId, onClose, onDone }: { barberId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ weekday: '1', starts_at: '09:00', ends_at: '20:00' });
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Faixa de trabalho" footer={<Button onClick={async () => {
      if (f.ends_at <= f.starts_at) return toast.error('O fim deve ser depois do início');
      try { await db.insert('barber_schedules', { barber_id: barberId, weekday: Number(f.weekday), starts_at: f.starts_at, ends_at: f.ends_at }); toast.ok('Faixa adicionada'); onDone(); } catch (e) { toast.error((e as Error).message); }
    }}>Salvar</Button>}>
      <div className="form-grid">
        <Field label="Dia" className="span-2"><Select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>{WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</Select></Field>
        <Field label="Início"><Input type="time" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
        <Field label="Fim"><Input type="time" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RequestOff({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: 'folga', from: isoDay(), fromT: '09:00', to: isoDay(), toT: '20:00', reason: '' });
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Folga ou indisponibilidade" footer={<Button onClick={async () => {
      const s = spToIso(f.from, f.fromT), e = spToIso(f.to, f.toT);
      if (e <= s) return toast.error('O fim deve ser depois do início');
      try { await db.rpc('request_time_off', { p_starts: s, p_ends: e, p_kind: f.kind, p_reason: f.reason || null }); toast.ok(f.kind === 'folga' ? 'Solicitação enviada para aprovação' : 'Agenda bloqueada'); onDone(); } catch (er) { toast.error((er as Error).message); }
    }}>{f.kind === 'folga' ? 'Solicitar folga' : 'Bloquear agenda'}</Button>}>
      <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="folga">Folga (precisa de aprovação)</option><option value="indisponibilidade">Indisponibilidade pontual (bloqueia na hora)</option></Select></Field>
      <div className="form-grid">
        <Field label="De"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Hora"><Input type="time" value={f.fromT} onChange={(e) => setF({ ...f, fromT: e.target.value })} /></Field>
        <Field label="Até"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field><Field label="Hora"><Input type="time" value={f.toT} onChange={(e) => setF({ ...f, toT: e.target.value })} /></Field>
      </div>
      <Field label="Motivo"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </Modal>
  );
}

function Commissions() {
  const [from, setFrom] = useState(isoDay().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDay());
  const m = useLoad(() => db.rpc<any>('my_barber_metrics', { p_from: from, p_to: to }), [from, to]);
  const list = useLoad(() => db.select('commissions', { created_at: `gte.${spToIso(from, '00:00')}` }, { order: 'created_at.desc', limit: 200 }), [from]);
  const rows = (list.data || []).filter((c: any) => c.created_at < spToIso(addDays(to, 1), '00:00'));
  return (
    <>
      <div className="toolbar"><Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      {m.data && <div className="kpis">
        <div className="kpi hero-kpi"><span>Comissão no período</span><strong>{money(m.data.comissao_periodo)}</strong></div>
        <div className="kpi"><span>A receber (total)</span><strong>{money(m.data.comissao_pendente)}</strong></div>
        <div className="kpi"><span>Pago no período</span><strong>{money(m.data.comissao_paga)}</strong></div>
        <div className="kpi"><span>Atendimentos</span><strong>{m.data.atendimentos}</strong><small>{money(m.data.receita_gerada)} gerados</small></div>
        <div className="kpi"><span>Faltas de clientes</span><strong>{m.data.faltas}</strong></div>
      </div>}
      <section className="card">
        <h2 style={{ fontSize: 15.5, marginBottom: 10 }}>Lançamentos</h2>
        {list.loading ? <Loading /> : rows.length === 0 ? <Empty title="Sem comissões no período" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Origem</th><th className="num">Base</th><th>Regra</th><th className="num">Comissão</th><th>Status</th></tr></thead>
            <tbody>{rows.map((c: any) => <tr key={c.id}><td>{fmtDate(c.created_at)}</td><td>{c.description} <span className="cell-sub">({c.source})</span></td><td className="num">{money(c.base_amount)}</td>
              <td>{c.rate_type === 'percentual' ? `${Number(c.rate_value)}%` : money(c.rate_value)}</td><td className="num cell-strong">{money(c.amount)}</td><td><Badge tone={c.status === 'pago' ? 'ok' : c.status === 'pendente' ? 'warn' : 'muted'}>{c.status}</Badge></td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}

function History() {
  const today = isoDay();
  const [from, setFrom] = useState(addDays(today, -30));
  const evs = useLoad(() => db.rpc<any[]>('agenda_view', { p_from: spToIso(from, '00:00'), p_to: spToIso(addDays(today, 1), '00:00') }), [from]);
  const done = (evs.data || []).filter((e) => e.status === 'finalizado').reverse();
  return (
    <section className="card">
      <div className="card-head"><h2>Atendimentos finalizados</h2><Field label="Desde"><Input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></Field></div>
      {evs.loading ? <Loading /> : done.length === 0 ? <Empty title="Nenhum atendimento finalizado no período" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Cliente</th><th>Serviços</th><th>Observações</th><th className="num">Valor</th></tr></thead>
          <tbody>{done.map((e) => <tr key={e.id}><td>{fmtDateTime(e.starts_at)}</td><td>{e.customer_name}</td><td>{e.services}</td><td className="cell-sub">{e.professional_notes}</td><td className="num">{money(e.total_price)}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}
