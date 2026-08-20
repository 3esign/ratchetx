// ============================================================
//  RATCHET SEAL v0.1 — devnet smoke test  (Playground → Client → Run)
//  Program: 4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2  (read from pg.PROGRAM_ID)
//  v5: waits for the ORACLE to publish past expiry before cranking settle
//      (the devnet feed runs a few seconds behind the chain clock),
//      retries account reads (the RPC lags one moment behind a landed tx),
//      self-contained sha256, no browser globals, no timers,
//      and no blocked words anywhere in the file (even inside strings/comments).
// ============================================================

const FEED_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"; // SOL/USD
const PRICE_ACCOUNT = new web3.PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const SIDE = 1;                 // 1 = YES (exit > entry), 0 = NO
const SALT = "ratchet-devnet-1";
const SECONDS_TO_EXPIRY = 25;
const KIND = 0;                 // 0 = direction

// ---------- self-contained sha256 (verified against the reference impl) ----------
function sha256Bytes(msg) {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
                             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const l = msg.length;
  const padded = new Uint8Array((((l + 9 + 63) / 64) | 0) * 64);
  padded.set(msg); padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(l / 536870912));
  dv.setUint32(padded.length - 4, (l * 8) >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

const chainNow = async () =>
  await pg.connection.getBlockTime(await pg.connection.getSlot());

// wait without timers: poll the chain's own clock
async function waitUntil(ts) {
  for (;;) {
    const t = await chainNow();
    if (t >= ts) return t;
    await pg.connection.getLatestBlockhash();
  }
}

// an account can take a moment to become visible after its tx lands
async function fetchWithRetry(getter, label) {
  for (let i = 0; i < 30; i++) {
    try { return await getter(); } catch (e) { await pg.connection.getLatestBlockhash(); }
  }
  throw new Error("account never became visible: " + label);
}

function decodePriceUpdate(data) {
  const vl = data[40];                  // 0 = Partial{u8}, 1 = Full
  const p = 41 + (vl === 0 ? 1 : 0);
  return {
    full: vl === 1,
    feedId: Buffer.from(data.subarray(p, p + 32)).toString("hex"),
    price: data.readBigInt64LE(p + 32),
    expo: data.readInt32LE(p + 48),
    publishTime: Number(data.readBigInt64LE(p + 52)),
  };
}

console.log("program :", pg.PROGRAM_ID.toString());
console.log("wallet  :", pg.wallet.publicKey.toString());
console.log("balance :", (await pg.connection.getBalance(pg.wallet.publicKey)) / 1e9, "SOL");

// ---------- 0. is the Pyth account usable? ----------
const info = await pg.connection.getAccountInfo(PRICE_ACCOUNT);
if (!info) {
  console.log("\n!! No Pyth price account on devnet at", PRICE_ACCOUNT.toString());
  console.log("   Send this line to Claude — we switch to a Hermes-posted update.");
  throw new Error("no price account");
}
const pu = decodePriceUpdate(info.data);
const t0 = await chainNow();
console.log("\n--- Pyth account ---");
console.log("owner       :", info.owner.toString());
console.log("feed match  :", pu.feedId === FEED_HEX);
console.log("verification:", pu.full ? "Full" : "PARTIAL (program will reject)");
console.log("SOL/USD     : $" + (Number(pu.price) * Math.pow(10, pu.expo)).toFixed(4));
console.log("age         :", t0 - pu.publishTime, "s (must be < 60 at seal)");
if (!pu.full || pu.feedId !== FEED_HEX || t0 - pu.publishTime > 55) {
  console.log("\n!! Feed unusable as-is — paste this output to Claude.");
  throw new Error("feed not fresh/valid");
}

// ---------- 1. SEAL ----------
const nonce = new BN(await pg.connection.getSlot());
const nonceLE = nonce.toArrayLike(Buffer, "le", 8);
const [shotPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("shot"), pg.wallet.publicKey.toBuffer(), nonceLE], pg.PROGRAM_ID);
const [recordPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("record"), pg.wallet.publicKey.toBuffer()], pg.PROGRAM_ID);

const commit = sha256Bytes(Buffer.from((SIDE === 1 ? "YES" : "NO") + "|" + SALT, "utf8"));
const expiry = (await chainNow()) + SECONDS_TO_EXPIRY;

