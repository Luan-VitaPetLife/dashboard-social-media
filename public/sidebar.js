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

// setBrandLogoImg — preenche/esconde um <img class="brand-logo-mini"> com o logo da marca
// (registry.js expõe `logo` por marca, ver getRegistryTree). Reaproveitado por todas as páginas
// que têm seletor de Marca, pra não duplicar essa checagem em cada `buildBrandSelector()`. Some
// (display:none) quando a marca não tem `logo` configurado — nunca quebra o layout.
function setBrandLogoImg(imgEl, brand) {
  if (!imgEl) return;
  if (brand?.logo) {
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
  return `<div class="page-loader"><svg class="pl" viewBox="0 0 240 240">
  <circle class="pl__ring pl__ring--a" cx="120" cy="120" r="105" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 660" stroke-dashoffset="-330" stroke-linecap="round"></circle>
  <circle class="pl__ring pl__ring--b" cx="120" cy="120" r="35" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 220" stroke-dashoffset="-110" stroke-linecap="round"></circle>
  <circle class="pl__ring pl__ring--c" cx="85" cy="120" r="70" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 440" stroke-linecap="round"></circle>
  <circle class="pl__ring pl__ring--d" cx="155" cy="120" r="70" fill="none" stroke="#000" stroke-width="20" stroke-dasharray="0 440" stroke-linecap="round"></circle>
</svg></div>`;
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
      <span class="brand-sub">Coco and Luna · Redes Sociais</span>
    </div>
  </div>
  <div class="nav-group">
    <div class="nav-label">Painel</div>
    <a class="nav-item" href="/"><i class="bi bi-grid-1x2-fill nav-icon"></i> Visão geral</a>
    <a class="nav-item" href="/conteudos"><i class="bi bi-images nav-icon"></i> Conteúdos</a>
    <a class="nav-item" href="/metas"><i class="bi bi-bullseye nav-icon"></i> Metas</a>
    <a class="nav-item" href="/stories"><i class="bi bi-play-circle nav-icon"></i> Stories</a>
    <a class="nav-item" href="/cofrinho"><i class="bi bi-piggy-bank-fill nav-icon"></i> Cofrinho</a>
    <a class="nav-item" href="/chamados"><i class="bi bi-kanban-fill nav-icon"></i> Chamados</a>
    <a class="nav-item" href="/relatorios"><i class="bi bi-file-earmark-bar-graph-fill nav-icon"></i> Relatórios</a>
  </div>
  <div class="nav-group" id="sidebarBottomGroup" style="margin-top:auto">
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

/* ── Loader genérico (troca o texto "carregando…" enquanto a primeira busca de dado não volta) —
   via pageLoaderHtml() abaixo. Peças de <uiverse.io/Nawsome>. ── */
.page-loader{display:flex;align-items:center;justify-content:center;padding:18px 0}
.page-loader .pl{width:56px;height:56px}
.page-loader .pl__ring{animation:pageLoaderRingA 2s linear infinite}
.page-loader .pl__ring--a{stroke:#ee2a7b}
.page-loader .pl__ring--b{animation-name:pageLoaderRingB;stroke:#f9ce34}
.page-loader .pl__ring--c{animation-name:pageLoaderRingC;stroke:#4776e6}
.page-loader .pl__ring--d{animation-name:pageLoaderRingD;stroke:#6228d7}
@keyframes pageLoaderRingA{
  from,4%{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-330}
  12%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-335}
  32%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-595}
  40%,54%{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-660}
  62%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-665}
  82%{stroke-dasharray:60 600;stroke-width:30;stroke-dashoffset:-925}
  90%,to{stroke-dasharray:0 660;stroke-width:20;stroke-dashoffset:-990}
}
@keyframes pageLoaderRingB{
  from,12%{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-110}
  20%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-115}
  40%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-195}
  48%,62%{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-220}
  70%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-225}
  90%{stroke-dasharray:20 200;stroke-width:30;stroke-dashoffset:-305}
  98%,to{stroke-dasharray:0 220;stroke-width:20;stroke-dashoffset:-330}
}
@keyframes pageLoaderRingC{
  from{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:0}
  8%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-5}
  28%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-175}
  36%,58%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-220}
  66%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-225}
  86%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-395}
  94%,to{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-440}
}
@keyframes pageLoaderRingD{
  from,8%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:0}
  16%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-5}
  36%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-175}
  44%,50%{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-220}
  58%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-225}
  78%{stroke-dasharray:40 400;stroke-width:30;stroke-dashoffset:-395}
  86%,to{stroke-dasharray:0 440;stroke-width:20;stroke-dashoffset:-440}
}

/* ── Loader específico de espera de IA (resumo por post, geração de relatório). Peças de
   <uiverse.io/andrew-manzyk>. IDs internos do SVG (mask/gradientes) podem se repetir se houver
   mais de uma instância na página ao mesmo tempo — inofensivo aqui porque todas as instâncias
   usam exatamente as mesmas definições, então não importa qual delas o navegador resolve. ── */
.ai-loader{display:flex;align-items:center;justify-content:center;padding:6px 0}
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

    const overlay  = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarToggle');
    const openBtn  = document.getElementById('sidebarOpen');
    const isMobile = () => window.innerWidth <= 768;

    if (!isMobile() && localStorage.getItem('coco_sm_sidebar') === 'hidden') {
      document.body.classList.add('sidebar-hidden');
    }
    closeBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.remove('sidebar-mobile-open');
      } else {
        const hidden = document.body.classList.toggle('sidebar-hidden');
        localStorage.setItem('coco_sm_sidebar', hidden ? 'hidden' : 'visible');
      }
    });
    openBtn.addEventListener('click', () => {
      if (isMobile()) {
        document.body.classList.add('sidebar-mobile-open');
      } else {
        document.body.classList.remove('sidebar-hidden');
        localStorage.setItem('coco_sm_sidebar', 'visible');
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
