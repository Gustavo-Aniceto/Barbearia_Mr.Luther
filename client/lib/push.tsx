'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { db } from './api';
import { useAuth } from './core';
import { Button, Icon, useToast } from './ui';
import { useInstall } from './install';

/**
 * Notificações do próprio app (Web Push).
 * - Android/computador: funciona no navegador ou no app instalado.
 * - iPhone: só com o app na tela de início (iOS 16.4+), aberto pelo ícone.
 * O aparelho é inscrito só depois de a pessoa tocar em "Ativar" (o navegador exige um toque).
 */
type State = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));
const standalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

async function serverKey(): Promise<Uint8Array> {
  const r = await fetch('/api/push'); if (!r.ok) throw new Error('Serviço de notificações indisponível');
  return b64ToBytes((await r.json()).publicKey);
}
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}
async function save(sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await db.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
}

export function usePush() {
  const { session } = useAuth();
  const [state, setState] = useState<State>('loading');

  const refresh = useCallback(async () => {
    if (!supported()) { setState(isIos() && !standalone() ? 'ios-install' : 'unsupported'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub && Notification.permission === 'granted' && session) {
        const key = await serverKey();
        if (!sameKey(sub.options.applicationServerKey, key)) { await sub.unsubscribe(); setState('off'); return; } // chave mudou: inscreve de novo
        await save(sub).catch(() => {}); // garante que o aparelho está ligado à conta atual
        setState('on'); return;
      }
      setState('off');
    } catch { setState('off'); }
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    if (!supported()) return refresh();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return false; }
    const reg = await registration();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: await serverKey() });
    await save(sub);
    setState('on');
    return true;
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) { await db.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    setState('off');
  };
  return { state, enable, disable, refresh };
}

/** Cartão completo (conta do cliente e painel do barbeiro). `compact` esconde o cartão quando já está ativo. */
export function PushCard({ audience = 'cliente', compact = false }: { audience?: 'cliente' | 'equipe'; compact?: boolean }) {
  const { state, enable, disable } = usePush();
  const { install, canInstall } = useInstall();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (state === 'loading' || (compact && (state === 'on' || state === 'unsupported'))) return null;
  const what = audience === 'equipe'
    ? 'Receba aqui no celular os novos agendamentos, pedidos de horário fixo e planos vencendo.'
    : 'Receba aqui no celular a confirmação e o lembrete do seu horário, e o aviso quando o plano for vencer.';
  return (
    <section className="panel push-card" aria-label="Notificações no celular">
      <div className="push-card-head">
        <span className="push-ico" aria-hidden="true"><Icon name="bell" size={20} /></span>
        <div>
          <h2>Notificações no celular</h2>
          <p className="muted">{what}</p>
        </div>
      </div>
      {state === 'on' && (
        <div className="push-row"><span className="push-ok"><Icon name="check" size={16} /> Ativas neste aparelho</span>
          <Button variant="ghost" size="sm" loading={busy} onClick={async () => { setBusy(true); try { await disable(); toast.ok('Notificações desativadas neste aparelho'); } finally { setBusy(false); } }}>Desativar</Button></div>
      )}
      {state === 'off' && (
        <Button size="lg" loading={busy} onClick={async () => {
          setBusy(true);
          try { if (await enable()) toast.ok('Notificações ativadas'); } catch (e) { toast.error((e as Error).message || 'Não foi possível ativar agora'); } finally { setBusy(false); }
        }}><Icon name="bell" size={18} /> Ativar notificações</Button>
      )}
      {state === 'ios-install' && (
        <div className="push-row">
          <span className="muted">No iPhone, as notificações funcionam com o app instalado na tela de início. Instale e abra pelo ícone.</span>
          {canInstall && <Button variant="line" size="sm" onClick={install}>Instalar o app</Button>}
        </div>
      )}
      {state === 'denied' && <p className="muted" style={{ margin: 0 }}>As notificações estão bloqueadas para este site. Libere em Configurações do celular › Notificações (ou no cadeado da barra de endereço) e volte aqui.</p>}
      {state === 'unsupported' && <p className="muted" style={{ margin: 0 }}>Este navegador não recebe notificações. Você continua recebendo os avisos por e-mail.</p>}
    </section>
  );
}
