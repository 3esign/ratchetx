# RESURRECTION.md — restoring a saved machine

RATCHET state is portable, but portability is not automatic immortality. A saved, verified
snapshot plus this repository can restore the game on fresh hosting. State created after the
newest saved snapshot cannot be recovered.

## What Solana proves

The token's mint and freeze authorities are revoked. Player memo transactions can timestamp event
log heads (`RATCHET|<i>|<hash>`). Daily balance-root events can then be covered by a later anchor.
These anchors prove that the corresponding fingerprints existed by that Solana transaction; they
do not prove every current Upstash value or any mutation after the anchored checkpoint.

## What the Black Box exports

`GET https://ratchetx.xyz/api/snapshot` exports players, credit queues, incoming and self-retained
RCX receipts, replay gates, daily/weekly/all-time sorted leaderboards, podium fallback/history,
and the complete hash-chained event log. The envelope `sha256` detects any state change inside the
saved file. The log replays from `sha256("ratchet-genesis")` to `logHead`.

Keep independent copies. The operator database remains a trust boundary between anchored roots.

## Restore

1. Fork or download this repository.
2. Run `node scripts/restore.mjs snapshot.json --check`.
3. Require `chain OK` and `snapshot sha256 MATCHES`.
4. Compare an included anchored log entry with its linked Solana memo transaction.
5. Create a fresh Upstash Redis and obtain `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
6. Run:
   `KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/restore.mjs snapshot.json`
7. Deploy the `ratchet` directory and configure those KV values, `RATCHET_MINT`, the intended
   `PUBLIC_ORIGIN`, and an approved Solana RPC.

The restore script refuses a non-empty target unless `--force` is explicitly supplied. It also
refuses a missing/malformed log head, a missing log-entry hash, a broken chain, a mismatched
snapshot envelope, or a write-mode file without the complete snapshot hash.

Open shots are exported without reveal terms. Restore therefore void-refunds them instead of
guessing or leaking their side. Atomic daily, weekly and all-time XP sorted sets are recreated,
as are pending credits and readable transaction receipts.

## Honest limits

A self-contained snapshot hash detects corruption but is not an external signature: an attacker
who rewrites the entire file can compute a new hash. Event anchors and daily roots provide the
external checkpoints; verify them. Current state after the latest anchored root still depends on
the snapshot source. A restore cannot recreate unsaved state, force anyone to host the game, or
turn the legacy mainnet settlement program into the live referee or a redeemable vault.