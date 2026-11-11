// Roteamento, sessão/permissões e formatação compartilhada.
'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, db, getSession, loadSession, onSession, Session } from './api';

// ------------------------------------------------------------------ Router
const routeListeners = new Set<() => void>();
export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  replace ? history.replaceState(null, '', to) : history.pushState(null, '', to);
  routeListeners.forEach((l) => l());
  if (!to.includes('#')) window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', () => routeListeners.forEach((l) => l()));
export function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const l = () => setP(location.pathname); routeListeners.add(l); return () => { routeListeners.delete(l); }; }, []);
  return p;
}
export function useQuery() { usePath(); return new URLSearchParams(location.search); }
export function Link({ to, children, className, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a href={to} className={className} {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        const [path, hash] = to.split('#');
        if (path) navigate(path);
        if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 30);
      }}>{children}</a>
  );
}

// ------------------------------------------------------------------ Sessão + acesso
export type Access = { user_id: string | null; is_owner: boolean; is_staff: boolean; roles: string[]; permissions: string[] };
type AuthCtx = { session: Session | null; access: Access | null; loading: boolean; can: (perm: string) => boolean; reload: () => Promise<void>; signOut: () => Promise<void> };
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(getSession());
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!getSession()) { setAccess(null); setLoading(false); return; }
    try { setAccess(await db.rpc<Access>('my_access')); } catch { setAccess(null); }
    setLoading(false);
  }, []);
  useEffect(() => onSession((s) => { setSession(s); setLoading(true); }), []);
  // sessão vem do servidor (cookie httpOnly do Neon Auth); nada sensível fica no navegador
  useEffect(() => { loadSession().then((s) => { if (!s) setLoading(false); }); }, []);
  useEffect(() => { if (session) reload(); }, [session?.user?.id, reload]);
  const can = (perm: string) => !!access && (access.is_owner || access.permissions.includes(perm) || access.permissions.includes(perm.split('.')[0] + '.gerenciar'));
  return <Ctx.Provider value={{ session, access, loading, can, reload, signOut: auth.signOut }}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------------ Formatação
const TZ = 'America/Sao_Paulo';
export const money = (v: number | string | null | undefined) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (d: string | Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }) =>
  new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, ...opts });
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d: string | Date) => `${fmtDate(d)} às ${fmtTime(d)}`;
export const fmtLongDate = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
export const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
/** Data local (São Paulo) em YYYY-MM-DD */
export const isoDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Converte data + hora local de São Paulo em ISO (offset fixo -03:00; Brasil sem horário de verão desde 2019) */
export const spToIso = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const onlyDigits = (s: string) => s.replace(/\D/g, '');
export const whatsappLink = (number: string | null | undefined, text = '') =>
  number ? `https://wa.me/${onlyDigits(number).replace(/^(?!55)/, '55')}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';

export const APPT_STATUS: Record<string, { label: string; tone: string }> = {
  pendente: { label: 'Pendente', tone: 'warn' },
  confirmado: { label: 'Confirmado', tone: 'ok' },
  cliente_chegou: { label: 'Cliente chegou', tone: 'info' },
  em_atendimento: { label: 'Em atendimento', tone: 'info' },
  finalizado: { label: 'Finalizado', tone: 'done' },
  cancelado_cliente: { label: 'Cancelado pelo cliente', tone: 'muted' },
  cancelado_barbearia: { label: 'Cancelado pela barbearia', tone: 'muted' },
  nao_compareceu: { label: 'Não compareceu', tone: 'bad' },
};
export const ORDER_STATUS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando pagamento', pago: 'Pago', em_separacao: 'Em separação', pronto_retirada: 'Pronto para retirada',
  enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado',
};
export const SUB_STATUS: Record<string, string> = {
  pendente: 'Aguardando pagamento', ativa: 'Ativa', suspensa: 'Suspensa', inadimplente: 'Pagamento pendente', cancelada: 'Cancelada', expirada: 'Expirada',
};

// ------------------------------------------------------------------ Hook de carregamento
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); } catch (e) { setError((e as Error).message); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
