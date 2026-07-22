// contentSync.js — coleta diária de conteúdo individual (posts/Reels do Instagram), separado
// do sync de perfil (sync.js). Roda dentro do mesmo ciclo (chamado por runSync()) — não cria
// fluxo novo pro usuário, só mais uma etapa do mesmo "Sincronizar agora".
import { fetchInstagramMediaList, fetchInstagramMediaInsights, isConfigured } from './meta.js';
import { upsertContentMeta, addContentSnapshot } from './store.js';
import { listAccounts } from './registry.js';

// Janela de retenção: só busca/atualiza conteúdo publicado nos últimos N dias. Cobre D+7 e D+14
// com folga e D+30 exatamente — Reels no TikTok teriam janela maior, mas TikTok ainda não está
// integrado (ver CLAUDE.md).
export const RETENTION_DAYS = 35;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function runContentSync() {
  const date = todayISO();
  const errors = [];
  let itemsTracked = 0;

  if (!isConfigured()) {
    return { date, itemsTracked, errors: ['Meta não configurado (META_ACCESS_TOKEN ausente).'] };
  }

  const sinceUnix = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;

  for (const account of listAccounts().filter(a => a.platform === 'instagram')) {
    const { brandId, countryId, metaId } = account;
    try {
      const mediaList = await fetchInstagramMediaList(metaId, sinceUnix);
      for (const item of mediaList) {
        const publishedAt = item.timestamp;
        if (Math.floor(Date.parse(publishedAt) / 1000) < sinceUnix) continue; // fora da janela

        upsertContentMeta(brandId, countryId, item.id, {
          platform: 'instagram',
          mediaType: item.media_type,
          mediaProductType: item.media_product_type,
          caption: item.caption || '',
          permalink: item.permalink,
          publishedAt,
        });

        try {
          const insights = await fetchInstagramMediaInsights(item.id);
          if (insights) {
            addContentSnapshot(brandId, countryId, item.id, date, insights);
            itemsTracked++;
          }
        } catch (e) {
          errors.push(`content-insights(${brandId}/${countryId}/${item.id}): ` + e.message);
        }
      }
    } catch (e) {
      errors.push(`content-list(${brandId}/${countryId}): ` + e.message);
    }
  }

  return { date, itemsTracked, errors };
}
