// Which instruction is actually writing the sponsored Pyth account today? Decides whether the live rail is
// the Wormhole/PAS1 path (post_update with an encoded VAA) or something else after Pyth's 26-Aug upgrade.
// Read-only. No key, no transaction.
'use strict';
const RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
const SOL_SPONSORED = '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE';
const out = { started: new Date().toISOString() };
let ep = 0;
async function rpc(method, params) {
  for (let n = 0; n < RPCS.length; n++) {
    const i = (ep + n) % RPCS.length;
    try {
      const r = await fetch(RPCS[i], { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25000) });
      const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      ep = i; return j.result;
    } catch (e) { if (n === RPCS.length - 1) throw e; }
  }
}
(async () => {
  const sigs = await rpc('getSignaturesForAddress', [SOL_SPONSORED, { limit: 3 }]);
  out.recent = (sigs || []).map(s => ({ signature: s.signature, slot: s.slot, err: s.err, blockTime: s.blockTime }));
  out.transactions = [];
  for (const s of (sigs || []).slice(0, 2)) {
    const tx = await rpc('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'json' }]);
    if (!tx) { out.transactions.push({ signature: s.signature, missing: true }); continue; }
    const keys = tx.transaction.message.accountKeys || [];
    const outer = (tx.transaction.message.instructions || []).map(ix => ({
      program: keys[ix.programIdIndex],
      accounts: (ix.accounts || []).map(i => keys[i]).slice(0, 8),
      dataB58Len: ix.data ? ix.data.length : 0,
    }));
    const inner = [];
    for (const g of ((tx.meta && tx.meta.innerInstructions) || []))
      for (const ix of g.instructions) inner.push({ program: keys[ix.programIdIndex] });
    out.transactions.push({ signature: s.signature, slot: tx.slot, fee: tx.meta && tx.meta.fee,
      logs: ((tx.meta && tx.meta.logMessages) || []).slice(0, 25),
      outerPrograms: outer.map(o => o.program), innerPrograms: [...new Set(inner.map(i => i.program))],
      allAccountKeys: keys.slice(0, 20) });
  }
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(process.argv[2] || 'writer_check.out.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
})().catch(e => console.log('FATAL ' + e.message));
