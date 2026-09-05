// The cost model is only worth having if its numbers are the PROGRAM's numbers.
// Every account size it prints is lifted from lib.rs by evaluating the program's
// own SIZE expression, so this checks the lifting works, that the rent formula
// is Solana's and not an approximation of it, and that the demand-driven crank
// claim -- the one the self-funding argument rests on -- actually holds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountSizes, rentExempt, model, crank, bounty, readComputeUnits, priorityFee,
  LAMPORTS_PER_BYTE_YEAR, ACCOUNT_STORAGE_OVERHEAD, EXEMPTION_THRESHOLD,
  SIGNATURE_FEE, SHOT_LIFECYCLE } from '../tools/onchain_cost.mjs';

let checks = 0;
const rust = readFileSync(new URL('../onchain/ratchet-core/programs/ratchet-core/src/lib.rs', import.meta.url), 'utf8');
const { sizes, consts } = accountSizes(rust);

// ---- 1. the sizes are the program's, evaluated not retyped ---------------
{
  checks++; assert.equal(LAMPORTS_PER_BYTE_YEAR, 3480,
    "Solana's own DEFAULT_LAMPORTS_PER_BYTE_YEAR: 1 SOL per MB-year over 100");
  checks++; assert.equal(ACCOUNT_STORAGE_OVERHEAD, 128);
  checks++; assert.equal(EXEMPTION_THRESHOLD, 2);
  checks++; assert.equal(rentExempt(0), 128 * 3480 * 2,
    'an empty account still pays for its 128 bytes of metadata');

  // CrankPurse was added by `c42baf8` and REVERTED by `70de57e`, which touched
  // only lib.rs -- this list, added separately in `95391fb`, kept demanding a
  // struct the revert had deliberately removed, so the release gate has been
  // red on a design decision that was already taken. The decision register says
  // so in as many words (docs/PERMANENCE_EXECUTION_PLAN.md:1083: "Historical
  // c42baf8 CrankPurse is rejected and reverted by 70de57e"). This completes
  // that revert rather than reopening it. Anything reinstating a purse must add
  // the name back here in the same commit as the Rust.
  for (const name of ['Shot', 'PlayerLedger', 'Podium', 'FeedClock', 'LegacyClaim'])
    { checks++; assert.ok(sizes[name], name + ' must be found in lib.rs'); }

  // The discriminator is not decoration: Anchor's `space = 8 + X::SIZE` is what
  // is actually allocated, so a model that costed X::SIZE would under-report
  // every account by 8 bytes.
  for (const [name, s] of Object.entries(sizes)) {
    checks++; assert.equal(s.onChain, s.data + 8, name + ' is costed WITH its discriminator');
    checks++; assert.ok(rust.includes(`space = 8 + ${name}::SIZE`),
      `lib.rs must actually allocate ${name} as 8 + SIZE, or this model is costing a layout the program does not use`);
  }
}

// ---- 2. arithmetic only; a SIZE it cannot evaluate must throw --------------
// A model that silently guessed at an expression it did not understand would be
// worse than one that stops.
{
  checks++; assert.throws(() => accountSizes('impl X { pub const SIZE: usize = MYSTERY_CONST + 4; }'),
    /UNKNOWN_CONSTANT/, 'an unknown constant is refused, not assumed');
  checks++; assert.throws(() => accountSizes('impl X { pub const SIZE: usize = foo(3); }'),
    /NON_ARITHMETIC|UNKNOWN/, 'a function call is refused, not evaluated');
  checks++; assert.throws(() => accountSizes('// nothing here'), /NO_SIZES_FOUND/,
    'an empty read is an error, never a cost table of zero');

  // A comment inside a const expression is ordinary Rust, and the first one
  // anybody wrote made this refuse a size it could have computed. Refusing was
  // right; refusing something VALID is a bug in the reader.
  const commented = accountSizes(`impl X { pub const SIZE: usize =
      8 + 4   // the discriminator and a counter
      + 2; }`);
  checks++; assert.equal(commented.sizes.X.data, 14, 'a commented SIZE expression still evaluates');
}

