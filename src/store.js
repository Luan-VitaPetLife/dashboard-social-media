// store.js — armazenamento híbrido: Postgres se DATABASE_URL existir, senão JSON local em
// data/db.json (mesmo padrão do live-dashboard, só que sem o índice em memória — volume de
// dado aqui é um snapshot por dia por plataforma, não pedidos).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const USE_PG = Boolean(process.env.DATABASE_URL);

const EMPTY = { snapshots: {}, lastSync: null };
let cache = null;
let pool = null;

function loadJson() {
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    cache = structuredClone(EMPTY);
  }
}

function saveJson() {
  if (USE_PG) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2));
}

async function pgSet(key, value) {
  if (!USE_PG) return;
  await pool.query(
    'INSERT INTO kv (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value]
  );
}

export async function initStore() {
  if (USE_PG) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL)');
    const { rows } = await pool.query('SELECT key, value FROM kv');
    cache = structuredClone(EMPTY);
    for (const r of rows) cache[r.key] = r.value;
    console.log('Store: Postgres');
  } else {
    loadJson();
    console.log('Store: JSON local');
  }
}

export function getSnapshots(platform) {
  return (cache.snapshots || {})[platform] || {};
}

export function addSnapshot(platform, dateISO, data) {
  if (!cache.snapshots) cache.snapshots = {};
  if (!cache.snapshots[platform]) cache.snapshots[platform] = {};
  cache.snapshots[platform][dateISO] = data;
  saveJson();
  pgSet('snapshots', cache.snapshots);
}

export function setLastSync(iso) {
  cache.lastSync = iso;
  saveJson();
  pgSet('lastSync', iso);
}

export function getLastSync() {
  return cache.lastSync || null;
}
