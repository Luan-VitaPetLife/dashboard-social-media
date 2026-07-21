// storySync.js — coleta de Stories 24h. Diferente de sync.js/contentSync.js (snapshot uma vez
// por dia), stories vivem só 24h e desaparecem de /{ig-id}/stories assim que expiram — não tem
// como "puxar o histórico depois". Por isso este módulo roda num intervalo próprio, mais curto
// (ver STORY_SYNC_INTERVAL_MINUTES em server.js), e cada rodada é só mais uma amostra, não uma
// substituição da anterior.
import { fetchInstagramActiveStories, fetchInstagramStoryInsights } from './meta.js';
import { upsertStoryMeta, addStorySample } from './store.js';
import { listAccounts } from './registry.js';

export async function runStorySync() {
  const polledAt = new Date().toISOString();
  const errors = [];
  let storiesSeen = 0;

  for (const account of listAccounts().filter(a => a.platform === 'instagram')) {
    const { brandId, countryId, metaId } = account;
    try {
      const stories = await fetchInstagramActiveStories(metaId);
      for (const story of stories) {
        upsertStoryMeta(brandId, countryId, story.id, {
          mediaType: story.media_type,
          timestamp: story.timestamp,
          permalink: story.permalink || null,
        });
        try {
          const insights = await fetchInstagramStoryInsights(story.id);
          if (insights) {
            addStorySample(brandId, countryId, story.id, { polledAt, ...insights });
            storiesSeen++;
          }
        } catch (e) {
          errors.push(`story-insights(${brandId}/${countryId}/${story.id}): ` + e.message);
        }
      }
    } catch (e) {
      errors.push(`story-list(${brandId}/${countryId}): ` + e.message);
    }
  }

  return { polledAt, storiesSeen, errors };
}
