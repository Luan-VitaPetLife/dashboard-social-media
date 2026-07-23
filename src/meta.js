// meta.js — Meta Graph API: métricas de conta (Instagram Business + Página do Facebook).
// Cada função recebe o `metaId` da conta já resolvido pelo registry (src/registry.js) — este
// arquivo não conhece marca/país, só fala com a Graph API dado um ID de recurso. As contas de
// uma mesma marca costumam viver no mesmo Business Manager, então um único META_ACCESS_TOKEN
// serve pra todas; só o ID do recurso muda por conta.
import 'dotenv/config';
import { getAccounts } from './registry.js';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const TOKEN = process.env.META_ACCESS_TOKEN;

export function isConfigured() {
  return Boolean(TOKEN);
}

async function graphGetAs(token, pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pathAndQuery}${sep}access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Meta Graph API error');
  return json;
}
function graphGet(pathAndQuery) { return graphGetAs(TOKEN, pathAndQuery); }

// Page Insights (histórico) exige o token DA PRÓPRIA PÁGINA, não o token de usuário/sistema
// usado em todo o resto deste arquivo (erro confirmado ao vivo: "(#190) This method must be
// called with a Page Access Token"). O token de usuário, com pages_show_list +
// pages_read_engagement, consegue pedir o token da Página — troca única por conta, não precisa
// ser salva em lugar nenhum, só usada na hora do backfill. Cache chaveado pelo próprio ID da
// Página (não por marca/país) — cada conta troca seu token uma vez só.
const pageTokenCache = {};
async function fetchPageAccessToken(id) {
  if (!TOKEN || !id) return null;
  if (pageTokenCache[id]) return pageTokenCache[id];
  const json = await graphGet(`${id}?fields=access_token`);
  pageTokenCache[id] = json.access_token || null;
  return pageTokenCache[id];
}

// Instagram Business Account: seguidores, seguindo, nº de posts, e curtidas/comentários somados
// dos últimos `mediaSample` posts — a Graph API não expõe um "total de curtidas da conta"
// agregado, só por post, então isso é uma amostra recente, não o histórico completo.
export async function fetchInstagramSnapshot(id, mediaSample = 25) {
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
export async function fetchFacebookSnapshot(id) {
  if (!TOKEN || !id) return null;
  const page = await graphGet(`${id}?fields=fan_count,followers_count,name`);
  return {
    name: page.name ?? null,
    likes: page.fan_count ?? null,
    followers: page.followers_count ?? null,
  };
}

// ── Conteúdo individual (ficha de post) ─────────────────────────────────────────────────────
// Diferente do snapshot de conta (agregado): aqui é um post/Reel específico. Confirmado ao vivo
// (21/07/2026) que reach, likes, comments, saved, shares, total_interactions e views funcionam
// de forma uniforme pra REELS, CAROUSEL_ALBUM e IMAGE — sem precisar de conjunto de métrica
// diferente por media_product_type. `impressions` foi descontinuada pela API (todas as versões
// ≥v22.0); `follows`/`profile_visits` só existem no nível de conta, não por mídia.
const CONTENT_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'views'];

// Pagina /{id}/media até achar um item publicado antes de `sinceUnix` (ou acabar a paginação) —
// usado pra montar a janela de retenção de conteúdo (ver contentSync.js). Corta assim que o item
// mais antigo da página já é mais velho que a janela, em vez de paginar o histórico inteiro.
export async function fetchInstagramMediaList(id, sinceUnix) {
  if (!TOKEN || !id) return [];
  const items = [];
  let url = `${id}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink&limit=25`;
  for (let page = 0; page < 20; page++) {
    const json = await graphGet(url);
    const data = json.data || [];
    for (const item of data) {
      items.push(item);
      if (Math.floor(Date.parse(item.timestamp) / 1000) < sinceUnix) return items;
    }
    const next = json.paging?.next;
    if (!next || !data.length) break;
    url = next.replace(`https://graph.facebook.com/${GRAPH_VERSION}/`, '');
  }
  return items;
}