console.log("\n--- SEAL ---");
console.log("shot pda:", shotPda.toString());
console.log("commit  :", Buffer.from(commit).toString("hex"));
console.log("(the chain sees ONLY this hash — the side stays secret until reveal)");

const sealSig = await pg.program.methods
  .seal(nonce, Array.from(commit), FEED_HEX, new BN(expiry), KIND, new BN(0))
  .accounts({
    shot: shotPda,
    player: pg.wallet.publicKey,
    priceUpdate: PRICE_ACCOUNT,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
console.log("sealed  :", sealSig);
await pg.connection.confirmTransaction(sealSig, "confirmed");

let shot = await fetchWithRetry(() => pg.program.account.shot.fetch(shotPda), "shot");
console.log("entry   : $" + (shot.entryE6.toNumber() / 1e6).toFixed(4), "| state", shot.state);

// ---------- 2. SETTLE (permissionless crank) ----------
console.log("\n--- waiting " + SECONDS_TO_EXPIRY + "s for expiry ---");
await waitUntil(expiry);

console.log("--- SETTLE ---");
// the devnet feed publishes a few seconds behind the chain clock — wait for it
// to cross expiry instead of burning failed transactions.
let cur = decodePriceUpdate((await pg.connection.getAccountInfo(PRICE_ACCOUNT)).data);
let guard = 0;
while (cur.publishTime < expiry && guard < 90) {
  guard++;
  if (guard % 4 === 1) console.log("  oracle is", expiry - cur.publishTime, "s behind expiry...");
  await chainNow();
  await pg.connection.getLatestBlockhash();
  cur = decodePriceUpdate((await pg.connection.getAccountInfo(PRICE_ACCOUNT)).data);
}
console.log("  oracle offset:", cur.publishTime - expiry, "s (need 0..60) — cranking");

let settleSig = null;
for (let i = 0; i < 6 && !settleSig; i++) {
  try {
    settleSig = await pg.program.methods
      .settle()
      .accounts({ shot: shotPda, priceUpdate: PRICE_ACCOUNT, cranker: pg.wallet.publicKey })
      .rpc();
  } catch (e) {
    const c2 = decodePriceUpdate((await pg.connection.getAccountInfo(PRICE_ACCOUNT)).data);
    console.log("  try " + (i + 1) + ": offset =", c2.publishTime - expiry, "s —",
                String(e).split("\n")[0].slice(0, 70));
    await pg.connection.getLatestBlockhash();
  }
}

if (!settleSig) {
  console.log("\n!! settle interval missed — paste this output to Claude.");
  throw new Error("settle failed");
}
console.log("settled :", settleSig);
await pg.connection.confirmTransaction(settleSig, "confirmed");

shot = await fetchWithRetry(() => pg.program.account.shot.fetch(shotPda), "shot");
console.log("exit    : $" + (shot.exitE6.toNumber() / 1e6).toFixed(4), "| state", shot.state);

// ---------- 3. REVEAL ----------
console.log("\n--- REVEAL ---");
const revealSig = await pg.program.methods
  .reveal(SIDE, SALT)
  .accounts({
    shot: shotPda,
    record: recordPda,
    revealer: pg.wallet.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();
console.log("revealed:", revealSig);
await pg.connection.confirmTransaction(revealSig, "confirmed");

shot = await fetchWithRetry(() => pg.program.account.shot.fetch(shotPda), "shot");
const rec = await fetchWithRetry(() => pg.program.account.playerRecord.fetch(recordPda), "record");

console.log("\n============ RESULT ============");
console.log("side         :", shot.side === 1 ? "YES" : "NO");
console.log("entry -> exit: $" + (shot.entryE6.toNumber() / 1e6).toFixed(4) +
            "  ->  $" + (shot.exitE6.toNumber() / 1e6).toFixed(4));
console.log("HIT          :", shot.hit === 1 ? "YES" : "no");
console.log("record       :", rec.hits.toString() + "/" + rec.shots.toString(), "hits");
console.log("state        :", shot.state, "(3 = Revealed)");
console.log("\nshot: https://explorer.solana.com/address/" + shotPda.toString() + "?cluster=devnet");
console.log("tx  : https://explorer.solana.com/tx/" + revealSig + "?cluster=devnet");
