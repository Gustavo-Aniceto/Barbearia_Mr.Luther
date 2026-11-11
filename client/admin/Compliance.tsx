'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { fmtDate, fmtDateTime, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, Field, Icon, Loading, Modal, Pager, SearchBox, Select, Tabs, Textarea, useConfirm, useTable, useToast } from '../lib/ui';
import { EntityModal } from '../panel/Layout';

const KINDS: Record<string, string> = { copia: 'Cópia dos dados', correcao: 'Correção', informacoes: 'Informações', portabilidade: 'Portabilidade', exclusao: 'Exclusão/anonimização', revogacao: 'Revogação de consentimento' };

export function Compliance() {
  const [tab, setTab] = useState<'solicitacoes' | 'documentos' | 'seguranca'>('solicitacoes');
  return (<>
    <div className="notice"><Icon name="shield" /><span>Estes recursos apoiam o cumprimento da LGPD, mas não garantem conformidade por si só. Políticas, bases legais, prazos de retenção e o encarregado devem ser definidos pelos responsáveis da barbearia com orientação jurídica.</span></div>
    <Tabs tabs={[{ id: 'solicitacoes', label: 'Solicitações de titulares' }, { id: 'documentos', label: 'Termos e política' }, { id: 'seguranca', label: 'Segurança e retenção' }]} value={tab} onChange={setTab} />
    {tab === 'solicitacoes' && <Requests />}
    {tab === 'documentos' && <Documents />}
    {tab === 'seguranca' && <SecurityInfo />}
  </>);
}

function Requests() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const reqs = useLoad(() => db.select('privacy_requests', {}, { order: 'created_at.desc' }));
  const [sel, setSel] = useState<any>(null);
  const [resp, setResp] = useState('');
  const [status, setStatus] = useState('');
  const open = (r: any) => { setSel(r); setResp(r.response || ''); setStatus(r.status); };
  return (
    <section className="card">
      {reqs.loading ? <Loading /> : !reqs.data?.length ? <Empty title="Nenhuma solicitação" text="Pedidos feitos em “Privacidade e meus dados” aparecem aqui com prazo de resposta." /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Protocolo</th><th>Titular</th><th>Tipo</th><th>Prazo</th><th>Status</th><th /></tr></thead>
          <tbody>{reqs.data.map((r: any) => <tr key={r.id}><td className="cell-strong">{r.protocol}<div className="cell-sub">{fmtDateTime(r.created_at)}</div></td><td>{r.requester_name}<div className="cell-sub">{r.requester_email}{!r.user_id && ' · sem conta'}</div></td>
            <td>{KINDS[r.kind]}</td><td className={r.status !== 'concluida' && new Date(r.due_at) < new Date() ? 'field-error' : ''}>{fmtDate(r.due_at)}</td>
            <td><Badge tone={r.status === 'concluida' ? 'ok' : r.status === 'recusada' ? 'muted' : 'warn'}>{r.status.replace('_', ' ')}</Badge></td>
            <td className="actions"><Button size="sm" variant="ghost" onClick={() => open(r)}>Tratar</Button></td></tr>)}</tbody></table></div>
      )}
      {sel && <Modal open onClose={() => setSel(null)} title={`${sel.protocol} · ${KINDS[sel.kind]}`} footer={<>
        {sel.kind === 'exclusao' && sel.user_id && can('lgpd.aprovar') && <Button variant="danger" onClick={async () => {
          if (!(await confirm({ title: 'Anonimizar titular?', text: 'Nome, contato e observações serão removidos de forma irreversível. Registros fiscais e financeiros são mantidos sem identificação.', danger: true, confirm: 'Anonimizar' }))) return;
          try { const c = await db.select('customers', { profile_id: sel.user_id }); if (!c[0]) throw new Error('Ficha de cliente não encontrada'); await db.rpc('anonymize_customer', { p_customer: c[0].id, p_request: sel.id }); toast.ok('Titular anonimizado'); setSel(null); reqs.reload(); } catch (e) { toast.error((e as Error).message); }
        }}>Anonimizar dados</Button>}
        <span style={{ flex: 1 }} />
        {can('lgpd.editar') && <Button onClick={async () => { try { await db.update('privacy_requests', { id: sel.id }, { status, response: resp, handled_by: undefined, resolved_at: ['concluida', 'recusada'].includes(status) ? new Date().toISOString() : null }); toast.ok('Solicitação atualizada'); setSel(null); reqs.reload(); } catch (e) { toast.error((e as Error).message); } }}>Salvar</Button>}
      </>}>
        <dl className="kv"><dt>Titular</dt><dd>{sel.requester_name} · {sel.requester_email}</dd><dt>Detalhes</dt><dd>{sel.details || '—'}</dd><dt>Prazo</dt><dd>{fmtDate(sel.due_at)}</dd></dl>
        {['copia', 'portabilidade'].includes(sel.kind) && <p className="cell-sub">Titulares com conta podem baixar a cópia em JSON na própria área do cliente (Privacidade › Baixar meus dados). Informe isso na resposta, ou envie a cópia por canal seguro.</p>}
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="aberta">Aberta</option><option value="em_analise">Em análise</option><option value="concluida">Concluída</option><option value="recusada">Recusada (com justificativa legal)</option></Select></Field>
        <Field label="Resposta / registro do tratamento"><Textarea value={resp} onChange={(e) => setResp(e.target.value)} /></Field>
      </Modal>}
    </section>
  );
}