// Métricas de um post/Reel específico — usado por contentSync.js pra gravar o snapshot diário
// de conteúdo. Tenta o conjunto completo numa chamada só; se algum nome não for aceito por essa
// conta/tipo (a API já demonstrou variar por versão), cai pra buscar métrica por métrica e
// descarta silenciosamente a que falhar, igual ao padrão já usado nas métricas de conta.
export async function fetchInstagramMediaInsights(mediaId) {
  if (!TOKEN || !mediaId) return null;
  try {
    const json = await graphGet(`${mediaId}/insights?metric=${CONTENT_METRICS.join(',')}`);
    const byName = {};
    for (const m of json.data || []) byName[m.name] = m.values?.[0]?.value ?? null;
    return {
      reach: byName.reach ?? null,
      likes: byName.likes ?? null,
      comments: byName.comments ?? null,
      saved: byName.saved ?? null,
      shares: byName.shares ?? null,
      totalInteractions: byName.total_interactions ?? null,
      views: byName.views ?? null,
    };
  } catch {
    const byName = {};
    for (const metric of CONTENT_METRICS) {
      try {
        const json = await graphGet(`${mediaId}/insights?metric=${metric}`);
        byName[metric] = json.data?.[0]?.values?.[0]?.value ?? null;
      } catch {
        byName[metric] = null;
      }
    }
    return {
      reach: byName.reach ?? null,
      likes: byName.likes ?? null,
      comments: byName.comments ?? null,
      saved: byName.saved ?? null,
      shares: byName.shares ?? null,
      totalInteractions: byName.total_interactions ?? null,
      views: byName.views ?? null,
    };
  }
}

// ── Stories 24h ──────────────────────────────────────────────────────────────────────────────
// /{ig-id}/stories só lista stories ATIVOS agora (o Instagram os remove desse endpoint assim que
// expiram, ~24h depois de publicados) — não existe um jeito de "puxar o histórico de stories
// antigos" depois que somem, então a cobertura aqui depende de sincronizar com frequência
// suficiente pra pegar cada story pelo menos uma vez antes de expirar (ver storySync.js, que roda
// num intervalo próprio, mais curto que o sync de perfil/conteúdo).
export async function fetchInstagramActiveStories(id) {
  if (!TOKEN || !id) return [];
  const json = await graphGet(`${id}/stories?fields=id,media_type,timestamp,permalink`);
  return json.data || [];
}

// Confirmado ao vivo (21/07/2026): likes/comments/saved NÃO existem pra stories (o Instagram não
// mostra esses conceitos em stories) — só reach, replies, navigation, shares, total_interactions,
// profile_activity e follows são aceitos. `navigation` é o total agregado de ações de navegação
// (avançar/voltar/sair) — a API não expõe mais essas três separadas (ver probe de 21/07/2026),
// então a leitura "tela a tela" que o briefing pede não é possível hoje, só esse agregado.
const STORY_METRICS = ['reach', 'replies', 'navigation', 'shares', 'total_interactions', 'profile_activity', 'follows'];

