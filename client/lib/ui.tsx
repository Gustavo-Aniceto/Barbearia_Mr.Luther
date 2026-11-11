'use client';
// Componentes de interface compartilhados (site e painéis)
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { uploadImage } from './api';
import { money } from './core';

// ------------------------------------------------------------------ Marca
export function Logo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  // Redesenho vetorial fiel ao logotipo existente: "MR. LUDER", filetes, EST ◆ 17, "BARBEARIA"
  return (
    <svg className={`logo ${className}`} viewBox="0 0 300 150" role="img" aria-label="MR. LUDER Barbearia" style={compact ? { height: 40 } : undefined}>
      <line x1="18" y1="16" x2="282" y2="16" stroke="currentColor" strokeWidth="1.4" />
      <text x="150" y="64" textAnchor="middle" fill="currentColor" className="logo-main" textLength="258" lengthAdjust="spacingAndGlyphs">MR. LUDER</text>
      <line x1="18" y1="82" x2="112" y2="82" stroke="currentColor" strokeWidth="1.4" />
      <line x1="188" y1="82" x2="282" y2="82" stroke="currentColor" strokeWidth="1.4" />
      <text x="133" y="86.5" textAnchor="middle" fill="currentColor" className="logo-est">EST</text>
      <path d="M150 79 l3.6 3.6 l-3.6 3.6 l-3.6 -3.6z" fill="currentColor" />
      <text x="165" y="86.5" textAnchor="middle" fill="currentColor" className="logo-est">17</text>
      <text x="150" y="128" textAnchor="middle" fill="currentColor" className="logo-sub" textLength="262" lengthAdjust="spacingAndGlyphs">BARBEARIA</text>
    </svg>
  );
}
export const Diamond = ({ className = '' }: { className?: string }) => <span className={`diamond ${className}`} aria-hidden="true" />;

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i + 1));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs><linearGradient id={`g${i}-${value}`}><stop offset={`${fill * 100}%`} stopColor="currentColor" /><stop offset={`${fill * 100}%`} stopColor="transparent" /></linearGradient></defs>
            <path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4L2.7 9.5l6.5-.7z" fill={`url(#g${i}-${value})`} stroke="currentColor" strokeWidth="1.2" />
          </svg>
        );
      })}
    </span>
  );
}

// ------------------------------------------------------------------ Ícones (traço fino, consistentes)
const ICONS: Record<string, string> = {
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 010 6.5M18 14.5c2 .7 3.2 2.5 3.8 5.5',
  scissors: 'M6 7a3 3 0 100-.01M6 17a3 3 0 100-.01M8.5 8.5L20 19M8.5 15.5L20 5',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h18v13H3zM3 7l3-4h12l3 4M16 13.5h2',
  box: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 016 0v2',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9zM12 9c2-4 6-4 6-1.5S14 9 12 9z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.5 7.5 0 000-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1l-.3-2.6h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 000 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.6h4l.3-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4z',
  key: 'M14 10a4 4 0 10-.01 0M11 13l-8 8M6 18l2 2M8 16l2 2',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9.5a1.5 1.5 0 100-.01',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  pin: 'M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z',
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4',
  log: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  arrowLeft: 'M15 5l-7 7 7 7',
  arrowRight: 'M9 5l7 7-7 7',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  instagram: 'M4 4h16v16H4zM12 16a4 4 0 100-8 4 4 0 000 8zM17.5 6.5h.01',
  whatsapp: 'M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-4-1.1zM9 8.5c0 3 2.5 6 6 6.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z',
  cart: 'M3 4h2l2.5 11h11L21 7H6.5M9 20a1 1 0 100-.01M18 20a1 1 0 100-.01',
  coffee: 'M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5zM17 10h2a2 2 0 010 4h-2M8 3v3M12 3v3',
};
export function Icon({ name, size = 18, className = '' }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ''} />
    </svg>
  );
}

// ------------------------------------------------------------------ Botões e campos
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'line' | 'danger' | 'light'; loading?: boolean; size?: 'sm' | 'md' | 'lg' };
export function Button({ variant = 'primary', loading, size = 'md', className = '', children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

type FieldProps = { label: string; hint?: string; error?: string; children?: React.ReactNode; className?: string; required?: boolean };
export function Field({ label, hint, error, children, className = '', required }: FieldProps) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      <span className="field-label">{label}{required && <span className="req" aria-hidden="true"> *</span>}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} className="input" {...p} />);
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input" rows={4} {...p} />;
export const Select = ({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className="input" {...p}>{children}</select>;
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span><span className="toggle-label">{label}</span>{hint && <span className="field-hint">{hint}</span>}</span>
    </label>
  );
}
export function MoneyInput({ value, onChange, ...p }: { value: number | string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <span className="input-affix"><span>R$</span>
      <input className="input" inputMode="decimal" type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} {...p} />
    </span>
  );
}

