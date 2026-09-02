// Deterministic commit salts, derived from the player's own wallet.
//
// The problem: the commit salt must survive from seal to reveal, and an
// unrevealed settled shot FORFEITS. A random salt therefore turns a cleared
// cache, a lost phone or a second device into a lost stake. Storing the salt
// somewhere only moves that dependency (and a salt at rest is exactly what an
// XSS wants). Deriving it removes the dependency instead.
//
// Ed25519 signing is deterministic — RFC 8032 takes the nonce from the key and
// the message, never from randomness — so the same wallet signing the same
// canonical message reproduces the same bytes forever, on any machine. Hash
// that signature and the salt is:
//   · reproducible anywhere the wallet is, with nothing stored
//   · unique per shot (the shot's nonce is inside the message)
//   · unguessable without the wallet
//   · never transmitted and never written down
//
// SECURITY: the SIGNATURE is the secret. Anyone holding it can derive the salt,
// recompute the commit and learn the side before reveal. Derive it, use it,
// drop it — never log, cache or transmit it.
//
// Isomorphic on purpose: WebCrypto and TextEncoder only, no node: imports, so
// this exact file runs unchanged in the browser and in the CLI. Verified to
// produce byte-identical digests to node:crypto.
export const SALT_RE = /^[0-9a-f]{32}$/;
const DOMAIN = 'RATCHET|salt|v1';

const toBytes = v => (v instanceof Uint8Array ? v : new Uint8Array(v));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** length-safe, data-independent compare — no early exit on first difference */
const sameBytes = (a, b) => {
  const x = toBytes(a), y = toBytes(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
};

/** The canonical message the wallet signs. Domain-separated, so a signature
 *  gathered for any other purpose can never double as a salt (or the reverse),
 *  and shot-specific, so every shot gets its own salt. */
export function saltMessage({ programId, wallet, nonce }) {
  if (programId == null || wallet == null || nonce == null) {
    throw new RangeError('saltMessage needs programId, wallet and nonce');
  }
  return `${DOMAIN}|${String(programId)}|${String(wallet)}|${String(nonce)}`;
}

/** 128 bits of the signature hash, in the exact shape the program demands. */
export async function saltFromSignature(signature) {
  const bytes = toBytes(signature);
  if (bytes.length < 32) throw new RangeError('signature too short to derive a salt from');
  const salt = hex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
  if (!SALT_RE.test(salt)) throw new Error('derived salt failed its own format check');
  return salt;
}

/** Derive the salt for one shot. `signMessage(bytes)` returns the 64-byte
 *  detached signature — the shape wallet adapters already give you.
 *
 *  We sign TWICE and compare by default. Ed25519 is deterministic by spec, but
 *  a wallet is free to implement it badly, and one that returned a fresh
 *  signature each time would hand back a salt that can never be recovered —
 *  discovered at reveal, when it is too late. Refuse loudly now instead. */
export async function deriveSalt({ signMessage, programId, wallet, nonce, verifyDeterminism = true }) {
  const bytes = new TextEncoder().encode(saltMessage({ programId, wallet, nonce }));
  const first = await signMessage(bytes);
  if (verifyDeterminism) {
    const second = await signMessage(bytes);
    if (!sameBytes(first, second)) {
      throw new Error('wallet does not sign deterministically: a derived salt would not be recoverable — keep a stored random salt for this wallet');
    }
  }
  return saltFromSignature(first);
}

// ---------------------------------------------------------------------------
// SEED MODE — the same property, one wallet prompt instead of one per shot.
//
// deriveSalt() above signs a message that names the shot, so it needs a
// signature per shot. On the CLI that is free. In a browser it is a wallet
// popup every single time somebody fires, which is a worse product than the
// problem it solves, and a player who dismisses the popup out of habit is back
// to a salt nobody can rebuild.
//
// So: sign ONCE per wallet for a seed, then derive every shot's salt from that
// seed and a public per-shot nonce. Recovery is unchanged — sign the same
// message again on any device, read the nonce off the public shot record,
// recompute. Nothing is stored anywhere, and the server never holds the only
// copy of anything.
//
// SECURITY: the seed is exactly as sensitive as the signature it came from —
// anyone holding it can open every commit that wallet has ever made. Keep it in
// memory for as long as the tab lives and no longer. Never localStorage, never
// a cookie, never a log line, never over the wire.

/** The message signed once per wallet. Separated from saltMessage() by the
 *  literal `seed`, so a per-shot signature can never be replayed as a seed. */
export function seedMessage({ scope, wallet }) {
  if (scope == null || wallet == null) throw new RangeError('seedMessage needs scope and wallet');
  return `${DOMAIN}|seed|${String(scope)}|${String(wallet)}`;
}

/** 32 bytes of the signature hash. Bytes, not hex: this is key material. */
export async function seedFromSignature(signature) {
  const bytes = toBytes(signature);
  if (bytes.length < 32) throw new RangeError('signature too short to derive a seed from');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** One shot's salt, from the seed and that shot's public nonce. The nonce is
 *  published on the shot precisely so this is reproducible by the player and
 *  by nobody else — knowing the nonce without the seed buys you nothing. */
export async function saltFromSeed(seed, nonce) {
  const s = toBytes(seed);
  if (s.length < 32) throw new RangeError('seed too short');
  if (nonce == null || String(nonce) === '') throw new RangeError('saltFromSeed needs a nonce');
  const tail = new TextEncoder().encode(`|shot|${String(nonce)}`);
  const msg = new Uint8Array(s.length + tail.length);
  msg.set(s, 0); msg.set(tail, s.length);
  const salt = hex(await crypto.subtle.digest('SHA-256', msg)).slice(0, 32);
  if (!SALT_RE.test(salt)) throw new Error('derived salt failed its own format check');
  return salt;
}

/** Establish the seed. Same determinism check as deriveSalt, and for the same
 *  reason: a wallet that signs non-deterministically produces a seed that can
 *  never be rebuilt, and the only moment that is cheap to discover is now. */
export async function deriveSeed({ signMessage, scope, wallet, verifyDeterminism = true }) {
  const bytes = new TextEncoder().encode(seedMessage({ scope, wallet }));
  const first = await signMessage(bytes);
  if (verifyDeterminism) {
    const second = await signMessage(bytes);
    if (!sameBytes(first, second)) {
      throw new Error('wallet does not sign deterministically: a derived salt would not be recoverable — keep a stored random salt for this wallet');
    }
  }
  return seedFromSignature(first);
}
