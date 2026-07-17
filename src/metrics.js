// metrics.js — monta o payload de /api/dashboard: valor atual, crescimento dentro do período
// selecionado e série pro gráfico de tendência, por plataforma e mercado.
//
// "Crescimento no período" aqui é o primeiro valor vs. o último valor DENTRO da janela
// escolhida (não "vs. período anterior" como no live-dashboard) — seguidores é um contador
// (gauge), não um total somável como receita, e a série é só um snapshot por dia, então
// "quanto cresceu do início ao fim da janela que você está olhando" é a leitura mais direta
// pra esse tipo de dado, e funciona mesmo com pouco histórico acumulado ainda.
import { getSnapshotsInRange } from './store.js';

const IG_KEYS = ['followers', 'following', 'posts', 'recentLikes', 'recentComments'];
const FB_KEYS = ['likes', 'followers'];

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function buildEntity(platform, market, since, until) {
  const keys = platform === 'instagram' ? IG_KEYS : FB_KEYS;
  const entries = getSnapshotsInRange(platform, market, since, until);
  const series = { dates: entries.map(([d]) => d) };
  for (const k of keys) series[k] = entries.map(([, v]) => v[k] ?? null);

  if (!entries.length) return { latest: null, delta: {}, series };

  const [firstDate, first] = entries[0];
  const [lastDate, last] = entries[entries.length - 1];
  const delta = {};
  for (const k of keys) delta[k] = pct(first[k], last[k]);

  return { latest: { ...last, date: lastDate }, first: { ...first, date: firstDate }, delta, series };
}

// Soma duas séries do mesmo mercado por data, pra dar o KPI combinado BR+US. As duas quase
// sempre sincronizam juntas (mesmo agendamento), mas nem sempre no mesmo dia exato (uma pode
// falhar um sync e a outra não) — por isso "carrega pra frente" o último valor conhecido de
// cada mercado em vez de tratar ausência como 0. Só entra no resultado a partir do ponto em
// que os DOIS mercados já têm pelo menos um valor conhecido: antes disso, "somar" só um deles
// não é um total combinado de verdade, e trataria "o outro mercado começou a reportar" como
// crescimento — não é.
function combineSeries(a, b, key) {
  const build = (series) => { const m = new Map(); (series.dates || []).forEach((d, i) => { const v = series[key]?.[i]; if (v != null) m.set(d, v); }); return m; };
  const aMap = build(a), bMap = build(b);
  const dates = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
  let aLast = null, bLast = null;
  const out = [];
  for (const d of dates) {
    if (aMap.has(d)) aLast = aMap.get(d);
    if (bMap.has(d)) bLast = bMap.get(d);
    if (aLast == null || bLast == null) continue;
    out.push(aLast + bLast);
  }
  return out;
}

function combinedKpi(a, b, key) {
  const av = a.latest?.[key], bv = b.latest?.[key];
  if (av == null && bv == null) return { value: null, deltaPct: null };
  const value = (av ?? 0) + (bv ?? 0);
  const combined = combineSeries(a.series, b.series, key);
  const deltaPct = combined.length ? pct(combined[0], combined[combined.length - 1]) : null;
  return { value, deltaPct };
}

export function computeSocialDashboard({ since, until }) {
  const ig = { br: buildEntity('instagram', 'br', since, until), us: buildEntity('instagram', 'us', since, until) };
  const fb = { br: buildEntity('facebook', 'br', since, until), us: buildEntity('facebook', 'us', since, until) };

  return {
    period: { since, until },
    instagram: ig,
    facebook: fb,
    combined: {
      igFollowers: combinedKpi(ig.br, ig.us, 'followers'),
      igLikes:     combinedKpi(ig.br, ig.us, 'recentLikes'),
      fbLikes:     combinedKpi(fb.br, fb.us, 'likes'),
      fbFollowers: combinedKpi(fb.br, fb.us, 'followers'),
    },
  };
}
