import type { MetadataRoute } from 'next';

/** Manifesto do app instalável (PWA): ícone na tela inicial e abertura em tela cheia, sem a barra do navegador. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'MR.LUDER Barbearia',
    short_name: 'MR.LUDER',
    description: 'Agende seu horário na MR.LUDER Barbearia, em Guarulhos.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/?origem=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#293328',
    theme_color: '#293328',
    categories: ['lifestyle', 'business'],
    icons: [
      { src: '/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Agendar horário', short_name: 'Agendar', url: '/agendar?origem=app', icons: [{ src: '/app/icon-192.png', sizes: '192x192' }] },
      { name: 'Meus agendamentos', short_name: 'Minha conta', url: '/conta?origem=app', icons: [{ src: '/app/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
