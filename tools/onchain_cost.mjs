// What does this game cost on chain, for 1, 100 and 1,000 players.
//
// G4 in docs/ONCHAIN_MIGRATION_PLAN.md asks for exactly this and calls out how
// to get it wrong: "publish costs for 1, 100 and 1,000 active agents using
// measured actions per agent, not a guessed SOL/USD forecast" and "no assumed
// future transaction-format activation, rent reduction, unlimited public RPC or
// zero operating cost."
//
// Nothing in this repository had a lamports figure of any kind before this file.
// The plan therefore assumed a thousand players was affordable, and the whole
// migration is downstream of that assumption.
//
// WHAT IS EXACT HERE, AND WHAT IS NOT. Two of the three cost components are
// arithmetic over constants that are already compiled into the program, so they
// are exact today and need no devnet:
//
//   rent      = (ACCOUNT_STORAGE_OVERHEAD + bytes) * lamports_per_byte_year
//               * exemption_years.  Every account size comes from lib.rs.
//   base fee  = 5000 lamports per signature. One signature per transaction here.
//
// The third is NOT computable from source and this file refuses to invent it:
//
//   compute units, and therefore any priority fee, need a real transaction on a
//   real cluster. They are reported as UNMEASURED rather than estimated, and
//   `--cu-price` lets a measured number be fed back in once there is one.
//
// The distinction matters because the exact part turns out to dominate, so the
// design question is answerable now rather than after a devnet campaign.
//
//   node tools/onchain_cost.mjs [--players N] [--open-shots N] [--cu-price MICROLAMPORTS]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = new URL('../onchain/ratchet-core/programs/ratchet-core/src/lib.rs', import.meta.url);

// ---------------------------------------------------------------------------
//  Solana's rent constants. Not guesses -- these are the network's own values.
//  ACCOUNT_STORAGE_OVERHEAD is the 128 bytes of metadata every account carries
//  in addition to its data. DEFAULT_LAMPORTS_PER_BYTE_YEAR is derived by the
//  runtime as 1 SOL per MB-year / 100, and DEFAULT_EXEMPTION_THRESHOLD is two
//  years' worth held as a deposit. A rent-exempt balance is LOCKED, not spent:
//  close_shot returns it. That difference is the whole story below.
// ---------------------------------------------------------------------------
export const ACCOUNT_STORAGE_OVERHEAD = 128;
export const LAMPORTS_PER_BYTE_YEAR = Math.floor(((1_000_000_000 / 100) * 365) / (1024 * 1024));
export const EXEMPTION_THRESHOLD = 2;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SIGNATURE_FEE = 5_000;          // lamports, per signature
export const ANCHOR_DISCRIMINATOR = 8;

export const rentExempt = bytes =>
  (ACCOUNT_STORAGE_OVERHEAD + bytes) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_THRESHOLD;

/** Read the account sizes out of lib.rs by evaluating the program's own SIZE
 *  expressions. Restating them here as numbers would make this file a second
 *  copy of a rule -- the thing that put five key families wrong in the Supabase
 *  import -- so the expressions are lifted verbatim and the constants they
 *  reference are read from the same file. */
