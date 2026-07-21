// metrics.js — monta o payload de /api/dashboard: valor atual, comparação com o período
// anterior de mesmo tamanho (ex: últimos 7 dias vs. os 7 dias antes desses) e série pro
// gráfico de tendência, por plataforma e país — dentro do escopo de marca/país pedido.
//
// Seguidores/curtidas de página são um contador (gauge), não um total somável como receita —
// "o valor no período" é o último snapshot dentro da janela, e "vs. período anterior" compara
// esse valor com o último snapshot da janela imediatamente anterior, de mesmo tamanho. Sem
// snapshot na janela anterior (conta muito nova, ainda sem 2 períodos de histórico), o delta
// fica null ("—") em vez de fabricar um número.
import { getSnapshotsInRange } from './store.js';
import { fetchInstagramEngagement, fetchFacebookVideoViews } from './meta.js';
import { getBrand, getDefaultBrandId, getCountries, getAccounts } from './registry.js';

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

function lastValueInRange(brandId, platform, countryId, since, until) {
  const entries = getSnapshotsInRange(brandId, platform, countryId, since, until);
  if (!entries.length) return null;
  return entries[entries.length - 1][1];
}

function buildEntity(brandId, platform, countryId, since, until, prevSince, prevUntil) {
  const keys = platform === 'instagram' ? IG_KEYS : FB_KEYS;
  const entries = getSnapshotsInRange(brandId, platform, countryId, since, until);
  const series = { dates: entries.map(([d]) => d) };
  for (const k of keys) series[k] = entries.map(([, v]) => v[k] ?? null);

  const previous = lastValueInRange(brandId, platform, countryId, prevSince, prevUntil);

  if (!entries.length) return { latest: null, previous, delta: {}, series };

  const [lastDate, last] = entries[entries.length - 1];
  const delta = {};
  for (const k of keys) delta[k] = previous ? pct(previous[k], last[k]) : null;

  return { latest: { ...last, date: lastDate }, previous, delta, series };
}

// Combina o valor mais recente de cada país em escopo (atual e do período anterior) pro KPI
// agregado — país sem dado em algum dos dois momentos entra como 0 na soma, mas só calcula
// delta se pelo menos um país tinha algo no período anterior (senão "apareceu do nada"
// pareceria crescimento infinito).
function combinedKpi(entities, key) {
  const values = entities.map(e => e.latest?.[key]);
  if (values.every(v => v == null)) return { value: null, previousValue: null, deltaPct: null };
  const value = values.reduce((a, v) => a + (v ?? 0), 0);

  const prevValues = entities.map(e => e.previous?.[key]);
  const previousValue = prevValues.every(v => v == null) ? null : prevValues.reduce((a, v) => a + (v ?? 0), 0);
  const deltaPct = previousValue != null ? pct(previousValue, value) : null;

  return { value, previousValue, deltaPct };
}

// Soma curtidas/comentários/visualizações do período (Instagram) ou visualizações de vídeo
// (Facebook) de todos os países em escopo, com delta vs. o mesmo cálculo no período anterior —
// busca ao vivo na Insights API (cache de 5 min em meta.js), diferente de buildEntity (que vem
// do snapshot diário já salvo no store).
function sumWithDelta(currentValues, previousValues) {
  if (currentValues.every(v => v == null)) return { value: null, previousValue: null, deltaPct: null };
  const value = currentValues.reduce((a, v) => a + (v ?? 0), 0);
  const previousValue = previousValues.every(v => v == null) ? null : previousValues.reduce((a, v) => a + (v ?? 0), 0);
  return { value, previousValue, deltaPct: previousValue != null ? pct(previousValue, value) : null };
}

// brandId default = marca padrão do registry. `country` = um país específico ('br', 'us', ...)
// ou 'all'/ausente = todos os países da marca. since/until = período atual. cmpSince/cmpUntil =
// período de comparação escolhido manualmente no card de Comparação — ausentes, cai no
// automático (período anterior de mesmo tamanho).
export async function computeSocialDashboard({ brandId, country, since, until, cmpSince, cmpUntil }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  const auto = previousPeriod(since, until);
  const prevSince = cmpSince || auto.prevSince;
  const prevUntil = cmpUntil || auto.prevUntil;

  const perCountry = await Promise.all(scopedCountries.map(async countryMeta => {
    const accounts = getAccounts(brandId, countryMeta.id);
    const igAccount = accounts.find(a => a.platform === 'instagram');
    const fbAccount = accounts.find(a => a.platform === 'facebook');

    const instagram = buildEntity(brandId, 'instagram', countryMeta.id, since, until, prevSince, prevUntil);
    const facebook = buildEntity(brandId, 'facebook', countryMeta.id, since, until, prevSince, prevUntil);

    const [igEng, igEngPrev, fbVid, fbVidPrev] = await Promise.all([
      igAccount ? fetchInstagramEngagement(igAccount.metaId, since, until).catch(() => null) : null,
      igAccount ? fetchInstagramEngagement(igAccount.metaId, prevSince, prevUntil).catch(() => null) : null,
      fbAccount ? fetchFacebookVideoViews(fbAccount.metaId, since, until).catch(() => null) : null,
      fbAccount ? fetchFacebookVideoViews(fbAccount.metaId, prevSince, prevUntil).catch(() => null) : null,
    ]);

    instagram.engagement = igEng;
    facebook.videoViews = fbVid?.videoViews ?? null;

    return { id: countryMeta.id, name: countryMeta.name, flag: countryMeta.flag, instagram, facebook, igEngPrev, fbVidPrev };
  }));

  const byCountry = {};
  for (const c of perCountry) {
    byCountry[c.id] = { id: c.id, name: c.name, flag: c.flag, instagram: c.instagram, facebook: c.facebook };
  }

  return {
    period: { since, until, prevSince, prevUntil },
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    byCountry,
    combined: {
      igFollowers: combinedKpi(perCountry.map(c => c.instagram), 'followers'),
      igLikes:     sumWithDelta(perCountry.map(c => c.instagram.engagement?.likes), perCountry.map(c => c.igEngPrev?.likes)),
      igViews:     sumWithDelta(perCountry.map(c => c.instagram.engagement?.views), perCountry.map(c => c.igEngPrev?.views)),
      fbLikes:     combinedKpi(perCountry.map(c => c.facebook), 'likes'),
      fbFollowers: combinedKpi(perCountry.map(c => c.facebook), 'followers'),
      fbVideoViews: sumWithDelta(perCountry.map(c => c.facebook.videoViews), perCountry.map(c => c.fbVidPrev?.videoViews)),
    },
  };
}
