// store.js — armazenamento híbrido: MongoDB Atlas se MONGODB_URI existir, senão JSON local
// em data/db.json. MongoDB em vez de Postgres do Railway porque o tier grátis do Atlas (M0,
// 512MB) é de outro provedor — fica fora do orçamento medido do Railway inteiramente, ao
// contrário de um Volume/Postgres do Railway (que, mesmo baratos, ainda somam no teto de uso).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const USE_MONGO = Boolean(process.env.MONGODB_URI);

const EMPTY = { snapshots: {}, lastSync: null };
let cache = null;
let mongoCollection = null;

function loadJson() {
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    cache = structuredClone(EMPTY);
  }
}

function saveJson() {
  if (USE_MONGO) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
}

async function mongoSet(key, value) {
  if (!USE_MONGO) return;
  await mongoCollection.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
}

// Formato antigo (pré-fundação multimarca): snapshots[platform][market][date]. Formato novo:
// snapshots[brandId][platform][countryId][date]. Detecta o formato antigo pela presença das
// chaves de plataforma direto na raiz de `snapshots` e reembrulha tudo sob a única marca que
// existia até então — roda uma vez (idempotente), nunca descarta dado.
const LEGACY_PLATFORMS = ['instagram', 'facebook'];
const LEGACY_BRAND_ID = 'coco-and-luna';

function migrateLegacySnapshotsIfNeeded() {
  const snaps = cache.snapshots || {};
  const isLegacy = LEGACY_PLATFORMS.some(p => snaps[p] && typeof snaps[p] === 'object');
  if (!isLegacy) return false;

  const migrated = { [LEGACY_BRAND_ID]: {} };
  for (const platform of LEGACY_PLATFORMS) {
    if (snaps[platform]) migrated[LEGACY_BRAND_ID][platform] = snaps[platform];
  }
  for (const key of Object.keys(snaps)) {
    if (!LEGACY_PLATFORMS.includes(key)) migrated[key] = snaps[key]; // preserva chaves já no formato novo, se houver
  }
  cache.snapshots = migrated;
  return true;
}

export async function initStore() {
  if (USE_MONGO) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    mongoCollection = client.db(process.env.MONGODB_DB || 'dashboard_social').collection('kv');
    const docs = await mongoCollection.find({}).toArray();
    cache = structuredClone(EMPTY);
    for (const d of docs) cache[d._id] = d.value;
    console.log('Store: MongoDB');
  } else {
    loadJson();
    console.log('Store: JSON local');
  }

  if (migrateLegacySnapshotsIfNeeded()) {
    console.log('Store: snapshots do formato antigo migrados para o formato multimarca (brandId=' + LEGACY_BRAND_ID + ').');
    saveJson();
    await mongoSet('snapshots', cache.snapshots);
  }
}

// Diagnóstico: qual backend está realmente ativo — usado por GET /api/status pra confirmar
// se o MONGODB_URI foi lido e a conexão foi aberta, sem precisar vasculhar log do Railway.
export function getStoreBackend() {
  return USE_MONGO ? 'mongodb' : 'json';
}

export function getSnapshots(brandId, platform, countryId) {
  return (cache.snapshots || {})[brandId]?.[platform]?.[countryId] || {};
}

