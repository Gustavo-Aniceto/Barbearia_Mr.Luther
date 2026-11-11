'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { addDays, fmtDate, fmtDateTime, isoDay, money, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Pager, Select, Tabs, useConfirm, useTable, useToast } from '../lib/ui';
import { EntityModal, exportCsv, usePaymentMethods } from '../panel/Layout';
import { ReceiveModal } from './Catalog';

const CAT: Record<string, string> = { servico: 'Serviços', produto: 'Produtos', plano: 'Planos', despesa_fixa: 'Despesa fixa', despesa_variavel: 'Despesa variável', fornecedor: 'Fornecedor', comissao: 'Comissões', outros: 'Outros' };

export function Finance() {
  const [tab, setTab] = useState<'lancamentos' | 'comissoes' | 'fechamentos' | 'formas'>('lancamentos');
  const [from, setFrom] = useState(isoDay().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDay());
  const sum = useLoad(() => db.rpc<any>('financial_summary', { p_from: from, p_to: to }), [from, to, tab]);
  return (
    <>
      <div className="toolbar">
        <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {sum.error ? <ErrorBox error={sum.error} /> : sum.data && (
        <div className="kpis">
          <div className="kpi hero-kpi"><span>Faturado (competência)</span><strong>{money(sum.data.faturado)}</strong><small>serviços finalizados, pedidos e planos</small></div>
          <div className="kpi"><span>Recebido</span><strong>{money(sum.data.recebido)}</strong></div>
          <div className="kpi"><span>A receber</span><strong>{money(sum.data.a_receber)}</strong></div>
          <div className="kpi"><span>Despesas pagas</span><strong>{money(sum.data.despesas_pagas)}</strong></div>
          <div className="kpi"><span>Contas a pagar</span><strong>{money(sum.data.a_pagar)}</strong></div>
          <div className="kpi"><span>Saldo de caixa</span><strong>{money(Number(sum.data.recebido) - Number(sum.data.despesas_pagas))}</strong><small>recebido − pago</small></div>
        </div>
      )}
      {sum.data && (Object.keys(sum.data.por_forma_pagamento).length > 0 || Object.keys(sum.data.por_categoria).length > 0) && (
        <div className="grid-2-even">
          <section className="card"><h2 style={{ fontSize: 15, marginBottom: 8 }}>Receita por origem</h2><ul className="list-plain">{Object.entries(sum.data.por_categoria).map(([k, v]) => <li key={k}><span>{CAT[k] || k}</span><strong>{money(v as number)}</strong></li>)}</ul></section>
          <section className="card"><h2 style={{ fontSize: 15, marginBottom: 8 }}>Recebimentos por forma de pagamento</h2><ul className="list-plain">{Object.entries(sum.data.por_forma_pagamento).map(([k, v]) => <li key={k}><span>{k}</span><strong>{money(v as number)}</strong></li>)}</ul></section>
        </div>
      )}
      <Tabs tabs={[{ id: 'lancamentos', label: 'Lançamentos' }, { id: 'comissoes', label: 'Comissões' }, { id: 'fechamentos', label: 'Fechamentos' }, { id: 'formas', label: 'Formas de pagamento' }]} value={tab} onChange={setTab} />
      {tab === 'lancamentos' && <Transactions from={from} to={to} onChange={sum.reload} />}
      {tab === 'comissoes' && <CommissionsAdmin from={from} to={to} />}
      {tab === 'fechamentos' && <Closings />}
      {tab === 'formas' && <PaymentMethods />}
    </>
  );
}

