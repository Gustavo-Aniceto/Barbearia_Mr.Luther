// Verifica o app instalável (PWA): manifesto, ícones, service worker, tela offline,
// faixa "Instalar" no iPhone com o passo a passo, e que nada disso aparece quando já está instalado.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/pwa.mjs  (precisa de `next start`, o SW só registra em produção)
import fs from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.SHOTS || '/tmp/shots'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok' : 'FALHOU'} - ${msg}`); if (!cond) fails++; };

// 1) Manifesto e arquivos
const html = await (await fetch(BASE + '/')).text();
const href = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
ok(!!href, `página aponta para o manifesto (${href})`);
const man = await (await fetch(BASE + (href || '/manifest.webmanifest'))).json();
ok(man.display === 'standalone' && man.start_url && man.name === 'MR.LUDER Barbearia', 'manifesto: nome, tela cheia e endereço inicial');
const sizes = man.icons.map((i) => i.sizes);
ok(sizes.includes('192x192') && sizes.includes('512x512') && man.icons.some((i) => i.purpose === 'maskable'), 'manifesto: ícones 192, 512 e adaptável (Android)');
for (const u of [...man.icons.map((i) => i.src), '/app/apple-touch-icon.png', '/sw.js', '/offline.html']) {
  const r = await fetch(BASE + u);
  ok(r.ok, `${u} responde ${r.status}${u.endsWith('.js') ? ' (' + r.headers.get('content-type') + ')' : ''}`);
}
ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable|mobile-web-app-capable/.test(html), 'iPhone: ícone e modo tela cheia declarados');

const browser = await chromium.launch();

// 2) Android/Chrome: service worker ativo e tela offline
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const sw = await page.evaluate(async () => { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), 8000))]); return r ? r.active?.scriptURL : null; });
  ok(!!sw && sw.endsWith('/sw.js'), 'service worker instalado e ativo');
  await page.reload({ waitUntil: 'networkidle' });
  await ctx.setOffline(true);
  await page.goto(BASE + '/agendar').catch(() => {});
  const txt = await page.textContent('body').catch(() => '');
  ok(/sem internet/i.test(txt || ''), 'sem internet: mostra a tela "Você está sem internet" com o WhatsApp');
  ok(await page.evaluate(() => { const i = document.querySelector('img'); return !!i && i.complete && i.naturalWidth > 0; }), 'sem internet: ícone da barbearia aparece');
  await page.screenshot({ path: `${OUT}/pwa-offline.jpg`, type: 'jpeg', quality: 70 });
  await ctx.setOffline(false);
  // Simula o instalador do Chrome: a faixa aparece e o botão chama o instalador nativo
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.waitForSelector('.install-banner', { timeout: 4000 }).catch(() => {});
  ok(await page.isVisible('.install-banner'), 'Android: faixa "Instalar" aparece quando o Chrome oferece a instalação');
  await page.screenshot({ path: `${OUT}/pwa-android-banner.jpg`, type: 'jpeg', quality: 70 });
  await page.click('.install-banner .btn');
  ok(await page.evaluate(() => window.__prompted === true), 'Android: tocar em "Instalar" abre o instalador nativo');
  await page.waitForTimeout(300);
  ok(!(await page.isVisible('.install-banner')), 'Android: depois de aceitar, a faixa some');
  await ctx.close();
}

// 3) iPhone (Safari): faixa + passo a passo; dispensar some para sempre
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok(await page.isVisible('.install-banner'), 'iPhone: faixa "Instalar" aparece no topo');
  await page.screenshot({ path: `${OUT}/pwa-ios-banner.jpg`, type: 'jpeg', quality: 70 });
  await page.click('.install-banner .btn');
  await page.waitForTimeout(500);
  ok(await page.isVisible('.install-sheet'), 'iPhone: "Instalar" abre o passo a passo (Compartilhar → Adicionar à Tela de Início)');
  await page.screenshot({ path: `${OUT}/pwa-ios-sheet.jpg`, type: 'jpeg', quality: 70 });
  await page.click('.install-sheet .btn');
  ok(!(await page.isVisible('.install-sheet')), 'iPhone: "Entendi" fecha o passo a passo');
  ok(await page.isVisible('.site-footer .install-link'), 'iPhone: rodapé tem "Instalar o app no celular"');
  await page.click('.install-banner .icon-btn');
  await page.reload({ waitUntil: 'networkidle' });
  ok(!(await page.isVisible('.install-banner')), 'iPhone: "Agora não" esconde a faixa nas próximas visitas');
  await ctx.close();
}

// 4) Já instalado (aberto pela tela inicial): nada de "Instalar"
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?origem=app', { waitUntil: 'networkidle' });
  ok(!(await page.isVisible('.install-banner')) && !(await page.isVisible('.install-link')), 'aberto como app: não oferece instalar de novo');
  await page.screenshot({ path: `${OUT}/pwa-standalone.jpg`, type: 'jpeg', quality: 70 });
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n✖ ${fails} verificação(ões) falharam.` : '\n✔ App instalável verificado.');
process.exit(fails ? 1 : 0);
