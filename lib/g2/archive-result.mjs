// Browser-only reconstruction of revealed archive facts; no wallet or Node imports.
// Source: Timepin lifecycle.rs::CandidateV2/authenticate_candidate; model-v2.mjs
// ::hashPriceMessage; Core state.rs::seal_xp/game_result_hash/history_row_hash;
// Core lib.rs::settle_final/reveal.
//
// Preconditions: economy/ruleset/evidenceSpec are the canonical public client's
// validated account objects. event is the matching ShotArchived event from the
// successful attributed transaction already accepted by createGameReader.
// This module checks the facts committed by that event; it does not establish
// RPC finality, transaction provenance, history completeness, or validator replay.
//
// const verifier = createRevealedArchiveVerifier({client, web3});
// const addresses = verifier.evidenceAddresses({ruleset, event});
// // Read [addresses.evidenceSpec, ...addresses.needs]. Validate the spec with
// // client.validateEvidenceSpecAccount({address, info, expectedHash:
// //   ruleset.args.evidenceSpecHash}). Preserve {address, info} for both Needs.
// const candidateAddresses = verifier.selectedCandidateAddresses({
//   evidenceSpec, event, needAccounts: [{address,info}, {address,info}],
// });
// // Read those two addresses, preserving {address, info} for each Candidate.
// const verified = await verifier.verify({economy, ruleset, evidenceSpec, event,
//   needAccounts, candidateAccounts, expectedGenesisHash});
// // verified.result adds prices/hit/XP to the compact result without inventing
// // unavailable full-Shot fields. Keep the original receipt alongside it.

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n), I64_MAX = (1n << 63n) - 1n;
const utf8 = value => new TextEncoder().encode(value);
const domain = value => utf8(value + '\0');
const requireFact = (ok, why) => { if (!ok) throw new Error(why); };
const bytes = (value, length, label) => {
  requireFact(value instanceof Uint8Array && value.length === length, label + ' has invalid bytes');
  return new Uint8Array(value);
};
const h32 = (value, label = 'hash') => bytes(value, 32, label);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const nonzero = value => value.some(v => v !== 0);
const match = (a, b, label) => requireFact(equal(h32(a), h32(b)), label + ' mismatch');
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};
const big = (value, min, max, label) => {
  requireFact(typeof value === 'bigint' && value >= min && value <= max, 'Invalid ' + label);
  return value;
};
const u64Value = (value, label) => big(value, 0n, U64_MAX, label);
const i64Value = (value, label) => big(value, I64_MIN, I64_MAX, label);
const small = (value, min, max, label) => {
  requireFact(Number.isInteger(value) && value >= min && value <= max, 'Invalid ' + label);
  return value;
};
const le = (method, size, value) => {
  const out = new Uint8Array(size);
  new DataView(out.buffer)[method](0, value, true);
  return out;
};
const u8 = value => Uint8Array.of(small(value, 0, 255, 'u8'));
const u16 = value => le('setUint16', 2, small(value, 0, 65535, 'u16'));
const i32 = value => le('setInt32', 4, small(value, -2147483648, 2147483647, 'i32'));
const u64 = value => le('setBigUint64', 8, u64Value(value, 'u64'));
const i64 = value => le('setBigInt64', 8, i64Value(value, 'i64'));
const isqrt = n => {
  let low = 0n, high = n + 1n;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (mid * mid <= n) low = mid; else high = mid;
  }
  return low;
};
// Exact Core u64 saturation occurs after EACH multiplication, before sqrt.
const satMul = (a, b) => a * b > U64_MAX ? U64_MAX : a * b;
const sealXp = (base, stake) => {
  u64Value(base, 'base XP'); u64Value(stake, 'stake');
  if (stake >= 40000n) return satMul(base, 20n) || 1n;
  return ((isqrt(satMul(satMul(base, base), stake)) / 5n + 1n) / 2n) || 1n;
};

