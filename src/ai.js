// ai.js — integração com a API da Anthropic (Claude Sonnet 5). Conta de API separada da
// assinatura Claude Pro (essa aqui é billing por uso, console.anthropic.com) — usada pro resumo
// em texto da ficha de conteúdo, Social Listening e relatórios automáticos. Nunca decide métrica
// crua nenhuma (isso continua vindo direto da Meta) — só interpreta/resume o que já foi
// coletado, e sempre deixa claro na tela que é texto gerado por IA.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// O Sonnet 5 pensa antes de responder, e esse raciocínio gasta do mesmo max_tokens da resposta.
// Sem essa folga, um limite pensado só pro texto (300, 500, 3500...) era consumido pelo raciocínio
// e a resposta saía cortada no meio ou vazia (25/09/2026). Quem chama continua informando só o
// tamanho do texto que espera; a folga é somada aqui.
const THINKING_HEADROOM = 6000;

export function isConfigured() {
  return Boolean(client);
}

async function createMessage(prompt, { maxTokens, system, outputConfig }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY não configurado.');
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens + THINKING_HEADROOM,
    ...(system ? { system } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'max_tokens') throw new Error('A resposta da IA ficou longa demais e foi cortada. Tente gerar de novo.');
  if (res.stop_reason === 'refusal') throw new Error('A IA se recusou a gerar este texto.');
  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
}

// Chamada genérica — quem chama monta o prompt já com todo o contexto necessário (dados da
// ficha, comentários, etc.). A chave nunca é exposta ao front, só usada aqui no servidor.
export function generateText(prompt, { maxTokens = 700, system } = {}) {
  return createMessage(prompt, { maxTokens, system });
}

// Resposta em JSON garantida pela própria API (output_config.format com JSON Schema), em vez de
// pedir JSON no prompt e torcer: o formato e os campos vêm certos, sem campo inventado.
export async function generateJson(prompt, { schema, system, maxTokens = 3500 } = {}) {
  const text = await createMessage(prompt, { maxTokens, system, outputConfig: { format: { type: 'json_schema', schema } } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('A IA não respondeu em JSON válido. Tente gerar de novo.');
  }
}
