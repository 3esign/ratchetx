// Stateless self-play keyed by ONE secret (RATCHET_G2_SEED). Built for hosts that give a skill a
// fresh filesystem on every command (Bankr's X runtime does - observed 2026-09-09: three plays,
// three different agent wallets). Nothing is written to disk; everything the agent needs later
// is re-derived from the seed and read back from the chain:
//   key   = ed25519 seed sha256("ratchetx-g2/agent/v1" || seed)
//   salt  = sha256("ratchetx-g2/salt/v1" || seed || player || nonce || side || pBps)
// At reveal time the side and confidence are not stored anywhere, so they are recovered by
// trying every (side, pBps) against the on-chain commitment - 2 x 9999 hashes, a few seconds.
// One open shot at a time: "play" with a live shot reports or reveals it instead of sealing another.
import { createHash, webcrypto } from 'node:crypto';
import { createBrowserGame, DEVNET_GENESIS } from './browser-game.mjs';
import { formatG2Reply, FOOTER, TOKEN } from './x-reply.mjs';
import { classifyCommand, resolveIntent } from '../../skills/ratchetx/scripts/session-play.mjs';

const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.from(p)))).digest();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const reply = (code, text, extra = {}, ok = true) => ({ ok, code, mode: 'seed-self-play', reply: text + '\nDevnet test credits; no RCX payout.\n\n' + FOOTER, token: TOKEN, ...extra });
const decimal = v => (BigInt(v)).toString();

export function seedKeypair(web3, seed) {
  if (typeof seed !== 'string' || seed.length < 16) throw new Error('RATCHET_G2_SEED must be at least 16 characters');
  return web3.Keypair.fromSeed(Uint8Array.from(sha('ratchetx-g2/agent/v1', seed)));
}
export function seedSalt(seed, player, nonce, side, pBps) {
  const tail = Buffer.alloc(8 + 1 + 2); tail.writeBigUInt64LE(BigInt(nonce), 0); tail.writeUInt8(side, 8); tail.writeUInt16LE(pBps, 9);
  return Uint8Array.from(sha('ratchetx-g2/salt/v1', seed, player, tail));
}
export function seedIdentity(web3, seed) {
  const key = seedKeypair(web3, seed).publicKey.toBase58();
  return { schema: 1, scope: 'DEVNET_AGENT_LOCAL', clusterGenesis: DEVNET_GENESIS, player: key, delegate: key, grantId: hex(sha('ratchetx-g2/grant/v1', seed)).slice(0, 32), keyed: 'seed' };
}

