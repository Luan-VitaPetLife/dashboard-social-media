// clicks.js — cliques em botões de páginas externas (hoje o cardápio de links da loja Shopify).
// A página manda um evento por visita e um por clique; aqui a gente normaliza e agrega.
//
// Por que agregado por dia em vez de log de evento cru: o store inteiro é um KV (ver store.js),
// então guardar um documento por clique faria o valor crescer sem teto e reescrever tudo a cada
// gravação. Balde diário por tela responde todas as perguntas da tela de Cliques com tamanho
// limitado pelo número de links × origens, e de quebra não guarda nada que identifique alguém
// (sem IP, sem user agent cru, sem id de visitante) — não vira base de dado pessoal.

// Origens conhecidas: o host que o navegador manda como referenciador raramente é o nome que a
// gente usa pra falar do canal. Normaliza pra um punhado de rótulos estáveis, senão o relatório
// vira uma lista de subdomínios (l.instagram.com, lm.facebook.com, out.reddit.com...).
const SOURCE_HOSTS = [
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)facebook\.com$/i, 'facebook'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)youtube\.com$/i, 'youtube'],
  [/(^|\.)youtu\.be$/i, 'youtube'],
  [/(^|\.)wa\.me$/i, 'whatsapp'],
  [/(^|\.)whatsapp\.com$/i, 'whatsapp'],
  [/(^|\.)google\./i, 'google'],
  [/(^|\.)bing\.com$/i, 'bing'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)t\.co$/i, 'twitter'],
  [/(^|\.)x\.com$/i, 'twitter'],
  [/(^|\.)pinterest\./i, 'pinterest'],
];

export const DIRECT_SOURCE = 'direto';
export const UNKNOWN_LINK = 'sem rótulo';

function hostFromUrl(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return '';
  }
}

// utm_source ganha do referenciador: é o que a gente controla (link da bio) e continua correto
// mesmo quando o navegador do app não manda referenciador nenhum, que é o caso comum no
// Instagram. Sem os dois, cai em "direto".
export function normalizeSource({ utmSource, referrer, selfHost }) {
  const utm = String(utmSource || '').trim().toLowerCase();
  if (utm) return utm.slice(0, 40);

  const host = hostFromUrl(referrer);
  if (!host) return DIRECT_SOURCE;
  if (selfHost && host.toLowerCase() === String(selfHost).toLowerCase()) return DIRECT_SOURCE;

  for (const [pattern, label] of SOURCE_HOSTS) {
    if (pattern.test(host)) return label;
  }
  return host.replace(/^www\./i, '').toLowerCase().slice(0, 40);
}