// ---- 3. locked vs spent are different kinds of money ----------------------
// Rent is a refundable deposit; fees are gone. A model that added them would
// make the game look ~130x more expensive than it is.
{
  const m = model({ sizes, players: 1000, openShotsEach: 3 });
  checks++; assert.ok(m.totalLocked > m.totalSpentPerCycle * 100,
    'rent dominates fees by orders of magnitude — which is why conflating them would mislead');
  checks++; assert.equal(m.feesPerShot, SHOT_LIFECYCLE.length * SIGNATURE_FEE,
    'one signature per lifecycle transaction, priced at the network fee');
  checks++; assert.equal(SHOT_LIFECYCLE.length, 4, 'seal, settle, reveal, close_shot');
  for (const s of SHOT_LIFECYCLE) {
    checks++; assert.ok(new RegExp(`pub fn ${s.ix}\\b`).test(rust) || new RegExp(`fn ${s.ix}\\b`).test(rust),
      `${s.ix} must be a real instruction in lib.rs — a lifecycle step the program does not have is a cost that is not real`);
  }
  // Scaling is linear in players, which is the claim the table makes.
  const one = model({ sizes, players: 1, openShotsEach: 3 });
  const hundred = model({ sizes, players: 100, openShotsEach: 3 });
  checks++; assert.equal(hundred.totalLocked - hundred.sharedLocked,
    100 * (one.totalLocked - one.sharedLocked),
    'per-player rent scales exactly linearly; only the shared accounts are amortised');
}

// ---- 4. THE claim the self-funding argument rests on ----------------------
// If checkpoints did NOT amortise across shots, the crank would be a fixed
// daily bill and no per-seal levy could carry it at low volume. Everything in
// docs/ONCHAIN_COST.md depends on this being true.
{
  const horizons = [5,10,15,30,60,360,1440];
  const args = { capacity: consts.CLOCK_CAPACITY, feeds: 7, publishIntervalS: 60, horizonsMin: horizons };
  const ceiling = crank({ ...args, shotsPerDay: 0 });
  const small = crank({ ...args, shotsPerDay: 3 });
  const big   = crank({ ...args, shotsPerDay: 30000 });

  checks++; assert.equal(ceiling.txPerDay, 7 * 1440, 'the ceiling is every feed every minute');
  checks++; assert.ok(small.txPerDay < ceiling.txPerDay / 100,
    'at one player the crank is a handful of calls, not the ceiling');
  checks++; assert.ok(big.txPerDay <= ceiling.ceilingTx,
    'and it can never exceed the ceiling no matter how many play');
  checks++; assert.ok(big.checkpointsPerShot < small.checkpointsPerShot,
    'THE PROPERTY: checkpoints per shot FALL as volume rises, because one checkpoint settles every shot expiring in that publish interval');

  const bSmall = bounty({ crankResult: small, shotsPerDay: 3 });
  const bBig   = bounty({ crankResult: big, shotsPerDay: 30000 });
  checks++; assert.ok(bBig.perSeal < bSmall.perSeal,
    'so the levy a seal must carry falls with adoption rather than rising');
  checks++; assert.ok(bSmall.perCall > SIGNATURE_FEE,
    'a bounty at or below the fee pays nobody to crank — it must beat break-even or it is charity with extra steps');
  checks++; assert.ok(bBig.perSeal < bBig.ownLifecycleFees,
    'and at scale the levy is smaller than what the player already spends on their own shot');

  // The ring cannot cover the long horizons, which is WHY bind_crossing exists.
  checks++; assert.deepEqual(ceiling.outrunHorizons, [360, 1440],
    'the 6h and 24h horizons outrun a 64-deep ring on a 60s heartbeat — the case bind_crossing was built for');
  checks++; assert.equal(ceiling.coverageMin, consts.CLOCK_CAPACITY,
    'coverage in minutes equals ring capacity at a 60s heartbeat');
}

