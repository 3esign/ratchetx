import { formatOracleNumber } from '../g2/shot-view.mjs';
// The one plain sentence, and the file a player can save.
//
// Semir asked for two things by name: a "why" sentence with every result that a
// person can read without knowing anything, and a Save-the-game download beside
// Share proof. Both are pure functions of a decoded Shot, so both are decided
// here and tested without a chain.
//
// THE BAR, from the ROOM ruling of 2026-09-05: a stranger must be able to
// re-verify the saved record against the chain WITHOUT US. So the file carries
// the chain tuple, the cluster it was read from, and the command that checks it -
// and the sentence never says anything the fields do not support.

export const SHOT_STATE = Object.freeze({
  1: 'PendingEntry', 2: 'Active', 3: 'AwaitReveal', 4: 'Revealed',
  5: 'Voided', 6: 'Forfeited', 7: 'AwaitVoid',
});
export const VOID_REASON = Object.freeze({
  0: 'None', 1: 'EntryExpired', 2: 'EntryAmbiguous', 3: 'ExitExpired',
  4: 'ExitAmbiguous', 5: 'Equality', 6: 'ConfidenceBand',
});

// price and exponent together, never price alone.
export function priceOf(raw, exponent) {
  if (raw === null || raw === undefined || exponent === null || exponent === undefined) return null;
  return formatOracleNumber(BigInt(raw), Number(exponent));
}

const clock = ts => (ts === null || ts === undefined
  ? null
  : new Date(Number(ts) * 1000).toISOString().slice(11, 19));

const side = s => (s == null ? 'an unrecorded direction' : Number(s) === 1 ? 'UP' : Number(s) === 0 ? 'DOWN' : 'unknown direction ' + s);

// ONE SENTENCE. No jargon, no hash, no field name. If a value is missing the
// sentence says what is missing rather than printing "undefined" in prose.
export function sentenceFor(shot, { feed = 'the price' } = {}) {
  if (!shot || typeof shot !== 'object') return 'This record could not be read.';
  const state = SHOT_STATE[Number(shot.state)];
  const reason = VOID_REASON[Number(shot.voidReason ?? 0)];
  const from = priceOf(shot.entryPrice, shot.entryExponent);
  const to = priceOf(shot.exitPrice, shot.exitExponent);
  const a = clock(shot.entryTargetTs);
  const b = clock(shot.exitTargetTs);
  const window = a && b ? ` between ${a} and ${b} UTC` : '';

  if (!state) {
    // No default arm anywhere. An unknown state is a bug report, not a sentence.
    return `This shot reports state ${shot.state}, which the current rules cannot produce. Please report it.`;
  }

  switch (state) {
    case 'Revealed': {
      const call = `You said ${side(shot.side)} on ${feed}${window}.`;
      const move = from && to ? ` It went from ${from} to ${to}.` : '';
      return `${call}${move} ${shot.hit === 1 ? 'You were right.' : shot.hit === 0 ? 'You were wrong.' : 'The score is not included in this record.'}`;
    }
    case 'Voided':
      switch (reason) {
        case 'Equality':
          return `The price at the end was exactly the price at the start, to the last decimal. `
               + `Nobody was right, so your shot was returned.`;
        case 'ConfidenceBand':
          return `The oracle's own error bar was wider than the move, so the chain refused to call it. `
               + `Your shot was returned.`;
        case 'EntryExpired':
        case 'ExitExpired':
          return `No oracle price arrived in time for the ${reason === 'EntryExpired' ? 'start' : 'end'} of `
               + `your window, so there is nothing to settle against. Your shot was returned.`;
        case 'EntryAmbiguous':
        case 'ExitAmbiguous':
          // Unreachable under MIN-CAPTURE: (publish_time, posted_slot,
          // message_hash) is a total order, so there is always exactly one
          // minimum. If it appears anyway, say so instead of explaining it away.
          return `This shot reports a state the current rules cannot produce (${reason}). Please report it.`;
        default:
          return `Your shot was returned, and the reason recorded on chain is ${reason ?? shot.voidReason}.`;
      }
    case 'Forfeited': {
      const by = clock(shot.revealDeadlineTs);
      return `The guess was never revealed${by ? ` before ${by} UTC` : ''}, so it was forfeited.`;
    }
    case 'PendingEntry':
      return `Waiting for the first price at ${clock(shot.entryTargetTs) ?? 'the entry target'} UTC.`;
    case 'Active':
      return `Running. It settles on the price at ${clock(shot.exitTargetTs) ?? 'the exit target'} UTC.`;
    case 'AwaitReveal': {
      const by = clock(shot.revealDeadlineTs);
      return `Settled. Reveal your guess${by ? ` before ${by} UTC` : ''} to score it.`;
    }
    case 'AwaitVoid':
      return `This shot is being returned; the void has not been finalised yet.`;
    default:
      return `This shot reports state ${shot.state}, which the current rules cannot produce. Please report it.`;
  }
}