// Detecção pelo user agent do servidor em vez de confiar num campo mandado pela página: o
// cliente pode mentir, e essa é a única dimensão em que isso aconteceria sem querer (navegador
// em modo desktop no celular, por exemplo).
export function deviceFromUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (/bot|crawl|spider|preview|slurp|lighthouse|headless/i.test(ua)) return 'bot';
  if (/tablet|ipad|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function normalizeLabel(value, fallback) {
  const clean = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, 60) : fallback;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shiftISO(dateISO, days) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyTotals() {
  return { views: 0, clicks: 0 };
}

function addTo(map, key, amount) {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function sortedEntries(map, limit) {
  const rows = Object.entries(map || {})
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
  return limit ? rows.slice(0, limit) : rows;
}

function deltaPct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

// Soma os baldes diários de uma tela dentro de um intervalo. Devolve sempre a mesma forma,
// inclusive quando não houve nenhum evento no período, pra tela não precisar checar nulo.
function sumRange(days, since, until) {
  const out = {
    views: 0,
    clicks: 0,
    byLink: {},
    bySource: {},
    byDevice: {},
    byTheme: {},
    byLinkSource: {},
    series: [],
  };

  for (let date = since; date <= until; date = shiftISO(date, 1)) {
    const day = days[date];
    out.series.push({ date, views: day?.views || 0, clicks: day?.clicks || 0 });
    if (!day) continue;

    out.views += day.views || 0;
    out.clicks += day.clicks || 0;
    for (const [k, v] of Object.entries(day.byLink || {})) addTo(out.byLink, k, v);
    for (const [k, v] of Object.entries(day.bySource || {})) addTo(out.bySource, k, v);
    for (const [k, v] of Object.entries(day.byDevice || {})) addTo(out.byDevice, k, v);
    for (const [k, v] of Object.entries(day.byTheme || {})) addTo(out.byTheme, k, v);
    for (const [link, sources] of Object.entries(day.byLinkSource || {})) {
      out.byLinkSource[link] = out.byLinkSource[link] || {};
      for (const [src, v] of Object.entries(sources)) addTo(out.byLinkSource[link], src, v);
    }
  }

  return out;
}

// Taxa de clique: cliques sobre visitas. Passa de 100% sem problema (a mesma pessoa pode clicar
// em mais de um botão na mesma visita) — é intencional, é o número que diz se a página está
// convertendo bem. Fica null sem visita registrada, em vez de fabricar um número.
function clickRate(clicks, views) {
  if (!views) return null;
  return (clicks / views) * 100;
}

// Achata { countryId: { screenId: tela } } no formato { screenId: tela } que as funções de
// agregação abaixo consomem. Com escopo 'all' e a mesma tela existindo em mais de um país (o que
// acontece quando a loja de cada mercado usa o mesmo identificador na section), os baldes diários
// são somados em vez de um país sobrescrever o outro — perder metade dos cliques em silêncio
// seria o pior resultado possível aqui. Cada tela devolvida carrega `countries` com os países que
// a alimentaram, pro card poder mostrar a procedência.
export function flattenClicks(brandClicks, countryScope = 'all') {
  const countries = countryScope && countryScope !== 'all'
    ? [countryScope]
    : Object.keys(brandClicks || {});

  const out = {};
  for (const countryId of countries) {
    for (const [screenId, screen] of Object.entries((brandClicks || {})[countryId] || {})) {
      const existing = out[screenId];
      if (!existing) {
        out[screenId] = { ...screen, days: { ...(screen.days || {}) }, countries: [countryId] };
        continue;
      }
      existing.countries.push(countryId);
      if (!existing.url) existing.url = screen.url || null;
      if (screen.lastEventAt && (!existing.lastEventAt || screen.lastEventAt > existing.lastEventAt)) {
        existing.lastEventAt = screen.lastEventAt;
      }
      for (const [date, day] of Object.entries(screen.days || {})) {
        existing.days[date] = existing.days[date] ? mergeDayBuckets(existing.days[date], day) : day;
      }
    }
  }
  return out;
}

// Soma dois baldes do mesmo dia, campo a campo. Mantém a forma exata que sumRange() espera.
function mergeDayBuckets(a, b) {
  const out = {
    views: (a.views || 0) + (b.views || 0),
    clicks: (a.clicks || 0) + (b.clicks || 0),
    byLink: { ...(a.byLink || {}) },
    bySource: { ...(a.bySource || {}) },
    byDevice: { ...(a.byDevice || {}) },
    byTheme: { ...(a.byTheme || {}) },
    byLinkSource: {},
  };
  for (const campo of ['byLink', 'bySource', 'byDevice', 'byTheme']) {
    for (const [k, v] of Object.entries(b[campo] || {})) addTo(out[campo], k, v);
  }
  for (const origem of [a.byLinkSource || {}, b.byLinkSource || {}]) {
    for (const [link, sources] of Object.entries(origem)) {
      out.byLinkSource[link] = out.byLinkSource[link] || {};
      for (const [src, v] of Object.entries(sources)) addTo(out.byLinkSource[link], src, v);
    }
  }
  return out;
}

// Painel de todas as telas rastreadas (os cards da primeira dobra).
export function computeClicksOverview(clicksStore, { days = 30 } = {}) {
  const until = todayISO();
  const since = shiftISO(until, -(days - 1));
  const prevUntil = shiftISO(since, -1);
  const prevSince = shiftISO(prevUntil, -(days - 1));

  const screens = Object.entries(clicksStore || {}).map(([screenId, screen]) => {
    const current = sumRange(screen.days || {}, since, until);
    const previous = sumRange(screen.days || {}, prevSince, prevUntil);

    return {
      screenId,
      label: screen.label || screenId,
      url: screen.url || null,
      clicks: current.clicks,
      views: current.views,
      clickRate: clickRate(current.clicks, current.views),
      deltaClicks: deltaPct(current.clicks, previous.clicks),
      links: Object.keys(current.byLink).length,
      topLink: sortedEntries(current.byLink, 1)[0] || null,
      topSource: sortedEntries(current.bySource, 1)[0] || null,
      series: current.series,
      countries: screen.countries || [],
      lastEventAt: screen.lastEventAt || null,
    };
  });

  screens.sort((a, b) => b.clicks - a.clicks);

  return {
    period: { days, since, until },
    totals: {
      clicks: screens.reduce((sum, s) => sum + s.clicks, 0),
      views: screens.reduce((sum, s) => sum + s.views, 0),
      screens: screens.length,
    },
    screens,
  };
}

// Panorama de uma tela específica (o que abre ao clicar num card).
export function computeScreenPanorama(clicksStore, screenId, { days = 30 } = {}) {
  const screen = (clicksStore || {})[screenId];
  if (!screen) return null;

  const until = todayISO();
  const since = shiftISO(until, -(days - 1));
  const prevUntil = shiftISO(since, -1);
  const prevSince = shiftISO(prevUntil, -(days - 1));

  const current = sumRange(screen.days || {}, since, until);
  const previous = sumRange(screen.days || {}, prevSince, prevUntil);

  const links = sortedEntries(current.byLink).map(({ key, value }) => ({
    label: key,
    clicks: value,
    share: current.clicks ? (value / current.clicks) * 100 : 0,
    delta: deltaPct(value, (previous.byLink || {})[key] || 0),
    bySource: sortedEntries(current.byLinkSource[key] || {}),
  }));

  return {
    screenId,
    label: screen.label || screenId,
    url: screen.url || null,
    period: { days, since, until },
    totals: {
      clicks: current.clicks,
      views: current.views,
      clickRate: clickRate(current.clicks, current.views),
      deltaClicks: deltaPct(current.clicks, previous.clicks),
      deltaViews: deltaPct(current.views, previous.views),
    },
    series: current.series,
    links,
    sources: sortedEntries(current.bySource),
    devices: sortedEntries(current.byDevice),
    themes: sortedEntries(current.byTheme),
    lastEventAt: screen.lastEventAt || null,
  };
}
