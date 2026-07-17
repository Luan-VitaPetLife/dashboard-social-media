// metrics.js — monta o payload de /api/dashboard: valor atual, comparação com o período
// anterior de mesmo tamanho (ex: últimos 7 dias vs. os 7 dias antes desses) e série pro
// gráfico de tendência, por plataforma e mercado.
//
// Seguidores/curtidas de página são um contador (gauge), não um total somável como receita —
// "o valor no período" é o último snapshot dentro da janela, e "vs. período anterior" compara
// esse valor com o último snapshot da janela imediatamente anterior, de mesmo tamanho. Sem
// snapshot na janela anterior (conta muito nova, ainda sem 2 períodos de histórico), o delta
// fica null ("—") em vez de fabricar um número.
import { getSnapshotsInRange } from './store.js';
import { fetchInstagramEngagement, fetchFacebookVideoViews } from './meta.js';

const IG_KEYS = ['followers', 'following', 'posts', 'recentLikes', 'recentComments'];
const FB_KEYS = ['likes', 'followers'];

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function isoUTC(d) { return d.toISOString().slice(0, 10); }
function addDaysISO(iso, n) { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

// Janela anterior de mesmo tamanho, encostada logo antes de `since` — ex: since=10/07,
// until=16/07 (7 dias) → período anterior = 03/07 a 09/07.
function previousPeriod(since, until) {
  const lengthDays = daysBetween(since, until) + 1;
  const prevUntil = addDaysISO(since, -1);
  const prevSince = addDaysISO(prevUntil, -(lengthDays - 1));
  return { prevSince, prevUntil };
}

function lastValueInRange(platform, market, since, until) {
  const entries = getSnapshotsInRange(platform, market, since, until);
  if (!entries.length) return null;
  return entries[entries.length - 1][1];
}

function buildEntity(platform, market, since, until, prevSince, prevUntil) {
  const keys = platform === 'instagram' ? IG_KEYS : FB_KEYS;
  const entries = getSnapshotsInRange(platform, market, since, until);
  const series = { dates: entries.map(([d]) => d) };
  for (const k of keys) series[k] = entries.map(([, v]) => v[k] ?? null);

  const previous = lastValueInRange(platform, market, prevSince, prevUntil);

  if (!entries.length) return { latest: null, previous, delta: {}, series };

  const [lastDate, last] = entries[entries.length - 1];
  const delta = {};
  for (const k of keys) delta[k] = previous ? pct(previous[k], last[k]) : null;

  return { latest: { ...last, date: lastDate }, previous, delta, series };
}

// Soma o valor mais recente de cada mercado (atual e do período anterior) pro KPI combinado
// BR+US — mercado sem dado em algum dos dois momentos entra como 0 na soma, mas só calcula
// delta se pelo menos um dos dois tinha algo no período anterior (senão "apareceu do nada"
// pareceria crescimento infinito).
function combinedKpi(a, b, key) {
  const av = a.latest?.[key], bv = b.latest?.[key];
  if (av == null && bv == null) return { value: null, previousValue: null, deltaPct: null };
  const value = (av ?? 0) + (bv ?? 0);

  const apv = a.previous?.[key], bpv = b.previous?.[key];
  const prevValue = (apv == null && bpv == null) ? null : (apv ?? 0) + (bpv ?? 0);
  const deltaPct = prevValue != null ? pct(prevValue, value) : null;

  return { value, previousValue: prevValue, deltaPct };
}

// Soma curtidas/comentários/visualizações do período (Instagram) ou visualizações de vídeo
// (Facebook) de dois mercados, com delta vs. o mesmo cálculo no período anterior — busca ao
// vivo na Insights API (cache de 5 min em meta.js), diferente dos campos de `buildEntity`
// acima (que vêm do snapshot diário já salvo no store).
function sumWithDelta(curA, curB, prevA, prevB) {
  if (curA == null && curB == null) return { value: null, previousValue: null, deltaPct: null };
  const value = (curA ?? 0) + (curB ?? 0);
  const prevValue = (prevA == null && prevB == null) ? null : (prevA ?? 0) + (prevB ?? 0);
  return { value, previousValue: prevValue, deltaPct: prevValue != null ? pct(prevValue, value) : null };
}

// since/until = período atual. cmpSince/cmpUntil = período de comparação escolhido manualmente
// no card de Comparação (ex: "mesmo período do ano passado", ou um intervalo customizado) —
// quando ausentes, cai no automático (período anterior de mesmo tamanho).
export async function computeSocialDashboard({ since, until, cmpSince, cmpUntil }) {
  const auto = previousPeriod(since, until);
  const prevSince = cmpSince || auto.prevSince;
  const prevUntil = cmpUntil || auto.prevUntil;

  const ig = { br: buildEntity('instagram', 'br', since, until, prevSince, prevUntil), us: buildEntity('instagram', 'us', since, until, prevSince, prevUntil) };
  const fb = { br: buildEntity('facebook', 'br', since, until, prevSince, prevUntil), us: buildEntity('facebook', 'us', since, until, prevSince, prevUntil) };

  const [igEngBr, igEngUs, igEngBrPrev, igEngUsPrev, fbVidBr, fbVidUs, fbVidBrPrev, fbVidUsPrev] = await Promise.all([
    fetchInstagramEngagement('br', since, until).catch(() => null),
    fetchInstagramEngagement('us', since, until).catch(() => null),
    fetchInstagramEngagement('br', prevSince, prevUntil).catch(() => null),
    fetchInstagramEngagement('us', prevSince, prevUntil).catch(() => null),
    fetchFacebookVideoViews('br', since, until).catch(() => null),
    fetchFacebookVideoViews('us', since, until).catch(() => null),
    fetchFacebookVideoViews('br', prevSince, prevUntil).catch(() => null),
    fetchFacebookVideoViews('us', prevSince, prevUntil).catch(() => null),
  ]);

  ig.br.engagement = igEngBr;
  ig.us.engagement = igEngUs;
  fb.br.videoViews = fbVidBr?.videoViews ?? null;
  fb.us.videoViews = fbVidUs?.videoViews ?? null;

  return {
    period: { since, until, prevSince, prevUntil },
    instagram: ig,
    facebook: fb,
    combined: {
      igFollowers: combinedKpi(ig.br, ig.us, 'followers'),
      igLikes:     sumWithDelta(igEngBr?.likes, igEngUs?.likes, igEngBrPrev?.likes, igEngUsPrev?.likes),
      igViews:     sumWithDelta(igEngBr?.views, igEngUs?.views, igEngBrPrev?.views, igEngUsPrev?.views),
      fbLikes:     combinedKpi(fb.br, fb.us, 'likes'),
      fbFollowers: combinedKpi(fb.br, fb.us, 'followers'),
      fbVideoViews: sumWithDelta(fbVidBr?.videoViews, fbVidUs?.videoViews, fbVidBrPrev?.videoViews, fbVidUsPrev?.videoViews),
    },
  };
}
