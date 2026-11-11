'use client';
// Dados públicos do site (uma única RPC segura) e carrinho
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { db } from '../lib/api';

export type Service = { id: string; name: string; description: string | null; photo_url: string | null; price: number; price_is_minimum?: boolean; duration_minutes: number; category_id: string | null; is_combo: boolean; bookable_online: boolean; barber_ids: string[] };
export type Barber = { id: string; name: string; bio: string | null; specialties: string[]; photo_url: string | null; accepts_online_booking: boolean; service_ids: string[] };
export type Product = { id: string; name: string; description: string | null; photo_url: string | null; price: number; category_id: string | null; track_stock: boolean; stock: number | null; available: boolean };
export type Plan = { id: string; name: string; description: string | null; price: number; period_months: number; product_discount_percent: number; usage_rules: string | null; contract_conditions: string | null; sold_out: boolean; benefits: { description: string; quantity: number | null; service_id: string | null }[] };
export type Hours = { weekday: number; is_open: boolean; opens_at: string | null; closes_at: string | null };
export type SiteData = {
  settings: Record<string, any>;
  hours: Hours[];
  categories: { id: string; name: string }[];
  services: Service[];
  barbers: Barber[];
  gallery: { id: string; image_url: string; caption: string | null; category: string }[];
  testimonials: { id: string; author: string; rating: number; content: string; created_at: string }[];
  product_categories: { id: string; name: string }[];
  products: Product[];
  plans: Plan[];
  legal: Record<string, { version: string; title: string; content: string; published_at: string }>;
};

const SiteCtx = createContext<{ site: SiteData | null; error: string | null; reload: () => Promise<void> }>({ site: null, error: null, reload: async () => {} });
export const useSite = () => useContext(SiteCtx);
export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [site, setSite] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setSite(await db.rpc<SiteData>('public_site')); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return <SiteCtx.Provider value={{ site, error, reload }}>{children}</SiteCtx.Provider>;
}

// ------------------------------------------------------------------ Carrinho (fica no navegador do cliente)
type CartItem = { product_id: string; quantity: number };
const CartCtx = createContext<{ items: CartItem[]; add: (id: string, q?: number) => void; set: (id: string, q: number) => void; clear: () => void; count: number }>(null as any);
export const useCart = () => useContext(CartCtx);
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => { try { return JSON.parse(localStorage.getItem('mrluder.cart') || '[]'); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem('mrluder.cart', JSON.stringify(items)); } catch { /* sem armazenamento */ } }, [items]);
  const set = (id: string, q: number) => setItems((s) => (q <= 0 ? s.filter((i) => i.product_id !== id) : s.some((i) => i.product_id === id) ? s.map((i) => (i.product_id === id ? { ...i, quantity: q } : i)) : [...s, { product_id: id, quantity: q }]));
  const add = (id: string, q = 1) => set(id, (items.find((i) => i.product_id === id)?.quantity || 0) + q);
  return <CartCtx.Provider value={{ items, add, set, clear: () => setItems([]), count: items.reduce((a, i) => a + i.quantity, 0) }}>{children}</CartCtx.Provider>;
}
