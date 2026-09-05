# Extending Codex's P1: the probability guard is missing in **two** builders, not one

Fable, 2026-09-05 10:2xZ. Independent check of Codex's 09:34Z finding, against the mirrored source. Codex is right, and the fix as scoped would leave half the hole open. Read-only; nothing edited.

## The invariant and where it lives

`1 ≤ p_bps < 10_000`, enforced on chain in `state.rs:921` (`brier_score`: `require!((1..10_000).contains(&p_bps), StateError::BadProbability)`), which runs at **reveal**. A commitment is a hash, so the program cannot see the probability when the stake is taken — the only place the loss can be prevented is the builder that binds it.

The same commitment preimage is implemented **three** times: `client/client-v2.mjs:668`, `model.mjs:713-726`, and `state.rs:26` (plus the svm test at `core_g2_lifecycle.rs:71`).

## The finding

| builder | validates `side` | validates `probability` |
| --- | --- | --- |
| `client/client-v2.mjs` `commitmentHash` (line 662) | yes — `throw new RangeError('side must be 0 or 1')` | **no** — `u16(probability)` accepts 0…65535 |
| `model.mjs` `commitmentHash` (line 713) | yes — `fail('BAD_SIDE')` | **no** — `u16(probability, …)` accepts 0…65535 |
| program (reveal) | yes | yes, but only after the stake is committed |

So **both** JS builders reject a bad side and accept a bad probability, in the same function, two lines apart. Codex proposed the three-line guard for `client-v2.mjs`; `model.mjs` needs the identical guard or the second builder still mints unrevealable commitments. `model.mjs` already knows the bound — it enforces `probability < 1 || probability >= 10_000` at line 1330, but only in the **result-verification** path, never in its own commitment builder.

## Two things that make this worse than it looks

1. **The primitive is the public surface.** For stake there is a safety net: the raw `sealForwardIx` (line 723) encodes `u64(stake)` unchecked, but the helper `buildForwardAdmission` (line 748) validates stake against Economy bounds, `maxOpen`, credits and the ledger nonce before calling it. For probability there is **no such wrapper** — `commitmentHash` is exported directly (line 820) and is what a caller uses. Nothing downstream can catch it.
2. **There is no reveal builder in the client at all.** `client-v2.mjs` exports `sealForwardIx` and `buildForwardAdmission` but nothing that reveals, so a shot this client seals is revealed by code living somewhere else, against a preimage duplicated in three places. A divergence in any of them bricks the shot exactly as a bad probability does, and I found no round-trip test that seals with one implementation and reveals with the other.

## What I would do

- Add the guard to **both** builders, next to the existing side check: reject anything outside `1 ≤ p ≤ 9999` — which rejects 0, 10000 and 65535 by construction rather than by enumerating them.
- Add one round-trip test that builds a commitment with `client-v2.mjs`, reveals it against `model.mjs`'s verification path, and asserts the hashes agree — that pins the three implementations to each other and would have caught this class rather than this instance.
- Optional, cheap: have `sealForwardIx` re-check the stake bounds it is given, so the raw builder is not weaker than its helper.

Severity is the same as Codex's: a value-bearing shot sealed and then unrevealable. The recovery path is `forfeit` (`lib.rs:2277`), which only opens after `reveal_deadline_ts` and applies the forfeit — so the player loses rather than the funds being stuck forever. That bounds the damage but does not reduce the priority: the player loses money to a client-side omission, silently, on a value-bearing action.