export function createRevealedArchiveVerifier({ client, web3, cryptoImpl = globalThis.crypto }) {
  requireFact(client?.validateNeedAccount && client?.validateForwardKernel &&
    client?.commitmentHash && web3?.PublicKey && cryptoImpl?.subtle, 'Missing canonical client/browser crypto');
  const pk = value => new web3.PublicKey(value);
  const keyBytes = value => pk(value).toBytes();
  const hash = async (...parts) => new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', concat(...parts)));
  const candidatePda = (need, messageHash) => web3.PublicKey.findProgramAddressSync(
    [utf8('candidate'), keyBytes(need), h32(messageHash)], client.timepinProgram);

  const revealed = event => {
    const r = event?.result;
    requireFact(r?.state === 4, 'Unsupported archive: only Revealed results are reconstructed');
    requireFact(r.voidReason === 0 && (r.side === 0 || r.side === 1), 'Invalid revealed outcome shape');
    small(r.pBps, 1, 9999, 'confidence');
    u64Value(event.nonce, 'nonce'); u64Value(r.stake, 'stake');
    i64Value(r.sealedTs, 'sealed time'); i64Value(r.entryTargetTs, 'entry target'); i64Value(r.exitTargetTs, 'exit target');
    requireFact(r.stake > 0n && r.sealedTs > 0n && r.entryTargetTs > 0n && r.exitTargetTs > r.entryTargetTs,
      'Invalid compact archive terms');
    requireFact(nonzero(h32(r.rulesetHash)), 'Empty archive ruleset');
    h32(event.economyHash); h32(event.player); h32(r.proofMaterial); h32(r.delegate); h32(r.gameResultHash);
    return r;
  };

  function evidenceAddresses({ ruleset, event }) {
    const r = revealed(event);
    match(r.rulesetHash, ruleset.rulesetHash, 'Archive Ruleset');
    return {
      evidenceSpec: client.evidenceSpecPda(ruleset.args.evidenceSpecHash)[0],
      needs: [r.entryTargetTs, r.exitTargetTs].map(target => client.needPda(ruleset.args.evidenceSpecHash, target)[0]),
    };
  }

  function finalNeeds({ evidenceSpec, event, needAccounts }) {
    const r = revealed(event);
    requireFact(Array.isArray(needAccounts) && needAccounts.length === 2, 'Two Need accounts are required');
    return needAccounts.map((account, i) => {
      requireFact(account?.info, 'Permanent Need account is unavailable');
      const need = client.validateNeedAccount({ address: account.address, info: account.info,
        evidenceSpec, targetTs: i ? r.exitTargetTs : r.entryTargetTs, requireOpen: false });
      requireFact(need.state === 2, 'Unsupported archive evidence: both Needs must be FINAL');
      return { ...need, address: pk(account.address) };
    });
  }

  function selectedCandidateAddresses(input) {
    return finalNeeds(input).map(n => candidatePda(n.address, n.candidateAHash)[0]);
  }

  async function authenticateCandidate(spec, need, account) {
    requireFact(account?.info && account.info.executable === false &&
      pk(account.info.owner).equals(client.timepinProgram), 'Candidate owner/executable mismatch');
    const raw = bytes(account.info.data, 119, 'CandidateV2 account');
    const discriminator = (await hash(utf8('account:CandidateV2'))).slice(0, 8);
    requireFact(equal(raw.slice(0, 8), discriminator), 'Candidate discriminator mismatch');
    const view = new DataView(raw.buffer); let offset = 8;
    const take = n => { const value = raw.slice(offset, offset + n); offset += n; return value; };
    const read = (method, n) => { const value = view[method](offset, true); offset += n; return value; };
    const c = {
      address: pk(account.address), schema: read('getUint16', 2), bump: read('getUint8', 1), need: take(32),
      price: read('getBigInt64', 8), conf: read('getBigUint64', 8), exponent: read('getInt32', 4),
      publishTime: read('getBigInt64', 8), prevPublishTime: read('getBigInt64', 8),
      emaPrice: read('getBigInt64', 8), emaConf: read('getBigUint64', 8), postedSlot: read('getBigUint64', 8),
      captureSlot: read('getBigUint64', 8), captureTs: read('getBigInt64', 8),
    };
    requireFact(offset === raw.length, 'Candidate trailing bytes');
    const [address, bump] = candidatePda(need.address, need.candidateAHash);
    requireFact(c.address.equals(address) && c.schema === 2 && c.bump === bump &&
      equal(c.need, keyBytes(need.address)), 'Candidate PDA/schema/Need mismatch');
    requireFact(c.captureTs >= need.targetTs && c.captureTs < need.captureDeadlineTs &&
      c.postedSlot > spec.registeredSlot && c.postedSlot <= c.captureSlot, 'Candidate capture bounds mismatch');
    const s = spec.args;
    const newestAllowed = i64Value(c.captureTs + BigInt(s.maxFutureSkewSeconds), 'capture time plus future skew');
    requireFact(c.publishTime <= newestAllowed, 'Candidate publish time exceeds permitted future skew');
    if (s.adapter === 2) requireFact(c.publishTime >= need.targetTs, 'Candidate precedes target');
    else if (s.adapter === 1) requireFact(c.prevPublishTime < need.targetTs && need.targetTs <= c.publishTime &&
      need.targetTs - c.prevPublishTime <= BigInt(s.maxPreTargetGapSeconds), 'Candidate bracket mismatch');
    else throw new Error('Unsupported Timepin adapter');
    requireFact(c.publishTime - need.targetTs <= BigInt(s.maxPostTargetLagSeconds) &&
      c.publishTime <= need.sourceDeadlineTs && c.price > 0n &&
      c.exponent >= s.minExponent && c.exponent <= s.maxExponent &&
      c.conf * 10000n <= c.price * BigInt(s.maxConfidenceBps), 'Candidate decision fields mismatch');
    c.messageHash = await hash(domain('rcx-timepin:pyth-price-message:v2'), h32(s.feedId),
      i64(c.price), u64(c.conf), i32(c.exponent), i64(c.publishTime), i64(c.prevPublishTime),
      i64(c.emaPrice), u64(c.emaConf));
    match(c.messageHash, need.candidateAHash, 'Candidate message hash');
    c.timepinResultHash = await hash(domain('rcx-timepin:evidence-set:v2'), keyBytes(need.address), h32(need.candidateAHash));
    return c;
  }

  async function verify({ economy, ruleset, evidenceSpec, event, needAccounts, candidateAccounts, expectedGenesisHash }) {
    const r = revealed(event);
    client.validateForwardKernel({ economy, ruleset, evidenceSpec });
    match(economy.args.clusterGenesisHash, keyBytes(expectedGenesisHash), 'Configured cluster');
    match(event.economyHash, economy.economyHash, 'Archive Economy');
    match(r.rulesetHash, ruleset.rulesetHash, 'Archive Ruleset');
    const rules = ruleset.args, econ = economy.args;
    requireFact(r.stake >= econ.minStake && r.stake <= econ.maxStake &&
      r.exitTargetTs - r.entryTargetTs === BigInt(rules.horizonSeconds) &&
      r.entryTargetTs % BigInt(rules.targetGridSeconds) === 0n, 'Archive Economy/Ruleset terms mismatch');
    const needs = finalNeeds({ evidenceSpec, event, needAccounts });
    requireFact(Array.isArray(candidateAccounts) && candidateAccounts.length === 2, 'Two Candidate accounts are required');
    const [entry, exit] = await Promise.all(needs.map((need, i) => authenticateCandidate(evidenceSpec, need, candidateAccounts[i])));
    const scale = (value, exponent) => {
      small(exponent, -12, 2, 'Core exponent');
      return value * 10n ** BigInt(12 + exponent);
    };
    const entryPrice = scale(entry.price, entry.exponent), exitPrice = scale(exit.price, exit.exponent);
    const delta = exitPrice >= entryPrice ? exitPrice - entryPrice : entryPrice - exitPrice;
    const entryConf = scale(entry.conf, entry.exponent), exitConf = scale(exit.conf, exit.exponent);
    const referenceConf = entryConf > exitConf ? entryConf : exitConf;
    const numerator = BigInt(small(rules.bandNumerator, 0, 4294967295, 'band numerator'));
    const denominator = BigInt(small(rules.bandDenominator, 1, 4294967295, 'band denominator'));
    requireFact(delta !== 0n && !(numerator > 0n && delta * denominator <= referenceConf * numerator),
      'Revealed archive disagrees with equality/confidence-band VOID rule');
    const outcomeYes = Number(exitPrice > entryPrice), hit = Number((r.side === 1) === (outcomeYes === 1));
    const xpBase = sealXp(rules.baseXp, r.stake);
    const xpAwarded = u64Value(econ.settleXp, 'settle XP') + (hit ? xpBase : 0n);
    u64Value(xpAwarded, 'awarded XP');
    const projectedDeadline = i64Value(needs[1].captureDeadlineTs + BigInt(econ.revealWindowSeconds), 'projected reveal deadline');
    const scoreDay = projectedDeadline / 86400n;
    requireFact(scoreDay >= 0n, 'Negative score day');
    const commitment = await client.commitmentHash({ economyHash: event.economyHash, rulesetHash: r.rulesetHash,
      player: pk(event.player), nonce: event.nonce, side: r.side, probability: r.pBps, salt: r.proofMaterial });
    requireFact(nonzero(commitment), 'Empty reconstructed commitment');
    const gameResultHash = await hash(domain('rcx-core:game-result:g2'), keyBytes(client.coreProgram),
      h32(event.economyHash), h32(event.player), u64(event.nonce), h32(r.rulesetHash), h32(commitment),
      u64(r.stake), i64(r.sealedTs), i64(r.entryTargetTs), i64(r.exitTargetTs), u8(r.state), u8(r.voidReason),
      u8(r.side), u16(r.pBps), h32(r.delegate), entry.timepinResultHash, exit.timepinResultHash,
      u8(outcomeYes), u8(hit), u64(xpAwarded), i64(scoreDay));
    match(gameResultHash, r.gameResultHash, 'Reconstructed game result hash');
    const row = concat(h32(r.rulesetHash), h32(r.proofMaterial), u8(r.state), u8(r.voidReason), u64(r.stake),
      i64(r.sealedTs), i64(r.entryTargetTs), i64(r.exitTargetTs), u8(r.side), u16(r.pBps), h32(r.delegate), gameResultHash);
    requireFact(row.length === 165, 'Compact row ABI mismatch');
    const rowHash = await hash(domain('rcx-core:history-row:g2'), u64(event.nonce), row);
    match(rowHash, event.rowHash, 'Archive row hash');
    return {
      kind: 'verified-revealed-archive', outcome: hit ? 'HIT' : 'MISS', entry, exit,
      facts: { entryTimepinResultHash: entry.timepinResultHash, exitTimepinResultHash: exit.timepinResultHash,
        outcomeYes, hit, xpAwarded, scoreDay },
      commitment, gameResultHash, rowHash,
      result: { ...r, entryPrice: entry.price, entryConf: entry.conf, entryExponent: entry.exponent,
        entryPublishTime: entry.publishTime, exitPrice: exit.price, exitConf: exit.conf,
        exitExponent: exit.exponent, exitPublishTime: exit.publishTime, outcomeYes, hit, xpAwarded, scoreDay },
      checks: { candidateIdentity: true, candidateMessageHashes: true, resultOutcomeAndXp: true,
        gameResultHash: true, rowHash: true, historyCommitment: false, signatureVerification: false,
        rpcFinality: false },
    };
  }
  return Object.freeze({ evidenceAddresses, selectedCandidateAddresses, verify });
}

