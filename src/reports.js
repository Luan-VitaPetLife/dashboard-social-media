// reports.js — os 5 tipos de relatório do briefing da Aline (D+7 por conteúdo, Stories 24h,
// mensal por país, mensal por rede, mensal geral). Cada `build*Report()` monta o mesmo "modelo
// genérico" consumido por src/reportRenderer.js (title/subtitle/sections) reaproveitando os
// dashboards que já existem (contentMetrics/storyMetrics/goals/cofrinho/metrics) — nunca
// recalcula métrica nenhuma por conta própria. `generateReport()` é o dispatcher usado pela rota
// manual; `checkAutoReports()` é chamado periodicamente pelo agendador (server.js) e nunca gera
// o mesmo relatório duas vezes (dedupe via reportExists, ver store.js).
import { getBrand, getBrands, getDefaultBrandId, getCountries } from './registry.js';
import { computeSocialDashboard } from './metrics.js';
import { computeContentDashboard, generateContentAiSummary } from './contentMetrics.js';
import { computeStoriesDashboard } from './storyMetrics.js';
import { computeGoalsDashboard } from './goals.js';
import { computeCofrinhoDashboard } from './cofrinho.js';
import { generateText, isConfigured as aiConfigured } from './ai.js';
import { setContentAiSummary, reportExists, addReport, getSchedules, updateSchedule } from './store.js';
import { fmtNum, fmtPct, fmtDateBR, fmtDateTimeBR } from './reportTemplate.js';

const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook' };
const RECOMENDACAO_LABEL = { repetir: 'Repetir', adaptar: 'Adaptar', testar: 'Testar novamente', nao_priorizar: 'Não priorizar' };
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

function previousMonthKey() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-based; mês anterior a janeiro (m=0) é dezembro do ano anterior
  const prevM = m === 0 ? 12 : m;
  const prevY = m === 0 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// since = dia 1 do mês; until = último dia do mês, ou hoje se o mês ainda não terminou (relatório
// gerado manualmente pro mês corrente) — isPartial sinaliza isso na tela/relatório em vez de
// fingir que o período está completo.
function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const since = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const untilFull = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  const todayISO = new Date().toISOString().slice(0, 10);
  const until = untilFull < todayISO ? untilFull : todayISO;
  return { since, until, isPartial: until !== untilFull };
}

function contextLine(context = {}) {
  const parts = [];
  if (context.tema) parts.push(`Tema: ${context.tema}`);
  if (context.objetivo) parts.push(`Objetivo: ${context.objetivo}`);
  if (context.pilar) parts.push(`Pilar: ${context.pilar}`);
  if (context.produto) parts.push(`Produto: ${context.produto}`);
  if (context.gancho) parts.push(`Gancho: ${context.gancho}`);
  if (context.cta) parts.push(`CTA: ${context.cta}`);
  if (context.observacao) parts.push(`Observação: ${context.observacao}`);
  return parts.length ? parts.join(' · ') : null;
}

// Duas causas bem diferentes pro mesmo "não tem texto de IA": nunca confundir uma com a outra
// no relatório final — "não configurado" é um problema de configuração do servidor; "falhou" é
// uma chamada real que deu erro (chave inválida/revogada, rate limit, rede) e vale investigar.
function aiFallbackText(errored) {
  if (!aiConfigured()) return 'ANTHROPIC_API_KEY não configurado no servidor. Este texto não pôde ser gerado por IA.';
  if (errored) return 'A chamada à IA falhou ao gerar este texto (ver log do servidor). Tente gerar o relatório de novo mais tarde.';
  return 'ANTHROPIC_API_KEY não configurado no servidor. Este texto não pôde ser gerado por IA.';
}

