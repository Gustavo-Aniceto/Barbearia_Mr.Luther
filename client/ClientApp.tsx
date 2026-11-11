'use client';
import React, { useEffect } from 'react';
import { AuthProvider, usePath } from './lib/core';
import { ConfirmProvider, ToastProvider } from './lib/ui';
import { CartProvider, SiteProvider } from './site/data';
import { InstallProvider } from './lib/install';
import { Home } from './site/Home';
import { Booking } from './site/Booking';
import { AuthPage, Cart, ChangePassword, ClubLanding, Legal, NotFound, PrivacyCenter, Shop } from './site/Pages';
import { Account } from './account/Account';
import { BarberApp } from './panel/Barber';
import { AdminApp } from './admin/Admin';

const TITLES: [RegExp, string][] = [
  [/^\/admin/, 'Gestão'], [/^\/barbeiro/, 'Painel do barbeiro'], [/^\/agendar/, 'Agendar horário'], [/^\/conta/, 'Minha conta'],
  [/^\/loja/, 'Produtos'], [/^\/carrinho/, 'Carrinho'], [/^\/entrar/, 'Entrar'], [/^\/cadastro/, 'Criar conta'], [/^\/club/, 'MR.LUDER Club'],
];

/**
 * No celular as tabelas viram cartões (CSS). Para cada célula mostrar a que coluna pertence,
 * copiamos o título da coluna para data-label — automaticamente, em qualquer tabela que aparecer.
 */
function useTableLabels() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>('table.table').forEach((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
        if (!heads.length) return;
        t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
          if (td.getAttribute('data-label') !== (heads[i] || '')) td.setAttribute('data-label', heads[i] || '');
        }));
      });
    };
    label();
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
}

function Router() {
  const path = usePath();
  useTableLabels();
  useEffect(() => {
    const t = TITLES.find(([r]) => r.test(path));
    document.title = t ? `${t[1]} · MR.LUDER Barbearia` : 'MR.LUDER Barbearia · Guarulhos';
    // links com âncora vindos de outra página
    if (location.hash && !location.hash.includes('access_token')) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 120);
  }, [path]);
  if (path.startsWith('/admin')) return <AdminApp />;
  if (path.startsWith('/barbeiro')) return <BarberApp />;
  switch (path) {
    case '/': return <Home />;
    case '/agendar': return <Booking />;
    case '/entrar': return <AuthPage mode="entrar" />;
    case '/cadastro': return <AuthPage mode="cadastro" />;
    case '/recuperar-senha': return <AuthPage mode="recuperar" />;
    case '/alterar-senha': return <ChangePassword />;
    case '/conta': return <Account />;
    case '/loja': return <Shop />;
    case '/carrinho': return <Cart />;
    case '/club': return <ClubLanding />;
    case '/termos': return <Legal kind="termos" />;
    case '/privacidade': return <Legal kind="privacidade" />;
    case '/meus-dados': return <PrivacyCenter />;
    default: return <NotFound />;
  }
}

export default function ClientApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <SiteProvider>
            <CartProvider>
              <InstallProvider>
                <Router />
              </InstallProvider>
            </CartProvider>
          </SiteProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