// Fetch only immutable public evidence, then bind reconstructed prices and XP
// to the exact archived game hash. This does not replay ledger balances.
export async function reconstructArchiveSnapshot({ snapshot, connection, client, web3, cryptoImpl }) {
  if (snapshot.kind !== 'archive' || snapshot.receipt.event.result.state !== 4) return snapshot;
  if (snapshot.checks?.accountIdentity !== true || snapshot.checks?.logProvenance !== true)
    throw new Error('An authenticated game archive is required');
  const verifier = createRevealedArchiveVerifier({ client, web3, cryptoImpl });
  const event = snapshot.receipt.event, addresses = verifier.evidenceAddresses({ ruleset: snapshot.ruleset, event });
  const firstKeys = [new web3.PublicKey(snapshot.addresses.economy), new web3.PublicKey(snapshot.addresses.ruleset), addresses.evidenceSpec, ...addresses.needs];
  const options = { commitment: 'confirmed', minContextSlot: snapshot.receipt.transaction.slot };
  const read = async keys => {
    const out = await connection.getMultipleAccountsInfoAndContext(keys, options);
    if (!Number.isSafeInteger(out?.context?.slot) || out.context.slot < options.minContextSlot ||
        !Array.isArray(out.value) || out.value.length !== keys.length || out.value.some(v => !v))
      throw new Error('Permanent result evidence is unavailable at the required slot');
    return out;
  };
  const first = await read(firstKeys);
  const economy = await client.validateEconomyAccount({ address: firstKeys[0], info: first.value[0], expectedHash: event.economyHash });
  const ruleset = await client.validateRulesetAccount({ address: firstKeys[1], info: first.value[1], economy, expectedHash: event.result.rulesetHash });
  const evidenceSpec = await client.validateEvidenceSpecAccount({ address: addresses.evidenceSpec, info: first.value[2], expectedHash: ruleset.args.evidenceSpecHash });
  const needAccounts = addresses.needs.map((address, i) => ({ address, info: first.value[i + 3] }));
  const candidateKeys = verifier.selectedCandidateAddresses({ evidenceSpec, event, needAccounts });
  const second = await read(candidateKeys);
  const candidateAccounts = candidateKeys.map((address, i) => ({ address, info: second.value[i] }));
  const reconstruction = await verifier.verify({ economy, ruleset, evidenceSpec, event, needAccounts, candidateAccounts, expectedGenesisHash: snapshot.cluster.genesisHash });
  const capture = (keys, batch) => keys.map((address, i) => ({ address: address.toBase58(), owner: batch.value[i].owner.toBase58(),
    executable: batch.value[i].executable, rawAccount: new Uint8Array(batch.value[i].data), readSlot: batch.context.slot }));
  reconstruction.evidence = [...capture(firstKeys, first), ...capture(candidateKeys, second)];
  Object.assign(reconstruction.result, { entryNeed: addresses.needs[0], exitNeed: addresses.needs[1],
    entryTimepinResultHash: reconstruction.entry.timepinResultHash, exitTimepinResultHash: reconstruction.exit.timepinResultHash,
    entryMessageHash: reconstruction.entry.messageHash, exitMessageHash: reconstruction.exit.messageHash });
  return { ...snapshot, reconstruction, checks: { ...snapshot.checks, ...reconstruction.checks, resultEconomics: false, ledgerBalances: false } };
}
