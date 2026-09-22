// ─────────────────────────────────────────────
//  sidebar.js — sidebar compartilhada (mesmo padrão do live-dashboard: injeta
//  markup + CSS uma vez, idempotente). Paleta inspirada nas telas de
//  Configurações do próprio Meta Business Suite — gradiente suave, texto
//  escuro, item ativo em pílula navy.
//  Uso: <script src="sidebar.js"></script> logo após <body>.
// ─────────────────────────────────────────────

// escapeHtml — helper global (todas as páginas carregam sidebar.js) pra evitar XSS armazenado
// sempre que texto livre entrado por qualquer pessoa sem login (contexto de conteúdo, registros
// do Cofrinho, etc. — hoje sem autenticação nenhuma, ver CLAUDE.md) é interpolado em innerHTML.
// Usar em TODO texto vindo do backend que não seja um valor fixo/controlado (enum, id, número).
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

// apiFetch(url, options) — fetch com o erro tratado, pra usar no lugar de fetch() em toda
// chamada à API desta app.
//
// Até 22/09/2026, 40 das 42 chamadas ignoravam o status da resposta e iam direto pro .json().
// Um 500 do servidor virava então um erro de sintaxe do JSON, ou pior: um objeto {error:"..."}
// tratado como se fossem os dados, o que deixava a tela em branco sem dizer nada. A causa real
// ficava só no console, onde ninguém olha.
//
// Devolve a Response, igual ao fetch, então quem chama segue fazendo await res.json(). O que
// muda é que respostas 4xx/5xx viram exceção com a mensagem do servidor (as rotas respondem
// {error:"..."}), caindo no try/catch que essas telas já têm.
async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (error) {
    // Falha de rede: servidor fora do ar, sem internet, requisição bloqueada.
    throw new Error('Não foi possível falar com o servidor. Verifique a conexão e tente de novo.');
  }
  if (res.ok) return res;

  // A resposta de erro das rotas é {error:"..."}; se não for JSON, não insiste.
  let detalhe = '';
  try {
    const corpo = await res.clone().json();
    if (corpo && corpo.error) detalhe = String(corpo.error);
  } catch (error) { /* corpo vazio ou não-JSON */ }

  if (detalhe) throw new Error(detalhe);
  if (res.status === 401) throw new Error('Sua sessão expirou. Entre de novo para continuar.');
  if (res.status === 404) throw new Error('Não encontrado.');
  if (res.status === 429) throw new Error('Muitas solicitações em pouco tempo. Aguarde um instante e tente de novo.');
  if (res.status >= 500) throw new Error('O servidor falhou ao responder (erro ' + res.status + '). Tente de novo em instantes.');
  throw new Error('A solicitação falhou (erro ' + res.status + ').');
}
window.apiFetch = apiFetch;

// loadErrorHtml(mensagem) — o que mostrar no lugar do conteúdo quando a carga da tela falha.
// Antes, várias telas não tinham try/catch nenhum na função load(): a promessa era rejeitada sem
// ninguém ouvir e a página ficava presa na animação de carregamento, para sempre e em silêncio.
// A causa aparecia só no console. Um bloco só, aqui, pra todas mostrarem a mesma coisa.
function loadErrorHtml(mensagem) {
  return '<div class="empty load-error">'
    + '<i class="bi bi-exclamation-triangle load-error-icon"></i>'
    + '<div>' + escapeHtml(mensagem || 'Não foi possível carregar esta tela.') + '</div>'
    + '<button type="button" class="load-error-retry" onclick="location.reload()">Tentar de novo</button>'
    + '</div>';
}
window.loadErrorHtml = loadErrorHtml;

// setBrandLogoImg — preenche/esconde um <img class="brand-logo-mini"> com o logo da marca
// (registry.js expõe `logo` por marca, ver getRegistryTree). Reaproveitado por todas as páginas
// que têm seletor de Marca, pra não duplicar essa checagem em cada `buildBrandSelector()`. Some
// (display:none) quando a marca não tem `logo` configurado — nunca quebra o layout.
function setBrandLogoImg(imgEl, brand) {
  if (!imgEl) return;
  if (brand?.logo) {
    // onerror: se o arquivo configurado no registry não existir em public/, esconde em vez de
    // deixar o ícone de imagem quebrada na tela (uma marca nova pode ser cadastrada antes de
    // alguém subir o logo dela).
    imgEl.onerror = () => { imgEl.style.display = 'none'; };
    imgEl.src = brand.logo;
    imgEl.alt = brand.name;
    imgEl.title = brand.name;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }
}
window.setBrandLogoImg = setBrandLogoImg;

// pageLoaderHtml() — substitui o texto "carregando…" pela animação de anéis (ver CSS acima)
// enquanto a primeira busca de dado da página não volta. Reaproveitado por toda página que tem
// um `<div class="empty">carregando…</div>` como placeholder inicial.
function pageLoaderHtml() {
  return `<div class="page-loader"><div class="typewriter">
  <div class="slide"><i></i></div>
  <div class="paper"></div>
  <div class="keyboard"></div>
</div></div>`;
}
window.pageLoaderHtml = pageLoaderHtml;

