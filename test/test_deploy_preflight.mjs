// Fresh first-deploy rent, plan selection and async RPC integration.
// Host tests use fixed quotes and synthetic files; no real balances or sends.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  rentExempt, deploymentCost, sizeOfProgramData, sizeOfBuffer,
  ACCOUNT_STORAGE_OVERHEAD, LAMPORTS_PER_BYTE_YEAR, EXEMPTION_YEARS, SIZE_OF_PROGRAM,
} from '../ops/g2-deploy/rent.mjs';
import { findArtifacts, budget, main, cheapestOrder } from '../ops/g2-deploy/preflight.mjs';

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
eq(t.bufferRentMinimum, (128 + 37 + TIMEPIN) * 3480 * 2, 'legacy buffer rent minimum');
eq(t.bufferFunding, t.programDataAccount, 'CLI prefunds buffer with ProgramData rent');
eq(t.permanent, t.programAccount + t.programDataAccount, 'permanent is program + programdata');
eq(t.peak, t.permanent, 'initial deploy reuses buffer before funding ProgramData');

// Capacity changes ProgramData rent and CLI buffer funding; buffer bytes remain the ELF size.
const th = deploymentCost(TIMEPIN, { maxLen: TIMEPIN * 2 });
eq(th.bufferRentMinimum, t.bufferRentMinimum, 'capacity does not change buffer bytes');
eq(th.bufferFunding, th.programDataAccount, 'CLI prefunds selected capacity');
ok(th.programDataAccount > t.programDataAccount, 'headroom did not increase the programdata allocation');

// ---- a max-len that cannot work is refused before anything is funded --------
checks += 1;
assert.throws(() => deploymentCost(CORE, { maxLen: CORE - 1 }),
  /smaller than the program/,
  'a max-len below the program size was accepted; the deploy would fail AFTER funding the buffer');

// First deploy's final account rent is also its maximum allocated rent.
const arts = [
  { name: 'timepin', bytes: TIMEPIN, missing: false },
  { name: 'core', bytes: CORE, missing: false },
];
const b = budget(arts);
eq(b.headroom.peakSequential, b.headroom.peakTogether, 'no additional simultaneous buffer rent');
eq(b.headroom.permanent,
  deploymentCost(TIMEPIN, { maxLen: TIMEPIN * 2 }).permanent + deploymentCost(CORE, { maxLen: CORE * 2 }).permanent,
  'total permanent rent');
const reversed = budget([arts[1], arts[0]]);
eq(b.headroom.peakSequential, reversed.headroom.peakSequential, 'order cannot create a rent saving');
eq(b.exact.peakSequential, 9681540960, 'legacy-rate exact first-deploy rent, including headers');
eq(b.headroom.peakSequential, 19358390880, 'legacy-rate double first-deploy rent');
const c = cheapestOrder(b.rows, 'exact');
eq(c.order.join(','), 'timepin,core', 'equal cost retains caller order');
eq(c.peak, c.worstPeak, 'fresh deployment has equal rent peaks in either order');

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

  // The CLI creates its connection asynchronously; exercise that real main path
  // against this cache without opening a network connection or loading a signer.
  const savedArgv = process.argv, savedLog = console.log;
  let factoryRpc = null, genesisRead = false;
  try {
    process.argv = [process.execPath, 'test_deploy_preflight.mjs',
      '--cache-root', tmp, '--rpc', 'mock://devnet'];
    console.log = () => {};
    const measured = await main({ connectionFactory: async rpc => {
      factoryRpc = rpc;
      return { getMinimumBalanceForRentExemption: async size => (128 + size) * 5080, getGenesisHash: async () => {
        genesisRead = true;
        return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      } };
    } });
    eq(factoryRpc, 'mock://devnet', 'main did not pass the requested RPC to the factory');
    ok(genesisRead, 'main did not identify the resolved connection before continuing');
    eq(measured.rows[0].bytes, 11, 'the async connection path lost the measured artifact');
  } finally {
    process.argv = savedArgv;
    console.log = savedLog;
  }

  // A payer between the two plans must fund exact, while double capacity remains short.
  fs.writeFileSync(path.join(tmp, 'aaa', 'ratchet_core_g2.so'), Buffer.alloc(21));
  const invoke = async (args, connection) => {
    const argv = process.argv, log = console.log;
    const output = [];
    try {
      process.argv = [process.execPath, 'preflight.mjs', '--cache-root', tmp, ...args];
      console.log = line => output.push(line);
      const result = await main({ connectionFactory: async () => connection });
      return { result, output: output.join('\n') };
    } finally { process.argv = argv; console.log = log; }
  };
  const payer = '11111111111111111111111111111111';
  const rpcArgs = ['--rpc', 'mock://devnet', '--payer', payer];
  let rentReads = 0, balanceReads = 0;
  const conn = {
    getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    getMinimumBalanceForRentExemption: async size => { rentReads++; return (128 + size) * 5080; },
    getBalance: async () => { balanceReads++; return 3_650_000; },
  };
  const exact = await invoke(rpcArgs, conn);
  eq(exact.result.selectedPlan, 'exact', 'default plan is exact');
  eq(exact.result.selectedRentLamports, 3_586_480, 'selected need uses RPC rate and exact capacity');
  ok(exact.result.rentCovered, 'payer covers the exact plan it was shown');
  eq(exact.result.feesIncluded, false, 'rent is not total transaction cost');
  eq(exact.result.rentSource, 'rpc', 'live quote provenance');
  ok(exact.output.includes('RENT COVERED') && exact.output.includes('fees still'), 'funding output qualifies fees');
  const headroom = await invoke([...rpcArgs, '--plan', 'headroom'], conn);
  eq(headroom.result.selectedRentLamports, 3_749_040, 'double capacity uses same RPC schedule');
  eq(headroom.result.rentCovered, false, 'same payer is short for double capacity');
  ok(headroom.output.includes('RENT SHORT BY'), 'selected-plan shortfall shown');
  ok(rentReads > 0 && balanceReads === 2, 'async RPC rent and balances were actually read');
  const offline = await invoke([], null);
  eq(offline.result.rentSource, 'legacy-estimate', 'offline source is explicitly legacy');
  eq(offline.result.rentCovered, undefined, 'offline estimate cannot certify payer funding');
  ok(offline.output.includes('LEGACY ESTIMATE'), 'legacy calculation labelled on output');
  checks++; await assert.rejects(invoke(['--plan', 'mystery'], conn), /plan must be/);
  checks++; await assert.rejects(invoke(rpcArgs, { ...conn,
    getMinimumBalanceForRentExemption: async () => { throw new Error('rent RPC unavailable'); } }), /rent RPC unavailable/);
  let forbiddenRentRead = false;
  checks++; await assert.rejects(invoke(rpcArgs, { ...conn,
    getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    getMinimumBalanceForRentExemption: async () => { forbiddenRentRead = true; return 1; } }), /mainnet/i);
  eq(forbiddenRentRead, false, 'mainnet refusal precedes rent/balance reads');

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

console.log(`ok - fresh-deploy rent and selected-plan RPC preflight (${checks} checks)`);
