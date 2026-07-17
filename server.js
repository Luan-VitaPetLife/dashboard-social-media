import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initStore, getLastSync } from './src/store.js';
import { runSync } from './src/sync.js';
import { computeSocialDashboard } from './src/metrics.js';
import { probeInsights } from './src/meta.js';
import { backfillSocialHistory } from './src/backfill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// Seguidores/curtidas não mudam minuto a minuto — padrão 12h (bem mais espaçado que os 15min
// do live-dashboard, que sincroniza pedidos).
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 720);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

app.get('/api/dashboard', (req, res) => {
  const until = req.query.until || todayISO();
  const since = req.query.since || isoDaysAgo(29);
  res.json({ ...computeSocialDashboard({ since, until }), lastSync: getLastSync() });
});

app.post('/api/sync', async (req, res) => {
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: resposta crua dos endpoints de Insights (Instagram + Facebook), sem
// processar nada. Ver src/meta.js (probeInsights) — roda antes de confiar no backfill.
app.get('/api/meta/probe-insights', async (req, res) => {
  const market = req.query.market === 'us' ? 'us' : 'br';
  try { res.json(await probeInsights(market)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Preenche dias anteriores ao início do sync via Insights API (nunca sobrescreve snapshot
// real). Sem ?market, roda BR e US. Ver src/backfill.js.
app.post('/api/social/backfill', async (req, res) => {
  const market = req.query.market;
  try {
    const markets = market === 'us' || market === 'br' ? [market] : ['br', 'us'];
    const results = [];
    for (const m of markets) results.push(await backfillSocialHistory({ market: m }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let syncInFlight = false;
async function scheduledSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const r = await runSync();
    if (r.errors.length) console.warn('Sync com avisos:', r.errors);
  } catch (e) {
    console.error('Sync falhou:', e.message);
  } finally {
    syncInFlight = false;
  }
}

await initStore();
app.listen(PORT, async () => {
  console.log(`dashboard-social-media rodando em http://localhost:${PORT}`);
  await scheduledSync();
  setInterval(scheduledSync, SYNC_INTERVAL_MINUTES * 60 * 1000);
});
