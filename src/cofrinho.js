// cofrinho.js — Cofrinho do Social: vendas rastreadas por cupom/link específico do Social,
// enviadas manualmente pelo setor responsável (print, planilha, relatório ou informação
// confirmada). Nunca analisa investimento nem operação de loja — só soma o que foi informado.
import { getCofrinhoEntries, getCofrinhoGoals } from './store.js';
import { getBrand, getDefaultBrandId, getCountries } from './registry.js';

const METRIC_LABELS = { vendas: 'Vendas rastreadas', faturamento: 'Faturamento informado' };

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function daysUntil(deadline) {
  const target = Date.parse(deadline + 'T00:00:00Z');
  const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((target - today) / 86400000);
}

function sum(values) {
  const nums = values.filter(v => v != null);
  return nums.length ? nums.reduce((a, v) => a + v, 0) : 0;
}

function buildCountryCofrinho(brandId, countryId) {
  const entries = [...getCofrinhoEntries(brandId, countryId)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const faturamentoEntries = entries.filter(e => e.faturamento != null);
  const totals = {
    usos: sum(entries.map(e => e.usos)),
    vendas: sum(entries.map(e => e.vendas)),
    faturamento: faturamentoEntries.length ? sum(faturamentoEntries.map(e => e.faturamento)) : null,
    faturamentoCount: faturamentoEntries.length,
    entryCount: entries.length,
  };

  const goals = getCofrinhoGoals(brandId, countryId);
  const currentGoal = goals[goals.length - 1] || null;
  const goalHistory = goals.slice(0, -1);

  let goal = null;
  if (currentGoal) {
    const currentValue = totals[currentGoal.metric] ?? 0;
    const achieved = currentValue >= currentGoal.target;
    const remaining = Math.max(0, currentGoal.target - currentValue);
    const progressPct = currentGoal.target > 0 ? Math.min(100, (currentValue / currentGoal.target) * 100) : null;
    const daysLeft = daysUntil(currentGoal.deadline);
    const dailyPaceNeeded = (!achieved && daysLeft > 0) ? remaining / daysLeft : null;
    goal = { ...currentGoal, currentValue, achieved, remaining, progressPct, daysLeft, dailyPaceNeeded };
  }

  return { entries, totals, goal, goalHistory };
}

export function computeCofrinhoDashboard({ brandId, country }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const allCountries = getCountries(brandId);
  const scopedCountries = country && country !== 'all' ? allCountries.filter(c => c.id === country) : allCountries;

  const items = scopedCountries.map(countryMeta => ({
    countryId: countryMeta.id,
    countryName: countryMeta.name,
    countryFlag: countryMeta.flag,
    ...buildCountryCofrinho(brandId, countryMeta.id),
  }));

  return {
    brand: { id: brandId, name: brand?.name || null },
    scope: { country: country && country !== 'all' ? country : 'all' },
    metricLabels: METRIC_LABELS,
    items,
  };
}
