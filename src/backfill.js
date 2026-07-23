// backfill.js — preenche dias anteriores ao início do sync usando a Insights API (ver
// meta.js). Nunca sobrescreve um snapshot que já existe (o sync diário normal é sempre a
// fonte de verdade); só adiciona datas que ainda estão vazias. Resolve as contas de uma marca
// + país via registry.js — não conhece IDs de conta diretamente.
import { fetchInstagramFollowerDeltas, fetchFacebookNetFanDeltas } from './meta.js';
import { getSnapshots, addSnapshot } from './store.js';
import { listAccounts } from './registry.js';

// deltasAscending = [{date, delta}] em ordem cronológica crescente, delta = variação
// ocorrida NAQUELE dia. O valor absoluto no fim do dia mais recente da série é aproximado
// pelo `currentValue` (pequena margem de erro igual à variação de hoje, que ainda não está
// na série de Insights) — o próprio sync diário corrige isso assim que rodar de novo; o
// backfill é só uma estimativa razoável pra preencher o passado, não um valor exato.
function reconstructAbsolute(currentValue, deltasAscending) {
  const out = [];
  let running = currentValue;
  for (let i = deltasAscending.length - 1; i >= 0; i--) {
    out.unshift({ date: deltasAscending[i].date, value: running });
    running -= (deltasAscending[i].delta || 0);
  }
  return out;
}

function latestSnapshot(brandId, platform, countryId) {
  const all = getSnapshots(brandId, platform, countryId);
  const dates = Object.keys(all).sort();
  if (!dates.length) return null;
  const date = dates[dates.length - 1];
  return { date, data: all[date] };
}

export async function backfillSocialHistory({ brandId, countryId }) {
  const result = { brandId, countryId, instagram: { attempted: false, added: 0 }, facebook: { attempted: false, added: 0 }, errors: [] };

  const accounts = listAccounts(brandId).filter(a => a.countryId === countryId);
  const igAccount = accounts.find(a => a.platform === 'instagram');
  const fbAccount = accounts.find(a => a.platform === 'facebook');

  if (igAccount) {
    const igExisting = getSnapshots(brandId, 'instagram', countryId);
    const igAnchor = latestSnapshot(brandId, 'instagram', countryId);
    if (igAnchor && igAnchor.data.followers != null) {
      result.instagram.attempted = true;
      try {
        const deltas = await fetchInstagramFollowerDeltas(igAccount.metaId);
        const series = reconstructAbsolute(igAnchor.data.followers, deltas);
        for (const { date, value } of series) {
          if (igExisting[date]) continue; // não sobrescreve snapshot real já sincronizado
          addSnapshot(brandId, 'instagram', countryId, date, { followers: value });
          result.instagram.added++;
        }
      } catch (e) {
        result.errors.push('instagram: ' + e.message);
      }
    } else {
      result.errors.push('instagram: nenhum snapshot ainda pra usar de âncora. Rode o sync normal primeiro.');
    }
  }

  if (fbAccount) {
    const fbExisting = getSnapshots(brandId, 'facebook', countryId);
    const fbAnchor = latestSnapshot(brandId, 'facebook', countryId);
    if (fbAnchor && fbAnchor.data.likes != null) {
      result.facebook.attempted = true;
      try {
        const deltas = await fetchFacebookNetFanDeltas(fbAccount.metaId);
        const series = reconstructAbsolute(fbAnchor.data.likes, deltas);
        for (const { date, value } of series) {
          const existing = fbExisting[date];
          if (existing && existing.followers != null) continue; // já completo (sync real ou backfill anterior) — não mexe
          // Curtidas e seguidores da Página são sempre o mesmo número observado nessa conta (a
          // Meta unificou os dois conceitos) — usa o mesmo valor reconstruído pros dois campos.
          // Se já existia um `likes` de um backfill anterior, preserva ele em vez de sobrescrever.
          addSnapshot(brandId, 'facebook', countryId, date, { ...(existing || {}), likes: existing?.likes ?? value, followers: value });
          result.facebook.added++;
        }
      } catch (e) {
        result.errors.push('facebook: ' + e.message);
      }
    } else {
      result.errors.push('facebook: nenhum snapshot ainda pra usar de âncora. Rode o sync normal primeiro.');
    }
  }

  return result;
}