// THE SAVED GAME. Not a screenshot and not our server's record: the tuple a
// stranger re-verifies with, plus the cluster and the command.
export function saveGame(shot, { cluster, coreProgramId, timepinProgramId, shotAddress, feed = null } = {}) {
  const missing = [];
  for (const [k, v] of Object.entries({ cluster, coreProgramId, timepinProgramId, shotAddress })) {
    if (!v) missing.push(k);
  }
  if (missing.length) {
    // A saved game that cannot say which chain it came from is worth nothing, and
    // one with a field we filled in ourselves is worse than nothing.
    throw new Error(`a saved game needs ${missing.join(', ')}: without them nobody can re-verify it, `
      + 'and a record that cannot be re-verified should not be offered as proof');
  }
  return jsonSafe({
    format: 'ratchetx-g2-shot',
    format_version: 1,
    verify: {
      cluster,
      command: `solana account ${shotAddress} --url ${cluster.rpc} --output json`,
      note: 'This is a saved account snapshot. The command reads its current state, which may change or close. It does not replay the economics or prove the historical snapshot.',
    },
    programs: { core: coreProgramId, timepin: timepinProgramId },
    shot: shotAddress,
    feed,
    economy_hash: shot.economyHash ?? null,
    ruleset_hash: shot.rulesetHash ?? null,
    player: shot.player ?? null,
    nonce: shot.nonce != null ? String(shot.nonce) : null,
    commit: shot.commit ?? null,
    revealed_salt: shot.revealedSalt ?? null,
    entry: {
      target_ts: shot.entryTargetTs ?? null, need: shot.entryNeed ?? null,
      message_hash: shot.entryMessageHash ?? null, timepin_result_hash: shot.entryTimepinResultHash ?? null,
      price: shot.entryPrice != null ? String(shot.entryPrice) : null,
      conf: shot.entryConf != null ? String(shot.entryConf) : null,
      exponent: shot.entryExponent ?? null, publish_time: shot.entryPublishTime ?? null,
    },
    exit: {
      target_ts: shot.exitTargetTs ?? null, need: shot.exitNeed ?? null,
      message_hash: shot.exitMessageHash ?? null, timepin_result_hash: shot.exitTimepinResultHash ?? null,
      price: shot.exitPrice != null ? String(shot.exitPrice) : null,
      conf: shot.exitConf != null ? String(shot.exitConf) : null,
      exponent: shot.exitExponent ?? null, publish_time: shot.exitPublishTime ?? null,
    },
    call: { side: shot.side ?? null, p_bps: shot.pBps ?? null },
    outcome: {
      state: SHOT_STATE[Number(shot.state)] ?? `unknown(${shot.state})`,
      void_reason: VOID_REASON[Number(shot.voidReason ?? 0)] ?? `unknown(${shot.voidReason})`,
      outcome_yes: shot.outcomeYes ?? null, hit: shot.hit ?? null,
      xp_awarded: shot.xpAwarded != null ? String(shot.xpAwarded) : null,
    },
    settlement: {
      resolver: shot.resolver ?? null, settled_ts: shot.settledTs ?? null,
      resolution_slot: shot.resolutionSlot != null ? String(shot.resolutionSlot) : null,
    },
    seals: { resolution_hash: shot.resolutionHash ?? null, terminal_hash: shot.terminalHash ?? null },
    sentence: sentenceFor(shot, { feed: feed || 'the price' }),
  });
}


