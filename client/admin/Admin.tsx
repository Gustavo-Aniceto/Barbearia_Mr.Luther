'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { Link, addDays, isoDay, money, useAuth, useLoad, usePath } from '../lib/core';
import { BarChart, Button, Empty, ErrorBox, Field, Input, Loading, Icon } from '../lib/ui';
import { AgendaBoard } from '../panel/Agenda';
import { NavItem, PanelLayout, RequireStaff, exportCsv } from '../panel/Layout';
import { Customers, Team, UsersPermissions } from './People';
import { Services, Products, Orders, Plans } from './Catalog';
import { Finance } from './Finance';
import { Affiliates } from './Growth';
import { Compliance, Audit } from './Compliance';
import { Settings, SiteContent } from './Settings';

const NAV: NavItem[] = [
  { to: '/admin', label: 'Visão geral', icon: 'chart', perm: 'relatorios.visualizar', group: 'Operação', short: 'Início' },
  { to: '/admin/agenda', label: 'Agenda', icon: 'calendar', perm: 'agenda.visualizar', group: 'Operação' },
  { to: '/admin/clientes', label: 'Clientes', icon: 'users', perm: 'clientes.visualizar', group: 'Operação' },
  { to: '/admin/pedidos', label: 'Pedidos', icon: 'bag', perm: 'pedidos.visualizar', group: 'Operação' },
  { to: '/admin/servicos', label: 'Serviços', icon: 'scissors', perm: 'servicos.visualizar', group: 'Cadastros' },
  { to: '/admin/equipe', label: 'Equipe', icon: 'user', perm: 'equipe.visualizar', group: 'Cadastros' },
  { to: '/admin/produtos', label: 'Produtos e estoque', icon: 'box', perm: 'produtos.visualizar', group: 'Cadastros' },
  { to: '/admin/planos', label: 'Planos e assinaturas', icon: 'crown', perm: 'planos.visualizar', group: 'Cadastros' },
  { to: '/admin/financeiro', label: 'Financeiro', icon: 'wallet', perm: 'financeiro.visualizar', group: 'Gestão' },
  { to: '/admin/club', label: 'MR.LUDER Club', icon: 'gift', perm: 'afiliados.visualizar', group: 'Gestão' },
  { to: '/admin/site', label: 'Conteúdo do site', icon: 'image', perm: 'site.visualizar', group: 'Gestão' },
  { to: '/admin/acessos', label: 'Usuários e permissões', icon: 'key', perm: 'usuarios.visualizar', group: 'Segurança' },
  { to: '/admin/lgpd', label: 'LGPD', icon: 'shield', perm: 'lgpd.visualizar', group: 'Segurança' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: 'log', perm: 'auditoria.visualizar', group: 'Segurança' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: 'settings', perm: 'configuracoes.visualizar', group: 'Segurança' },
];

const PAGES: Record<string, { title: string; el: React.ReactNode; perm: string }> = {
  '': { title: 'Visão geral', el: <Dashboard />, perm: 'relatorios.visualizar' },
  agenda: { title: 'Agenda', el: <AgendaBoard mode="admin" />, perm: 'agenda.visualizar' },
  clientes: { title: 'Clientes', el: <Customers />, perm: 'clientes.visualizar' },
  pedidos: { title: 'Pedidos', el: <Orders />, perm: 'pedidos.visualizar' },
  servicos: { title: 'Serviços', el: <Services />, perm: 'servicos.visualizar' },
  equipe: { title: 'Equipe', el: <Team />, perm: 'equipe.visualizar' },
  produtos: { title: 'Produtos e estoque', el: <Products />, perm: 'produtos.visualizar' },
  planos: { title: 'Planos e assinaturas', el: <Plans />, perm: 'planos.visualizar' },
  financeiro: { title: 'Financeiro', el: <Finance />, perm: 'financeiro.visualizar' },
  club: { title: 'MR.LUDER Club', el: <Affiliates />, perm: 'afiliados.visualizar' },
  site: { title: 'Conteúdo do site', el: <SiteContent />, perm: 'site.visualizar' },
  acessos: { title: 'Usuários e permissões', el: <UsersPermissions />, perm: 'usuarios.visualizar' },
  lgpd: { title: 'LGPD', el: <Compliance />, perm: 'lgpd.visualizar' },
  auditoria: { title: 'Auditoria', el: <Audit />, perm: 'auditoria.visualizar' },
  configuracoes: { title: 'Configurações', el: <Settings />, perm: 'configuracoes.visualizar' },
};

