// Strict decoder for AccumulatorUpdateData, written ONLY from pythnet-sdk 3.0.0 source read on this laptop:
//   wire.rs:43-49   struct AccumulatorUpdateData { magic [u8;4], major_version u8, minor_version u8, trailing Vec<u8>, proof Proof }
//   wire.rs:85-90   enum Proof { WormholeMerkle { vaa: PrefixedVec<u16,u8>, updates: Vec<MerklePriceUpdate> } }
//   wire.rs:95-98   struct MerklePriceUpdate { message: PrefixedVec<u16,u8>, proof: MerklePath<Keccak160> }
//   merkle.rs:42    struct MerklePath<H>(Vec<H::Hash>)         -> u8 length + 20-byte hashes
//   ser.rs:395-402  serialize_seq writes a u8 length            -> every plain Vec is u8-prefixed
//   ser.rs:357-363  enum variant index is written as a single u8
//   wire.rs:63      from_slice::<byteorder::BE, _>              -> all integers BIG-ENDIAN
// It re-parses the bytes proof_sol.js produced and re-verifies the proof against the VAA's own root.
'use strict';
const path = require('path');
const REPO = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean';
const { keccak_256 } = require(path.join(REPO, 'node_modules', '@noble', 'hashes', 'sha3.js'));
const H = (...p) => Buffer.from(keccak_256(Buffer.concat(p))).subarray(0, 20);
const hnode = (l, r) => Buffer.compare(l, r) <= 0 ? H(Buffer.from([1]), l, r) : H(Buffer.from([1]), r, l);
const src = require(process.argv[2] || 'D:/Svemir/data/tmp/fable/proof_sol.out.json');
const buf = Buffer.from(src.accumulatorUpdateData.hex, 'hex');
const out = { inputBytes: buf.length, checks: [] };
const ok = (name, cond, detail) => out.checks.push({ name, pass: !!cond, ...(detail ? { detail } : {}) });
let o = 0;
const u8 = () => buf[o++];
const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
const take = n => { const b = buf.subarray(o, o + n); o += n; return b; };

ok('magic is PNAU', take(4).toString('latin1') === 'PNAU');
const major = u8(), minor = u8();
ok('major_version == 1', major === 1, `got ${major}`);
ok('minor_version >= CURRENT_MINOR_VERSION (0)', minor >= 0, `got ${minor}`);
const trailingLen = u8();
ok('trailing is a u8-prefixed Vec<u8>, empty', trailingLen === 0, `len ${trailingLen}`);
o += trailingLen;
const variant = u8();
ok('Proof enum variant 0 = WormholeMerkle, one u8', variant === 0, `got ${variant}`);
const vaaLen = u16();
const vaa = take(vaaLen);
ok('vaa is PrefixedVec<u16,u8> and its length is consistent', vaa.length === vaaLen, `${vaaLen} bytes`);
const updates = u8();
ok('updates is a u8-prefixed Vec', updates === 1, `count ${updates}`);
const msgLen = u16();
const msg = take(msgLen);
ok('message is PrefixedVec<u16,u8>', msg.length === msgLen, `${msgLen} bytes`);
const pathLen = u8();
const proof = [];
for (let i = 0; i < pathLen; i++) proof.push(take(20));
ok('MerklePath is a u8-prefixed Vec of 20-byte Keccak160 hashes', proof.length === pathLen, `${pathLen} nodes`);
ok('EVERY BYTE CONSUMED, no trailing garbage', o === buf.length, `consumed ${o} of ${buf.length}`);

// independent re-verification straight from the decoded envelope
const sigs = vaa[5];
const payload = vaa.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
ok('embedded VAA payload magic is AUWV', payload.subarray(0, 4).toString('latin1') === 'AUWV');
const rootInVaa = payload.subarray(17, 37);
let cur = H(Buffer.from([0]), msg);
for (const s of proof) cur = hnode(cur, s);
ok('PROOF FOLDS TO THE ROOT INSIDE THE SIGNED VAA', cur.equals(rootInVaa), cur.toString('hex'));
ok('decoded message is 85 bytes, type 0 (PriceFeedMessage)', msg.length === 85 && msg[0] === 0);
const feedId = msg.subarray(1, 33).toString('hex');
ok('feed id is SOL/USD', feedId === 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', feedId);
const pub = Number(msg.readBigInt64BE(53)), prev = Number(msg.readBigInt64BE(61));
ok('prev_publish_time = publish_time - 1 (the bracket message for that second)', pub - prev === 1, `pub ${pub} prev ${prev}`);
out.slotOfRun = src.slot;
out.rootInVaa = rootInVaa.toString('hex');
out.passed = out.checks.filter(c => c.pass).length;
out.failed = out.checks.filter(c => !c.pass).length;
require('fs').writeFileSync(process.argv[3] || 'envelope_check.out.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
