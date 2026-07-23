// contentMetrics.js — monta o payload de /api/content: cada post/Reel com seu valor mais
// recente, o checkpoint D+7/D+14/D+30 (quando já existir histórico suficiente) e a comparação
// com a mediana de conteúdos do mesmo formato + país. Nunca estima um checkpoint que não existe.
import { getContentList } from './store.js';
import { getBrand, getDefaultBrandId, getCountries, getAdAccountId } from './registry.js';
import { fetchBoostedPermalinks } from './meta.js';
import { RETENTION_DAYS } from './contentSync.js';
import { generateText, isConfigured as aiConfigured } from './ai.js';

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

// Agregado "Orgânico × Pago" em nível de perfil/período (briefing: "sinalizar se o perfil ou
// conteúdo teve resultado predominantemente orgânico ou maior dependência de distribuição
// paga"). Pondera por alcance (reach) — um único post impulsionado pode alcançar muito mais
// gente que vários orgânicos, então contar posts sub-representaria a dependência de tráfego
// pago. Só entram itens com `latest.reach` conhecido; nunca estima o que falta.
function buildOrganicPaidSummary(items, scopedCountries, brandId, { since, until }) {
  const inPeriod = items.filter(i => {
    if (!i.meta?.publishedAt) return false;
    const d = i.meta.publishedAt.slice(0, 10);
    return (!since || d >= since) && (!until || d <= until);
  });

  const countries = scopedCountries.map(countryMeta => {
    const hasAdAccount = Boolean(getAdAccountId(brandId, countryMeta.id));
    const bucket = { organicReach: 0, boostedReach: 0, organicCount: 0, boostedCount: 0, unverifiedCount: 0 };
    for (const item of inPeriod) {
      if (item.countryId !== countryMeta.id) continue;
      const reach = item.latest?.reach;
      if (item.isBoosted === null || reach == null) { bucket.unverifiedCount++; continue; }
      if (item.isBoosted) { bucket.boostedReach += reach; bucket.boostedCount++; }
      else { bucket.organicReach += reach; bucket.organicCount++; }
    }
    const totalReach = bucket.organicReach + bucket.boostedReach;
    return {
      countryId: countryMeta.id,
      countryName: countryMeta.name,
      countryFlag: countryMeta.flag,
      hasAdAccount,
      ...bucket,
      totalReach,
      organicPct: totalReach > 0 ? (bucket.organicReach / totalReach) * 100 : null,
      boostedPct: totalReach > 0 ? (bucket.boostedReach / totalReach) * 100 : null,
    };
  });

  return {
    countries,
    // Conteúdo só é rastreado a partir da fundação da ficha (RETENTION_DAYS de janela) — se o
    // período pedido começa antes disso, uma parte real do período fica sem cobertura (não é
    // "zero orgânico", é "sem dado ainda para aquele trecho").
    partialCoverage: Boolean(since) && (Date.now() - Date.parse(since)) / 86400000 > RETENTION_DAYS,
  };
}

export async function computeContentDashboard({ brandId, country, since, until }) {
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
        // Resumo por IA (força/gargalo/recomendação) — null até alguém pedir pela tela, nunca
        // gerado sozinho no sync. Ver generateContentAiSummary() abaixo.
        aiSummary: entry.aiSummary || null,
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
    organicPaid: buildOrganicPaidSummary(items, scopedCountries, brandId, { since, until }),
  };
}

// ── Resumo por IA (força/gargalo/recomendação) ──────────────────────────────────────────────
// Só chamado quando alguém clica "Gerar resumo" na tela — nunca automático no sync (custaria
// dinheiro sem necessidade e analisaria post com dado ainda incompleto). Recebe um item já
// montado por computeContentDashboard (reaproveita toda a lógica de vsMedian/checkpoint/isBoosted
// já calculada ali, em vez de duplicar).
const RECOMENDACAO_VALUES = ['repetir', 'adaptar', 'testar', 'nao_priorizar'];