export function AdminApp() {
  const path = usePath();
  const { can, access } = useAuth();
  const key = path.replace(/^\/admin\/?/, '').split('/')[0];
  const nav = NAV.filter((n) => !n.perm || can(n.perm));
  let page = PAGES[key];
  // perfis sem acesso ao dashboard (ex.: recepção) abrem direto no primeiro módulo permitido
  if (key === '' && access && !can('relatorios.visualizar') && nav[0]) page = PAGES[nav[0].to.replace('/admin/', '')] || page;
  if (!page) page = { title: 'Página não encontrada', el: <Empty title="Página não encontrada" />, perm: '' };
  return (
    <RequireStaff>
      <PanelLayout nav={nav} tabs={['/admin', '/admin/agenda', '/admin/clientes', '/admin/financeiro']} title={page.title} subtitle={access?.is_owner ? 'Proprietário' : 'Equipe'}>
        <RequireStaff perm={page.perm || undefined}>{page.el}</RequireStaff>
      </PanelLayout>
    </RequireStaff>
  );
}

// ------------------------------------------------------------------ Dashboard
const PERIODS = [
  { id: 'hoje', label: 'Hoje', range: () => [isoDay(), isoDay()] },
  { id: '7d', label: '7 dias', range: () => [addDays(isoDay(), -6), isoDay()] },
  { id: 'mes', label: 'Este mês', range: () => [isoDay().slice(0, 8) + '01', isoDay()] },
  { id: '30d', label: '30 dias', range: () => [addDays(isoDay(), -29), isoDay()] },
];

