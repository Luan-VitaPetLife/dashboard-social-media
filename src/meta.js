// meta.js — Meta Graph API: métricas de conta (Instagram Business + Página do Facebook),
// separado por mercado (br/us) — mesma convenção do live-dashboard. As 4 contas (2 Páginas do
// Facebook + 2 Instagram Business, uma BR e uma US) vivem no mesmo Business Manager, então o
// mesmo META_ACCESS_TOKEN serve pras quatro; só o ID do recurso muda por mercado.
import 'dotenv/config';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const TOKEN = process.env.META_ACCESS_TOKEN;

const IG_IDS = { br: process.env.META_IG_ACCOUNT_ID_BR, us: process.env.META_IG_ACCOUNT_ID_US };
const FB_IDS = { br: process.env.META_FB_PAGE_ID_BR, us: process.env.META_FB_PAGE_ID_US };

export function isConfigured() {
  return Boolean(TOKEN);
}

async function graphGet(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pathAndQuery}${sep}access_token=${TOKEN}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Meta Graph API error');
  return json;
}

// Instagram Business Account: seguidores, seguindo, nº de posts, e curtidas/comentários somados
// dos últimos `mediaSample` posts — a Graph API não expõe um "total de curtidas da conta"
// agregado, só por post, então isso é uma amostra recente, não o histórico completo.
export async function fetchInstagramSnapshot(market, mediaSample = 25) {
  const id = IG_IDS[market];
  if (!TOKEN || !id) return null;
  const acc = await graphGet(`${id}?fields=followers_count,follows_count,media_count`);
  const media = await graphGet(`${id}/media?fields=like_count,comments_count&limit=${mediaSample}`);
  const items = media.data || [];
  return {
    followers: acc.followers_count ?? null,
    following: acc.follows_count ?? null,
    posts: acc.media_count ?? null,
    recentLikes: items.reduce((a, m) => a + (m.like_count || 0), 0),
    recentComments: items.reduce((a, m) => a + (m.comments_count || 0), 0),
    recentSampleSize: items.length,
  };
}

// Página do Facebook: curtidas (fan_count) e seguidores.
export async function fetchFacebookSnapshot(market) {
  const id = FB_IDS[market];
  if (!TOKEN || !id) return null;
  const page = await graphGet(`${id}?fields=fan_count,followers_count,name`);
  return {
    name: page.name ?? null,
    likes: page.fan_count ?? null,
    followers: page.followers_count ?? null,
  };
}

// ── Backfill histórico (Insights API) ──────────────────────────────
// followers_count/fan_count (acima) só trazem o valor ATUAL — a Graph API não guarda "o
// valor de ontem" nesses campos. Os endpoints de Insights guardam série histórica, mas com
// duas pegadinhas:
//  1) Período retroativo limitado — historicamente ~30 dias pra métricas diárias no
//     Instagram; o limite real (e quais métricas de Página do Facebook ainda existem) muda
//     com a versão da API, por isso GET /api/meta/probe-insights devolve a resposta crua
//     pra confirmar ao vivo antes de confiar no backfill.
//  2) `follower_count` do Instagram é a VARIAÇÃO do dia (ganhou/perdeu), não o total
//     acumulado — reconstruímos o total histórico subtraindo essas variações a partir do
//     valor atual, de trás pra frente (ver reconstructAbsolute em backfill.js).
const INSIGHTS_LOOKBACK_DAYS = 30;
function unixDaysAgo(n) { return Math.floor(Date.now() / 1000) - n * 86400; }

export async function fetchInstagramFollowerDeltas(market) {
  const id = IG_IDS[market];
  if (!TOKEN || !id) return [];
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const json = await graphGet(`${id}/insights?metric=follower_count&period=day&since=${since}&until=${until}`);
  const values = json.data?.[0]?.values || [];
  return values.map(v => ({ date: (v.end_time || '').slice(0, 10), delta: v.value }));
}

// Página do Facebook não tem um equivalente direto a follower_count — reconstrói a variação
// líquida do dia a partir de "ganhou" menos "perdeu" (dois metrics separados na Insights API).
export async function fetchFacebookNetFanDeltas(market) {
  const id = FB_IDS[market];
  if (!TOKEN || !id) return [];
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const json = await graphGet(`${id}/insights?metric=page_fan_adds_unique,page_fan_removes_unique&period=day&since=${since}&until=${until}`);
  const adds = json.data?.find(d => d.name === 'page_fan_adds_unique')?.values || [];
  const removes = json.data?.find(d => d.name === 'page_fan_removes_unique')?.values || [];
  const removeMap = new Map(removes.map(v => [(v.end_time || '').slice(0, 10), v.value || 0]));
  return adds.map(v => {
    const date = (v.end_time || '').slice(0, 10);
    return { date, delta: (v.value || 0) - (removeMap.get(date) || 0) };
  });
}

// Diagnóstico: devolve a resposta crua dos endpoints de Insights (Instagram e Facebook),
// sem processar nada — confirma ao vivo quantos dias realmente vêm e se as métricas ainda
// existem pra essa conta, antes de confiar no backfill. Usado por GET /api/meta/probe-insights.
export async function probeInsights(market) {
  const igId = IG_IDS[market], fbId = FB_IDS[market];
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const out = { market, since, until, sinceDate: new Date(since * 1000).toISOString().slice(0, 10), untilDate: new Date(until * 1000).toISOString().slice(0, 10) };
  if (!TOKEN) { out.error = 'META_ACCESS_TOKEN ausente.'; return out; }
  if (igId) {
    try { out.instagramFollowerCount = await graphGet(`${igId}/insights?metric=follower_count&period=day&since=${since}&until=${until}`); }
    catch (e) { out.instagramError = e.message; }
  } else out.instagramError = 'META_IG_ACCOUNT_ID_' + market.toUpperCase() + ' ausente.';
  if (fbId) {
    try { out.facebookFanDeltas = await graphGet(`${fbId}/insights?metric=page_fan_adds_unique,page_fan_removes_unique&period=day&since=${since}&until=${until}`); }
    catch (e) { out.facebookError = e.message; }
  } else out.facebookError = 'META_FB_PAGE_ID_' + market.toUpperCase() + ' ausente.';
  return out;
}
