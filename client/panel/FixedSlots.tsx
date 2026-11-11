'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { fmtDate, fmtDateTime, useLoad } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, Textarea, useConfirm, useToast } from '../lib/ui';

/**
 * Horários fixos dos assinantes. O barbeiro vê os pedidos feitos para ele;
 * a equipe com acesso à agenda vê todos. Aprovar reserva as datas do mês do plano.
 */
export function FixedSlotsCard({ showBarber = false, hideEmpty = false }: { showBarber?: boolean; hideEmpty?: boolean }) {
  const list = useLoad(() => db.rpc<any[]>('fixed_slots_board'));
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [decline, setDecline] = useState<any>(null);
  if (list.loading) return hideEmpty ? null : <section className="card"><Loading /></section>;
  if (list.error) return <section className="card"><ErrorBox error={list.error} onRetry={list.reload} /></section>;
  const pending = list.data!.filter((s) => s.status === 'pendente');
  const approved = list.data!.filter((s) => s.status === 'aprovado');
  if (hideEmpty && list.data!.length === 0) return null;

  async function approve(s: any) {
    setBusy(s.id);
    try {
      const r = await db.rpc<any>('decide_fixed_slot', { p_id: s.id, p_approve: true });
      const skipped: string[] = r?.skipped || [];
      toast.ok(`Horário fixo aprovado: ${r?.created ?? 0} data(s) reservada(s)${skipped.length ? `. Sem vaga em ${skipped.join(', ')}` : ''}. O cliente foi avisado.`);
      list.reload();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  }

  return (
    <section className="card" aria-labelledby="fixed-slots-title">
      <div className="card-head"><h2 id="fixed-slots-title">Horários fixos de assinantes</h2>{pending.length > 0 && <Badge tone="warn">{pending.length} aguardando</Badge>}</div>
      {list.data!.length === 0 ? <Empty title="Nenhum horário fixo" text="Quando um assinante pedir um horário fixo, o pedido aparece aqui para você aprovar." /> : (
        <ul className="slot-requests">
          {[...pending, ...approved].map((s) => (
            <li key={s.id} className={s.status === 'pendente' ? 'is-pending' : ''}>
              <div className="slot-requests-main">
                <strong>{s.customer_name}</strong>
                <span>{s.label}{showBarber ? ` · ${s.barber_name}` : ''}</span>
                <span className="muted">{s.plan}{s.period_end ? ` · plano até ${fmtDate(s.period_end)}` : ''}{s.customer_phone ? ` · ${s.customer_phone}` : ''}</span>
                {s.customer_note && <span className="muted">“{s.customer_note}”</span>}
                {s.status === 'aprovado' && <span className="muted">{s.next_date ? `Próximo: ${fmtDateTime(s.next_date)}` : 'Sem datas futuras neste período'}</span>}
              </div>
              <div className="slot-requests-actions">
                {s.status === 'pendente' ? <>
                  <Button size="sm" loading={busy === s.id} onClick={() => approve(s)}>Aprovar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDecline(s)}>Recusar</Button>
                </> : <>
                  <Badge tone="ok">Aprovado</Badge>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!(await confirm({ title: 'Cancelar este horário fixo?', text: `As próximas datas de ${s.customer_name} serão liberadas na agenda e o cliente será avisado.`, confirm: 'Cancelar horário fixo', danger: true }))) return;
                    try { const n = await db.rpc<number>('cancel_fixed_slot', { p_id: s.id }); toast.ok(`Horário fixo cancelado. ${n} data(s) liberada(s).`); list.reload(); } catch (e) { toast.error((e as Error).message); }
                  }}>Cancelar</Button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {decline && <DeclineModal slot={decline} onClose={() => setDecline(null)} onDone={() => { setDecline(null); list.reload(); }} />}
    </section>
  );
}

function DeclineModal({ slot, onClose, onDone }: { slot: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Recusar horário fixo" footer={<><Button variant="ghost" onClick={onClose}>Voltar</Button>
      <Button variant="danger" loading={busy} onClick={async () => {
        setBusy(true);
        try { await db.rpc('decide_fixed_slot', { p_id: slot.id, p_approve: false, p_note: note || null }); toast.ok('Pedido recusado. O cliente foi avisado.'); onDone(); } catch (e) { toast.error((e as Error).message); }
        setBusy(false);
      }}>Recusar pedido</Button></>}>
      <p className="muted">{slot.customer_name} pediu {slot.label}.</p>
      <Field label="Motivo (o cliente recebe)" hint="Ex.: nesse horário já tenho outro fixo; quinta às 18:00 está livre.">
        <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Planos que vencem nos próximos 7 dias (barbeiro: clientes dele; equipe de planos: todos). */
export function ExpiringPlansCard() {
  const list = useLoad(() => db.rpc<any[]>('expiring_subscriptions', { p_days: 7 }));
  if (list.loading) return null;
  if (list.error) return <section className="card"><ErrorBox error={list.error} onRetry={list.reload} /></section>;
  if (!list.data!.length) return null;
  return (
    <section className="card" aria-labelledby="expiring-title">
      <div className="card-head"><h2 id="expiring-title">Planos vencendo nos próximos 7 dias</h2><Badge tone="warn">{list.data!.length}</Badge></div>
      <ul className="slot-requests">
        {list.data!.map((s) => (
          <li key={s.id}>
            <div className="slot-requests-main">
              <strong>{s.customer_name}</strong>
              <span>{s.plan} · vence em {fmtDate(s.period_end)}</span>
              <span className="muted">{s.auto_renew ? 'Renovação automática' : 'Cliente cancelou a renovação'}{s.fixed_slot ? ` · horário fixo ${s.fixed_slot}` : ''}{s.customer_phone ? ` · ${s.customer_phone}` : ''}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
