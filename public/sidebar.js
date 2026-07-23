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
