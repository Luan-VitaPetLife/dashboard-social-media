// storyMetrics.js — monta o payload de /api/stories: cada story rastreado com a amostra mais
// recente, a primeira amostra (pra medir evolução dentro da janela observada) e todas as
// amostras (linha do tempo). Só mantém na lista stories publicados nas últimas 48h — depois
// disso o story já expirou de verdade e a última amostra é só um retrato final, não algo "ao vivo".
import { getStoriesList } from './store.js';
import { getBrand, getDefaultBrandId, getCountries } from './registry.js';

const RETENTION_HOURS = 48;
const METRIC_KEYS = ['reach', 'replies', 'navigation', 'shares', 'totalInteractions', 'profileActivity', 'follows'];

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function computeStoriesDashboard({ brandId, country }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  const cutoff = Date.now() - RETENTION_HOURS * 3600000;
  const items = [];

  for (const countryMeta of scopedCountries) {
    const list = getStoriesList(brandId, countryMeta.id);
    for (const [storyId, entry] of Object.entries(list)) {
      const publishedMs = Date.parse(entry.meta.timestamp);
      if (publishedMs < cutoff) continue;

      const samples = [...entry.samples].sort((a, b) => Date.parse(a.polledAt) - Date.parse(b.polledAt));
      const first = samples[0] || null;
      const latest = samples[samples.length - 1] || null;
      const ageHours = (Date.now() - publishedMs) / 3600000;

      // Com uma amostra só, "crescimento" não existe ainda (first === latest) — fica null em vez
      // de fabricar um "0%" que pareceria uma leitura real de estabilidade.
      const growth = {};
      for (const k of METRIC_KEYS) growth[k] = (samples.length >= 2) ? pct(first[k], latest[k]) : null;

      items.push({
        storyId,
        countryId: countryMeta.id,
        countryName: countryMeta.name,
        countryFlag: countryMeta.flag,
        meta: entry.meta,
        ageHours,
        expired: ageHours >= 24,
        sampleCount: samples.length,
        first, latest, samples, growth,
      });
    }
  }

  items.sort((a, b) => Date.parse(b.meta.timestamp) - Date.parse(a.meta.timestamp));

  return {
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    retentionHours: RETENTION_HOURS,
    items,
  };
}
