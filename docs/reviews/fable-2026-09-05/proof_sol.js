// Next step after the root match (Sol 04:33Z step 2): extract a LEAF PROOF for one of our 7 feeds from the
// keyless PAS1 ring, verify it against the guardian-signed root, and assemble the exact AccumulatorUpdateData
// bytes a Full post_update consumes. Read-only: getAccountInfo + Wormholescan GET. No key, no chain transaction.
'use strict';
const path = require('path');
const REPO = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean';
const { keccak_256 } = require(path.join(REPO, 'node_modules', '@noble', 'hashes', 'sha3.js'));
const { PublicKey } = require(path.join(REPO, 'node_modules', '@solana', 'web3.js'));
const OUT = process.argv[2] || 'proof_sol.out.json';
const RPC = 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const FEEDS = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
};
const H = (...p) => Buffer.from(keccak_256(Buffer.concat(p))).subarray(0, 20);
const LEAF = Buffer.from([0]), NODE = Buffer.from([1]), NULL = Buffer.from([2]);
const hnode = (l, r) => Buffer.compare(l, r) <= 0 ? H(NODE, l, r) : H(NODE, r, l);
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(40000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 250)); return j.result;
}
function buildTree(leafHashes) {
  let n = 1; while (n < leafHashes.length) n *= 2;
  const nul = H(NULL); const t = new Array(2 * n);
  for (let i = 0; i < n; i++) t[n + i] = i < leafHashes.length ? leafHashes[i] : nul;
  for (let i = n - 1; i >= 1; i--) t[i] = hnode(t[2 * i], t[2 * i + 1]);
  return { t, n };
}
function proofFor(t, n, index) {
  const p = []; let i = n + index;
  while (i > 1) { p.push(t[i ^ 1]); i >>= 1; }
  return p;
}
function verify(leafHash, proof, root) {
  let h = leafHash;
  for (const s of proof) h = hnode(h, s);
  return h.equals(root);
}
function parsePAS1(d) {
  const magic = d.subarray(0, 4).toString('latin1');
  const slot = Number(d.readBigUInt64LE(4));
  const ring_size = d.readUInt32LE(12);
  let o = 16; const count = d.readUInt32LE(o); o += 4;
  const msgs = [];
  for (let i = 0; i < count; i++) { const len = d.readUInt32LE(o); o += 4; msgs.push(d.subarray(o, o + len)); o += len; }
  return { magic, slot, ring_size, msgs, consumed: o, total: d.length };
}
(async () => {
  const out = { started: new Date().toISOString() };
  const head = await rpc('getSlot', []);
  // VAA map
  const bySlot = new Map();
  const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  for (const row of (j.data || [])) {
    const v = Buffer.from(row.vaa, 'base64');
    const sigs = v[5]; const p = v.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
    if (p.subarray(0, 4).toString('latin1') !== 'AUWV') continue;
    bySlot.set(Number(p.readBigUInt64BE(5)), { sequence: row.sequence, vaa: v, ring: p.readUInt32BE(13), root: p.subarray(17, 37) });
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);   // oldest first: the ring is written there
  for (const slot of slots) {
    const ring_size = bySlot.get(slot).ring || 10000;
    const idx = Buffer.alloc(4); idx.writeUInt32BE(slot % ring_size);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('AccumulatorState'), idx], SYSTEM);
    const info = await rpc('getAccountInfo', [pda.toBase58(), { encoding: 'base64' }]);
    if (!info || !info.value) continue;
    const d = Buffer.from(info.value.data[0], 'base64');
    const p = parsePAS1(d);
    if (p.magic !== 'PAS1' || p.slot !== slot) continue;                  // ring not yet written for this lap
    const { t, n } = buildTree(p.msgs.map(m => H(LEAF, m)));
    const signedRoot = bySlot.get(slot).root;
    if (!t[1].equals(signedRoot)) { out.rootMismatchAt = slot; continue; }
    out.slot = slot; out.pda = pda.toBase58(); out.messages = p.msgs.length; out.treeWidth = n;
    out.signedRoot = signedRoot.toString('hex'); out.computedRoot = t[1].toString('hex'); out.ROOT_MATCH = true;
    out.feeds = {};
    for (const [name, hex] of Object.entries(FEEDS)) {
      const fid = Buffer.from(hex, 'hex');
      const index = p.msgs.findIndex(m => m.length === 85 && m[0] === 0 && m.subarray(1, 33).equals(fid));
      if (index < 0) { out.feeds[name] = 'leaf not found'; continue; }
      const msg = p.msgs[index];
      const leafHash = H(LEAF, msg);
      const proof = proofFor(t, n, index);
      const ok = verify(leafHash, proof, signedRoot);
      // decode the message for the record (big-endian after the 1-byte type and 32-byte feed id)
      let o = 33;
      const dec = { price: msg.readBigInt64BE(o).toString(), conf: msg.readBigUInt64BE(o + 8).toString(),
        expo: msg.readInt32BE(o + 16), publish_time: Number(msg.readBigInt64BE(o + 20)),
        prev_publish_time: Number(msg.readBigInt64BE(o + 28)), ema_price: msg.readBigInt64BE(o + 36).toString(),
        ema_conf: msg.readBigUInt64BE(o + 44).toString() };
      out.feeds[name] = { leafIndex: index, proofLength: proof.length, PROOF_VERIFIES: ok, message: dec,
        messageHex: msg.toString('hex'), proofHex: proof.map(x => x.toString('hex')) };
      // assemble AccumulatorUpdateData (pythnet-sdk wire v1): "PNAU" | major 1 | minor 0 | trailing len 0 |
      // update type 0 (WormholeMerkle) | vaa len u16 BE | vaa | num updates u8 | [ msg len u16 BE | msg | proof len u8 | proof ]
      if (ok && name === 'SOL') {
        const vaa = bySlot.get(slot).vaa;
        const parts = [Buffer.from('PNAU', 'latin1'), Buffer.from([1, 0, 0, 0])];
        const vlen = Buffer.alloc(2); vlen.writeUInt16BE(vaa.length); parts.push(vlen, vaa, Buffer.from([1]));
        const mlen = Buffer.alloc(2); mlen.writeUInt16BE(msg.length); parts.push(mlen, msg, Buffer.from([proof.length]), ...proof);
        const upd = Buffer.concat(parts);
        out.accumulatorUpdateData = { bytes: upd.length, magic: 'PNAU', vaaBytes: vaa.length, proofNodes: proof.length,
          hex: upd.toString('hex'), note: 'layout per pythnet-sdk wire v1 as understood here; the receiver parser is the authority and must confirm it offline' };
      }
    }
    break;
  }
  out.head = head; out.finished = new Date().toISOString();
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  const brief = { slot: out.slot, messages: out.messages, treeWidth: out.treeWidth, ROOT_MATCH: out.ROOT_MATCH,
    feeds: Object.fromEntries(Object.entries(out.feeds || {}).map(([k, v]) => [k, typeof v === 'string' ? v : { leafIndex: v.leafIndex, proofLength: v.proofLength, PROOF_VERIFIES: v.PROOF_VERIFIES, message: v.message }])),
    accumulatorUpdateData: out.accumulatorUpdateData && { bytes: out.accumulatorUpdateData.bytes, vaaBytes: out.accumulatorUpdateData.vaaBytes, proofNodes: out.accumulatorUpdateData.proofNodes } };
  console.log(JSON.stringify(brief, null, 1));
})().catch(e => console.log('FATAL ' + e.message));