// aiLoaderHtml() — animação específica de espera de chamada de IA (resumo por post, geração de
// relatório) — usar no lugar do texto "Gerando…"/"Gerando com IA…" enquanto a chamada não volta.
function aiLoaderHtml() {
  const gem = (id) => `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
    <defs>
      <filter id="shine"><feGaussianBlur stdDeviation="3"></feGaussianBlur></filter>
      <mask id="mask"><path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="white"></path></mask>
      <radialGradient id="gradient-1" cx="50" cy="66" fx="50" fy="66" r="30" gradientTransform="translate(0 35) scale(1 0.5)" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="black" stop-opacity="0.3"></stop><stop offset="50%" stop-color="black" stop-opacity="0.1"></stop><stop offset="100%" stop-color="black" stop-opacity="0"></stop>
      </radialGradient>
      <radialGradient id="gradient-2" cx="55" cy="20" fx="55" fy="20" r="30" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="white" stop-opacity="0.3"></stop><stop offset="50%" stop-color="white" stop-opacity="0.1"></stop><stop offset="100%" stop-color="white" stop-opacity="0"></stop>
      </radialGradient>
      <radialGradient id="gradient-3" cx="85" cy="50" fx="85" fy="50" xlink:href="#gradient-2"></radialGradient>
      <radialGradient id="gradient-4" cx="50" cy="58" fx="50" fy="58" r="60" gradientTransform="translate(0 47) scale(1 0.2)" xlink:href="#gradient-3"></radialGradient>
      <linearGradient id="gradient-5" x1="50" y1="90" x2="50" y2="10" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="black" stop-opacity="0.2"></stop><stop offset="40%" stop-color="black" stop-opacity="0"></stop>
      </linearGradient>
    </defs>
    <g>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="currentColor"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="url(#gradient-1)"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="none" stroke="white" opacity="0.3" stroke-width="3" filter="url(#shine)" mask="url(#mask)"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="url(#gradient-2)"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="url(#gradient-3)"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="url(#gradient-4)"></path>
      <path d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z" fill="url(#gradient-5)"></path>
    </g>
  </svg>`;
  return `<div class="ai-loader"><div class="loader">
    ${gem('pegtopone')}
    ${gem('pegtoptwo')}
    ${gem('pegtopthree')}
  </div></div>`;
}
window.aiLoaderHtml = aiLoaderHtml;

// showAiThinkingOverlay(container) — borrão + animação de IA por cima de um card inteiro
// enquanto uma chamada de IA está em andamento (resumo por post, geração de relatório), com um
// texto trocando periodicamente ("Pensando…", "Lendo os dados…" etc.) pra reforçar que é uma
// espera de verdade, não a tela travada. Devolve uma função `hide()` — sempre chamar no
// `finally` do try/catch da chamada, sucesso ou erro.
const AI_THINKING_WORDS = ['Pensando', 'Lendo os dados', 'Analisando', 'Escrevendo', 'Quase pronto'];
function showAiThinkingOverlay(container) {
  if (!container) return () => {};
  const prevPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const overlay = document.createElement('div');
  overlay.className = 'ai-thinking-overlay';
  overlay.innerHTML = aiLoaderHtml() + '<div class="ai-thinking-text"></div>';
  container.appendChild(overlay);
  const textEl = overlay.querySelector('.ai-thinking-text');
  let i = 0;
  textEl.textContent = AI_THINKING_WORDS[0] + '…';
  const interval = setInterval(() => {
    i = (i + 1) % AI_THINKING_WORDS.length;
    textEl.textContent = AI_THINKING_WORDS[i] + '…';
  }, 1400);
  let hidden = false;
  return function hide() {
    if (hidden) return;
    hidden = true;
    clearInterval(interval);
    overlay.remove();
    container.style.position = prevPosition;
  };
}
window.showAiThinkingOverlay = showAiThinkingOverlay;

