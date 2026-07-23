import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initStore, getLastSync, getSnapshots, getStoreBackend } from './src/store.js';
import { runSync } from './src/sync.js';
import { computeSocialDashboard } from './src/metrics.js';
import { computeContentDashboard, generateContentAiSummary } from './src/contentMetrics.js';
import { computeGoalsDashboard } from './src/goals.js';
import { computeStoriesDashboard } from './src/storyMetrics.js';
import { runStorySync } from './src/storySync.js';
import { computeCofrinhoDashboard } from './src/cofrinho.js';
import { probeInsights, probeEngagement, probeDemographics } from './src/meta.js';
import { backfillSocialHistory } from './src/backfill.js';
import { getRegistryTree, getDefaultBrandId, getBrands, getCountries, getAccounts } from './src/registry.js';
import { generateReport, checkScheduledReports, computeNextRun, REPORT_TYPES, INTERVAL_UNITS } from './src/reports.js';
import { renderReportPdf, renderReportDocx } from './src/reportRenderer.js';
import {
  setContentContext, setContentAiSummary, addGoal, addCofrinhoEntry, addCofrinhoGoal, getSettings, updateSettings,
  getPeople, addPerson, updatePerson, deletePerson,
  getTickets, addTicket, updateTicket, deleteTicket, addTicketComment, deleteTicketComment,
  getReports, getReport, addReport, deleteReport,
  getSchedules, addSchedule, updateSchedule, deleteSchedule,
} from './src/store.js';
import { authGate, createSessionCookieValue, checkPassword, hasValidSession, SESSION_COOKIE, SESSION_MAX_AGE_MS } from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// Seguidores/curtidas não mudam minuto a minuto — padrão 12h (bem mais espaçado que os 15min
// do live-dashboard, que sincroniza pedidos).
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 720);
// Stories vivem só 24h e somem de /{ig-id}/stories assim que expiram — o ciclo de 12h do sync
// normal deixaria muitos passarem batido. Agendador próprio, bem mais frequente, só pra isso.
const STORY_SYNC_INTERVAL_MINUTES = Number(process.env.STORY_SYNC_INTERVAL_MINUTES || 120);
// Verificação dos agendamentos de relatório (ver src/reports.js) — próprio e mais frequente que
// o sync de 12h porque a pessoa pode configurar um agendamento "a cada 1 hora" pela tela de
// Relatórios; checar só a cada 12h faria esse agendamento nunca disparar no horário esperado.
const REPORT_SCHEDULE_CHECK_MINUTES = Number(process.env.REPORT_SCHEDULE_CHECK_MINUTES || 30);

// Necessário pra req.secure refletir o protocolo original (https) quando o Railway termina TLS
// no proxy e repassa a requisição por http internamente — sem isso, o cookie de sessão marcado
// "secure" nunca seria enviado de volta pelo navegador em produção.
app.set('trust proxy', 1);

// ── Segurança: cabeçalhos (helmet), sem quebrar os assets via CDN já usados nas páginas ──
// (cdn.jsdelivr.net serve o Chart.js e a fonte/CSS do Bootstrap Icons). CSP em modo
// allowlist explícita em vez de desligada — 'unsafe-inline' é necessário porque todas as
// páginas hoje usam <script>/<style> inline (sem nonce/hash); reavaliar se algum dia isso
// mudar para arquivos .js/.css separados.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  // Sem iframes/recursos cross-origin embutidos nesta app — nenhuma necessidade de COEP.
  crossOriginEmbedderPolicy: false,
}));

// ── Segurança: rate limiting — stop-gap enquanto não existe mais que uma senha única de
// equipe (ver login em src/auth.js). Limite geral generoso (uso normal de uma dashboard
// interna) + limite bem mais apertado nas rotas que disparam chamada de verdade à Meta Graph
// API (sync/backfill) — essas são as que custam quota/tempo de verdade.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas solicitações de sincronização em pouco tempo. Aguarde um minuto e tente de novo.' },
});

// Limite dedicado pro login — senha única de equipe, então força bruta é uma preocupação real
// (diferente do apiLimiter geral, generoso demais pra essa rota especificamente). 15 tentativas
// por 15min por IP é alto o bastante pra não travar alguém errando a senha algumas vezes, mas
// baixo o bastante pra tornar força bruta inviável. `skipSuccessfulRequests` faz só as tentativas
// que falham (401) consumirem a cota — logar certo de primeira nunca é penalizado.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de login em pouco tempo. Aguarde alguns minutos e tente de novo.' },
});

