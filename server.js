import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initStore, getLastSync, getSnapshots, getStoreBackend } from './src/store.js';
import { runSync } from './src/sync.js';
import { computeSocialDashboard } from './src/metrics.js';
import { computeContentDashboard } from './src/contentMetrics.js';
import { computeGoalsDashboard } from './src/goals.js';
import { computeStoriesDashboard } from './src/storyMetrics.js';
import { runStorySync } from './src/storySync.js';
import { computeCofrinhoDashboard } from './src/cofrinho.js';
import { probeInsights, probeEngagement } from './src/meta.js';
import { backfillSocialHistory } from './src/backfill.js';
import { getRegistryTree, getDefaultBrandId, getBrands, getCountries, getAccounts } from './src/registry.js';
import { setContentContext, addGoal, addCofrinhoEntry, addCofrinhoGoal } from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// Seguidores/curtidas não mudam minuto a minuto — padrão 12h (bem mais espaçado que os 15min
// do live-dashboard, que sincroniza pedidos).
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 720);
// Stories vivem só 24h e somem de /{ig-id}/stories assim que expiram — o ciclo de 12h do sync
// normal deixaria muitos passarem batido. Agendador próprio, bem mais frequente, só pra isso.
const STORY_SYNC_INTERVAL_MINUTES = Number(process.env.STORY_SYNC_INTERVAL_MINUTES || 120);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Árvore empresa → marca → país → plataformas (sem credenciais) — o front monta os seletores
// de Marca e País a partir daqui, sem hardcoded "Coco and Luna"/"Brasil"/"Estados Unidos".
app.get('/api/registry', (req, res) => res.json(getRegistryTree()));

// Diagnóstico: confirma qual backend de armazenamento está ativo (mongodb ou json local) e
// quantos snapshots existem por conta — sem precisar vasculhar log do Railway/Atlas.
app.get('/api/status', (req, res) => {
  const snapshotCounts = {};
  for (const brand of getBrands()) {
    snapshotCounts[brand.id] = {};
    for (const country of brand.countries) {
      snapshotCounts[brand.id][country.id] = {};
      for (const account of country.accounts) {
        snapshotCounts[brand.id][country.id][account.platform] = Object.keys(getSnapshots(brand.id, account.platform, country.id)).length;
      }
    }
  }
  res.json({
    storeBackend: getStoreBackend(),
    lastSync: getLastSync(),
    snapshotCounts,
  });
});

function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

