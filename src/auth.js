// auth.js — login único compartilhado (uma senha só pra equipe, em DASHBOARD_PASSWORD),
// liga/desliga pela tela de Configurações (settings em store.js). Sessão é um cookie assinado
// (HMAC), sem tabela de sessão nem dependência nova — funciona igual com MongoDB ou JSON local,
// e sobrevive a redeploy do Railway sem precisar de um "session store" separado.
import crypto from 'crypto';
import { getSettings } from './store.js';

export const SESSION_COOKIE = 'coco_sm_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// SESSION_SECRET dedicado se existir; cai pra DASHBOARD_PASSWORD só pra não travar quem ainda
// não configurou os dois — recomendado configurar os dois em produção.
function secret() {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || '';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

export function createSessionCookieValue() {
  const expires = Date.now() + SESSION_MAX_AGE_MS;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

function isValidSessionCookie(value) {
  if (!value || !secret()) return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(sign(payload), 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  return Number(payload) > Date.now();
}

// Comparação em tempo constante — timingSafeEqual exige buffers do mesmo tamanho, por isso o
// early-return de tamanho diferente vem antes (aceitável pra uma senha única de equipe interna).
export function checkPassword(candidate) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function hasValidSession(req) {
  return isValidSessionCookie(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

// Rotas/arquivos que precisam ficar acessíveis mesmo com o login ligado — a própria tela de
// login, o endpoint que autentica, o status (usado pela tela de login e pela de Configurações
// antes/depois de logar) e o healthcheck do Railway. Logo/favicon liberados por serem só marca,
// nada sensível.
const PUBLIC_PATHS = new Set(['/login.html', '/health', '/api/auth/login', '/api/auth/status', '/Logo2.png', '/favicon.png']);

// Middleware global — roda antes do arquivo estático e de toda rota /api. Passa direto quando
// o login está desligado (padrão hoje, nada muda pra quem não configurou nada ainda).
export function authGate(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (!getSettings().loginEnabled) return next();
  if (hasValidSession(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
  return res.redirect('/login.html');
}
