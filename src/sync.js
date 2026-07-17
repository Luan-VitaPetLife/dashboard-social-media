// sync.js — orquestra a coleta diária de métricas de redes sociais (BR e US) e grava no store.
import { fetchInstagramSnapshot, fetchFacebookSnapshot, isConfigured } from './meta.js';
import { addSnapshot, setLastSync } from './store.js';

const MARKETS = ['br', 'us'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function runSync() {
  const date = todayISO();
  const errors = [];
  const instagram = {};
  const facebook = {};

  if (!isConfigured()) {
    errors.push('Meta não configurado (META_ACCESS_TOKEN ausente).');
  } else {
    for (const market of MARKETS) {
      try {
        const ig = await fetchInstagramSnapshot(market);
        if (ig) { addSnapshot('instagram', market, date, ig); instagram[market] = ig; }
      } catch (e) {
        errors.push(`instagram(${market}): ` + e.message);
      }

      try {
        const fb = await fetchFacebookSnapshot(market);
        if (fb) { addSnapshot('facebook', market, date, fb); facebook[market] = fb; }
      } catch (e) {
        errors.push(`facebook(${market}): ` + e.message);
      }
    }
  }

  setLastSync(new Date().toISOString());
  return { date, instagram, facebook, errors };
}
