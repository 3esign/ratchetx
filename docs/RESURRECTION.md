# RESURRECTION.md ΓÇö how anyone brings the machine back

This file exists so that RATCHET cannot die with its operator. If the site ever goes dark ΓÇö
account lapsed, operator gone, hosting failed, whatever ΓÇö **any stranger with this repo and a
snapshot can resurrect the machine, state and all, and prove the resurrected history is real.**

## What is already immortal without you doing anything

The token: mint authority revoked, freeze authority revoked, liquidity protocol-held on
PumpSwap ΓÇö nobody, including the creator, can print, freeze, or pull it. The code: this repo,
zero dependencies, deployable anywhere Vercel-shaped. The history's fingerprints: the event
log's heads are anchored into Solana memo transactions (`RATCHET|<i>|<hash>`) by players, so
the chain itself timestamps what happened, outside anyone's control.

## What the Black Box adds

`GET https://ratchetx.xyz/api/snapshot` returns the machine's entire soul: every player
(credits, XP, streaks, holder windows), every ladder, every replay-gated burn signature, the
podium, the Warden's record, and the **complete hash-chained event log**. Download it whenever
you like. The `sha256` field fingerprints the state; the log inside replays from
`sha256("ratchet-genesis")` to the exact head that players anchored on-chain. A snapshot that
has been tampered with cannot replay ΓÇö the verifier tells you the exact entry where it breaks.

Keep copies. Snapshots are the machine's black box: whoever holds the latest one holds
everything needed.

## The resurrection, step by step (Γëê15 minutes, no permission needed)

1. **Get the code**: fork or download this repo.
2. **Verify the snapshot** you hold: `node restore.mjs snapshot.json --check` ΓÇö it must print
   `chain OK` and a head hash. Cross-check that head against an on-chain anchor: open any
   anchor transaction listed (or search Solana for `RATCHET|` memos) and confirm the hash at
   that entry matches. Now you know your snapshot is the real history, not a forgery.
3. **Create fresh state storage**: an Upstash Redis (free tier is fine) ΓÇö copy its
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Load the state**: `KV_REST_API_URL=... KV_REST_API_TOKEN=... node restore.mjs snapshot.json`
5. **Deploy**: `npx vercel deploy --prod` from the repo folder. Set env vars in Vercel:
   the two KV values, `RATCHET_MINT=FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`, and
   optionally `SOLANA_RPC_URL` (a free Helius key; public RPCs are the automatic fallback).
6. Done. Same players, same credits, same log, new URL. Announce the new address wherever the
   community lives; the proof page and the anchored log speak for the continuity.

## What resurrection cannot do, honestly

It cannot recreate state lost BETWEEN the last snapshot and the outage ΓÇö take snapshots often
if you care (they're one GET). It cannot stop a live operator from changing the rules ΓÇö the
version markers and this repo make changes visible, not impossible; rules nobody can touch
require the audited on-chain program (the vault, Wave 4), which ships only after audit. And it
cannot force anyone to host the game ΓÇö it only guarantees that anyone *may*, forever, with
proof.

The machine can be paused. It can no longer be killed.
