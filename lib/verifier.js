'use strict';

// This verifier is deliberately keyless. Ratchet already validates Pyth
// PriceUpdateV2 accounts while capturing settlement evidence from Solana;
// charging agents must not add a paid historical-data dependency behind that
// free core. The receipt below proves internal consistency and tamper evidence
// over the exact observation Ratchet retained. It does NOT claim an
// independent replay of every Pyth update that existed outside our capture.
const { ACCOUNTS } = require('./onchain_px.js');
const { SETTLE_RULE, questionOutcome } = require('./outcome.js');
const { priceCrossing, SETTLE_GRACE_MS } = require('./pxlog.js');
const { verifyCommit } = require('./commit.js');

function normalizeShot(raw) {
  return {
    ...raw,
    id: raw.id || raw.shotId,
    kind: raw.kind || 'dir',
    expiry: Number(raw.expiry == null ? raw.exp : raw.expiry),
    thresh: raw.thresh == null ? raw.threshold : raw.thresh,
    statedProbability: raw.statedProbability == null ? raw.sp : raw.statedProbability,
    result: String(raw.result || raw.res || '').toLowerCase(),
    exit: raw.exit == null ? raw.exitPx : raw.exit,
    exit2: raw.exit2 == null ? raw.exitPx2 : raw.exit2,
  };
}

function nearlyEqual(a, b) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  return Math.abs(Number(a) - Number(b))
    <= Math.max(1e-12, Math.abs(Number(b)) * 1e-10);
}

function durableObservation(shot, symbol, second = false) {
  const suffix = second ? '2' : '';
  const value = Number(second ? shot.exit2 : shot.exit);
  const publishTime = Number(shot[`exitAt${suffix}`]);
  const observedAt = Number(shot[`exitObservedAt${suffix}`]);
  const slot = Number(shot[`exitSlot${suffix}`]);
  const postedSlot = Number(shot[`exitPostedSlot${suffix}`]);
  const confidenceBps = Number(shot[`exitConfBps${suffix}`]);
  const previousPublishTime = Number(shot[`prevExitAt${suffix}`]);
  if (!Number.isFinite(value) || !Number.isFinite(publishTime)
      || !Number.isFinite(observedAt) || observedAt <= 0
      || !Number.isSafeInteger(slot) || slot < 0
      || !Number.isSafeInteger(postedSlot) || postedSlot < 0
      || !Number.isFinite(confidenceBps)) return null;
  return { row:{ src:shot[`exitSource${suffix}`] || 'pyth-onchain-stream',
      t:observedAt, slot, postedSlot }, value, publishTime,
    previousPublishTime:Number.isFinite(previousPublishTime) ? previousPublishTime : null,
    confidenceBps, selectionRecomputed:false, retainedBy:'hash-chained-settlement-event' };
}

function normalizeObservation(symbol, selected) {
  const spec = ACCOUNTS[symbol];
  if (!spec || !selected) return null;
  const row = selected.row || {};
  return {
    symbol,
    account:spec[0],
    feedId:spec[1],
    source:row.src || 'pyth-onchain',
    observedAt:Number(row.t) || null,
    slot:Number.isSafeInteger(Number(row.slot)) ? Number(row.slot) : null,
    postedSlot:Number.isSafeInteger(Number(row.postedSlot)) ? Number(row.postedSlot) : null,
    value:Number(selected.value == null ? selected.price : selected.value),
    publishTime:Number(selected.publishTime),
    previousPublishTime:Number.isFinite(Number(selected.previousPublishTime == null
      ? selected.prevPublishTime : selected.previousPublishTime))
      ? Number(selected.previousPublishTime == null
        ? selected.prevPublishTime : selected.previousPublishTime) : null,
    confidenceBps:Number(selected.confidenceBps == null
      ? selected.confBps : selected.confidenceBps),
    selectionRecomputed:selected.selectionRecomputed !== false,
    retainedBy:selected.retainedBy || 'pxlog-validated-account-observation',
  };
}