function Documents() {
  const { can } = useAuth();
  const toast = useToast();
  const docs = useLoad(() => db.select('legal_documents', {}, { order: 'published_at.desc' }));
  const [edit, setEdit] = useState<any>(null);
  return (
    <section className="card">
      <div className="card-head"><h2>Versões publicadas</h2>{can('lgpd.editar') && <span><Button size="sm" variant="line" onClick={() => { const c = docs.data?.find((d: any) => d.kind === 'termos' && d.is_current); setEdit({ kind: 'termos', title: c?.title, content: c?.content, version: '' }); }}>Nova versão dos termos</Button>
        <Button size="sm" onClick={() => { const c = docs.data?.find((d: any) => d.kind === 'privacidade' && d.is_current); setEdit({ kind: 'privacidade', title: c?.title, content: c?.content, version: '' }); }}>Nova versão da política</Button></span>}</div>
      <ul className="list-plain">{(docs.data || []).map((d: any) => <li key={d.id}><span><strong>{d.title}</strong> · versão {d.version}<br /><span className="cell-sub">{fmtDateTime(d.published_at)}</span></span>{d.is_current ? <Badge tone="ok">Vigente</Badge> : <Badge>Histórico</Badge>}</li>)}</ul>
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title="Publicar nova versão" initial={edit || {}}
        fields={[{ key: 'title', label: 'Título', required: true }, { key: 'version', label: 'Versão', required: true, placeholder: 'Ex.: 1.1' }, { key: 'content', label: 'Conteúdo', type: 'textarea', required: true }]}
        onSave={async (v) => {
          const cur = docs.data?.find((d: any) => d.kind === edit.kind && d.is_current);
          if (cur) await db.update('legal_documents', { id: cur.id }, { is_current: false });
          try { await db.insert('legal_documents', { kind: edit.kind, title: v.title, version: v.version, content: v.content, is_current: true }); }
          catch (e) { if (cur) await db.update('legal_documents', { id: cur.id }, { is_current: true }); throw e; }
          toast.ok('Nova versão publicada; versões anteriores ficam no histórico'); docs.reload();
        }} />
    </section>
  );
}

function SecurityInfo() {
  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ fontSize: 15.5 }}>Medidas técnicas implementadas</h2>
      <ul className="list-plain">
        <li><span>Row Level Security em todas as tabelas; permissões verificadas no banco por perfil</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Senhas com hash bcrypt (Supabase Auth); sessão com expiração e renovação</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Registro de auditoria de alterações administrativas (quem, quando, antes/depois)</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Consentimentos versionados; marketing desmarcado por padrão</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Exportação dos dados pelo titular e anonimização preservando registros fiscais</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Nenhum dado de cartão armazenado; chaves secretas somente no servidor</span><Badge tone="ok">Ativo</Badge></li>
        <li><span>Criptografia em trânsito (HTTPS) e backups diários</span><Badge tone="info">No Supabase / hospedagem</Badge></li>
      </ul>
      <h2 style={{ fontSize: 15.5 }}>A definir pelos responsáveis</h2>
      <ul className="list-plain">
        <li><span>Prazos de retenção por tipo de dado (cadastro inativo, notificações, logs)</span><Badge tone="warn">Pendente</Badge></li>
        <li><span>Encarregado (DPO) e e-mail de privacidade em Configurações</span><Badge tone="warn">Pendente</Badge></li>
        <li><span>Plano de resposta a incidentes (veja docs/LGPD.md)</span><Badge tone="warn">Revisar</Badge></li>
        <li><span>Região de hospedagem e transferência internacional de dados</span><Badge tone="warn">Revisar</Badge></li>
      </ul>
    </section>
  );
}

export function Audit() {
  const [table, setTable] = useState('');
  const logs = useLoad(() => db.select('audit_logs', table ? { table_name: table } : {}, { order: 'created_at.desc', limit: 500 }), [table]);
  const users = useLoad(() => db.rpc<any[]>('admin_list_users', {}).catch(() => []));
  const [sel, setSel] = useState<any>(null);
  const t = useTable(logs.data, { search: (l: any) => `${l.table_name} ${l.action} ${l.record_id}`, pageSize: 25 });
  const who = (id: string) => users.data?.find((u: any) => u.id === id)?.full_name || (id ? id.slice(0, 8) : 'sistema');
  const tables = ['user_roles', 'role_permissions', 'business_settings', 'services', 'barbers', 'products', 'plans', 'transactions', 'commissions', 'customers', 'subscriptions', 'coupons', 'privacy_requests'];
  return (
    <section className="card">
      <div className="card-head"><SearchBox value={t.q} onChange={t.setQ} /><Select value={table} onChange={(e) => setTable(e.target.value)} style={{ width: 'auto' }} aria-label="Tabela"><option value="">Todas as áreas</option>{tables.map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
      {logs.loading ? <Loading /> : t.total === 0 ? <Empty title="Nenhum registro" /> : (<>
        <div className="table-wrap"><table className="table"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Área</th><th /></tr></thead>
          <tbody>{t.rows.map((l: any) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{who(l.actor_id)}</td><td><Badge tone={l.action === 'delete' ? 'bad' : l.action === 'insert' ? 'ok' : 'info'}>{l.action}</Badge></td><td>{l.table_name}</td><td className="actions"><Button size="sm" variant="ghost" onClick={() => setSel(l)}>Detalhes</Button></td></tr>)}</tbody></table></div>
        <Pager page={t.page} pageSize={t.size} total={t.total} onPage={t.setPage} /></>)}
      {sel && <Modal open wide onClose={() => setSel(null)} title={`${sel.action} em ${sel.table_name}`}>
        <div className="grid-2-even"><div><strong>Antes</strong><pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'var(--paper)', padding: 10 }}>{sel.old_data ? JSON.stringify(sel.old_data, null, 2) : '—'}</pre></div>
          <div><strong>Depois</strong><pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'var(--paper)', padding: 10 }}>{sel.new_data ? JSON.stringify(sel.new_data, null, 2) : '—'}</pre></div></div>
      </Modal>}
    </section>
  );
}
