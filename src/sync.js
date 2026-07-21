// sync.js — orquestra a coleta diária de métricas de redes sociais e grava no store. Itera
// todas as contas do registry (empresa → marca → país → conta) em vez de uma lista fixa de
// mercados — sync sempre cobre tudo, independente da marca/país selecionados na tela.
import { fetchInstagramSnapshot, fetchFacebookSnapshot, isConfigured } from './meta.js';
import { addSnapshot, setLastSync } from './store.js';
import { listAccounts } from './registry.js';
import { runContentSync } from './contentSync.js';
import { runStorySync } from './storySync.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function runSync() {
  const date = todayISO();
  const errors = [];
  const results = [];

  if (!isConfigured()) {
    errors.push('Meta não configurado (META_ACCESS_TOKEN ausente).');
  } else {
    for (const account of listAccounts()) {
      const { brandId, countryId, platform, metaId } = account;
      try {
        const data = platform === 'instagram'
          ? await fetchInstagramSnapshot(metaId)
          : await fetchFacebookSnapshot(metaId);
        if (data) {
          addSnapshot(brandId, platform, countryId, date, data);
          results.push({ brandId, countryId, platform, data });
        }
      } catch (e) {
        errors.push(`${platform}(${brandId}/${countryId}): ` + e.message);
      }
    }
  }

  // Ficha de conteúdo (posts/Reels individuais) — mesmo ciclo de sync, não trava o sync de
  // perfil acima se falhar (nem vice-versa).
  let content = { itemsTracked: 0 };
  try {
    content = await runContentSync();
    errors.push(...content.errors);
  } catch (e) {
    errors.push('content-sync: ' + e.message);
  }

  // Stories 24h — mesmo botão/ciclo também dispara uma amostra, além do agendador próprio mais
  // frequente (ver STORY_SYNC_INTERVAL_MINUTES em server.js) que existe justamente porque um
  // story só vive 24h e não dá pra esperar o ciclo normal de 12h pra tentar pegá-lo.
  let stories = { storiesSeen: 0 };
  try {
    stories = await runStorySync();
    errors.push(...stories.errors);
  } catch (e) {
    errors.push('story-sync: ' + e.message);
  }

  setLastSync(new Date().toISOString());
  return { date, results, contentItemsTracked: content.itemsTracked, storiesSeen: stories.storiesSeen, errors };
}