async function retainedObservation(shot, symbol, second = false, options = {}) {
  const supplied = options.observations && options.observations[symbol];
  if (supplied) return normalizeObservation(symbol, supplied);
  const selected = await priceCrossing(symbol, shot.expiry, Date.now(),
    shot.oracleSrc || 'pyth-onchain');
  if (selected && !selected.wait && !selected.expired) {
    const observation = normalizeObservation(symbol, { ...selected,
      selectionRecomputed:true, retainedBy:'pxlog-validated-account-observation' });
    if (observation) return observation;
  }
  return normalizeObservation(symbol, durableObservation(shot, symbol, second));
}

function matchesRecordedObservation(shot, observation, second = false) {
  const suffix = second ? '2' : '';
  if (!observation
      || observation.publishTime !== Number(shot[`exitAt${suffix}`])
      || !nearlyEqual(observation.value, second ? shot.exit2 : shot.exit)) return false;
  const optional = [
    [`prevExitAt${suffix}`, 'previousPublishTime', (a, b) => Number(a) === Number(b)],
    [`exitConfBps${suffix}`, 'confidenceBps', nearlyEqual],
    [`exitObservedAt${suffix}`, 'observedAt', (a, b) => Number(a) === Number(b)],
    [`exitSlot${suffix}`, 'slot', (a, b) => Number(a) === Number(b)],
    [`exitPostedSlot${suffix}`, 'postedSlot', (a, b) => Number(a) === Number(b)],
    [`exitSource${suffix}`, 'source', (a, b) => String(a) === String(b)],
  ];
  return optional.every(([recorded, retained, compare]) => shot[recorded] == null
    || compare(shot[recorded], observation[retained]));
}

