// backfill.js — preenche dias anteriores ao início do sync usando a Insights API (ver
// meta.js). Nunca sobrescreve um snapshot que já existe (o sync diário normal é sempre a
// fonte de verdade); só adiciona datas que ainda estão vazias.
import { fetchInstagramFollowerDeltas, fetchFacebookNetFanDeltas } from './meta.js';
import { getSnapshots, addSnapshot } from './store.js';

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

function latestSnapshot(platform, market) {
  const all = getSnapshots(platform, market);
  const dates = Object.keys(all).sort();
  if (!dates.length) return null;
  const date = dates[dates.length - 1];
  return { date, data: all[date] };
}

export async function backfillSocialHistory({ market }) {
  const result = { market, instagram: { attempted: false, added: 0 }, facebook: { attempted: false, added: 0 }, errors: [] };

  const igExisting = getSnapshots('instagram', market);
  const igAnchor = latestSnapshot('instagram', market);
  if (igAnchor && igAnchor.data.followers != null) {
    result.instagram.attempted = true;
    try {
      const deltas = await fetchInstagramFollowerDeltas(market);
      const series = reconstructAbsolute(igAnchor.data.followers, deltas);
      for (const { date, value } of series) {
        if (igExisting[date]) continue; // não sobrescreve snapshot real já sincronizado
        addSnapshot('instagram', market, date, { followers: value });
        result.instagram.added++;
      }
    } catch (e) {
      result.errors.push('instagram: ' + e.message);
    }
  } else {
    result.errors.push('instagram: nenhum snapshot ainda pra usar de âncora — rode o sync normal primeiro.');
  }

  const fbExisting = getSnapshots('facebook', market);
  const fbAnchor = latestSnapshot('facebook', market);
  if (fbAnchor && fbAnchor.data.likes != null) {
    result.facebook.attempted = true;
    try {
      const deltas = await fetchFacebookNetFanDeltas(market);
      const series = reconstructAbsolute(fbAnchor.data.likes, deltas);
      for (const { date, value } of series) {
        if (fbExisting[date]) continue;
        addSnapshot('facebook', market, date, { likes: value });
        result.facebook.added++;
      }
    } catch (e) {
      result.errors.push('facebook: ' + e.message);
    }
  } else {
    result.errors.push('facebook: nenhum snapshot ainda pra usar de âncora — rode o sync normal primeiro.');
  }

  return result;
}
