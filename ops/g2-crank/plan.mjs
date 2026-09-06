#!/usr/bin/env node
// A decided action becomes an addressed instruction.
//
// decide.mjs says WHAT to crank. This says WHERE every account comes from, and
// it is the layer where an account-name mistake would live - the mistake that
// produces "account index 7" from a validator and nothing anybody can act on.
//
// So the sources are DATA, not code, and test_crank_plan.mjs asserts that every
// account the program declares has a source and that no source names an account
// the program does not take. A gap fails here rather than on chain.
//
// Sources:
//   actor    - the crank's own signer, who pays fees and is refunded nothing
//   subject  - the need or shot this action is about
//   derived  - a PDA the client computes from the subject
//   context  - an address the caller already holds (economy, ruleset, spec)
//   const    - a fixed program id
import { INSTRUCTION_ACCOUNTS } from '../../onchain/ratchet-core-g2/client/client-v2.mjs';

export const SOURCES = Object.freeze({
  'rcx-timepin-v2': {
    finalize: { actor: 'actor', evidence_spec: 'context.evidenceSpec', need: 'subject.need',
                candidate: 'derived.candidateA', work_page: 'context.workPage' },
    expire:   { actor: 'actor', evidence_spec: 'context.evidenceSpec', need: 'subject.need',
                work_page: 'context.workPage' },
  },
  'ratchet-core-g2': {
    settle_final: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', work_page: 'context.workPage',
      player_day: 'derived.playerDay', rank_shard: 'derived.rankShard',
      evidence_spec: 'context.evidenceSpec', exit_need: 'derived.exitNeed',
      exit_candidate: 'derived.exitCandidate',
    },
    activate_entry: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', work_page: 'context.workPage',
      evidence_spec: 'context.evidenceSpec', entry_need: 'derived.entryNeed',
      entry_candidate: 'derived.entryCandidate',
    },
    forfeit: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', player_day: 'derived.playerDay',
      rank_shard: 'derived.rankShard', history_page: 'derived.historyPage',
      work_page: 'context.workPage', rent_refund: 'subject.rentRefund',
      system_program: 'const.systemProgram',
    },
    void_active_shot: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', player_day: 'derived.playerDay',
      rank_shard: 'derived.rankShard', history_page: 'derived.historyPage',
      work_page: 'context.workPage', rent_refund: 'subject.rentRefund',
      exit_need: 'derived.exitNeed', system_program: 'const.systemProgram',
    },
    void_pending_entry: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', player_day: 'derived.playerDay',
      rank_shard: 'derived.rankShard', history_page: 'derived.historyPage',
      work_page: 'context.workPage', rent_refund: 'subject.rentRefund',
      entry_need: 'derived.entryNeed', system_program: 'const.systemProgram',
    },
    finalize_resolved_void: {
      actor: 'actor', economy: 'context.economy', ruleset: 'context.ruleset',
      ledger: 'derived.ledger', shot: 'subject.shot', player_day: 'derived.playerDay',
      rank_shard: 'derived.rankShard', history_page: 'derived.historyPage',
      work_page: 'context.workPage', rent_refund: 'subject.rentRefund',
      system_program: 'const.systemProgram',
    },
  },
});

// The actions decide.mjs can emit that this file does not yet address. Named
// rather than omitted: capture_first and capture_conflict need a Pyth price
// update account chosen by publish_time, which is a different problem from
// addressing accounts, and pretending otherwise would produce a crank that
// silently never captures.
export const NOT_YET_PLANNED = Object.freeze(['capture_first', 'capture_conflict']);

export function planAction(action, resolve) {
  const crate = action.crate;
  const table = SOURCES[crate];
  if (!table) throw new TypeError(`no account sources for crate ${crate}`);
  const sources = table[action.action];
  if (!sources) {
    if (NOT_YET_PLANNED.includes(action.action))
      throw new TypeError(`${action.action} is decided but not yet addressable: it needs a Pyth price `
        + 'update account selected by publish_time. Named in NOT_YET_PLANNED rather than silently skipped.');
    throw new TypeError(`no account sources for ${crate}.${action.action}`);
  }
  const declared = INSTRUCTION_ACCOUNTS[crate][action.action].accounts.map(a => a.name);
  const addresses = {};
  for (const name of declared) {
    const source = sources[name];
    if (!source) throw new TypeError(`${crate}.${action.action} declares ${name} and no source names it`);
    const value = resolve(source, action);
    if (!value) throw new TypeError(`${crate}.${action.action}: source ${source} for ${name} resolved to nothing`);
    addresses[name] = value;
  }
  return { crate, instruction: action.action, addresses, why: action.why, subject: action.subject };
}
