'use client';
import React, { useState } from 'react';
import { db } from '../lib/api';
import { APPT_STATUS, ORDER_STATUS, SUB_STATUS, WEEKDAYS, fmtDate, fmtDateTime, money, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, Pager, SearchBox, Select, Tabs, useConfirm, useTable, useToast } from '../lib/ui';
import { EntityModal, exportCsv } from '../panel/Layout';
import { AddSchedule } from '../panel/Barber';

// ------------------------------------------------------------------ Clientes
export function Customers() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useLoad(() => db.select('customers', {}, { order: 'created_at.desc', limit: 2000 }));
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const t = useTable((data || []).filter((c: any) => !status || c.status === status), { search: (c: any) => `${c.full_name} ${c.email || ''} ${c.phone || ''}`, initialSort: 'full_name' });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <div className="toolbar">
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar por nome, e-mail ou telefone" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status"><option value="">Todos os status</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="bloqueado">Bloqueados</option></Select>
        <span className="spacer" />
        {can('clientes.exportar') && <Button variant="line" size="sm" onClick={() => exportCsv('clientes', (data || []).map((c: any) => ({ nome: c.full_name, email: c.email, telefone: c.phone, status: c.status, visitas: c.visits_count, ultima_visita: c.last_visit_at ? fmtDate(c.last_visit_at) : '', cadastro: fmtDate(c.created_at) })))}>Exportar CSV</Button>}
        {can('clientes.criar') && <Button size="sm" onClick={() => setEdit({ status: 'ativo' })}>Novo cliente</Button>}
      </div>
      <section className="card">
        {loading ? <Loading /> : t.total === 0 ? <Empty title={data?.length ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'} text={data?.length ? 'Ajuste a busca.' : 'Clientes aparecem aqui ao criar conta no site ou ao serem cadastrados pela recepção.'} /> : (<>
          <div className="table-wrap"><table className="table">
            <thead><tr>{t.th('full_name', 'Cliente')}{t.th('phone', 'Telefone')}{t.th('visits_count', 'Visitas')}{t.th('last_visit_at', 'Último atendimento')}{t.th('status', 'Status')}<th /></tr></thead>
            <tbody>{t.rows.map((c: any) => (
              <tr key={c.id}><td><div className="cell-strong">{c.full_name}</div><div className="cell-sub">{c.email}{c.profile_id ? '' : ' · sem conta online'}</div></td>
                <td>{c.phone}</td><td className="num">{c.visits_count}</td><td>{c.last_visit_at ? fmtDate(c.last_visit_at) : '–'}</td>
                <td><Badge tone={c.status === 'ativo' ? 'ok' : c.status === 'bloqueado' ? 'bad' : 'muted'}>{c.status}</Badge></td>
                <td className="actions"><Button size="sm" variant="ghost" onClick={() => setView(c)}>Histórico</Button>{can('clientes.editar') && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Editar</Button>}</td></tr>
            ))}</tbody></table></div>
          <Pager page={t.page} pageSize={t.size} total={t.total} onPage={t.setPage} />
        </>)}
      </section>
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar cliente' : 'Novo cliente'} initial={edit || {}}
        fields={[{ key: 'full_name', label: 'Nome completo', required: true, span: true }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail', type: 'email' },
          { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }, { value: 'bloqueado', label: 'Bloqueado (não agenda online)' }], required: true },
          { key: 'notes', label: 'Observações internas', type: 'textarea', hint: 'Somente informações necessárias para o atendimento.' }]}
        onSave={async (v) => { const row = { full_name: v.full_name, phone: v.phone, email: v.email, status: v.status, notes: v.notes }; edit.id ? await db.update('customers', { id: edit.id }, row) : await db.insert('customers', row); reload(); }} />
      {view && <CustomerHistory c={view} onClose={() => setView(null)} />}
    </>
  );
}