// ── D+7 por conteúdo ────────────────────────────────────────────────────────────────────────
export async function buildD7Report({ brandId, countryId, mediaId }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const dashboard = await computeContentDashboard({ brandId, country: countryId });
  const item = dashboard.items.find(i => i.mediaId === mediaId);
  if (!item) throw new Error('Conteúdo não encontrado.');

  let aiSummary = item.aiSummary;
  let aiErrored = false;
  if (!aiSummary && aiConfigured()) {
    try {
      aiSummary = await generateContentAiSummary(item);
      setContentAiSummary(brandId, countryId, mediaId, aiSummary);
    } catch (e) {
      console.error('IA falhou (resumo D+7):', e.message);
      aiErrored = true;
    }
  }

  const m = item.latest || {};
  const vm = item.vsMedian || {};
  const row = (label, key) => [label, fmtNum(m[key]), vm[key] != null ? fmtPct(vm[key]) : '—'];

  const sections = [];
  const contextTxt = contextLine(item.context);
  sections.push({
    heading: 'Contexto',
    paragraphs: [
      `Formato: ${item.formatLabel}. Publicado em ${fmtDateBR(item.meta.publishedAt)} (${item.ageDays} dia(s) atrás). Comparado com ${item.groupSize} conteúdo(s) orgânico(s) do mesmo formato/país.`,
      contextTxt,
    ].filter(Boolean),
  });

  sections.push({ heading: 'Distribuição', table: { columns: ['Métrica', 'Atual', 'vs. mediana'], rows: [row('Alcance', 'reach'), row('Visualizações', 'views')] } });
  sections.push({
    heading: 'Interação',
    table: {
      columns: ['Métrica', 'Atual', 'vs. mediana'],
      rows: [row('Curtidas', 'likes'), row('Comentários', 'comments'), row('Compartilhamentos', 'shares'), row('Salvamentos', 'saved'), row('Interações totais', 'totalInteractions')],
    },
  });

  if (item.meta.mediaProductType === 'REELS' || item.meta.mediaProductType === 'VIDEO') {
    sections.push({
      heading: 'Vídeo',
      callout: { label: 'Limitação da API', text: 'Força do gancho, tempo assistido, retenção e conclusão não são fornecidos pela API atual do Instagram para este conteúdo.' },
    });
  }

  sections.push({
    heading: 'Ação',
    callout: { label: 'Limitação da API', text: 'Visitas, cliques e seguidores atribuídos só existem em nível de conta na API do Instagram, não por publicação individual. Não é possível atribuir essa ação a este conteúdo especificamente.' },
  });

  if (aiSummary) {
    sections.push({
      heading: 'Resumo da IA',
      paragraphs: [
        aiSummary.forca ? `Força: ${aiSummary.forca}` : null,
        aiSummary.gargalo ? `Gargalo: ${aiSummary.gargalo}` : null,
        aiSummary.comparacao ? `Comparação: ${aiSummary.comparacao}` : null,
        aiSummary.hipotese ? `Hipótese: ${aiSummary.hipotese}` : null,
      ].filter(Boolean),
      callout: { label: `Recomendação: ${RECOMENDACAO_LABEL[aiSummary.recomendacao] || 'não determinada'}`, text: aiSummary.recomendacaoTexto || '—' },
    });
  } else {
    sections.push({ heading: 'Resumo da IA', callout: { label: 'Não disponível', text: aiFallbackText(aiErrored) } });
  }

  const model = {
    title: `Relatório D+7 · ${item.formatLabel}`,
    subtitle: `${brand?.name || ''} · Instagram · ${item.countryName} · Publicado em ${fmtDateBR(item.meta.publishedAt)}`,
    brandName: brand?.name,
    countryLabel: item.countryName,
    sections,
  };

  return { model, periodKey: mediaId, scopeLabel: `${item.formatLabel} · ${item.countryName}` };
}