function Transactions({ from, to, onChange }: { from: string; to: string; onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const pms = usePaymentMethods();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const tx = useLoad(() => db.select('transactions', { competence_date: `gte.${from}`, ...(kind ? { kind } : {}), ...(status ? { status } : {}) }, { order: 'competence_date.desc', limit: 2000 }), [from, kind, status]);
  const rows = (tx.data || []).filter((t: any) => t.competence_date <= to);
  const t = useTable(rows, { search: (r: any) => r.description, pageSize: 20 });
  const [edit, setEdit] = useState<any>(null);
  const [settle, setSettle] = useState<any>(null);
  const reload = () => { tx.reload(); onChange(); };
  return (
    <section className="card">
      <div className="card-head">
        <div className="toolbar">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }} aria-label="Tipo"><option value="">Receitas e despesas</option><option value="receita">Receitas</option><option value="despesa">Despesas</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status"><option value="">Todos os status</option><option value="pendente">Pendente</option><option value="recebido">Recebido</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></Select>
        </div>
        <div className="toolbar">
          {can('financeiro.exportar') && <Button size="sm" variant="line" onClick={() => exportCsv(`financeiro-${from}-a-${to}`, rows.map((r: any) => ({ data: r.competence_date, tipo: r.kind, categoria: CAT[r.category], descricao: r.description, valor: String(r.amount).replace('.', ','), status: r.status, vencimento: r.due_date || '', quitado_em: r.settled_at ? fmtDateTime(r.settled_at) : '' })))}>Exportar CSV</Button>}
          {can('financeiro.criar') && <Button size="sm" onClick={() => setEdit({ kind: 'despesa', status: 'pendente', category: 'despesa_variavel', competence_date: isoDay() })}>Novo lançamento</Button>}
        </div>
      </div>
      {tx.loading ? <Loading /> : t.total === 0 ? <Empty title="Nenhum lançamento no período" text="Receitas surgem ao finalizar atendimentos, pedidos e planos. Registre aqui despesas e contas a pagar." /> : (<>
        <div className="table-wrap"><table className="table"><thead><tr>{t.th('competence_date', 'Data')}{t.th('description', 'Descrição')}<th>Categoria</th>{t.th('amount', 'Valor')}<th>Status</th><th /></tr></thead>
          <tbody>{t.rows.map((r: any) => (
            <tr key={r.id}><td>{fmtDate(r.competence_date + 'T12:00:00Z')}{r.due_date && r.status === 'pendente' && <div className="cell-sub">vence {fmtDate(r.due_date + 'T12:00:00Z')}</div>}</td>
              <td className="cell-strong">{r.description}</td><td>{CAT[r.category]}</td>
              <td className="num" style={{ color: r.kind === 'despesa' ? 'var(--bad)' : undefined }}>{r.kind === 'despesa' ? '−' : ''}{money(r.amount)}</td>
              <td><Badge tone={r.status === 'pendente' ? 'warn' : r.status === 'cancelado' ? 'muted' : 'ok'}>{r.status}</Badge></td>
              <td className="actions">{r.status === 'pendente' && can('financeiro.criar') && <Button size="sm" variant="ghost" onClick={() => setSettle(r)}>{r.kind === 'receita' ? 'Receber' : 'Pagar'}</Button>}
                {r.status === 'pendente' && can('financeiro.editar') && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Cancelar lançamento?', text: 'O registro é mantido no histórico como cancelado.', danger: true, confirm: 'Cancelar lançamento' })) { try { await db.update('transactions', { id: r.id }, { status: 'cancelado' }); reload(); } catch (e) { toast.error((e as Error).message); } } }}>Cancelar</Button>}</td></tr>
          ))}</tbody></table></div>
        <Pager page={t.page} pageSize={t.size} total={t.total} onPage={t.setPage} /></>)}
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title="Novo lançamento" initial={edit || {}}
        fields={[{ key: 'kind', label: 'Tipo', type: 'select', required: true, options: [{ value: 'despesa', label: 'Despesa / conta a pagar' }, { value: 'receita', label: 'Outra receita' }] },
          { key: 'category', label: 'Categoria', type: 'select', required: true, options: Object.entries(CAT).filter(([k]) => !['servico', 'produto', 'plano', 'comissao'].includes(k)).map(([value, label]) => ({ value, label })) },
          { key: 'description', label: 'Descrição', required: true, span: true }, { key: 'amount', label: 'Valor', type: 'money', required: true, min: 0.01 },
          { key: 'competence_date', label: 'Competência', type: 'date', required: true }, { key: 'due_date', label: 'Vencimento', type: 'date' },
          { key: 'status', label: 'Situação', type: 'select', required: true, options: [{ value: 'pendente', label: 'Pendente' }, { value: 'quitado', label: 'Já pago / recebido' }] }]}
        onSave={async (v) => { await db.insert('transactions', { kind: v.kind, category: v.category, description: v.description, amount: v.amount, competence_date: v.competence_date, due_date: v.due_date,
          status: v.status === 'quitado' ? (v.kind === 'receita' ? 'recebido' : 'pago') : 'pendente', settled_at: v.status === 'quitado' ? new Date().toISOString() : null }); toast.ok('Lançamento registrado'); reload(); }} />
      {settle && <ReceiveModal title={`${settle.kind === 'receita' ? 'Receber' : 'Pagar'}: ${settle.description} · ${money(settle.amount)}`} pms={pms} onClose={() => setSettle(null)}
        onConfirm={async (pm) => { await db.rpc('register_payment', { p_transaction_id: settle.id, p_payment_method_id: pm }); toast.ok('Lançamento quitado'); reload(); }} />}
    </section>
  );
}