// Decimal strings for exact integers; hex for byte arrays; base58 for PublicKeys.
function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

export function sentenceForResult(snapshot, options = {}) {
  if (snapshot?.kind === 'account') {
    const shot = snapshot.shot, spec = options.evidenceSpec;
    if ([1, 2].includes(shot.state) && spec?.specHash && snapshot.ruleset?.args?.evidenceSpecHash &&
        spec.specHash.every((b, i) => b === snapshot.ruleset.args.evidenceSpecHash[i])) {
      const delay = BigInt(spec.args.maxPostTargetLagSeconds) + BigInt(spec.args.captureGraceSeconds);
      const entryEnd = clock(shot.entryTargetTs + delay), exitEnd = clock(shot.exitTargetTs + delay);
      return shot.state === 1 ? `Your call is sealed. Entry price certification can finish after ${entryEnd} UTC; the exit evidence window closes at ${exitEnd} UTC. Settlement follows when both prices are certified.` :
        `The entry price is certified. The exit evidence window closes at ${exitEnd} UTC; settlement can follow after that.`;
    }
    return sentenceFor(shot, options);
  }
  if (snapshot?.kind !== 'archive') return 'No live account or matching terminal receipt is available for this shot.';
  const result = snapshot.receipt.event.result;
  if (result.state === 4) return `You revealed ${side(result.side)} on ${options.feed || 'this market'}. The compact receipt records the call; prices and the score are not included.`;
  return sentenceFor(result, options);
}

export function saveReaderResult(snapshot, { rpc = 'https://api.devnet.solana.com', feed = null } = {}) {
  if (!snapshot?.checks?.accountIdentity || !snapshot.cluster?.genesisHash ||
      !snapshot.addresses?.core || !snapshot.addresses?.timepin || !snapshot.addresses?.shot)
    throw new Error('A saved record requires validated chain identities');
  // Inspection commands accept only a literal HTTPS endpoint; no shell content.
  const endpoint = new URL(rpc);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || /[^A-Za-z0-9:/._?=&%-]/.test(rpc))
    throw new Error('An explicit public HTTPS RPC is required');
  const meta = { cluster: { ...snapshot.cluster, rpc }, coreProgramId: snapshot.addresses.core,
    timepinProgramId: snapshot.addresses.timepin, shotAddress: snapshot.addresses.shot, feed };
  if (snapshot.kind === 'account') return jsonSafe({ ...saveGame(snapshot.shot, meta),
    readSlot: snapshot.slot, rawAccountHex: snapshot.rawAccount,
    checks: snapshot.checks, addresses: snapshot.addresses });
  if (snapshot.kind !== 'archive' || snapshot.checks.logProvenance !== true)
    throw new Error('A missing Shot is not a terminal receipt');
  const signature = snapshot.receipt.transaction.signature;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new Error('Invalid terminal signature');
  return jsonSafe({ format: 'ratchetx-g2-archive', format_version: 1,
    verify: { cluster: meta.cluster, command: `solana confirm ${signature} --url ${rpc} --verbose --output json`,
      note: 'This command inspects the terminal transaction. Core log provenance was checked; economics and the HistoryPage commitment were not replayed. The Shot account is closed.' },
    programs: { core: meta.coreProgramId, timepin: meta.timepinProgramId },
    shot: meta.shotAddress, feed, readSlot: snapshot.slot, checks: snapshot.checks,
    transaction: snapshot.receipt.transaction, provenance: snapshot.receipt.provenance,
    archive: snapshot.receipt.event,
    omitted: ['entry and exit price/confidence/exponent/publish time', 'hit and XP', 'revealed salt', 'resolver and resolution slot'],
    sentence: sentenceForResult(snapshot, { feed: feed || 'this market' }) });
}