// Snapshots dentro de um período, ordenados por data — usado pra montar KPI/série do gráfico.
export function getSnapshotsInRange(brandId, platform, countryId, since, until) {
  const all = getSnapshots(brandId, platform, countryId);
  return Object.entries(all)
    .filter(([d]) => (!since || d >= since) && (!until || d <= until))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function addSnapshot(brandId, platform, countryId, dateISO, data) {
  if (!cache.snapshots) cache.snapshots = {};
  if (!cache.snapshots[brandId]) cache.snapshots[brandId] = {};
  if (!cache.snapshots[brandId][platform]) cache.snapshots[brandId][platform] = {};
  if (!cache.snapshots[brandId][platform][countryId]) cache.snapshots[brandId][platform][countryId] = {};
  cache.snapshots[brandId][platform][countryId][dateISO] = data;
  saveJson();
  mongoSet('snapshots', cache.snapshots);
}

// ── Conteúdo por post (ficha D+7) ───────────────────────────────────────────────────────────
// content[brandId][countryId][mediaId] = { meta, context, snapshots }. `meta` vem da Meta
// (sobrescrito a cada sync); `context` só a equipe edita (sync nunca mexe); `snapshots` é um
// valor por dia, mesmo padrão de `snapshots` de perfil acima.
export function getContentList(brandId, countryId) {
  return (cache.content || {})[brandId]?.[countryId] || {};
}

export function getContentItem(brandId, countryId, mediaId) {
  return getContentList(brandId, countryId)[mediaId] || null;
}

function ensureContentSlot(brandId, countryId, mediaId) {
  if (!cache.content) cache.content = {};
  if (!cache.content[brandId]) cache.content[brandId] = {};
  if (!cache.content[brandId][countryId]) cache.content[brandId][countryId] = {};
  if (!cache.content[brandId][countryId][mediaId]) cache.content[brandId][countryId][mediaId] = { meta: {}, context: {}, snapshots: {} };
  return cache.content[brandId][countryId][mediaId];
}

export function upsertContentMeta(brandId, countryId, mediaId, meta) {
  const slot = ensureContentSlot(brandId, countryId, mediaId);
  slot.meta = meta;
  saveJson();
  mongoSet('content', cache.content);
}

export function addContentSnapshot(brandId, countryId, mediaId, dateISO, data) {
  const slot = ensureContentSlot(brandId, countryId, mediaId);
  slot.snapshots[dateISO] = data;
  saveJson();
  mongoSet('content', cache.content);
}

export function setContentContext(brandId, countryId, mediaId, context) {
  const slot = ensureContentSlot(brandId, countryId, mediaId);
  slot.context = { ...slot.context, ...context };
  saveJson();
  mongoSet('content', cache.content);
  return slot;
}

// Resumo gerado por IA (força/gargalo/recomendação) — só existe quando alguém pede pela tela
// (nunca gerado automaticamente no sync). Sobrescreve o anterior por completo a cada "gerar de
// novo" (não guarda histórico de versões, diferente de goals/cofrinho — aqui não faz sentido
// manter resumo desatualizado).
export function setContentAiSummary(brandId, countryId, mediaId, aiSummary) {
  const slot = ensureContentSlot(brandId, countryId, mediaId);
  slot.aiSummary = aiSummary;
  saveJson();
  mongoSet('content', cache.content);
  return slot;
}

// ── Bateria de crescimento (metas editáveis) ────────────────────────────────────────────────
// goals[brandId][countryId][platform] = [ {id, metric, target, deadline, createdAt}, ... ] em
// ordem de criação — a última é a meta "atual"; as anteriores ficam de histórico (nunca
// apagadas). "Atingida" é calculado ao vivo (comparando com o snapshot mais recente), não
// guardado aqui — não precisa de uma segunda escrita quando a meta é batida.
export function getGoals(brandId, countryId, platform) {
  return (cache.goals || {})[brandId]?.[countryId]?.[platform] || [];
}

export function addGoal(brandId, countryId, platform, goal) {
  if (!cache.goals) cache.goals = {};
  if (!cache.goals[brandId]) cache.goals[brandId] = {};
  if (!cache.goals[brandId][countryId]) cache.goals[brandId][countryId] = {};
  if (!cache.goals[brandId][countryId][platform]) cache.goals[brandId][countryId][platform] = [];
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), ...goal };
  cache.goals[brandId][countryId][platform].push(entry);
  saveJson();
  mongoSet('goals', cache.goals);
  return entry;
}

// ── Stories 24h ──────────────────────────────────────────────────────────────────────────────
// stories[brandId][countryId][storyId] = { meta, samples: [{polledAt, ...métricas}] } — várias
// amostras por story (uma por sincronização enquanto ele estiver ativo), não uma por dia como
// snapshots de perfil/conteúdo, porque a janela de vida de um story é só 24h.
export function getStoriesList(brandId, countryId) {
  return (cache.stories || {})[brandId]?.[countryId] || {};
}

