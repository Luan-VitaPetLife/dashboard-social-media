// ai.js — integração com a API da Anthropic (Claude Sonnet 5). Conta de API separada da
// assinatura Claude Pro (essa aqui é billing por uso, console.anthropic.com) — usada pro resumo
// em texto da ficha de conteúdo, Social Listening e relatórios automáticos. Nunca decide métrica
// crua nenhuma (isso continua vindo direto da Meta) — só interpreta/resume o que já foi
// coletado, e sempre deixa claro na tela que é texto gerado por IA.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export function isConfigured() {
  return Boolean(client);
}

// Chamada genérica — quem chama monta o prompt já com todo o contexto necessário (dados da
// ficha, comentários, etc.). A chave nunca é exposta ao front, só usada aqui no servidor.
export async function generateText(prompt, { maxTokens = 700, system } = {}) {
  if (!client) throw new Error('ANTHROPIC_API_KEY não configurado.');
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
}