// ── Stories 24h ─────────────────────────────────────────────────────────────────────────────
async function buildStoryLearning(item) {
  if (!aiConfigured()) return { text: null, errored: false };
  const prompt = `Story do Instagram, formato ${item.meta.mediaType || 'desconhecido'}, publicado há ${Math.round(item.ageHours)}h.
Métricas da última leitura: alcance ${item.latest?.reach ?? 'sem dado'}, respostas ${item.latest?.replies ?? 'sem dado'}, navegação (avanços+voltas+saídas somados) ${item.latest?.navigation ?? 'sem dado'}, interações totais ${item.latest?.totalInteractions ?? 'sem dado'}.
${item.sampleCount >= 2 ? `Evolução entre a primeira e a última leitura: ${JSON.stringify(item.growth)}.` : 'Só existe uma leitura até agora — não é possível medir evolução dentro da janela observada.'}
Escreva em português do Brasil, 2-3 frases, um aprendizado direto sobre esse story para a equipe de social media, baseado só nesses números. Nunca invente retenção tela a tela, motivo de queda ou desempenho de CTA — a API não fornece isso, diga que não está disponível se for relevante.`;
  try { return { text: await generateText(prompt, { maxTokens: 300 }), errored: false }; }
  catch (e) { console.error('IA falhou (aprendizado de story):', e.message); return { text: null, errored: true }; }
}

export async function buildStoriesReport({ brandId, countryId, storyId }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const dashboard = computeStoriesDashboard({ brandId, country: countryId });
  const item = dashboard.items.find(i => i.storyId === storyId);
  if (!item) throw new Error('Story não encontrado.');

  const l = item.latest || {};
  const g = item.growth || {};
  const row = (label, key) => [label, fmtNum(l[key]), g[key] != null ? fmtPct(g[key]) : '—'];

  const sections = [
    {
      heading: 'Contexto',
      paragraphs: [`Formato: ${item.meta.mediaType || '—'}. Publicado em ${fmtDateTimeBR(item.meta.timestamp)}, ${item.expired ? 'expirado' : `há ${Math.round(item.ageHours)}h`}. ${item.sampleCount} leitura(s) capturada(s).`],
    },
    {
      heading: 'Métricas',
      table: {
        columns: ['Métrica', 'Última leitura', 'Evolução na janela observada'],
        rows: [row('Alcance', 'reach'), row('Respostas', 'replies'), row('Navegação (avanços+voltas+saídas)', 'navigation'), row('Compartilhamentos', 'shares'), row('Interações totais', 'totalInteractions'), row('Atividade no perfil', 'profileActivity'), row('Seguidores atribuídos', 'follows')],
      },
    },
    {
      heading: 'Limitações conhecidas',
      callout: {
        label: 'Limite real da API do Instagram',
        text: 'A Graph API só entrega avanços, voltas e saídas somados (não por tela individual), e stories somem da API assim que expiram (~24h). Retenção/queda tela a tela e desempenho do CTA não são calculáveis com os dados hoje disponíveis.',
      },
    },
  ];

  const learning = await buildStoryLearning(item);
  sections.push({ heading: 'Aprendizado (IA)', paragraphs: [learning.text || aiFallbackText(learning.errored)] });

  const model = {
    title: 'Relatório Stories 24h',
    subtitle: `${brand?.name || ''} · Instagram · ${item.countryName} · Publicado em ${fmtDateTimeBR(item.meta.timestamp)}`,
    brandName: brand?.name,
    countryLabel: item.countryName,
    sections,
  };

  return { model, periodKey: storyId, scopeLabel: `${item.countryName} · ${fmtDateTimeBR(item.meta.timestamp)}` };
}

// ── Mensal por país ─────────────────────────────────────────────────────────────────────────
async function buildMonthlySummary({ brandName, scopeLabel, growthRows = [], winners = [], losers = [], goalsRows = [] }) {
  if (!aiConfigured()) return { text: null, errored: false };
  const prompt = `Você é um analista de social media resumindo o desempenho mensal de ${scopeLabel}, marca ${brandName || ''}.
Crescimento: ${JSON.stringify(growthRows)}.
Conteúdos vencedores: ${JSON.stringify(winners.map(i => ({ formato: i.formatLabel, pais: i.countryName, interacoes: i.latest?.totalInteractions, vsMediana: i.vsMedian?.totalInteractions })))}.
Conteúdos abaixo da referência: ${JSON.stringify(losers.map(i => ({ formato: i.formatLabel, pais: i.countryName, interacoes: i.latest?.totalInteractions, vsMediana: i.vsMedian?.totalInteractions })))}.
Progresso de metas: ${JSON.stringify(goalsRows)}.
Escreva em português do Brasil, 3-5 frases: um resumo executivo objetivo com os principais padrões e 1-2 ações recomendadas para o próximo período. Baseie-se só nesses números — se algum bloco estiver vazio/insuficiente, diga isso em vez de estimar.`;
  try { return { text: await generateText(prompt, { maxTokens: 500 }), errored: false }; }
  catch (e) { console.error('IA falhou (resumo mensal):', e.message); return { text: null, errored: true }; }
}