function CustomerHistory({ c, onClose }: { c: any; onClose: () => void }) {
  const [tab, setTab] = useState<'atend' | 'compras' | 'planos'>('atend');
  const appts = useLoad(() => db.select('appointments', { customer_id: c.id }, { order: 'starts_at.desc', limit: 100 }));
  const svc = useLoad(async () => { const ids = (appts.data || []).map((a: any) => a.id); return ids.length ? db.select('appointment_services', { appointment_id: `in.(${ids.join(',')})` }) : []; }, [appts.data]);
  const barbers = useLoad(() => db.select('barbers'));
  const orders = useLoad(() => db.select('orders', { customer_id: c.id }, { order: 'created_at.desc' }).catch(() => []));
  const subs = useLoad(() => db.select('subscriptions', { customer_id: c.id }, { order: 'created_at.desc' }).catch(() => []));
  const plans = useLoad(() => db.select('plans').catch(() => []));
  const finished = (appts.data || []).filter((a: any) => a.status === 'finalizado');
  const freq = finished.length > 1 ? Math.round((new Date(finished[0].starts_at).getTime() - new Date(finished[finished.length - 1].starts_at).getTime()) / 86400e3 / (finished.length - 1)) : null;
  return (
    <Modal open onClose={onClose} title={c.full_name} wide>
      <dl className="kv"><dt>Contato</dt><dd>{c.phone || '–'} · {c.email || '–'}</dd><dt>Cliente desde</dt><dd>{fmtDate(c.created_at)}</dd>
        <dt>Frequência</dt><dd>{freq ? `a cada ~${freq} dias` : 'dados insuficientes'} · {finished.length} atendimentos finalizados</dd>{c.notes && <><dt>Observações</dt><dd>{c.notes}</dd></>}</dl>
      <Tabs tabs={[{ id: 'atend', label: 'Atendimentos', count: appts.data?.length }, { id: 'compras', label: 'Compras', count: orders.data?.length }, { id: 'planos', label: 'Planos', count: subs.data?.length }]} value={tab} onChange={setTab} />
      {tab === 'atend' && (appts.loading ? <Loading /> : !appts.data?.length ? <p className="muted">Sem atendimentos.</p> : (
        <ul className="list-plain">{appts.data.map((a: any) => <li key={a.id}><span>{fmtDateTime(a.starts_at)} · {(svc.data || []).filter((s: any) => s.appointment_id === a.id).map((s: any) => s.service_name).join(' + ')} · {(barbers.data || []).find((b: any) => b.id === a.barber_id)?.display_name}</span>
          <span><Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge> {money(a.total_price)}</span></li>)}</ul>))}
      {tab === 'compras' && (!orders.data?.length ? <p className="muted">Sem compras.</p> : <ul className="list-plain">{orders.data.map((o: any) => <li key={o.id}><span>#{o.code} · {fmtDate(o.created_at)}</span><span>{ORDER_STATUS[o.status]} · {money(o.total)}</span></li>)}</ul>)}
      {tab === 'planos' && (!subs.data?.length ? <p className="muted">Sem planos.</p> : <ul className="list-plain">{subs.data.map((s: any) => <li key={s.id}><span>{(plans.data || []).find((p: any) => p.id === s.plan_id)?.name}</span><span>{SUB_STATUS[s.status]}{s.current_period_end && ` · até ${fmtDate(s.current_period_end)}`}</span></li>)}</ul>)}
    </Modal>
  );
}

// ------------------------------------------------------------------ Equipe
export function Team() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'barbeiros' | 'funcionarios' | 'folgas'>('barbeiros');
  const barbers = useLoad(() => db.select('barbers', {}, { order: 'sort_order.asc' }));
  const employees = useLoad(() => db.select('employees', {}, { order: 'full_name.asc' }));
  const offs = useLoad(() => db.select('time_off', { status: 'pendente' }, { order: 'starts_at.asc' }).catch(() => []));
  const schedules = useLoad(() => db.select('barber_schedules', {}, { order: 'weekday.asc' }));
  const [edit, setEdit] = useState<any>(null);
  const [editEmp, setEditEmp] = useState<any>(null);
  const [sched, setSched] = useState<string | null>(null);

  async function linkProfile(email: string | null): Promise<string | null> {
    if (!email) return null;
    const users = await db.rpc<any[]>('admin_list_users', { p_search: email }).catch(() => []);
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u) throw new Error('Nenhuma conta com este e-mail. Peça para a pessoa criar a conta no site primeiro.');
    return u.id;
  }

  return (
    <>
      <Tabs tabs={[{ id: 'barbeiros', label: 'Barbeiros', count: barbers.data?.length }, { id: 'funcionarios', label: 'Funcionários', count: employees.data?.length }, { id: 'folgas', label: 'Folgas a aprovar', count: offs.data?.length }]} value={tab} onChange={setTab} />
      {tab === 'barbeiros' && (
        <section className="card">
          <div className="card-head"><h2>Barbeiros</h2>{can('equipe.criar') && <Button size="sm" onClick={() => setEdit({ active: true, accepts_online_booking: true, commission_type: 'percentual', commission_value: 0, product_commission_percent: 0, buffer_minutes: 0, sort_order: 0 })}>Cadastrar barbeiro</Button>}</div>
          {barbers.loading ? <Loading /> : !barbers.data?.length ? <Empty title="Nenhum barbeiro cadastrado" text="Cadastre a equipe para liberar a agenda online." /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th /><th>Nome</th><th>Comissão</th><th>Escala</th><th>Status</th><th /></tr></thead>
              <tbody>{barbers.data.map((b: any) => (
                <tr key={b.id}><td>{b.photo_url ? <img className="thumb" src={b.photo_url} alt="" /> : <span className="thumb" style={{ display: 'block' }} />}</td>
                  <td><div className="cell-strong">{b.display_name}</div><div className="cell-sub">{b.specialties?.join(', ')}{!b.profile_id && ' · sem acesso ao painel'}</div></td>
                  <td>{b.commission_type === 'percentual' ? `${Number(b.commission_value)}%` : money(b.commission_value)} serviços{Number(b.product_commission_percent) > 0 && ` · ${Number(b.product_commission_percent)}% produtos`}</td>
                  <td className="cell-sub">{(schedules.data || []).filter((s: any) => s.barber_id === b.id).map((s: any) => `${WEEKDAYS[s.weekday].slice(0, 3)} ${s.starts_at.slice(0, 5)}–${s.ends_at.slice(0, 5)}`).join(', ') || 'Horário da barbearia'}</td>
                  <td><Badge tone={b.active ? 'ok' : 'muted'}>{b.active ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td className="actions">{can('equipe.editar') && <><Button size="sm" variant="ghost" onClick={() => setSched(b.id)}>Escala</Button><Button size="sm" variant="ghost" onClick={() => setEdit(b)}>Editar</Button></>}</td></tr>
              ))}</tbody></table></div>
          )}
        </section>
      )}
      {tab === 'funcionarios' && (
        <section className="card">
          <div className="card-head"><h2>Funcionários</h2>{can('equipe.criar') && <Button size="sm" onClick={() => setEditEmp({ active: true })}>Cadastrar funcionário</Button>}</div>
          {!employees.data?.length ? <Empty title="Nenhum funcionário cadastrado" text="Recepção e outros colaboradores. O acesso ao sistema é dado em Usuários e permissões." /> : (
            <ul className="list-plain">{employees.data.map((e: any) => <li key={e.id}><span><strong>{e.full_name}</strong> · {e.job_title}</span><span><Badge tone={e.active ? 'ok' : 'muted'}>{e.active ? 'Ativo' : 'Inativo'}</Badge> {can('equipe.editar') && <Button size="sm" variant="ghost" onClick={() => setEditEmp(e)}>Editar</Button>}</span></li>)}</ul>
          )}
        </section>
      )}
      {tab === 'folgas' && (
        <section className="card">
          {!offs.data?.length ? <Empty title="Nenhuma solicitação pendente" /> : (
            <ul className="list-plain">{offs.data.map((o: any) => <li key={o.id}><span><strong>{(barbers.data || []).find((b: any) => b.id === o.barber_id)?.display_name}</strong> · {fmtDateTime(o.starts_at)} até {fmtDateTime(o.ends_at)}<br /><span className="cell-sub">{o.reason}</span></span>
              {can('equipe.aprovar') && <span><Button size="sm" variant="ghost" onClick={async () => { try { await db.rpc('review_time_off', { p_id: o.id, p_approve: false }); offs.reload(); } catch (e) { toast.error((e as Error).message); } }}>Recusar</Button>
                <Button size="sm" onClick={async () => { try { await db.rpc('review_time_off', { p_id: o.id, p_approve: true }); toast.ok('Folga aprovada; agenda bloqueada'); offs.reload(); } catch (e) { toast.error((e as Error).message); } }}>Aprovar</Button></span>}</li>)}</ul>
          )}
        </section>
      )}
      <EntityModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar barbeiro' : 'Cadastrar barbeiro'} initial={{ ...(edit || {}), account_email: '' }}
        fields={[
          { key: 'display_name', label: 'Nome de exibição', required: true }, { key: 'specialties', label: 'Especialidades', type: 'tags' },
          { key: 'bio', label: 'Descrição profissional', type: 'textarea' }, { key: 'photo_url', label: 'Foto', type: 'image', folder: 'equipe' },
          { key: 'commission_type', label: 'Tipo de comissão', type: 'select', options: [{ value: 'percentual', label: 'Percentual' }, { value: 'fixo', label: 'Valor fixo por serviço' }], required: true },
          { key: 'commission_value', label: 'Comissão em serviços (% ou R$)', type: 'number', min: 0, required: true },
          { key: 'product_commission_percent', label: 'Comissão em produtos (%)', type: 'number', min: 0, max: 100 },
          { key: 'buffer_minutes', label: 'Intervalo entre atendimentos (min)', type: 'number', min: 0, max: 120 },
          { key: 'sort_order', label: 'Ordem de exibição', type: 'number' },
          { key: 'account_email', label: edit?.profile_id ? 'Conta vinculada (deixe vazio para manter)' : 'E-mail da conta do barbeiro', type: 'email', hint: 'A pessoa cria a conta no site; aqui você vincula e libera o perfil Barbeiro.' },
          { key: 'active', label: 'Ativo', type: 'toggle' }, { key: 'accepts_online_booking', label: 'Aceita agendamento online', type: 'toggle' },
        ]}
        onSave={async (v) => {
          const pid = v.account_email ? await linkProfile(v.account_email) : edit.profile_id || null;
          const row = { display_name: v.display_name, specialties: v.specialties || [], bio: v.bio, photo_url: v.photo_url, commission_type: v.commission_type, commission_value: v.commission_value ?? 0,
            product_commission_percent: v.product_commission_percent ?? 0, buffer_minutes: v.buffer_minutes ?? 0, sort_order: v.sort_order ?? 0, active: !!v.active, accepts_online_booking: !!v.accepts_online_booking, profile_id: pid };
          edit.id ? await db.update('barbers', { id: edit.id }, row) : await db.insert('barbers', row);
          if (pid && pid !== edit.profile_id) await db.rpc('assign_role', { p_user_id: pid, p_role_key: 'barbeiro' }).catch((e) => toast.error(`Barbeiro salvo, mas o perfil de acesso não foi atribuído: ${e.message}`));
          toast.ok('Barbeiro salvo'); barbers.reload();
        }} />
      <EntityModal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp?.id ? 'Editar funcionário' : 'Cadastrar funcionário'} initial={editEmp || {}}
        fields={[{ key: 'full_name', label: 'Nome', required: true }, { key: 'job_title', label: 'Função', required: true, placeholder: 'Ex.: Recepcionista' }, { key: 'active', label: 'Ativo', type: 'toggle' }]}
        onSave={async (v) => { const row = { full_name: v.full_name, job_title: v.job_title, active: !!v.active }; editEmp.id ? await db.update('employees', { id: editEmp.id }, row) : await db.insert('employees', row); employees.reload(); }} />
      {sched && <ScheduleManager barberId={sched} schedules={(schedules.data || []).filter((s: any) => s.barber_id === sched)} onClose={() => setSched(null)} onChange={schedules.reload} />}
    </>
  );
}

function ScheduleManager({ barberId, schedules, onClose, onChange }: { barberId: string; schedules: any[]; onClose: () => void; onChange: () => void }) {
  const [add, setAdd] = useState(false);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title="Escala semanal" footer={<Button onClick={() => setAdd(true)}>Adicionar faixa</Button>}>
      <p className="cell-sub">Dias sem faixa seguem o horário de funcionamento da barbearia. Use várias faixas no mesmo dia para intervalos (ex.: almoço).</p>
      {schedules.length === 0 ? <p className="muted">Nenhuma faixa definida.</p> : <ul className="list-plain">{schedules.map((s) => <li key={s.id}><span>{WEEKDAYS[s.weekday]} · {s.starts_at.slice(0, 5)} – {s.ends_at.slice(0, 5)}</span><Button size="sm" variant="ghost" onClick={async () => { try { await db.remove('barber_schedules', { id: s.id }); onChange(); } catch (e) { toast.error((e as Error).message); } }}>Remover</Button></li>)}</ul>}
      {add && <AddSchedule barberId={barberId} onClose={() => setAdd(false)} onDone={() => { setAdd(false); onChange(); }} />}
    </Modal>
  );
}

