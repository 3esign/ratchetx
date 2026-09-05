#!/usr/bin/env node
// The crank's refusals, which are the only part of it that can be proved today.
//
// It has never touched a chain, so what is testable is what it REFUSES to do:
// reach mainnet, send without a fee payer, run without an endpoint, and pretend
// it can see chain state. Every one of those is a way this file could look
// finished while being dangerous or useless.
import assert from 'node:assert/strict';
import { main, readState } from '../ops/g2-crank/crank.mjs';

let checks = 0;
const withArgv = async (args, fn) => {
  const saved = process.argv;
  process.argv = ['node', 'crank.mjs', ...args];
  try { return await fn(); } finally { process.argv = saved; }
};
const conn = genesis => () => ({ getGenesisHash: async () => genesis });
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// --- the boundary comes FIRST: mainnet is refused before anything is read
checks += 1;
await withArgv(['--rpc', 'http://x'], () =>
  assert.rejects(() => main({ connectionFactory: conn(MAINNET) }),
    /no agent on this project sends a mainnet transaction/i,
    'mainnet must be refused, and refused before chain state is touched'));

// and it is refused even with --send and a keypair, which is the case that matters
checks += 1;
await withArgv(['--rpc', 'http://x', '--send', '--keypair', '/nonexistent'], () =>
  assert.rejects(() => main({ connectionFactory: conn(MAINNET) }),
    /mainnet/i, 'no combination of flags gets past the mainnet refusal'));

// --- an unknown cluster is refused too
checks += 1;
await withArgv(['--rpc', 'http://x'], () =>
  assert.rejects(() => main({ connectionFactory: conn('SomeGenesisNobodyKnows111111111111111111111') }),
    /unknown genesis/i, 'an unrecognised cluster must be refused, not assumed'));

// --- no endpoint, no run: a default endpoint is how something ends up on a
//     cluster nobody chose
checks += 1;
await withArgv([], () =>
  assert.rejects(() => main({ connectionFactory: conn(DEVNET) }), /--rpc <url>.*is required/,
    'there must be no default endpoint'));

// --- --send without a keypair is refused: the fee payer is never implicit
checks += 1;
await withArgv(['--rpc', 'http://x', '--send'], () =>
  assert.rejects(() => main({ connectionFactory: conn(DEVNET) }), /requires --keypair/,
    'sending must never pick a wallet implicitly'));

// --- on an allowed cluster it gets past the boundary and fails HONESTLY at
//     reading state, rather than reporting a healthy empty sweep
checks += 1;
await withArgv(['--rpc', 'http://x'], () =>
  assert.rejects(() => main({ connectionFactory: conn(DEVNET) }), /readState is not implemented/,
    'on devnet it must reach readState and say plainly that it cannot see chain state'));

// --- and readState never returns an empty list, because that is a lie shaped
//     like a healthy result
checks += 1;
await assert.rejects(() => readState(), /crank with nothing to do and a crank that cannot see anything/,
  'readState must refuse rather than return nothing');

console.log(`ok - crank refusals: ${checks} checks; mainnet, unknown clusters, implicit wallets, `
  + 'default endpoints and invented chain state are all refused');