const AI_SUMMARY_SYSTEM_PROMPT = `Você é um analista de social media da marca Coco and Luna (suplementos pet), avaliando o desempenho de UM post/Reels do Instagram pra equipe de marketing.
Responda SOMENTE com um JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:
{"forca": "...", "gargalo": "...", "comparacao": "...", "hipotese": "...", "recomendacao": "repetir|adaptar|testar|nao_priorizar", "recomendacaoTexto": "..."}
Regras:
- Português do Brasil, tom direto e objetivo, cada campo com 3-5 frases — desenvolva o raciocínio
  (cite os números relevantes, explique o porquê, não só afirme) em vez de uma frase solta genérica.
- "forca": a métrica ou aspecto que mais se destacou positivamente, com os números que sustentam isso.
- "gargalo": o principal ponto fraco ou limitação do resultado, com números quando houver.
- "comparacao": como esse conteúdo se saiu frente à mediana do grupo, métrica por métrica quando fizer
  sentido (cite os percentuais disponíveis, não só um resumo genérico de "acima/abaixo da mediana").
- "hipotese": uma ou duas hipóteses plausíveis pro resultado (formato, gancho, horário, tema — baseada
  só no que foi informado, nunca inventada do nada), explicando o raciocínio por trás de cada uma.
- "recomendacao": escolha exatamente um valor entre repetir, adaptar, testar, nao_priorizar.
- "recomendacaoTexto": 2-4 frases justificando a recomendação com base no que foi observado acima.
- Se faltar dado (sem checkpoint D+7 ainda, grupo de comparação pequeno/inexistente), diga isso
  explicitamente no campo relevante em vez de inventar — nunca estime um número que não foi informado.`;

function buildAiSummaryPrompt(item) {
  const ctx = item.context || {};
  const lines = [];
  lines.push(`Formato: ${item.formatLabel || item.meta.mediaProductType}`);
  lines.push(`Publicado há ${item.ageDays} dia(s)`);
  if (item.isBoosted === true) lines.push('Impulsionado: sim (teve distribuição paga além do orgânico).');
  else if (item.isBoosted === false) lines.push('Impulsionado: não (totalmente orgânico, sem impulsionamento detectado).');
  else lines.push('Impulsionado: não verificável (sem conta de anúncio configurada pra esse país).');
  if (ctx.tema) lines.push(`Tema: ${ctx.tema}`);
  if (ctx.objetivo) lines.push(`Objetivo: ${ctx.objetivo}`);
  if (ctx.pilar) lines.push(`Pilar: ${ctx.pilar}`);
  if (ctx.produto) lines.push(`Produto: ${ctx.produto}`);
  if (ctx.gancho) lines.push(`Gancho: ${ctx.gancho}`);
  if (ctx.cta) lines.push(`CTA: ${ctx.cta}`);
  if (ctx.observacao) lines.push(`Observação da equipe: ${ctx.observacao}`);
  if (item.meta.caption) lines.push(`Legenda: ${item.meta.caption.slice(0, 300)}`);

  lines.push('\nMétricas atuais (lifetime até agora):');
  const m = item.latest || {};
  for (const k of METRIC_KEYS) lines.push(`- ${k}: ${m[k] ?? 'sem dado'}`);

  for (const [days, cp] of [[7, item.checkpoint7], [14, item.checkpoint14], [30, item.checkpoint30]]) {
    lines.push(`\nCheckpoint D+${days}: ${cp ? JSON.stringify(cp) : 'ainda não disponível — não estime, diga que falta esse dado'}`);
  }

  lines.push(`\nComparação com a mediana de ${item.groupSize} conteúdo(s) orgânico(s) do mesmo formato/país:`);
  for (const [k, v] of Object.entries(item.vsMedian || {})) {
    lines.push(`- ${k}: ${v == null ? 'sem comparação possível' : v.toFixed(1) + '% vs. mediana'}`);
  }

  return lines.join('\n');
}

export async function generateContentAiSummary(item) {
  if (!aiConfigured()) throw new Error('ANTHROPIC_API_KEY não configurado no servidor.');
  const prompt = buildAiSummaryPrompt(item);
  // Histórico de truncamento nesse campo (nunca JSON de verdade inválido, sempre cortado no meio):
  // 500 → 1000 (22/07/2026) → 1600 (23/07/2026, quando os campos passaram a pedir 3-5 frases em vez
  // de 1-2) → **3500** (23/07/2026, mesmo dia: confirmado ao vivo que 1600 ainda cortava no meio do
  // 4º de 6 campos pra um post com bastante dado real — a resposta cresceu mais do que o esperado
  // com o novo tamanho de frase pedido). Sempre que esse erro voltar a aparecer, é sinal de que o
  // texto pedido no system prompt ficou maior de novo — aumentar aqui, não assumir "resposta
  // inválida" sem checar o raw primeiro (usar um throw temporário com o raw, nunca redescobrir do
  // zero — ver histórico desta sessão).
  const raw = await generateText(prompt, { system: AI_SUMMARY_SYSTEM_PROMPT, maxTokens: 3500 });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('A IA não respondeu em JSON válido — tente gerar de novo.');
  }
  if (!RECOMENDACAO_VALUES.includes(parsed.recomendacao)) parsed.recomendacao = null;
  return {
    forca: parsed.forca || null,
    gargalo: parsed.gargalo || null,
    comparacao: parsed.comparacao || null,
    hipotese: parsed.hipotese || null,
    recomendacao: parsed.recomendacao,
    recomendacaoTexto: parsed.recomendacaoTexto || null,
    generatedAt: new Date().toISOString(),
  };
}