// initCollapsibleNotice — minimiza/reabre um card de aviso (limit-note, coverage-note, etc.)
// com animação: encolhe no lugar e vira uma bolinha fixa no canto da tela (fora do fluxo normal,
// pra dar espaço aos cards subirem). Estado (aberto/fechado) fica só neste navegador — cada aviso
// usa sua própria storageKey pra não vazar estado entre páginas/avisos diferentes. Reaproveitado
// por index.html, cofrinho.html e stories.html em vez de duplicar a lógica em cada uma.
function initCollapsibleNotice({ noteId, collapseBtnId, fabId, storageKey }) {
  const note = document.getElementById(noteId);
  const collapseBtn = document.getElementById(collapseBtnId);
  const fab = document.getElementById(fabId);
  if (!note || !collapseBtn || !fab) return;

  function collapse(animate) {
    localStorage.setItem(storageKey, '1');
    if (!animate) {
      note.style.display = 'none';
      fab.classList.add('show', 'in');
      return;
    }
    note.classList.add('is-collapsing');
    note.addEventListener('transitionend', function onEnd(e) {
      if (e.target !== note) return;
      note.removeEventListener('transitionend', onEnd);
      note.style.display = 'none';
      fab.classList.add('show');
      requestAnimationFrame(() => requestAnimationFrame(() => fab.classList.add('in')));
    });
  }

  function expand() {
    localStorage.removeItem(storageKey);
    fab.classList.remove('in');
    setTimeout(() => fab.classList.remove('show'), 200);
    note.style.display = '';
    void note.offsetWidth; // força reflow pra a transição de volta rodar
    note.classList.remove('is-collapsing');
  }

  collapseBtn.addEventListener('click', () => collapse(true));
  fab.addEventListener('click', expand);
  if (localStorage.getItem(storageKey) === '1') collapse(false);
}
window.initCollapsibleNotice = initCollapsibleNotice;

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Prefixo das chaves de localStorage: coco_* -> vpl_*
//
//  As chaves nasceram com o nome da única marca que existia ("vpl_sm_since", "vpl_aud_mode").
//  Com Coco and Luna e Yucaloo na mesma dashboard, o prefixo passou a mentir. `vpl` é a empresa
//  (Vita Pet Life), que é o escopo real: preferência de período, de tema e de barra lateral é de
//  quem usa, não da marca que está selecionada.
//
//  Roda antes de qualquer leitura — inclusive a da marca selecionada, logo abaixo — pra ninguém
//  perder o que já tinha salvo. Copia e apaga a chave antiga; na segunda visita não há mais o que
//  migrar e o laço não faz nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────
(function migrarPrefixoDeArmazenamento() {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (!chave.startsWith('coco_')) continue;
      const nova = 'vpl_' + chave.slice('coco_'.length);
      if (localStorage.getItem(nova) === null) localStorage.setItem(nova, localStorage.getItem(chave));
      localStorage.removeItem(chave);
    }
  } catch (error) {
    /* Modo privado ou armazenamento bloqueado: segue com os padrões, nada quebra. */
  }
})();

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  DashboardBrand — marca selecionada, compartilhada por todas as páginas.
//
//  Antes cada página tinha seu próprio buildBrandSelector() na topbar (7 cópias divergentes do
//  mesmo código) e todas liam a mesma chave de localStorage. O controle agora é um só, na
//  sidebar, e as páginas apenas perguntam "qual marca?" e "me avise quando mudar".
//
//  Uso numa página:
//     await DashboardBrand.ready;          // registry já carregado
//     const brandId = DashboardBrand.id();
//     DashboardBrand.onChange(() => load());
// ─────────────────────────────────────────────────────────────────────────────────────────────
const BRAND_STORAGE_KEY = 'vpl_sm_brand';
let registryTree = null;
let currentBrandId = null;
const brandListeners = [];
// Vira true quando alguma parte da página declara depender da conexão com a Meta (ver onChange).
let metaDependentPage = false;
let markBrandReady;
const brandReady = new Promise(resolve => { markBrandReady = resolve; });

window.DashboardBrand = {
  // Promise que resolve quando /api/registry chegou e a marca inicial já está decidida.
  ready: brandReady,
  id: () => currentBrandId,
  brands: () => (registryTree && registryTree.brands) || [],
  company: () => registryTree && registryTree.company,
  current() { return this.brands().find(b => b.id === currentBrandId) || null; },
  // Marca cadastrada porém sem credencial da Meta (ver `configured` em src/registry.js).
  isConnected() { const b = this.current(); return Boolean(b && b.configured); },
  // Registrar um listener é também o que marca esta página como dependente da conexão com a
  // Meta: telas que não reagem à marca (Chamados, Configurações, Sobre) nunca chamam isto e, por
  // isso, não recebem o aviso de marca não conectada — ele seria falso ali, já que funcionam
  // igual com qualquer marca.
  //
  // `metaNotice: false` é pra quem depende da marca mas NÃO da Meta. Hoje é o caso de Cliques:
  // os eventos vêm da página da loja no Shopify, não da Graph API, então a tela tem dado mesmo
  // com a marca sem token — e dizer ali que "as telas ficam vazias até conectar a Meta" seria
  // simplesmente mentira.
  //
  // Reavalia o aviso na hora, porque a inscrição acontece depois do carregamento do registry (a
  // página só se inscreve após aguardar DashboardBrand.ready).
  onChange(callback, { metaNotice = true } = {}) {
    brandListeners.push(callback);
    if (metaNotice) metaDependentPage = true;
    renderBrandNotice();
    applyBrandNaming();
  },
};

// Nome da marca no título da aba e no rodapé. Até 22/09/2026 as 12 páginas tinham "Coco and
// Luna" escrito na mão nos dois lugares — com duas marcas isso virou mentira: a aba dizia
// "Cliques · Coco and Luna" com a Yucaloo selecionada.
//
// O HTML traz o nome da empresa como padrão (correto e estável enquanto o registry não chega, e
// correto pra sempre nas telas da equipe inteira). Quem opta por mostrar a marca é a própria
// página, pondo um <span data-brand-label> no rodapé — marcador explícito em vez de adivinhação
// por texto, e o mesmo sinal decide se o título da aba também acompanha.
function applyBrandNaming() {
  const marcadores = document.querySelectorAll('[data-brand-label]');
  if (!marcadores.length) return;
  const brand = window.DashboardBrand.current();
  const nome = brand ? brand.name : (registryTree && registryTree.company ? registryTree.company.name : null);
  if (!nome) return;

  for (const el of marcadores) el.textContent = nome;

  // Troca só o último segmento do título ("Cliques · Vita Pet Life" -> "Cliques · Yucaloo"),
  // preservando títulos com mais de um separador.
  const partes = document.title.split('·');
  if (partes.length > 1) {
    partes[partes.length - 1] = ' ' + nome;
    document.title = partes.join('·');
  }
}