app.get('/api/dashboard', async (req, res) => {
  const until = req.query.until || todayISO();
  const since = req.query.since || isoDaysAgo(29);
  // cmpSince/cmpUntil (opcionais): período de comparação escolhido manualmente no card de
  // Comparação — ausentes, cai no automático (período anterior de mesmo tamanho).
  const cmpSince = req.query.cmpSince || undefined;
  const cmpUntil = req.query.cmpUntil || undefined;
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json({ ...(await computeSocialDashboard({ brandId, country, since, until, cmpSince, cmpUntil })), lastSync: getLastSync() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/content', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(await computeContentDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Salva um campo de contexto por vez (o front dispara isso no blur de cada input) — só os
// campos realmente presentes no body entram no merge. Usar destructuring com fallback pra
// undefined aqui apagaria os campos que não vieram nesse PATCH específico.
const CONTEXT_FIELDS = ['tema', 'objetivo', 'pilar', 'produto', 'gancho', 'cta', 'observacao', 'formato', 'horario'];
app.patch('/api/content/:mediaId/context', (req, res) => {
  const { mediaId } = req.params;
  const brandId = req.body.brandId || getDefaultBrandId();
  const countryId = req.body.countryId;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  const context = {};
  for (const key of CONTEXT_FIELDS) if (key in req.body) context[key] = req.body[key];
  try {
    const updated = setContentContext(brandId, countryId, mediaId, context);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/goals', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeGoalsDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/goals', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, platform, target, deadline } = req.body;
  if (!countryId || !platform) return res.status(400).json({ error: 'countryId e platform são obrigatórios.' });
  const targetNum = Number(target);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'target precisa ser um número positivo.' });
  if (!deadline || Number.isNaN(Date.parse(deadline))) return res.status(400).json({ error: 'deadline precisa ser uma data válida.' });
  const exists = getAccounts(brandId, countryId).some(a => a.platform === platform);
  if (!exists) return res.status(400).json({ error: 'Não existe conta configurada para essa marca/país/plataforma.' });
  try {
    const goal = addGoal(brandId, countryId, platform, { metric: 'followers', target: targetNum, deadline });
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stories', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeStoriesDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cofrinho', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeCofrinhoDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cofrinho/entries', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, period, cupom, usos, vendas, faturamento, observacao } = req.body;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  const usosNum = Number(usos), vendasNum = Number(vendas);
  if (!Number.isFinite(usosNum) || usosNum < 0) return res.status(400).json({ error: 'usos precisa ser um número válido.' });
  if (!Number.isFinite(vendasNum) || vendasNum < 0) return res.status(400).json({ error: 'vendas precisa ser um número válido.' });
  let faturamentoNum = null;
  if (faturamento !== undefined && faturamento !== null && faturamento !== '') {
    faturamentoNum = Number(faturamento);
    if (!Number.isFinite(faturamentoNum) || faturamentoNum < 0) return res.status(400).json({ error: 'faturamento precisa ser um número válido.' });
  }
  try {
    const entry = addCofrinhoEntry(brandId, countryId, {
      period: period || null, cupom: cupom || null,
      usos: usosNum, vendas: vendasNum, faturamento: faturamentoNum,
      observacao: observacao || null,
    });
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cofrinho/goals', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, metric, target, deadline } = req.body;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  if (!['vendas', 'faturamento'].includes(metric)) return res.status(400).json({ error: 'metric precisa ser "vendas" ou "faturamento".' });
  const targetNum = Number(target);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'target precisa ser um número positivo.' });
  if (!deadline || Number.isNaN(Date.parse(deadline))) return res.status(400).json({ error: 'deadline precisa ser uma data válida.' });
  try {
    const goal = addCofrinhoGoal(brandId, countryId, { metric, target: targetNum, deadline });
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: resposta crua dos endpoints de Insights (Instagram + Facebook), sem
// processar nada. Ver src/meta.js (probeInsights) — roda antes de confiar no backfill.
app.get('/api/meta/probe-insights', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country || 'br';
  try { res.json(await probeInsights(brandId, countryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: testa candidatos de métrica pra visualizações de vídeo + curtidas/comentários
// somados no período (Instagram e Facebook), um de cada vez. Ver src/meta.js probeEngagement.
app.get('/api/meta/probe-engagement', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country || 'br';
  try { res.json(await probeEngagement(brandId, countryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Preenche dias anteriores ao início do sync via Insights API (nunca sobrescreve snapshot
// real). Sem ?country, roda todos os países da marca. Ver src/backfill.js.
app.post('/api/social/backfill', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country;
  try {
    const countries = countryId ? [countryId] : getCountries(brandId).map(c => c.id);
    const results = [];
    for (const c of countries) results.push(await backfillSocialHistory({ brandId, countryId: c }));
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

let storySyncInFlight = false;
async function scheduledStorySync() {
  if (storySyncInFlight) return;
  storySyncInFlight = true;
  try {
    const r = await runStorySync();
    if (r.errors.length) console.warn('Story sync com avisos:', r.errors);
  } catch (e) {
    console.error('Story sync falhou:', e.message);
  } finally {
    storySyncInFlight = false;
  }
}

await initStore();
app.listen(PORT, async () => {
  console.log(`dashboard-social-media rodando em http://localhost:${PORT}`);
  await scheduledSync();
  setInterval(scheduledSync, SYNC_INTERVAL_MINUTES * 60 * 1000);
  setInterval(scheduledStorySync, STORY_SYNC_INTERVAL_MINUTES * 60 * 1000);
});
