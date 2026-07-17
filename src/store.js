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
}

// Diagnóstico: qual backend está realmente ativo — usado por GET /api/status pra confirmar
// se o MONGODB_URI foi lido e a conexão foi aberta, sem precisar vasculhar log do Railway.
export function getStoreBackend() {
  return USE_MONGO ? 'mongodb' : 'json';
}

export function getSnapshots(platform, market) {
  return (cache.snapshots || {})[platform]?.[market] || {};
}

// Snapshots dentro de um período, ordenados por data — usado pra montar KPI/série do gráfico.
export function getSnapshotsInRange(platform, market, since, until) {
  const all = getSnapshots(platform, market);
  return Object.entries(all)
    .filter(([d]) => (!since || d >= since) && (!until || d <= until))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function addSnapshot(platform, market, dateISO, data) {
  if (!cache.snapshots) cache.snapshots = {};
  if (!cache.snapshots[platform]) cache.snapshots[platform] = {};
  if (!cache.snapshots[platform][market]) cache.snapshots[platform][market] = {};
  cache.snapshots[platform][market][dateISO] = data;
  saveJson();
  mongoSet('snapshots', cache.snapshots);
}

export function setLastSync(iso) {
  cache.lastSync = iso;
  saveJson();
  mongoSet('lastSync', iso);
}

export function getLastSync() {
  return cache.lastSync || null;
}
