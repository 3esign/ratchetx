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
  const value = Number(raw) * Math.pow(10, Number(exponent));
  const decimals = Math.min(8, Math.max(2, -Number(exponent) - 2));
  return value.toFixed(decimals);
}

const clock = ts => (ts === null || ts === undefined
  ? null
  : new Date(Number(ts) * 1000).toISOString().slice(11, 19));

const side = s => (Number(s) === 1 ? 'DOWN' : 'UP');

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
      return `${call}${move} ${Number(shot.hit) === 1 ? 'You were right.' : 'You were wrong.'}`;
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
  return {
    format: 'ratchetx-g2-shot',
    format_version: 1,
    verify: {
      cluster,
      command: `solana account ${shotAddress} --url ${cluster.rpc} --output json`,
      note: 'Every value below is a field of that one account, at a byte offset the program defines. '
          + 'Nothing here came from ratchetx.xyz.',
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
  };
}
