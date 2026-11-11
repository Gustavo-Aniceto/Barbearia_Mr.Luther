// Auditoria de usabilidade no celular (ambiente de TESTES). Abre cada tela como cliente, barbeiro e dono
// num iPhone (390×844, toque) e num Android pequeno (360×740) e mede:
//  - rolagem lateral (página mais larga que a tela) e quem está vazando;
//  - alvos de toque menores que 40 px (botões, links de navegação, campos);
//  - campos com fonte < 16 px (o iPhone dá zoom ao tocar);
//  - textos com fonte < 12 px.
// Gera /tmp/shots/m-*.jpg e /tmp/shots/audit.json.
// Uso: BASE_URL=... OWNER_EMAIL/OWNER_PASS BARBER_EMAIL/BARBER_PASS CLIENT_EMAIL/CLIENT_PASS node tests/e2e/mobile-audit.mjs
import fs from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SHOTS || '/tmp/shots'; fs.mkdirSync(OUT, { recursive: true });
const PAGES = {
  publico: ['/', '/agendar', '/loja', '/club', '/entrar', '/cadastro', '/termos'],
  cliente: ['/conta', '/conta?aba=pedidos', '/conta?aba=planos', '/conta?aba=club', '/conta?aba=avisos', '/conta?aba=dados', '/conta?aba=privacidade', '/agendar', '/carrinho'],
  barbeiro: ['/barbeiro', '/barbeiro/agenda', '/barbeiro/disponibilidade', '/barbeiro/comissoes', '/barbeiro/historico'],
  dono: ['/admin', '/admin/agenda', '/admin/clientes', '/admin/pedidos', '/admin/servicos', '/admin/equipe', '/admin/produtos', '/admin/planos', '/admin/financeiro', '/admin/club', '/admin/site', '/admin/acessos', '/admin/configuracoes'],
};
const ACC = { cliente: ['CLIENT_EMAIL', 'CLIENT_PASS'], barbeiro: ['BARBER_EMAIL', 'BARBER_PASS'], dono: ['OWNER_EMAIL', 'OWNER_PASS'] };
const VIEWPORTS = { iphone: { ...devices['iPhone 13'] }, android: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 5'].userAgent } };

function measure() {
  const vw = window.innerWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30).replace(/\s+/g, ' ') ? ` "${(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30).replace(/\s+/g, ' ')}"` : '');
  const scrollable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
  const overflow = document.documentElement.scrollWidth - vw;
  const wide = [...document.querySelectorAll('body *')].filter((el) => vis(el) && el.getBoundingClientRect().right > vw + 1 && !scrollable(el))
    .filter((el, _, all) => !all.some((o) => o !== el && o.contains(el))).slice(0, 6).map(name);
  const targets = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio]')].filter(vis)
    .filter((el) => !(el.tagName === 'A' && el.closest('p, li.prose, .legal'))) // links dentro de texto corrido são exceção aceita
    .filter((el) => { const r = el.getBoundingClientRect(); const t = el.matches('input[type=checkbox], input[type=radio]') ? (el.closest('label') || el).getBoundingClientRect() : r; return t.height < 40 || t.width < 40; });
  const zoomInputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter(vis).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16);
  const tiny = [...document.querySelectorAll('body *')].filter((el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12);
  return { overflow, wide, smallTargets: targets.length, smallSamples: targets.slice(0, 8).map((el) => { const r = el.getBoundingClientRect(); return `${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`; }),
    zoomInputs: zoomInputs.length, tinyText: tiny.length, tinySamples: tiny.slice(0, 4).map(name), height: document.documentElement.scrollHeight };
}

const browser = await chromium.launch();
const report = [];
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const [role, paths] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({ ...vp, baseURL: BASE, locale: 'pt-BR' });
    const p = await ctx.newPage();
    if (ACC[role]) {
      await p.goto('/entrar'); await p.locator('input[type=email]').fill(process.env[ACC[role][0]]); await p.locator('input[type=password]').fill(process.env[ACC[role][1]]);
      await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForURL((u) => !u.pathname.startsWith('/entrar'), { timeout: 30000 });
    }
    for (const path of paths) {
      await p.goto(path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(400);
      const m = await p.evaluate(measure);
      const slug = `${vpName}-${role}-${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}`;
      if (vpName === 'iphone') await p.screenshot({ path: `${OUT}/m-${slug}.jpg`, type: 'jpeg', quality: 60 });
      report.push({ vp: vpName, role, path, ...m });
      console.log(`${m.overflow > 1 ? 'VAZA ' + m.overflow + 'px' : 'ok'}\t${vpName}\t${role}\t${path}\talvos<40:${m.smallTargets}\tzoom:${m.zoomInputs}\tmiudo:${m.tinyText}`);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.overflow > 1 || r.zoomInputs > 0);
console.log(`\nTelas: ${report.length} · com rolagem lateral: ${report.filter((r) => r.overflow > 1).length} · com zoom de campo: ${report.filter((r) => r.zoomInputs).length} · alvos pequenos (total): ${report.reduce((a, r) => a + r.smallTargets, 0)}`);
process.exit(bad.length ? 1 : 0);
