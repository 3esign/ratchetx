// Deterministic commit salts, derived from the player's own wallet.
//
// The problem: the commit salt must survive from seal to reveal, and an
// unrevealed settled shot FORFEITS. A random salt therefore turns a cleared
// cache, a lost phone or a second device into a lost stake. Storing the salt
// somewhere only moves that dependency (and a stored salt is exactly what an
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
// Browser note: this uses node:crypto for sha256. In the browser the same
// derivation is crypto.subtle.digest('SHA-256', sig) — one await, same bytes.
import { createHash } from 'node:crypto';

export const SALT_RE = /^[0-9a-f]{32}$/;
const DOMAIN = 'RATCHET|salt|v1';

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
export function saltFromSignature(signature) {
  const bytes = Buffer.from(signature);
  if (bytes.length < 32) throw new RangeError('signature too short to derive a salt from');
  const salt = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
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
    if (Buffer.compare(Buffer.from(first), Buffer.from(second)) !== 0) {
      throw new Error('wallet does not sign deterministically: a derived salt would not be recoverable — keep a stored random salt for this wallet');
    }
  }
  return saltFromSignature(first);
}
