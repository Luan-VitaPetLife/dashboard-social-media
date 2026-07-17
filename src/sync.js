// sync.js — orquestra a coleta diária de métricas de redes sociais e grava no store.
import { fetchInstagramSnapshot, fetchFacebookSnapshot, isConfigured } from './meta.js';
import { addSnapshot, setLastSync } from './store.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function runSync() {
  const date = todayISO();
  const errors = [];
  let instagram = null, facebook = null;

  if (!isConfigured()) {
    errors.push('Meta não configurado (META_ACCESS_TOKEN ausente).');
  } else {
    try { instagram = await fetchInstagramSnapshot(); }
    catch (e) { errors.push('instagram: ' + e.message); }

    try { facebook = await fetchFacebookSnapshot(); }
    catch (e) { errors.push('facebook: ' + e.message); }
  }

  if (instagram) addSnapshot('instagram', date, instagram);
  if (facebook) addSnapshot('facebook', date, facebook);
  setLastSync(new Date().toISOString());

  return { date, instagram, facebook, errors };
}