async function verifyEvidence(raw, options = {}) {
  const evidence = raw && raw.shot ? raw : { shot:raw || {} };
  const shot = normalizeShot(evidence.shot || {});
  if (!shot.id || !shot.feed || !Number.isFinite(shot.expiry))
    return { result:'INSUFFICIENT_EVIDENCE', code:'MALFORMED_RECORD',
      reason:'record lacks shot id, feed or expiry' };
  if (!['hit', 'miss'].includes(shot.result))
    return { result:'INSUFFICIENT_EVIDENCE', code:'UNSETTLED_RECORD',
      reason:'only settled hit/miss shots can produce this bundle' };
  if (shot.settleRule !== SETTLE_RULE)
    return { result:'INSUFFICIENT_EVIDENCE', code:'UNSUPPORTED_RULE',
      reason:`unsupported settlement rule ${shot.settleRule || 'missing'}` };
  if (!shot.kind || (shot.kind === 'race' && (!shot.feed2
      || !Number.isFinite(Number(shot.entry2))))
      || ((shot.kind === 'thr' || shot.kind === 'thrDown')
        && !Number.isFinite(Number(shot.thresh)))
      || (shot.kind === 'range' && !Number.isFinite(Number(shot.pct))))
    return { result:'INSUFFICIENT_EVIDENCE', code:'MALFORMED_QUESTION',
      reason:'record lacks the sealed question parameters' };

  const chainVerification = options.chainVerification
    || evidence.chainVerification || (evidence.chain && evidence.chain.verification);
  if (!chainVerification)
    return { result:'INSUFFICIENT_EVIDENCE', code:'CHAIN_VERDICT_MISSING',
      reason:'full hash-chain verification verdict is missing' };
  if (!chainVerification.ok)
    return { result:'DIVERGENCE', code:'CHAIN_DIVERGENCE', shotId:shot.id,
      reason:`hash chain did not verify: ${chainVerification.reason || 'unknown failure'}` };

  const commitment = verifyCommit({ version:shot.commitV || shot.commitVersion || 1,
    wallet:shot.wallet || shot.w, shotId:shot.id, side:shot.side,
    salt:shot.salt, commit:shot.commit });
  if (!commitment.matches)
    return { result:'DIVERGENCE', code:'COMMITMENT_DIVERGENCE', shotId:shot.id,
      reason:'the revealed side does not reproduce the sealed commitment' };

  let first, second = null;
  try {
    first = await retainedObservation(shot, shot.feed, false, options);
    if (shot.kind === 'race')
      second = await retainedObservation(shot, shot.feed2, true, options);
  } catch (e) {
    return { result:'INSUFFICIENT_EVIDENCE', code:'EVIDENCE_STORE_UNAVAILABLE',
      reason:String(e.message || e) };
  }
  if (!first || (shot.kind === 'race' && !second))
    return { result:'INSUFFICIENT_EVIDENCE', code:'RETAINED_EVIDENCE_EXPIRED',
      reason:'the validated Pyth account observation is no longer retained' };

  const exactFirst = matchesRecordedObservation(shot, first, false);
  const exactSecond = shot.kind !== 'race'
    || matchesRecordedObservation(shot, second, true);
  if (!exactFirst || !exactSecond)
    return { result:'DIVERGENCE', code:'ORACLE_OBSERVATION_DIVERGENCE', shotId:shot.id,
      reason:'the hash-chained exit does not match the retained Pyth account observation' };
  if (first.publishTime < shot.expiry
      || first.publishTime > shot.expiry + SETTLE_GRACE_MS
      || (second && (second.publishTime < shot.expiry
        || second.publishTime > shot.expiry + SETTLE_GRACE_MS)))
    return { result:'DIVERGENCE', code:'SETTLEMENT_WINDOW_DIVERGENCE', shotId:shot.id,
      reason:'the selected observation falls outside the recorded settlement window' };

  const marketOutcome = questionOutcome(shot, first.value, second && second.value);
  const verifierSettlement = marketOutcome === 'VOID' ? 'void'
    : marketOutcome === shot.side ? 'hit' : 'miss';
  const matched = verifierSettlement === shot.result;
  const probability = Number(shot.statedProbability);
  const brier = Number.isFinite(probability)
    ? Math.pow(probability - (verifierSettlement === 'hit' ? 1 : 0), 2) : null;

  return {
    proofVersion:'ratchetx-keyless-audit-v1',
    shotId:shot.id,
    feed:shot.feed,
    ...(shot.feed2 ? { feed2:shot.feed2 } : {}),
    question:{ kind:shot.kind, entry:Number(shot.entry),
      ...(shot.entry2 != null ? { entry2:Number(shot.entry2) } : {}),
      ...(shot.thresh != null ? { threshold:Number(shot.thresh) } : {}),
      ...(shot.pct != null ? { pct:Number(shot.pct) } : {}), side:shot.side },
    expiry:shot.expiry,
    oracle:[first, ...(second ? [second] : [])],
    commitment:{ version:commitment.version, recomputed:commitment.recomputed,
      matches:commitment.matches },
    chainVerification,
    trustBoundary:{
      oracleAccountValidation:'Pyth PriceUpdateV2 decoded and validated at observation time',
      selectionAuthority:'ratchet-server-hash-chain',
      independentPythReplay:false,
      note:'This keyless receipt proves commitment, hash-chain and outcome consistency over Ratchet-retained Solana account evidence; it cannot prove Ratchet captured every qualifying update outside that evidence plane.',
    },
    selectionEvidence:{ authority:'ratchet-server-hash-chain', rule:shot.settleRule,
      recomputedFromRetainedPath:first.selectionRecomputed
        && (!second || second.selectionRecomputed) },
    statedProbability:Number.isFinite(probability) ? probability : null,
    ratchetSettlement:shot.result,
    verifierSettlement,
    brierScore:brier == null ? null : +brier.toFixed(6),
    result:matched ? 'MATCH' : 'DIVERGENCE',
    reason:matched
      ? 'sealed commitment, hash chain, retained Pyth observation and versioned outcome rule reproduce the recorded result'
      : 'the retained Pyth observation produces a different result under the recorded rule',
  };
}

module.exports = { verifyEvidence, normalizeShot, nearlyEqual };
