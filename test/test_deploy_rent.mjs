// Pure funding and mocked quote tests. No RPC, keys, deployed accounts or builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deploymentCost, fetchRentQuotes, rentExempt, sizeOfProgramData, sizeOfBuffer,
  SIZE_OF_PROGRAM, sol,
} from '../ops/g2-deploy/rent.mjs';

// Historical public RPC fixture: api.mainnet-beta.solana.com, finalized rent
// quotes observed 2026-09-05T22:46:54.088Z. These constants exercise the exact
// recorded values; they are not a live devnet/mainnet funding recommendation.
const observedQuotes = new Map([
  [36, 1038612],
  [375989, 2381948961], [751933, 4762802313], [375981, 2381898297],
  [1014453, 6425341473], [2028861, 12849587337], [1014445, 6425290809],
]);
const rentForSize = size => observedQuotes.get(size);
const TIMEPIN = 375944, CORE = 1014408;

test('legacy arithmetic is retained only as an explicitly labeled estimate', () => {
  assert.equal(rentExempt(0), 890880);
  const row = deploymentCost(TIMEPIN);
  assert.equal(row.rentBasis, 'legacy-static-estimate');
  assert.equal(row.feesIncluded, false);
  assert.match(row.scope, /fresh loader-v3.*excludes fees, upgrades and existing accounts/);
  assert.equal(row.permanent, 2618915760);
  assert.equal(sol(row.permanent), '2.61891576');
});

test('recorded per-size RPC values replace the legacy coefficient exactly', () => {
  const timepin = deploymentCost(TIMEPIN, { rentForSize });
  const core = deploymentCost(CORE, { rentForSize });
  assert.equal(timepin.programAccount, 1038612);
  assert.equal(timepin.programDataAccount, 2381948961);
  assert.equal(timepin.permanent, 2382987573);
  assert.equal(core.permanent, 6426380085);
  assert.equal(timepin.permanent + core.permanent, 8809367658);
  assert.equal(timepin.rentBasis, 'provided-quotes');
  assert.notEqual(timepin.permanent, deploymentCost(TIMEPIN).permanent);
});

test('devnet quotes use their own observed rent schedule rather than mainnet or legacy constants', async () => {
  // Public finalized devnet fixture observed 2026-09-05T22:54:56.671Z.
  const devnet = new Map([
    [36, 833120],
    [375989, 1910674360], [751933, 3820469880], [375981, 1910633720],
    [1014453, 5154071480], [2028861, 10307264120], [1014445, 5154030840],
  ]);
  const quotes = await fetchRentQuotes({
    getMinimumBalanceForRentExemption:async size => devnet.get(size),
  }, [...devnet.keys()]);
  const fromDevnet = size => quotes.get(size);
  const exact = [TIMEPIN, CORE].map(size => deploymentCost(size, { rentForSize:fromDevnet }));
  const headroom = [TIMEPIN, CORE].map(size => deploymentCost(size, { maxLen:size * 2, rentForSize:fromDevnet }));
  assert.equal(exact[0].programAccount, 833120);
  assert.equal(exact[0].bufferFunding, 1910674360);
  assert.equal(exact[0].bufferRentMinimum, 1910633720);
  assert.equal(exact.reduce((sum, row) => sum + row.peak, 0), 7066412080);
  assert.equal(headroom.reduce((sum, row) => sum + row.permanent, 0), 14129400240);
  assert.notEqual(exact[0].programDataAccount, observedQuotes.get(375989));
  assert.notEqual(exact[0].programDataAccount, rentExempt(375989));
});

test('CLI buffer funding includes max-len headroom while buffer rent minimum uses real ELF size', () => {
  const exact = deploymentCost(TIMEPIN, { rentForSize });
  const headroom = deploymentCost(TIMEPIN, { maxLen:TIMEPIN * 2, rentForSize });
  assert.equal(exact.bufferRentMinimum, 2381898297);
  assert.equal(headroom.bufferRentMinimum, exact.bufferRentMinimum);
  assert.equal(exact.bufferFunding, 2381948961);
  assert.equal(headroom.bufferFunding, 4762802313);
  assert.equal(headroom.bufferPeak, headroom.bufferFunding);
  assert.equal(headroom.permanent, 4763840925);
  assert.equal(headroom.peak, headroom.permanent);
});

test('buffer transfer conserves lamports without a second ProgramData funding requirement', () => {
  for (const elfLen of [TIMEPIN, CORE]) {
    for (const maxLen of [elfLen, elfLen * 2]) {
      const row = deploymentCost(elfLen, { maxLen, rentForSize });
      // Independent account ledger following the CLI and loader instruction
      // order: fund buffer, create Program, drain buffer, create ProgramData.
      let payer = row.peak, buffer = 0, program = 0, programData = 0;
      const conserved = () => {
        assert.ok(payer >= 0, 'no additional payer funds are needed at any stage');
        assert.equal(payer + buffer + program + programData, row.peak);
      };
      payer -= observedQuotes.get(45 + maxLen);
      buffer += observedQuotes.get(45 + maxLen);
      conserved();
      payer -= observedQuotes.get(36);
      program += observedQuotes.get(36);
      conserved();
      payer += buffer; buffer = 0;
      conserved();
      payer -= observedQuotes.get(45 + maxLen);
      programData += observedQuotes.get(45 + maxLen);
      conserved();
      assert.equal(payer, 0);
      assert.equal(buffer, 0);
      assert.equal(program + programData, row.permanent);
      assert.equal(row.peak, row.permanent);
      assert.ok(row.peak < row.permanent + row.bufferRentMinimum,
        'the previous double-counted buffer model must not survive');
    }
  }
});

