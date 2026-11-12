'use client';
import React, { useState } from 'react';
import { Link, money, duration, WEEKDAYS, whatsappLink, useAuth, navigate, usePath } from '../lib/core';
import { Logo, Diamond, Stars, Icon, Button, Empty, Loading, ErrorBox, useToast } from '../lib/ui';
import { useSite, useCart, Hours } from './data';
import { InstallBanner, InstallLink, useInstall } from '../lib/install';

// ------------------------------------------------------------------ Estrutura do site
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { session, access } = useAuth();
  const { count } = useCart();
  const path = usePath();
  const links = [['/#sobre', 'Sobre nós'], ['/#servicos', 'Serviços'], ['/#profissionais', 'Profissionais'], ['/loja', 'Produtos'], ['/#planos', 'Planos'], ['/#contato', 'Contato']];
  const panel = access?.is_staff ? (access.roles.includes('barbeiro') && access.roles.length === 2 && !access.is_owner ? '/barbeiro' : '/admin') : '/conta';
  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" aria-label="MR.LUDER — início" onClick={() => setOpen(false)}><Logo /></Link>
        <nav className={`site-nav ${open ? 'open' : ''}`} aria-label="Principal">
          <Link to="/" aria-current={path === '/' ? 'page' : undefined} onClick={() => setOpen(false)}>Início</Link>
          {links.map(([to, label]) => <Link key={to} to={to} aria-current={path === to ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link to="/carrinho" className="icon-btn" aria-label={`Carrinho, ${count} itens`}><Icon name="bag" />{count > 0 && <span className="cart-count">{count}</span>}</Link>
          <Link to={session ? panel : '/entrar'} className="icon-btn" aria-label={session ? 'Minha conta' : 'Entrar'}><Icon name="user" /></Link>
          <Link to="/agendar" className="btn btn-light btn-md hide-sm">Agendar horário</Link>
          <button className="icon-btn menu-toggle" aria-expanded={open} aria-label="Abrir menu" onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'menu'} /></button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { site } = useSite();
  const s = site?.settings || {};
  const { canInstall } = useInstall();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>{s.address}</p>
        </div>
        <div className="footer-nav">
          <h4>A barbearia</h4>
          <ul><li><Link to="/#sobre">Sobre nós</Link></li><li><Link to="/#servicos">Serviços</Link></li><li><Link to="/#profissionais">Profissionais</Link></li><li><Link to="/#galeria">Galeria</Link></li></ul>
        </div>
        <div className="footer-nav">
          <h4>Para você</h4>
          <ul><li><Link to="/agendar">Agendar horário</Link></li><li><Link to="/loja">Produtos</Link></li><li><Link to="/#planos">Planos</Link></li>{s.referral_enabled && <li><Link to="/club">MR.LUDER Club</Link></li>}<li><Link to="/conta">Minha conta</Link></li></ul>
        </div>
        <div className="footer-contact">
          <h4>Contato</h4>
          <ul>
            {s.whatsapp && <li><a href={whatsappLink(s.whatsapp)} target="_blank" rel="noreferrer">WhatsApp {s.phone}</a></li>}
            {s.instagram_url && <li><a href={s.instagram_url} target="_blank" rel="noreferrer">Instagram</a></li>}
            <li><Link to="/privacidade">Política de privacidade</Link></li>
            <li><Link to="/termos">Termos de uso</Link></li>
            <li><Link to="/meus-dados">Privacidade e meus dados</Link></li>
            {canInstall && <li><InstallLink /></li>}
          </ul>
        </div>
      </div>
      <div className="wrap footer-base">
        <span>© {new Date().getFullYear()} MR.LUDER Barbearia · Guarulhos, SP</span>
        <Link to="/admin">Acesso da equipe</Link>
      </div>
    </footer>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (<><a href="#conteudo" className="sr-only">Pular para o conteúdo</a><InstallBanner /><SiteHeader /><main id="conteudo">{children}</main><SiteFooter /><MobileCta /></>);
}

/** Celular: "Agendar" e WhatsApp sempre ao alcance do polegar nas páginas de navegação do site. */
const CTA_HIDDEN = ['/agendar', '/entrar', '/cadastro', '/recuperar-senha', '/alterar-senha', '/carrinho', '/conta'];
function MobileCta() {
  const { site } = useSite();
  const path = usePath();
  if (CTA_HIDDEN.some((p) => path.startsWith(p))) return null;
  const wa = site?.settings?.whatsapp;
  return (<>
    <div className="mobile-cta-space" aria-hidden="true" />
    <div className="mobile-cta" role="region" aria-label="Agendar">
      <Link to="/agendar" className="btn btn-primary btn-lg"><Icon name="calendar" size={18} /> Agendar horário</Link>
      {wa && <a className="btn btn-lg mobile-cta-wa" href={whatsappLink(wa)} target="_blank" rel="noreferrer" aria-label="Falar no WhatsApp"><Icon name="whatsapp" size={20} /></a>}
    </div>
  </>);
}

// ------------------------------------------------------------------ Página inicial
export function Home() {
  const { site, error, reload } = useSite();
  if (error) return <SiteLayout><div className="wrap page"><ErrorBox error={error} onRetry={reload} /></div></SiteLayout>;
  if (!site) return <SiteLayout><Loading /></SiteLayout>;
  return (
    <SiteLayout>
      <Hero />
      <About />
      <Services />
      <Team />
      <Gallery />
      <Reviews />
      <Products />
      <Plans />
      <Contact />
    </SiteLayout>
  );
}

function Hero() {
  const { site } = useSite();
  const s = site!.settings;
  const raw: string = s.hero_title || 'Mais que um corte. Uma experiência.';
  // Com a fonte serifada o título fica mais elegante em caixa normal: "MAIS QUE UM CORTE." vira "Mais que um corte."
  const title = raw === raw.toLocaleUpperCase('pt-BR')
    ? raw.toLocaleLowerCase('pt-BR').replace(/(^|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('pt-BR')).replace(/mr\.?\s?luder/gi, 'MR.LUDER')
    : raw;
  // Quebra o título nas frases para a revelação linha a linha
  const parts = title.split(/(?<=\.)\s+/).flatMap((p) => (p.length > 16 && !/experi/i.test(p) ? p.replace(/^(\S+\s+\S+)\s+/, '$1\n').split('\n') : [p]));
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-grid">
        <div>
          <h1 id="hero-title">{parts.map((p, i) => <span className="line" key={i}><span>{p}</span></span>)}</h1>
          <p className="hero-sub">{s.hero_subtitle}</p>
          <div className="hero-actions">
            <Link to="/agendar" className="btn btn-light btn-lg">Agendar horário</Link>
            <Link to="/#sobre" className="btn btn-line btn-lg">Conheça a MR.LUDER</Link>
          </div>
        </div>
        <figure className="hero-frame">
          <img src={s.hero_image_url || '/img/salao.jpg'} alt="Salão da MR.LUDER com plantas pendentes, luz quente e cadeiras de couro" />
          <figcaption><Diamond /> Av. Emílio Ribas, Vila Tijuco</figcaption>
        </figure>
      </div>
      <div className="hero-strip">
        <div className="wrap">
          {s.rating_value && (
            <a href="#avaliacoes"><Stars value={Number(s.rating_value)} size={15} /><strong>{String(s.rating_value).replace('.', ',')}</strong> com {s.rating_count} avaliações no Google</a>
          )}
          <a href={s.maps_url} target="_blank" rel="noreferrer"><Icon name="pin" size={16} /> Guarulhos · SP</a>
          {s.whatsapp && <a href={whatsappLink(s.whatsapp)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={16} /> {s.phone}</a>}
          <span><Icon name="coffee" size={16} /> Música, café, água e cerveja gelada</span>
        </div>
      </div>
    </section>
  );
}

function About() {
  const { site } = useSite();
  const s = site!.settings;
  return (
    <section className="section" id="sobre" aria-labelledby="sobre-title">
      <div className="wrap about-grid">
        <div className="about-photos">
          <img src="/img/bancada.jpg" alt="Bancada de trabalho organizada com tesouras, pentes e borrifador" loading="lazy" />
          <img src="/img/salao.jpg" alt="" loading="lazy" />
        </div>
        <div className="about-text">
          <div className="marker" style={{ color: 'var(--moss)' }}>Sobre nós</div>
          <h2 id="sobre-title">{s.about_title}</h2>
          <p>{s.about_text}</p>
          {Array.isArray(s.about_highlights) && s.about_highlights.length > 0 && (
            <ul className="highlights">
              {s.about_highlights.map((h: { title: string; text: string }, i: number) => (
                <li key={i}><strong><Diamond />{h.title}</strong><span>{h.text}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Services() {
  const { site } = useSite();
  const [cat, setCat] = useState<string | null>(null);
  const services = site!.services.filter((s) => !cat || s.category_id === cat);
  const barberName = (id: string) => site!.barbers.find((b) => b.id === id)?.name;
  return (
    <section className="section dark" id="servicos" aria-labelledby="servicos-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker">Serviços</div><h2 id="servicos-title">Tabela da casa</h2></div>
          <p>Preço e tempo de cada atendimento, com os profissionais que realizam. Escolha um ou mais serviços e reserve em poucos passos.</p>
        </div>
        {site!.categories.length > 1 && (
          <div className="price-cats" role="group" aria-label="Filtrar por categoria">
            <button className="chip" aria-pressed={!cat} onClick={() => setCat(null)}>Todos</button>
            {site!.categories.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
        )}
        {services.length === 0 ? (
          <Empty title="Serviços em cadastro" text="A tabela de serviços está sendo publicada. Enquanto isso, fale com a gente pelo WhatsApp para reservar." />
        ) : (
          <ul className="price-list">
            {services.map((s) => (
              <li className="price-row" key={s.id}>
                {s.photo_url ? <img src={s.photo_url} alt="" loading="lazy" /> : <span className="ph"><Icon name="scissors" size={22} /></span>}
                <div>
                  <div className="price-name"><h3>{s.name}</h3></div>
                  <p className="price-meta">
                    {s.description}{s.description && ' '}
                    {s.barber_ids.length > 0 && <>Com {s.barber_ids.map(barberName).filter(Boolean).join(', ')}.</>}
                  </p>
                </div>
                <div className="price-value">{s.price_is_minimum && <small className="price-from">a partir de</small>}{money(s.price)}<small>{duration(s.duration_minutes)}</small></div>
                {s.bookable_online && s.barber_ids.length > 0
                  ? <Link to={`/agendar?servico=${s.id}`} className="btn btn-line btn-sm">Agendar</Link>
                  : <span className="price-meta">Agende pelo WhatsApp</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Team() {
  const { site } = useSite();
  const svcName = (id: string) => site!.services.find((s) => s.id === id)?.name;
  return (
    <section className="section" id="profissionais" aria-labelledby="prof-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker" style={{ color: 'var(--moss)' }}>Profissionais</div><h2 id="prof-title">Quem cuida de você</h2></div>
          <p>Escolha seu barbeiro na hora de agendar ou deixe que a agenda encontre o primeiro horário livre.</p>
        </div>
        {site!.barbers.length === 0 ? (
          <Empty title="Equipe em apresentação" text="Os perfis dos barbeiros serão publicados aqui em breve." />
        ) : (
          <div className="team-grid">
            {site!.barbers.map((b) => (
              <article className="barber" key={b.id}>
                <div className="barber-photo">{b.photo_url ? <img src={b.photo_url} alt={`Foto de ${b.name}`} loading="lazy" /> : <Icon name="user" size={40} />}</div>
                <h3>{b.name}</h3>
                {b.specialties.length > 0 && <span className="spec">{b.specialties.join(', ')}</span>}
                {b.bio && <p>{b.bio}</p>}
                {b.service_ids.length > 0 && <p>Realiza: {b.service_ids.map(svcName).filter(Boolean).join(', ')}</p>}
                {b.accepts_online_booking && b.service_ids.length > 0
                  ? <Link to={`/agendar?barbeiro=${b.id}`} className="text-link">Ver horários com {b.name.split(' ')[0]}</Link>
                  : <span className="stock-note">Agenda online indisponível</span>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Gallery() {
  const { site } = useSite();
  const [open, setOpen] = useState<string | null>(null);
  const items = site!.gallery.length ? site!.gallery : [
    { id: 'a', image_url: '/img/salao.jpg', caption: 'O salão', category: 'ambiente' },
    { id: 'b', image_url: '/img/bancada.jpg', caption: 'Bancada de trabalho', category: 'ambiente' },
  ];
  return (
    <section className="section black" id="galeria" aria-labelledby="gal-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker">Galeria</div><h2 id="gal-title">O ambiente</h2></div>
          <p>Plantas, luz quente, couro preto e uma bancada sempre em ordem.</p>
        </div>
        <div className="gallery">
          {items.map((g) => (
            <button key={g.id} onClick={() => setOpen(g.image_url)} aria-label={`Ampliar foto${g.caption ? `: ${g.caption}` : ''}`}>
              <img src={g.image_url} alt={g.caption || 'Foto da barbearia'} loading="lazy" />
              {g.caption && <figcaption>{g.caption}</figcaption>}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={() => setOpen(null)}>
          <button className="icon-btn" aria-label="Fechar" onClick={() => setOpen(null)}><Icon name="x" /></button>
          <img src={open} alt="" />
        </div>
      )}
    </section>
  );
}

function Reviews() {
  const { site } = useSite();
  const s = site!.settings;
  return (
    <section className="section dark" id="avaliacoes" aria-labelledby="av-title">
      <div className="wrap reviews-grid">
        <div>
          <div className="marker">Avaliações</div>
          <h2 id="av-title" className="sr-only">Avaliações</h2>
          {s.rating_value ? (
            <>
              <div className="rating-big">{String(s.rating_value).replace('.', ',')}</div>
              <div className="rating-meta">
                <Stars value={Number(s.rating_value)} size={22} />
                <span>{s.rating_count} avaliações no Google</span>
                <span className="rating-source">{s.rating_source}</span>
              </div>
            </>
          ) : <p>Avaliações em atualização.</p>}
        </div>
        <div>
          {site!.testimonials.length === 0 ? (
            <div className="quotes">
              <div className="quote">
                <p>Os depoimentos publicados aqui são enviados por clientes atendidos, pela área do cliente, e passam por moderação.</p>
                <footer><Link to="/conta" className="text-link" style={{ color: 'var(--warm-light)' }}>Já foi atendido? Deixe o seu</Link></footer>
              </div>
            </div>
          ) : (
            <div className="quotes">
              {site!.testimonials.slice(0, 4).map((t) => (
                <blockquote className="quote" key={t.id} style={{ margin: 0 }}>
                  <p>“{t.content}”</p>
                  <footer><Stars value={t.rating} size={13} /> {t.author}</footer>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ProductCard({ p }: { p: { id: string; name: string; description: string | null; photo_url: string | null; price: number; available: boolean; track_stock: boolean; stock: number | null } }) {
  const { add } = useCart();
  const toast = useToast();
  return (
    <article className="product">
      <div className="product-photo">{p.photo_url ? <img src={p.photo_url} alt={p.name} loading="lazy" /> : <Icon name="box" size={36} />}</div>
      <h3>{p.name}</h3>
      {p.description && <p>{p.description}</p>}
      <div className="product-foot">
        <span className="product-price">{money(p.price)}</span>
        <Button size="sm" variant={p.available ? 'primary' : 'line'} disabled={!p.available} onClick={() => { add(p.id); toast.ok(`${p.name} no carrinho`); }}>
          {p.available ? 'Comprar' : 'Esgotado'}
        </Button>
      </div>
      {p.track_stock && p.available && p.stock !== null && p.stock <= 3 && <span className="stock-note low">Últimas {p.stock} unidades</span>}
    </article>
  );
}

function Products() {
  const { site } = useSite();
  if (site!.products.length === 0) return null;
  return (
    <section className="section" id="produtos" aria-labelledby="prod-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker" style={{ color: 'var(--moss)' }}>Produtos</div><h2 id="prod-title">Para levar para casa</h2></div>
          <p>Os mesmos produtos usados na cadeira. Compre online e retire na barbearia{site!.settings.delivery_enabled ? ' ou receba em casa' : ''}.</p>
        </div>
        <div className="product-grid">{site!.products.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} />)}</div>
        {site!.products.length > 8 && <div style={{ marginTop: 32 }}><Link to="/loja" className="btn btn-line btn-md">Ver todos os produtos</Link></div>}
      </div>
    </section>
  );
}

export function PlanList() {
  const { site } = useSite();
  const { session } = useAuth();
  return (
    <div className="plans">
      {site!.plans.map((p) => (
        <article className="plan" key={p.id}>
          <h3>{p.name}</h3>
          <div className="plan-price">{money(p.price)}<small>/{p.period_months === 1 ? 'mês' : `${p.period_months} meses`}</small></div>
          {p.description && <p>{p.description}</p>}
          <ul>
            {p.benefits.map((b, i) => <li key={i}><Icon name="check" size={16} />{b.description}{b.quantity ? ` (${b.quantity}× no período)` : b.service_id ? ' (ilimitado)' : ''}</li>)}
            {Number(p.product_discount_percent) > 0 && <li><Icon name="check" size={16} />{Number(p.product_discount_percent)}% de desconto em produtos</li>}
          </ul>
          {p.usage_rules && <details><summary>Regras de utilização</summary><p>{p.usage_rules}</p></details>}
          {p.contract_conditions && <details><summary>Condições de contratação</summary><p>{p.contract_conditions}</p></details>}
          <Button variant="light" size="lg" disabled={p.sold_out} onClick={() => navigate(session ? `/conta?aba=planos&assinar=${p.id}` : `/entrar?voltar=${encodeURIComponent(`/conta?aba=planos&assinar=${p.id}`)}`)}>
            {p.sold_out ? 'Vagas esgotadas' : 'Assinar agora'}
          </Button>
        </article>
      ))}
    </div>
  );
}

function Plans() {
  const { site } = useSite();
  return (
    <section className="section black" id="planos" aria-labelledby="planos-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker">Planos</div><h2 id="planos-title">Assinatura MR.LUDER</h2></div>
          <p>Mantenha o visual em dia com um valor mensal fixo. Você acompanha as utilizações e a validade pela sua conta.</p>
        </div>
        {site!.plans.length === 0 ? <Empty title="Planos em breve" text="Os planos mensais estão sendo preparados. Fale com a gente para saber mais." /> : <PlanList />}
      </div>
    </section>
  );
}

export function HoursTable({ hours }: { hours: Hours[] }) {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  const todayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(today);
  const anyOpen = hours.some((h) => h.is_open);
  if (!anyOpen) return <p className="muted">Horários de funcionamento em atualização. Fechamos às 20h; confirme o dia pelo WhatsApp.</p>;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <table className="hours-table"><tbody>
      {order.map((d) => { const h = hours.find((x) => x.weekday === d)!; return (
        <tr key={d} className={d === todayIdx ? 'today' : ''}><td>{WEEKDAYS[d]}{d === todayIdx ? ' (hoje)' : ''}</td><td>{h?.is_open ? `${h.opens_at!.slice(0, 5)} – ${h.closes_at!.slice(0, 5)}` : 'Fechado'}</td></tr>
      ); })}
    </tbody></table>
  );
}

function Contact() {
  const { site } = useSite();
  const s = site!.settings;
  return (
    <section className="section" id="contato" aria-labelledby="contato-title">
      <div className="wrap">
        <div className="section-head">
          <div><div className="marker" style={{ color: 'var(--moss)' }}>Localização e contato</div><h2 id="contato-title">Venha tomar um café</h2></div>
        </div>
        <div className="contact-grid">
          <div>
            <ul className="contact-list">
              <li><Icon name="pin" /><div><strong>Endereço</strong><a href={s.maps_url} target="_blank" rel="noreferrer">{s.address}</a></div></li>
              <li><Icon name="phone" /><div><strong>Telefone</strong><a href={`tel:+55${(s.phone || '').replace(/\D/g, '')}`}>{s.phone}</a></div></li>
              {s.whatsapp && <li><Icon name="whatsapp" /><div><strong>WhatsApp</strong><a href={whatsappLink(s.whatsapp, 'Olá! Vim pelo site da MR.LUDER.')} target="_blank" rel="noreferrer">{s.phone}</a></div></li>}
              {s.instagram_url && <li><Icon name="instagram" /><div><strong>Instagram</strong><a href={s.instagram_url} target="_blank" rel="noreferrer">{s.instagram_url.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '')}</a></div></li>}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
              <a className="btn btn-primary btn-md" href={s.maps_url} target="_blank" rel="noreferrer">Abrir rota no mapa</a>
              <Link to="/agendar" className="btn btn-line btn-md">Agendar horário</Link>
            </div>
            <div className="facade"><img src="/img/fachada.jpg" alt="Fachada da MR.LUDER com toldo listrado" /><p className="muted">Procure o toldo listrado e a placa preta com o logotipo MR. LUDER.</p></div>
          </div>
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 12 }}>Horário de funcionamento</h3>
            <HoursTable hours={site!.hours} />
          </div>
        </div>
      </div>
    </section>
  );
}
