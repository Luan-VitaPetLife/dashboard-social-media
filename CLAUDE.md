# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

Dashboard de métricas de redes sociais da marca **Coco and Luna** (Vita Pet Life) — Instagram e Facebook,
separado por mercado (Brasil e Estados Unidos), via Meta Graph API. Interface em pt-BR.

Este projeto é o "irmão" do dashboard principal de vendas (`../dashboard`), que segue o mesmo padrão
visual e arquitetural (Express + store híbrido + `public/*.html` estático), mas foca em **vendas/canais
de e-commerce**. Este aqui foca em **redes sociais** (seguidores, curtidas, engajamento, visualizações).

**Visão de longo prazo (briefing "Central Multirrede de Inteligência de Performance" da Aline Moraes,
Social Media — `Central_de_Inteligencia_de_Performance_Briefing.pdf` na raiz do repo):** o objetivo final
é muito mais amplo do que o que existe hoje — cobrir todas as marcas da Vita Pet Life, múltiplos países,
TikTok além de Meta, ficha de desempenho por conteúdo individual (D+7/D+14/D+30), análise de Stories
24h tela a tela, Social Listening (comentários agrupados por assunto/sentimento), metas editáveis por
conta/rede ("bateria de crescimento"), rastreio de vendas por cupom ("Cofrinho do Social") e relatórios
automáticos (D+7, Stories, mensal por país/rede/geral). A coleta prevista combina integração automática
com um fluxo assistido (link + prints dos Insights + leitura por IA + confirmação humana), e a regra de
ouro é: **quando um dado não estiver disponível, sinalizar a limitação — nunca estimar ou completar um
número**. Já implementados: a **fundação multimarca/multipaís** (empresa → marca → país → conta, ver
`src/registry.js` abaixo), a **ficha de conteúdo por post** (Instagram), o **sinal orgânico×pago**, a
**bateria de crescimento** (metas editáveis), uma **versão limitada de Stories 24h** e o **Cofrinho do
Social** (ver seções próprias abaixo — a versão completa de Stories que o briefing pede esbarra em
limite real da API atual, não é só "ainda não implementado"). O resto do escopo do briefing (TikTok,
Social Listening, relatórios com resumo em texto) ainda não.

## Comandos

```
npm start   # roda o servidor (server.js), porta 3000 por padrão
npm run sync   # dispara uma sincronização manual (mesma função usada pelo agendador)
```

Não há suíte de testes nem linter configurados neste projeto.

Variáveis de ambiente: ver `.env.example`. Sem `META_ACCESS_TOKEN`, o sync roda mas não busca nada (avisa
em `errors`, nada quebra). Sem `MONGODB_URI`, usa `data/db.json` local (não persiste em deploy sem Volume).

## Arquitetura

```
server.js            Express: serve public/ + rotas de API + agendador (sync a cada SYNC_INTERVAL_MINUTES)
src/registry.js       Hierarquia empresa → marca → país → conta, config-driven a partir do .env — fonte
                      única de quais marcas/países/contas existem (ver seção própria abaixo)
src/meta.js           Meta Graph API: snapshot de conta (Instagram Business + Página Facebook), backfill
                      histórico via Insights API, engajamento do período (curtidas/comentários/views) —
                      recebe o metaId da conta já resolvido pelo registry, não conhece marca/país
src/metrics.js        Monta o payload de /api/dashboard: valor atual, delta vs. período anterior (ou
                      período de comparação customizado), série pra gráfico — por plataforma e país,
                      dentro do escopo de marca/país pedido
src/store.js          Store híbrido: MongoDB Atlas se MONGODB_URI existir, senão JSON local em data/db.json
src/sync.js           Itera todas as contas do registry e grava snapshot no store
src/backfill.js       Preenche dias anteriores ao início do sync via Insights API (nunca sobrescreve
                      snapshot real já sincronizado)
src/contentSync.js    Coleta diária de conteúdo individual (posts/Reels do Instagram) — ver seção
                      própria "Ficha de conteúdo" abaixo
src/contentMetrics.js Monta o payload de /api/content: valor atual, checkpoint D+7/D+14/D+30 quando
                      existir, comparação com a mediana do mesmo formato+país
public/index.html     Visão geral: seletor de marca/país, KPIs combinados, cards por conta, tendência,
                      comparação de período, histórico — tudo montado a partir de /api/registry
public/conteudos.html Ficha de conteúdo por post (Instagram) — ver seção própria abaixo
src/goals.js          Bateria de crescimento (metas editáveis) — ver seção própria abaixo
public/metas.html      Tela da bateria de crescimento
src/storySync.js      Coleta de Stories 24h — agendador próprio, mais frequente (ver seção
                      "Stories 24h" abaixo)
src/storyMetrics.js   Monta o payload de /api/stories: amostras, evolução dentro da janela
                      observada
public/stories.html   Tela de Stories 24h (versão limitada)
src/cofrinho.js       Cofrinho do Social (vendas rastreadas, 100% entrada manual) — ver seção
                      própria abaixo
public/cofrinho.html  Tela do Cofrinho do Social
public/chamados.html  Quadro de Chamados (estilo Monday) — ver seção própria abaixo
src/ai.js             Integração com a API da Anthropic (Claude Sonnet 5) — wrapper genérico
                      usado pelo resumo por IA da ficha de conteúdo e pelo gerador de relatórios
src/reportTemplate.js Paleta e helpers de formatação compartilhados pelos dois exportadores de
                      relatório (extraído do PDF de briefing da Aline) — ver seção própria abaixo
src/reportRenderer.js Os dois exportadores de relatório (PDF via pdfkit, DOCX via docx), a partir
                      de um modelo genérico único — ver seção própria abaixo
src/reports.js        Os 5 tipos de relatório do briefing (D+7, Stories 24h, mensal por país/rede/
                      geral) + geração automática agendada — ver seção própria abaixo
public/relatorios.html Tela do gerador de relatórios (geração manual + lista de relatórios gerados)
public/sidebar.js     Sidebar compartilhada (mesmo padrão IIFE do dashboard principal); marca o item
                      ativo pelo nome do arquivo atual (`location.pathname`); expõe `window.escapeHtml`
                      global usado por qualquer página que injete texto livre via innerHTML
src/auth.js           Login único compartilhado (liga/desliga em Configurações) — ver seção própria
public/login.html     Tela de login (só aparece quando o login está ligado)
public/configuracoes.html Tela de Configurações (hoje só o toggle de login) — ver seção própria
```

Fluxo: `sync.js` busca dados da Meta (via `registry.listAccounts()`) → grava snapshot diário em
`store.js` → `metrics.js` calcula o payload sob demanda pro escopo de marca/país pedido → `GET
/api/dashboard` devolve JSON → `public/index.html` desenha. O front-end nunca fala com a Meta Graph API
diretamente, e não hardcoda marca/país/plataforma — tudo vem de `GET /api/registry`.

### Registry (`src/registry.js`) — fundação multimarca/multipaís
- Hierarquia **empresa → marca → país → conta**, montada em memória a partir do `.env` (mesmas variáveis
  de sempre: `META_IG_ACCOUNT_ID_BR/US`, `META_FB_PAGE_ID_BR/US`). Hoje só a marca `coco-and-luna` tem
  contas configuradas (`br`, `us`), mas `sync.js`/`metrics.js`/`server.js` já iteram a estrutura
  genericamente — **adicionar uma marca ou país novo é só acrescentar um objeto em `BRANDS` + as env vars
  correspondentes**, sem tocar no resto do código.