// ── Segurança: nunca ecoar segredo nenhum (token da Meta, credencial do Mongo) numa resposta
// JSON — mesmo sem querer, um e.message de erro de rede pode conter a URL completa da chamada
// (com ?access_token=...) ou, em teoria, parte de uma connection string. Um único ponto (aqui,
// sobrescrevendo res.json) cobre todas as rotas — não precisa caçar cada `e.message` espalhado
// por src/*.js.
const TOKEN_VALUE = process.env.META_ACCESS_TOKEN || '';
const MONGO_URI_VALUE = process.env.MONGODB_URI || '';
function redactSecrets(str) {
  let out = str
    .replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1[REDACTED]@');
  if (TOKEN_VALUE) out = out.split(TOKEN_VALUE).join('[REDACTED]');
  if (MONGO_URI_VALUE) out = out.split(MONGO_URI_VALUE).join('[REDACTED]');
  return out;
}
function redactDeep(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = redactDeep(value[k]);
    return out;
  }
  return value;
}
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(redactDeep(body));
  next();
});

app.use(express.json());
// Roda antes do estático e de toda rota /api — decide se a requisição pode passar (login
// desligado, rota pública, ou sessão válida) ou se precisa ir pra tela de login. Ver src/auth.js.
app.use(authGate);
// extensions:['html'] deixa a URL limpa (/conteudos em vez de /conteudos.html) sem precisar de
// rota nem redirect pra cada página — o arquivo .html continua acessível pelo nome completo
// também (compatibilidade com link antigo/favorito), só não é mais o que a gente linka.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/health', (req, res) => res.json({ ok: true }));

// ── Login único compartilhado (liga/desliga em Configurações) ──────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!process.env.DASHBOARD_PASSWORD) return res.status(500).json({ error: 'DASHBOARD_PASSWORD não configurado no servidor.' });
  if (!checkPassword(password)) return res.status(401).json({ error: 'Senha incorreta.' });
  res.cookie(SESSION_COOKIE, createSessionCookieValue(), {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MAX_AGE_MS, path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const settings = getSettings();
  res.json({
    loginEnabled: settings.loginEnabled,
    authenticated: !settings.loginEnabled || hasValidSession(req),
    passwordConfigured: Boolean(process.env.DASHBOARD_PASSWORD),
  });
});

app.get('/api/settings', (req, res) => res.json(getSettings()));

