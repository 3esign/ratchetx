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

// The equity candidates. 24/7 Index feeds — no market-hours gap by design.
const FEEDS = [
  ['TSLA', 'e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0'],
  ['NVDA', 'a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852'],
  ['PLTR', '52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9'],
  ['COIN', '49387483ff50427bf0ff5928082b0cf16331421067c59f4c582a07aa117db1ac'],
  ['HOOD', '4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630'],
];

const pushAccount = (feedIdHex) => {
  const shard = Buffer.alloc(2); shard.writeUInt16LE(0);
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
console.log(`gate check · ${RPC}\n`);
let pass = 0, fail = 0;
const results = [];
for (const [sym, feedId] of FEEDS) {
  const acct = pushAccount(feedId);
  let line = { sym, feedId, push: acct.toBase58(), ok: false };
  try {
    const info = await conn.getAccountInfo(acct, 'confirmed');
    if (!info) { line.reason = 'push account does NOT exist — feed is not sponsored on Solana'; fail++; }
    else if (info.owner.toBase58() !== RECEIVER) { line.reason = `wrong owner ${info.owner.toBase58()} (want receiver)`; fail++; }
    else {
      const p = readPrice(info.data);
      if (p.feedId !== feedId) { line.reason = `account holds a different feed id (${p.feedId.slice(0, 8)}…)`; fail++; }
      else {
        const px = Number(p.price) * Math.pow(10, p.exponent);
        const bps = Number(p.price) > 0 ? Math.round(Number(p.conf) * 10000 / Number(p.price)) : null;
        const age = now - Number(p.publishTime);
        line.ok = true; line.px = px; line.confBps = bps; line.ageS = age; line.full = p.full; pass++;
        line.reason = `$${px.toFixed(2)} · conf ${bps}bp · ${p.full ? 'Full' : 'PARTIAL'} · last publish ${age}s ago`;
        if (!p.full) line.warn = 'not Full-verified — the program refuses Partial updates';
        if (age > 120) line.warn = (line.warn ? line.warn + '; ' : '') + `stale: ${age}s > seal bound, a shot here would often void`;
      }
    }
  } catch (e) { line.reason = 'RPC error: ' + (e.message || e); fail++; }
  results.push(line);
  const mark = line.ok ? (line.warn ? '~' : '✓') : '✗';
  console.log(`${mark} ${sym.padEnd(5)} ${line.push}  ${line.reason}${line.warn ? '  ⚠ ' + line.warn : ''}`);
}
console.log(`\n${pass}/${FEEDS.length} readable and receiver-owned; ${fail} rejected.`);
console.log('Only ✓ feeds (exists · receiver-owned · Full · fresh) should enter the frozen table.');
console.log('Watch the ✓ set for a day in the observatory before the core 4th build.');
process.exitCode = fail ? 1 : 0;
