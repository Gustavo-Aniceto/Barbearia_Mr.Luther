'use client';
import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/api';
import { Link, money, navigate, useAuth, useQuery } from '../lib/core';
import { Button, Field, Input, Select, Textarea, Icon, Empty, Loading, useToast, Logo } from '../lib/ui';
import { SiteLayout, ProductCard } from './Home';
import { useCart, useSite } from './data';

const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
const passOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

// ------------------------------------------------------------------ Entrar / cadastrar
export function AuthPage({ mode }: { mode: 'entrar' | 'cadastro' | 'recuperar' }) {
  const q = useQuery();
  const back = q.get('voltar') || '';
  const ref = q.get('ref') || (() => { try { return localStorage.getItem('mrluder.ref') || ''; } catch { return ''; } })();
  const { session, access, loading } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', birth: '', terms: false, mEmail: false, mWhats: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stage, setStage] = useState<'form' | 'verify' | 'reset'>('form');
  const [otp, setOtp] = useState('');
  const { site } = useSite();

  useEffect(() => { if (q.get('ref')) try { localStorage.setItem('mrluder.ref', q.get('ref')!); } catch { /* */ } }, []);
  useEffect(() => {
    if (session && access && !loading && mode !== 'recuperar') {
      navigate(back || (access.is_staff ? (access.is_owner || !access.roles.every((r) => ['barbeiro', 'cliente', 'afiliado'].includes(r)) ? '/admin' : '/barbeiro') : '/conta'), true);
    }
  }, [session, access, loading]);

  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!emailOk(f.email)) err.email = 'Informe um e-mail válido';
    if (mode !== 'recuperar' && !f.password) err.password = 'Informe sua senha';
    if (mode === 'cadastro') {
      if (f.name.trim().split(/\s+/).length < 2) err.name = 'Informe nome e sobrenome';
      if (f.phone.replace(/\D/g, '').length < 10) err.phone = 'Informe um telefone com DDD';
      if (!passOk(f.password)) err.password = 'Use ao menos 8 caracteres, com letras e números';
      if (!f.terms) err.terms = 'É preciso aceitar os termos para criar a conta';
    }
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      if (mode === 'entrar') {
        try { await auth.signIn(f.email, f.password); }
        catch (er) {
          if (/Confirme seu e-mail/.test((er as Error).message)) { await auth.resendVerification(f.email).catch(() => {}); setStage('verify'); toast.ok('Enviamos um código de confirmação para o seu e-mail.'); }
          else throw er;
        }
      } else if (mode === 'recuperar') {
        await auth.requestPasswordReset(f.email.trim().toLowerCase());
        setStage('reset'); toast.ok('Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos.');
      } else {
        const r = await auth.signUp(f.email.trim().toLowerCase(), f.password, {
          full_name: f.name.trim(), phone: f.phone.trim(), birth_date: f.birth || null, accepted_terms: true,
          marketing_email: f.mEmail, marketing_whatsapp: f.mWhats, ref_code: ref || null, user_agent: navigator.userAgent,
        });
        try { localStorage.removeItem('mrluder.ref'); } catch { /* */ }
        if (r.needsConfirmation) { setStage('verify'); toast.ok('Conta criada. Digite o código enviado ao seu e-mail.'); }
        else toast.ok('Conta criada. Bem-vindo à MR.LUDER!');
      }
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) return toast.error('Digite o código de 6 dígitos');
    setBusy(true);
    try {
      if (stage === 'verify') {
        const s2 = await auth.verifyEmail(f.email.trim().toLowerCase(), otp.trim());
        if (!s2) { toast.ok('E-mail confirmado. Entre com sua senha.'); setStage('form'); navigate('/entrar'); }
      } else {
        if (!passOk(f.password)) throw new Error('Use ao menos 8 caracteres, com letras e números');
        await auth.resetPassword(f.email.trim().toLowerCase(), otp.trim(), f.password);
        toast.ok('Senha redefinida. Entre com a nova senha.'); setStage('form'); navigate('/entrar');
      }
    } catch (er) { toast.error((er as Error).message); }
    setBusy(false);
  }

  const title = mode === 'entrar' ? 'Entrar' : mode === 'cadastro' ? 'Criar conta' : 'Recuperar senha';
  return (
    <SiteLayout>
      <div className="auth-wrap">
        <div className="auth-art"><div><h2>Sua cadeira está reservada.</h2><p>Agende, acompanhe seus atendimentos, planos e recompensas em um só lugar.</p></div></div>
        <div className="auth-form">
          {stage !== 'form' ? (
            <form onSubmit={submitCode} noValidate>
              <h1>{stage === 'verify' ? 'Confirme seu e-mail' : 'Nova senha'}</h1>
              {stage === 'verify'
                ? <p className="muted">Enviamos um código de 6 dígitos para <strong>{f.email}</strong>. Ele vale por 15 minutos.</p>
                : <p className="muted">Se <strong>{f.email}</strong> tiver conta na MR.LUDER, enviamos um código de 6 dígitos. Ele vale por 15 minutos.</p>}
              <div className="notice"><Icon name="clock" /><span>Não chegou em 2 minutos? Confira o spam e a aba Promoções (o remetente é <strong>auth@mail.myneon.app</strong>).{stage === 'reset' && <> Ainda não tem conta? <Link to="/cadastro">Crie sua conta</Link>, é rápido.</>}</span></div>
              <Field label="Código" required><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} /></Field>
              {stage === 'reset' && <Field label="Nova senha" required hint="Mínimo de 8 caracteres, com letras e números"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>}
              <Button type="submit" size="lg" loading={busy}>{stage === 'verify' ? 'Confirmar e-mail' : 'Redefinir senha'}</Button>
              <button type="button" className="text-link" onClick={async () => {
                try { stage === 'verify' ? await auth.resendVerification(f.email) : await auth.requestPasswordReset(f.email); toast.ok('Novo código enviado'); } catch (er) { toast.error((er as Error).message); }
              }}>Reenviar código</button>
            </form>
          ) : (
          <form onSubmit={submit} noValidate>
            <h1>{title}</h1>
            {ref && mode === 'cadastro' && <div className="notice"><Icon name="gift" /><span>Você foi indicado por um cliente MR.LUDER (código <strong>{ref}</strong>).</span></div>}
            {sent ? (
              <div className="notice"><Icon name="check" /><span>Verifique seu e-mail para confirmar a conta.</span></div>
            ) : (
              <>
                {mode === 'cadastro' && <Field label="Nome completo" required error={errors.name}><Input autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>}
                <Field label="E-mail" required error={errors.email}><Input type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
                {mode === 'cadastro' && (
                  <div className="form-grid">
                    <Field label="Telefone / WhatsApp" required error={errors.phone}><Input type="tel" autoComplete="tel" placeholder="(11) 90000-0000" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
                    <Field label="Data de nascimento" hint="Opcional"><Input type="date" value={f.birth} onChange={(e) => set('birth', e.target.value)} max={new Date().toISOString().slice(0, 10)} /></Field>
                  </div>
                )}
                {mode !== 'recuperar' && (
                  <Field label="Senha" required error={errors.password} hint={mode === 'cadastro' ? 'Mínimo de 8 caracteres, com letras e números' : undefined}>
                    <Input type="password" autoComplete={mode === 'cadastro' ? 'new-password' : 'current-password'} value={f.password} onChange={(e) => set('password', e.target.value)} />
                  </Field>
                )}
                {mode === 'cadastro' && (
                  <div className="consent">
                    <label className="check"><input type="checkbox" checked={f.terms} onChange={(e) => set('terms', e.target.checked)} />
                      <span>Li e aceito os <Link to="/termos" target="_blank">Termos de Uso</Link> e estou ciente da <Link to="/privacidade" target="_blank">Política de Privacidade</Link>{site?.legal?.termos && ` (versão ${site.legal.termos.version})`}.</span></label>
                    {errors.terms && <span className="field-error" role="alert">{errors.terms}</span>}
                    <span className="field-hint">Comunicações de marketing (opcional, você pode mudar quando quiser):</span>
                    <label className="check"><input type="checkbox" checked={f.mEmail} onChange={(e) => set('mEmail', e.target.checked)} /><span>Quero receber novidades e ofertas por e-mail</span></label>
                    <label className="check"><input type="checkbox" checked={f.mWhats} onChange={(e) => set('mWhats', e.target.checked)} /><span>Quero receber novidades e ofertas por WhatsApp</span></label>
                  </div>
                )}
                <Button type="submit" size="lg" loading={busy}>{mode === 'entrar' ? 'Entrar' : mode === 'cadastro' ? 'Criar conta' : 'Enviar código'}</Button>
              </>
            )}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
              {mode !== 'entrar' && <Link className="text-link" to={`/entrar${back ? `?voltar=${encodeURIComponent(back)}` : ''}`}>Já tenho conta</Link>}
              {mode !== 'cadastro' && <Link className="text-link" to={`/cadastro${back ? `?voltar=${encodeURIComponent(back)}` : ''}`}>Criar conta</Link>}
              {mode === 'entrar' && <Link className="text-link" to="/recuperar-senha">Esqueci minha senha</Link>}
            </div>
          </form>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}

export function ChangePassword() {
  const { session, loading } = useAuth();
  const [cur, setCur] = useState(''); const [p, setP] = useState(''); const [p2, setP2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (!loading && !session) navigate('/entrar?voltar=/alterar-senha', true); }, [loading, session]);
  return (
    <SiteLayout>
      <div className="wrap page" style={{ maxWidth: 480 }}>
        <h1 className="page-title">Alterar senha</h1>
        <form className="panel" style={{ display: 'grid', gap: 16 }} onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          if (!passOk(p)) return setErr('Use ao menos 8 caracteres, com letras e números');
          if (p !== p2) return setErr('As senhas não conferem');
          setBusy(true);
          try { await auth.changePassword(cur, p); toast.ok('Senha alterada. Outros dispositivos foram desconectados.'); navigate('/conta'); } catch (er) { toast.error((er as Error).message); }
          setBusy(false);
        }}>
          <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="Nova senha" error={err}><Input type="password" autoComplete="new-password" value={p} onChange={(e) => setP(e.target.value)} /></Field>
          <Field label="Repita a nova senha"><Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
          <Button type="submit" loading={busy}>Salvar nova senha</Button>
        </form>
      </div>
    </SiteLayout>
  );
}

