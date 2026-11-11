'use client';
import dynamic from 'next/dynamic';
import { Logo } from './lib/ui';

const ClientApp = dynamic(() => import('./ClientApp'), {
  ssr: false,
  loading: () => <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#111111', color: '#F4F2EC' }}><Logo /></div>,
});

export default function Root() { return <ClientApp />; }