app.post('/api/settings', (req, res) => {
  const { loginEnabled } = req.body;
  // Trava de segurança: nunca liga o login sem senha configurada — senão ninguém mais consegue
  // entrar (nem pra desligar de novo) até alguém mexer na variável de ambiente no Railway.
  if (loginEnabled === true && !process.env.DASHBOARD_PASSWORD) {
    return res.status(400).json({ error: 'Defina a variável de ambiente DASHBOARD_PASSWORD antes de ativar o login. Sem isso, ninguém conseguiria entrar de novo.' });
  }
  try {
    res.json(updateSettings({ loginEnabled: Boolean(loginEnabled) }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chamados (quadro estilo Monday) + cadastro de pessoas ──────────────────────────────────
const TICKET_TIPOS = ['sugestao', 'bug', 'duvida', 'dado', 'programacao', 'outro'];
const TICKET_URGENCIAS = ['baixa', 'media', 'alta', 'urgente'];
const TICKET_STATUSES = ['aberto', 'andamento', 'concluido'];

app.get('/api/people', (req, res) => res.json(getPeople()));

app.post('/api/people', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  res.json(addPerson(name));
});

app.patch('/api/people/:id', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const person = updatePerson(req.params.id, { name });
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada.' });
  res.json(person);
});

app.delete('/api/people/:id', (req, res) => {
  deletePerson(req.params.id);
  res.json({ ok: true });
});

app.get('/api/tickets', (req, res) => res.json(getTickets()));

app.post('/api/tickets', (req, res) => {
  const titulo = String(req.body.titulo || '').trim();
  const { tipo, urgencia, responsavelId, criadoPorId } = req.body;
  if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
  if (!TICKET_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  if (!TICKET_URGENCIAS.includes(urgencia)) return res.status(400).json({ error: 'Urgência inválida.' });
  const descricao = String(req.body.descricao || '').trim();
  res.json(addTicket({ titulo, descricao, tipo, urgencia, responsavelId: responsavelId || null, criadoPorId: criadoPorId || null }));
});

app.patch('/api/tickets/:id', (req, res) => {
  const patch = {};
  if ('titulo' in req.body) {
    const titulo = String(req.body.titulo).trim();
    if (!titulo) return res.status(400).json({ error: 'Título não pode ficar vazio.' });
    patch.titulo = titulo;
  }
  if ('descricao' in req.body) patch.descricao = String(req.body.descricao || '').trim();
  if ('tipo' in req.body) {
    if (!TICKET_TIPOS.includes(req.body.tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
    patch.tipo = req.body.tipo;
  }
  if ('urgencia' in req.body) {
    if (!TICKET_URGENCIAS.includes(req.body.urgencia)) return res.status(400).json({ error: 'Urgência inválida.' });
    patch.urgencia = req.body.urgencia;
  }
  if ('status' in req.body) {
    if (!TICKET_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Status inválido.' });
    patch.status = req.body.status;
  }
  if ('responsavelId' in req.body) patch.responsavelId = req.body.responsavelId || null;
  const ticket = updateTicket(req.params.id, patch);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  res.json(ticket);
});

app.delete('/api/tickets/:id', (req, res) => {
  deleteTicket(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tickets/:id/comments', (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comentário vazio.' });
  const comment = addTicketComment(req.params.id, { personId: req.body.personId || null, text });
  if (!comment) return res.status(404).json({ error: 'Chamado não encontrado.' });
  res.json(comment);
});

app.delete('/api/tickets/:id/comments/:commentId', (req, res) => {
  const ticket = deleteTicketComment(req.params.id, req.params.commentId);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  res.json(ticket);
});

// Árvore empresa → marca → país → plataformas (sem credenciais) — o front monta os seletores
// de Marca e País a partir daqui, sem hardcoded "Coco and Luna"/"Brasil"/"Estados Unidos".
app.get('/api/registry', (req, res) => res.json(getRegistryTree()));

// Diagnóstico: confirma qual backend de armazenamento está ativo (mongodb ou json local) e
// quantos snapshots existem por conta — sem precisar vasculhar log do Railway/Atlas.
app.get('/api/status', (req, res) => {
  const snapshotCounts = {};
  for (const brand of getBrands()) {
    snapshotCounts[brand.id] = {};
    for (const country of brand.countries) {
      snapshotCounts[brand.id][country.id] = {};
      for (const account of country.accounts) {
        snapshotCounts[brand.id][country.id][account.platform] = Object.keys(getSnapshots(brand.id, account.platform, country.id)).length;
      }
    }
  }
  res.json({
    storeBackend: getStoreBackend(),
    lastSync: getLastSync(),
    snapshotCounts,
  });
});

function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

app.get('/api/dashboard', async (req, res) => {
  const until = req.query.until || todayISO();
  const since = req.query.since || isoDaysAgo(29);
  // cmpSince/cmpUntil (opcionais): período de comparação escolhido manualmente no card de
  // Comparação — ausentes, cai no automático (período anterior de mesmo tamanho).
  const cmpSince = req.query.cmpSince || undefined;
  const cmpUntil = req.query.cmpUntil || undefined;
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json({ ...(await computeSocialDashboard({ brandId, country, since, until, cmpSince, cmpUntil })), lastSync: getLastSync() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/content', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  const { since, until } = req.query;
  try {
    res.json(await computeContentDashboard({ brandId, country, since, until }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Salva um campo de contexto por vez (o front dispara isso no blur de cada input) — só os
// campos realmente presentes no body entram no merge. Usar destructuring com fallback pra
// undefined aqui apagaria os campos que não vieram nesse PATCH específico.
const CONTEXT_FIELDS = ['tema', 'objetivo', 'pilar', 'produto', 'gancho', 'cta', 'observacao', 'formato', 'horario'];
app.patch('/api/content/:mediaId/context', (req, res) => {
  const { mediaId } = req.params;
  const brandId = req.body.brandId || getDefaultBrandId();
  const countryId = req.body.countryId;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  const context = {};
  for (const key of CONTEXT_FIELDS) if (key in req.body) context[key] = req.body[key];
  try {
    const updated = setContentContext(brandId, countryId, mediaId, context);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gera (ou regenera) o resumo por IA de um post — só quando a equipe pede pela tela, nunca
// automático. syncLimiter reaproveitado aqui porque, assim como o sync da Meta, essa rota custa
// dinheiro de verdade (chamada à API da Anthropic) e não deveria ser disparável em massa.
app.post('/api/content/:mediaId/ai-summary', syncLimiter, async (req, res) => {
  const { mediaId } = req.params;
  const brandId = req.body.brandId || getDefaultBrandId();
  const countryId = req.body.countryId;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  try {
    const dashboard = await computeContentDashboard({ brandId, country: countryId });
    const item = dashboard.items.find(i => i.mediaId === mediaId);
    if (!item) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
    const summary = await generateContentAiSummary(item);
    setContentAiSummary(brandId, countryId, mediaId, summary);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/goals', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeGoalsDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/goals', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, platform, target, deadline } = req.body;
  if (!countryId || !platform) return res.status(400).json({ error: 'countryId e platform são obrigatórios.' });
  const targetNum = Number(target);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'target precisa ser um número positivo.' });
  if (!deadline || Number.isNaN(Date.parse(deadline))) return res.status(400).json({ error: 'deadline precisa ser uma data válida.' });
  const exists = getAccounts(brandId, countryId).some(a => a.platform === platform);
  if (!exists) return res.status(400).json({ error: 'Não existe conta configurada para essa marca/país/plataforma.' });
  try {
    const goal = addGoal(brandId, countryId, platform, { metric: 'followers', target: targetNum, deadline });
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stories', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeStoriesDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cofrinho', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const country = req.query.country || 'all';
  try {
    res.json(computeCofrinhoDashboard({ brandId, country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cofrinho/entries', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, period, cupom, usos, vendas, faturamento, observacao } = req.body;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  const usosNum = Number(usos), vendasNum = Number(vendas);
  if (!Number.isFinite(usosNum) || usosNum < 0) return res.status(400).json({ error: 'usos precisa ser um número válido.' });
  if (!Number.isFinite(vendasNum) || vendasNum < 0) return res.status(400).json({ error: 'vendas precisa ser um número válido.' });
  let faturamentoNum = null;
  if (faturamento !== undefined && faturamento !== null && faturamento !== '') {
    faturamentoNum = Number(faturamento);
    if (!Number.isFinite(faturamentoNum) || faturamentoNum < 0) return res.status(400).json({ error: 'faturamento precisa ser um número válido.' });
  }
  try {
    const entry = addCofrinhoEntry(brandId, countryId, {
      period: period || null, cupom: cupom || null,
      usos: usosNum, vendas: vendasNum, faturamento: faturamentoNum,
      observacao: observacao || null,
    });
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cofrinho/goals', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { countryId, metric, target, deadline } = req.body;
  if (!countryId) return res.status(400).json({ error: 'countryId é obrigatório.' });
  if (!['vendas', 'faturamento'].includes(metric)) return res.status(400).json({ error: 'metric precisa ser "vendas" ou "faturamento".' });
  const targetNum = Number(target);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'target precisa ser um número positivo.' });
  if (!deadline || Number.isNaN(Date.parse(deadline))) return res.status(400).json({ error: 'deadline precisa ser uma data válida.' });
  try {
    const goal = addCofrinhoGoal(brandId, countryId, { metric, target: targetNum, deadline });
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Relatórios (D+7, Stories 24h, mensal por país/rede/geral) ──────────────────────────────
// Lista só metadados (nunca o `model` inteiro, que pode ter várias tabelas) — o front pede o
// PDF/DOCX de verdade só quando a pessoa clica em baixar.
app.get('/api/reports', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  res.json(getReports(brandId).map(r => ({ id: r.id, type: r.type, name: r.name || null, scopeLabel: r.scopeLabel, periodKey: r.periodKey, generatedAt: r.generatedAt, generatedBy: r.generatedBy })));
});

// Gera um relatório sob demanda — mesmo motivo do syncLimiter em ai-summary: cada geração chama
// a API da Anthropic de verdade (custa dinheiro), então fica no mesmo limite apertado.
app.post('/api/reports/generate', syncLimiter, async (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { type, name, countryId, mediaId, storyId, platform, monthKey } = req.body;
  if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de relatório inválido.' });
  const cleanName = name ? String(name).trim().slice(0, 120) : null;
  try {
    const { model, periodKey, scopeLabel } = await generateReport(brandId, type, { countryId, mediaId, storyId, platform, monthKey, name: cleanName });
    const record = addReport(brandId, { type, name: cleanName, periodKey, scopeLabel, generatedBy: 'manual', model });
    res.json({ id: record.id, type: record.type, name: record.name, scopeLabel: record.scopeLabel, periodKey: record.periodKey, generatedAt: record.generatedAt, generatedBy: record.generatedBy });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/:id/pdf', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const report = getReport(brandId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Relatório não encontrado.' });
  try {
    const buffer = await renderReportPdf(report.model);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${slugifyFilename(report.model.title)}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/:id/docx', async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const report = getReport(brandId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Relatório não encontrado.' });
  try {
    const buffer = await renderReportDocx(report.model);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${slugifyFilename(report.model.title)}.docx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/reports/:id', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  deleteReport(brandId, req.params.id);
  res.json({ ok: true });
});

// ── Agendamentos de relatório (config-driven pela tela de Relatórios — sem horário fixo no
// código, ver checkScheduledReports em src/reports.js) ──────────────────────────────────────
app.get('/api/schedules', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  res.json(getSchedules(brandId));
});

app.post('/api/schedules', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const { type, name, countryId, platform, intervalValue, intervalUnit } = req.body;
  if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de relatório inválido.' });
  if (!INTERVAL_UNITS.includes(intervalUnit)) return res.status(400).json({ error: 'Unidade de intervalo inválida.' });
  const value = Number(intervalValue);
  if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Intervalo precisa ser um número positivo.' });
  const nextRunAt = computeNextRun(value, intervalUnit, new Date());
  const schedule = addSchedule(brandId, {
    type, name: name ? String(name).trim().slice(0, 120) : null, countryId: countryId || null, platform: platform || null,
    intervalValue: value, intervalUnit, nextRunAt,
  });
  res.json(schedule);
});

app.patch('/api/schedules/:id', (req, res) => {
  const brandId = req.body.brandId || getDefaultBrandId();
  const patch = {};
  if ('name' in req.body) patch.name = req.body.name ? String(req.body.name).trim().slice(0, 120) : null;
  if ('active' in req.body) patch.active = Boolean(req.body.active);
  if ('countryId' in req.body) patch.countryId = req.body.countryId || null;
  if ('platform' in req.body) patch.platform = req.body.platform || null;
  if ('intervalValue' in req.body || 'intervalUnit' in req.body) {
    const value = Number(req.body.intervalValue);
    const unit = req.body.intervalUnit;
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Intervalo precisa ser um número positivo.' });
    if (!INTERVAL_UNITS.includes(unit)) return res.status(400).json({ error: 'Unidade de intervalo inválida.' });
    patch.intervalValue = value;
    patch.intervalUnit = unit;
    // Muda o intervalo → recalcula a partir de agora, pra pessoa ver o efeito imediatamente em vez
    // de esperar o próximo disparo já agendado com o intervalo antigo.
    patch.nextRunAt = computeNextRun(value, unit, new Date());
  }
  const schedule = updateSchedule(brandId, req.params.id, patch);
  if (!schedule) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  res.json(schedule);
});

app.delete('/api/schedules/:id', (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  deleteSchedule(brandId, req.params.id);
  res.json({ ok: true });
});

function slugifyFilename(title) {
  return String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'relatorio';
}

app.post('/api/sync', syncLimiter, async (req, res) => {
  try { res.json(await runSync()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Placeholder do callback de OAuth da TikTok (integração ainda não construída — o app da TikTok
// for Business Developers precisa de uma URL de redirect válida já no cadastro, antes de termos
// client_key/client_secret pra fazer a troca do code por token de verdade). Só mostra o code
// recebido pra confirmar que o redirect funciona; a troca por access_token/refresh_token entra
// aqui quando o restante da integração TikTok (registry + sync) for implementado.
app.get('/api/tiktok/oauth/callback', (req, res) => {
  const { code, state, error, error_description } = req.query;
  console.log('TikTok OAuth callback recebido:', { code, state, error, error_description });
  res.type('html').send(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto">
    <h2>TikTok: autorização recebida</h2>
    ${error ? `<p style="color:#c0392b">Erro: ${error}. ${error_description || ''}</p>` :
      `<p>Código de autorização recebido. A integração ainda está em construção, encaminhe este valor pra equipe técnica concluir a troca por token de acesso:</p>
       <pre style="background:#f4f4f4;padding:12px;border-radius:8px;word-break:break-all">${code || '(nenhum código recebido)'}</pre>`}
  </body></html>`);
});

// Diagnóstico: resposta crua dos endpoints de Insights (Instagram + Facebook), sem
// processar nada. Ver src/meta.js (probeInsights) — roda antes de confiar no backfill.
app.get('/api/meta/probe-insights', syncLimiter, async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country || 'br';
  try { res.json(await probeInsights(brandId, countryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: testa candidatos de métrica pra visualizações de vídeo + curtidas/comentários
// somados no período (Instagram e Facebook), um de cada vez. Ver src/meta.js probeEngagement.
app.get('/api/meta/probe-engagement', syncLimiter, async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country || 'br';
  try { res.json(await probeEngagement(brandId, countryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: testa se demografia/geografia de audiência (cidade, país, idade, gênero)
// responde pro token atual, antes de qualquer seção nova ser construída em cima disso.
// Ver src/meta.js probeDemographics.
app.get('/api/meta/probe-demographics', syncLimiter, async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country || 'br';
  try { res.json(await probeDemographics(brandId, countryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Preenche dias anteriores ao início do sync via Insights API (nunca sobrescreve snapshot
// real). Sem ?country, roda todos os países da marca. Ver src/backfill.js.
app.post('/api/social/backfill', syncLimiter, async (req, res) => {
  const brandId = req.query.brand || getDefaultBrandId();
  const countryId = req.query.country;
  try {
    const countries = countryId ? [countryId] : getCountries(brandId).map(c => c.id);
    const results = [];
    for (const c of countries) results.push(await backfillSocialHistory({ brandId, countryId: c }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let syncInFlight = false;
async function scheduledSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const r = await runSync();
    if (r.errors.length) console.warn('Sync com avisos:', r.errors);
  } catch (e) {
    console.error('Sync falhou:', e.message);
  } finally {
    syncInFlight = false;
  }
}

let storySyncInFlight = false;
async function scheduledStorySync() {
  if (storySyncInFlight) return;
  storySyncInFlight = true;
  try {
    const r = await runStorySync();
    if (r.errors.length) console.warn('Story sync com avisos:', r.errors);
  } catch (e) {
    console.error('Story sync falhou:', e.message);
  } finally {
    storySyncInFlight = false;
  }
}

// Verifica os agendamentos de relatório criados pela tela de Relatórios (nenhum horário fixo
// aqui no código — ver checkScheduledReports() em src/reports.js). Intervalo próprio e mais
// curto que o sync normal (REPORT_SCHEDULE_CHECK_MINUTES, padrão 30min) porque um agendamento
// pode ser "a cada 1 hora" — checar só a cada 12h faria isso nunca disparar no horário esperado.
let reportsInFlight = false;
async function scheduledReports() {
  if (reportsInFlight) return;
  reportsInFlight = true;
  try {
    const r = await checkScheduledReports();
    if (r.errors.length) console.warn('Geração agendada de relatórios com avisos:', r.errors);
    if (r.generated) console.log(`Relatórios gerados por agendamento: ${r.generated}`);
  } catch (e) {
    console.error('Geração agendada de relatórios falhou:', e.message);
  } finally {
    reportsInFlight = false;
  }
}

await initStore();
app.listen(PORT, async () => {
  console.log(`dashboard-social-media rodando em http://localhost:${PORT}`);
  await scheduledSync();
  await scheduledReports();
  setInterval(scheduledSync, SYNC_INTERVAL_MINUTES * 60 * 1000);
  setInterval(scheduledStorySync, STORY_SYNC_INTERVAL_MINUTES * 60 * 1000);
  setInterval(scheduledReports, REPORT_SCHEDULE_CHECK_MINUTES * 60 * 1000);
});
