// DECISIVE RUN, per Sol 04:33Z (hermes @859113ec, pythnet.rs:122-145 / aggregate.rs:156-166):
// live leaf store = PDA find_program_address([b"AccumulatorState", ring_index.to_be_bytes()], system_program::id()),
// ring_index = slot % ring_size (10,000). Account = magic[4]="PAS1" | slot u64 LE | ring_size u32 LE | Vec<raw_messages>.
// Rebuild the Keccak160 Merkle root over raw_messages and compare with the guardian-signed VAA root for that slot.
// Read-only: getAccountInfo + Wormholescan GET. No key, no chain transaction, no writes outside the output file.
'use strict';
const path = require('path');
const REPO = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean';
const { keccak_256 } = require(path.join(REPO, 'node_modules', '@noble', 'hashes', 'sha3.js'));
const { PublicKey } = require(path.join(REPO, 'node_modules', '@solana', 'web3.js'));
const OUT = process.argv[2] || 'pas1.out.json';
const RPC = 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const H = (...p) => Buffer.from(keccak_256(Buffer.concat(p))).subarray(0, 20);
const LEAF = Buffer.from([0]), NODE = Buffer.from([1]), NULL = Buffer.from([2]);
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(40000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 250)); return j.result;
}
function merkleRoot(leafHashes) {
  let n = 1; while (n < leafHashes.length) n *= 2;
  const nul = H(NULL); const t = new Array(2 * n);
  for (let i = 0; i < n; i++) t[n + i] = i < leafHashes.length ? leafHashes[i] : nul;
  for (let i = n - 1; i >= 1; i--) { const l = t[2 * i], r = t[2 * i + 1]; t[i] = Buffer.compare(l, r) <= 0 ? H(NODE, l, r) : H(NODE, r, l); }
  return t[1];
}
function parsePAS1(d) {
  const magic = d.subarray(0, 4).toString('latin1');
  const slot = Number(d.readBigUInt64LE(4));
  const ring_size = d.readUInt32LE(12);
  let o = 16;
  const count = d.readUInt32LE(o); o += 4;
  const msgs = [];
  for (let i = 0; i < count; i++) {
    if (o + 4 > d.length) break;
    const len = d.readUInt32LE(o); o += 4;
    if (len > 4096 || o + len > d.length) { msgs.push({ bad: true, len, at: o }); break; }
    msgs.push(d.subarray(o, o + len)); o += len;
  }
  return { magic, slot, ring_size, count, msgs, consumed: o, total: d.length };
}
(async () => {
  const out = { started: new Date().toISOString(), attempts: [] };
  // recent accumulator VAAs -> slot/root map
  const bySlot = new Map();
  const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  for (const row of (j.data || [])) {
    const v = Buffer.from(row.vaa, 'base64');
    const sigs = v[5]; const p = v.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
    if (p.subarray(0, 4).toString('latin1') !== 'AUWV') continue;
    bySlot.set(Number(p.readBigUInt64BE(5)), { sequence: row.sequence, ring: p.readUInt32BE(13), root: p.subarray(17, 37).toString('hex') });
  }
  const slots = [...bySlot.keys()].sort((a, b) => b - a);
  out.vaa_window = { count: slots.length, newest: slots[0], oldest: slots[slots.length - 1] };
  // try the newest few slots: derive the ring PDA, read it, compare
  const candidates = [...slots.slice(-6), ...slots.slice(Math.floor(slots.length/2), Math.floor(slots.length/2)+4), ...slots.slice(0, 3)];
  for (const slot of candidates) {
    const ring_size = bySlot.get(slot).ring || 10000;
    const ring_index = slot % ring_size;
    const idx = Buffer.alloc(4); idx.writeUInt32BE(ring_index);
    const [pda, bump] = PublicKey.findProgramAddressSync([Buffer.from('AccumulatorState'), idx], SYSTEM);
    const a = { slot, ring_index, pda: pda.toBase58(), bump, signedRoot: bySlot.get(slot).root };
    try {
      const info = await rpc('getAccountInfo', [pda.toBase58(), { encoding: 'base64' }]);
      if (!info || !info.value) { a.account = 'missing'; out.attempts.push(a); continue; }
      const d = Buffer.from(info.value.data[0], 'base64');
      const p = parsePAS1(d);
      a.account = { owner: info.value.owner, bytes: d.length, magic: p.magic, slotInAccount: p.slot, ring_size: p.ring_size,
        messages: p.count, parsedOk: p.msgs.every(m => Buffer.isBuffer(m)), consumed: p.consumed };
      a.slotMatchesAccount = p.slot === slot;
      if (p.magic === 'PAS1' && p.msgs.every(m => Buffer.isBuffer(m)) && p.msgs.length) {
        const root = merkleRoot(p.msgs.map(m => H(LEAF, m))).toString('hex');
        a.computedRoot = root;
        a.MATCH = root === a.signedRoot;
        a.messageLengths = [...new Set(p.msgs.map(m => m.length))].slice(0, 8);
        a.firstMessageHex = p.msgs[0].subarray(0, 48).toString('hex');
      }
    } catch (e) { a.error = String(e.message).slice(0, 200); }
    out.attempts.push(a);
    if (a.MATCH) { out.MATCHED = a; break; }
  }
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 3500));
})().catch(e => console.log('FATAL ' + e.message));
