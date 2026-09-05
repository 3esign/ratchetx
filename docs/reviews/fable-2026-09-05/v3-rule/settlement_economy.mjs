// Settlement economy bound to the ACTUAL Core G2 / Timepin v2 ledger (Sol 05:04Z, 05:39Z).
// Source facts this model encodes, each read from the laptop's own tree:
//   ratchet-core-g2/src/state.rs:82-83   MIN_CLEANUP_BOND_LAMPORTS = 5_000, MAX = 1_000_000
//   ratchet-core-g2/src/lib.rs:3666      deposit_cleanup_bond: player -> Shot account, at open
//   ratchet-core-g2/src/lib.rs:3729-3730 archive: shot.sub_lamports(bond); actor.add_lamports(bond)
//   ratchet-core-g2/src/lib.rs:3741-3757 archive_funding_plan: bond is NEVER consumed by realloc;
//                                        any rent shortfall beyond the shot's surplus is the ACTOR's to pay
//   rcx-timepin-v2/src/lib.rs:359-372    TimepinNeedV2 has NO lamport field and NO submitter field
//   rcx-timepin-v2/src/lifecycle.rs:774  the ONLY lamport transfer in Timepin is fund_rent_growth
// => exactly one funded role exists today (archiving), and it is funded by the player, at open, in escrow.
//    Opening a Need, posting PNAU evidence, capturing, finalizing and expiring are ALL unfunded.
export const LEDGER = Object.freeze({
  MIN_CLEANUP_BOND: 5_000, MAX_CLEANUP_BOND: 1_000_000,
  MIN_STAKE: 100, MAX_STAKE: 1_000_000_000,
  HIT_NUM: 17, HIT_DEN: 10,
  SIGNATURE_FEE: 5_000,
});
/** Cost, in lamports, of one keyless PNAU posting for one (feed, target). Transient rent is reclaimed on close. */
export function postingCost({ transactions = 5, priority = 0 } = {}) {
  return transactions * LEDGER.SIGNATURE_FEE + priority;
}
export const archiveCost = () => LEDGER.SIGNATURE_FEE;

/** A shot escrows its bond into its own account at open, exactly as deposit_cleanup_bond does. */
export function openShot({ player, stake, bond, split = { archive: 1, settlement: 0 } }) {
  if (!(bond >= LEDGER.MIN_CLEANUP_BOND && bond <= LEDGER.MAX_CLEANUP_BOND)) throw new Error('BOND_OUT_OF_RANGE');
  if (!(stake >= LEDGER.MIN_STAKE && stake <= LEDGER.MAX_STAKE)) throw new Error('STAKE_OUT_OF_RANGE');
  const total = split.archive + split.settlement;
  const settlement = Math.floor(bond * split.settlement / total);
  return { player, stake, bond, escrow: bond, archiveBond: bond - settlement, settlementBond: settlement,
    payout: Math.floor(stake * LEDGER.HIT_NUM / LEDGER.HIT_DEN), state: 'OPEN', paid: [] };
}
/** The whole world's lamports, so conservation can be asserted rather than assumed. */
export function ledgerTotals(shots, actors) {
  const escrowed = shots.reduce((s, x) => s + x.escrow, 0);
  const paid = shots.reduce((s, x) => s + x.paid.reduce((a, p) => a + p.lamports, 0), 0);
  const held = Object.values(actors).reduce((a, b) => a + b, 0);
  return { escrowed, paid, held };
}
function pay(shot, to, lamports, kind, actors) {
  if (lamports > shot.escrow) throw new Error('ESCROW_EXHAUSTED');   // the program can never mint
  shot.escrow -= lamports;
  shot.paid.push({ to, lamports, kind });
  actors[to] = (actors[to] || 0) + lamports;
}
/**
 * Settle a Need shared by many shots. `submitter` is whoever posted the winning evidence (null = nobody posted).
 * Under the PROPOSED wire, each shot pays its settlementBond to that submitter at settle time; today that wire
 * does not exist (settlement split is 0) and the submitter is paid nothing.
 */
export function settleNeed({ shots, submitter, archiver, actors, voidOnSilence = true }) {
  const settled = submitter !== null;
  for (const shot of shots) {
    if (settled && shot.settlementBond > 0) pay(shot, submitter, shot.settlementBond, 'SETTLEMENT', actors);
    shot.state = settled ? 'FINAL' : (voidOnSilence ? 'VOID' : 'OPEN');
    if (shot.state !== 'OPEN') pay(shot, archiver, shot.archiveBond, 'ARCHIVE', actors);   // paid either way
  }
  return { settled, state: shots[0] && shots[0].state };
}
/** Profit of an independent poster serving k shots on one (feed, target). */
export function posterProfit({ shots, cost }) {
  return shots.reduce((s, x) => s + x.settlementBond, 0) - cost;
}
/** Smallest k at which posting pays for itself. Infinity when the settlement wire is absent. */
export function breakEvenShots({ settlementBond, cost }) {
  return settlementBond > 0 ? Math.ceil(cost / settlementBond) : Infinity;
}
/** What a party with money on the shot gains by staying silent, under VOID+refund. */
export function silenceGain({ shot, role, wouldWin }) {
  if (role === 'counterparty') return wouldWin ? 0 : shot.payout - shot.stake;   // it avoids paying the win
  if (role === 'player') return wouldWin ? 0 : shot.stake;                       // it recovers its lost stake
  if (role === 'archiver') return 0;                                             // bond is paid on VOID too
  if (role === 'third-party') return 0;
  throw new Error('unknown role');
}
