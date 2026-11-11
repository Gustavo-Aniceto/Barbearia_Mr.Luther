'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { fmtDate, money, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, Loading, Tabs, useToast } from '../lib/ui';
import { EntityModal } from '../panel/Layout';

export function Affiliates() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'ranking' | 'indicacoes' | 'recompensas' | 'cupons' | 'regras'>('ranking');
  const affs = useLoad(() => db.select('affiliates', {}, { order: 'created_at.desc' }));
  const codes = useLoad(() => db.select('referral_codes'));
  const refs = useLoad(() => db.select('referrals', {}, { order: 'created_at.desc', limit: 1000 }));
  const rewards = useLoad(() => db.select('rewards', {}, { order: 'created_at.desc', limit: 1000 }));
  const customers = useLoad(() => db.select('customers', {}, { select: 'id,full_name', limit: 5000 }).catch(() => []));
  const coupons = useLoad(() => db.select('coupons', {}, { order: 'created_at.desc' }));
  const settings = useLoad(() => db.select('business_settings').then((r) => r[0]));
  const [editCoupon, setEditCoupon] = useState<any>(null);
  const [rules, setRules] = useState(false);
  const cname = (id: string) => customers.data?.find((c: any) => c.id === id)?.full_name || '—';
  const affName = (aid: string) => cname(affs.data?.find((a: any) => a.id === aid)?.customer_id);
  const ranking = (affs.data || []).map((a: any) => ({ ...a, valid: (refs.data || []).filter((r: any) => r.affiliate_id === a.id && r.status === 'validada').length, pending: (refs.data || []).filter((r: any) => r.affiliate_id === a.id && r.status === 'pendente').length,
    code: codes.data?.find((c: any) => c.affiliate_id === a.id)?.code })).sort((a: any, b: any) => b.valid - a.valid);
  const s = settings.data;
  const total = refs.data?.length || 0, valid = (refs.data || []).filter((r: any) => r.status === 'validada').length;
  return (
    <>
      <div className="kpis">
        <div className="kpi hero-kpi"><span>Afiliados</span><strong>{affs.data?.length ?? '–'}</strong></div>
        <div className="kpi"><span>Indicações</span><strong>{total}</strong><small>{valid} validadas</small></div>
        <div className="kpi"><span>Conversão</span><strong>{total ? `${Math.round((valid / total) * 100)}%` : '–'}</strong></div>
        <div className="kpi"><span>Recompensas emitidas</span><strong>{rewards.data?.length ?? '–'}</strong><small>{(rewards.data || []).filter((r: any) => r.status === 'resgatado').length} resgatadas</small></div>
        <div className="kpi"><span>Programa</span><strong>{s?.referral_enabled ? 'Ativo' : 'Pausado'}</strong><small>{s && (s.referral_reward_value > 0 || !['desconto_percentual', 'desconto_fixo', 'credito'].includes(s.referral_reward_kind) ? 'recompensa configurada' : 'defina a recompensa')}</small></div>
      </div>
      <Tabs tabs={[{ id: 'ranking', label: 'Ranking de afiliados' }, { id: 'indicacoes', label: 'Indicações' }, { id: 'recompensas', label: 'Recompensas' }, { id: 'cupons', label: 'Cupons' }, { id: 'regras', label: 'Regras do programa' }]} value={tab} onChange={setTab} />
      {tab === 'ranking' && <section className="card">{affs.loading ? <Loading /> : !ranking.length ? <Empty title="Nenhum afiliado ainda" text="Clientes geram o código na área “Club e cupons” da conta." /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Afiliado</th><th>Código</th><th className="num">Validadas</th><th className="num">Pendentes</th><th>Status</th><th /></tr></thead>
          <tbody>{ranking.map((a: any, i: number) => <tr key={a.id}><td>{i + 1}</td><td className="cell-strong">{cname(a.customer_id)}</td><td><code>{a.code}</code></td><td className="num">{a.valid}</td><td className="num">{a.pending}</td><td><Badge tone={a.status === 'ativo' ? 'ok' : 'bad'}>{a.status}</Badge></td>
            <td className="actions">{can('afiliados.editar') && <Button size="sm" variant="ghost" onClick={async () => { try { await db.update('affiliates', { id: a.id }, { status: a.status === 'ativo' ? 'suspenso' : 'ativo' }); affs.reload(); } catch (e) { toast.error((e as Error).message); } }}>{a.status === 'ativo' ? 'Suspender' : 'Reativar'}</Button>}</td></tr>)}</tbody></table></div>)}</section>}
      {tab === 'indicacoes' && <section className="card">{!refs.data?.length ? <Empty title="Nenhuma indicação" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Afiliado</th><th>Indicado</th><th>Status</th><th>Motivo</th><th /></tr></thead>
          <tbody>{refs.data.map((r: any) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{affName(r.affiliate_id)}</td><td>{cname(r.referred_customer_id)}</td>
            <td><Badge tone={r.status === 'validada' ? 'ok' : r.status === 'pendente' ? 'warn' : 'muted'}>{r.status}</Badge></td><td className="cell-sub">{r.reject_reason || (r.status === 'pendente' ? `expira ${fmtDate(r.expires_at)}` : '')}</td>
            <td className="actions">{r.status === 'pendente' && can('afiliados.aprovar') && <Button size="sm" variant="ghost" onClick={async () => { try { await db.update('referrals', { id: r.id }, { status: 'rejeitada', reject_reason: 'Rejeitada manualmente (suspeita de fraude)' }); refs.reload(); } catch (e) { toast.error((e as Error).message); } }}>Rejeitar</Button>}</td></tr>)}</tbody></table></div>)}</section>}
      {tab === 'recompensas' && <section className="card">{!rewards.data?.length ? <Empty title="Nenhuma recompensa emitida" /> : (
        <ul className="list-plain">{rewards.data.map((r: any) => <li key={r.id}><span><strong>{affName(r.affiliate_id)}</strong> · {r.description}{r.coupon_id && <span className="cell-sub"> · cupom {coupons.data?.find((c: any) => c.id === r.coupon_id)?.code}</span>}<br /><span className="cell-sub">{fmtDate(r.created_at)} · válida até {r.expires_at ? fmtDate(r.expires_at) : '–'}</span></span>
          <span><Badge tone={r.status === 'disponivel' ? 'info' : r.status === 'resgatado' ? 'ok' : 'muted'}>{r.status}</Badge> {r.status === 'disponivel' && !r.coupon_id && can('afiliados.editar') && <Button size="sm" variant="ghost" onClick={async () => { try { await db.update('rewards', { id: r.id }, { status: 'resgatado', redeemed_at: new Date().toISOString() }); rewards.reload(); } catch (e) { toast.error((e as Error).message); } }}>Marcar resgatada</Button>}</span></li>)}</ul>)}</section>}
      {tab === 'cupons' && <section className="card">
        <div className="card-head"><h2>Cupons</h2>{can('afiliados.editar') && <Button size="sm" onClick={() => setEditCoupon({ discount_type: 'percentual', active: true, min_order: 0 })}>Novo cupom</Button>}</div>
        {!coupons.data?.length ? <Empty title="Nenhum cupom" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Código</th><th>Desconto</th><th>Uso</th><th>Validade</th><th>Exclusivo de</th><th /></tr></thead>
            <tbody>{coupons.data.map((c: any) => <tr key={c.id}><td className="cell-strong">{c.code}<div className="cell-sub">{c.description}</div></td><td>{c.discount_type === 'percentual' ? `${Number(c.value)}%` : money(c.value)}</td><td>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
              <td>{c.valid_until ? fmtDate(c.valid_until) : 'sem prazo'}</td><td>{c.customer_id ? cname(c.customer_id) : 'Todos'}</td>
              <td className="actions">{can('afiliados.editar') && <Button size="sm" variant="ghost" onClick={() => setEditCoupon({ ...c, valid_until: c.valid_until?.slice(0, 10) })}>Editar</Button>}</td></tr>)}</tbody></table></div>
        )}</section>}
      {tab === 'regras' && s && <section className="card">
        <div className="card-head"><h2>Regras do programa</h2>{can('configuracoes.editar') && <Button size="sm" onClick={() => setRules(true)}>Editar regras</Button>}</div>
        <dl className="kv">
          <dt>Programa</dt><dd>{s.referral_enabled ? 'Ativo' : 'Pausado'}</dd>
          <dt>Recompensa</dt><dd>{s.referral_reward_description || `${s.referral_reward_kind.replace('_', ' ')} · ${s.referral_reward_kind === 'desconto_percentual' ? `${Number(s.referral_reward_value)}%` : money(s.referral_reward_value)}`}</dd>
          <dt>Validação</dt><dd>1º atendimento finalizado ou 1ª compra paga, em até {s.referral_validation_days} dias</dd>
          <dt>Indicações por recompensa</dt><dd>{s.referral_min_referrals}</dd>
          <dt>Limite por afiliado</dt><dd>{s.referral_max_rewards || 'sem limite'}</dd>
          <dt>Validade da recompensa</dt><dd>{s.referral_reward_validity_days} dias</dd>
          <dt>Antifraude</dt><dd>Bloqueia autoindicação, e-mail/telefone coincidentes, clientes com histórico e afiliados suspensos</dd>
        </dl>
      </section>}
      <EntityModal open={!!editCoupon} onClose={() => setEditCoupon(null)} title={editCoupon?.id ? 'Editar cupom' : 'Novo cupom'} initial={editCoupon || {}}
        fields={[{ key: 'code', label: 'Código', required: true, hint: 'Letras maiúsculas, números e hífen' }, { key: 'description', label: 'Descrição' },
          { key: 'discount_type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'percentual', label: 'Percentual' }, { value: 'fixo', label: 'Valor fixo' }] },
          { key: 'value', label: 'Desconto (% ou R$)', type: 'number', required: true, min: 0.01 }, { key: 'max_uses', label: 'Limite de usos', type: 'number', min: 1 },
          { key: 'min_order', label: 'Pedido mínimo', type: 'money', min: 0 }, { key: 'valid_until', label: 'Válido até', type: 'date' }, { key: 'active', label: 'Ativo', type: 'toggle' }]}
        onSave={async (v) => { const row = { code: String(v.code).toUpperCase(), description: v.description, discount_type: v.discount_type, value: v.value, max_uses: v.max_uses, min_order: v.min_order ?? 0, valid_until: v.valid_until ? `${v.valid_until}T23:59:59-03:00` : null, active: !!v.active };
          editCoupon.id ? await db.update('coupons', { id: editCoupon.id }, row) : await db.insert('coupons', row); coupons.reload(); }} />
      {s && <EntityModal open={rules} onClose={() => setRules(false)} title="Regras do MR.LUDER Club" initial={s}
        fields={[{ key: 'referral_enabled', label: 'Programa ativo', type: 'toggle' },
          { key: 'referral_reward_kind', label: 'Tipo de recompensa', type: 'select', required: true, options: [{ value: 'desconto_percentual', label: 'Cupom de desconto (%)' }, { value: 'desconto_fixo', label: 'Cupom de desconto (R$)' }, { value: 'credito', label: 'Crédito para serviços' }, { value: 'servico_gratuito', label: 'Serviço gratuito' }, { value: 'produto', label: 'Produto' }, { value: 'beneficio', label: 'Benefício exclusivo' }] },
          { key: 'referral_reward_value', label: 'Valor da recompensa (% ou R$)', type: 'number', min: 0 }, { key: 'referral_reward_description', label: 'Descrição exibida', hint: 'Ex.: 1 corte grátis' },
          { key: 'referral_min_referrals', label: 'Indicações válidas por recompensa', type: 'number', min: 1 }, { key: 'referral_max_rewards', label: 'Máximo de recompensas por afiliado', type: 'number', min: 1 },
          { key: 'referral_validation_days', label: 'Prazo de validação (dias)', type: 'number', min: 1 }, { key: 'referral_reward_validity_days', label: 'Validade da recompensa (dias)', type: 'number', min: 1 }]}
        onSave={async (v) => { await db.update('business_settings', { id: 1 }, { referral_enabled: !!v.referral_enabled, referral_reward_kind: v.referral_reward_kind, referral_reward_value: v.referral_reward_value ?? 0, referral_reward_description: v.referral_reward_description,
          referral_min_referrals: v.referral_min_referrals ?? 1, referral_max_rewards: v.referral_max_rewards, referral_validation_days: v.referral_validation_days ?? 60, referral_reward_validity_days: v.referral_reward_validity_days ?? 90 }); toast.ok('Regras atualizadas'); settings.reload(); }} />}
    </>
  );
}
