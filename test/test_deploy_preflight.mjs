// What the G2 devnet deployment costs, and why the number matters before anyone
// starts one.
//
// The two artifacts are 375,944 and 1,014,408 bytes. At Solana's rent that is
// 16.74 SOL held at peak for an exact fit and 26.42 SOL with one upgrade of
// headroom - and a devnet faucet hands out two SOL at a time. A deploy started
// without checking this funds a buffer account, runs out, and leaves a
// half-deployed program and a stranded buffer.
//
// Everything here is arithmetic and file sizes. No network, no keys, no chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  rentExempt, deploymentCost, sizeOfProgramData, sizeOfBuffer,
  ACCOUNT_STORAGE_OVERHEAD, LAMPORTS_PER_BYTE_YEAR, EXEMPTION_YEARS, SIZE_OF_PROGRAM,
} from '../ops/g2-deploy/rent.mjs';
import { findArtifacts, budget } from '../ops/g2-deploy/preflight.mjs';

let checks = 0;
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };

// ---- the rent formula, computed a second way --------------------------------
// Not the same expression rearranged: the numbers below were worked out from the
// documented constants and written here as literals, so a typo in rent.mjs shows
// up as a mismatch rather than propagating.
eq(rentExempt(0), 890880, 'an empty account is not rent-exempt at the documented 890,880 lamports');
eq(rentExempt(SIZE_OF_PROGRAM), (128 + 36) * 3480 * 2, 'program account exemption');
eq(ACCOUNT_STORAGE_OVERHEAD * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_YEARS, 890880,
  'the overhead-only term does not reproduce the documented minimum');

// ---- the two real artifacts -------------------------------------------------
const TIMEPIN = 375_944;
const CORE = 1_014_408;

const t = deploymentCost(TIMEPIN);
eq(t.programDataAccount, (128 + 45 + TIMEPIN) * 3480 * 2, 'timepin programdata exemption');
eq(t.bufferPeak, (128 + 37 + TIMEPIN) * 3480 * 2, 'timepin buffer exemption');
eq(t.permanent, t.programAccount + t.programDataAccount, 'permanent is program + programdata');
eq(t.peak, t.permanent + t.bufferPeak, 'peak is permanent plus the buffer held during the deploy');

// Headroom doubles the programdata allocation and nothing else - the buffer only
// ever holds the real ELF.
const th = deploymentCost(TIMEPIN, { maxLen: TIMEPIN * 2 });
eq(th.bufferPeak, t.bufferPeak, 'headroom changed the buffer, which holds the real program, not the allocation');
ok(th.programDataAccount > t.programDataAccount, 'headroom did not increase the programdata allocation');

// ---- a max-len that cannot work is refused before anything is funded --------
checks += 1;
assert.throws(() => deploymentCost(CORE, { maxLen: CORE - 1 }),
  /smaller than the program/,
  'a max-len below the program size was accepted; the deploy would fail AFTER funding the buffer');

// ---- sequential deployment is cheaper at peak than doing both at once -------
const arts = [
  { name: 'timepin', bytes: TIMEPIN, missing: false },
  { name: 'core', bytes: CORE, missing: false },
];
const b = budget(arts);
ok(b.headroom.peakSequential < b.headroom.peakTogether,
  'deploying one at a time is not cheaper at peak than funding both buffers together, which means '
  + 'peakSequential is not computing what it claims');
eq(b.headroom.permanent,
  deploymentCost(TIMEPIN, { maxLen: TIMEPIN * 2 }).permanent + deploymentCost(CORE, { maxLen: CORE * 2 }).permanent,
  'the permanent total is not the sum of the two permanent costs');

// The order matters: the peak is worst when the LARGER program is deployed last,
// because everything already deployed is still locked.
const reversed = budget([arts[1], arts[0]]);
ok(b.headroom.peakSequential !== reversed.headroom.peakSequential,
  'deployment order does not affect the peak, which means the already-deployed cost is being ignored');

// ---- the numbers we are actually going to act on ---------------------------
// Pinned as SOL, to two decimals, because these are the figures a person will
// read before funding a payer. If a constant changes, this test says so.
const SOL = 1e9;
eq((b.exact.peakSequential / SOL).toFixed(2), '16.74', 'exact-fit peak changed');
eq((b.headroom.peakSequential / SOL).toFixed(2), '26.42', 'headroom peak changed');
eq((b.headroom.permanent / SOL).toFixed(2), '19.36', 'permanent cost changed');

// ---- a missing artifact is reported, never counted as free ------------------
const partial = budget([arts[0], { name: 'core', missing: true }]);
ok(partial.missing.includes('core'), 'a missing artifact was not reported');
ok(partial.headroom.permanent < b.headroom.permanent,
  'a missing artifact was somehow priced');

// ---- the cache walk ---------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-preflight-'));
try {
  fs.mkdirSync(path.join(tmp, 'aaa'));
  fs.writeFileSync(path.join(tmp, 'aaa', 'rcx_timepin_v2.so'), Buffer.alloc(11));
  const one = findArtifacts(tmp);
  eq(one.find(a => a.name === 'timepin').bytes, 11, 'the artifact walk did not find or size the file');
  ok(one.find(a => a.name === 'core').missing, 'an absent core was not reported missing');

  // TWO copies of one program in a content-addressed cache means two different
  // builds are present and nothing can say which one would be deployed.
  fs.mkdirSync(path.join(tmp, 'bbb'));
  fs.writeFileSync(path.join(tmp, 'bbb', 'rcx_timepin_v2.so'), Buffer.alloc(12));
  checks += 1;
  assert.throws(() => findArtifacts(tmp), /appears 2 times/,
    'a cache holding two different builds of one program was accepted');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

checks += 1;
assert.throws(() => findArtifacts(path.join(tmp, 'does-not-exist')), /cannot read the artifact cache/,
  'an unreadable cache answered instead of refusing');

console.log(`ok - the deploy budget is measured, not guessed (${checks} checks)`);
