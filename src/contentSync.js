// contentSync.js — coleta diária de conteúdo individual (posts/Reels do Instagram), separado
// do sync de perfil (sync.js). Roda dentro do mesmo ciclo (chamado por runSync()) — não cria
// fluxo novo pro usuário, só mais uma etapa do mesmo "Sincronizar agora".
import { fetchInstagramMediaList, fetchInstagramMediaInsights, fetchInstagramCarouselChildren, isConfigured } from './meta.js';
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

        // Álbum (CAROUSEL_ALBUM): busca os itens individuais pra navegação no lightbox — a
        // Meta não devolve isso na listagem, só por post. Só pra esse tipo, pra não multiplicar
        // chamada em post nenhum que não seja carrossel.
        const carouselItems = item.media_type === 'CAROUSEL_ALBUM'
          ? await fetchInstagramCarouselChildren(item.id).catch(() => [])
          : null;

        upsertContentMeta(brandId, countryId, item.id, {
          platform: 'instagram',
          mediaType: item.media_type,
          mediaProductType: item.media_product_type,
          caption: item.caption || '',
          permalink: item.permalink,
          publishedAt,
          // Miniatura do post: `thumbnail_url` só existe pra VIDEO/Reels (média_url ali é o
          // arquivo de vídeo, não dá pra usar em <img>); IMAGE/CAROUSEL_ALBUM usam `media_url`
          // direto (confirmado ao vivo 23/07/2026 — carousel devolve a capa do álbum). Refeita a
          // cada sync (12h) porque a Meta não garante que essa URL assinada seja permanente.
          thumbnailUrl: (item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url) || null,
          // Vídeo de verdade (Reels), só quando o tipo é VIDEO — usado pelo lightbox pra tocar o
          // post em vez de só mostrar a miniatura estática. `null` pra IMAGE/CAROUSEL_ALBUM (a
          // miniatura já é a própria imagem, não tem vídeo pra tocar).
          videoUrl: item.media_type === 'VIDEO' ? (item.media_url || null) : null,
          // Itens do álbum, pra navegação de carrossel no lightbox (ver public/conteudos.html).
          // `null` (não `[]`) pra quem não é carrossel — distingue "não se aplica" de "álbum sem
          // itens" (esse segundo caso não deveria acontecer, mas não custa manter a diferença).
          carouselItems,
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
