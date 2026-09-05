// node --test test_settlement_economy.mjs — adversarial spec for the settlement economy, bound to the real ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER, postingCost, archiveCost, openShot, settleNeed, ledgerTotals,
  posterProfit, breakEvenShots, silenceGain } from './settlement_economy.mjs';

const TODAY = { archive: 1, settlement: 0 };          // the wire that exists in source today
const WIRED = { archive: 1, settlement: 2 };          // proposed split of the SAME player-funded bond
const mk = (n, { bond = 300_000, stake = 10_000_000, split = WIRED } = {}) =>
  Array.from({ length: n }, (_, i) => openShot({ player: 'p' + i, stake, bond, split }));

test('E1 SOLVENCY: every lamport paid out was escrowed by the player at open — the program can never mint, and escrow never goes negative', () => {
  for (const split of [TODAY, WIRED]) {
    const shots = mk(5, { split }); const actors = {};
    const before = ledgerTotals(shots, actors);
    settleNeed({ shots, submitter: 'poster', archiver: 'archiver', actors });
    const after = ledgerTotals(shots, actors);
    assert.equal(before.escrowed, after.escrowed + after.paid, 'escrow decreases by exactly what was paid');
    assert.equal(after.paid, after.held, 'every paid lamport landed in an actor balance');
    for (const s of shots) assert.ok(s.escrow >= 0);
    assert.ok(after.paid <= before.escrowed, 'payouts never exceed what was pre-funded');
  }
});

test('E2 no house purse is ever touched: paying more than the escrow is refused, not borrowed', () => {
  const shots = mk(1, { bond: LEDGER.MIN_CLEANUP_BOND, split: WIRED }); const actors = {};
  settleNeed({ shots, submitter: 'poster', archiver: 'archiver', actors });
  const s = shots[0];
  assert.equal(s.escrow, 0);
  assert.equal(s.paid.reduce((a, p) => a + p.lamports, 0), LEDGER.MIN_CLEANUP_BOND);
  assert.throws(() => settleNeed({ shots: [s], submitter: 'poster2', archiver: 'a2', actors }), /ESCROW_EXHAUSTED/);
});

test('E3 TODAY the poster is paid NOTHING: with the source-accurate wire, posting is a pure loss at every k', () => {
  const cost = postingCost({ priority: 20_000 });
  for (const k of [1, 5, 50, 500]) {
    const shots = mk(k, { split: TODAY }); const actors = {};
    settleNeed({ shots, submitter: 'poster', archiver: 'archiver', actors });
    assert.equal(actors.poster, undefined, 'no ledger path pays the submitter');
    assert.equal(posterProfit({ shots, cost }), -cost);
  }
  assert.equal(breakEvenShots({ settlementBond: 0, cost }), Infinity);
});

test('E4 with the proposed split the poster breaks even at a computable k, and one posting serves every shot on the target', () => {
  const cost = postingCost({ priority: 20_000 });          // 5 signatures + priority = 45,000 lamports
  assert.equal(cost, 45_000);
  const bond = 300_000, settlementBond = Math.floor(bond * 2 / 3);   // 200,000
  assert.equal(breakEvenShots({ settlementBond, cost }), 1, 'a single shot already pays for the posting');
  const shots = mk(3, { bond }); const actors = {};
  settleNeed({ shots, submitter: 'poster', archiver: 'archiver', actors });
  assert.equal(actors.poster, 3 * settlementBond, 'k shots pay k bonds to the ONE poster that served them all');
  assert.equal(posterProfit({ shots, cost }), 3 * settlementBond - cost);
  // at the on-chain minimum bond the same posting needs many shots
  assert.equal(breakEvenShots({ settlementBond: Math.floor(LEDGER.MIN_CLEANUP_BOND * 2 / 3), cost }), 14);
});

