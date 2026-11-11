// Mede latência (p50/p95) das rotas mais usadas. Uso: node tests/perf/latency.mjs <url> [rodadas]
const base = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3] || 25);
const post = (body) => fetch(`${base}/api/data`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
const day = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

async function measure(name, fn) {
  await fn(); // aquecimento
  const t = [];
  for (let i = 0; i < N; i++) { const s = performance.now(); const r = await fn(); await r.arrayBuffer(); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  const p = (q) => t[Math.min(t.length - 1, Math.floor(q * t.length))].toFixed(0);
  return { rota: name, p50_ms: Number(p(0.5)), p95_ms: Number(p(0.95)), max_ms: Number(t[t.length - 1].toFixed(0)) };
}

const svc = await (await post({ op: 'rpc', fn: 'public_site' })).json();
const ids = (svc.data?.services || []).slice(0, 1).map((s) => s.id);
const rows = [];
rows.push(await measure('GET /api/health', () => fetch(`${base}/api/health`)));
rows.push(await measure('GET / (HTML)', () => fetch(`${base}/`)));
rows.push(await measure('public_site (conteúdo do site)', () => post({ op: 'rpc', fn: 'public_site' })));
if (ids.length) rows.push(await measure('get_available_slots (horários livres)', () => post({ op: 'rpc', fn: 'get_available_slots', args: { p_date: day, p_service_ids: ids } })));
console.log(JSON.stringify({ base, rodadas: N, resultados: rows }, null, 2));
