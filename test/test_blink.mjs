import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.__ratchet_mem = new Map();
const api = require('../api/blink.js');
const payer = '11111111111111111111111111111111';
const blockhash = '11111111111111111111111111111111';
const memo = 'RATCHET|7|' + 'ab'.repeat(32);
const wire = Buffer.from(api.memoTransaction(payer, blockhash, memo), 'base64');

assert.equal(wire[0], 1, 'one signature slot');
assert.ok(wire.subarray(1, 65).equals(Buffer.alloc(64)), 'signature slot is unsigned');
assert.equal(wire[65], 1, 'message requires the fee-payer signature');
assert.ok(wire.includes(Buffer.from(memo)), 'memo bytes are present exactly');

const oldFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok:true, json:async()=>({ result:{ value:{ blockhash } } }) });
globalThis.__ratchet_mem.set('g:log:head', JSON.stringify({ i:7, h:'ab'.repeat(32) }));
const response = await new Promise(done => {
  const res = { _s:200, setHeader(){}, status(s){this._s=s;return this;}, end(){done({status:this._s});},
    json(body){done({status:this._s,body});} };
  api({ method:'POST', query:{action:'anchor'}, body:{account:payer} }, res);
});
globalThis.fetch = oldFetch;
assert.equal(response.status, 200);
assert.equal(typeof response.body.transaction, 'string');
assert.ok(Buffer.from(response.body.transaction, 'base64').includes(Buffer.from(memo)));
console.log('BLINK TRANSACTION OK');