function CommissionsAdmin({ from, to }: { from: string; to: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const barbers = useLoad(() => db.select('barbers', {}, { order: 'sort_order.asc' }));
  const com = useLoad(() => db.select('commissions', { status: 'neq.cancelado' }, { order: 'created_at.desc', limit: 3000 }));
  const payouts = useLoad(() => db.select('payouts', {}, { order: 'paid_at.desc', limit: 50 }));
  const inRange = (com.data || []).filter((c: any) => c.created_at.slice(0, 10) >= from && c.created_at.slice(0, 10) <= to);
  if (com.loading) return <Loading />;
  return (<>
    <section className="card">
      <div className="card-head"><h2>Consolidado por profissional</h2>{can('financeiro.exportar') && <Button size="sm" variant="line" onClick={() => exportCsv(`comissoes-${from}-a-${to}`, inRange.map((c: any) => ({ data: fmtDate(c.created_at), profissional: barbers.data?.find((b: any) => b.id === c.barber_id)?.display_name, origem: c.description, base: c.base_amount, comissao: c.amount, status: c.status })))}>Exportar CSV</Button>}</div>
      {!barbers.data?.length ? <Empty title="Nenhum profissional" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Profissional</th><th className="num">No período</th><th className="num">Pendente (total)</th><th className="num">Pago no período</th><th /></tr></thead>
          <tbody>{barbers.data.map((b: any) => {
            const mine = inRange.filter((c: any) => c.barber_id === b.id);
            const pending = (com.data || []).filter((c: any) => c.barber_id === b.id && c.status === 'pendente').reduce((a: number, c: any) => a + Number(c.amount), 0);
            return <tr key={b.id}><td className="cell-strong">{b.display_name}</td><td className="num">{money(mine.reduce((a: number, c: any) => a + Number(c.amount), 0))}</td><td className="num">{money(pending)}</td>
              <td className="num">{money(mine.filter((c: any) => c.status === 'pago').reduce((a: number, c: any) => a + Number(c.amount), 0))}</td>
              <td className="actions">{pending > 0 && can('financeiro.aprovar') && <Button size="sm" onClick={async () => {
                if (!(await confirm({ title: `Pagar comissões de ${b.display_name}?`, text: `Repasse de ${money(pending)} referente às comissões pendentes até ${fmtDate(to + 'T12:00:00Z')}. Será lançado como despesa paga.`, confirm: 'Registrar repasse' }))) return;
                try { await db.rpc('pay_commissions', { p_barber_id: b.id, p_until: to }); toast.ok('Repasse registrado'); com.reload(); payouts.reload(); } catch (e) { toast.error((e as Error).message); }
              }}>Registrar repasse</Button>}</td></tr>;
          })}</tbody></table></div>
      )}
    </section>
    <section className="card"><h2 style={{ fontSize: 15, marginBottom: 8 }}>Repasses realizados</h2>
      {!payouts.data?.length ? <p className="muted">Nenhum repasse registrado.</p> : <ul className="list-plain">{payouts.data.map((p: any) => <li key={p.id}><span>{barbers.data?.find((b: any) => b.id === p.barber_id)?.display_name} · {fmtDate(p.period_start + 'T12:00:00Z')} a {fmtDate(p.period_end + 'T12:00:00Z')}</span><strong>{money(p.amount)}</strong></li>)}</ul>}
    </section>
  </>);
}