function notifyBrandChange() {
  for (const callback of brandListeners) {
    // Um listener que estoura não pode impedir os outros de rodarem nem travar a troca de marca.
    try { callback(currentBrandId); } catch (error) { console.error('DashboardBrand.onChange:', error); }
  }
}

// Aviso global de marca sem conexão — injetado uma vez, logo abaixo da .topbar (classe presente
// em toda página, ver Arquitetura no CLAUDE.md). Um ponto só em vez de um estado vazio diferente
// em cada uma das 9 telas. Sem ele, marca não conectada fica indistinguível de marca sem dado no
// período: a tela inteira vira travessão e "sem dado ainda", sem dizer o porquê.
function renderBrandNotice() {
  const existing = document.getElementById('brandNotConnectedNotice');
  const brand = window.DashboardBrand.current();
  // Página que não depende da conexão com a Meta nunca mostra este aviso (ver onChange acima).
  if (!metaDependentPage || !brand || brand.configured) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    existing.querySelector('.bnc-brand').textContent = brand.name;
    return;
  }
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const notice = document.createElement('div');
  notice.id = 'brandNotConnectedNotice';
  notice.className = 'brand-not-connected';
  notice.innerHTML = '<i class="bi bi-plug"></i><div><strong class="bnc-brand"></strong> ainda não está conectada à Meta.'
    + ' As telas ficam vazias até alguém cadastrar o token do Business Manager dela e os IDs das contas'
    + ' de Instagram e Facebook. Enquanto isso, escolha outra marca no seletor da sidebar.</div>';
  notice.querySelector('.bnc-brand').textContent = brand.name;
  topbar.insertAdjacentElement('afterend', notice);
}
window.renderBrandNotice = renderBrandNotice;

