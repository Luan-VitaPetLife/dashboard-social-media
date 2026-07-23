// audience.js — geografia/demografia de audiência do Instagram (país, cidade, idade, gênero dos
// seguidores, e de quem interagiu/foi alcançado quando há atividade recente o bastante). Nunca
// estima: cada métrica só aparece se a Graph API confirmou dado pra ela (ver
// fetchInstagramAudienceDemographics em meta.js). Combina as contas em escopo somando por chave
// (país/cidade/etc.) quando o escopo pede mais de um país da marca — uma pessoa que segue tanto
// a conta BR quanto a US contaria duas vezes, mas a Meta não expõe um jeito de deduplicar isso
// entre contas diferentes, então "combinado" é a melhor aproximação disponível, não um total
// exato de audiência única.
import { getBrand, getDefaultBrandId, getCountries, getAccounts } from './registry.js';
import { fetchInstagramAudienceDemographics } from './meta.js';

function mergeBreakdown(lists) {
  const map = new Map();
  for (const arr of lists) {
    if (!arr) continue;
    for (const { key, value } of arr) map.set(key, (map.get(key) || 0) + value);
  }
  return [...map.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export async function computeAudienceDashboard({ brandId, country }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  const perAccount = [];
  for (const countryMeta of scopedCountries) {
    const igAccount = getAccounts(brandId, countryMeta.id).find(a => a.platform === 'instagram');
    if (!igAccount) continue;
    const data = await fetchInstagramAudienceDemographics(igAccount.metaId).catch(() => null);
    perAccount.push({ countryId: countryMeta.id, countryName: countryMeta.name, countryFlag: countryMeta.flag, data });
  }

  const withData = perAccount.filter(a => a.data);

  function buildMetric(field) {
    const entries = withData.map(a => a.data[field]).filter(Boolean);
    if (!entries.length) return null;
    return {
      timeframe: entries.find(d => d.timeframe)?.timeframe || null,
      byCountry: mergeBreakdown(entries.map(d => d.country)),
      byCity: mergeBreakdown(entries.map(d => d.city)),
      byAge: mergeBreakdown(entries.map(d => d.age)),
      byGender: mergeBreakdown(entries.map(d => d.gender)),
    };
  }

  return {
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    accounts: perAccount.map(a => ({ countryId: a.countryId, countryName: a.countryName, countryFlag: a.countryFlag, hasData: Boolean(a.data) })),
    metrics: {
      followers: buildMetric('followers'),
      engaged: buildMetric('engaged'),
      reached: buildMetric('reached'),
    },
  };
}
