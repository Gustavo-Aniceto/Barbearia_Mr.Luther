'use client';
import React, { useEffect, useState } from 'react';
import { db } from '../lib/api';
import { WEEKDAYS, fmtDate, useAuth, useLoad } from '../lib/core';
import { Badge, Button, Empty, Field, Icon, ImageInput, Input, Loading, MoneyInput, Select, Stars, Tabs, Textarea, Toggle, useConfirm, useToast } from '../lib/ui';
import { useSite } from '../site/data';

function useSettings() {
  const s = useLoad(() => db.select('business_settings').then((r) => r[0]));
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (s.data) setV(s.data); }, [s.data]);
  return { v, setV, reload: s.reload, loading: s.loading };
}

function SaveBar({ onSave, disabled }: { onSave: () => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button disabled={disabled} loading={busy} onClick={async () => { setBusy(true); try { await onSave(); toast.ok('Alterações salvas'); } catch (e) { toast.error((e as Error).message); } setBusy(false); }}>Salvar alterações</Button></div>;
}

export function Settings() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'negocio' | 'horarios' | 'agenda' | 'loja' | 'notificacoes' | 'pagamentos'>('negocio');
  const { v, setV, reload, loading } = useSettings();
  const { reload: reloadSite } = useSite();
  const edit = can('configuracoes.editar');
  if (loading || !v) return <Loading />;
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  const save = (keys: string[]) => async () => { await db.update('business_settings', { id: 1 }, Object.fromEntries(keys.map((k) => [k, v[k] === '' ? null : v[k]]))); reload(); reloadSite(); };
  return (<>
    <Tabs tabs={[{ id: 'negocio', label: 'Estabelecimento' }, { id: 'horarios', label: 'Horário de funcionamento' }, { id: 'agenda', label: 'Políticas da agenda' }, { id: 'loja', label: 'Loja' }, { id: 'notificacoes', label: 'Notificações' }, { id: 'pagamentos', label: 'Pagamentos online' }]} value={tab} onChange={setTab} />
    {tab === 'negocio' && <section className="card"><div className="form-grid">
      <Field label="Nome"><Input disabled={!edit} value={v.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Telefone"><Input disabled={!edit} value={v.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Endereço" className="span-2"><Input disabled={!edit} value={v.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="Link de rota (Google Maps)" className="span-2"><Input disabled={!edit} value={v.maps_url || ''} onChange={(e) => set('maps_url', e.target.value)} /></Field>
      <Field label="WhatsApp (somente números, com DDI)" hint="Ex.: 5511982761017"><Input disabled={!edit} value={v.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="Instagram (endereço do perfil)" hint="Cole o link completo do perfil. Fica oculto no site enquanto vazio."><Input disabled={!edit} placeholder="https://www.instagram.com/…" value={v.instagram_url || ''} onChange={(e) => set('instagram_url', e.target.value)} /></Field>
      <Field label="E-mail para privacidade (LGPD)" hint="Exibido no canal de privacidade"><Input disabled={!edit} type="email" value={v.privacy_email || ''} onChange={(e) => set('privacy_email', e.target.value)} /></Field>
    </div>{edit && <SaveBar onSave={save(['name', 'phone', 'address', 'maps_url', 'whatsapp', 'instagram_url', 'privacy_email'])} />}</section>}
    {tab === 'horarios' && <Hours editable={edit} onSaved={reloadSite} />}
    {tab === 'agenda' && <section className="card"><div className="form-grid">
      <Field label="Antecedência mínima para agendar (min)"><Input disabled={!edit} type="number" min={0} value={v.min_advance_minutes} onChange={(e) => set('min_advance_minutes', Number(e.target.value))} /></Field>
      <Field label="Janela de agendamento (dias à frente)"><Input disabled={!edit} type="number" min={1} max={365} value={v.booking_window_days} onChange={(e) => set('booking_window_days', Number(e.target.value))} /></Field>
      <Field label="Intervalo da grade de horários (min)"><Select disabled={!edit} value={v.slot_step_minutes} onChange={(e) => set('slot_step_minutes', Number(e.target.value))}>{[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field>
      <Field label="Intervalo padrão entre atendimentos (min)"><Input disabled={!edit} type="number" min={0} max={120} value={v.default_buffer_minutes} onChange={(e) => set('default_buffer_minutes', Number(e.target.value))} /></Field>
      <Field label="Cancelamento online até (horas antes)"><Input disabled={!edit} type="number" min={0} value={v.cancel_min_hours} onChange={(e) => set('cancel_min_hours', Number(e.target.value))} /></Field>
      <Field label="Reagendamento online até (horas antes)"><Input disabled={!edit} type="number" min={0} value={v.reschedule_min_hours} onChange={(e) => set('reschedule_min_hours', Number(e.target.value))} /></Field>
      <Field label="Tolerância de atraso (min)"><Input disabled={!edit} type="number" min={0} value={v.late_tolerance_minutes} onChange={(e) => set('late_tolerance_minutes', Number(e.target.value))} /></Field>
      <div><Toggle checked={v.auto_confirm_bookings} onChange={(x) => edit && set('auto_confirm_bookings', x)} label="Confirmar agendamentos online automaticamente" hint="Desligado: entram como pendentes para a equipe confirmar" /></div>
    </div>{edit && <SaveBar onSave={save(['min_advance_minutes', 'booking_window_days', 'slot_step_minutes', 'default_buffer_minutes', 'cancel_min_hours', 'reschedule_min_hours', 'late_tolerance_minutes', 'auto_confirm_bookings'])} />}</section>}
    {tab === 'loja' && <section className="card" style={{ display: 'grid', gap: 16 }}>
      <Toggle checked={v.pickup_enabled} onChange={(x) => edit && set('pickup_enabled', x)} label="Retirada na barbearia" />
      <Toggle checked={v.delivery_enabled} onChange={(x) => edit && set('delivery_enabled', x)} label="Entrega" hint="Exige endereço no checkout" />
      {v.delivery_enabled && <Field label="Taxa de entrega"><MoneyInput value={v.delivery_fee} onChange={(x) => set('delivery_fee', x)} /></Field>}
      {edit && <SaveBar onSave={save(['pickup_enabled', 'delivery_enabled', 'delivery_fee'])} />}
    </section>}
    {tab === 'notificacoes' && <NotificationSettings editable={edit} />}
    {tab === 'pagamentos' && <PaymentSettings />}
  </>);
}

function Hours({ editable, onSaved }: { editable: boolean; onSaved: () => void }) {
  const hours = useLoad(() => db.select('business_hours', {}, { order: 'weekday.asc' }));
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { if (hours.data) setRows(hours.data.map((h: any) => ({ ...h, opens_at: h.opens_at?.slice(0, 5) || '', closes_at: h.closes_at?.slice(0, 5) || '20:00' }))); }, [hours.data]);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <section className="card">
      <div className="notice" style={{ marginBottom: 16 }}><Icon name="clock" /><span>Informação recebida: o estabelecimento fecha às 20h. Marque os dias de abertura e o horário de início — nenhum dia foi presumido.</span></div>
      <div className="hours-editor">{order.map((d) => { const r = rows.find((x) => x.weekday === d); if (!r) return null; const upd = (patch: any) => setRows(rows.map((x) => (x.weekday === d ? { ...x, ...patch } : x)));
        return <div className="row" key={d}><strong>{WEEKDAYS[d]}</strong><Toggle checked={r.is_open} onChange={(x) => editable && upd({ is_open: x })} label={r.is_open ? 'Aberto' : 'Fechado'} />
          <Field label="Abre"><Input type="time" disabled={!editable || !r.is_open} value={r.opens_at} onChange={(e) => upd({ opens_at: e.target.value })} /></Field>
          <Field label="Fecha"><Input type="time" disabled={!editable || !r.is_open} value={r.closes_at} onChange={(e) => upd({ closes_at: e.target.value })} /></Field></div>; })}</div>
      {editable && <SaveBar onSave={async () => {
        for (const r of rows) { if (r.is_open && (!r.opens_at || !r.closes_at || r.opens_at >= r.closes_at)) throw new Error(`Confira o horário de ${WEEKDAYS[r.weekday]}`); }
        for (const r of rows) await db.update('business_hours', { weekday: r.weekday }, { is_open: r.is_open, opens_at: r.is_open ? r.opens_at : null, closes_at: r.is_open ? r.closes_at : null });
        hours.reload(); onSaved();
      }} />}
    </section>
  );
}

function NotificationSettings({ editable }: { editable: boolean }) {
  const toast = useToast();
  const list = useLoad(() => db.select('notification_settings', {}, { order: 'label.asc' }));
  const queued = useLoad(() => db.select('notification_logs', { status: 'aguardando_integracao' }, { limit: 1 }).catch(() => []));
  const failed = useLoad(() => db.select('notification_logs', { status: 'falhou' }, { limit: 1, order: 'created_at.desc' }).catch(() => []));
  const upd = async (n: any, patch: any) => { try { await db.update('notification_settings', { event: n.event }, patch); list.reload(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <div className="notice"><Icon name="bell" /><span>Os avisos ao cliente saem por <strong>e-mail</strong> e <strong>SMS</strong> pelo Brevo, com data, horário, profissional, serviços, valor e endereço. Enquanto o Brevo não estiver configurado na Vercel (docs/NOTIFICACOES.md), as mensagens ficam na fila e <strong>não são marcadas como enviadas</strong>; avisos com mais de 48 h na fila expiram. WhatsApp Business ainda não tem integração.{queued.data?.length ? ' Há mensagens aguardando envio.' : ''}{failed.data?.length ? ' Há envios com falha recente: confira o e-mail ou o celular do cliente.' : ''}</span></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Evento</th><th>Aviso interno</th><th>E-mail</th><th>SMS</th><th>WhatsApp</th></tr></thead>
        <tbody>{(list.data || []).map((n: any) => <tr key={n.event}><td className="cell-strong">{n.label}</td>
          {(['internal_enabled', 'email_enabled', 'sms_enabled', 'whatsapp_enabled'] as const).map((k) => <td key={k}><input type="checkbox" aria-label={`${n.label} ${k}`} checked={n[k]} disabled={!editable} onChange={(e) => upd(n, { [k]: e.target.checked })} style={{ accentColor: 'var(--moss)', width: 17, height: 17 }} /></td>)}</tr>)}</tbody></table></div>
    </section>
  );
}

function PaymentSettings() {
  const { can } = useAuth();
  const s = useLoad(() => db.select('payment_settings').then((r) => r[0]).catch(() => null));
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (s.data) setV(s.data); }, [s.data]);
  if (!can('financeiro.gerenciar')) return <section className="card"><Empty title="Restrito ao financeiro" text="Somente perfis com gestão financeira acessam a configuração de pagamentos." /></section>;
  if (!v) return <Loading />;
  return (
    <section className="card" style={{ display: 'grid', gap: 16 }}>
      <div className="notice"><Icon name="wallet" /><span>A integração está preparada para Mercado Pago ou Asaas (cobrança avulsa e recorrente). Antes de ativar, compare tarifas e funcionalidades atuais na documentação oficial de cada provedor. A <strong>chave secreta nunca é salva aqui</strong>: ela vai como segredo da Edge Function (veja docs/PAGAMENTOS.md). Dados de cartão nunca passam pelo banco da aplicação.</span></div>
      <div className="form-grid">
        <Field label="Provedor"><Select value={v.provider || ''} onChange={(e) => setV({ ...v, provider: e.target.value || null })}><option value="">Não definido</option><option value="mercado_pago">Mercado Pago</option><option value="asaas">Asaas</option></Select></Field>
        <Field label="Ambiente"><Select value={v.environment} onChange={(e) => setV({ ...v, environment: e.target.value })}><option value="sandbox">Testes (sandbox)</option><option value="producao">Produção</option></Select></Field>
        <Field label="Chave pública" className="span-2" hint="Somente a chave pública do provedor"><Input value={v.public_key || ''} onChange={(e) => setV({ ...v, public_key: e.target.value })} /></Field>
      </div>
      <Toggle checked={v.online_payments_enabled} onChange={(x) => setV({ ...v, online_payments_enabled: x })} label="Habilitar pagamentos online" hint="Só ative depois de publicar a Edge Function e testar no sandbox" />
      <SaveBar onSave={async () => { await db.update('payment_settings', { id: 1 }, { provider: v.provider, environment: v.environment, public_key: v.public_key || null, online_payments_enabled: !!v.online_payments_enabled }); s.reload(); }} />
    </section>
  );
}

// ------------------------------------------------------------------ Conteúdo do site
export function SiteContent() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'textos' | 'galeria' | 'depoimentos' | 'avaliacao'>('textos');
  const { v, setV, reload } = useSettings();
  const { reload: reloadSite } = useSite();
  const edit = can('site.editar');
  if (!v) return <Loading />;
  const set = (k: string, val: any) => setV({ ...v, [k]: val });
  const highlights: { title: string; text: string }[] = Array.isArray(v.about_highlights) ? v.about_highlights : [];
  return (<>
    <Tabs tabs={[{ id: 'textos', label: 'Textos e imagem principal' }, { id: 'galeria', label: 'Galeria' }, { id: 'depoimentos', label: 'Depoimentos' }, { id: 'avaliacao', label: 'Avaliação no Google' }]} value={tab} onChange={setTab} />
    {tab === 'textos' && <section className="card" style={{ display: 'grid', gap: 16 }}>
      <div className="form-grid">
        <Field label="Frase principal" className="span-2"><Input disabled={!edit} value={v.hero_title || ''} onChange={(e) => set('hero_title', e.target.value)} /></Field>
        <Field label="Texto complementar" className="span-2"><Input disabled={!edit} value={v.hero_subtitle || ''} onChange={(e) => set('hero_subtitle', e.target.value)} /></Field>
        <div className="span-2"><ImageInput label="Imagem principal (vazio = foto do salão)" value={v.hero_image_url} folder="site" onChange={(u) => set('hero_image_url', u)} /></div>
        <Field label="Título da seção Sobre" className="span-2"><Input disabled={!edit} value={v.about_title || ''} onChange={(e) => set('about_title', e.target.value)} /></Field>
        <Field label="História e identidade" className="span-2"><Textarea rows={6} disabled={!edit} value={v.about_text || ''} onChange={(e) => set('about_text', e.target.value)} /></Field>
      </div>
      <div><span className="field-label">Diferenciais</span>
        {highlights.map((h, i) => <div key={i} className="form-grid" style={{ marginTop: 8 }}>
          <Input disabled={!edit} aria-label="Título do diferencial" value={h.title} onChange={(e) => set('about_highlights', highlights.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <div style={{ display: 'flex', gap: 6 }}><Input disabled={!edit} aria-label="Texto do diferencial" value={h.text} onChange={(e) => set('about_highlights', highlights.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            {edit && <button className="icon-btn" aria-label="Remover diferencial" onClick={() => set('about_highlights', highlights.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>}</div></div>)}
        {edit && highlights.length < 6 && <Button size="sm" variant="ghost" onClick={() => set('about_highlights', [...highlights, { title: '', text: '' }])}>Adicionar diferencial</Button>}
      </div>
      {edit && <SaveBar onSave={async () => { await db.rpc('update_site_content', { p: { hero_title: v.hero_title, hero_subtitle: v.hero_subtitle, hero_image_url: v.hero_image_url, about_title: v.about_title, about_text: v.about_text, about_highlights: highlights.filter((h) => h.title) } }); reload(); reloadSite(); }} />}
    </section>}
    {tab === 'galeria' && <GalleryManager onChange={reloadSite} />}
    {tab === 'depoimentos' && <TestimonialsManager onChange={reloadSite} />}
    {tab === 'avaliacao' && <section className="card" style={{ display: 'grid', gap: 16 }}>
      <p className="muted">Exibida no site como informação cadastrada pelo estabelecimento, com a fonte indicada. Atualize sempre que a nota no Google mudar.</p>
      <div className="form-grid">
        <Field label="Nota (0 a 5)"><Input disabled={!edit} type="number" step="0.1" min={0} max={5} value={v.rating_value ?? ''} onChange={(e) => set('rating_value', e.target.value)} /></Field>
        <Field label="Quantidade de avaliações"><Input disabled={!edit} type="number" min={0} value={v.rating_count ?? ''} onChange={(e) => set('rating_count', e.target.value)} /></Field>
        <Field label="Fonte exibida" className="span-2"><Input disabled={!edit} value={v.rating_source || ''} onChange={(e) => set('rating_source', e.target.value)} /></Field>
      </div>
      {v.rating_value && <div><Stars value={Number(v.rating_value)} /> atualizado em {v.rating_updated_at ? fmtDate(v.rating_updated_at + 'T12:00:00Z') : '–'}</div>}
      {edit && <SaveBar onSave={async () => { await db.rpc('update_site_content', { p: { rating_value: v.rating_value === '' ? null : Number(v.rating_value), rating_count: v.rating_count === '' ? null : Number(v.rating_count), rating_source: v.rating_source } }); reload(); reloadSite(); }} />}
    </section>}
  </>);
}

function GalleryManager({ onChange }: { onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const list = useLoad(() => db.select('gallery_images', {}, { order: 'sort_order.asc' }));
  const [adding, setAdding] = useState<{ url: string | null; caption: string; category: string }>({ url: null, caption: '', category: 'ambiente' });
  const refresh = () => { list.reload(); onChange(); };
  const move = async (i: number, dir: number) => {
    const a = list.data![i], b = list.data![i + dir]; if (!b) return;
    await db.update('gallery_images', { id: a.id }, { sort_order: i + dir }); await db.update('gallery_images', { id: b.id }, { sort_order: i }); refresh();
  };
  return (
    <section className="card" style={{ display: 'grid', gap: 16 }}>
      {can('site.criar') && <div className="form-grid">
        <ImageInput label="Nova foto" value={adding.url} folder="galeria" onChange={(url) => setAdding({ ...adding, url })} />
        <div style={{ display: 'grid', gap: 10 }}><Field label="Legenda"><Input value={adding.caption} onChange={(e) => setAdding({ ...adding, caption: e.target.value })} /></Field>
          <Field label="Categoria"><Select value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })}>{['ambiente', 'cortes', 'barba', 'resultados', 'eventos'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Button disabled={!adding.url} onClick={async () => { try { await db.insert('gallery_images', { image_url: adding.url, caption: adding.caption || null, category: adding.category, sort_order: list.data?.length || 0 }); setAdding({ url: null, caption: '', category: 'ambiente' }); toast.ok('Foto publicada'); refresh(); } catch (e) { toast.error((e as Error).message); } }}>Publicar na galeria</Button></div>
      </div>}
      {!list.data?.length ? <Empty title="Galeria vazia" text="Enquanto vazia, o site mostra as fotos enviadas na criação do projeto." /> : (
        <ul className="list-plain">{list.data.map((g: any, i: number) => <li key={g.id}><span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><img className="thumb" src={g.image_url} alt="" style={{ width: 64, height: 64 }} /><span>{g.caption || 'Sem legenda'}<br /><span className="cell-sub">{g.category}</span></span></span>
          {can('site.editar') && <span><button className="icon-btn" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowLeft" size={15} className="rot90" /></button><button className="icon-btn" aria-label="Descer" disabled={i === list.data!.length - 1} onClick={() => move(i, 1)}><Icon name="arrowRight" size={15} /></button>
            {can('site.excluir') && <button className="icon-btn" aria-label="Remover foto" onClick={async () => { if (await confirm({ title: 'Remover foto?', text: 'A foto sai da galeria do site.', danger: true, confirm: 'Remover' })) { try { await db.remove('gallery_images', { id: g.id }); refresh(); } catch (e) { toast.error((e as Error).message); } } }}><Icon name="trash" size={16} /></button>}</span>}</li>)}</ul>
      )}
    </section>
  );
}

function TestimonialsManager({ onChange }: { onChange: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useLoad(() => db.select('testimonials', {}, { order: 'created_at.desc' }));
  const set = async (id: string, status: string) => { try { await db.update('testimonials', { id }, { status }); list.reload(); onChange(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <section className="card">
      <p className="muted" style={{ marginBottom: 12 }}>Somente clientes com atendimento finalizado podem enviar. Nada é publicado sem aprovação.</p>
      {!list.data?.length ? <Empty title="Nenhum depoimento recebido" /> : (
        <ul className="list-plain">{list.data.map((t: any) => <li key={t.id}><span><Stars value={t.rating} size={13} /> <strong>{t.author_name}</strong> · {fmtDate(t.created_at)}<br />{t.content}</span>
          <span><Badge tone={t.status === 'aprovado' ? 'ok' : t.status === 'pendente' ? 'warn' : 'muted'}>{t.status}</Badge>{can('site.editar') && <>{t.status !== 'aprovado' && <Button size="sm" variant="ghost" onClick={() => set(t.id, 'aprovado')}>Publicar</Button>}{t.status !== 'oculto' && <Button size="sm" variant="ghost" onClick={() => set(t.id, 'oculto')}>Ocultar</Button>}</>}</span></li>)}</ul>
      )}
    </section>
  );
}
