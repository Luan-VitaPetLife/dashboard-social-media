// reportTemplate.js — paleta e constantes visuais compartilhadas pelos dois renderizadores
// (PDF via pdfkit, DOCX via docx). Extraído do documento de briefing da Aline
// (Central_de_Inteligencia_de_Performance_Briefing.pdf, na raiz do repo) — roxo/índigo escuro
// nos cabeçalhos de tabela e títulos, listras lavanda claro nas linhas, subtítulo em itálico
// azulado, caixas de destaque (tipo "Prioridade"/"Limite") em lavanda bem clara. Repetir esses
// valores nos dois renderizadores em vez de um só, porque pdfkit usa hex com "#" e docx usa hex
// sem "#" — mantidos juntos aqui pra nunca dessincronizar as duas paletas.
export const COLORS = {
  purpleDark: '#4B2E83',   // cabeçalho de tabela, título principal
  purpleDarkHex: '4B2E83', // mesma cor sem '#', formato exigido pelo docx
  subtitleBlue: '#3D6DC8', // subtítulo em itálico
  subtitleBlueHex: '3D6DC8',
  textDark: '#1c2b39',     // corpo de texto (mesmo --text do resto do app)
  textDarkHex: '1c2b39',
  muted: '#6b7280',
  mutedHex: '6b7280',
  rowStripe: '#E3E8F7',    // listra lavanda clara nas linhas ímpares de tabela
  rowStripeHex: 'E3E8F7',
  calloutBg: '#F1EEF9',    // caixa de destaque (Prioridade/Limite/Observação)
  calloutBgHex: 'F1EEF9',
  calloutBorder: '#C9BEE3',
  calloutBorderHex: 'C9BEE3',
  white: '#FFFFFF',
  whiteHex: 'FFFFFF',
};

export const BRAND_FOOTER = (brandName, countryLabel) =>
  `Vita Pet Life${brandName ? ' • ' + brandName : ''}${countryLabel ? ' · ' + countryLabel : ''} · Redes Sociais`;

// Formata um número pt-BR sem depender de Intl no worker do PDF (funciona igual, mas mantém
// consistência com fmt() usado no front) — null/undefined vira "—", nunca "0" fabricado.
export function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('pt-BR');
}

// "+"/"-" em vez de ▲/▼: a fonte padrão do pdfkit (Helvetica, WinAnsi) não tem esses símbolos
// Unicode e os renderiza como lixo (confirmado no teste de fumaça do renderer) — diferente do
// front-end (usa fonte do sistema/navegador, onde ▲/▼ funcionam normalmente).
export function fmtPct(p) {
  if (p == null) return '—';
  const sign = p >= 0 ? '+' : '-';
  return `${sign}${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function fmtDateBR(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTimeBR(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}
