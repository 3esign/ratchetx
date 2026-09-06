// The plain sentence and the saved game — the two things Semir asked for by name.
//
// The bar he set is not "readable". It is that a stranger can re-verify the saved
// record against the chain WITHOUT US, and that the sentence never says anything
// the fields do not support. Both are pure, so both are settled here.
import assert from 'node:assert/strict';
import { sentenceFor, saveGame, priceOf, SHOT_STATE, VOID_REASON } from '../lib/g2-text/say.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };
const says = (shot, match, msg, opts) => { checks += 1; assert.match(sentenceFor(shot, opts), match, msg); };

const T = 1788653100;
const base = {
  state: 4, voidReason: 0, side: 0, hit: 1, pBps: 6500,
  entryTargetTs: T, exitTargetTs: T + 300, revealDeadlineTs: T + 659,
  entryPrice: 14231060000n, entryExponent: -8, exitPrice: 14288420000n, exitExponent: -8,
};

// ---- prices are price AND exponent, never price alone -----------------------
eq(priceOf(14231060000n, -8), '142.310600', 'the price is not rendered from price x 10^exponent');
eq(priceOf(null, -8), null, 'a missing price rendered as a number');
eq(priceOf(14231060000n, null), null, 'a missing exponent rendered as if it were zero');
ok(!String(priceOf(1n, -8)).includes('e'), 'a small price rendered in exponent notation, which nobody reads');

// ---- the sentence a person actually gets ------------------------------------
// The clock values below are what 1788653100 actually IS in UTC. I wrote 14:05
// here first, from the illustrative times in the design reference, and the test
// failed against the code - correctly. Times in a test are measurements, not
// decoration.
says(base, /You said UP on SOL between 00:05:00 and 00:10:00 UTC\./, 'the winning sentence lost its shape',
  { feed: 'SOL' });
says(base, /It went from 142\.310600 to 142\.884200/, 'the sentence does not carry both prices');
says(base, /You were right\.$/, 'a hit does not end by saying so');
says({ ...base, hit: 0 }, /You were wrong\.$/, 'a miss does not end by saying so');
says({ ...base, side: 1 }, /You said DOWN/, 'side 1 is not DOWN');

// ---- every void reason has its own arm, in words ----------------------------
says({ ...base, state: 5, voidReason: 5 }, /exactly the price at the start, to the last decimal/,
  'an equality void does not explain itself');
says({ ...base, state: 5, voidReason: 6 }, /error bar was wider than the move/,
  'a confidence-band void does not explain the one thing a player has never seen');
says({ ...base, state: 5, voidReason: 1 }, /in time for the start of your window/, 'an expired entry is not explained');
says({ ...base, state: 5, voidReason: 3 }, /in time for the end of your window/, 'an expired exit is not explained');
for (const r of [5, 6, 1, 3]) {
  says({ ...base, state: 5, voidReason: r }, /returned/, `void reason ${r} does not say the shot was returned`);
}

// ---- the states that are not outcomes ---------------------------------------
says({ ...base, state: 1 }, /Waiting for the first price at 00:05:00/, 'PendingEntry gives no deadline');
says({ ...base, state: 2 }, /settles on the price at 00:10:00/, 'Active gives no settlement time');
says({ ...base, state: 3 }, /Reveal your guess before 00:15:59/, 'AwaitReveal gives no reveal deadline');
says({ ...base, state: 6 }, /never revealed before 00:15:59 UTC, so it was forfeited/, 'a forfeit is not explained');
says({ ...base, state: 7 }, /being returned/, 'AwaitVoid says nothing');

// ---- THE UNREACHABLE STATES ARE BUG REPORTS, NOT EXPLANATIONS ---------------
// MIN-CAPTURE orders candidates by (publish_time, posted_slot, message_hash),
// which is total, so there is always exactly one minimum and Ambiguous cannot
// happen. A soothing sentence over an impossible state is how a bug goes unseen.
for (const r of [2, 4]) {
  says({ ...base, state: 5, voidReason: r }, /cannot produce.*Please report it/,
    `an unreachable ambiguity (${r}) was explained away instead of reported`);
}
says({ ...base, state: 9 }, /state 9, which the current rules cannot produce/,
  'AN UNKNOWN STATE PRODUCED A CONFIDENT SENTENCE. There is no default arm anywhere, on purpose.');
says({ ...base, state: 5, voidReason: 99 }, /reason recorded on chain is 99/,
  'an unknown void reason was given a made-up explanation');
checks += 1;
assert.match(sentenceFor(null), /could not be read/, 'a missing shot produced a sentence about a game');

// ---- no sentence ever prints a raw undefined --------------------------------
for (const state of Object.keys(SHOT_STATE)) {
  const bare = { state: Number(state) };
  const s = sentenceFor(bare);
  checks += 1;
  assert.ok(!/undefined|null|NaN|\[object/.test(s), `state ${state} with no other fields printed "${s}"`);
}

// ---- the saved game ---------------------------------------------------------
const CLUSTER = { name: 'devnet', rpc: 'https://api.devnet.solana.com', genesis: 'EtWTRAB…' };
const meta = {
  cluster: CLUSTER, coreProgramId: 'ANVGVtDr…', timepinProgramId: 'C8wwxUGm…',
  shotAddress: 'BQqP6EmY…', feed: 'SOL',
};
{
  const f = saveGame({ ...base, economyHash: 'fc48abc7', entryNeed: 'need1', exitNeed: 'need2' }, meta);
  eq(f.verify.cluster.name, 'devnet', 'the saved game does not say which chain it came from');
  ok(f.verify.command.includes('BQqP6EmY…'), 'the saved game does not carry the command that checks it');
  ok(f.verify.command.includes('api.devnet.solana.com'), 'the command does not name the endpoint');
  ok(f.entry.need && f.exit.need, 'the two Needs are missing, and they are what make the price checkable by hand');
  eq(f.outcome.state, 'Revealed', 'the state is not rendered in words');
  eq(f.outcome.void_reason, 'None', 'the void reason is not rendered in words');
  ok(f.sentence.includes('You were right'), 'the saved game does not carry the sentence');
  ok(!JSON.stringify(f).includes('ratchet-server'),
    'the saved game carries a value from our server, which is exactly what it must not do');
}

// A saved game missing any part of the verification tuple must REFUSE to exist.
for (const drop of ['cluster', 'coreProgramId', 'timepinProgramId', 'shotAddress']) {
  const partial = { ...meta, [drop]: null };
  checks += 1;
  assert.throws(() => saveGame(base, partial), new RegExp(drop),
    `A SAVED GAME WAS PRODUCED WITHOUT ${drop}. It would look like proof and not be re-verifiable.`);
}

// An unknown state must survive into the file as unknown rather than as a guess.
{
  const f = saveGame({ ...base, state: 9 }, meta);
  eq(f.outcome.state, 'unknown(9)', 'an unknown state was given a name it does not have');
}

console.log(`ok - no default arm, no invented field, and nothing that cannot be re-verified (${checks} checks)`);