test('sequential deployment order does not change rent-only pair funding for new buffers', () => {
  const rows = [TIMEPIN, CORE].map(size => deploymentCost(size, { rentForSize }));
  const peakFor = order => {
    let locked = 0, peak = 0;
    for (const row of order) { peak = Math.max(peak, locked + row.peak); locked += row.permanent; }
    return peak;
  };
  assert.equal(peakFor(rows), 8809367658);
  assert.equal(peakFor([...rows].reverse()), 8809367658);
});

test('invalid ELF sizes and capacities fail before any quote is consumed', () => {
  let calls = 0;
  const quote = () => { calls++; return 100; };
  for (const elfLen of [0, -1, 1.5, NaN, Infinity, '375944', null, undefined, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => deploymentCost(elfLen, { rentForSize:quote }), /size|safe integer/);
  }
  for (const maxLen of [0, -1, 1.5, NaN, Infinity, '375944', TIMEPIN - 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => deploymentCost(TIMEPIN, { maxLen, rentForSize:quote }), /max-len|ProgramData size/);
  }
  assert.equal(calls, 0);
  assert.equal(sizeOfProgramData(0), 45);
  assert.equal(sizeOfBuffer(0), 37);
  assert.throws(() => sizeOfBuffer(Number.MAX_SAFE_INTEGER), /buffer size/);
});

test('missing, fractional and otherwise invalid injected quotes never fall back', () => {
  for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '100', 1n, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => deploymentCost(TIMEPIN, { rentForSize:() => value }), /positive safe integer/);
  }
  assert.throws(() => deploymentCost(TIMEPIN, { rentForSize:null }), /must be a function/);
  const missing = new Map(observedQuotes); missing.delete(375981);
  assert.throws(() => deploymentCost(TIMEPIN, { rentForSize:size => missing.get(size) }), /375981.*positive safe integer/);
});

test('inconsistent quotes and overflowing totals cannot claim sufficient funding', () => {
  assert.throws(() => deploymentCost(TIMEPIN, {
    rentForSize:size => size === 375981 ? 200 : 100,
  }), /cannot fund the buffer rent minimum/);
  assert.throws(() => deploymentCost(TIMEPIN, {
    rentForSize:() => Number.MAX_SAFE_INTEGER,
  }), /total deployment lamports/);
});

test('RPC quote helper deduplicates sizes and returns the exact complete Map', async () => {
  const calls = [];
  const connection = { getMinimumBalanceForRentExemption:async size => {
    calls.push(size); return observedQuotes.get(size);
  } };
  const sizes = [...observedQuotes.keys(), SIZE_OF_PROGRAM, 375989];
  const quotes = await fetchRentQuotes(connection, sizes);
  assert.deepEqual(quotes, observedQuotes);
  assert.deepEqual(calls, [...observedQuotes.keys()]);
  assert.deepEqual(await fetchRentQuotes(connection, []), new Map());
  assert.equal(calls.length, observedQuotes.size);
});

test('RPC transport errors propagate without retry or a legacy estimate', async () => {
  const failure = new Error('synthetic RPC unavailable');
  let calls = 0;
  await assert.rejects(fetchRentQuotes({ getMinimumBalanceForRentExemption:async () => {
    calls++; throw failure;
  } }, [36]), error => error === failure);
  assert.equal(calls, 1);
});

test('invalid RPC quotes reject rather than produce a partial or fabricated map', async () => {
  for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '100', 1n, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fetchRentQuotes({ getMinimumBalanceForRentExemption:async () => value }, [36]), /positive safe integer/);
  }
  await assert.rejects(fetchRentQuotes({ getMinimumBalanceForRentExemption:async size => size === 36 ? 1038612 : undefined }, [36, 375989]), /375989.*positive safe integer/);
});

test('all requested account sizes are validated before any RPC request', async () => {
  let calls = 0;
  const connection = { getMinimumBalanceForRentExemption:async () => { calls++; return 100; } };
  for (const size of [-1, 1.5, NaN, Infinity, '36', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fetchRentQuotes(connection, [36, size]), /account data size/);
  }
  for (const sizes of [undefined, null, '36', new Set([36])]) {
    await assert.rejects(fetchRentQuotes(connection, sizes), /must be an array/);
  }
  assert.equal(calls, 0);
  await assert.rejects(fetchRentQuotes(null, [36]), /getMinimumBalanceForRentExemption is required/);
  await assert.rejects(fetchRentQuotes({}, [36]), /getMinimumBalanceForRentExemption is required/);
});