- Contas sem `metaId` (env ausente) são removidas automaticamente (`pruneBrand`) — não aparecem no
  registry nem entram na coleta.
- `listAccounts(brandId?)` achata a árvore em `{brandId, countryId, platform, metaId}[]` — usado por
  `sync.js`/`backfill.js` pra iterar sem conhecer a estrutura aninhada.
- `getRegistryTree()` devolve a árvore **sem metaId** (nenhuma credencial) — é o que `GET /api/registry`
  expõe pro front montar os seletores de Marca/País dinamicamente.

### Ficha de conteúdo (`public/conteudos.html`, `src/contentSync.js`, `src/contentMetrics.js`)
- **Card "Resumo"** no topo da página (`renderSummary()` em `conteudos.html`): Orgânico×Impulsionado
  (donut) + desempenho médio por formato (barras), com alternância Lista/Tabela/Gráfico (mesmo padrão
  visual do card "Comparação de período" de `index.html`) e um botão de ocultar/mostrar — tudo calculado
  no front a partir do payload já devolvido por `/api/content` (sem chamada nova ao servidor). Estado
  (view escolhida + oculto/visível) persistido em `localStorage` (`coco_cnt_sumview`/`coco_cnt_sumhidden`).
  **Cuidado ao mexer no CSS de ocultar:** só `#summaryBody`/`#sumViewToggle` devem sumir com
  `body.cnt-summary-hidden` — o próprio botão de mostrar (`.sum-hide-btn`) precisa continuar visível,
  senão não tem como reverter (bug real encontrado e corrigido em 21/07/2026).
- Só **Instagram** (Reels, Carrossel, Estático, Vídeo de feed) — Facebook e TikTok ficam de fora por
  enquanto. `runContentSync()` roda dentro do mesmo `runSync()` (mesmo ciclo de 12h / botão
  "Sincronizar agora" — não existe um sync separado pro usuário acionar).
- Confirmado ao vivo (21/07/2026, ver histórico de probes descartáveis) que `reach`, `likes`,
  `comments`, `saved`, `shares`, `total_interactions`, `views` funcionam **uniformemente** por post via
  `/{media-id}/insights`, independente de ser REELS/CAROUSEL_ALBUM/IMAGE — não precisa de conjunto de
  métrica diferente por tipo. `impressions` foi descontinuada pela API (todas as versões ≥v22.0);
  `follows`/`profile_visits` só existem no nível de conta, não por mídia.
- Janela de retenção: só rastreia conteúdo publicado nos últimos 35 dias (`RETENTION_DAYS` em
  `contentSync.js`). Uma conta sem post nesse intervalo aparece como "sem dado ainda" — **isso é
  esperado, não é bug** (confirmado: a conta US não posta desde 26/05/2026, > 35 dias antes de hoje).
- **D+7/D+14/D+30 são construídos a partir de agora, não retroativos:** só existe um snapshot por dia
  de cada post a partir do dia em que ele entrou na coleta. Posts antigos (já existentes antes da
  fundação de conteúdo) só têm o valor "atual" (lifetime até agora); só posts publicados a partir de
  agora vão acumular checkpoints de verdade com o passar dos dias. `checkpointSnapshot()` em
  `contentMetrics.js` pega o snapshot mais próximo de N dias após a publicação **sem interpolar** — se
  ainda não existir, o campo fica `null` (a tela mostra "ainda sem esse checkpoint", nunca um número
  inventado).
- **Mediana por grupo** (`mediaProductType` + `countryId`) usa o **valor mais recente** de cada
  conteúdo do grupo — não é uma comparação D+7-a-D+7 estrita entre todo o grupo (simplificação
  deliberada da v1; o briefing pede comparação só entre "mesma rede, formato e objetivo", mas
  `objetivo` é um campo manual nem sempre preenchido, então o agrupamento automático usa só formato).
- **Contexto** (`tema`, `objetivo`, `pilar`, `produto`, `gancho`, `cta`, `observacao`) é editado pela
  equipe direto no card (salva no blur de cada campo, `PATCH /api/content/:mediaId/context`) e nunca é
  sobrescrito pelo sync. **Cuidado ao mexer nessa rota:** ela precisa igualar meta com `if (key in
  req.body)` antes de fazer merge — um bug real aconteceu aqui (21/07/2026) onde destructuring direto
  do body (`const { tema, objetivo, ... } = req.body`) atribuía `undefined` pros campos não enviados
  nesse PATCH, e o merge (`{...slot.context, ...context}`) sobrescrevia os campos já salvos com
  `undefined` — que o driver do MongoDB persiste como `null`, apagando silenciosamente contexto já
  preenchido. Corrigido filtrando só as chaves presentes no body antes do merge.
### Orgânico × pago (conteúdo impulsionado)
- Implementado em 21/07/2026 — inicialmente achei que estava bloqueado (token sem acesso à
  Marketing API), mas confirmado ao vivo que **o mesmo `META_ACCESS_TOKEN` já tem `ads_read`** no
  mesmo Business Manager usado pelo projeto de vendas (`../dashboard`) — não precisou gerar token
  novo nem pedir permissão. Só faltavam os IDs das contas de anúncio
  (`META_AD_ACCOUNT_ID_BR`/`META_AD_ACCOUNT_ID_US`, mesmos valores já usados em `../dashboard`),
  agora em `registry.js` (`getAdAccountId(brandId, countryId)` — nunca exposto em
  `getRegistryTree()`, é só server-side).
- `fetchBoostedPermalinks(adAccountId)` (`meta.js`) lista os anúncios da conta e pega
  `creative.instagram_permalink_url` de cada um — é o link do post orgânico usado no anúncio.
  `contentMetrics.js` cruza isso (normalizado, sem `/` final) contra o `permalink` de cada
  conteúdo rastreado pra marcar `isBoosted`. Cache de 5 min (mesmo padrão de `fetchInstagramEngagement`).
- **Contas de anúncio costumam ter muito mais permalinks do que posts orgânicos batem** (confirmado:
  ~490 permalinks na conta BR) — a maioria é "dark post" (criativo feito só pro anúncio, nunca
  publicado organicamente no feed), que naturalmente nunca vai bater com o que vem de
  `/{ig-id}/media` (só retorna conteúdo publicado de verdade). Não é bug ter poucos/nenhum match.
- Conteúdo marcado `isBoosted: true` **não entra no cálculo da mediana** do grupo (formato+país) —
  briefing: *"conteúdos impulsionados devem ser identificados para não entrar no mesmo ranking dos
  totalmente orgânicos"* — mas ainda aparece na lista, com badge "Impulsionado", comparado contra
  essa mediana orgânica (não excluído da tela, só do denominador da mediana).
- `isBoosted` fica `null` (não `false`) quando o país não tem `adAccountId` configurado — nunca
  assume "orgânico" por padrão só porque não checou.