export async function fetchInstagramStoryInsights(storyId) {
  if (!TOKEN || !storyId) return null;
  try {
    const json = await graphGet(`${storyId}/insights?metric=${STORY_METRICS.join(',')}`);
    const byName = {};
    for (const m of json.data || []) byName[m.name] = m.values?.[0]?.value ?? null;
    return {
      reach: byName.reach ?? null,
      replies: byName.replies ?? null,
      navigation: byName.navigation ?? null,
      shares: byName.shares ?? null,
      totalInteractions: byName.total_interactions ?? null,
      profileActivity: byName.profile_activity ?? null,
      follows: byName.follows ?? null,
    };
  } catch {
    const byName = {};
    for (const metric of STORY_METRICS) {
      try {
        const json = await graphGet(`${storyId}/insights?metric=${metric}`);
        byName[metric] = json.data?.[0]?.values?.[0]?.value ?? null;
      } catch {
        byName[metric] = null;
      }
    }
    return {
      reach: byName.reach ?? null,
      replies: byName.replies ?? null,
      navigation: byName.navigation ?? null,
      shares: byName.shares ?? null,
      totalInteractions: byName.total_interactions ?? null,
      profileActivity: byName.profile_activity ?? null,
      follows: byName.follows ?? null,
    };
  }
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

export async function fetchInstagramFollowerDeltas(id) {
  if (!TOKEN || !id) return [];
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const json = await graphGet(`${id}/insights?metric=follower_count&period=day&since=${since}&until=${until}`);
  const values = json.data?.[0]?.values || [];
  return values.map(v => ({ date: (v.end_time || '').slice(0, 10), delta: v.value }));
}

// Confirmado ao vivo (17/07/2026): page_fans, page_fan_adds(_unique), page_fan_removes(_unique)
// não existem mais ("(#100) valid insights metric") — só os "page_follows"/"page_daily_*follow*"
// são nomes válidos, mas exigem o token DA PÁGINA (ver fetchPageAccessToken acima), não o de
// usuário/sistema.
const FB_METRIC_CANDIDATES = [
  'page_follows',
  'page_daily_follows', 'page_daily_follows_unique',
  'page_daily_unfollows', 'page_daily_unfollows_unique',
];

// Página do Facebook não tem um equivalente direto a follower_count — reconstrói a variação
// líquida do dia a partir de "ganhou" menos "perdeu".
export async function fetchFacebookNetFanDeltas(id) {
  const pageToken = await fetchPageAccessToken(id);
  if (!pageToken || !id) return [];
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const json = await graphGetAs(pageToken, `${id}/insights?metric=page_daily_follows_unique,page_daily_unfollows_unique&period=day&since=${since}&until=${until}`);
  const adds = json.data?.find(d => d.name === 'page_daily_follows_unique')?.values || [];
  const removes = json.data?.find(d => d.name === 'page_daily_unfollows_unique')?.values || [];
  const removeMap = new Map(removes.map(v => [(v.end_time || '').slice(0, 10), v.value || 0]));
  return adds.map(v => {
    const date = (v.end_time || '').slice(0, 10);
    return { date, delta: (v.value || 0) - (removeMap.get(date) || 0) };
  });
}

// ── Engajamento por período (curtidas, comentários, visualizações somados) ─────────────────
// Diferente do `recentLikes`/`recentComments` do snapshot diário (amostra dos últimos 25
// posts NO MOMENTO do sync) — aqui é o total de verdade dentro do período escolhido na tela,
// via Insights com metric_type=total_value (confirmado ao vivo 17/07/2026, ver probeEngagement
// abaixo). Cache leve em memória (5 min) — o auto-refresh do front pode rodar a cada 1 min, e
// não faz sentido bater na Insights API a cada esses ciclos pra um número que não muda tão
// rápido assim. Chaveado por metaId (não por marca/país) — cada conta tem sua própria entrada.
const engagementCache = new Map();
const ENGAGEMENT_CACHE_TTL_MS = 5 * 60 * 1000;
async function cached(key, fn) {
  const hit = engagementCache.get(key);
  if (hit && Date.now() - hit.at < ENGAGEMENT_CACHE_TTL_MS) return hit.value;
  const value = await fn();
  engagementCache.set(key, { value, at: Date.now() });
  return value;
}
function isoToUnix(iso) { return Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000); }

export async function fetchInstagramEngagement(id, since, until) {
  if (!TOKEN || !id) return null;
  return cached(`ig-eng-${id}-${since}-${until}`, async () => {
    const sinceU = isoToUnix(since), untilU = isoToUnix(until);
    const json = await graphGet(`${id}/insights?metric=${IG_TOTAL_VALUE_CANDIDATES.join(',')}&metric_type=total_value&period=day&since=${sinceU}&until=${untilU}`);
    const byName = {};
    for (const m of json.data || []) byName[m.name] = m.total_value?.value ?? null;
    return {
      likes: byName.likes ?? null,
      comments: byName.comments ?? null,
      views: byName.views ?? null,
      shares: byName.shares ?? null,
      saves: byName.saves ?? null,
      totalInteractions: byName.total_interactions ?? null,
    };
  });
}

