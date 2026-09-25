// utils.js — helpers pequenos e genéricos (datas em ISO, variação percentual) que existiam
// copiados de forma idêntica em vários módulos (server.js, clicks.js, sync.js, contentSync.js,
// metrics.js, contentMetrics.js, storyMetrics.js, goals.js, cofrinho.js) antes desta limpeza. Um
// só lugar evita as cópias divergirem com o tempo.

// "Hoje" em ISO (UTC) — usado como âncora de período em várias telas (cliques, sync, prazo de
// metas, relatório mensal parcial).
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// N dias atrás, em ISO.
export function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// Desloca uma data ISO por `days` dias (pode ser negativo) — meio-dia UTC explícito pra não
// escorregar de dia por causa de fuso horário.
export function shiftISO(dateISO, days) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Dias inteiros entre duas datas ISO (until - since).
export function daysBetween(since, until) {
  return Math.round((Date.parse(until + 'T00:00:00Z') - Date.parse(since + 'T00:00:00Z')) / 86400000);
}

// Dias até um prazo ISO (negativo se já passou) — usado por metas e Cofrinho.
export function daysUntil(deadlineISO) {
  const target = Date.parse(deadlineISO + 'T00:00:00Z');
  const today = Date.parse(todayISO() + 'T00:00:00Z');
  return Math.round((target - today) / 86400000);
}

// Variação percentual de `from` pra `to` — null quando não dá pra calcular (sem valor anterior,
// ou anterior zero), nunca uma divisão por zero disfarçada de "0%".
export function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}