- **Agregado em nível de perfil/período** (implementado 22/07/2026, card "Orgânico × Pago" em
  `index.html`, logo abaixo de "Tendência & comparação"): o briefing pede o sinal tanto por
  conteúdo quanto por **perfil** ("sinalizar se o perfil ou conteúdo teve resultado
  predominantemente orgânico ou maior dependência de distribuição paga") — o card de conteúdo
  (Resumo em `conteudos.html`) já cobria o primeiro, este cobre o segundo. `buildOrganicPaidSummary()`
  em `contentMetrics.js` pondera por **alcance** (`reach`), não por contagem de post — um único
  impulsionado pode alcançar muito mais gente que vários orgânicos, então contar posts
  sub-representaria a dependência de tráfego pago. Só entram itens com `reach` conhecido; itens
  com `isBoosted: null` (sem conta de anúncio) ou sem `reach` ainda ficam em `unverifiedCount`,
  fora do denominador — nunca "viram" orgânico por omissão. `GET /api/content` aceita `since`/`until`
  opcionais (só afetam esse agregado; a lista de fichas em si continua mostrando todo o conteúdo
  retido, sem filtro de período, como sempre foi). `partialCoverage: true` quando o período pedido
  começa antes da janela de retenção de conteúdo (`RETENTION_DAYS`, hoje 35 dias, exportado de
  `contentSync.js`) — o front mostra um aviso de que parte do período pode não estar refletida,
  em vez de fingir que o sinal cobre um intervalo maior do que o dado realmente permite.
- Stories 24h (versão limitada) foi implementado depois — ver seção própria abaixo.

### Stories 24h — versão limitada (`src/storySync.js`, `src/storyMetrics.js`, `public/stories.html`)
- Implementado em 21/07/2026, **de propósito com escopo reduzido** frente ao que o briefing pede
  ("analisar a sequência completa e cada tela: retenção, maior queda, avanços, voltas, saídas,
  respostas, cliques, conclusão e desempenho do CTA") — dois limites reais impedem a versão
  completa, documentados na tela pro usuário final também (`.coverage-note` em `stories.html`),
  não só aqui:
  1. **A Graph API não expõe mais avanços/voltas/saídas por tela separadamente** (confirmado ao
     vivo 21/07/2026) — só um total agregado (`navigation`) de todas essas ações somadas. Métricas
     válidas por story: `reach`, `replies`, `navigation`, `shares`, `total_interactions`,
     `profile_activity`, `follows`. `likes`/`comments`/`saved` **não existem** pra stories (o
     Instagram não mostra esses conceitos em stories, faz sentido).
  2. **Stories somem de `/{ig-id}/stories` assim que expiram** (~24h após publicar) — não tem como
     "puxar o histórico" depois que um story já era. Por isso existe um agendador **próprio e mais
     frequente** (`STORY_SYNC_INTERVAL_MINUTES`, padrão 120min) rodando em paralelo ao sync normal
     de 12h (`SYNC_INTERVAL_MINUTES`) — mesmo assim, um story publicado e expirado inteiramente
     entre dois ciclos pode não ser capturado. Isso é uma limitação real, não um bug a "corrigir".
- Diferente de snapshots de perfil/conteúdo (uma leitura por dia), stories acumulam **várias
  amostras por dia** enquanto ativos (`stories[brandId][countryId][storyId].samples[]`, cada uma
  com `polledAt`) — `computeStoriesDashboard()` compara a primeira com a última amostra pra medir
  evolução dentro da janela observada (não o ciclo de vida completo). Com 1 amostra só, o campo
  `growth` fica `null` em vez de fabricar um "0%" que pareceria uma leitura real de estabilidade.
- Retenção: só mantém na lista stories publicados nas últimas 48h (`RETENTION_HOURS` em
  `storyMetrics.js`) — depois disso o story já expirou de verdade, a última amostra vira só um
  retrato final.

### Bateria de crescimento (`src/goals.js`, `public/metas.html`)
- Implementado em 21/07/2026. Meta editável por marca/país/conta/rede (`POST /api/goals`), hoje só
  pra métrica `followers` — é o exemplo do próprio briefing e a única com histórico diário
  confiável nas duas plataformas. `GET /api/goals` calcula progresso, falta, dias restantes e
  **ritmo necessário** (`remaining / daysLeft`) sempre ao vivo, comparando a meta com o snapshot
  mais recente — nunca grava um booleano de "atingida", pra não precisar de uma segunda escrita
  exatamente no dia em que a meta é batida.
- **Histórico nunca é apagado:** `addGoal()` (`store.js`) só empilha em
  `goals[brandId][countryId][platform]` — a meta "atual" é sempre a última do array; criar uma
  meta nova (seja por ter batido a anterior, seja só ajustando um valor) sempre soma ao histórico,
  nunca sobrescreve. `computeGoalsDashboard()` expõe `current` + `history` separados.
- `dailyPaceNeeded` fica `null` quando a meta já foi atingida OU o prazo já venceu (divisão por
  dias ≤ 0 não faz sentido) — a tela mostra "meta atingida"/"prazo vencido" em vez de um ritmo
  fabricado.
- **Cuidado com CSS de espaçamento em `metas.html`:** o Luan já pediu uma vez (21/07/2026) mais
  respiro entre botões e textos empilhados no card (`.goal-actions`, `.goal-pace`,
  `.goal-hist-toggle` têm margin generosa por causa disso) — não voltar a apertar esses elementos.
- **Cuidado ao testar localmente:** este projeto usa o **mesmo MongoDB de produção** (mesmo
  `MONGODB_URI` do Railway) — não existe banco de teste separado. Metas/contexto de conteúdo
  criados durante teste manual ficam gravados de verdade; limpar depois (ex: apagar o documento
  `_id: 'goals'` da collection `kv`) se não forem dados reais. Mesmo cuidado vale pro Cofrinho
  (`_id: 'cofrinho'`) — ver seção abaixo.

### Cofrinho do Social (`src/cofrinho.js`, `public/cofrinho.html`)
- Implementado em 21/07/2026. **100% entrada manual** — sem sync, sem API externa. O setor
  responsável envia print/planilha/relatório e alguém registra pela tela (`POST
  /api/cofrinho/entries`): período (texto livre, ex: "Julho/2026"), cupom/link, usos do cupom,
  vendas rastreadas, faturamento informado (opcional — só quando o setor fornecer) e observação.
- KPIs somam **todos** os registros da conta (não filtra por período na tela — cada registro já
  representa um período que o setor informou). `faturamento` só entra na soma dos registros que o
  preencheram; o card mostra "X de Y registro(s) informaram" pra deixar claro que o total pode
  estar parcial (mesmo padrão do "X de Y produtos c/ custo" do projeto de vendas `../dashboard`).
- **Meta e progresso** reaproveita a mesma lógica de `goals.js` (progresso, falta, ritmo
  necessário, histórico nunca apagado), mas a métrica escolhida é `vendas` ou `faturamento` (não
  `followers`) e o "valor atual" vem da **soma dos registros**, não de um snapshot da Meta.
- Texto do "Limite" do briefing (*"o cofrinho mostra apenas vendas rastreadas... não representa
  sozinho toda a influência das redes sociais sobre as compras"*) fica fixo no topo da tela — não
  remover, é uma ressalva deliberada do briefing, não um aviso genérico de UI.

### Chamados — quadro estilo Monday (`public/chamados.html`)
Implementado em 22/07/2026 a pedido do Luan — não é do briefing da Aline, é uma ferramenta interna
pra equipe pedir/discutir melhorias do próprio dashboard e acompanhar nosso backlog técnico.
- **Escopo geral, não por marca/país** — um quadro só pra empresa toda (`people`/`tickets` em
  `store.js`, fora do padrão empresa→marca→país usado no resto do produto).
- **3 modos de visualização** (`viewMode`: `lista`/`quadro`/`cards`, botão segmentado na toolbar,
  mesmo padrão visual do `.cmp-view-toggle` já usado em `index.html`) — **salvos só em
  `localStorage`** (`coco_chamados_viewmode`), de propósito por pedido do Luan: é preferência de
  tela de cada pessoa, não deve virar padrão pra equipe toda. Lista (linhas compactas agrupadas,
  o original) e Quadro (Kanban — mesmo agrupamento, só que em colunas lado a lado, rolagem
  horizontal) reaproveitam o mesmo `groupBy`/`computeGroups()`; Cards é uma grade solta sem
  agrupamento nenhum, então o pill "Agrupar por" some da toolbar nesse modo
  (`updateGroupByVisibility()`) em vez de ficar visível sem efeito. Quadro e Cards compartilham o
  mesmo componente de card (`ticketCardHtml()`), mais espaçoso que a linha da Lista
  (`ticketRowHtml()`) — mostra prévia da descrição truncada em 110 caracteres.
- **`people`**: cadastro simples (CRUD: `GET/POST /api/people`, `PATCH/DELETE /api/people/:id`) —
  sem senha nem login próprio, só um jeito de marcar responsável/criador/autor de comentário. Sem
  cascata ao apagar: um chamado ou comentário que apontava pra um id apagado mostra "pessoa
  removida" em vez de adivinhar quem era.
- **`tickets`**: `titulo`, `descricao`, `tipo`, `urgencia`, `status`, `responsavelId`,
  `criadoPorId`, `comments[]`. Validação server-side contra listas fixas (`TICKET_TIPOS`,
  `TICKET_URGENCIAS`, `TICKET_STATUSES` em `server.js`) — mesma lista duplicada no front
  (`TIPO_META`/`URGENCIA_META`/`STATUS_META` em `chamados.html`), sem módulo compartilhado entre
  back e front (mesmo padrão já usado em `FORMAT_LABELS` de `contentMetrics.js`/`conteudos.html`).
- **Além do que foi pedido, acrescentei três coisas** (o Luan pediu explicitamente pra melhorar a
  ideia original):
  1. **Status** (Aberto/Em andamento/Concluído) — sem isso o quadro nunca fecharia ciclo.
  2. **"Agrupar por"** (Status/Tipo/Urgência/Pessoa responsável) — é a features central do Monday:
     os mesmos itens reorganizados por eixos diferentes, sem duplicar dado. Estado persistido em
     `localStorage` (`coco_chamados_groupby`), assim como quais grupos estão colapsados
     (`coco_chamados_collapsed_<groupBy>_<key>`).
  3. Tipo **"Programação"** — é onde mora o backlog técnico (o que falta implementar do briefing,
     investigações em aberto) — ver chamados semeados abaixo.
- **Comentários** (`POST/DELETE /api/tickets/:id/comments`) são a parte de "conversar entre si" —
  um por pessoa, texto livre, sem edição (só exclusão) pra manter simples.
- **Chamados semeados em produção (22/07/2026)**, todos tipo "Programação", refletindo o backlog
  real desta sessão: confirmar posts "Patrocinado" não capturados pelo sinal Orgânico×Pago (aguardando
  link/data do Luan), integração com TikTok (app em revisão), resumo por IA na ficha D+7, Social
  Listening, relatórios automáticos, e métricas de Ação por conteúdo. As pessoas Luan e Aline Moraes
  também foram cadastradas — mais gente é adicionada pela própria tela de "Gerenciar pessoas".
- **Sem `<select>` nativo e sem `confirm()` nativo (corrigido em 22/07/2026, a pedido do Luan).**
  Primeira versão usava `<select>` (feio, sem combinar com o resto do app) e `window.confirm()` nos
  botões de excluir — travava a aba inteira até alguém clicar OK/Cancelar (confirmado: travou até
  screenshot/JS injection durante teste automatizado, só resolveu fechando a aba). Trocado por:
  - `renderFieldDropdown()`/`.field-dd` (`chamados.html`) — dropdown customizado (mesmo espírito do
    `.csel` já usado no resto do app, só que em bloco de formulário em vez de pill), com bolinha
    colorida ou ícone por opção. Reaproveitar esse padrão pra qualquer `<select>` novo neste app.
  - `showConfirm(mensagem)` — modal próprio (`#confirmModalOverlay`, `z-index:1100`, acima de
    qualquer outro modal aberto) que devolve uma Promise&lt;boolean&gt;, usado com `await` no lugar de
    `confirm()`. Testado ao vivo (excluir chamado, excluir pessoa com Cancelar e com Excluir) — a
    aba nunca mais travou.
- **Cuidado com encoding ao testar via curl no Git Bash (Windows):** strings com acento passadas
  inline como `-d '{"...ã..."}'` chegam corrompidas no servidor (confirmado: "não" virou "n�o"
  no dado salvo) — não é bug do servidor, é o Git Bash/curl.exe mangling UTF-8 na linha de comando.
  Pra qualquer teste com texto acentuado, usar um script Node com `fetch()` (string JS é UTF-8
  nativo) em vez de `curl -d` inline.

### Login único compartilhado + Configurações (`src/auth.js`, `public/login.html`, `public/configuracoes.html`)
- Implementado em 22/07/2026, junto com a auditoria de segurança (ver seção própria abaixo) — o
  achado #1 daquela auditoria era exatamente a ausência de qualquer login; esta seção é o que a
  resolve, de propósito como uma frente separada (o próprio Luan pediu login liga/desliga,
  senha única de equipe, não conta por pessoa — mais simples e alinhado ao resto do projeto,
  que é config-driven e não tem tabela de usuário nenhuma).
- **Uma senha só pra equipe toda**, em `DASHBOARD_PASSWORD` (variável de ambiente — nunca no
  banco). Comparada em tempo constante (`crypto.timingSafeEqual`) em `checkPassword()`.
- **Liga/desliga pela tela de Configurações** (`settings.loginEnabled` em `store.js`, mesmo padrão
  de storage de tudo mais — `getSettings()`/`updateSettings()`). Com login desligado (padrão —
  `DEFAULT_SETTINGS = { loginEnabled: false }`), o dashboard fica com acesso aberto, exatamente
  como sempre foi até aqui — deploy dessa feature não tranca ninguém de surpresa.
- **Trava de segurança em `POST /api/settings`:** nunca liga o login sem `DASHBOARD_PASSWORD`
  configurado — sem isso, ninguém conseguiria entrar de novo (nem pra desligar), e só dá pra
  corrigir mexendo na variável de ambiente do Railway.
- **Sessão é um cookie assinado (HMAC-SHA256), sem tabela de sessão** — `createSessionCookieValue()`
  assina `expires` com `SESSION_SECRET` (ou `DASHBOARD_PASSWORD` como fallback, se o primeiro não
  existir); `hasValidSession()` verifica assinatura + validade. Escolhido deliberadamente em vez de
  `express-session`/`connect-mongo`: zero dependência nova, funciona igual com MongoDB ou JSON
  local, e sobrevive a redeploy do Railway (verificação é só criptográfica, não depende de nenhum
  estado guardado no servidor).
- **`authGate` (middleware global em `server.js`, roda logo depois de `express.json()` e antes do
  estático + de toda rota `/api`)**: deixa passar direto se `loginEnabled` for `false`, ou se a rota
  estiver na allowlist pública (`/login.html`, `/health`, `/api/auth/login`, `/api/auth/status`,
  `Logo2.png`, `favicon.png`). Caso contrário, exige cookie de sessão válido — sem ele, `/api/*`
  devolve 401 JSON e qualquer outra rota redireciona pra `/login.html`.
- **`app.set('trust proxy', 1)`** é necessário pro cookie `secure` funcionar certo atrás do proxy do
  Railway (que termina TLS e repassa por HTTP internamente) — sem isso, `req.secure` nunca bateria
  como `true` em produção e o navegador não devolveria o cookie marcado `secure` numa próxima
  requisição.
- "Sair" só aparece na sidebar quando `loginEnabled` é `true` (checado via `GET /api/auth/status`
  no mount de `sidebar.js`) — com login desligado, não existe sessão de verdade pra encerrar, então
  a ação nem é oferecida.
- **Cuidado ao testar localmente:** mesmo aviso de sempre — usar `MONGODB_URI=` (vazio) na hora de
  testar liga/desliga do login, pra cair no fallback de `data/db.json` e nunca escrever
  `settings.loginEnabled: true` de teste no Mongo de produção.

### Store (`store.js`)
- `MONGODB_URI` presente → Mongo (collection `kv`, chaves `snapshots`/`lastSync`). Ausente → `data/db.json`.
- `initStore()` é async e precisa de `await` antes de `app.listen()`.
- Chave de snapshot inclui a marca: `getSnapshots(brandId, platform, countryId)` → `{ [dateISO]: dataDoDia }`.
  `getSnapshotsInRange(...)` filtra e ordena.
- **Migração automática do formato antigo:** dados gravados antes da fundação multimarca ficavam em
  `snapshots[platform][market]` (sem nível de marca). `initStore()` detecta esse formato (chaves
  `instagram`/`facebook` direto na raiz de `snapshots`) e reembrulha tudo sob `brandId='coco-and-luna'`
  automaticamente, uma vez, sem descartar histórico — confirmado em produção (Mongo real) em 21/07/2026.
- Snapshot é por **dia** (uma leitura por dia via sync agendado, ou mais se `/api/sync` for chamado manualmente
  — cada chamada sobrescreve o snapshot do dia corrente, não acumula).

### Plataformas e países — genéricos, resolvidos pelo registry
- `platform`: `'instagram' | 'facebook'` (TikTok entra aqui quando implementado). `countryId`: `'br' | 'us'`
  hoje, mas qualquer string cadastrada em `registry.js` funciona sem mudança de código.
- As 4 contas (Instagram BR/US + Página Facebook BR/US) vivem no mesmo Business Manager da Meta — o
  mesmo `META_ACCESS_TOKEN` serve para todas; só o `metaId` muda por conta.

### Duas fontes de dado da Meta, propósitos diferentes — não confundir
1. **Snapshot diário** (`fetchInstagramSnapshot`/`fetchFacebookSnapshot`, salvo por `sync.js`): seguidores,
   posts, e curtidas/comentários de uma **amostra dos últimos 25 posts no momento do sync** — não é o
   total do período selecionado na tela.
2. **Engajamento do período** (`fetchInstagramEngagement`/`fetchFacebookVideoViews`, chamado ao vivo por
   `metrics.js` a cada request de `/api/dashboard`, cache de 5 min): curtidas/comentários/views/shares/saves
   somados de verdade dentro do `since`/`until` escolhido, via Insights API com `metric_type=total_value`.
   É o que aparece nos cards de conta como "no período" e no card de Comparação.

### Pegadinhas confirmadas ao vivo da Meta Graph API (não redescobrir)
- `follower_count` (Instagram Insights) é a **variação diária**, não o total acumulado — o histórico
  absoluto é reconstruído de trás pra frente a partir do valor atual (`reconstructAbsolute` em
  `backfill.js`). Mesma lógica para Facebook via `page_daily_follows_unique`/`page_daily_unfollows_unique`.
- Page Insights (histórico do Facebook) exige o **token da própria Página**, não o token de
  usuário/sistema usado no resto do arquivo — `fetchPageAccessToken()` troca isso sob demanda.
- `page_fans`/`page_fan_adds`/`page_fan_removes` não existem mais na API; usar `page_follows`/
  `page_daily_*follow*`.
- Métricas de conta do Instagram (`likes`, `comments`, `views`, `shares`, `saves`, `total_interactions`)
  só funcionam com `metric_type=total_value` (dá o total do período numa chamada, não série diária) —
  `period=day` sozinho dá erro pedindo esse parâmetro. `video_views` não existe (usar `views`); `saved`
  não existe (usar `saves`).
- Lookback de Insights é ~30 dias (`INSIGHTS_LOOKBACK_DAYS`) — limite pode mudar com a versão da API.
  `GET /api/meta/probe-insights` e `GET /api/meta/probe-engagement` devolvem a resposta crua da API para
  confirmar ao vivo antes de confiar em qualquer novo campo/métrica (rodar antes de assumir que uma
  métrica existe para a conta).

### Regra de "nunca estimar" já em vigor
Sem snapshot no período anterior (conta nova, ainda sem 2 janelas de histórico), o delta fica `null`
("—" na tela) em vez de fabricar um número — mesmo princípio que o briefing da Aline pede para todo o
resto do produto (nunca completar métrica ausente por integração/print).

### Consistência visual entre páginas (22/07/2026)
Cada página em `public/*.html` tem seu próprio `<style>` (não existe CSS compartilhado entre elas — ver
Arquitetura acima), então drift visual entre sessões de trabalho é esperado. Passe de consistência feito
nas 5 páginas (`index.html`, `conteudos.html`, `metas.html`, `stories.html`, `cofrinho.html`), sem tocar
`sidebar.js` nem lógica de JS/API:
- Confirmado que os tokens de cor principais (`--bg/--surface/--surface2/--border/--border2/--text/--sub/
  --muted/--green/--red`) já eram idênticos nas 5 páginas — não precisou reconciliar. `--gold:#946200`
  existia em `metas.html`/`stories.html`/`cofrinho.html` mas faltava em `index.html`/`conteudos.html`
  (que usavam o hex `#946200` direto); adicionada a variável nas duas e trocado o hex por `var(--gold)`
  nos lugares que são CSS/HTML (não em config de Chart.js, que precisa de string de cor literal, não
  var()).
- `cofrinho.html` tinha `.card{padding:20px 22px}` e `.field input{padding:8px 10px}` — únicos da casa
  (as outras 4 páginas usam `18px 20px` e `7px 10px` pro mesmo tipo de elemento); igualado.
- `stories.html` tinha o badge "Expirado" com `padding:3px 9px`; o badge "Impulsionado" de
  `conteudos.html` (mesma linguagem visual de tag de status) usa `3px 8px` — igualado pro segundo.
- Ícone de bandeira em contexto de "cabeçalho de bloco por país" (maior que o ícone inline padrão de
  13×9 usado em pills/dropdowns) tinha 3 tamanhos diferentes: `orgpago-cname img` (15×10) e
  `hist-card h2 img` (16×12) em `index.html`, e `country-head img` (18×13) em `cofrinho.html`. Unificado
  pra 16×12 nos três lugares.
- Confirmado que não existe dark mode em nenhuma página (`prefers-color-scheme`/`data-theme` não
  aparecem em nenhum `public/*.html`) — não foi adicionado, só verificado que o design light-only é
  consistente entre as 5.
- `h3.section`, `.empty` (estado vazio) e `.delta-val` (chip de variação ↑/↓) já eram byte-idênticos
  nas 5 páginas antes deste passe — não precisaram de mudança.

### URLs limpas (sem `.html`)
Implementado em 22/07/2026. `express.static(..., { extensions: ['html'] })` em `server.js` deixa
`/conteudos` resolver pra `conteudos.html` sem redirect nem rota dedicada — o arquivo continua
respondendo pelo nome completo também (`/conteudos.html` funciona igual, é só não mais o que a
gente linka), então nenhum link/favorito antigo quebra. Todo link interno (nav da `sidebar.js`,
redirect de login/logout) usa a forma limpa; `/` é a raiz ("Visão geral"), sem precisar de
`/index`. A detecção de item ativo em `sidebar.js` normaliza `.html`/`/index` no `location.pathname`
antes de comparar, pra continuar funcionando mesmo se alguém chegar por um link no formato antigo.

### Aviso de limitações conhecidas (`index.html`)
Implementado em 22/07/2026, a pedido do Luan — mesma linguagem visual do "Limite" do Cofrinho
(`.limit-note`), só que na Visão Geral (primeira tela que qualquer pessoa vê ao entrar) e cobrindo
o quadro geral, não uma feature só. Fixo, não-colapsável (mesmo motivo do Cofrinho: se pudesse
esconder, teria que garantir que o botão de reabrir nunca some junto — mais simples não ter esse
risco). Lista, em linguagem de negócio (não termos técnicos): janela de retenção de conteúdo (35
dias) e checkpoints D+7/14/30 só prospectivos, dependência de conta de anúncio pro sinal
Orgânico×Pago, limite de `navigation` agregado + retenção de 48h em Stories, TikTok ainda não
integrado, resumo por IA/Social Listening/relatórios automáticos ainda não implementados, força do
gancho/tempo assistido de Reels indisponível na API, e o limite já conhecido do Cofrinho. Precisa
ser atualizado manualmente conforme essas limitações forem resolvidas (não é gerado a partir de
nenhum estado do sistema) — se TikTok for integrado, por exemplo, essa linha sai daqui.

### Frontend (`public/index.html`)
- Sem framework — HTML + CSS + JS vanilla, Chart.js via CDN, ícones Bootstrap Icons via CDN.
- Dropdowns customizados (`.csel`), period picker com presets + intervalo customizado — mesmo padrão
  visual/interativo do dashboard principal (`../dashboard`), mas implementado à parte neste HTML (sem
  módulo JS compartilhado entre os dois repositórios).
- **Seletores de Marca/País:** `loadRegistry()` busca `/api/registry` uma vez no carregamento e monta os
  dois seletores dinamicamente — nenhuma marca/país fica hardcoded no HTML/JS. Com uma única marca
  (hoje), o seletor de Marca vira um pill estático (`#brandPillStatic`) em vez de dropdown; com 2+ vira
  dropdown igual ao de País. Trocar de marca reseta o país pra "Todos". Cards de conta (`#accGrid`),
  tabelas de histórico (`#histGrid`) e a legenda/título do gráfico de tendência são **gerados a partir de
  `d.byCountry`** a cada `render()` — não existem mais divs fixas por país no HTML.
- Estado (marca, país, período, métrica do gráfico, canal, período de comparação, view do card de
  Comparação) persistido em `localStorage` com prefixo `coco_sm_*`.
- Card "Comparação de período": três visualizações (Lista/Tabela/Gráfico) sobre os mesmos 6 KPIs
  combinados já calculados no backend — não dispara chamada nova ao trocar de view. Os 6 KPIs continuam
  agregando o **escopo de país selecionado** (todos os países da marca, ou só um), calculado no backend.

### Gerador de relatórios (`src/reportTemplate.js`, `src/reportRenderer.js`, `src/reports.js`, `public/relatorios.html`)
Implementado em 23/07/2026 — cobre a seção "Relatórios automáticos" do briefing (D+7, Stories 24h,
mensal por país, mensal por rede, mensal geral), com download em **PDF e DOCX**, geração **manual**
(botão "Gerar relatório") e **automática** (agendador), a pedido explícito do Luan ("Trabalhe em
todos" os 5 tipos, "PDF e DOCX já juntos", "Ambas as opções" de geração).
- **Camadas, de baixo pra cima:**
  1. `reportTemplate.js` — paleta extraída visualmente do PDF de briefing da Aline (roxo/índigo
     escuro nos cabeçalhos de tabela/títulos `#4B2E83`, listra lavanda clara `#E3E8F7` nas linhas
     ímpares, subtítulo itálico azulado `#3D6DC8`, caixa de destaque tipo "Prioridade/Limite" em
     lavanda bem clara) + helpers de formatação (`fmtNum`/`fmtPct`/`fmtDateBR`/`fmtDateTimeBR`).
  2. `reportRenderer.js` — os dois exportadores (`renderReportPdf` via `pdfkit`, `renderReportDocx`
     via `docx`), consumindo um **modelo genérico único**: `{ title, subtitle, brandName,
     countryLabel, sections: [{ heading, paragraphs?, table?: {columns,rows}, callout?:
     {label,text} }] }`. Um modelo só pros dois formatos evita que PDF e DOCX divirjam com o tempo.
  3. `reports.js` — os 5 `build*Report()` (um por tipo), cada um montando esse modelo a partir dos
     dashboards que **já existem** (`computeSocialDashboard`, `computeContentDashboard`,
     `computeStoriesDashboard`, `computeGoalsDashboard`, `computeCofrinhoDashboard`) — nunca
     recalcula métrica por conta própria. `generateReport()` é o dispatcher da rota manual;
     `checkAutoReports()` é chamado pelo agendador.
  4. `public/relatorios.html` — formulário de geração (campos condicionais por tipo: País+Conteúdo
     pro D+7, País+Story pro Stories, País+Mês pro mensal por país, Canal+Mês pro mensal por rede,
     só Mês pro mensal geral) + lista dos relatórios já gerados com botões de baixar PDF/DOCX
     (`<a download>` direto pra rota, sem JS) e excluir. Reaproveita os padrões já estabelecidos:
     `.field-dd`/`renderFieldDropdown()` (dropdown customizado, mesmo de `chamados.html`) e
     `showConfirm()` (modal de confirmação, nunca `window.confirm()` nativo).
- **Store** (`src/store.js`): `reports[brandId] = [{id, type, periodKey, scopeLabel, generatedAt,
  generatedBy, model}, ...]`, mais recente primeiro. `model` já vem com qualquer texto de IA
  "cozido" dentro — baixar de novo (PDF ou DOCX) nunca chama a IA outra vez, só re-renderiza o
  mesmo modelo salvo. `reportExists(brandId, type, periodKey)` é o mecanismo de dedupe: `periodKey`
  é `mediaId` (D+7), `storyId` (Stories), ou `"<escopo>:<YYYY-MM>"` (mensais) — nunca deixa a
  geração automática criar o mesmo relatório duas vezes.
- **Geração automática** (`checkAutoReports()`, chamado por `scheduledReports()` em `server.js`,
  no mesmo ciclo de 12h do sync normal — sem intervalo próprio): D+7 dispara **uma vez por
  conteúdo**, assim que `ageDays >= 7`; Stories dispara **uma vez por story**, assim que expira
  (`ageHours >= 24`, ainda dentro da janela de retenção de 48h); os 3 mensais disparam **uma vez
  por mês**, sempre pro **mês anterior já completo** (nunca o mês corrente, que ainda não
  terminou). Sem `ANTHROPIC_API_KEY`, `checkAutoReports()` não gera nada (todo relatório depende de
  algum texto sintetizado por IA) — evita gerar um relatório "capado" sozinho.
- **Duas causas bem diferentes pro mesmo "sem texto de IA" — não confundir** (`aiFallbackText()`
  em `reports.js`): "ANTHROPIC_API_KEY não configurado" (problema de configuração) vs. "a chamada à
  IA falhou" (chave configurada mas a chamada deu erro de verdade — chave inválida/revogada, rate
  limit, rede). Bug real encontrado e corrigido nesta sessão: a primeira versão sempre mostrava a
  mensagem de "não configurado" mesmo quando a chave estava presente e a falha era outra —
  descoberto testando localmente com a chave (real, mas já retornando 401 "API key is invalid" —
  ver nota abaixo) configurada. Cada chamada de IA malsucedida agora loga o erro real no servidor
  (`console.error`) e o relatório final é honesto sobre qual das duas causas foi.
- **Pegadinhas reais do pdfkit encontradas no teste de fumaça do renderer (23/07/2026, não
  redescobrir):**
  - A fonte padrão (Helvetica/WinAnsi) **não tem os caracteres ▲/▼** — renderiza lixo (`%²`).
    `fmtPct()` usa `+`/`-` em vez de setas Unicode (o front-end continua usando ▲/▼ normalmente,
    é só a fonte do pdfkit que não suporta).
  - Desenhar o rodapé com `y` dentro da margem inferior reservada (`page.margins.bottom`) faz o
    pdfkit **inserir silenciosamente uma página em branco** só pra desenhar esse texto (interpreta
    como overflow). Correção padrão: zerar `doc.page.margins.bottom` temporariamente antes de
    desenhar o rodapé, restaurar depois (ver `renderReportPdf`).
  - Medir a altura de um parágrafo com uma constante fixa (em vez de `doc.heightOfString()`) antes
    de decidir se cabe na página causa quebra de página incorreta pra parágrafos longos — sempre
    medir de verdade.
  - `bufferPages:true` + `doc.bufferedPageRange()` + `doc.switchToPage(i)` no final (depois de todo
    o conteúdo) é o padrão certo pra numeração "Página N de M" (só dá pra saber o total no fim).
  - Tabela não repete cabeçalho quando atravessa página — simplificação aceitável dado o tamanho
    típico das tabelas destes relatórios (poucas linhas cada).
- **Cofrinho do Social não é filtrável por mês:** os registros são 100% manuais com um campo
  `period` de texto livre (ex: "Julho/2026"), não uma data estruturada — o relatório mensal geral
  soma os totais **acumulados desde o início**, com um aviso explícito disso no próprio relatório,
  em vez de fingir que o total é exclusivo do mês.
- **Social Listening ainda não implementado** — o relatório mensal geral inclui a seção mesmo
  assim, com um callout "Ainda não implementado" (mesma regra de sinalizar limitação em vez de
  omitir a seção inteira, que poderia parecer que ninguém pensou nisso).
- **Testado ao vivo (23/07/2026):** servidor local com `MONGODB_URI=` (fallback JSON, nunca toca o
  Mongo de produção) + `META_ACCESS_TOKEN`/`ANTHROPIC_API_KEY` reais do `.env`. Os 5 tipos gerados
  com sucesso (mensal geral/país/rede via script direto contra dado real da Meta; D+7 manual via
  navegador, incluindo o formulário completo — Tipo→País→Conteúdo, geração, download de PDF real,
  exclusão com o modal de confirmação). A geração automática também rodou sozinha no boot do
  servidor local e gerou os 5 relatórios mensais corretamente. **Nota:** a `ANTHROPIC_API_KEY`
  local (`.env`) está retornando `401 API key is invalid` no momento deste teste — mesmo sintoma
  já visto em produção (ver pendência de rotação de chave); o pipeline inteiro (dados, PDF, DOCX,
  UI) foi validado de ponta a ponta mesmo assim, usando o texto de fallback "a chamada à IA
  falhou" no lugar do texto gerado — só falta uma chave válida pros textos de IA aparecerem de
  verdade nos relatórios.

### Animações de carregamento (`public/sidebar.js`)
Implementado em 23/07/2026, a pedido do Luan (peças originais de uiverse.io — Nawsome e
andrew-manzyk) — duas animações, ambas expostas globalmente por `sidebar.js` (mesmo padrão de
`escapeHtml`/`initCollapsibleNotice`) pra não duplicar o SVG/CSS em cada página:
- **`pageLoaderHtml()`** — anel colorido em bloom (4 círculos animados), substitui o texto
  "carregando…" nos placeholders `.empty` de carregamento inicial de cada página (`accGrid`,
  `cntGrid`, `goalGrid`, `storyGrid`, `cofrinhoRoot`, `board`, `repList`). Chamado uma vez, antes
  do primeiro `fetch`, no início do script de cada página.
- **`aiLoaderHtml()`** — animação de "joia" brilhando, específica de espera de chamada de IA.
  **Cuidado:** os `id` internos do SVG (`pegtopone`/`pegtoptwo`/`pegtopthree`) têm que ficar
  direto na tag `<svg>` (como no snippet original) — colocá-los num `<span>` envolvendo o `<svg>`
  colapsa a animação a 0×0 (bug real encontrado e corrigido nesta sessão: `height:auto` do
  `.loader` some porque os filhos `position:absolute` não contribuem pra altura do pai, e o
  `<span>` sem tamanho próprio some sozinho).
- **`showAiThinkingOverlay(container)`** — combina `aiLoaderHtml()` com um borrão leve
  (`backdrop-filter:blur`) por cima do `container` inteiro (o card, não só a área do resumo) +
  texto que troca a cada 1,4s ("Pensando…", "Lendo os dados…", "Analisando…", "Escrevendo…",
  "Quase pronto…") — reforça que é uma espera de verdade, não a tela travada. Devolve uma função
  `hide()` que **sempre** precisa ser chamada no `finally` do try/catch da chamada (sucesso ou
  erro), senão o borrão fica preso na tela. Usado no botão "Gerar resumo com IA" de
  `conteudos.html` (borra o `.cnt-card` inteiro) e no botão "Gerar relatório" de
  `relatorios.html` (borra o card `#genCard`).

## Auditoria de segurança (22/07/2026)

Auditoria pontual (fora do trabalho de autenticação, que é uma frente separada — ver abaixo). Achados
por severidade, o que foi corrigido e o que ficou só documentado.

- **Sem autenticação nenhuma (crítico, FORA DESTE ESCOPO):** toda rota, inclusive as de escrita
  (`PATCH /api/content/:mediaId/context`, `POST /api/goals`, `POST /api/cofrinho/entries`, `POST
  /api/cofrinho/goals`) e `POST /api/sync` (dispara chamada de verdade à Meta), é pública. Isso está
  sendo tratado por uma frente separada (login togglável) — não mexido aqui de propósito.
- **XSS armazenado (corrigido):** várias páginas montavam HTML via template literal + `innerHTML` a
  partir de texto livre que qualquer um pode gravar sem login hoje — `public/conteudos.html` (campos de
  contexto de `PATCH /api/content/:mediaId/context`: tema/objetivo/pilar/produto/gancho/cta/observação,
  função `contextFieldsHtml`; a legenda do post em `cardHtml`) e `public/cofrinho.html` (`period`/`cupom`/
  `observacao` de `POST /api/cofrinho/entries`, função `entriesTableHtml`) — nenhum escapava `<`/`>`/etc.
  Adicionado `escapeHtml()` global em `public/sidebar.js` (carregado por todas as 5 páginas) e aplicado
  em todo ponto que interpola texto vindo do backend nessas duas páginas. `public/metas.html` e
  `public/stories.html` não têm ponto equivalente (só título/meta/número, sem campo de texto livre
  renderizado) — nada a corrigir ali. `public/index.html` também não tem — todo dado exibido vem de
  agregados calculados no servidor ou do registry, nunca de texto livre gravado por usuário.
  **Correção real só em 22/07/2026 (mais tarde):** o merge original (patch do agente de segurança via
  `git apply`, feito antes deste dia) tinha sido reportado como aplicado mas **não pegou** em
  `conteudos.html`/`cofrinho.html` — o commit que devia conter a correção só trouxe as mudanças de
  `--gold`/padding do outro patch (frontend), sem nenhum `escapeHtml()`. Descoberto por acaso enquanto
  mexia em outra coisa (não por auditoria). Reaplicado manualmente (Edit direto, não `git apply`) e
  confirmado com `grep -c escapeHtml` nos dois arquivos antes de comitar. **Lição:** depois de aplicar
  patch via `git apply` em cima de um merge de múltiplos patches concorrentes, sempre confirmar o
  resultado final com grep/leitura direta do arquivo — não confiar só na mensagem "APPLIED" do comando.
- **Vazamento de segredo em mensagem de erro (corrigido):** várias rotas fazem
  `res.status(500).json({ error: e.message })`; em teoria um erro de rede na chamada à Graph API
  (`meta.js`, `graphGetAs`) pode incluir a URL completa da requisição — com `?access_token=...` — na
  mensagem, e isso voltaria pra quem chamou a API, hoje sem autenticação nenhuma. Corrigido com um único
  middleware em `server.js` que sobrescreve `res.json` e redige (`redactSecrets`/`redactDeep`) qualquer
  string de qualquer resposta JSON que contenha `access_token=...`, uma URL de Mongo com credencial
  embutida, ou o valor literal de `META_ACCESS_TOKEN`/`MONGODB_URI` — cobre todas as rotas de uma vez,
  sem precisar caçar cada `e.message` espalhado por `src/*.js` (inclusive os que viram parte do array
  `errors` de `POST /api/sync`/`POST /api/social/backfill`).
- **Sem rate limiting (corrigido, stop-gap):** com zero autenticação, toda a API — inclusive `POST
  /api/sync` (chamada real à Meta) e as rotas de escrita — está exposta a abuso/DoS acidental ou
  deliberado. Adicionado `express-rate-limit`: limite geral de 300 req/15min em `/api/*`, e um limite
  bem mais apertado (3 req/min, `syncLimiter` em `server.js`) em `POST /api/sync`, `POST
  /api/social/backfill`, `GET /api/meta/probe-insights` e `GET /api/meta/probe-engagement` — as únicas
  rotas que de fato disparam chamada à Meta Graph API. Isso é só um stop-gap; não substitui autenticação.
- **Rate limit dedicado no login (adicionado 23/07/2026, a pedido do Luan):** `POST
  /api/auth/login` antes só caía no limite genérico de 300 req/15min (`apiLimiter`) — generoso
  demais pra uma rota de senha única de equipe, onde força bruta é uma preocupação real.
  `loginLimiter` (`server.js`): 15 tentativas por 15min por IP, com `skipSuccessfulRequests: true`
  — só tentativas que **falham** (401) consomem a cota, um login certo nunca é penalizado. Testado
  ao vivo: 15 tentativas com senha errada passam (401), a partir da 16ª vira 429; 20 tentativas
  seguidas com a senha certa nunca são bloqueadas.
- **Cabeçalhos de segurança (corrigido):** adicionado `helmet` com CSP em allowlist explícita
  (`default-src 'self'`), liberando só `https://cdn.jsdelivr.net` em `script-src`/`style-src`/`font-src`
  (Chart.js + Bootstrap Icons, os únicos recursos externos usados) e `'unsafe-inline'` em
  `script-src`/`style-src` (todas as páginas hoje usam `<script>`/`<style>` inline, sem nonce/hash — se
  algum dia isso migrar pra arquivos separados, dá pra apertar o CSP e tirar o `unsafe-inline`).
  Verificado rodando o servidor localmente (`data/db.json`, sem `MONGODB_URI`) e confirmando as 5
  páginas carregando (200) com o CSP ativo, sem erro de recurso bloqueado.
- **Chaves de API nunca chegam ao navegador (verificado 23/07/2026, não se aplica):** o Luan
  perguntou se dava pra "proteger as chaves" de leitura via JavaScript/DevTools. Confirmado por
  `grep` em todo `public/*.html`: `META_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` e `MONGODB_URI` não
  aparecem em nenhum arquivo servido ao navegador — elas só existem em `process.env` no servidor,
  usadas dentro de `src/meta.js`/`src/ai.js`/`src/store.js`, nunca numa resposta HTTP. O único
  ponto onde uma chave poderia vazar por acidente (mensagem de erro de rede) já é coberto pelo
  `redactSecrets`/`redactDeep` (ver acima). O cookie de sessão do login também já era `httpOnly:
  true` desde que foi implementado (ver `POST /api/auth/login`) — o JS da página já não consegue
  ler esse cookie via `document.cookie`. Nada a implementar aqui além do que já existia.
- **`npm audit` (verificado, nada a corrigir):** 0 vulnerabilidades nas 3 dependências existentes
  (express/dotenv/mongodb) — rodado tanto antes quanto depois de adicionar `helmet` e
  `express-rate-limit` (0 vulnerabilidades também com as duas novas).
- **NoSQL injection (verificado, não se aplica):** toda leitura/escrita em `store.js` usa `_id` fixo e
  literal na collection `kv` (`'snapshots'`, `'content'`, `'goals'`, `'stories'`, `'cofrinho'`,
  `'lastSync'`) — nunca uma chave derivada de `req.body`/`req.query`. `brandId`/`countryId`/`mediaId`/etc.
  vindos de request só indexam dentro de um objeto JS já carregado em memória (`cache.content[brandId]
  [countryId][mediaId]`), nunca viram parte de uma query Mongo — não há superfície de NoSQL injection
  neste projeto hoje.
- **Segredos no git (verificado, ok):** `.env` está no `.gitignore` desde sempre; `git log --all
  --full-history -- .env` não retorna nenhum commit — nunca foi versionado.
- **CORS (verificado, não se aplica):** nenhum middleware de CORS configurado, e não precisa — é uma
  app same-origin (front estático em `public/` servido pelo mesmo Express que expõe `/api/*`), sem
  motivo pra liberar origem cruzada nenhuma.
