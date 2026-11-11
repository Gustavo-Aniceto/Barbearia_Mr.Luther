'use client';
import React, { useEffect } from 'react';
import { AuthProvider, usePath } from './lib/core';
import { ConfirmProvider, ToastProvider } from './lib/ui';
import { CartProvider, SiteProvider } from './site/data';
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

function Router() {
  const path = usePath();
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
              <Router />
            </CartProvider>
          </SiteProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