export function accountSizes(source) {
  const consts = {};
  for (const m of source.matchAll(/pub const ([A-Z_]+): usize = ([0-9_]+);/g))
    consts[m[1]] = Number(m[2].replace(/_/g, ''));

  const sizes = {};
  for (const m of source.matchAll(/impl (\w+) \{\s*pub const SIZE: usize =\s*([^;]+);/g)) {
    const name = m[1];
    const expr = m[2].replace(/\s+/g, ' ').trim();
    // Only arithmetic over integers and the constants just read. Anything else
    // is refused rather than guessed at.
    const resolved = expr.replace(/[A-Z_]{2,}/g, k => {
      if (!(k in consts)) throw new Error(`UNKNOWN_CONSTANT ${k} in ${name}::SIZE`);
      return String(consts[k]);
    });
    if (!/^[0-9 +*()]+$/.test(resolved))
      throw new Error(`NON_ARITHMETIC ${name}::SIZE = ${expr}`);
    sizes[name] = { data: Function(`"use strict";return (${resolved})`)(), expr };
  }
  if (!Object.keys(sizes).length) throw new Error('NO_SIZES_FOUND');
  for (const s of Object.values(sizes)) s.onChain = s.data + ANCHOR_DISCRIMINATOR;
  return { sizes, consts };
}

const sol = lamports => (lamports / LAMPORTS_PER_SOL);
const fmt = lamports => sol(lamports).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');

// ---------------------------------------------------------------------------
//  The model
// ---------------------------------------------------------------------------
/** One shot's full lifecycle in transactions. Every one of these is a real
 *  instruction in lib.rs and somebody signs and pays for each. */
export const SHOT_LIFECYCLE = [
  { ix: 'seal',       who: 'player',  note: 'debits stake, opens the chamber, stores the entry price' },
  { ix: 'settle',     who: 'anyone',  note: 'first crossing in the window; permissionless' },
  { ix: 'reveal',     who: 'anyone with the salt', note: 'scores HIT/MISS, pays, updates XP and podium' },
  { ix: 'close_shot', who: 'anyone',  note: 'returns the Shot rent to the player' },
];

export function model({ sizes, players, openShotsEach, feeds = 7, cuPrice = null }) {
  const shotRent   = rentExempt(sizes.Shot.onChain);
  const ledgerRent = rentExempt(sizes.PlayerLedger.onChain);
  const claimRent  = rentExempt(sizes.LegacyClaim.onChain);
  const clockRent  = rentExempt(sizes.FeedClock.onChain);
  const podiumRent = rentExempt(sizes.Podium.onChain);

  // LOCKED: rent-exempt deposits. Refundable, but unavailable while held.
  const perPlayerLocked = ledgerRent + claimRent + openShotsEach * shotRent;
  const sharedLocked    = feeds * clockRent + podiumRent;
  const totalLocked     = players * perPlayerLocked + sharedLocked;

  // SPENT: transaction fees. Gone for good.
  const feesPerShot = SHOT_LIFECYCLE.length * SIGNATURE_FEE;
  const perPlayerSpentPerCycle = openShotsEach * feesPerShot;
  const totalSpentPerCycle = players * perPlayerSpentPerCycle;

  return { shotRent, ledgerRent, claimRent, clockRent, podiumRent,
    perPlayerLocked, sharedLocked, totalLocked,
    feesPerShot, perPlayerSpentPerCycle, totalSpentPerCycle,
    cuPrice };
}

/** The checkpoint crank, and the property that decides whether this can fund
 *  itself.
 *
 *  A checkpoint is only USEFUL where a shot expires. `settle` wants the unique
 *  update with `prev_publish_time < expiry <= publish_time`, so one checkpoint
 *  covers a whole publish interval's worth of expiries at once -- every shot
 *  expiring in that minute settles off the same observation.
 *
 *  So the crank is not a fixed daily bill. It is
 *
 *      checkpoints/day = min( distinct expiry-minutes that actually have a
 *                             shot in them , 86400 / publishInterval )
 *                        summed over feeds
 *
 *  which is PROPORTIONAL at low volume and CAPPED at high volume. That is the
 *  shape a self-funding fee needs and it is a property of the design as built,
 *  not something added: cost per shot falls as the game grows and can never
 *  exceed the ceiling. The naive reading -- checkpoint every minute forever --
 *  is the ceiling, not the cost.
 *
 *  `shotsPerDay` of 0 asks for the ceiling. */
export function crank({ capacity, feeds, publishIntervalS, horizonsMin, shotsPerDay = 0 }) {
  const coverageS = capacity * publishIntervalS;
  const slotsPerDay = Math.floor(86400 / publishIntervalS);
  const ceilingTx = feeds * slotsPerDay;

  // Expiries land at seal + horizon, so they are spread rather than clustered.
  // With `shotsPerDay` shots scattered over `slotsPerDay` minutes per feed, the
  // number of minutes that contain at least one expiry follows the occupancy of
  // a random allocation: slots * (1 - (1 - 1/slots)^n). Two shots in the same
  // minute share one checkpoint, which is exactly where the saving comes from.
  const perFeed = shotsPerDay > 0 ? shotsPerDay / feeds : 0;
  const occupied = shotsPerDay > 0
    ? slotsPerDay * (1 - Math.pow(1 - 1 / slotsPerDay, perFeed))
    : slotsPerDay;
  const txPerDay = Math.ceil(feeds * occupied);

  return {
    coverageS, coverageMin: coverageS / 60,
    ceilingTx, txPerDay,
    lamportsPerDay: txPerDay * SIGNATURE_FEE,
    ceilingLamportsPerDay: ceilingTx * SIGNATURE_FEE,
    checkpointsPerShot: shotsPerDay > 0 ? txPerDay / shotsPerDay : null,
    outrunHorizons: horizonsMin.filter(m => m * 60 > coverageS),
  };
}

/** What a seal would have to carry to pay for the cranking its own settlement
 *  needs, with the depletion behaviour G4 demands spelled out.
 *
 *  The bounty must EXCEED the caller's transaction fee or nobody cranks -- an
 *  instruction that is permissionless in theory and unpaid in practice is
 *  cranked by whoever happens to care, which is the position the game is in
 *  today. `multiple` is how much better than break-even a cranker does. */
export function bounty({ crankResult, shotsPerDay, multiple = 2 }) {
  const perCall = SIGNATURE_FEE * multiple;
  const lamportsPerDay = crankResult.txPerDay * perCall;
  return {
    perCall,
    lamportsPerDay,
    perSeal: shotsPerDay > 0 ? Math.ceil(lamportsPerDay / shotsPerDay) : null,
    // What the player already pays for their own shot, for comparison. A levy
    // smaller than this is noise inside a cost they are paying regardless.
    ownLifecycleFees: SHOT_LIFECYCLE.length * SIGNATURE_FEE,
  };
}

// ---------------------------------------------------------------------------
//  CLI
// ---------------------------------------------------------------------------
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const arg = (flag, d) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i+1] ? Number(process.argv[i+1]) : d; };
  const source = fs.readFileSync(LIB, 'utf8');
  const { sizes, consts } = accountSizes(source);
  const horizons = [...source.matchAll(/\(\s*(\d+)\s*,\s*\d+\s*\)/g)]
    .map(m => Number(m[1])).filter(n => [5,10,15,30,60,360,1440].includes(n));
  const openShotsEach = arg('--open-shots', 3);
  const cuPrice = arg('--cu-price', null);

  console.log('ON-CHAIN COST, from the program\'s own constants');
  console.log('='.repeat(70));
  console.log(`rent  = (${ACCOUNT_STORAGE_OVERHEAD} + bytes) x ${LAMPORTS_PER_BYTE_YEAR} lamports/byte-year x ${EXEMPTION_THRESHOLD} years`);
  console.log(`fee   = ${SIGNATURE_FEE} lamports per signature`);
  console.log('');
  console.log('ACCOUNTS  (data + 8-byte Anchor discriminator)');
  console.log('  account          bytes      rent (SOL)   held');
  const held = { Shot:'until close_shot', PlayerLedger:'forever', LegacyClaim:'forever',
    FeedClock:'forever, shared', Podium:'forever, shared', DelegateGrant:'until revoked' };
  for (const [name, s] of Object.entries(sizes))
    console.log(`  ${name.padEnd(15)} ${String(s.onChain).padStart(5)}   ${fmt(rentExempt(s.onChain)).padStart(11)}   ${held[name] || ''}`);
  console.log('');

  console.log('ONE SHOT, END TO END');
  for (const s of SHOT_LIFECYCLE) console.log(`  ${s.ix.padEnd(11)} ${String(s.who).padEnd(22)} ${s.note}`);
  const one = model({ sizes, players: 1, openShotsEach: 1 });
  console.log(`  ${'—'.repeat(60)}`);
  console.log(`  fees SPENT per shot        ${fmt(one.feesPerShot)} SOL   (${SHOT_LIFECYCLE.length} signatures, gone)`);
  console.log(`  rent LOCKED per open shot  ${fmt(one.shotRent)} SOL   (returned by close_shot)`);
  console.log('');

  console.log(`SCALE  (${openShotsEach} open shots per player)`);
  console.log('  players     locked (SOL)    spent per cycle (SOL)');
  for (const players of [1, 100, 1000]) {
    const m = model({ sizes, players, openShotsEach });
    console.log(`  ${String(players).padStart(7)}   ${fmt(m.totalLocked).padStart(13)}   ${fmt(m.totalSpentPerCycle).padStart(20)}`);
  }
  const k = model({ sizes, players: 1000, openShotsEach });
  console.log('');
  console.log(`  Locked is rent-exempt deposit: refundable, but unavailable while held,`);
  console.log(`  and it is the PLAYERS' SOL, not the house's. Per player that is`);
  console.log(`  ${fmt(k.perPlayerLocked)} SOL to exist on chain with ${openShotsEach} chambers open.`);
  console.log('');

  const ceiling = crank({ capacity: consts.CLOCK_CAPACITY, feeds: 7, publishIntervalS: 60, horizonsMin: horizons });
  console.log('THE CRANK, and whether it can pay for itself');
  console.log(`  ring capacity              ${consts.CLOCK_CAPACITY} observations per feed`);
  console.log(`  at a 60s publish heartbeat that is ${ceiling.coverageMin} minutes of coverage`);
  console.log(`  horizons that OUTRUN the ring: ${ceiling.outrunHorizons.join(', ')} min`);
  console.log(`  -> those shots cannot settle from the ring alone; bind_crossing must be`);
  console.log(`     CALLED before the crossing is evicted. Permissionless, but not free`);
  console.log(`     and not automatic: somebody must be watching.`);
  console.log('');
  console.log(`  CEILING (checkpoint every minute regardless of demand):`);
  console.log(`    ${ceiling.ceilingTx.toLocaleString()} tx/day = ${fmt(ceiling.ceilingLamportsPerDay)} SOL/day`);
  console.log('');
  console.log(`  BUT a checkpoint is only useful where a shot expires, and one covers a`);
  console.log(`  whole publish interval of them. So the real cost is demand-driven:`);
  console.log('');
  console.log('  players   shots/day   checkpoints/day   per shot   SOL/day   levy per seal');
  for (const players of [1, 100, 1000, 10000]) {
    const shotsPerDay = players * openShotsEach;
    const c = crank({ capacity: consts.CLOCK_CAPACITY, feeds: 7, publishIntervalS: 60, horizonsMin: horizons, shotsPerDay });
    const b = bounty({ crankResult: c, shotsPerDay });
    console.log(`  ${String(players).padStart(7)}   ${String(shotsPerDay).padStart(9)}   ${String(c.txPerDay).padStart(15)}   ${c.checkpointsPerShot.toFixed(2).padStart(8)}   ${fmt(c.lamportsPerDay).padStart(7)}   ${(b.perSeal.toLocaleString() + ' lamports').padStart(13)}`);
  }
  console.log('');
  const bK = bounty({ crankResult: crank({ capacity: consts.CLOCK_CAPACITY, feeds: 7, publishIntervalS: 60, horizonsMin: horizons, shotsPerDay: 1000 * openShotsEach }), shotsPerDay: 1000 * openShotsEach });
  console.log(`  The levy pays a cranker ${bK.perCall.toLocaleString()} lamports a call — twice the fee, so`);
  console.log(`  cranking is profitable rather than charitable. At 1,000 players it costs`);
  console.log(`  each seal ${bK.perSeal.toLocaleString()} lamports against the ${bK.ownLifecycleFees.toLocaleString()} the player already pays for`);
  console.log(`  their own shot's four transactions.`);
  console.log('');
  console.log(`  THE SHAPE IS THE POINT: cost per shot FALLS as the game grows and is`);
  console.log(`  capped at the ceiling. That is what a self-funding fee needs, and it is`);
  console.log(`  a property of the design as built rather than something bolted on.`);
  console.log(`  Cheap at scale, expensive per head when nearly nobody is playing —`);
  console.log(`  which is the honest failure mode, and why the purse must degrade to`);
  console.log(`  "unpaid but still permissionless" rather than to "the game stops".`);
  console.log('');

  console.log('NOT MEASURED, AND NOT GUESSED');
  console.log('  compute units per instruction, and therefore any priority fee, cannot');
  console.log('  be derived from source. They need one real transaction on a real');
  console.log('  cluster. Re-run with --cu-price <microlamports> once measured.');
  if (cuPrice) console.log(`  (--cu-price ${cuPrice} given, but CU counts are still unmeasured, so it is ignored rather than multiplied by a number nobody has.)`);
  console.log('');
  console.log('  Also unmeasured: account contention under load, failed-transaction');
  console.log('  fees, RPC cost at 1,000 players, and the void rate. G4 asks for all');
  console.log('  of them and this file answers only the part arithmetic can reach.');
}
