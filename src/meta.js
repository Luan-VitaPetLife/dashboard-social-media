// meta.js — Meta Graph API: métricas de conta (Instagram Business + Página do Facebook).
// Reaproveita o mesmo token de sistema (META_ACCESS_TOKEN) já usado no live-dashboard —
// um System User Token não é preso a um app/projeto específico, só ao conjunto de permissões
// concedido a ele.
import 'dotenv/config';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const TOKEN = process.env.META_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.META_IG_ACCOUNT_ID;
const FB_PAGE_ID = process.env.META_FB_PAGE_ID;

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
export async function fetchInstagramSnapshot(mediaSample = 25) {
  if (!TOKEN || !IG_ACCOUNT_ID) return null;
  const acc = await graphGet(`${IG_ACCOUNT_ID}?fields=followers_count,follows_count,media_count`);
  const media = await graphGet(`${IG_ACCOUNT_ID}/media?fields=like_count,comments_count&limit=${mediaSample}`);
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
export async function fetchFacebookSnapshot() {
  if (!TOKEN || !FB_PAGE_ID) return null;
  const page = await graphGet(`${FB_PAGE_ID}?fields=fan_count,followers_count,name`);
  return {
    name: page.name ?? null,
    likes: page.fan_count ?? null,
    followers: page.followers_count ?? null,
  };
}