function ensureStorySlot(brandId, countryId, storyId) {
  if (!cache.stories) cache.stories = {};
  if (!cache.stories[brandId]) cache.stories[brandId] = {};
  if (!cache.stories[brandId][countryId]) cache.stories[brandId][countryId] = {};
  if (!cache.stories[brandId][countryId][storyId]) cache.stories[brandId][countryId][storyId] = { meta: {}, samples: [] };
  return cache.stories[brandId][countryId][storyId];
}

export function upsertStoryMeta(brandId, countryId, storyId, meta) {
  const slot = ensureStorySlot(brandId, countryId, storyId);
  slot.meta = meta;
  saveJson();
  mongoSet('stories', cache.stories);
}

export function addStorySample(brandId, countryId, storyId, sample) {
  const slot = ensureStorySlot(brandId, countryId, storyId);
  slot.samples.push(sample);
  saveJson();
  mongoSet('stories', cache.stories);
}

// ── Cofrinho do Social (vendas rastreadas por cupom/link) ──────────────────────────────────
// cofrinho[brandId][countryId] = { entries: [...], goals: [...] }. Tudo entrada manual (o setor
// responsável envia por print/planilha/relatório) — nada disso vem de sync automático.
function ensureCofrinhoSlot(brandId, countryId) {
  if (!cache.cofrinho) cache.cofrinho = {};
  if (!cache.cofrinho[brandId]) cache.cofrinho[brandId] = {};
  if (!cache.cofrinho[brandId][countryId]) cache.cofrinho[brandId][countryId] = { entries: [], goals: [] };
  return cache.cofrinho[brandId][countryId];
}

export function getCofrinhoEntries(brandId, countryId) {
  return (cache.cofrinho || {})[brandId]?.[countryId]?.entries || [];
}

export function addCofrinhoEntry(brandId, countryId, entry) {
  const slot = ensureCofrinhoSlot(brandId, countryId);
  const record = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), ...entry };
  slot.entries.push(record);
  saveJson();
  mongoSet('cofrinho', cache.cofrinho);
  return record;
}

export function getCofrinhoGoals(brandId, countryId) {
  return (cache.cofrinho || {})[brandId]?.[countryId]?.goals || [];
}

export function addCofrinhoGoal(brandId, countryId, goal) {
  const slot = ensureCofrinhoSlot(brandId, countryId);
  const record = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), ...goal };
  slot.goals.push(record);
  saveJson();
  mongoSet('cofrinho', cache.cofrinho);
  return record;
}

export function setLastSync(iso) {
  cache.lastSync = iso;
  saveJson();
  mongoSet('lastSync', iso);
}

export function getLastSync() {
  return cache.lastSync || null;
}

// ── Configurações gerais (hoje só o toggle de login) ────────────────────────────────────────
// Fica de fora do padrão empresa→marca→país porque é uma configuração do app inteiro, não por
// conta/mercado. Guardado com o mesmo mecanismo de cache/saveJson/mongoSet de tudo mais aqui.
const DEFAULT_SETTINGS = { loginEnabled: false };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(cache.settings || {}) };
}

export function updateSettings(patch) {
  cache.settings = { ...getSettings(), ...patch };
  saveJson();
  mongoSet('settings', cache.settings);
  return cache.settings;
}

// ── Chamados (quadro estilo Monday) ─────────────────────────────────────────────────────────
// Um quadro só, geral pra empresa toda — não é por marca/país como snapshots/goals/cofrinho.
// `people` é um cadastro simples (CRUD), sem senha nem login próprio — só um jeito de marcar
// quem pediu, quem é responsável, e assinar comentário. Sem cascata ao apagar uma pessoa: um
// chamado/comentário que referenciava um id apagado simplesmente não resolve mais (o front
// mostra "pessoa removida" em vez de adivinhar quem era).
function ensurePeople() {
  if (!cache.people) cache.people = [];
  return cache.people;
}

export function getPeople() {
  return ensurePeople();
}

export function addPerson(name) {
  const people = ensurePeople();
  const person = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, createdAt: new Date().toISOString() };
  people.push(person);
  saveJson();
  mongoSet('people', cache.people);
  return person;
}

export function updatePerson(id, patch) {
  const person = ensurePeople().find(p => p.id === id);
  if (!person) return null;
  if ('name' in patch) person.name = patch.name;
  saveJson();
  mongoSet('people', cache.people);
  return person;
}

