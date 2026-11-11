import type { Metadata, Viewport } from 'next';
import { Bodoni_Moda, Montserrat } from 'next/font/google';
import '@/client/styles.css';

const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', display: 'swap' });
const bodoni = Bodoni_Moda({ subsets: ['latin'], style: ['normal', 'italic'], axes: ['opsz'], variable: '--font-bodoni', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'MR.LUDER Barbearia · Guarulhos',
  description: 'MR.LUDER Barbearia em Guarulhos: mais que um corte, uma experiência. Agende online, conheça os profissionais, produtos e planos.',
  icons: { icon: '/img/favicon.png', apple: '/app/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'MR.LUDER', statusBarStyle: 'black' },
  applicationName: 'MR.LUDER Barbearia',
  formatDetection: { telephone: false },
  openGraph: { title: 'MR.LUDER Barbearia', description: 'Mais que um corte. Uma experiência. Agende seu horário online.', images: ['/img/salao.jpg'], locale: 'pt_BR', type: 'website' },
};
export const viewport: Viewport = { themeColor: '#293328', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${montserrat.variable} ${bodoni.variable}`}>
      <body>{children}</body>
    </html>
  );
}
