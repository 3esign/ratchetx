import { createHash } from 'node:crypto';

export const STATE = Object.freeze({
  OPEN: 'OPEN',
  CAPTURED: 'CAPTURED',
  VOID_EQUAL: 'VOID_EQUAL',
  VOID_MISSED_SUCCESSOR: 'VOID_MISSED_SUCCESSOR',
  VOID_SOURCE_REVISION: 'VOID_SOURCE_REVISION',
  VOID_SOURCE_CHAIN: 'VOID_SOURCE_CHAIN',
  VOID_SCALE_CHANGE: 'VOID_SCALE_CHANGE',
  VOID_TIMEOUT: 'VOID_TIMEOUT',
});

export class NextPrintError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => { throw new NextPrintError(code); };
const int = (value, code) => {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) fail(code);
  return BigInt(value);
};
const time = (value, code) => {
  if (!Number.isSafeInteger(value)) fail(code);
  return value;
};
const pow10 = n => 10n ** BigInt(n);

export function hashEvidence(e) {
  const fields = [
    'RATCHET_NEXT_PRINT_EVIDENCE_V1', e.feedId, String(e.price),
    String(e.conf), String(e.exponent), String(e.publishTime),
    String(e.prevPublishTime), String(e.postedSlot), e.sourceAccount,
  ];
  return createHash('sha256').update(fields.join('|')).digest('hex');
}

export function comparePrice(a, b) {
  const ae = time(a.exponent, 'BAD_EXPONENT');
  const be = time(b.exponent, 'BAD_EXPONENT');
  if (Math.abs(ae) > 12 || Math.abs(be) > 12) fail('BAD_EXPONENT');
  const common = Math.min(ae, be);
  const av = int(a.price, 'BAD_PRICE') * pow10(ae - common);
  const bv = int(b.price, 'BAD_PRICE') * pow10(be - common);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export function validateEvidence(e, policy, clock, purpose = 'entry') {
  if (!e || typeof e !== 'object') fail('BAD_PRICE_ACCOUNT');
  if (policy.adapterId !== 'PYTH_PUSH_V1') fail('UNSUPPORTED_ADAPTER');
  if (e.owner !== policy.pythReceiver) fail('WRONG_RECEIVER_OWNER');
  if (e.sourceAccount !== e.expectedSourceAccount) fail('WRONG_SOURCE_PDA');
  if (e.writeAuthority !== e.sourceAccount) fail('WRONG_WRITE_AUTHORITY');
  if (e.executable === true) fail('EXECUTABLE_SOURCE');
  if (e.dataLength !== 134) fail('BAD_PRICE_ACCOUNT_LENGTH');
  if (e.verification !== 'Full') fail('PARTIAL_VERIFICATION');
  if (!policy.feedIds.includes(e.feedId)) fail('FEED_NOT_ALLOWED');

  const price = int(e.price, 'BAD_PRICE');
  const conf = int(e.conf, 'BAD_CONFIDENCE');
  if (price <= 0n) fail('BAD_PRICE');
  if (conf < 0n) fail('BAD_CONFIDENCE');
  const exponent = time(e.exponent, 'BAD_EXPONENT');
  if (Math.abs(exponent) > 12) fail('BAD_EXPONENT');
  const publishTime = time(e.publishTime, 'BAD_PUBLISH_TIME');
  const prevPublishTime = time(e.prevPublishTime, 'BAD_PREV_PUBLISH_TIME');
  const postedSlot = int(e.postedSlot, 'BAD_POSTED_SLOT');
  const now = time(clock.unixTimestamp, 'BAD_CLOCK');
  const slot = int(clock.slot, 'BAD_CLOCK_SLOT');
  if (prevPublishTime >= publishTime) fail('BAD_SOURCE_INTERVAL');
  if (postedSlot > slot) fail('POSTED_SLOT_IN_FUTURE');
  if (publishTime > now + policy.maxFutureSkewSec) fail('ORACLE_TIME_IN_FUTURE');
  if (conf * 10_000n > price * BigInt(policy.maxConfBps)) fail('CONFIDENCE_TOO_WIDE');
  if (purpose === 'entry' && now - publishTime > policy.maxEntryAgeSec) fail('STALE_ENTRY');
  return Object.freeze({
    adapterId: policy.adapterId,
    feedId: e.feedId,
    price,
    conf,
    exponent,
    publishTime,
    prevPublishTime,
    postedSlot,
    sourceAccount: e.sourceAccount,
    messageHash: hashEvidence(e),
  });
}

export function openNextPrint({ player, nonce, commit, evidence, policy, clock }) {
  if (!player || !Number.isSafeInteger(nonce) || nonce < 0) fail('BAD_SHOT_ID');
  if (!/^[0-9a-f]{64}$/i.test(commit || '')) fail('BAD_COMMIT');
  const entry = validateEvidence(evidence, policy, clock, 'entry');
  return Object.freeze({
    version: 1,
    rulesetHash: policy.rulesetHash,
    adapterId: policy.adapterId,
    player,
    nonce,
    commit: commit.toLowerCase(),
    state: STATE.OPEN,
    openedAt: time(clock.unixTimestamp, 'BAD_CLOCK'),
    deadline: time(clock.unixTimestamp, 'BAD_CLOCK') + policy.maxWaitSec,
    entry,
    exit: null,
    outcome: null,
  });
}

export function observeNextPrint(shot, evidence, policy, clock) {
  if (shot.state !== STATE.OPEN) fail('TERMINAL_SHOT');
  if (shot.rulesetHash !== policy.rulesetHash) fail('WRONG_RULESET');
  if (shot.adapterId !== policy.adapterId) fail('WRONG_ADAPTER');
  const current = validateEvidence(evidence, policy, clock, 'exit');
  if (current.feedId !== shot.entry.feedId) fail('WRONG_FEED');

  if (current.publishTime < shot.entry.publishTime) fail('SOURCE_REGRESSION');
  if (current.publishTime === shot.entry.publishTime) {
    if (current.messageHash === shot.entry.messageHash) return shot;
    return Object.freeze({ ...shot, state: STATE.VOID_SOURCE_REVISION });
  }
  if (current.prevPublishTime > shot.entry.publishTime) {
    return Object.freeze({ ...shot, state: STATE.VOID_MISSED_SUCCESSOR });
  }
  if (current.prevPublishTime < shot.entry.publishTime) {
    return Object.freeze({ ...shot, state: STATE.VOID_SOURCE_CHAIN });
  }
  if (current.exponent !== shot.entry.exponent) {
    return Object.freeze({ ...shot, state: STATE.VOID_SCALE_CHANGE });
  }

  const direction = comparePrice(current, shot.entry);
  if (direction === 0) {
    return Object.freeze({ ...shot, state: STATE.VOID_EQUAL, exit: current, outcome: 'VOID' });
  }
  return Object.freeze({
    ...shot,
    state: STATE.CAPTURED,
    exit: current,
    outcome: direction > 0 ? 'UP' : 'DOWN',
  });
}

export function timeoutNextPrint(shot, clock) {
  if (shot.state !== STATE.OPEN) fail('TERMINAL_SHOT');
  if (time(clock.unixTimestamp, 'BAD_CLOCK') < shot.deadline) fail('DEADLINE_OPEN');
  return Object.freeze({ ...shot, state: STATE.VOID_TIMEOUT });
}