export function deletePerson(id) {
  cache.people = ensurePeople().filter(p => p.id !== id);
  saveJson();
  mongoSet('people', cache.people);
}

function ensureTickets() {
  if (!cache.tickets) cache.tickets = [];
  return cache.tickets;
}

export function getTickets() {
  return ensureTickets();
}

export function addTicket(data) {
  const tickets = ensureTickets();
  const now = new Date().toISOString();
  const ticket = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    titulo: data.titulo,
    descricao: data.descricao || '',
    tipo: data.tipo,
    urgencia: data.urgencia,
    status: data.status || 'aberto',
    responsavelId: data.responsavelId || null,
    criadoPorId: data.criadoPorId || null,
    createdAt: now,
    updatedAt: now,
    comments: [],
  };
  tickets.push(ticket);
  saveJson();
  mongoSet('tickets', cache.tickets);
  return ticket;
}

// Só atualiza as chaves realmente presentes em `patch` (mesmo cuidado do PATCH de contexto de
// conteúdo — nunca fazer destructuring direto do body, senão campo ausente vira `undefined` e
// apaga o que já estava salvo).
export function updateTicket(id, patch) {
  const ticket = ensureTickets().find(t => t.id === id);
  if (!ticket) return null;
  for (const key of ['titulo', 'descricao', 'tipo', 'urgencia', 'status', 'responsavelId', 'criadoPorId']) {
    if (key in patch) ticket[key] = patch[key];
  }
  ticket.updatedAt = new Date().toISOString();
  saveJson();
  mongoSet('tickets', cache.tickets);
  return ticket;
}

export function deleteTicket(id) {
  cache.tickets = ensureTickets().filter(t => t.id !== id);
  saveJson();
  mongoSet('tickets', cache.tickets);
}

export function addTicketComment(ticketId, { personId, text }) {
  const ticket = ensureTickets().find(t => t.id === ticketId);
  if (!ticket) return null;
  const comment = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), personId, text, createdAt: new Date().toISOString() };
  ticket.comments.push(comment);
  ticket.updatedAt = comment.createdAt;
  saveJson();
  mongoSet('tickets', cache.tickets);
  return comment;
}

export function deleteTicketComment(ticketId, commentId) {
  const ticket = ensureTickets().find(t => t.id === ticketId);
  if (!ticket) return null;
  ticket.comments = ticket.comments.filter(c => c.id !== commentId);
  saveJson();
  mongoSet('tickets', cache.tickets);
  return ticket;
}

// ── Relatórios gerados (D+7, Stories 24h, mensal por país/rede/geral) ──────────────────────
// reports[brandId] = [ {id, type, scopeLabel, periodKey, generatedAt, generatedBy, model}, ... ],
// mais recente primeiro. `model` é o objeto genérico consumido por src/reportRenderer.js
// (title/subtitle/sections) — já vem com qualquer texto de IA "cozido" dentro, então
// baixar em PDF ou DOCX depois nunca chama a IA de novo, só re-renderiza o mesmo modelo.
// `periodKey` (ex: mediaId, storyId, ou "2026-07" pro mês) é o que o agendador automático usa
// pra nunca gerar duas vezes o mesmo relatório (ver checkAutoReports em src/reports.js).
export function getReports(brandId) {
  return (cache.reports || {})[brandId] || [];
}

export function reportExists(brandId, type, periodKey) {
  return getReports(brandId).some(r => r.type === type && r.periodKey === periodKey);
}

export function getReport(brandId, id) {
  return getReports(brandId).find(r => r.id === id) || null;
}

export function addReport(brandId, report) {
  if (!cache.reports) cache.reports = {};
  if (!cache.reports[brandId]) cache.reports[brandId] = [];
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    generatedAt: new Date().toISOString(),
    ...report,
  };
  cache.reports[brandId].unshift(record);
  saveJson();
  mongoSet('reports', cache.reports);
  return record;
}

export function deleteReport(brandId, id) {
  if (!cache.reports?.[brandId]) return;
  cache.reports[brandId] = cache.reports[brandId].filter(r => r.id !== id);
  saveJson();
  mongoSet('reports', cache.reports);
}