// ------------------------------------------------------------------ Usuários e permissões
const MODULES: Record<string, string> = { agenda: 'Agenda', disponibilidade: 'Disponibilidade própria', clientes: 'Clientes', servicos: 'Serviços', equipe: 'Equipe', financeiro: 'Financeiro', produtos: 'Produtos e estoque',
  pedidos: 'Pedidos', planos: 'Planos', afiliados: 'Club / afiliados', lgpd: 'LGPD', configuracoes: 'Configurações', usuarios: 'Usuários', relatorios: 'Relatórios e dashboard', site: 'Conteúdo do site', auditoria: 'Auditoria' };
const ACTIONS = ['visualizar', 'criar', 'editar', 'excluir', 'aprovar', 'gerenciar', 'exportar'];

export function UsersPermissions() {
  const { access, can } = useAuth();
  const [tab, setTab] = useState<'usuarios' | 'perfis'>('usuarios');
  return (<>
    <Tabs tabs={[{ id: 'usuarios', label: 'Usuários' }, { id: 'perfis', label: 'Perfis e permissões' }]} value={tab} onChange={setTab} />
    {tab === 'usuarios' ? <UsersList canManage={can('usuarios.gerenciar')} isOwner={!!access?.is_owner} /> : <PermissionMatrix isOwner={!!access?.is_owner} />}
  </>);
}

