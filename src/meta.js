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