export function ImageInput({ value, onChange, folder, label = 'Fotografia' }: { value?: string | null; onChange: (url: string | null) => void; folder: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="image-input">
        {value ? <img src={value} alt="" /> : <div className="image-empty"><Icon name="image" size={22} /></div>}
        <div className="image-actions">
          <Button type="button" variant="line" size="sm" loading={busy} onClick={() => ref.current?.click()}>{value ? 'Trocar imagem' : 'Enviar imagem'}</Button>
          {value && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Remover</Button>}
          <span className="field-hint">JPG, PNG ou WEBP até 5 MB</span>
        </div>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setBusy(true);
          try { onChange(await uploadImage(f, folder)); } catch (err) { toast.error((err as Error).message); }
          setBusy(false);
        }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Feedback
type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; error: (t: string) => void }>({ ok: () => {}, error: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = (kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  };
  return (
    <ToastCtx.Provider value={{ ok: (t) => push('ok', t), error: (t) => push('error', t) }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'ok' ? 'check' : 'x'} size={16} /><span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 20);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Confirmação antes de ações destrutivas
const ConfirmCtx = createContext<(o: { title: string; text: string; confirm?: string; danger?: boolean }) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<null | { title: string; text: string; confirm?: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const ask = (o: { title: string; text: string; confirm?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || ''}
        footer={<><Button variant="ghost" onClick={() => close(false)}>Voltar</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirm || 'Confirmar'}</Button></>}>
        <p className="muted">{state?.text}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export const Loading = ({ label = 'Carregando' }: { label?: string }) => (
  <div className="loading" role="status"><span className="spinner" aria-hidden="true" /><span>{label}…</span></div>
);
export const ErrorBox = ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
  <div className="error-box" role="alert"><p>{error}</p>{onRetry && <Button variant="line" size="sm" onClick={onRetry}>Tentar de novo</Button>}</div>
);
export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="empty"><Diamond /><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>
  );
}
export const Badge = ({ tone = 'muted', children }: { tone?: string; children: React.ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><Icon name="arrowLeft" /></button>
      <span>Página {page} de {pages}</span>
      <button className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"><Icon name="arrowRight" /></button>
    </div>
  );
}

// Ordenação + filtro + paginação no cliente (para listas administrativas)
export function useTable<T>(rows: T[] | undefined, opts: { search?: (r: T) => string; pageSize?: number; initialSort?: keyof T; desc?: boolean }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: keyof T | undefined; desc: boolean }>({ key: opts.initialSort, desc: !!opts.desc });
  const [page, setPage] = useState(1);
  const size = opts.pageSize || 15;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let list = (rows || []).filter((r) => !q || !opts.search || norm(opts.search(r)).includes(norm(q)));
  if (sort.key) {
    const k = sort.key;
    list = [...list].sort((a, b) => {
      const av = a[k] as unknown, bv = b[k] as unknown;
      const r = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true });
      return sort.desc ? -r : r;
    });
  }
  useEffect(() => setPage(1), [q]);
  const th = (key: keyof T, label: string) => (
    <th aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="th-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}>
        {label}<span aria-hidden="true">{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}</span>
      </button>
    </th>
  );
  return { q, setQ, rows: list.slice((page - 1) * size, page * size), total: list.length, page, setPage, size, th };
}

export function SearchBox({ value, onChange, placeholder = 'Pesquisar' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span className="search"><Icon name="search" size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </span>
  );
}

// ------------------------------------------------------------------ Gráficos SVG leves
export function BarChart({ data, height = 180, format = money, color = 'var(--moss)', secondary }: {
  data: { label: string; value: number; value2?: number }[]; height?: number; format?: (v: number) => string; color?: string; secondary?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 || 0)));
  const w = 100 / Math.max(data.length, 1);
  return (
    <div className="chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label="Gráfico de barras">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={height * g} y2={height * g} className="chart-grid" />)}
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 8);
          const h2 = ((d.value2 || 0) / max) * (height - 8);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * w} y="0" width={w} height={height} fill="transparent" />
              <rect x={i * w + w * 0.15} y={height - h} width={w * (secondary ? 0.35 : 0.7)} height={h} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} rx="0.4" />
              {secondary && <rect x={i * w + w * 0.5} y={height - h2} width={w * 0.35} height={h2} fill={secondary} opacity={hover === null || hover === i ? 1 : 0.45} rx="0.4" />}
            </g>
          );
        })}
      </svg>
      <div className="chart-x">{data.map((d, i) => <span key={i} style={{ width: `${w}%` }}>{data.length <= 16 || i % Math.ceil(data.length / 10) === 0 ? d.label : ''}</span>)}</div>
      {hover !== null && data[hover] && (
        <div className="chart-tip" style={{ left: `${Math.min(80, hover * w)}%` }}>
          <strong>{data[hover].label}</strong><span>{format(data[hover].value)}</span>
          {secondary && <span className="muted">{format(data[hover].value2 || 0)}</span>}
        </div>
      )}
    </div>
  );
}