// ------------------------------------------------------------------ Loja
export function Shop() {
  const { site } = useSite();
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyAvail, setOnlyAvail] = useState(false);
  if (!site) return <SiteLayout><Loading /></SiteLayout>;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = site.products.filter((p) => (!cat || p.category_id === cat) && (!q || norm(p.name + ' ' + (p.description || '')).includes(norm(q))) && (!onlyAvail || p.available));
  return (
    <SiteLayout>
      <div className="wrap page light">
        <h1 className="page-title">Produtos</h1>
        <p className="page-lead">Compre online e retire na barbearia{site.settings.delivery_enabled ? ', ou receba em casa' : ''}. O pagamento é feito na retirada.</p>
        <div className="toolbar" style={{ marginBottom: 28 }}>
          <span className="search"><Icon name="search" size={16} /><input type="search" placeholder="Buscar produto" aria-label="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} /></span>
          <div className="price-cats" style={{ margin: 0 }} role="group" aria-label="Categorias">
            <button className="chip" aria-pressed={!cat} onClick={() => setCat(null)}>Todos</button>
            {site.product_categories.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} />Somente disponíveis</label>
        </div>
        {list.length === 0 ? <Empty title={site.products.length ? 'Nenhum produto encontrado' : 'Loja em preparação'} text={site.products.length ? 'Ajuste a busca ou os filtros.' : 'Os produtos serão publicados em breve.'} />
          : <div className="product-grid">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
      </div>
    </SiteLayout>
  );
}

