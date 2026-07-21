// contentMetrics.js — monta o payload de /api/content: cada post/Reel com seu valor mais
// recente, o checkpoint D+7/D+14/D+30 (quando já existir histórico suficiente) e a comparação
// com a mediana de conteúdos do mesmo formato + país. Nunca estima um checkpoint que não existe.
import { getContentList } from './store.js';
import { getBrand, getDefaultBrandId, getCountries, getAdAccountId } from './registry.js';
import { fetchBoostedPermalinks } from './meta.js';

const METRIC_KEYS = ['reach', 'likes', 'comments', 'saved', 'shares', 'totalInteractions', 'views'];

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function median(values) {
  const nums = values.filter(v => v != null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function latestSnapshot(snapshots) {
  const dates = Object.keys(snapshots).sort();
  if (!dates.length) return null;
  const date = dates[dates.length - 1];
  return { date, data: snapshots[date] };
}

// Snapshot mais próximo de `targetDays` após a publicação, sem ultrapassar hoje — null se ainda
// não há nenhum snapshot a partir desse dia (não interpola, não estima).
function checkpointSnapshot(snapshots, publishedAt, targetDays) {
  const dates = Object.keys(snapshots).sort();
  if (!dates.length) return null;
  const publishedMs = Date.parse(publishedAt);
  const targetMs = publishedMs + targetDays * 86400000;
  let candidate = null;
  for (const date of dates) {
    if (Date.parse(date + 'T00:00:00Z') >= targetMs) { candidate = date; break; }
  }
  if (!candidate) return null;
  return { date: candidate, data: snapshots[candidate] };
}

const FORMAT_LABELS = {
  'REELS': 'Reels',
  'CAROUSEL_ALBUM': 'Carrossel',
  'IMAGE': 'Estático',
  'VIDEO': 'Vídeo',
};

export async function computeContentDashboard({ brandId, country }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  // Permalinks impulsionados por país (via Marketing API — ver fetchBoostedPermalinks em
  // meta.js), buscados uma vez por país em escopo antes de montar os itens.
  const boostedByCountry = new Map();
  for (const countryMeta of scopedCountries) {
    const adAccountId = getAdAccountId(brandId, countryMeta.id);
    boostedByCountry.set(countryMeta.id, adAccountId ? await fetchBoostedPermalinks(adAccountId).catch(() => new Set()) : new Set());
  }

  const items = [];
  for (const countryMeta of scopedCountries) {
    const list = getContentList(brandId, countryMeta.id);
    const boosted = boostedByCountry.get(countryMeta.id);
    for (const [mediaId, entry] of Object.entries(list)) {
      const latest = latestSnapshot(entry.snapshots);
      const ageDays = Math.floor((Date.now() - Date.parse(entry.meta.publishedAt)) / 86400000);
      const permalink = (entry.meta.permalink || '').replace(/\/$/, '');
      items.push({
        mediaId,
        countryId: countryMeta.id,
        countryName: countryMeta.name,
        countryFlag: countryMeta.flag,
        meta: entry.meta,
        context: entry.context || {},
        formatLabel: FORMAT_LABELS[entry.meta.mediaProductType] || FORMAT_LABELS[entry.meta.mediaType] || entry.meta.mediaProductType,
        ageDays,
        // Orgânico×pago: só sinalizamos quando a conta de anúncio está configurada pra esse país
        // (ver META_AD_ACCOUNT_ID_BR/US) — sem isso, `isBoosted` fica null (limitação, não "não
        // impulsionado"), nunca assumimos orgânico por padrão.
        isBoosted: getAdAccountId(brandId, countryMeta.id) ? boosted.has(permalink) : null,
        latest: latest?.data || null,
        latestDate: latest?.date || null,
        checkpoint7: checkpointSnapshot(entry.snapshots, entry.meta.publishedAt, 7)?.data || null,
        checkpoint14: checkpointSnapshot(entry.snapshots, entry.meta.publishedAt, 14)?.data || null,
        checkpoint30: checkpointSnapshot(entry.snapshots, entry.meta.publishedAt, 30)?.data || null,
      });
    }
  }

  // Mediana por grupo (formato + país) — só entre conteúdos equivalentes, como pede o briefing.
  // Conteúdo impulsionado NÃO entra no cálculo da mediana (briefing: "conteúdos impulsionados
  // devem ser identificados para não entrar no mesmo ranking dos totalmente orgânicos") — mas
  // ainda aparece na lista e ganha um vsMedian próprio, comparado contra essa mediana orgânica.
  // Usa o valor mais recente de cada item do grupo (não uma comparação D+7-a-D+7 estrita).
  const groups = new Map();
  for (const item of items) {
    if (item.isBoosted) continue;
    const key = `${item.countryId}::${item.meta.mediaProductType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const mediansByGroup = new Map();
  for (const [key, groupItems] of groups) {
    const medians = {};
    for (const k of METRIC_KEYS) medians[k] = median(groupItems.map(i => i.latest?.[k]));
    mediansByGroup.set(key, medians);
  }

  for (const item of items) {
    const key = `${item.countryId}::${item.meta.mediaProductType}`;
    const medians = mediansByGroup.get(key) || {};
    const vsMedian = {};
    for (const k of METRIC_KEYS) vsMedian[k] = item.latest ? pct(medians[k], item.latest[k]) : null;
    item.vsMedian = vsMedian;
    item.groupMedian = medians;
    item.groupSize = groups.get(key)?.length || 0;
  }

  items.sort((a, b) => Date.parse(b.meta.publishedAt) - Date.parse(a.meta.publishedAt));

  return {
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    items,
  };
}