// ---- 5. no invented numbers ----------------------------------------------
// G4 says: no assumed rent reduction, no zero operating cost, no guessed
// SOL/USD. The tool must not print a compute-unit or dollar figure at all.
{
  const src = readFileSync(new URL('../tools/onchain_cost.mjs', import.meta.url), 'utf8');
  checks++; assert.ok(!/\$\s?\d/.test(src), 'no dollar figures — a SOL/USD guess is exactly what G4 forbids');
  checks++; assert.ok(/UNMEASURED|NOT MEASURED/.test(src),
    'compute units must be reported as unmeasured rather than estimated');
  checks++; assert.ok(!/computeUnits\s*=\s*\d/.test(src),
    'no hardcoded CU count — that number requires a real transaction on a real cluster');
}

// ---- 6. the compute-unit loop, and what it refuses ------------------------
// The only G4 number that cannot come from source is compute, and
// mainnet-exercise.mjs already had it and printed it away. --cu-out now records
// it and this reads it back. A CU figure without the program and cluster it
// came from is a number about nothing, so provenance is required rather than
// preferred.
{
  const good = { schema:'ratchetx-compute-units-v1', program:'P', cluster:'C',
    measuredAt:'2026-09-03T00:00:00.000Z', dry:true, units:{ seal:48900, settle:41100 } };
  checks++; assert.equal(readComputeUnits(good).units.seal, 48900, 'a well-formed report reads back');
  checks++; assert.equal(readComputeUnits(JSON.stringify(good)).units.settle, 41100, 'and parses from text');

  checks++; assert.throws(() => readComputeUnits({ schema:'something-else' }), /NOT_A_CU_REPORT/,
    'a file that is not a CU report is refused, never coerced');
  checks++; assert.throws(() => readComputeUnits({ ...good, program:undefined }), /PROVENANCE/,
    'no program id, no measurement — CU differs per program');
  checks++; assert.throws(() => readComputeUnits({ ...good, cluster:undefined }), /PROVENANCE/,
    'no cluster either');
  checks++; assert.throws(() => readComputeUnits({ ...good, units:{} }), /EMPTY/,
    'an empty report is an error, not a cost of zero');
  checks++; assert.throws(() => readComputeUnits({ ...good, units:{ seal:0, settle:0 } }), /ALL_ZERO/,
    'a simulation that consumed nothing did not run');

  // Solana's compute-budget arithmetic, not an approximation of it.
  checks++; assert.equal(priorityFee(1_000_000, 1), 1, 'a million CU at 1 microlamport/CU is 1 lamport');
  checks++; assert.equal(priorityFee(48_900, 1000), 49, 'rounds UP — a fee that rounds down is a fee that fails');
  checks++; assert.equal(priorityFee(1, 1), 1, 'and never rounds a real cost to zero');

  // The exercise must actually write what this reads, or the loop is imaginary.
  const ex = readFileSync(new URL('../tools/mainnet-exercise.mjs', import.meta.url), 'utf8');
  checks++; assert.match(ex, /ratchetx-compute-units-v1/,
    'mainnet-exercise.mjs must emit the schema onchain_cost.mjs demands');
  checks++; assert.match(ex, /unitsConsumed/, 'and must take the number from the simulation itself');
  checks++; assert.match(ex, /cuMeasured\[name\] = units/, 'recording every simulated instruction, not just the last');
  for (const field of ['program:', 'cluster:', 'measuredAt:'])
    { checks++; assert.ok(ex.includes(field), 'the report must carry ' + field + ' or it will be refused on read'); }
  checks++; assert.ok(/--dry/.test(ex) && /if \(DRY\) return null/.test(ex),
    'the measurement must be available under --dry, which sends nothing and spends nothing');
}

console.log(`PASS  onchain cost: ${checks} checks — sizes lifted from lib.rs, rent is Solana's formula, and checkpoints amortise (the claim self-funding rests on)`);