(function () {
  const html = `
<button id="sidebarOpen" class="sidebar-open-btn" title="Abrir menu"><i class="bi bi-list"></i></button>
<div id="sidebarOverlay" class="sidebar-overlay"></div>
<nav class="sidebar">
  <div class="sidebar-header">
    <button id="sidebarToggle" class="sidebar-close-btn" title="Esconder menu"><i class="bi bi-layout-sidebar-reverse"></i></button>
  </div>
  <div class="brand">
    <img src="Logo2.png" alt="Vita Pet Life" class="brand-mark">
    <div class="brand-text">
      <span class="brand-name">Vita Pet Life</span>
      <span class="brand-sub">Redes Sociais</span>
    </div>
  </div>
  <div class="brand-switch" id="brandSwitch" style="display:none">
    <div class="nav-label">Marca</div>
    <button type="button" class="brand-switch-btn" id="brandSwitchBtn" aria-haspopup="listbox" aria-expanded="false">
      <img class="brand-switch-logo" id="brandSwitchLogo" alt="" style="display:none">
      <span class="brand-switch-name" id="brandSwitchName">—</span>
      <span class="brand-switch-arrow" aria-hidden="true">&#9662;</span>
    </button>
    <div class="brand-switch-pop" id="brandSwitchPop" role="listbox"></div>
  </div>
  <div class="nav-group">
    <div class="nav-label">Painel</div>
    <a class="nav-item" href="/"><i class="bi bi-grid-1x2-fill nav-icon"></i> Visão geral</a>
    <a class="nav-item" href="/conteudos"><i class="bi bi-images nav-icon"></i> Conteúdos</a>
    <a class="nav-item" href="/metas"><i class="bi bi-bullseye nav-icon"></i> Metas</a>
    <a class="nav-item" href="/stories"><i class="bi bi-play-circle nav-icon"></i> Stories</a>
    <a class="nav-item" href="/audiencia"><i class="bi bi-globe-americas nav-icon"></i> Audiência</a>
    <a class="nav-item" href="/cofrinho"><i class="bi bi-piggy-bank-fill nav-icon"></i> Cofrinho</a>
    <a class="nav-item" href="/cliques"><i class="bi bi-cursor-fill nav-icon"></i> Cliques</a>
    <a class="nav-item" href="/chamados"><i class="bi bi-kanban-fill nav-icon"></i> Chamados</a>
    <a class="nav-item" href="/relatorios"><i class="bi bi-file-earmark-bar-graph-fill nav-icon"></i> Relatórios</a>
  </div>
  <div class="nav-group" id="sidebarBottomGroup" style="margin-top:auto">
    <a class="nav-item" href="/sobre"><i class="bi bi-info-circle-fill nav-icon"></i> Sobre</a>
    <a class="nav-item" href="/configuracoes"><i class="bi bi-gear-fill nav-icon"></i> Configurações</a>
    <a class="nav-item" href="#" id="sidebarLogout" style="display:none"><i class="bi bi-box-arrow-right nav-icon"></i> Sair</a>
  </div>
</nav>`;

  const css = `
.sidebar{width:224px;min-height:100vh;background:linear-gradient(160deg,#fbe3e0 0%,#f6e9ec 45%,#eef1fb 100%);
  border-right:1px solid rgba(28,43,57,.08);display:flex;flex-direction:column;padding:22px 0;
  position:fixed;top:0;left:0;z-index:200;transition:transform .25s cubic-bezier(.4,0,.2,1)}
.sidebar-header{display:flex;justify-content:flex-end;padding:4px 10px 0}
.sidebar-close-btn{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:rgba(28,43,57,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .15s}
.sidebar-close-btn:hover{background:rgba(28,43,57,.08);color:rgba(28,43,57,.85)}
.brand{display:flex;align-items:center;gap:11px;padding:0 20px 22px;margin-bottom:14px;border-bottom:1px solid rgba(28,43,57,.08)}
.brand-mark{width:34px;height:34px;border-radius:10px;object-fit:cover;flex-shrink:0}
.brand-text{display:flex;flex-direction:column;line-height:1.3}
.brand-name{font-size:13px;font-weight:700;color:#1c2b39}
.brand-sub{font-size:10.5px;color:#6f7c88}
/* ── Seletor de marca (ver DashboardBrand no topo). Fica na sidebar, não na topbar de cada
   página: marca é o contexto de tudo que se vê, diferente de país/período, que são filtros de
   análise e continuam por página. ── */
.brand-switch{padding:0 12px;margin:-4px 0 18px;position:relative}
.brand-switch-btn{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;
  border:1px solid rgba(28,43,57,.12);background:rgba(255,255,255,.65);color:#1c2b39;cursor:pointer;
  font-size:12.5px;font-weight:600;text-align:left;transition:background .15s,border-color .15s}
.brand-switch-btn:hover{background:rgba(255,255,255,.95);border-color:rgba(28,43,57,.22)}
.brand-switch-logo{height:13px;width:auto;max-width:54px;object-fit:contain;flex-shrink:0}
.brand-switch-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brand-switch-arrow{font-size:10px;opacity:.5;flex-shrink:0}
.brand-switch-pop{display:none;position:absolute;left:12px;right:12px;top:calc(100% + 4px);z-index:40;
  background:#fff;border:1px solid rgba(28,43,57,.12);border-radius:10px;padding:5px;
  box-shadow:0 8px 24px rgba(28,43,57,.16)}
.brand-switch.open .brand-switch-pop{display:block}
.brand-switch-opt{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:7px;cursor:pointer;
  font-size:12.5px;color:#1c2b39;transition:background .12s}
.brand-switch-opt:hover{background:rgba(28,43,57,.07)}
.brand-switch-opt.active{font-weight:700}
.brand-switch-opt img{height:13px;width:auto;max-width:54px;object-fit:contain;flex-shrink:0}
.brand-switch-opt .bs-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Bolinha de "não conectada": a marca existe no registry mas não tem credencial da Meta ainda. */
.brand-switch-dot{width:6px;height:6px;border-radius:50%;background:#e0a800;flex-shrink:0}
.brand-switch-btn .brand-switch-dot{margin-left:2px}

/* Aviso de marca sem conexão, injetado abaixo da .topbar em qualquer página (renderBrandNotice). */
.brand-not-connected{display:flex;align-items:flex-start;gap:10px;margin:0 32px 18px;padding:12px 14px;
  border:1px solid #f0d48a;background:#fdf6e3;color:#6b5514;border-radius:11px;font-size:12.5px;line-height:1.5}
.brand-not-connected i{font-size:15px;line-height:1.3;flex-shrink:0}
@media(max-width:768px){.brand-not-connected{margin:0 16px 14px}}

/* Bloco de erro de carga (loadErrorHtml). Mesma caixa em todas as telas. */
.load-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  min-height:min(40vh,320px);max-width:440px;margin:0 auto;line-height:1.6;text-align:center}
.load-error-icon{font-size:24px;color:#c9a227}
.load-error-retry{border:1px solid rgba(28,43,57,.18);background:#fff;color:#1c2b39;border-radius:8px;
  padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
.load-error-retry:hover{background:rgba(28,43,57,.06)}

.nav-group{margin-bottom:22px;padding:0 12px}
.nav-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#7c8794;padding:0 10px;margin-bottom:6px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;font-size:13px;font-weight:500;color:#1c2b39;
  cursor:pointer;transition:background .15s,color .15s;text-decoration:none}
.nav-item:hover{background:rgba(28,43,57,.07)}
.nav-item.active{background:#1c2b39;color:#fff}
.nav-icon{font-size:14px;width:16px;text-align:center;flex-shrink:0;opacity:.85}
.sidebar-open-btn{display:none;position:fixed;left:14px;top:14px;z-index:300;width:36px;height:36px;border-radius:9px;
  border:1px solid var(--border2);background:var(--surface);color:var(--sub);cursor:pointer;align-items:center;
  justify-content:center;font-size:17px;box-shadow:0 2px 10px rgba(28,43,57,.12)}
body.sidebar-hidden .sidebar-open-btn{display:flex}
body.sidebar-mobile-open .sidebar-open-btn{display:none!important}
.sidebar-overlay{position:fixed;inset:0;background:rgba(28,43,57,.4);z-index:150;opacity:0;pointer-events:none;transition:opacity .2s}
body.sidebar-mobile-open .sidebar-overlay{opacity:1;pointer-events:auto}
body.sidebar-mobile-open .sidebar{transform:translateX(0)!important}
body.sidebar-hidden .sidebar{transform:translateX(-100%)}
@media(max-width:768px){
  .sidebar{transform:translateX(-100%)}
  .sidebar-open-btn{display:flex}
}
/* O botão de abrir a sidebar é position:fixed no canto superior esquerdo, por cima de qualquer
   página — sempre que ele aparece (mobile sempre; desktop com a sidebar minimizada) ele ficava em
   cima do título/texto do .topbar de baixo (bug real encontrado pelo Luan em 24/07/2026, print
   mostrando o hambúrguer cobrindo "Redes Sociais"/"última sincronização"). .topbar é a mesma
   classe em toda página (ver Arquitetura no CLAUDE.md), então um único ponto aqui resolve pra
   todas de uma vez em vez de duplicar em cada página. CUIDADO: este CSS vive dentro de um
   template literal JS (a variável css abaixo) — nunca usar crase aqui dentro, ela fecha a
   string mais cedo e quebra o mount() inteiro (bug real, encontrado e corrigido no mesmo dia). */
body.sidebar-hidden .topbar{padding-left:64px}
@media(max-width:768px){
  .topbar{padding-left:64px}
}

/* ── Loader genérico (troca o texto "carregando…" enquanto a primeira busca de dado não volta) —
   via pageLoaderHtml() acima. Peça de <uiverse.io/Nawsome>. Tudo escopado sob .page-loader e com
   os @keyframes renomeados: os nomes originais eram bounce05/slide05/paper05/keyboard05,
   genéricos demais pra CSS global que entra em toda página da dashboard. ── */
/* padding-top generoso: .paper é position:absolute com top:-26px e sobe durante a animação,
   invadindo o espaço acima da caixa — sem essa folga ele passa por cima do conteúdo de cima. */
.page-loader{display:flex;align-items:center;justify-content:center;padding:46px 0 18px}
.page-loader .typewriter{--blue:#5C86FF;--blue-dark:#275EFE;--key:#fff;--paper:#EEF0FD;--text:#D3D4EC;--tool:#FBC56C;--duration:3s;
  position:relative;animation:pageLoaderBounce var(--duration) linear infinite}
.page-loader .typewriter .slide{width:92px;height:20px;border-radius:3px;margin-left:14px;transform:translateX(14px);
  background:linear-gradient(var(--blue),var(--blue-dark));animation:pageLoaderSlide var(--duration) ease infinite}
.page-loader .typewriter .slide:before,.page-loader .typewriter .slide:after,
.page-loader .typewriter .slide i:before{content:"";position:absolute;background:var(--tool)}
.page-loader .typewriter .slide:before{width:2px;height:8px;top:6px;left:100%}
.page-loader .typewriter .slide:after{left:94px;top:3px;height:14px;width:6px;border-radius:3px}
.page-loader .typewriter .slide i{display:block;position:absolute;right:100%;width:6px;height:4px;top:4px;background:var(--tool)}
.page-loader .typewriter .slide i:before{right:100%;top:-2px;width:4px;border-radius:2px;height:14px}
.page-loader .typewriter .paper{position:absolute;left:24px;top:-26px;width:40px;height:46px;border-radius:5px;
  background:var(--paper);transform:translateY(46px);animation:pageLoaderPaper var(--duration) linear infinite}
.page-loader .typewriter .paper:before{content:"";position:absolute;left:6px;right:6px;top:7px;border-radius:2px;height:4px;
  transform:scaleY(0.8);background:var(--text);box-shadow:0 12px 0 var(--text),0 24px 0 var(--text),0 36px 0 var(--text)}
.page-loader .typewriter .keyboard{width:120px;height:56px;margin-top:-10px;z-index:1;position:relative}
.page-loader .typewriter .keyboard:before,.page-loader .typewriter .keyboard:after{content:"";position:absolute}
.page-loader .typewriter .keyboard:before{top:0;left:0;right:0;bottom:0;border-radius:7px;
  background:linear-gradient(135deg,var(--blue),var(--blue-dark));transform:perspective(10px) rotateX(2deg);transform-origin:50% 100%}
.page-loader .typewriter .keyboard:after{left:2px;top:25px;width:11px;height:4px;border-radius:2px;
  box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key);
  animation:pageLoaderKeyboard var(--duration) linear infinite}
@keyframes pageLoaderBounce{
  85%,92%,100%{transform:translateY(0)}
  89%{transform:translateY(-4px)}
  95%{transform:translateY(2px)}
}
@keyframes pageLoaderSlide{
  5%{transform:translateX(14px)}
  15%,30%{transform:translateX(6px)}
  40%,55%{transform:translateX(0)}
  65%,70%{transform:translateX(-4px)}
  80%,89%{transform:translateX(-12px)}
  100%{transform:translateX(14px)}
}
@keyframes pageLoaderPaper{
  5%{transform:translateY(46px)}
  20%,30%{transform:translateY(34px)}
  40%,55%{transform:translateY(22px)}
  65%,70%{transform:translateY(10px)}
  80%,85%{transform:translateY(0)}
  92%,100%{transform:translateY(46px)}
}
@keyframes pageLoaderKeyboard{
  5%,12%,21%,30%,39%,48%,57%,66%,75%,84%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  9%{box-shadow:15px 2px 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  18%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 2px 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  27%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 12px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  36%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 12px 0 var(--key),60px 12px 0 var(--key),68px 12px 0 var(--key),83px 10px 0 var(--key)}
  45%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 2px 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  54%{box-shadow:15px 0 0 var(--key),30px 2px 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  63%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 12px 0 var(--key)}
  72%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 2px 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 10px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
  81%{box-shadow:15px 0 0 var(--key),30px 0 0 var(--key),45px 0 0 var(--key),60px 0 0 var(--key),75px 0 0 var(--key),90px 0 0 var(--key),22px 10px 0 var(--key),37px 12px 0 var(--key),52px 10px 0 var(--key),60px 10px 0 var(--key),68px 10px 0 var(--key),83px 10px 0 var(--key)}
}

/* ── Loader específico de espera de IA (resumo por post, geração de relatório). Peças de
   <uiverse.io/andrew-manzyk>. IDs internos do SVG (mask/gradientes) podem se repetir se houver
   mais de uma instância na página ao mesmo tempo — inofensivo aqui porque todas as instâncias
   usam exatamente as mesmas definições, então não importa qual delas o navegador resolve. ── */
/* min-height reserva espaço pro alcance vertical real da animação (as "joias" viajam bem além da
   caixa 0-altura do .loader via translateY absoluto) — sem isso, o texto abaixo (na pilha flex do
   .ai-thinking-overlay) fica perto demais do centro da animação e as joias passam por cima dele. */
.ai-loader{display:flex;align-items:center;justify-content:center;padding:6px 0;min-height:140px}
.ai-loader .loader{--fill-color:#946200;--shine-color:#94620033;transform:scale(.4);width:100px;height:auto;position:relative;filter:drop-shadow(0 0 10px var(--shine-color))}
.ai-loader .loader #pegtopone{position:absolute;animation:aiLoaderFloweOne 1s linear infinite}
.ai-loader .loader #pegtoptwo{position:absolute;opacity:0;transform:scale(0) translateY(-200px) translateX(-100px);animation:aiLoaderFloweTwo 1s linear infinite;animation-delay:.3s}
.ai-loader .loader #pegtopthree{position:absolute;opacity:0;transform:scale(0) translateY(-200px) translateX(100px);animation:aiLoaderFloweThree 1s linear infinite;animation-delay:.6s}
.ai-loader .loader svg g path:first-child{fill:var(--fill-color)}
@keyframes aiLoaderFloweOne{
  0%{transform:scale(.5) translateY(-200px);opacity:0}
  25%{transform:scale(.75) translateY(-100px);opacity:1}
  50%{transform:scale(1) translateY(0);opacity:1}
  75%{transform:scale(.5) translateY(50px);opacity:1}
  100%{transform:scale(0) translateY(100px);opacity:0}
}
@keyframes aiLoaderFloweTwo{
  0%{transform:scale(.5) rotateZ(-10deg) translateY(-200px) translateX(-100px);opacity:0}
  25%{transform:scale(1) rotateZ(-5deg) translateY(-100px) translateX(-50px);opacity:1}
  50%{transform:scale(1) rotateZ(0deg) translateY(0) translateX(-25px);opacity:1}
  75%{transform:scale(.5) rotateZ(5deg) translateY(50px) translateX(0);opacity:1}
  100%{transform:scale(0) rotateZ(10deg) translateY(100px) translateX(25px);opacity:0}
}
@keyframes aiLoaderFloweThree{
  0%{transform:scale(.5) rotateZ(10deg) translateY(-200px) translateX(100px);opacity:0}
  25%{transform:scale(1) rotateZ(5deg) translateY(-100px) translateX(50px);opacity:1}
  50%{transform:scale(1) rotateZ(0deg) translateY(0) translateX(25px);opacity:1}
  75%{transform:scale(.5) rotateZ(-5deg) translateY(50px) translateX(0);opacity:1}
  100%{transform:scale(0) rotateZ(-10deg) translateY(100px) translateX(-25px);opacity:0}
}

/* ── Overlay de "pensando" — borrão leve por cima do card inteiro + texto trocando, enquanto
   uma chamada de IA está em andamento (ver showAiThinkingOverlay em cima). ── */
.ai-thinking-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:8px;background:rgba(255,255,255,.62);backdrop-filter:blur(3px);
  -webkit-backdrop-filter:blur(3px);border-radius:inherit;z-index:80;animation:aiThinkingFadeIn .2s ease}
.ai-thinking-text{font-size:11.5px;font-weight:700;color:#946200;letter-spacing:.2px}
@keyframes aiThinkingFadeIn{from{opacity:0}to{opacity:1}}
`;

  function mount() {
    if (document.querySelector('nav.sidebar')) return;
    const style = document.createElement('style');
    style.id = 'sidebarComponentStyle';
    style.textContent = css;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('afterbegin', html);

    // Marca o item ativo pela página atual — URL limpa agora (/conteudos, não /conteudos.html,
    // ver extensions:['html'] em server.js), mas ainda normaliza .html/"/index" caso alguém
    // chegue por um link antigo ou favorito salvo com o nome completo do arquivo.
    let current = location.pathname.replace(/\.html$/, '');
    if (current === '/index' || current === '') current = '/';
    document.querySelectorAll('nav.sidebar .nav-item').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === current);
    });

    // "Sair" só aparece quando o login está ligado — com login desligado, não faz sentido
    // oferecer uma ação de logout (não há sessão de verdade pra encerrar).
    const logoutLink = document.getElementById('sidebarLogout');
    fetch('/api/auth/status').then(r => r.json()).then(d => {
      if (d.loginEnabled) logoutLink.style.display = '';
    }).catch(() => {});
    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login';
    });

    // ── Seletor de marca ────────────────────────────────────────────────────────────────────
    // Carregado uma vez por página, aqui, em vez de em cada tela. Resolve a promise
    // DashboardBrand.ready, que é o que as páginas esperam antes da primeira busca de dado.
    const brandSwitch = document.getElementById('brandSwitch');
    const brandBtn = document.getElementById('brandSwitchBtn');
    const brandPop = document.getElementById('brandSwitchPop');
    const brandNameEl = document.getElementById('brandSwitchName');
    const brandLogoEl = document.getElementById('brandSwitchLogo');

    function paintBrandButton() {
      const brand = window.DashboardBrand.current();
      brandNameEl.textContent = brand ? brand.name : '—';
      setBrandLogoImg(brandLogoEl, brand);
      const dot = brandBtn.querySelector('.brand-switch-dot');
      if (dot) dot.remove();
      if (brand && !brand.configured) {
        const mark = document.createElement('span');
        mark.className = 'brand-switch-dot';
        mark.title = 'Sem conexão com a Meta configurada';
        brandBtn.insertBefore(mark, brandBtn.querySelector('.brand-switch-arrow'));
      }
    }

    function paintBrandOptions() {
      brandPop.innerHTML = '';
      for (const brand of window.DashboardBrand.brands()) {
        const opt = document.createElement('div');
        opt.className = 'brand-switch-opt' + (brand.id === currentBrandId ? ' active' : '');
        opt.setAttribute('role', 'option');
        opt.dataset.value = brand.id;
        if (brand.logo) {
          const img = document.createElement('img');
          img.onerror = () => { img.style.display = 'none'; };
          img.src = brand.logo;
          img.alt = '';
          opt.appendChild(img);
        }
        const name = document.createElement('span');
        name.className = 'bs-name';
        name.textContent = brand.name;
        opt.appendChild(name);
        if (!brand.configured) {
          const mark = document.createElement('span');
          mark.className = 'brand-switch-dot';
          mark.title = 'Sem conexão com a Meta configurada';
          opt.appendChild(mark);
        }
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          brandSwitch.classList.remove('open');
          brandBtn.setAttribute('aria-expanded', 'false');
          if (brand.id === currentBrandId) return;
          currentBrandId = brand.id;
          try { localStorage.setItem(BRAND_STORAGE_KEY, currentBrandId); } catch (error) { /* modo privado */ }
          paintBrandButton();
          paintBrandOptions();
          renderBrandNotice();
          applyBrandNaming();
          notifyBrandChange();
        });
        brandPop.appendChild(opt);
      }
    }

    brandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = brandSwitch.classList.toggle('open');
      brandBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', () => {
      brandSwitch.classList.remove('open');
      brandBtn.setAttribute('aria-expanded', 'false');
    });

    fetch('/api/registry')
      .then(r => { if (!r.ok) throw new Error('registry HTTP ' + r.status); return r.json(); })
      .then(tree => {
        registryTree = tree;
        const brands = window.DashboardBrand.brands();
        let saved = null;
        try { saved = localStorage.getItem(BRAND_STORAGE_KEY); } catch (error) { /* modo privado */ }
        // Marca salva que não existe mais (renomeada/removida do registry) cai na primeira.
        currentBrandId = brands.some(b => b.id === saved) ? saved : (brands[0] ? brands[0].id : null);
        // Com uma marca só, o seletor não tem função — fica escondido, como era antes na topbar.
        brandSwitch.style.display = brands.length > 1 ? '' : 'none';
        paintBrandButton();
        paintBrandOptions();
        renderBrandNotice();
        applyBrandNaming();
      })
      .catch(error => {
        // Sem registry não dá pra saber a marca. Avisa no console e resolve a promise assim
        // mesmo: a página segue e mostra o próprio erro dela, em vez de ficar carregando pra
        // sempre esperando um ready que nunca vem.
        console.error('Não foi possível carregar as marcas:', error);
        brandSwitch.style.display = 'none';
      })
      .finally(() => markBrandReady(currentBrandId));

    const overlay  = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarToggle');
    const openBtn  = document.getElementById('sidebarOpen');
    const isMobile = () => window.innerWidth <= 768;

    if (!isMobile() && localStorage.getItem('vpl_sm_sidebar') === 'hidden') {
      document.body.classList.add('sidebar-hidden');
    }
    closeBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.remove('sidebar-mobile-open');
      } else {
        const hidden = document.body.classList.toggle('sidebar-hidden');
        localStorage.setItem('vpl_sm_sidebar', hidden ? 'hidden' : 'visible');
      }
    });
    openBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.add('sidebar-mobile-open');
      } else {
        document.body.classList.remove('sidebar-hidden');
        localStorage.setItem('vpl_sm_sidebar', 'visible');
      }
    });
    overlay.addEventListener('click', () => document.body.classList.remove('sidebar-mobile-open'));
    window.addEventListener('resize', () => {
      if (!isMobile()) document.body.classList.remove('sidebar-mobile-open');
      else document.body.classList.remove('sidebar-hidden');
    });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
