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

// Lista fixa (constitucional, nunca muda) — usada como whitelist pra extrair estado a partir da
// string de cidade da Meta (ex: "São Paulo, São Paulo (state)" → "São Paulo"), já que a API não
// expõe uma dimensão nativa de estado/província. Sem whitelist, um follower de outro país cuja
// cidade contenha uma vírgula seguida de algo parecido com nome de estado brasileiro entraria
// incorretamente no agregado.
const BR_STATES = new Set([
  'Acre', 'Alagoas', 'Amazonas', 'Amapá', 'Bahia', 'Ceará', 'Espírito Santo', 'Goiás',
  'Maranhão', 'Minas Gerais', 'Mato Grosso do Sul', 'Mato Grosso', 'Pará', 'Paraíba',
  'Pernambuco', 'Piauí', 'Paraná', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rondônia',
  'Roraima', 'Rio Grande do Sul', 'Santa Catarina', 'Sergipe', 'São Paulo', 'Tocantins',
  'Distrito Federal',
]);

function deriveState(cityKey) {
  const idx = cityKey.lastIndexOf(', ');
  if (idx === -1) return null;
  return cityKey.slice(idx + 2).replace(/\s*\(state\)\s*$/i, '').trim();
}

function buildBrStateBreakdown(cityEntries) {
  const map = new Map();
  for (const { key, value } of cityEntries || []) {
    const state = deriveState(key);
    if (state && BR_STATES.has(state)) map.set(state, (map.get(state) || 0) + value);
  }
  return [...map.entries()].map(([state, value]) => ({ state, value })).sort((a, b) => b.value - a.value);
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
    const brEntry = withData.find(a => a.countryId === 'br')?.data?.[field];
    return {
      timeframe: entries.find(d => d.timeframe)?.timeframe || null,
      byCountry: mergeBreakdown(entries.map(d => d.country)),
      byCity: mergeBreakdown(entries.map(d => d.city)),
      byAge: mergeBreakdown(entries.map(d => d.age)),
      byGender: mergeBreakdown(entries.map(d => d.gender)),
      // Drill-down por estado só existe pra Brasil por enquanto (única fonte com GeoJSON de
      // fronteiras ligado no front) — chave 'br' minúscula, mesmo padrão do countryId do resto
      // do app. Ver public/audiencia.html (STATE_SOURCES) pro consumidor.
      byState: { br: brEntry ? buildBrStateBreakdown(brEntry.city) : [] },
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