test('E5 THE MIN-STAKE INCOHERENCE: at the manifest minimum stake the fee needed to attract a poster is orders of magnitude larger than the bet', () => {
  const cost = postingCost({ priority: 20_000 });
  assert.equal(LEDGER.MIN_STAKE, 100);
  // to make a lone shot worth posting, its settlement bond must cover the whole cost
  const neededBond = cost;
  assert.ok(neededBond / LEDGER.MIN_STAKE > 400, `bond/stake ratio at min stake is ${neededBond / LEDGER.MIN_STAKE}x`);
  // the stake at which that bond is at most 1% of the bet
  const viableStake = neededBond * 100;
  assert.equal(viableStake, 4_500_000);
  assert.ok(viableStake > LEDGER.MIN_STAKE * 10_000);
  // and openShot still happily accepts the incoherent combination — nothing on chain forbids it
  assert.doesNotThrow(() => openShot({ player: 'p', stake: LEDGER.MIN_STAKE, bond: 1_000_000, split: WIRED }));
});

test('E6 the archiver is paid on VOID exactly as on FINAL, so archiving is not a settlement incentive', () => {
  const settled = mk(2); const a1 = {};
  settleNeed({ shots: settled, submitter: 'poster', archiver: 'arch', actors: a1 });
  const voided = mk(2); const a2 = {};
  settleNeed({ shots: voided, submitter: null, archiver: 'arch', actors: a2 });
  assert.equal(a1.arch, a2.arch, 'the archive bounty is identical whether the price was posted or not');
  assert.equal(a2.poster, undefined);
  assert.equal(voided[0].state, 'VOID');
  assert.equal(silenceGain({ shot: voided[0], role: 'archiver', wouldWin: false }), 0);
});

test('E7 WHO GAINS FROM SILENCE, with real amounts: the losing side of every shot, and nobody else', () => {
  const shot = openShot({ player: 'p', stake: 10_000_000, bond: 300_000, split: WIRED });
  assert.equal(shot.payout, 17_000_000);
  // the counterparty that is about to lose keeps payout - stake by staying silent
  assert.equal(silenceGain({ shot, role: 'counterparty', wouldWin: false }), 7_000_000);
  // a player about to lose recovers the stake
  assert.equal(silenceGain({ shot, role: 'player', wouldWin: false }), 10_000_000);
  // the winning side gains nothing by silence, and third parties never do
  assert.equal(silenceGain({ shot, role: 'counterparty', wouldWin: true }), 0);
  assert.equal(silenceGain({ shot, role: 'third-party', wouldWin: false }), 0);
  // the decisive comparison: silence is worth millions to the losing side, while breaking it earns 200,000.
  // Silence is defeated NOT by outbidding it but by the fact that a third party profits at all.
  const posterEarns = shot.settlementBond;
  assert.ok(silenceGain({ shot, role: 'player', wouldWin: false }) > posterEarns * 40);
  assert.ok(posterEarns > postingCost({ priority: 20_000 }), 'a disinterested third party still profits, which is what defeats silence');
});

test('E8 adversarial: a losing counterparty that also runs the only crank wins by withholding; adding ONE profitable independent poster removes the gain entirely', () => {
  const cost = postingCost({ priority: 20_000 });
  const shots = mk(1, { bond: 300_000 });
  // world A: the only party able to post is the one that loses by posting
  const a = {}; settleNeed({ shots: mk(1, { bond: 300_000 }), submitter: null, archiver: 'arch', actors: a });
  // world B: an independent poster exists and is profitable
  const b = {}; const shotsB = mk(1, { bond: 300_000 });
  settleNeed({ shots: shotsB, submitter: 'independent', archiver: 'arch', actors: b });
  assert.equal(a.independent, undefined);
  assert.equal(b.independent, shotsB[0].settlementBond);
  assert.ok(posterProfit({ shots: shotsB, cost }) > 0, 'the independent poster is not doing charity');
  assert.equal(shotsB[0].state, 'FINAL');
});