function UsersList({ canManage, isOwner }: { canManage: boolean; isOwner: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const users = useLoad(() => db.rpc<any[]>('admin_list_users', { p_search: q.trim() || null }), [q]);
  const roles = useLoad(() => db.select('roles', {}, { order: 'name.asc' }));
  const [edit, setEdit] = useState<any>(null);
  const roleName = (k: string) => roles.data?.find((r: any) => r.key === k)?.name || k;
  return (
    <section className="card">
      <div className="card-head"><SearchBox value={q} onChange={setQ} placeholder="Buscar usuário" /><span className="cell-sub">Novos usuários criam a conta pelo site; aqui você atribui perfis de acesso.</span></div>
      {users.error ? <ErrorBox error={users.error} /> : users.loading ? <Loading /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Usuário</th><th>Perfis</th><th>Desde</th><th /></tr></thead>
          <tbody>{users.data!.map((u) => <tr key={u.id}><td><div className="cell-strong">{u.full_name}</div><div className="cell-sub">{u.email}</div></td>
            <td>{u.roles.map((r: string) => <Badge key={r} tone={r === 'proprietario' ? 'done' : r === 'cliente' ? 'muted' : 'info'}>{roleName(r)}</Badge>)}</td>
            <td>{fmtDate(u.created_at)}</td><td className="actions">{canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Perfis</Button>}</td></tr>)}</tbody></table></div>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Perfis de ${edit.full_name}`}>
          <p className="cell-sub">Perfis marcados como privilegiados só podem ser atribuídos pelo proprietário.</p>
          <ul className="list-plain">{(roles.data || []).map((r: any) => {
            const has = edit.roles.includes(r.key);
            const locked = r.is_privileged && !isOwner;
            return <li key={r.id}><span><strong>{r.name}</strong>{r.is_privileged && <> <Badge tone="warn">privilegiado</Badge></>}<br /><span className="cell-sub">{r.description}</span></span>
              <Button size="sm" variant={has ? 'ghost' : 'line'} disabled={locked} onClick={async () => {
                if (has && r.key === 'proprietario' && !(await confirm({ title: 'Remover proprietário?', text: 'Esta pessoa perderá o controle total do sistema.', danger: true, confirm: 'Remover' }))) return;
                try { await db.rpc(has ? 'revoke_role' : 'assign_role', { p_user_id: edit.id, p_role_key: r.key }); toast.ok(has ? 'Perfil removido' : 'Perfil atribuído');
                  const roles2 = has ? edit.roles.filter((x: string) => x !== r.key) : [...edit.roles, r.key]; setEdit({ ...edit, roles: roles2 }); users.reload(); } catch (e) { toast.error((e as Error).message); }
              }}>{has ? 'Remover' : 'Atribuir'}</Button></li>;
          })}</ul>
        </Modal>
      )}
    </section>
  );
}

function PermissionMatrix({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();
  const roles = useLoad(() => db.select('roles', { is_staff: true }, { order: 'name.asc' }));
  const perms = useLoad(() => db.select('permissions'));
  const rp = useLoad(() => db.select('role_permissions'));
  const [role, setRole] = useState('gerente');
  const [newRole, setNewRole] = useState(false);
  if (roles.loading || perms.loading || rp.loading) return <Loading />;
  const r = roles.data!.find((x: any) => x.key === role);
  const has = (module: string, action: string) => { const p = perms.data!.find((x: any) => x.module === module && x.action === action); return !!rp.data!.find((x: any) => x.role_id === r?.id && x.permission_id === p?.id); };
  return (
    <section className="card">
      <div className="card-head">
        <Field label="Perfil"><Select value={role} onChange={(e) => setRole(e.target.value)}>{roles.data!.filter((x: any) => x.key !== 'proprietario').map((x: any) => <option key={x.id} value={x.key}>{x.name}</option>)}</Select></Field>
        {isOwner && <Button size="sm" variant="line" onClick={() => setNewRole(true)}>Criar perfil personalizado</Button>}
      </div>
      <div className="notice" style={{ marginBottom: 14 }}><span>“Gerenciar” concede todas as ações do módulo. Toda permissão é verificada também no banco de dados (RLS), não só nesta tela.{!isOwner && ' Somente o proprietário altera permissões.'}</span></div>
      <div className="table-wrap"><table className="table perm-matrix"><thead><tr><th>Módulo</th>{ACTIONS.map((a) => <th key={a}>{a}</th>)}</tr></thead>
        <tbody>{Object.entries(MODULES).map(([m, label]) => <tr key={m}><td className="cell-strong">{label}</td>{ACTIONS.map((a) => (
          <td key={a}><input type="checkbox" aria-label={`${label}: ${a}`} checked={has(m, a)} disabled={!isOwner} onChange={async (e) => {
            try { await db.rpc('set_role_permission', { p_role_key: role, p_module: m, p_action: a, p_enabled: e.target.checked }); rp.reload(); } catch (er) { toast.error((er as Error).message); }
          }} /></td>))}</tr>)}</tbody></table></div>
      <EntityModal open={newRole} onClose={() => setNewRole(false)} title="Novo perfil" initial={{}}
        fields={[{ key: 'name', label: 'Nome do perfil', required: true }, { key: 'key', label: 'Identificador', required: true, hint: 'Minúsculas, sem espaços (ex.: caixa)' }, { key: 'description', label: 'Descrição', type: 'textarea' }]}
        onSave={async (v) => { await db.rpc('create_custom_role', { p_key: String(v.key).toLowerCase().replace(/[^a-z0-9_]/g, '_'), p_name: v.name, p_description: v.description }); roles.reload(); setRole(String(v.key).toLowerCase().replace(/[^a-z0-9_]/g, '_')); }} />
    </section>
  );
}
