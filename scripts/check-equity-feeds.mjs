// The B4 gate for equities. A feed id is not enough — before an equity feed can
// enter the frozen referee table, its sponsored SHARD-0 PUSH ACCOUNT must exist
// on Solana mainnet and be owned by the Pyth receiver. If it does not exist, the
// feed is published by Pyth but NOT sponsored on Solana, and the core program
// (which reads only sponsored push accounts) could never settle a shot on it.
//
// This checks each candidate with one getAccountInfo, verifies the owner, reads
// its PriceUpdateV2 and prints price, confidence-in-bps and age, and — most
// importantly for a 24/7 equity index — reports how fresh the last publish is.
// It changes nothing on chain.
//
//   node scripts/check-equity-feeds.mjs [RPC_URL]
//   (default RPC is a public mainnet endpoint; pass your own for reliability)
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.argv[2] || process.env.RATCHET_RPC || 'https://api.mainnet-beta.solana.com';
const RECEIVER = 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp';
const PUSH_ORACLE = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');

// The equity candidates: both variants per ticker. Index = 24/7 synthetic,
// US = exchange hours. The gate decides which (if either) is sponsored.
const FEEDS = [
  // CONTROL: SOL/USD is sponsored on shard 0 (7AviUf9n…) and settles the live game.
  // If this row is not ✓, the scanner or the RPC is broken and nothing below counts.
  ['SOL',  'CTRL',  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'],
  ['TSLA', 'Index', 'e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0'],
  ['TSLA', 'US',    '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1'],
  ['NVDA', 'Index', 'a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852'],
  ['NVDA', 'US',    'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593'],
  ['PLTR', 'Index', '52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9'],
  ['PLTR', 'US',    '11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0'],
  ['COIN', 'Index', '49387483ff50427bf0ff5928082b0cf16331421067c59f4c582a07aa117db1ac'],
  ['COIN', 'US',    'fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245'],
  ['HOOD', 'Index', '4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630'],
  ['HOOD', 'US',    '306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849'],
];
// Pyth push-oracle PDA = [shard_id u16 LE, feed_id]. Pyth's own sponsored set is
// on shard 0 (what the core program reads). Other sponsors use other shards, so
// the scan covers 0..MAX_SHARD to find where — if anywhere — a feed is pushed.
const MAX_SHARD = Number(process.env.RATCHET_MAX_SHARD || 255);
const pushAccount = (feedIdHex, shardId = 0) => {
  const shard = Buffer.alloc(2); shard.writeUInt16LE(shardId);
  return PublicKey.findProgramAddressSync([shard, Buffer.from(feedIdHex, 'hex')], PUSH_ORACLE)[0];
};

// Minimal PriceUpdateV2 reader: enough to prove the feed is live and readable.
function readPrice(data) {
  const b = Buffer.from(data);
  let o = 8 + 32;                       // discriminator, write_authority
  const level = b.readUInt8(o++); if (level === 0) o++;   // Partial{num_sigs} | Full
  const feedId = b.subarray(o, o + 32).toString('hex'); o += 32;
  const price = b.readBigInt64LE(o); o += 8;
  const conf = b.readBigUInt64LE(o); o += 8;
  const exponent = b.readInt32LE(o); o += 4;
  const publishTime = b.readBigInt64LE(o); o += 8;
  return { full: level === 1, feedId, price, conf, exponent, publishTime };
}

const now = Math.floor(Date.now() / 1000);
const conn = new Connection(RPC, 'confirmed');
console.log(`gate check · ${RPC} · shards 0..${MAX_SHARD}\n`);

// One getMultipleAccountsInfo per 100 addresses: (feeds × shards) / 100 calls.
const probes = [];
for (const [sym, kind, feedId] of FEEDS) for (let sh = 0; sh <= MAX_SHARD; sh++) probes.push({ sym, kind, feedId, sh, key: pushAccount(feedId, sh) });
const found = new Map();  // `${sym}/${kind}` -> [{sh, info}]
for (let i = 0; i < probes.length; i += 100) {
  const batch = probes.slice(i, i + 100);
  let infos;
  try { infos = await conn.getMultipleAccountsInfo(batch.map(p => p.key), 'confirmed'); }
  catch (e) { console.log('RPC error on a batch: ' + (e.message || e)); process.exitCode = 1; continue; }
  batch.forEach((p, k) => { if (infos[k]) { const id = `${p.sym}/${p.kind}`; if (!found.has(id)) found.set(id, []); found.get(id).push({ sh: p.sh, info: infos[k], key: p.key }); } });
  if (i % 500 === 0 && i) process.stdout.write(`  …${Math.round(i / probes.length * 100)}%\r`);
}

let shard0ok = 0;
for (const [sym, kind, feedId] of FEEDS) {
  const id = `${sym}/${kind}`, hits = found.get(id) || [];
  if (!hits.length) { console.log(`✗ ${sym} ${kind.padEnd(5)} not pushed on any shard 0..${MAX_SHARD} — not sponsored on Solana`); continue; }
  for (const h of hits) {
    const owned = h.info.owner.toBase58() === RECEIVER;
    let detail = owned ? '' : `WRONG OWNER ${h.info.owner.toBase58()}`;
    if (owned) {
      try {
        const p = readPrice(h.info.data);
        const px = Number(p.price) * Math.pow(10, p.exponent);
        const bps = Number(p.price) > 0 ? Math.round(Number(p.conf) * 10000 / Number(p.price)) : null;
        const age = now - Number(p.publishTime);
        detail = `$${px.toFixed(2)} · conf ${bps}bp · ${p.full ? 'Full' : 'PARTIAL'} · last publish ${age}s ago` + (age > 120 ? '  ⚠ stale' : '');
        if (h.sh === 0 && p.full && age <= 120) shard0ok++;
      } catch { detail = 'receiver-owned but not a PriceUpdateV2 I can read'; }
    }
    const mark = h.sh === 0 && owned ? '✓' : '~';
    console.log(`${mark} ${sym} ${kind.padEnd(5)} shard ${String(h.sh).padStart(3)}  ${h.key.toBase58()}  ${detail}`);
  }
}
const ctrl = (found.get('SOL/CTRL') || []).some(h => h.sh === 0 && h.info.owner.toBase58() === RECEIVER);
console.log(ctrl ? '\nCONTROL OK: SOL/USD found on shard 0 — the scanner and the RPC are sound; the equity results above are real.' : '\nCONTROL FAILED: SOL/USD not found on shard 0 — the RPC lied or the scan broke. IGNORE the results above and re-run with another RPC.');
console.log(`\n✓ = shard 0 + receiver-owned: readable by the core program as built (${shard0ok} usable now).`);
console.log('~ = pushed on another shard: readable only if the core switches or adds that shard (a program change, before freeze).');
console.log('✗ = not pushed anywhere: pull-only feed; the program cannot use it.');
