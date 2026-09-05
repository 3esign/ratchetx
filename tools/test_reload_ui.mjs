import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const input = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '../index.html'));
const html = readFileSync(input, 'utf8');
const start = html.indexOf('// --- SOL SWAP ---');
const end = html.indexOf('// ---------- THE PODIUM ----------', start);
assert(start >= 0 && end > start, 'Cannot locate actual reload slice in supplied HTML');
const source = html.slice(start, end);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness() {
  const nodes = new Map(), storage = new Map(), timers = new Map();
  const quoteRequests = [], signatures = [], notices = [];
  let timerId = 0, walletMode = 'success', walletGate;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', textContent: '', disabled: false, dataset: {}, style: {},
      classList: { toggle() {}, add() {}, remove() {} },
      blur() { this.onblur?.(); },
    });
    return nodes.get(id);
  };
  class PublicKey {
    constructor(value) { this.value = String(value); }
    toBytes() { return new Uint8Array(32); }
    toBase58() { return this.value; }
    toString() { return this.value; }
    equals(other) { return this.value === String(other); }
    static findProgramAddressSync() { return [new PublicKey('ATA'), 255]; }
  }
  class Transaction {
    constructor(options = {}) { Object.assign(this, options); this.instructions = []; }
    add(instruction) { this.instructions.push(instruction); return this; }
    static from(bytes) { return JSON.parse(Buffer.from(bytes).toString()); }
  }
  const provider = {
    publicKey: new PublicKey('wallet-A'),
    async signAndSendTransaction(tx) {
      signatures.push(tx);
      const signature = `signature-${signatures.length}`;
      if (walletMode === 'reject') throw new Error('User rejected the request');
      if (walletMode === 'wait') {
        walletGate = deferred();
        await walletGate.promise;
      }
      return { signature };
    },
  };
  const context = vm.createContext({
    AUTH: { wallet: 'wallet-A', ts: 1, sig: 'auth' },
    STATE: { mint: 'RCX', tokenProgram: 'Token2022', champ: { podium: [], pct: 0.3 } },
    API: '/api/game', Uint8Array, TextEncoder, TextDecoder, console,
    Date: class extends Date { static now() { return 1_000_000; } },
    $: node,
    document: { activeElement: null, querySelectorAll: () => [] },
    window: { solana: provider, phantom: { solana: provider }, solanaWeb3: {
      PublicKey, Transaction,
      VersionedTransaction: { deserialize: bytes => JSON.parse(Buffer.from(bytes).toString()) },
      TransactionInstruction: class { constructor(options) { Object.assign(this, options); } },
      SystemProgram: { programId: new PublicKey('SystemProgram') },
    } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++timerId; }, clearInterval() {},
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    toast: text => notices.push(text), refresh() {},
    fetch: async url => {
      assert.equal(url, '/api/game?action=blockhash', 'Unexpected network operation in mock');
      return { json: async () => ({ ok: true, blockhash: 'mock-blockhash' }) };
    },
    post: args => {
      if (args.action === 'reload_build') {
        const gate = deferred();
        quoteRequests.push({ args: { ...args }, gate });
        return gate.promise;
      }
      if (args.action === 'reload') return Promise.resolve({ ok: false, reason: 'tx not found yet' });
      throw new Error(`Unexpected post action ${args.action}`);
    },
  });
  vm.runInContext(source, context, { filename: input, timeout: 2000 });
  function runQuoteTimer() {
    const entry = [...timers].find(([, value]) => value.delay === 400);
    assert(entry, 'No pending quote debounce');
    const [id, timer] = entry;
    timers.delete(id);
    const completion = Promise.resolve(timer.fn());
    const request = quoteRequests.at(-1);
    assert(request, 'Quote timer did not request a build');
    return { request, completion };
  }
  async function finishQuote(request, completion) {
    request.gate.resolve({
      ok: true,
      transaction: Buffer.from(JSON.stringify({ amount: request.args.solAmount, wallet: request.args.wallet })).toString('base64'),
      tokensOut: Math.round(request.args.solAmount * 100_000 * 1e6),
    });
    await completion;
    await flush();
  }
  async function prime() {
    const { request, completion } = runQuoteTimer();
    await finishQuote(request, completion);
  }
  return {
    node, signatures, notices, prime, runQuoteTimer, finishQuote,
    pending: () => JSON.parse(storage.get('ratchet_pb') || 'null'),
    choose: amount => vm.runInContext(`setBurnSol(${Number(amount)}, false)`, context),
    click: id => node(id).onclick(),
    setWalletMode(mode) { walletMode = mode; },
    releaseWallet() { assert(walletGate, 'No wallet approval pending'); walletGate.resolve(); },
  };
}

