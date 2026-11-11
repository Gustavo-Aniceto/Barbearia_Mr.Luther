'use client';
import React, { useEffect, useState } from 'react';
import { db } from '../lib/api';
import { Link, navigate, useAuth, usePath } from '../lib/core';
import { Button, Empty, Field, Icon, ImageInput, Input, Loading, Logo, Modal, MoneyInput, Select, Textarea, Toggle, useToast } from '../lib/ui';
import { InstallLink } from '../lib/install';

export type NavItem = { to: string; label: string; icon: string; perm?: string; group?: string; short?: string };

/** No celular, os painéis têm uma barra fixa embaixo (como num app) com os atalhos principais + "Mais". */
export function PanelLayout({ nav, title, actions, children, subtitle, tabs }: { nav: NavItem[]; title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; tabs?: string[] }) {
  const { access, signOut, session } = useAuth();
  const path = usePath();
  const [open, setOpen] = useState(false);
  let lastGroup = '';
  const isActive = (to: string) => to === path || (to !== '/admin' && to !== '/barbeiro' && path.startsWith(to));
  const tabItems = (tabs ? tabs.map((t) => nav.find((n) => n.to === t)).filter(Boolean) as NavItem[] : nav.slice(0, 3)).slice(0, 4);
  const moreActive = !tabItems.some((t) => isActive(t.to));
  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Menu do painel">
        <div className="sidebar-brand"><Link to="/"><Logo /></Link><span>{subtitle || 'Gestão'}</span></div>
        <nav>
          {nav.map((n) => {
            const head = n.group && n.group !== lastGroup ? <div className="sidebar-group" key={`g-${n.group}`}>{n.group}</div> : null;
            if (n.group) lastGroup = n.group;
            const active = isActive(n.to);
            return <React.Fragment key={n.to}>{head}<Link to={n.to} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={n.icon} size={17} />{n.label}</Link></React.Fragment>;
          })}
        </nav>
        <div className="sidebar-foot">
          <span style={{ color: 'rgba(244,242,236,.55)' }}>{session?.user.email}</span>
          {access?.roles.includes('barbeiro') && path.startsWith('/admin') && <Link to="/barbeiro"><Icon name="scissors" size={15} />Meu painel de barbeiro</Link>}
          {path.startsWith('/barbeiro') && access && access.roles.some((r) => !['barbeiro', 'cliente', 'afiliado'].includes(r)) && <Link to="/admin"><Icon name="chart" size={15} />Painel administrativo</Link>}
          <InstallLink />
          <Link to="/"><Icon name="arrowLeft" size={15} />Ver o site</Link>
          <button onClick={() => signOut().then(() => navigate('/'))}><Icon name="logout" size={15} />Sair</button>
        </div>
      </aside>
      {open && <div className="modal-backdrop" style={{ zIndex: 55, background: 'rgba(17,17,17,.35)' }} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <h1>{title}</h1><span className="spacer" />{actions}
        </header>
        <div className="content">{children}</div>
      </div>
      <nav className="tabbar" aria-label="Atalhos do painel">
        {tabItems.map((t) => <Link key={t.to} to={t.to} aria-current={isActive(t.to) ? 'page' : undefined}><Icon name={t.icon} size={20} /><span>{t.short || t.label}</span></Link>)}
        <button onClick={() => setOpen(true)} aria-current={moreActive ? 'page' : undefined} aria-label="Mais opções do menu"><Icon name="menu" size={20} /><span>Mais</span></button>
      </nav>
    </div>
  );
}

export function RequireStaff({ children, perm, barber }: { children: React.ReactNode; perm?: string; barber?: boolean }) {
  const { session, access, loading, can } = useAuth();
  useEffect(() => { if (!loading && !session) navigate(`/entrar?voltar=${encodeURIComponent(location.pathname)}`, true); }, [loading, session]);
  if (loading || !session || !access) return <Loading />;
  const ok = barber ? access.roles.includes('barbeiro') : access.is_staff && (!perm || can(perm));
  if (!ok) return (
    <div className="wrap page"><Empty title="Acesso restrito" text={access.is_staff ? 'Seu perfil não tem permissão para este módulo. Fale com o proprietário.' : 'Esta área é exclusiva da equipe da MR.LUDER.'}
      action={<Link to={access.is_staff ? '/admin' : '/conta'} className="btn btn-primary btn-md">Voltar</Link>} /></div>
  );
  return <>{children}</>;
}

