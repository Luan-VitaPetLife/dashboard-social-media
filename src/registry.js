// registry.js — hierarquia empresa → marca → país → conta, config-driven a partir do .env.
// Fonte única da verdade sobre quais marcas/países/contas existem no dashboard. Adicionar uma
// marca ou país novo no futuro = acrescentar um objeto aqui + as env vars correspondentes — sem
// mexer em sync.js/metrics.js/meta.js, que iteram essa estrutura em vez de conhecer br/us de cor.
import 'dotenv/config';

const COMPANY = { id: 'vita-pet-life', name: 'Vita Pet Life' };

// Só a Coco and Luna tem contas configuradas hoje — a lista suporta N marcas, cada uma com N
// países, cada país com N contas (uma por plataforma). `flag` aponta pros arquivos que já existem
// em public/ (mesmos usados pelo dashboard principal para os botões de mercado). `logo` é o
// mesmo princípio pra marca: aponta pro arquivo em public/ usado pra identificar visualmente de
// qual marca é cada card/seletor — importa mais a partir do dia em que existir uma segunda marca
// (hoje só reforça visualmente que tudo na tela é da Coco and Luna).
const BRANDS = [
  {
    id: 'coco-and-luna',
    name: 'Coco and Luna',
    logo: 'Logo1.svg',
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
];

// Remove contas sem metaId (env ausente) — não aparecem no registry nem entram na coleta/telas,
// em vez de propagar um id vazio adiante e falhar mais longe.
function pruneBrand(brand) {
  return {
    ...brand,
    countries: brand.countries.map(country => ({
      ...country,
      accounts: country.accounts.filter(a => a.metaId),
    })),
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

// Achata a hierarquia inteira (ou só de uma marca) em uma lista de contas — usado por
// sync.js/backfill.js pra iterar sem precisar conhecer a estrutura aninhada.
export function listAccounts(brandId) {
  const brands = brandId ? [getBrand(brandId)].filter(Boolean) : PRUNED_BRANDS;
  const out = [];
  for (const brand of brands) {
    for (const country of brand.countries) {
      for (const account of country.accounts) {
        out.push({ brandId: brand.id, countryId: country.id, platform: account.platform, metaId: account.metaId });
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
      countries: b.countries.map(c => ({
        id: c.id,
        name: c.name,
        flag: c.flag,
        platforms: c.accounts.map(a => a.platform),
      })),
    })),
  };
}