function Closings() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useLoad(() => db.select('cash_closings', {}, { order: 'period_start.desc', limit: 60 }));
  const [day, setDay] = useState(isoDay());
  return (
    <section className="card">
      <div className="card-head"><h2>Fechamentos de caixa</h2>{can('financeiro.aprovar') && <div className="toolbar">
        <Input type="date" value={day} max={isoDay()} onChange={(e) => setDay(e.target.value)} aria-label="Data do fechamento" style={{ width: 'auto' }} />
        <Button size="sm" variant="line" onClick={async () => { try { await db.rpc('close_cash', { p_type: 'diario', p_date: day }); toast.ok('Fechamento diário registrado'); list.reload(); } catch (e) { toast.error((e as Error).message); } }}>Fechar dia</Button>
        <Button size="sm" onClick={async () => { try { await db.rpc('close_cash', { p_type: 'mensal', p_date: day }); toast.ok('Fechamento mensal registrado'); list.reload(); } catch (e) { toast.error((e as Error).message); } }}>Fechar mês</Button></div>}</div>
      {!list.data?.length ? <Empty title="Nenhum fechamento" text="O fechamento grava um retrato dos totais do período. Pode ser refeito para incluir lançamentos tardios." /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Período</th><th>Tipo</th><th className="num">Faturado</th><th className="num">Recebido</th><th className="num">Despesas pagas</th><th>Fechado em</th></tr></thead>
          <tbody>{list.data.map((c: any) => <tr key={c.id}><td>{fmtDate(c.period_start + 'T12:00:00Z')}{c.period_type === 'mensal' && ` a ${fmtDate(c.period_end + 'T12:00:00Z')}`}</td><td>{c.period_type}</td><td className="num">{money(c.totals.faturado)}</td><td className="num">{money(c.totals.recebido)}</td><td className="num">{money(c.totals.despesas_pagas)}</td><td className="cell-sub">{fmtDateTime(c.closed_at)}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function PaymentMethods() {
  const { can } = useAuth();
  const list = useLoad(() => db.select('payment_methods', {}, { order: 'sort_order.asc' }));
  const [edit, setEdit] = useState<any>(null);
  return (
    <section className="card">
      <div className="card-head"><h2>Formas de pagamento</h2>{can('financeiro.gerenciar') && <Button size="sm" onClick={() => setEdit({ active: true, kind: 'outro', sort_order: 10 })}>Nova forma</Button>}</div>
      <ul className="list-plain">{(list.data || []).map((p: any) => <li key={p.id}><span>{p.name}</span><span><Badge tone={p.active ? 'ok' : 'muted'}>{p.active ? 'Ativa' : 'Inativa'}</Badge> {can('financeiro.gerenciar') && <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Editar</Button>}</span></li>)}</ul>
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title="Forma de pagamento" initial={edit || {}}
        fields={[{ key: 'name', label: 'Nome', required: true }, { key: 'kind', label: 'Tipo', type: 'select', required: true, options: [{ value: 'dinheiro', label: 'Dinheiro' }, { value: 'pix', label: 'Pix' }, { value: 'cartao_credito', label: 'Cartão de crédito' }, { value: 'cartao_debito', label: 'Cartão de débito' }, { value: 'outro', label: 'Outro' }] },
          { key: 'sort_order', label: 'Ordem', type: 'number' }, { key: 'active', label: 'Ativa', type: 'toggle' }]}
        onSave={async (v) => { const row = { name: v.name, kind: v.kind, sort_order: v.sort_order ?? 0, active: !!v.active }; edit.id ? await db.update('payment_methods', { id: edit.id }, row) : await db.insert('payment_methods', row); list.reload(); }} />
    </section>
  );
}

export { addDays };