// ------------------------------------------------------------------ Formulário genérico de cadastro
export type FieldDef = {
  key: string; label: string; type?: 'text' | 'email' | 'number' | 'money' | 'textarea' | 'select' | 'toggle' | 'image' | 'tags' | 'date' | 'time' | 'datetime';
  options?: { value: string; label: string }[]; required?: boolean; span?: boolean; hint?: string; min?: number; max?: number; folder?: string; placeholder?: string;
};

export function EntityModal({ open, onClose, title, fields, initial, onSave, extra, danger }: {
  open: boolean; onClose: () => void; title: string; fields: FieldDef[]; initial: Record<string, any>;
  onSave: (values: Record<string, any>) => Promise<void>; extra?: (v: Record<string, any>, set: (k: string, val: any) => void) => React.ReactNode; danger?: React.ReactNode;
}) {
  const [v, setV] = useState<Record<string, any>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) { setV(initial); setErrors({}); } }, [open]);
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const err: Record<string, string> = {};
    for (const f of fields) {
      const val = v[f.key];
      if (f.required && (val === undefined || val === null || String(val).trim() === '')) err[f.key] = 'Campo obrigatório';
      if ((f.type === 'number' || f.type === 'money') && val !== '' && val != null) {
        if (Number.isNaN(Number(val))) err[f.key] = 'Número inválido';
        else if (f.min !== undefined && Number(val) < f.min) err[f.key] = `Mínimo ${f.min}`;
        else if (f.max !== undefined && Number(val) > f.max) err[f.key] = `Máximo ${f.max}`;
      }
      if (f.type === 'email' && val && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) err[f.key] = 'E-mail inválido';
    }
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      const out: Record<string, any> = {};
      for (const f of fields) {
        let val = v[f.key];
        if ((f.type === 'number' || f.type === 'money')) val = val === '' || val == null ? null : Number(val);
        if (f.type === 'tags' && typeof val === 'string') val = val.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (typeof val === 'string' && f.type !== 'textarea') val = val.trim() === '' ? null : val.trim();
        out[f.key] = val;
      }
      await onSave({ ...v, ...out });
      onClose();
    } catch (er) { toast.error((er as Error).message); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title={title} wide={fields.length > 6}
      footer={<>{danger}<span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => submit()}>Salvar</Button></>}>
      <form className="form-grid" onSubmit={submit} noValidate>
        {fields.map((f) => {
          const common = { value: v[f.key] ?? '', onChange: (e: any) => set(f.key, e.target.value), placeholder: f.placeholder };
          const cls = f.span || f.type === 'textarea' || f.type === 'image' ? 'span-2' : '';
          if (f.type === 'toggle') return <div key={f.key} className={cls}><Toggle checked={!!v[f.key]} onChange={(val) => set(f.key, val)} label={f.label} hint={f.hint} /></div>;
          if (f.type === 'image') return <div key={f.key} className={cls}><ImageInput label={f.label} value={v[f.key]} folder={f.folder || 'geral'} onChange={(url) => set(f.key, url)} /></div>;
          return (
            <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} hint={f.hint} className={cls}>
              {f.type === 'textarea' ? <Textarea {...common} /> :
                f.type === 'select' ? <Select {...common}><option value="">Selecione</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select> :
                f.type === 'money' ? <MoneyInput value={v[f.key] ?? ''} onChange={(val) => set(f.key, val)} /> :
                f.type === 'tags' ? <Input value={Array.isArray(v[f.key]) ? v[f.key].join(', ') : v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder="Separe por vírgula" /> :
                <Input type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'} min={f.min} max={f.max} {...common} />}
            </Field>
          );
        })}
        {extra?.(v, set)}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// Exportação CSV (relatórios)
export function exportCsv(name: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (x: any) => { const s = x == null ? '' : String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
}

export function usePaymentMethods() {
  const [pm, setPm] = useState<any[]>([]);
  useEffect(() => { db.select('payment_methods', { active: true }, { order: 'sort_order.asc' }).then(setPm).catch(() => {}); }, []);
  return pm;
}
