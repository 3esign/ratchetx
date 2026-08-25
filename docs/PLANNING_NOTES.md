# RatchetX Phase B & C - Planning Notes

While the production environment (h67) executes its 72-hour Phase B soak test unattended, we have three viable parallel tasks. This document outlines the findings, blockers, and questions for each.

## Option 1: Seal v3 on Devnet (On-Chain Hardening)

The current mainnet `ratchet-seal-v2` Anchor program has severe P1 design flaws that prevent it from being a fully autonomous referee.

### Challenges
1. **The Ring Buffer Problem:** The on-chain Pyth Push feed stores only the last `64` price observations. In turbulent markets, 64 updates can happen in minutes. Since maximum bet expiry is 25 hours (90,000 seconds), the crucial "expiry crossing" price will often fall out of the ring buffer before a player (or cranker) can call the `settle` instruction. 
2. **Synthetic Chronology:** The program stores its own `Observation.prev_publish_time` based on the previous Ratchet checkpoint, instead of the raw Pyth message `prev_publish_time`. This means a missed crank creates an artificial gap, redefining what "the next publish after expiry" means.
3. **No Reveal Deadline:** Rent (SOL) is locked in the PDA indefinitely if a user refuses to `reveal` a losing shot.

### Open Questions / Design Decisions
- **Buffer vs Rent:** Expanding the ring buffer to hold 24h of prices (e.g., 50,000 prices) would cost upwards of 10-15 SOL in rent per market. Do we rely on external "crankers" to save checkpoint prices at the exact expiry moment, or do we switch to a Pull Oracle (Hermes) where the user passes the historical price in the instruction? (Note: Roadmap restricts paid Hermes dependency).
- **Grace Period:** How long should the reveal deadline be before anyone can permissionlessly close the shot and refund the rent?

---

## Option 2: Supabase Hardening (P2 Backend Security)

The database (Supabase) is correctly locked down with Row Level Security (RLS), but the internal SQL functions and API rate limiting need tightening.

### Challenges
1. **In-Memory Rate Limiting:** `api/game.js` limits reads/writes using a `Map()` in memory. In Vercel serverless functions, memory is not shared across concurrent request instances, making this limit largely ineffective during a spike.
2. **SQL Search Paths:** Functions in `supabase/001_ratchet_kv.sql` are defined as `SECURITY DEFINER set search_path = public, pg_temp`. Modern Postgres/Supabase guidance dictates this should be `search_path = ''` to prevent malicious schema-hijacking attacks, requiring all tables to be explicitly prefixed (`public.ratchet_kv`).

### Proposed Implementation
- Rewrite all `supabase/001_ratchet_kv.sql` procedures with `set search_path = ''` and explicitly qualify `public.ratchet_kv`.
- Implement global rate limiting in `api/game.js` by tracking IP hits in Supabase using the existing `ratchet_kv_incr` logic with a 60-second `expires_at`.

---

## Option 3: SIWS (Sign-In With Solana) (P2 Authentication)

The current wallet authentication is naive and vulnerable to replay attacks if intercepted.

### Challenges
- The client currently signs a plaintext message: `RATCHET | <wallet> | <timestamp>`.
- The signature is valid for 2 hours, stored locally.
- It lacks a nonce, a domain binding, and a chain ID. If an attacker steals it (via XSS or a malicious extension), they can replay game mutations for 2 hours.

### Proposed Implementation
- Add an endpoint `POST /api/auth/nonce` to issue random nonces (stored in KV for 5 mins).
- Upgrade the client `lib/auth.js` to sign a standard SIWS payload:
  `ratchetx.xyz wants you to sign in with your Solana account... Nonce: {nonce}`
- On successful validation, the server deletes the nonce (preventing replay) and issues an HttpOnly secure session cookie or a short-lived, server-signed JWT.