// Página do Facebook: page_video_views vem como série diária (confirmado ao vivo) — soma
// dentro do período pedido.
export async function fetchFacebookVideoViews(id, since, until) {
  const pageToken = await fetchPageAccessToken(id);
  if (!pageToken || !id) return null;
  return cached(`fb-video-${id}-${since}-${until}`, async () => {
    const sinceU = isoToUnix(since), untilU = isoToUnix(until);
    const json = await graphGetAs(pageToken, `${id}/insights/page_video_views?period=day&since=${sinceU}&until=${untilU}`);
    const values = json.data?.[0]?.values || [];
    const total = values.reduce((a, v) => a + (v.value || 0), 0);
    return { videoViews: total };
  });
}

// ── Orgânico × pago (conteúdo impulsionado) ─────────────────────────────────────────────────
// Confirmado ao vivo (21/07/2026): o mesmo META_ACCESS_TOKEN já usado no resto deste arquivo tem
// acesso de leitura à conta de anúncios do mesmo Business Manager (nenhum token/permissão nova
// precisou ser gerada) — só faltava o ID da conta (mesmo valor já usado no projeto de vendas
// ../dashboard, ver registry.js). O criativo de cada anúncio (`creative.instagram_permalink_url`)
// devolve o link exato do post orgânico usado no anúncio — é isso que cruza com o `permalink` já
// guardado por post em contentSync.js pra marcar "impulsionado". Cache de 5 min (mesmo padrão de
// `cached()` acima) — não precisa bater na Marketing API a cada request de /api/content.
export async function fetchBoostedPermalinks(adAccountId) {
  if (!TOKEN || !adAccountId) return new Set();
  return cached(`boosted-${adAccountId}`, async () => {
    const permalinks = new Set();
    let url = `act_${adAccountId}/ads?fields=creative{instagram_permalink_url}&limit=100`;
    for (let page = 0; page < 20; page++) {
      const json = await graphGet(url);
      for (const ad of json.data || []) {
        const link = ad.creative?.instagram_permalink_url;
        if (link) permalinks.add(link.replace(/\/$/, ''));
      }
      const next = json.paging?.next;
      if (!next || !(json.data || []).length) break;
      url = next.replace(`https://graph.facebook.com/${GRAPH_VERSION}/`, '');
    }
    return permalinks;
  });
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────────────────────
// probeInsights/probeEngagement resolvem a conta pelo registry (brandId + countryId) em vez de
// receber o metaId direto — são pensados pra chamada manual via navegador/curl com parâmetros
// legíveis (?brand=&country=), não pelo resto do código.

// Diagnóstico: devolve a resposta crua dos endpoints de Insights (Instagram e Facebook),
// sem processar nada — confirma ao vivo quantos dias realmente vêm e se as métricas ainda
// existem pra essa conta, antes de confiar no backfill. Usado por GET /api/meta/probe-insights.
export async function probeInsights(brandId, countryId) {
  const accounts = getAccounts(brandId, countryId);
  const igId = accounts.find(a => a.platform === 'instagram')?.metaId;
  const fbId = accounts.find(a => a.platform === 'facebook')?.metaId;
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const out = { brandId, countryId, since, until, sinceDate: new Date(since * 1000).toISOString().slice(0, 10), untilDate: new Date(until * 1000).toISOString().slice(0, 10) };
  if (!TOKEN) { out.error = 'META_ACCESS_TOKEN ausente.'; return out; }

  if (igId) {
    try { out.instagramFollowerCount = await graphGet(`${igId}/insights?metric=follower_count&period=day&since=${since}&until=${until}`); }
    catch (e) { out.instagramError = e.message; }
  } else out.instagramError = 'Nenhuma conta Instagram configurada para essa marca/país.';

  if (fbId) {
    try {
      const pageToken = await fetchPageAccessToken(fbId);
      out.facebookPageToken = pageToken ? 'obtido' : 'não veio (ver facebookTokenError)';
      out.facebookMetrics = {};
      for (const metric of FB_METRIC_CANDIDATES) {
        try {
          const json = await graphGetAs(pageToken, `${fbId}/insights/${metric}?period=day&since=${since}&until=${until}`);
          out.facebookMetrics[metric] = { ok: true, points: json.data?.[0]?.values?.length ?? 0 };
        } catch (e) {
          out.facebookMetrics[metric] = { ok: false, error: e.message };
        }
      }
    } catch (e) {
      out.facebookTokenError = e.message;
    }
  } else out.facebookError = 'Nenhuma conta Facebook configurada para essa marca/país.';

  return out;
}

// ── Diagnóstico: visualizações de vídeo + curtidas/comentários somados no período ──────────
// Pedido do Luan (17/07/2026): total de curtidas em posts E visualizações de vídeo, somados
// no período — diferente do que já existe (`recentLikes`, amostra dos últimos 25 posts NO
// MOMENTO do sync, não uma soma do período). Confirmado ao vivo (17/07/2026): likes, comments,
// views, shares, total_interactions e saves são nomes VÁLIDOS de métrica de conta, mas essa
// conta só aceita eles com `metric_type=total_value` (dá o total do período numa chamada só,
// em vez de série diária) — `period=day` sozinho dá erro pedindo esse parâmetro. `video_views`
// não existe (usar `views`); `saved` não existe (usar `saves`, confirmado na lista de valores
// aceitos que veio no erro anterior). `reach` já funciona em série diária (period=day), mantido
// como está.
const IG_TOTAL_VALUE_CANDIDATES = ['likes', 'comments', 'views', 'shares', 'saves', 'total_interactions'];
const FB_ENGAGEMENT_CANDIDATES = ['post_video_views', 'page_video_views', 'page_impressions', 'page_posts_impressions'];

export async function probeEngagement(brandId, countryId) {
  const accounts = getAccounts(brandId, countryId);
  const igId = accounts.find(a => a.platform === 'instagram')?.metaId;
  const fbId = accounts.find(a => a.platform === 'facebook')?.metaId;
  const since = unixDaysAgo(INSIGHTS_LOOKBACK_DAYS), until = unixDaysAgo(0);
  const out = { brandId, countryId, since, until, sinceDate: new Date(since * 1000).toISOString().slice(0, 10), untilDate: new Date(until * 1000).toISOString().slice(0, 10) };
  if (!TOKEN) { out.error = 'META_ACCESS_TOKEN ausente.'; return out; }

  if (igId) {
    out.instagramMetrics = {};
    try {
      const json = await graphGet(`${igId}/insights?metric=${IG_TOTAL_VALUE_CANDIDATES.join(',')}&metric_type=total_value&period=day&since=${since}&until=${until}`);
      out.instagramMetrics.totalValueRaw = json;
    } catch (e) {
      out.instagramMetrics.totalValueError = e.message;
    }
    try {
      const json = await graphGet(`${igId}/insights?metric=reach&period=day&since=${since}&until=${until}`);
      out.instagramMetrics.reach = { ok: true, points: json.data?.[0]?.values?.length ?? 0 };
    } catch (e) {
      out.instagramMetrics.reach = { ok: false, error: e.message };
    }
  } else out.instagramError = 'Nenhuma conta Instagram configurada para essa marca/país.';

  if (fbId) {
    try {
      const pageToken = await fetchPageAccessToken(fbId);
      out.facebookEngagementMetrics = {};
      for (const metric of FB_ENGAGEMENT_CANDIDATES) {
        try {
          const json = await graphGetAs(pageToken, `${fbId}/insights/${metric}?period=day&since=${since}&until=${until}`);
          const values = json.data?.[0]?.values || [];
          out.facebookEngagementMetrics[metric] = { ok: true, points: values.length, sample: values.slice(0, 3) };
        } catch (e) {
          out.facebookEngagementMetrics[metric] = { ok: false, error: e.message };
        }
      }
    } catch (e) {
      out.facebookTokenError = e.message;
    }
  } else out.facebookError = 'Nenhuma conta Facebook configurada para essa marca/país.';

  return out;
}

// ── Diagnóstico: demografia/geografia de audiência (cidade, país, idade, gênero) ──────────
// Investigação pontual (23/07/2026, a pedido do Luan — quer uma seção com globo mostrando de
// onde vem a audiência). Nunca chamado fora de diagnóstico manual: só confirma ao vivo se essas
// métricas respondem pra este token/conta antes de qualquer coisa ser construída em cima, mesmo
// princípio dos outros probes acima. `follower_demographics` (quem segue) é lifetime;
// `engaged_audience_demographics`/`reached_audience_demographics` (quem interagiu/foi alcançado)
// pedem `timeframe` em vez de period=lifetime — testa as três porque os nomes mudaram entre
// versões da API e não dá pra saber de antemão qual essa conta aceita.
const IG_DEMOGRAPHIC_METRICS = ['follower_demographics', 'engaged_audience_demographics', 'reached_audience_demographics'];
const DEMOGRAPHIC_BREAKDOWNS = ['city', 'country', 'age', 'gender'];
const FB_DEMOGRAPHIC_METRICS = ['page_fans_city', 'page_fans_country'];
// last_30_days parou de ser aceito em engaged/reached_audience_demographics a partir da v20 (erro
// confirmado ao vivo 23/07/2026) — testa os candidatos atuais até um funcionar.
const TIMEFRAME_CANDIDATES = ['last_14_days', 'this_month', 'this_week_mon_today', 'prev_month'];

export async function probeDemographics(brandId, countryId) {
  const accounts = getAccounts(brandId, countryId);
  const igId = accounts.find(a => a.platform === 'instagram')?.metaId;
  const fbId = accounts.find(a => a.platform === 'facebook')?.metaId;
  const out = { brandId, countryId };
  if (!TOKEN) { out.error = 'META_ACCESS_TOKEN ausente.'; return out; }

  if (igId) {
    out.instagram = {};
    for (const metric of IG_DEMOGRAPHIC_METRICS) {
      out.instagram[metric] = {};
      for (const breakdown of DEMOGRAPHIC_BREAKDOWNS) {
        if (metric === 'follower_demographics') {
          try {
            const json = await graphGet(`${igId}/insights?metric=${metric}&metric_type=total_value&breakdown=${breakdown}&period=lifetime`);
            out.instagram[metric][breakdown] = { ok: true, raw: json.data?.[0]?.total_value };
          } catch (e) {
            out.instagram[metric][breakdown] = { ok: false, error: e.message };
          }
          continue;
        }
        // engaged/reached_audience_demographics: tenta cada timeframe candidato até um funcionar
        let lastError = null;
        for (const timeframe of TIMEFRAME_CANDIDATES) {
          try {
            const json = await graphGet(`${igId}/insights?metric=${metric}&metric_type=total_value&breakdown=${breakdown}&period=lifetime&timeframe=${timeframe}`);
            out.instagram[metric][breakdown] = { ok: true, timeframe, raw: json.data?.[0]?.total_value };
            lastError = null;
            break;
          } catch (e) {
            lastError = e.message;
          }
        }
        if (lastError) out.instagram[metric][breakdown] = { ok: false, error: lastError, triedTimeframes: TIMEFRAME_CANDIDATES };
      }
    }
  } else out.instagramError = 'Nenhuma conta Instagram configurada para essa marca/país.';

  if (fbId) {
    out.facebook = {};
    try {
      const pageToken = await fetchPageAccessToken(fbId);
      for (const metric of FB_DEMOGRAPHIC_METRICS) {
        try {
          const json = await graphGetAs(pageToken, `${fbId}/insights/${metric}?period=lifetime`);
          out.facebook[metric] = { ok: true, raw: json.data?.[0]?.values?.slice(-1) };
        } catch (e) {
          out.facebook[metric] = { ok: false, error: e.message };
        }
      }
    } catch (e) {
      out.facebookTokenError = e.message;
    }
  } else out.facebookError = 'Nenhuma conta Facebook configurada para essa marca/país.';

  return out;
}
