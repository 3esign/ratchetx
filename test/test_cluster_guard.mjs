#!/usr/bin/env node
// The crank must be unable to reach mainnet, and unable to be talked into it.
import assert from 'node:assert/strict';
import { classify, assertSendable, ClusterRefused, GENESIS } from '../ops/g2-crank/cluster.mjs';

let checks = 0;
const eq = (a, b, m) => { checks += 1; assert.equal(a, b, m); };

eq(classify('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d').allowed, false,
   'mainnet-beta must be refused');
eq(classify('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG').allowed, true, 'devnet is allowed');
eq(classify('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY').allowed, true, 'testnet is allowed');
eq(classify('SomethingNobodyHasEverSeenBefore1111111111').allowed, false,
   'an unknown genesis must be refused - not knowing is not permission');
eq(classify('').allowed, false, 'an empty genesis must be refused');

// The refusal must say WHY, in words somebody acting at 2am can act on.
checks += 1;
assert.match(classify('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d').why,
  /needs Semir, explicitly, in his own words/,
  'the mainnet refusal must name who authorises a mainnet transaction');

// It is decided on the genesis hash, never on the URL, because a URL is a string
// somebody can mistype into pointing at mainnet.
checks += 1;
assert.ok(!Object.keys(GENESIS).some(k => /http|api\.|devnet|mainnet/i.test(k)),
  'the table must key on genesis hashes, not on anything URL-shaped');

// A cluster that will not identify itself is refused rather than assumed.
{
  const silent = { getGenesisHash: async () => { throw new Error('timeout'); } };
  checks += 1;
  await assert.rejects(() => assertSendable(silent), ClusterRefused,
    'an RPC that will not say what cluster it is must be refused');
}
{
  const mainnet = { getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' };
  checks += 1;
  await assert.rejects(() => assertSendable(mainnet), /no agent on this project sends a mainnet/i,
    'assertSendable must refuse mainnet');
}
{
  const devnet = { getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
  eq((await assertSendable(devnet)).name, 'devnet', 'devnet must pass');
}

console.log(`ok - cluster guard: ${checks} checks, mainnet refused on the genesis hash with no override`);
