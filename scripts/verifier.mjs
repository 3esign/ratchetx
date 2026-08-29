import fs from 'fs';

const API_KEY = process.env.PYTH_API_KEY || '';
const BENCHMARKS_URL = process.env.PYTH_BENCHMARKS_URL || 'https://benchmarks.pyth.network/v1';

async function verifyShot(shotUrl) {
  let shot;
  try {
    const idMatch = shotUrl.match(/[?&]id=([a-z0-9]{4,16})/i);
    if (!idMatch) throw new Error('Could not find ?id= in proof URL');
    const shotId = idMatch[1];
    
    const targetUrl = new URL(shotUrl).origin + '/api/record?format=json';
    const recordRes = await fetch(targetUrl);
    if (!recordRes.ok) throw new Error(`HTTP ${recordRes.status} from Ratchet`);
    const data = await recordRes.json();
    shot = data.rows.find(r => r.id === shotId);
    if (!shot) {
       return { result: 'DIVERGENCE', reason: 'Shot not found in public records' };
    }
  } catch(e) {
    return { result: 'INSUFFICIENT_EVIDENCE', reason: `Failed to fetch shot: ${e.message}` };
  }

  const { id, feed, entry, sealedAt, exp, res: ratchetOutcome, p, thresh } = shot;
  const grace = shot.grace || 60; // 60s
  const expSecs = Math.floor(exp / 1000);
  const url = `${BENCHMARKS_URL}/updates/price/${expSecs}/${grace}?ids[]=${feed}`;
  
  let pythData;
  try {
    const opts = API_KEY ? { headers: { 'Authorization': `Bearer ${API_KEY}` } } : {};
    const pythRes = await fetch(url, opts);
    if (!pythRes.ok) throw new Error(`HTTP ${pythRes.status}`);
    pythData = await pythRes.json();
  } catch (e) {
    return { result: 'INSUFFICIENT_EVIDENCE', reason: `Pyth fetch error: ${e.message}` };
  }
  
  const updates = (pythData.parsed || pythData || []).filter(u => u.id === feed);
  if (!updates.length) {
    return { result: 'INSUFFICIENT_EVIDENCE', reason: `No qualified updates in [expiry, expiry+grace]` };
  }
  
  let selected = null;
  updates.sort((a, b) => a.price.publish_time - b.price.publish_time);
  
  for (const update of updates) {
    const pt = Number(update.price.publish_time);
    const ptMs = pt * 1000;
    if (ptMs >= exp && ptMs <= exp + (grace * 1000)) {
      selected = update.price;
      break;
    }
  }

  if (!selected) {
    return { result: 'INSUFFICIENT_EVIDENCE', reason: `No Pyth updates published exactly within grace window` };
  }

  const price = Number(selected.price) * Math.pow(10, selected.expo);
  
  const kindMatch = shot.label.match(/(dir|thr)/);
  const kind = kindMatch ? kindMatch[1] : 'dir';
  let isHit = false;

  if (kind === 'dir') {
    if (price > entry) isHit = (shot.side === 'YES');
    else if (price < entry) isHit = (shot.side === 'NO');
    else return { result: 'DIVERGENCE', reason: `Tie breaks should be voided, manual review needed` };
  } else {
    const t = entry * (1 + (shot.side === 'YES' ? thresh : -thresh));
    if (shot.side === 'YES') isHit = (price >= t);
    else isHit = (price <= t);
  }

  const expectedOutcome = isHit ? 'HIT' : 'MISS';
  const isMatch = (expectedOutcome === ratchetOutcome);

  const brier = Math.pow((isHit ? 1 : 0) - (p || 0.5), 2);

  return {
    shotId: id,
    feed,
    entryPrice: entry,
    exitPrice: price,
    side: shot.side,
    probability: p,
    ratchetSettlement: ratchetOutcome,
    verifierSettlement: expectedOutcome,
    brierScore: brier,
    result: isMatch ? 'MATCH' : 'DIVERGENCE',
    reason: isMatch ? 'Outcomes match perfectly' : 'Independent verification diverged from Ratchet server'
  };
}

export { verifyShot };

const args = process.argv.slice(2);
if (args.length > 0 && typeof process !== 'undefined' && process.argv[1].endsWith('verifier.mjs')) {
  verifyShot(args[0]).then(receipt => {
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.result === 'DIVERGENCE') process.exit(1);
    if (receipt.result === 'INSUFFICIENT_EVIDENCE') process.exit(2);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