function contentRows(items, withCountry) {
  return items.map(i => withCountry
    ? [i.formatLabel, i.countryName, fmtDateBR(i.meta.publishedAt), fmtNum(i.latest?.totalInteractions), fmtPct(i.vsMedian?.totalInteractions)]
    : [i.formatLabel, fmtDateBR(i.meta.publishedAt), fmtNum(i.latest?.totalInteractions), fmtPct(i.vsMedian?.totalInteractions)]);
}

function topBottomContent(items) {
  const sorted = [...items].filter(i => i.latest && i.vsMedian?.totalInteractions != null).sort((a, b) => b.vsMedian.totalInteractions - a.vsMedian.totalInteractions);
  return { winners: sorted.slice(0, 3), losers: sorted.length > 3 ? sorted.slice(-3).reverse() : [] };
}

export async function buildMonthlyCountryReport({ brandId, countryId, monthKey }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const country = getCountries(brandId).find(c => c.id === countryId);
  if (!country) throw new Error('País não encontrado.');
  const { since, until, isPartial } = monthBounds(monthKey);

  const social = await computeSocialDashboard({ brandId, country: countryId, since, until });
  const c = social.byCountry[countryId] || {};
  const content = await computeContentDashboard({ brandId, country: countryId, since, until });
  const monthItems = content.items.filter(i => { const d = i.meta.publishedAt?.slice(0, 10); return d && d >= since && d <= until; });
  const goalsDash = computeGoalsDashboard({ brandId, country: countryId });

  const growthRows = [];
  if (c.instagram?.latest) growthRows.push(['Instagram · Seguidores', fmtNum(c.instagram.previous?.followers), fmtNum(c.instagram.latest.followers), fmtPct(c.instagram.delta.followers)]);
  if (c.facebook?.latest) growthRows.push(['Facebook · Seguidores', fmtNum(c.facebook.previous?.followers), fmtNum(c.facebook.latest.followers), fmtPct(c.facebook.delta.followers)]);

  const { winners, losers } = topBottomContent(monthItems);
  const goalsRows = goalsDash.items.filter(i => i.goal.current).map(i => [i.platformLabel, fmtNum(i.goal.current.target), fmtNum(i.goal.currentValue), i.goal.current.progressPct != null ? `${i.goal.current.progressPct.toFixed(1)}%` : '—', i.goal.current.achieved ? 'Meta atingida' : fmtDateBR(i.goal.current.deadline)]);

  const sections = [
    { heading: 'Crescimento', table: { columns: ['Conta', 'Início do período', 'Fim do período', 'Variação'], rows: growthRows.length ? growthRows : [['Sem histórico suficiente', '—', '—', '—']] } },
    { heading: 'Conteúdos em destaque', table: { columns: ['Formato', 'Publicado em', 'Interações', 'vs. mediana'], rows: winners.length ? contentRows(winners, false) : [['Sem conteúdo suficiente no período', '—', '—', '—']] } },
  ];
  if (losers.length) sections.push({ heading: 'Conteúdos abaixo da referência', table: { columns: ['Formato', 'Publicado em', 'Interações', 'vs. mediana'], rows: contentRows(losers, false) } });
  sections.push({ heading: 'Metas', table: { columns: ['Conta', 'Meta', 'Atual', 'Progresso', 'Prazo/status'], rows: goalsRows.length ? goalsRows : [['Nenhuma meta definida', '—', '—', '—', '—']] } });
  if (isPartial) sections.push({ heading: 'Cobertura do período', callout: { label: 'Mês em andamento', text: `Este relatório cobre até ${fmtDateBR(until)}. O mês de ${monthLabel(monthKey)} ainda não terminou.` } });

  const summary = await buildMonthlySummary({ brandName: brand?.name, scopeLabel: country.name, growthRows, winners, losers, goalsRows });
  sections.unshift({ heading: 'Resumo (IA)', paragraphs: [summary.text || aiFallbackText(summary.errored)] });

  const model = {
    title: `Relatório mensal · ${country.name}`,
    subtitle: `${brand?.name || ''} · ${monthLabel(monthKey)}${isPartial ? ' (parcial)' : ''}`,
    brandName: brand?.name,
    countryLabel: country.name,
    sections,
  };

  return { model, periodKey: `${countryId}:${monthKey}`, scopeLabel: `${country.name} · ${monthLabel(monthKey)}` };
}