function Dashboard() {
  const [period, setPeriod] = useState('mes');
  const [custom, setCustom] = useState<[string, string]>([isoDay().slice(0, 8) + '01', isoDay()]);
  const range = period === 'custom' ? custom : PERIODS.find((p) => p.id === period)!.range();
  const { data: m, error, loading, reload } = useLoad(() => db.rpc<any>('dashboard_metrics', { p_from: range[0], p_to: range[1] }), [range[0], range[1]]);
  const setup = useLoad(async () => {
    const [h, s, b, bs] = await Promise.all([db.select('business_hours', { is_open: true }), db.select('services', {}, { limit: 1 }), db.select('barbers', {}, { limit: 1 }), db.select('barber_services', {}, { limit: 1 })]);
    return { hours: h.length > 0, services: s.length > 0, barbers: b.length > 0, link: bs.length > 0 };
  });
  const pct = (v: number | null) => (v == null ? '–' : `${String(v).replace('.', ',')}%`);
  const st = setup.data;
  return (
    <>
      {st && !(st.hours && st.services && st.barbers && st.link) && (
        <section className="card">
          <div className="card-head"><h2>Primeiros passos para abrir a agenda online</h2></div>
          <ol className="setup-steps" style={{ padding: 0, margin: 0 }}>
            <li className={st.hours ? 'done' : ''}><span>Definir os dias e horários de funcionamento</span><Link to="/admin/configuracoes" className="btn btn-line btn-sm">Configurar</Link></li>
            <li className={st.barbers ? 'done' : ''}><span>Cadastrar os barbeiros</span><Link to="/admin/equipe" className="btn btn-line btn-sm">Equipe</Link></li>
            <li className={st.services ? 'done' : ''}><span>Cadastrar serviços com preço e duração</span><Link to="/admin/servicos" className="btn btn-line btn-sm">Serviços</Link></li>
            <li className={st.link ? 'done' : ''}><span>Vincular quem realiza cada serviço</span><Link to="/admin/servicos" className="btn btn-line btn-sm">Vincular</Link></li>
          </ol>
        </section>
      )}
      <div className="toolbar">
        <div className="price-cats light" style={{ margin: 0 }} role="group" aria-label="Período">
          {PERIODS.map((p) => <button key={p.id} className="chip" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
          <button className="chip" aria-pressed={period === 'custom'} onClick={() => setPeriod('custom')}>Personalizado</button>
        </div>
        {period === 'custom' && <><Field label="De"><Input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></Field><Field label="Até"><Input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></Field></>}
        <span className="spacer" />
        {m && <Button size="sm" variant="line" onClick={() => exportCsv(`indicadores-${range[0]}-a-${range[1]}`, m.serie_diaria)}>Exportar CSV</Button>}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !m ? <Loading /> : (
        <>
          <div className="kpis">
            <div className="kpi hero-kpi"><span>Faturamento do período</span><strong>{money(m.faturamento_periodo)}</strong><small>{money(m.recebido_periodo)} recebidos</small></div>
            <div className="kpi"><span>Faturamento hoje</span><strong>{money(m.faturamento_dia)}</strong></div>
            <div className="kpi"><span>Faturamento do mês</span><strong>{money(m.faturamento_mes)}</strong></div>
            <div className="kpi"><span>A receber</span><strong>{money(m.a_receber)}</strong><small>pendente em aberto</small></div>
            <div className="kpi"><span>Agendamentos</span><strong>{m.agendamentos}</strong><small>{m.pendentes} pendentes de confirmação</small></div>
            <div className="kpi"><span>Atendimentos finalizados</span><strong>{m.finalizados}</strong><small>Ticket médio {money(m.ticket_medio)}</small></div>
            <div className="kpi"><span>Cancelamentos / faltas</span><strong>{m.cancelamentos} / {m.nao_comparecimentos}</strong></div>
            <div className="kpi"><span>Ocupação da agenda</span><strong>{pct(m.ocupacao)}</strong><small>{m.ocupacao == null ? 'defina horários e equipe' : 'tempo reservado / disponível'}</small></div>
            <div className="kpi"><span>Clientes novos / recorrentes</span><strong>{m.clientes_novos} / {m.clientes_recorrentes}</strong></div>
            <div className="kpi"><span>Planos ativos</span><strong>{m.planos_ativos}</strong><small>Receita recorrente {money(m.mrr)}/mês</small></div>
            <div className="kpi"><span>Vendas de produtos</span><strong>{money(m.vendas_produtos)}</strong><small>{m.pedidos_pagos} pedidos pagos</small></div>
            <div className="kpi"><span>Estoque baixo</span><strong>{m.estoque_baixo}</strong><small><Link to="/admin/produtos" className="text-link">ver produtos</Link></small></div>
          </div>
          <div className="grid-2">
            <section className="card">
              <div className="card-head"><h2>Faturado × recebido por dia</h2><span className="cell-sub"><Icon name="chart" size={14} /> passe o mouse nas barras</span></div>
              <BarChart data={m.serie_diaria.map((d: any) => ({ label: d.dia.slice(8) + '/' + d.dia.slice(5, 7), value: Number(d.faturado), value2: Number(d.recebido) }))} secondary="var(--warm)" />
            </section>
            <section className="card">
              <div className="card-head"><h2>Desempenho dos profissionais</h2></div>
              {m.profissionais.length === 0 ? <Empty title="Sem profissionais ativos" /> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Profissional</th><th className="num">Atend.</th><th className="num">Receita</th><th className="num">Comissão</th></tr></thead>
                  <tbody>{m.profissionais.map((p: any) => <tr key={p.id}><td className="cell-strong">{p.nome}{p.faltas > 0 && <div className="cell-sub">{p.faltas} faltas de clientes</div>}</td><td className="num">{p.atendimentos}</td><td className="num">{money(p.receita)}</td><td className="num">{money(p.comissoes)}</td></tr>)}</tbody></table></div>
              )}
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h2>Atendimentos finalizados por dia</h2></div>
            <BarChart data={m.serie_diaria.map((d: any) => ({ label: d.dia.slice(8) + '/' + d.dia.slice(5, 7), value: Number(d.atendimentos) }))} height={120} format={(v) => `${v} atendimentos`} color="var(--moss-deep)" />
          </section>
        </>
      )}
    </>
  );
}