const cases = [
  ['matching quote submits and retains the pending signature', async () => {
    const h = harness(); await h.prime();
    await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 1);
    assert.equal(h.signatures[0].amount, 0.1);
    assert.equal(h.signatures[0].wallet, 'wallet-A');
    assert.equal(h.pending()?.sig, 'signature-1');
  }],
  ['both reload paths stay locked after submission and retain the first signature', async () => {
    const h = harness(); await h.prime();
    await h.click('oneBurnRcx');
    assert.equal(h.node('oneBurnRcx').disabled, true, 'RCX button re-enabled while reload is pending');
    assert.equal(h.node('oneBurnSol').disabled, true, 'SOL button enabled while reload is pending');
    // Invoke handlers directly as well: stale events must not bypass the UI lock.
    await h.click('oneBurnRcx'); await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 1, 'A second transaction was offered during pending verification');
    assert.equal(h.pending()?.sig, 'signature-1', 'Pending signature was overwritten');
  }],
  ['wallet approval locks the other reload path', async () => {
    const h = harness(); await h.prime(); h.setWalletMode('wait');
    const first = h.click('oneBurnRcx'); await flush();
    assert.equal(h.signatures.length, 1, 'RCX approval did not reach mocked wallet');
    h.setWalletMode('success');
    await h.click('oneBurnSol');
    h.releaseWallet(); await first;
    assert.equal(h.signatures.length, 1, 'SOL offered a second transaction during RCX approval');
    assert.equal(h.pending()?.sig, 'signature-1');
  }],
  ['editing SOL amount blocks stale quote until the matching quote arrives', async () => {
    const h = harness(); await h.prime(); h.choose(0.5);
    await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 0, 'Old SOL quote submitted after amount edit');
    const { request, completion } = h.runQuoteTimer();
    await h.finishQuote(request, completion); await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 1);
    assert.equal(h.signatures[0].amount, 0.5);
  }],
  ['late obsolete quote cannot replace the newer matching quote', async () => {
    const h = harness(); await h.prime();
    h.choose(0.2); const old = h.runQuoteTimer();
    h.choose(0.3); const current = h.runQuoteTimer();
    await h.finishQuote(current.request, current.completion);
    await h.finishQuote(old.request, old.completion);
    await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 1, 'The current valid quote should remain usable');
    assert.equal(h.signatures[0].amount, 0.3, 'Late obsolete quote was offered to the wallet');
  }],
  ['wallet rejection clears busy state and permits an explicit retry', async () => {
    const h = harness(); await h.prime(); h.setWalletMode('reject');
    await h.click('oneBurnSol');
    assert.equal(h.pending(), null, 'Rejected transaction became pending');
    assert.equal(h.node('oneBurnSol').disabled, false, 'Rejected wallet approval left SOL busy');
    assert.equal(h.node('oneBurnRcx').disabled, false, 'Rejected wallet approval left RCX busy');
    h.setWalletMode('success'); await h.click('oneBurnSol');
    assert.equal(h.signatures.length, 2);
    assert.equal(h.pending()?.sig, 'signature-2');
  }],
];

let failures = 0;
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`); }
}
console.log(`Reload behavior: ${cases.length - failures}/${cases.length} passed; actual HTML: ${input}`);
process.exitCode = failures ? 1 : 0;