export function Cart() {
  const { site } = useSite();
  const { items, set, clear } = useCart();
  const { session } = useAuth();
  const toast = useToast();
  const [fulfillment, setFulfillment] = useState('retirada');
  const [coupon, setCoupon] = useState('');
  const [addr, setAddr] = useState({ logradouro: '', numero: '', complemento: '', bairro: '', cidade: 'Guarulhos', cep: '' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!site) return <SiteLayout><Loading /></SiteLayout>;
  const lines = items.map((i) => ({ ...i, p: site.products.find((p) => p.id === i.product_id) })).filter((l) => l.p);
  const subtotal = lines.reduce((a, l) => a + Number(l.p!.price) * l.quantity, 0);
  const fee = fulfillment === 'entrega' ? Number(site.settings.delivery_fee) : 0;

  async function checkout() {
    if (!session) return navigate(`/entrar?voltar=${encodeURIComponent('/carrinho')}`);
    setBusy(true);
    try {
      await db.rpc('place_order', { p_items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })), p_fulfillment: fulfillment,
        p_coupon_code: coupon || null, p_address: fulfillment === 'entrega' ? addr : null, p_notes: notes || null });
      clear(); setDone('ok');
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <SiteLayout>
      <div className="wrap page">
        <h1 className="page-title">Carrinho</h1>
        {done ? (
          <div className="panel confirmation"><div className="seal"><Icon name="check" size={28} /></div><h2>Pedido recebido</h2>
            <p className="muted">Acompanhe o status em Minha conta. O pagamento é feito na barbearia (dinheiro, Pix ou cartão); após a confirmação, o pedido fica pronto para retirada.</p>
            <Link to="/conta?aba=pedidos" className="btn btn-primary btn-md">Ver meus pedidos</Link></div>
        ) : lines.length === 0 ? (
          <Empty title="Seu carrinho está vazio" text="Veja os produtos usados na cadeira da MR.LUDER." action={<Link to="/loja" className="btn btn-primary btn-md">Ver produtos</Link>} />
        ) : (
          <div className="booking">
            <div className="panel">
              {lines.map((l) => (
                <div className="cart-line" key={l.product_id}>
                  {l.p!.photo_url ? <img src={l.p!.photo_url} alt="" /> : <span className="ph" />}
                  <div><strong>{l.p!.name}</strong><div className="muted" style={{ fontSize: 13 }}>{money(l.p!.price)} cada</div>
                    {!l.p!.available && <span className="field-error">Indisponível no momento</span>}</div>
                  <span className="qty">
                    <button aria-label="Diminuir" onClick={() => set(l.product_id, l.quantity - 1)}>−</button><span>{l.quantity}</span>
                    <button aria-label="Aumentar" disabled={l.p!.track_stock && l.p!.stock !== null && l.quantity >= l.p!.stock} onClick={() => set(l.product_id, l.quantity + 1)}>+</button>
                  </span>
                  <strong>{money(Number(l.p!.price) * l.quantity)}</strong>
                </div>
              ))}
              <div className="form-grid" style={{ marginTop: 20 }}>
                <Field label="Recebimento">
                  <Select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
                    {site.settings.pickup_enabled && <option value="retirada">Retirar na barbearia</option>}
                    {site.settings.delivery_enabled && <option value="entrega">Entrega ({money(site.settings.delivery_fee)})</option>}
                  </Select>
                </Field>
                <Field label="Cupom" hint="Desconto do seu plano é aplicado automaticamente"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Ex.: CLUB-AB12CD34" /></Field>
                {fulfillment === 'entrega' && (<>
                  <Field label="Endereço" className="span-2"><Input value={addr.logradouro} onChange={(e) => setAddr({ ...addr, logradouro: e.target.value })} /></Field>
                  <Field label="Número"><Input value={addr.numero} onChange={(e) => setAddr({ ...addr, numero: e.target.value })} /></Field>
                  <Field label="Complemento"><Input value={addr.complemento} onChange={(e) => setAddr({ ...addr, complemento: e.target.value })} /></Field>
                  <Field label="Bairro"><Input value={addr.bairro} onChange={(e) => setAddr({ ...addr, bairro: e.target.value })} /></Field>
                  <Field label="CEP"><Input value={addr.cep} onChange={(e) => setAddr({ ...addr, cep: e.target.value })} /></Field>
                </>)}
                <Field label="Observações" className="span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              </div>
            </div>
            <aside className="summary">
              <h2>Resumo</h2>
              <dl><div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>{fee > 0 && <div><dt>Entrega</dt><dd>{money(fee)}</dd></div>}</dl>
              <div className="summary-total"><span>Total estimado</span><strong>{money(subtotal + fee)}</strong></div>
              <span className="muted">Descontos de cupom e plano são calculados ao finalizar.</span>
              <Button variant="light" size="lg" loading={busy} onClick={checkout}>{session ? 'Finalizar pedido' : 'Entrar para finalizar'}</Button>
            </aside>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}

// ------------------------------------------------------------------ Documentos legais e privacidade
export function Legal({ kind }: { kind: 'termos' | 'privacidade' }) {
  const { site } = useSite();
  const doc = site?.legal?.[kind];
  return (
    <SiteLayout>
      <div className="wrap page">
        {!site ? <Loading /> : !doc ? <Empty title="Documento indisponível" /> : (<>
          <h1 className="page-title">{doc.title}</h1>
          <p className="page-lead">Versão {doc.version}, publicada em {new Date(doc.published_at).toLocaleDateString('pt-BR')}.</p>
          <div className="legal">{doc.content}</div>
          {kind === 'privacidade' && <p style={{ marginTop: 32 }}><Link to="/meus-dados" className="btn btn-primary btn-md">Exercer meus direitos</Link></p>}
        </>)}
      </div>
    </SiteLayout>
  );
}

export function PrivacyCenter() {
  const { session } = useAuth();
  const { site } = useSite();
  const toast = useToast();
  const [f, setF] = useState({ kind: 'copia', details: '', name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [protocol, setProtocol] = useState<string | null>(null);
  const KINDS: Record<string, string> = { copia: 'Cópia dos meus dados', correcao: 'Correção de dados', informacoes: 'Informações sobre o tratamento', portabilidade: 'Portabilidade', exclusao: 'Exclusão ou anonimização', revogacao: 'Revogação de consentimento' };
  return (
    <SiteLayout>
      <div className="wrap page" style={{ maxWidth: 760 }}>
        <h1 className="page-title">Privacidade e meus dados</h1>
        <p className="page-lead">Canal para titulares exercerem os direitos previstos na LGPD (Lei nº 13.709/2018). Você recebe um número de protocolo e a resposta pelo e-mail informado.</p>
        {protocol ? (
          <div className="panel confirmation"><div className="seal"><Icon name="check" size={28} /></div><h2>Solicitação registrada</h2><p>Protocolo <strong>{protocol}</strong>. Guarde este número.</p></div>
        ) : (
          <form className="panel" style={{ display: 'grid', gap: 16 }} onSubmit={async (e) => {
            e.preventDefault();
            if (!session && (!f.name.trim() || !emailOk(f.email))) return toast.error('Informe nome e e-mail válidos');
            setBusy(true);
            try { setProtocol(await db.rpc<string>('create_privacy_request', { p_kind: f.kind, p_details: f.details || null, p_name: f.name || null, p_email: f.email || null })); }
            catch (er) { toast.error((er as Error).message); }
            setBusy(false);
          }}>
            {!session && <div className="form-grid">
              <Field label="Nome" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="E-mail" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            </div>}
            {session && <div className="notice"><Icon name="user" /><span>Você está conectado: a solicitação fica vinculada à sua conta. Para baixar uma cópia imediata, use <Link className="text-link" to="/conta?aba=privacidade">Minha conta › Privacidade</Link>.</span></div>}
            <Field label="Tipo de solicitação"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Detalhes" hint="Descreva o que precisa. Não envie documentos ou dados sensíveis por aqui."><Textarea maxLength={2000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            <Button type="submit" loading={busy}>Enviar solicitação</Button>
            {site?.settings.privacy_email && <p className="muted">Contato de privacidade: {site.settings.privacy_email}</p>}
          </form>
        )}
      </div>
    </SiteLayout>
  );
}

export function ClubLanding() {
  const { site } = useSite();
  const s = site?.settings;
  // Programa de indicação desligado pelo proprietário: a página não aparece para o cliente.
  useEffect(() => { if (s && !s.referral_enabled) navigate('/', true); }, [s]);
  if (s && !s.referral_enabled) return <SiteLayout><Loading /></SiteLayout>;
  return (
    <SiteLayout>
      <section className="hero"><div className="wrap" style={{ padding: '80px 0' }}>
        <div className="marker">Indique e ganhe</div>
        <h1 className="display" style={{ fontSize: 'clamp(40px, 6vw, 80px)', lineHeight: 1 }}>MR.LUDER Club</h1>
        <p className="hero-sub">Indique amigos para a MR.LUDER. Quando a indicação faz o primeiro atendimento ou compra, você ganha {s?.referral_reward_description || (s?.referral_reward_value > 0 ? (s?.referral_reward_kind === 'desconto_percentual' ? `${Number(s?.referral_reward_value)}% de desconto` : money(s?.referral_reward_value)) : 'uma recompensa')}.</p>
        <div className="hero-actions"><Link to="/conta?aba=club" className="btn btn-light btn-lg">Pegar meu link</Link></div>
      </div></section>
      <section className="section"><div className="wrap">
        <ol className="setup-steps" style={{ maxWidth: 640, padding: 0 }}>
          <li><span>Entre na sua conta e gere seu código exclusivo.</span></li>
          <li><span>Compartilhe seu link com amigos.</span></li>
          <li><span>Seu amigo cria a conta pelo link e faz o primeiro atendimento ou compra.</span></li>
          <li><span>A indicação é validada e a recompensa aparece na sua conta.</span></li>
        </ol>
        <p className="muted" style={{ marginTop: 20, maxWidth: 640 }}>Autoindicações e cadastros com dados coincidentes com os do afiliado não são válidos. Prazo de validação: {s?.referral_validation_days} dias.</p>
      </div></section>
    </SiteLayout>
  );
}

export function NotFound() {
  return <SiteLayout><div className="wrap page"><Empty title="Página não encontrada" text="O endereço pode ter mudado." action={<Link to="/" className="btn btn-primary btn-md">Voltar ao início</Link>} /></div></SiteLayout>;
}

export function BrandSplash() { return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: 'var(--black)', color: 'var(--paper)' }}><Logo /></div>; }