export function createSeedAgent({ web3, connection, config, seed, onStatus = () => {} }) {
  const keypair = seedKeypair(web3, seed), player = keypair.publicKey;
  const wallet = { publicKey: player, signTransaction: async tx => { tx.sign([keypair]); return tx; } };
  const mem = new Map();
  const storage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
  const game = createBrowserGame({ web3, connection, config, wallet, storage, cryptoImpl: webcrypto, onStatus });
  const economyHash = config.economyHash, rulesetHash = config.rulesetHash;

  async function recoverTerms(snapshot, nonce) {
    // The commitment binds (player, nonce, side, pBps, salt); salt is a function of (side, pBps).
    const target = hex(snapshot.shot.commit);
    for (const side of [0, 1]) for (let pBps = 1; pBps <= 9999; pBps++) {
      const salt = seedSalt(seed, player.toBase58(), nonce, side, pBps);
      const commit = await game.client.commitmentHash({ economyHash: Uint8Array.from(Buffer.from(economyHash, 'hex')), rulesetHash: Uint8Array.from(Buffer.from(rulesetHash, 'hex')), player, nonce, side, probability: pBps, salt });
      if (hex(commit) === target) return { side, pBps, salt };
    }
    return null;
  }
  const withFooter = snapshot => ({ ...formatG2Reply(snapshot), mode: 'seed-self-play', player: player.toBase58() });

  /** Look at the latest shot; reveal it if the chain allows; say what is true. Never seals. */
  async function advance(before) {
    const view = before || await game.load();
    if (!view.ledger || view.ledger.nextShotNonce === 0n) return null;
    const nonce = view.ledger.nextShotNonce - 1n;
    let snapshot = await game.readShot({ player, nonce });
    if (snapshot.kind === 'unavailable') {
      // The Shot account is closed once the game ends (reveal, void, forfeit). The receipt lives in
      // the closing transaction; find it by the Shot address, newest first, like the journaled runner.
      const eh = Uint8Array.from(Buffer.from(economyHash, 'hex'));
      const address = game.client.shotPda(eh, player, nonce)[0];
      const rows = await connection.getSignaturesForAddress(address, { limit: 8 }, 'confirmed');
      for (const row of rows.filter(r => r.err === null).slice(0, 4)) {
        try { const found = await game.readShot({ player, nonce, terminalSignature: row.signature }); if (found.kind === 'archive') { snapshot = found; break; } }
        catch (error) { if (!/exactly one archive|Receipt extraction/.test(error.message)) throw error; }
      }
    }
    if (snapshot.kind === 'archive') return { open: false, snapshot, nonce, response: withFooter(snapshot) };
    if (snapshot.kind !== 'account') return { open: false, snapshot, nonce };
    if (snapshot.shot.state === 3) {
      onStatus({ phase: 'recovering-terms' });
      const terms = await recoverTerms(snapshot, nonce);
      if (!terms) return { open: true, snapshot, nonce, response: reply('REVEAL_TERMS_UNRECOVERABLE', 'Pyth prices are in but this shot was not sealed by this seed, so its reveal material cannot be re-derived. It will forfeit at its deadline.', { nonce: String(nonce) }, false) };
      const record = { schema: 1, clusterGenesis: DEVNET_GENESIS, economyHash, rulesetHash, player: player.toBase58(), nonce: String(nonce), side: terms.side, pBps: terms.pBps,
        stake: snapshot.shot.stake.toString(), salt: hex(terms.salt), commitment: hex(snapshot.shot.commit), stage: 'sealed', savedAt: new Date().toISOString() };
      await game.importRevealKey(JSON.stringify(record));
      const out = await game.reveal({ nonce });
      return { open: false, revealedNow: true, snapshot: out.result, nonce, response: withFooter(out.result) };
    }
    return { open: [1, 2, 7].includes(snapshot.shot.state), snapshot, nonce, response: withFooter(snapshot) };
  }

  // What a person who has never heard of RatchetX needs to read, in one reply, in plain words.
  const EXPLAIN = 'RatchetX is a prediction arcade on Solana devnet. You call SOL higher or lower over 5 minutes; the call is sealed on-chain before the move, Pyth prices decide, and the receipt is public. Free test credits, no real money, no wallet needed here - your Bankr agent plays with its own devnet wallet.\nStart: "@bankrbot rcx play SOL UP" (or DOWN). Then "@bankrbot rcx status" to see the result.\nPlay in a browser instead: https://ratchetx.xyz/play';
  async function play(text) {
    const kind = classifyCommand(text);
    if (kind === 'help' || kind === 'explain' || kind === 'meta') return reply(kind.toUpperCase(), EXPLAIN, { player: player.toBase58() });
    if (kind === 'board') return reply('BOARD', 'One market right now: SOL, higher or lower over 5 minutes, sealed before the move, settled on Pyth prices.\nPlay: "@bankrbot rcx play SOL UP" or "... DOWN"; add a stake (10-1000 credits) and a confidence (51-99%) if you like: "rcx play 100 on SOL down 70%".', { player: player.toBase58() });
    if (kind === 'leaderboard') return reply('LEADERBOARD', 'Ranks and receipts are on-chain; browse them at https://ratchetx.xyz/proof', { player: player.toBase58() });
    if (kind !== 'execute') return status();
    let view = await game.load();
    const latest = await advance(view);
    if (latest?.open) return { ...latest.response, note: 'A prediction is already open for this agent; no second one was sent.' };
    if (latest?.revealedNow) return latest.response; // the previous game just closed; its result is the answer to this command
    if (!view.ledger || view.ledger.credits < view.economy.args.minStake) {
      if (view.ledger && (view.ledger.legacyCredits > 0n || view.ledger.legacyXp > 0n)) return reply('INSUFFICIENT_CREDITS', 'This agent wallet has no test credits left and its one-time claim is used. No prediction was sent.', {}, false);
      onStatus({ phase: 'claiming' }); await game.claim(); view = await game.load();
    }
    const horizon = Number(view.ruleset.args.horizonSeconds) / 60;
    const intent = resolveIntent(text, {
      board: { targets: [{ id: rulesetHash, kind: 'dir', feed: 'SOL', mins: horizon }], stakeRule: { max: decimal(view.economy.args.maxStake) } },
      context: { feeds: [] }, limits: { maxStakeCredits: decimal(view.economy.args.maxStake), maxGrossCredits: decimal(view.ledger.credits) },
      session: { grossCredits: '0' }, player: { credits: decimal(view.ledger.credits) },
    });
    const side = intent.side === 'YES' ? 1 : 0, pBps = Math.round(intent.p * 10000), stake = String(intent.stake);
    const nonce = view.ledger.nextShotNonce, salt = seedSalt(seed, player.toBase58(), nonce, side, pBps);
    const out = await game.seal({ side, pBps, stake, expectedTargets: view.timing, salt: hex(salt) });
    return { ...withFooter(out.result), nonce: String(nonce), sealSignature: out.signature };
  }
  async function status() {
    const view = await game.load();
    const latest = await advance(view);
    if (latest?.response) return latest.response;
    return reply('STATUS', 'Test credits: ' + (view.ledger?.credits ?? 0n) + '. No saved prediction yet.', { player: player.toBase58() });
  }
  async function finish({ timeoutMs = 45 * 60 * 1000, pollMs = 30000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const latest = await advance();
      if (!latest || !latest.open) return latest?.response || await status();
      if (Date.now() >= deadline) return { ...latest.response, ok: false, code: 'FINISH_WAIT_EXPIRED' };
      await new Promise(r => setTimeout(r, Math.min(pollMs, deadline - Date.now())));
    }
  }
  return Object.freeze({ player, keypair, game, play, status, finish, advance });
}
