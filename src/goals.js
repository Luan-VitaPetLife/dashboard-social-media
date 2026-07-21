// goals.js — bateria de crescimento: meta editável por marca/país/conta/rede, com progresso,
// quanto falta, prazo e ritmo necessário. "Atingida" é sempre calculado ao vivo comparando a
// meta com o snapshot mais recente — nunca gravado, pra não precisar de uma segunda escrita
// exatamente no dia em que a meta é batida (e pra continuar correto se o valor cair depois).
import { getGoals, getSnapshots } from './store.js';
import { getBrand, getDefaultBrandId, getCountries, getAccounts } from './registry.js';

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook' };
const METRIC_LABELS = { followers: 'Seguidores' };

function latestValue(brandId, platform, countryId, metric) {
  const all = getSnapshots(brandId, platform, countryId);
  const dates = Object.keys(all).sort();
  if (!dates.length) return null;
  const last = all[dates[dates.length - 1]];
  return last[metric] ?? null;
}

function daysUntil(deadline) {
  const target = Date.parse(deadline + 'T00:00:00Z');
  const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((target - today) / 86400000);
}

function buildAccountGoal(brandId, countryId, platform, metric) {
  const goals = getGoals(brandId, countryId, platform).filter(g => g.metric === metric);
  const current = goals[goals.length - 1] || null;
  const history = goals.slice(0, -1);
  const currentValue = latestValue(brandId, platform, countryId, metric);

  if (!current) {
    return { platform, metric, current: null, history, currentValue };
  }

  const achieved = currentValue != null && currentValue >= current.target;
  const remaining = currentValue != null ? Math.max(0, current.target - currentValue) : null;
  const progressPct = currentValue != null && current.target > 0 ? Math.min(100, (currentValue / current.target) * 100) : null;
  const daysLeft = daysUntil(current.deadline);
  // Ritmo necessário: quanto precisa ganhar por dia até o prazo pra bater a meta. Sem dado
  // atual, prazo já vencido ou meta já batida, não faz sentido calcular — fica null (nunca
  // um número fabricado sobre uma divisão que não faz sentido).
  const dailyPaceNeeded = (!achieved && remaining != null && daysLeft > 0) ? remaining / daysLeft : null;

  return {
    platform, metric,
    current: { ...current, achieved, remaining, progressPct, daysLeft, dailyPaceNeeded },
    history, currentValue,
  };
}

export function computeGoalsDashboard({ brandId, country }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  const items = [];
  for (const countryMeta of scopedCountries) {
    for (const account of getAccounts(brandId, countryMeta.id)) {
      items.push({
        countryId: countryMeta.id,
        countryName: countryMeta.name,
        countryFlag: countryMeta.flag,
        platform: account.platform,
        platformLabel: PLATFORM_LABELS[account.platform] || account.platform,
        // Só "seguidores" na v1 — é o exemplo do briefing e a única métrica com histórico
        // diário confiável pras duas plataformas hoje.
        goal: buildAccountGoal(brandId, countryMeta.id, account.platform, 'followers'),
      });
    }
  }

  return {
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    metricLabels: METRIC_LABELS,
    items,
  };
}
