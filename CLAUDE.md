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
public/sidebar.js     Sidebar compartilhada (mesmo padrão IIFE do dashboard principal); marca o item
                      ativo pelo nome do arquivo atual (`location.pathname`)
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