// ── Mensal por rede ─────────────────────────────────────────────────────────────────────────
export async function buildMonthlyPlatformReport({ brandId, platform, monthKey }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const { since, until, isPartial } = monthBounds(monthKey);
  const social = await computeSocialDashboard({ brandId, country: 'all', since, until });

  const rows = Object.values(social.byCountry).map(c => {
    const e = c[platform];
    if (!e?.latest) return [c.name, '—', '—', '—'];
    const prevVal = e.previous?.followers ?? e.previous?.likes;
    const curVal = e.latest.followers ?? e.latest.likes;
    const delta = e.delta.followers ?? e.delta.likes;
    return [c.name, fmtNum(prevVal), fmtNum(curVal), delta != null ? fmtPct(delta) : '—'];
  });

  const sections = [{ heading: 'Crescimento por país', table: { columns: ['País', 'Início do período', 'Fim do período', 'Variação'], rows } }];

  if (platform === 'instagram') {
    const content = await computeContentDashboard({ brandId, country: 'all', since, until });
    const monthItems = content.items.filter(i => { const d = i.meta.publishedAt?.slice(0, 10); return d && d >= since && d <= until; });
    const { winners, losers } = topBottomContent(monthItems);
    sections.push({ heading: 'Conteúdos em destaque', table: { columns: ['Formato', 'País', 'Publicado em', 'Interações', 'vs. mediana'], rows: winners.length ? contentRows(winners, true) : [['Sem conteúdo suficiente no período', '—', '—', '—', '—']] } });
    if (losers.length) sections.push({ heading: 'Conteúdos abaixo da referência', table: { columns: ['Formato', 'País', 'Publicado em', 'Interações', 'vs. mediana'], rows: contentRows(losers, true) } });
  } else {
    sections.push({ heading: 'Conteúdos no período', callout: { label: 'Limitação', text: 'A ficha de conteúdo por post ainda só existe para o Instagram. Facebook fica de fora dessa análise por enquanto.' } });
  }

  if (isPartial) sections.push({ heading: 'Cobertura do período', callout: { label: 'Mês em andamento', text: `Este relatório cobre até ${fmtDateBR(until)}. O mês de ${monthLabel(monthKey)} ainda não terminou.` } });

  const summary = await buildMonthlySummary({ brandName: brand?.name, scopeLabel: PLATFORM_LABELS[platform] || platform, growthRows: rows });
  sections.unshift({ heading: 'Resumo (IA)', paragraphs: [summary.text || aiFallbackText(summary.errored)] });

  const model = {
    title: `Relatório mensal · ${PLATFORM_LABELS[platform] || platform}`,
    subtitle: `${brand?.name || ''} · ${monthLabel(monthKey)}${isPartial ? ' (parcial)' : ''}`,
    brandName: brand?.name,
    sections,
  };

  return { model, periodKey: `${platform}:${monthKey}`, scopeLabel: `${PLATFORM_LABELS[platform] || platform} · ${monthLabel(monthKey)}` };
}

