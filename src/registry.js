// registry.js — hierarquia empresa → marca → país → conta, config-driven a partir do .env.
// Fonte única da verdade sobre quais marcas/países/contas existem no dashboard. Adicionar uma
// marca ou país novo no futuro = acrescentar um objeto aqui + as env vars correspondentes — sem
// mexer em sync.js/metrics.js/meta.js, que iteram essa estrutura em vez de conhecer br/us de cor.
import 'dotenv/config';

const COMPANY = { id: 'vita-pet-life', name: 'Vita Pet Life' };

// A lista suporta N marcas, cada uma com N países, cada país com N contas (uma por plataforma).
// `flag` aponta pros arquivos que já existem em public/ (mesmos usados pelo dashboard principal
// para os botões de mercado). `logo` é o mesmo princípio pra marca: aponta pro arquivo em public/
// usado pra identificar visualmente de qual marca é cada card/seletor.
//
// `token` é POR MARCA, não global: Coco and Luna e Yucaloo vivem em Business Managers separados
// da Meta, então cada uma precisa do seu próprio System User Token. Antes disso existir, meta.js
// lia um META_ACCESS_TOKEN único direto do ambiente — hoje o registry resolve o token junto com o
// metaId e entrega os dois pro meta.js, que continua sem conhecer marca/país.
const BRANDS = [
  {
    id: 'coco-and-luna',
    name: 'Coco and Luna',
    logo: 'Logo1.svg',
    // Mantém o nome histórico da variável: esta marca já está em produção no Railway e renomear
    // derrubaria a coleta no deploy. Marcas novas usam o padrão META_<MARCA>_*.
    token: process.env.META_ACCESS_TOKEN,
    countries: [
      {
        id: 'br', name: 'Brasil', flag: 'bandeira_brasil.webp',
        adAccountId: process.env.META_AD_ACCOUNT_ID_BR,
        accounts: [
          { platform: 'instagram', metaId: process.env.META_IG_ACCOUNT_ID_BR },
          { platform: 'facebook', metaId: process.env.META_FB_PAGE_ID_BR },
        ],
      },
      {
        id: 'us', name: 'Estados Unidos', flag: 'bandeira_eua.svg',
        adAccountId: process.env.META_AD_ACCOUNT_ID_US,
        accounts: [
          { platform: 'instagram', metaId: process.env.META_IG_ACCOUNT_ID_US },
          { platform: 'facebook', metaId: process.env.META_FB_PAGE_ID_US },
        ],
      },
    ],
  },
  {
    id: 'yucaloo',
    name: 'Yucaloo',
    // null até existir um arquivo de logo da Yucaloo em public/ — setBrandLogoImg() esconde o
    // <img> quando não há logo, então a marca aparece só com o nome, sem imagem quebrada.
    logo: null,
    token: process.env.META_YUCALOO_ACCESS_TOKEN,
    countries: [
      {
        id: 'br', name: 'Brasil', flag: 'bandeira_brasil.webp',
        adAccountId: process.env.META_YUCALOO_AD_ACCOUNT_ID_BR,
        accounts: [
          { platform: 'instagram', metaId: process.env.META_YUCALOO_IG_ACCOUNT_ID_BR },
          { platform: 'facebook', metaId: process.env.META_YUCALOO_FB_PAGE_ID_BR },
        ],
      },
      {
        id: 'us', name: 'Estados Unidos', flag: 'bandeira_eua.svg',
        adAccountId: process.env.META_YUCALOO_AD_ACCOUNT_ID_US,
        accounts: [
          { platform: 'instagram', metaId: process.env.META_YUCALOO_IG_ACCOUNT_ID_US },
          { platform: 'facebook', metaId: process.env.META_YUCALOO_FB_PAGE_ID_US },
        ],
      },
    ],
  },
];

// Remove contas sem metaId (env ausente) — não aparecem no registry nem entram na coleta/telas,
// em vez de propagar um id vazio adiante e falhar mais longe. Marca sem `token` segue a mesma
// regra e perde todas as contas: um metaId sem o token do Business Manager correspondente não
// serve pra nada e só produziria erro de API na primeira chamada.
//
// `configured` distingue "marca cadastrada mas ainda sem credencial" de "marca funcionando" — é
// o que deixa a Yucaloo aparecer no seletor com um aviso claro do que falta, em vez de sumir da
// interface (confuso) ou aparecer com telas vazias sem explicação.
function pruneBrand(brand) {
  const hasToken = Boolean(brand.token);
  const countries = brand.countries.map(country => ({
    ...country,
    accounts: hasToken ? country.accounts.filter(a => a.metaId) : [],
  }));
  return {
    ...brand,
    countries,
    configured: hasToken && countries.some(c => c.accounts.length > 0),
  };
}
const PRUNED_BRANDS = BRANDS.map(pruneBrand);

export function getCompany() {
  return COMPANY;
}

export function getBrands() {
  return PRUNED_BRANDS;
}

export function getBrand(brandId) {
  return PRUNED_BRANDS.find(b => b.id === brandId) || null;
}

export function getDefaultBrandId() {
  return PRUNED_BRANDS[0]?.id || null;
}

export function getCountries(brandId) {
  return getBrand(brandId)?.countries || [];
}

export function getAccounts(brandId, countryId) {
  return getCountries(brandId).find(c => c.id === countryId)?.accounts || [];
}

// ID da conta de anúncio do país (mesmo Business Manager do projeto de vendas) — só usado
// server-side pra detectar conteúdo impulsionado (ver contentMetrics.js). Nunca exposto em
// getRegistryTree(): o front não precisa e não deve ver esse ID.
export function getAdAccountId(brandId, countryId) {
  return getCountries(brandId).find(c => c.id === countryId)?.adAccountId || null;
}

// System User Token do Business Manager da marca. Nunca exposto em getRegistryTree() — é
// credencial, mesma regra do adAccountId/metaId. Só server-side.
export function getBrandToken(brandId) {
  return getBrand(brandId)?.token || null;
}

// Uma marca está pronta pra coleta quando tem token e pelo menos uma conta com metaId.
export function isBrandConfigured(brandId) {
  return Boolean(getBrand(brandId)?.configured);
}

// Achata a hierarquia inteira (ou só de uma marca) em uma lista de contas — usado por
// sync.js/backfill.js pra iterar sem precisar conhecer a estrutura aninhada. Inclui o `token` da
// marca junto do `metaId` porque é assim que meta.js recebe as duas coisas já resolvidas (ver o
// cabeçalho de meta.js): quem itera contas nunca precisa buscar o token separado.
export function listAccounts(brandId) {
  const brands = brandId ? [getBrand(brandId)].filter(Boolean) : PRUNED_BRANDS;
  const out = [];
  for (const brand of brands) {
    for (const country of brand.countries) {
      for (const account of country.accounts) {
        out.push({
          brandId: brand.id,
          countryId: country.id,
          platform: account.platform,
          metaId: account.metaId,
          token: brand.token,
        });
      }
    }
  }
  return out;
}

// Árvore sem segredos (nenhum metaId) — consumida por GET /api/registry pro front montar os
// seletores de marca/país dinamicamente, sem hardcoded "Coco and Luna"/"Brasil"/"Estados Unidos".
export function getRegistryTree() {
  return {
    company: COMPANY,
    brands: PRUNED_BRANDS.map(b => ({
      id: b.id,
      name: b.name,
      logo: b.logo || null,
      configured: b.configured,
      countries: b.countries.map(c => ({
        id: c.id,
        name: c.name,
        flag: c.flag,
        platforms: c.accounts.map(a => a.platform),
      })),
    })),
  };
}
