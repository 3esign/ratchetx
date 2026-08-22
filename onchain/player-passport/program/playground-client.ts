// Paste beside program/lib.rs in Solana Playground, Build + Deploy on DEVNET,
// then Run this client once. It uses the already-proven disposable v1 passport mint.
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PASSPORT_MINT = new PublicKey("4J9Tqmiq4FhNVRpwqcw4xizkWtXT3HYRkugGQr4o2SpY");
const WRONG_TOKEN_2022_ACCOUNT = new PublicKey("2YhG2ZR5LqDGgr3yeiVQcSCwKTs9tNthQSNPGd8P3TnC");
const LEAF_ROOT = [...Buffer.from("c0c0814a2b0f0558a0733e95c3da7fa473d8753fbd11babaab5734b8edc6baa8", "hex")];
const ZERO = new Array(32).fill(0);
const LOG_HEAD = new Array(32).fill(0x11);

const genesis = await pg.connection.getGenesisHash();
if (genesis !== DEVNET_GENESIS) throw new Error(`DEVNET ONLY: received genesis ${genesis}`);
if (pg.wallet.publicKey.toBase58() !== "8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH")
  throw new Error(`Expected disposable Playground wallet, received ${pg.wallet.publicKey.toBase58()}`);

const [config] = PublicKey.findProgramAddressSync([Buffer.from("passport-config")], pg.program.programId);
const [registry] = PublicKey.findProgramAddressSync(
  [Buffer.from("passport"), pg.wallet.publicKey.toBuffer()], pg.program.programId,
);

if (!(await pg.connection.getAccountInfo(config))) {
  const signature = await pg.program.methods.initializeConfig(pg.wallet.publicKey)
    .accounts({ config, admin: pg.wallet.publicKey, systemProgram: SystemProgram.programId }).rpc();
  console.log("initialize-config:", signature);
}
if (!(await pg.connection.getAccountInfo(registry))) {
  const signature = await pg.program.methods.initializeRegistry()
    .accounts({ config, registry, player: pg.wallet.publicKey, passportMint: PASSPORT_MINT, systemProgram: SystemProgram.programId }).rpc();
  console.log("initialize-registry:", signature);
}

const checkpoint = {
  sequence: new anchor.BN(1), previousCheckpointHash: ZERO,
  logIndex: new anchor.BN(100), logHead: LOG_HEAD, stateRoot: LEAF_ROOT,
  lifetimeXp: new anchor.BN(100), bestStreak: new anchor.BN(2), shots: new anchor.BN(5),
  podiumWins: new anchor.BN(1), burned: new anchor.BN(42), epochDay: new anchor.BN(20),
  checkpointUnix: new anchor.BN(1_000), proof: [],
};
let state = await pg.program.account.playerRegistry.fetch(registry);
if (state.sequence.eq(new anchor.BN(0))) {
  const signature = await pg.program.methods.checkpoint(checkpoint)
    .accounts({ config, registry, attestor: pg.wallet.publicKey, passportMint: PASSPORT_MINT }).rpc();
  console.log("valid-checkpoint:", signature);
  state = await pg.program.account.playerRegistry.fetch(registry);
}
if (!state.sequence.eq(new anchor.BN(1))) throw new Error(`Unexpected registry sequence ${state.sequence}`);

async function mustReject(label: string, action: () => Promise<unknown>) {
  try { await action(); throw new Error(`${label} unexpectedly succeeded`); }
  catch (error) {
    if (String(error).includes("unexpectedly succeeded")) throw error;
    console.log(`PASS ${label}:`, String(error).slice(0, 180));
  }
}

await mustReject("replay", () => pg.program.methods.checkpoint(checkpoint)
  .accounts({ config, registry, attestor: pg.wallet.publicKey, passportMint: PASSPORT_MINT }).rpc());

const rogue = Keypair.generate();
await mustReject("wrong-attestor", () => pg.program.methods.checkpoint({ ...checkpoint, sequence: new anchor.BN(2), previousCheckpointHash: [...state.checkpointHash], logIndex: new anchor.BN(101), logHead: new Array(32).fill(0x22) })
  .accounts({ config, registry, attestor: rogue.publicKey, passportMint: PASSPORT_MINT }).signers([rogue]).rpc());

await mustReject("account-substitution", () => pg.program.methods.checkpoint({ ...checkpoint, sequence: new anchor.BN(2), previousCheckpointHash: [...state.checkpointHash], logIndex: new anchor.BN(101), logHead: new Array(32).fill(0x22) })
  .accounts({ config, registry, attestor: pg.wallet.publicKey, passportMint: WRONG_TOKEN_2022_ACCOUNT }).rpc());

await mustReject("bad-merkle-root", () => pg.program.methods.checkpoint({ ...checkpoint, sequence: new anchor.BN(2), previousCheckpointHash: [...state.checkpointHash], logIndex: new anchor.BN(101), logHead: new Array(32).fill(0x22), stateRoot: ZERO })
  .accounts({ config, registry, attestor: pg.wallet.publicKey, passportMint: PASSPORT_MINT }).rpc());

console.log("RATCHET_PASSPORT_V2_DEVNET_REPORT", {
  program: pg.program.programId.toBase58(), config: config.toBase58(), registry: registry.toBase58(),
  player: state.player.toBase58(), passportMint: state.passportMint.toBase58(), sequence: state.sequence.toString(),
  checkpointHash: Buffer.from(state.checkpointHash).toString("hex"),
});