// ── Mensal geral ────────────────────────────────────────────────────────────────────────────
export async function buildMonthlyGeneralReport({ brandId, monthKey }) {
  brandId = brandId || getDefaultBrandId();
  const brand = getBrand(brandId);
  const { since, until, isPartial } = monthBounds(monthKey);

  const social = await computeSocialDashboard({ brandId, country: 'all', since, until });
  const content = await computeContentDashboard({ brandId, country: 'all', since, until });
  const goalsDash = computeGoalsDashboard({ brandId, country: 'all' });
  const cofrinhoDash = computeCofrinhoDashboard({ brandId, country: 'all' });

  const cb = social.combined;
  const growthRows = [
    ['Instagram · Seguidores', fmtNum(cb.igFollowers.previousValue), fmtNum(cb.igFollowers.value), cb.igFollowers.deltaPct != null ? fmtPct(cb.igFollowers.deltaPct) : '—'],
    ['Instagram · Curtidas no período', '—', fmtNum(cb.igLikes.value), cb.igLikes.deltaPct != null ? fmtPct(cb.igLikes.deltaPct) : '—'],
    ['Facebook · Seguidores', fmtNum(cb.fbFollowers.previousValue), fmtNum(cb.fbFollowers.value), cb.fbFollowers.deltaPct != null ? fmtPct(cb.fbFollowers.deltaPct) : '—'],
  ];

  const monthItems = content.items.filter(i => { const d = i.meta.publishedAt?.slice(0, 10); return d && d >= since && d <= until; });
  const { winners, losers } = topBottomContent(monthItems);
  const goalsRows = goalsDash.items.filter(i => i.goal.current).map(i => [`${i.platformLabel} · ${i.countryName}`, fmtNum(i.goal.current.target), fmtNum(i.goal.currentValue), i.goal.current.progressPct != null ? `${i.goal.current.progressPct.toFixed(1)}%` : '—', i.goal.current.achieved ? 'Meta atingida' : fmtDateBR(i.goal.current.deadline)]);
  const cofrinhoRows = cofrinhoDash.items.map(i => [i.countryName, fmtNum(i.totals.usos), fmtNum(i.totals.vendas), i.totals.faturamento != null ? i.totals.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—']);

  const sections = [
    { heading: 'Crescimento', table: { columns: ['Métrica', 'Início do período', 'Fim do período', 'Variação'], rows: growthRows } },
    { heading: 'Conteúdos vencedores', table: { columns: ['Formato', 'País', 'Publicado em', 'Interações', 'vs. mediana'], rows: winners.length ? contentRows(winners, true) : [['Sem conteúdo suficiente no período', '—', '—', '—', '—']] } },
  ];
  if (losers.length) sections.push({ heading: 'Conteúdos abaixo da referência', table: { columns: ['Formato', 'País', 'Publicado em', 'Interações', 'vs. mediana'], rows: contentRows(losers, true) } });
  sections.push({ heading: 'Social Listening', callout: { label: 'Ainda não implementado', text: 'O agrupamento de comentários por assunto/sentimento (Social Listening) ainda não existe no sistema. Não há dado a mostrar aqui.' } });
  sections.push({ heading: 'Progresso das metas', table: { columns: ['Conta', 'Meta', 'Atual', 'Progresso', 'Prazo/status'], rows: goalsRows.length ? goalsRows : [['Nenhuma meta definida', '—', '—', '—', '—']] } });
  sections.push({
    heading: 'Vendas rastreadas (Cofrinho do Social)',
    table: { columns: ['País', 'Usos do cupom', 'Vendas rastreadas', 'Faturamento informado'], rows: cofrinhoRows.length ? cofrinhoRows : [['Sem registro', '—', '—', '—']] },
    callout: { label: 'Limite', text: 'Mostra apenas vendas rastreadas por cupom/link do Social, informadas manualmente. Não representa sozinho toda a influência das redes sobre as compras. Os totais são acumulados desde o início (o Cofrinho não filtra por mês), não exclusivos deste período.' },
  });
  if (isPartial) sections.push({ heading: 'Cobertura do período', callout: { label: 'Mês em andamento', text: `Este relatório cobre até ${fmtDateBR(until)}. O mês de ${monthLabel(monthKey)} ainda não terminou.` } });

  const summary = await buildMonthlySummary({ brandName: brand?.name, scopeLabel: 'toda a empresa', growthRows, winners, losers, goalsRows });
  sections.unshift({ heading: 'Resumo executivo (IA)', paragraphs: [summary.text || aiFallbackText(summary.errored)] });

  const model = {
    title: 'Relatório mensal geral',
    subtitle: `${brand?.name || ''} · ${monthLabel(monthKey)}${isPartial ? ' (parcial)' : ''}`,
    brandName: brand?.name,
    sections,
  };

  return { model, periodKey: `geral:${monthKey}`, scopeLabel: `Geral · ${monthLabel(monthKey)}` };
}

// ── Dispatcher (rota manual) ────────────────────────────────────────────────────────────────
// Nome customizado (opcional, "Nome" no formulário manual e no de agendamento) — vira o título
// do PDF/DOCX no lugar do título padrão gerado pelo tipo, com o título original preservado no
// subtítulo (nunca se perde a informação de que tipo/escopo aquele relatório é).
export function applyCustomName(model, name) {
  if (!name) return model;
  return { ...model, title: name, subtitle: model.subtitle ? `${model.title} · ${model.subtitle}` : model.title };
}

export async function generateReport(brandId, type, params = {}) {
  brandId = brandId || getDefaultBrandId();
  let result;
  switch (type) {
    case 'd7': result = await buildD7Report({ brandId, countryId: params.countryId, mediaId: params.mediaId }); break;
    case 'stories': result = await buildStoriesReport({ brandId, countryId: params.countryId, storyId: params.storyId }); break;
    case 'mensal_pais': result = await buildMonthlyCountryReport({ brandId, countryId: params.countryId, monthKey: params.monthKey || previousMonthKey() }); break;
    case 'mensal_rede': result = await buildMonthlyPlatformReport({ brandId, platform: params.platform, monthKey: params.monthKey || previousMonthKey() }); break;
    case 'mensal_geral': result = await buildMonthlyGeneralReport({ brandId, monthKey: params.monthKey || previousMonthKey() }); break;
    default: throw new Error('Tipo de relatório desconhecido.');
  }
  result.model = applyCustomName(result.model, params.name);
  return result;
}

export const REPORT_TYPES = ['d7', 'stories', 'mensal_pais', 'mensal_rede', 'mensal_geral'];

// ── Agendamentos (config-driven pelo usuário) ──────────────────────────────────────────────
// Sem cron nem horário fixo no código — cada agendamento é uma regra criada pela tela de
// Relatórios (tipo + escopo + "a cada X horas/dias/meses"), guardada em store.js. Um relatório só
// é gerado sozinho se existir um agendamento ativo pra ele; sem nenhum agendamento configurado,
// nada roda automaticamente (só o botão manual de "Gerar relatório").
export const INTERVAL_UNITS = ['hours', 'days', 'months'];

export function computeNextRun(intervalValue, intervalUnit, from = new Date()) {
  const d = new Date(from);
  const n = Number(intervalValue);
  if (intervalUnit === 'hours') d.setHours(d.getHours() + n);
  else if (intervalUnit === 'days') d.setDate(d.getDate() + n);
  else if (intervalUnit === 'months') d.setMonth(d.getMonth() + n);
  return d.toISOString();
}

// D+7/Stories continuam com dedupe por item (periodKey=mediaId/storyId) — regenerar o D+7 do
// mesmo post repetidamente não faz sentido, é um checkpoint único; o intervalo do agendamento
// só controla de quanto em quanto tempo o sistema procura por itens novos que cruzaram o
// checkpoint. Mensal NÃO usa dedupe — cada disparo do agendamento é um snapshot novo de
// propósito (é assim que o usuário consegue, por ex., um "mensal geral" toda semana, acumulando
// histórico em vez de sobrescrever).
async function runSchedule(brand, schedule) {
  let generated = 0;
  const countryIds = schedule.countryId ? [schedule.countryId] : brand.countries.map(c => c.id);

  if (schedule.type === 'd7') {
    for (const countryId of countryIds) {
      const content = await computeContentDashboard({ brandId: brand.id, country: countryId });
      for (const item of content.items) {
        if (item.ageDays >= 7 && !reportExists(brand.id, 'd7', item.mediaId)) {
          const { model, periodKey, scopeLabel } = await buildD7Report({ brandId: brand.id, countryId, mediaId: item.mediaId });
          addReport(brand.id, { type: 'd7', name: schedule.name || null, periodKey, scopeLabel, generatedBy: 'auto', model: applyCustomName(model, schedule.name) });
          generated++;
        }
      }
    }
  } else if (schedule.type === 'stories') {
    for (const countryId of countryIds) {
      const stories = computeStoriesDashboard({ brandId: brand.id, country: countryId });
      for (const item of stories.items) {
        if (item.expired && !reportExists(brand.id, 'stories', item.storyId)) {
          const { model, periodKey, scopeLabel } = await buildStoriesReport({ brandId: brand.id, countryId, storyId: item.storyId });
          addReport(brand.id, { type: 'stories', name: schedule.name || null, periodKey, scopeLabel, generatedBy: 'auto', model: applyCustomName(model, schedule.name) });
          generated++;
        }
      }
    }
  } else if (schedule.type === 'mensal_pais') {
    for (const countryId of countryIds) {
      const { model, periodKey, scopeLabel } = await buildMonthlyCountryReport({ brandId: brand.id, countryId, monthKey: currentMonthKey() });
      addReport(brand.id, { type: 'mensal_pais', name: schedule.name || null, periodKey, scopeLabel, generatedBy: 'auto', model: applyCustomName(model, schedule.name) });
      generated++;
    }
  } else if (schedule.type === 'mensal_rede') {
    const platforms = new Set();
    for (const country of brand.countries) for (const a of country.accounts) platforms.add(a.platform);
    const scopedPlatforms = schedule.platform ? [schedule.platform] : [...platforms];
    for (const platform of scopedPlatforms) {
      const { model, periodKey, scopeLabel } = await buildMonthlyPlatformReport({ brandId: brand.id, platform, monthKey: currentMonthKey() });
      addReport(brand.id, { type: 'mensal_rede', name: schedule.name || null, periodKey, scopeLabel, generatedBy: 'auto', model: applyCustomName(model, schedule.name) });
      generated++;
    }
  } else if (schedule.type === 'mensal_geral') {
    const { model, periodKey, scopeLabel } = await buildMonthlyGeneralReport({ brandId: brand.id, monthKey: currentMonthKey() });
    addReport(brand.id, { type: 'mensal_geral', name: schedule.name || null, periodKey, scopeLabel, generatedBy: 'auto', model: applyCustomName(model, schedule.name) });
    generated++;
  }

  return generated;
}

// Chamado periodicamente por server.js. Sem ANTHROPIC_API_KEY não gera nada (todo relatório
// depende de algum texto sintetizado por IA) — nem tenta rodar os agendamentos, pra não gerar
// relatório "capado" sozinho. Cada agendamento vencido (nextRunAt <= agora) dispara uma vez;
// `nextRunAt` é recalculado a partir de agora + intervalo, então atrasos no agendador (servidor
// fora do ar, etc.) não acumulam disparos retroativos — só roda o próximo, uma vez.
export async function checkScheduledReports() {
  if (!aiConfigured()) return { generated: 0, errors: [] };
  const errors = [];
  let generated = 0;

  for (const brand of getBrands()) {
    for (const schedule of getSchedules(brand.id)) {
      if (!schedule.active) continue;
      if (Date.now() < Date.parse(schedule.nextRunAt)) continue;
      try {
        generated += await runSchedule(brand, schedule);
      } catch (e) {
        errors.push(`Agendamento ${schedule.id} (${schedule.type}): ${e.message}`);
      }
      const nextRunAt = computeNextRun(schedule.intervalValue, schedule.intervalUnit, new Date());
      updateSchedule(brand.id, schedule.id, { lastRunAt: new Date().toISOString(), nextRunAt });
    }
  }

  return { generated, errors };
}
