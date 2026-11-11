'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Icon } from './ui';

/**
 * App instalável (PWA).
 * - Android/Chrome/Edge: guarda o evento "beforeinstallprompt" e abre o instalador nativo ao tocar em "Instalar app".
 * - iPhone/iPad (Safari): não há instalador automático; mostramos o passo a passo (Compartilhar → Adicionar à Tela de Início).
 * - Já instalado (aberto em tela cheia): nada aparece.
 */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type Platform = 'android' | 'ios' | 'none';
type Ctx = { canInstall: boolean; platform: Platform; install: () => void; installed: boolean };

const InstallCtx = createContext<Ctx>({ canInstall: false, platform: 'none', install: () => {}, installed: false });
export const useInstall = () => useContext(InstallCtx);

const DISMISS_KEY = 'mrluder:instalar:dispensado';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [platform, setPlatform] = useState<Platform>('none');
  const [installed, setInstalled] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* sem service worker o site segue funcionando */ });
    }
    if (isStandalone()) { setInstalled(true); return; }
    if (isIos()) setPlatform('ios');
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); setPlatform('android'); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const install = () => {
    if (evt) {
      evt.prompt();
      evt.userChoice.then((c) => { if (c.outcome === 'accepted') setInstalled(true); setEvt(null); }).catch(() => {});
    } else if (platform === 'ios') {
      setIosHelp(true);
    }
  };
  const canInstall = !installed && (platform === 'ios' || !!evt);

  return (
    <InstallCtx.Provider value={{ canInstall, platform, install, installed }}>
      {children}
      {iosHelp && <IosInstallSheet onClose={() => setIosHelp(false)} />}
    </InstallCtx.Provider>
  );
}

function IosInstallSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="install-sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="ios-install-title" onClick={onClose}>
      <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="install-sheet-head">
          <img src="/app/icon-192.png" alt="" width={48} height={48} />
          <div>
            <h2 id="ios-install-title">Instalar o app MR.LUDER</h2>
            <p>Leva 10 segundos e fica na sua tela inicial.</p>
          </div>
        </div>
        <ol className="install-steps">
          <li><span className="install-ico" aria-hidden="true"><ShareGlyph /></span><span>Toque em <strong>Compartilhar</strong> na barra do Safari (o quadrado com a seta para cima).</span></li>
          <li><span className="install-ico" aria-hidden="true"><Icon name="plus" size={18} /></span><span>Role a lista e toque em <strong>Adicionar à Tela de Início</strong>.</span></li>
          <li><span className="install-ico" aria-hidden="true"><Icon name="check" size={18} /></span><span>Toque em <strong>Adicionar</strong>. O ícone da barbearia aparece junto dos seus apps.</span></li>
        </ol>
        <p className="install-note">Está no Chrome ou outro navegador? Abra este site no Safari para instalar.</p>
        <button className="btn btn-primary btn-lg" onClick={onClose}>Entendi</button>
      </div>
    </div>
  );
}

function ShareGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
    </svg>
  );
}

/** Faixa discreta no topo do site (celular), que some para sempre ao ser dispensada ou após instalar. */
export function InstallBanner() {
  const { canInstall, install } = useInstall();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(DISMISS_KEY) === '1'); } catch { setHidden(false); }
  }, []);
  if (!canInstall || hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  return (
    <div className="install-banner" role="region" aria-label="Instalar o app">
      <img src="/app/icon-192.png" alt="" width={36} height={36} />
      <div className="install-banner-text"><strong>App MR.LUDER</strong><span>Agende direto da tela inicial</span></div>
      <button className="btn btn-light btn-sm" onClick={install}>Instalar</button>
      <button className="icon-btn" aria-label="Agora não" onClick={dismiss}><Icon name="x" size={18} /></button>
    </div>
  );
}

/** Link "Instalar app" para rodapé, conta e menu dos painéis (só aparece quando dá para instalar). */
export function InstallLink({ className = '' }: { className?: string }) {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return <button type="button" className={`install-link ${className}`} onClick={install}><Icon name="phone" size={15} />Instalar o app no celular</button>;
}
