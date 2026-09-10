# A second keeper, on a machine that is not the author's laptop

Recorded 2026-09-10. Devnet only.

## Why

Until today one keeper on one laptop advanced every game in the arcade. The
programs were permissionless; the practice was not. If that machine slept, every
open game voided, and the only reason it did not was that somebody kept it awake.

## What now exists

| | |
|---|---|
| Host | an independent Linux VPS (Frankfurt), reached over a private mesh |
| Operator | `CBB2i69g9pwH1vaeVEFR8GAAhZuKq8uFCdv45kXNPjvt` |
| Key origin | **generated on that host.** No private key was copied between machines, in either direction |
| Source | `git clone --branch main`, `npm ci --omit=dev` - the published entrypoint, not a hand-carried copy |
| Journal | its own, at its own path; it shares nothing with the laptop's |
| Supervision | a `systemd` unit, `Restart=always`, `enabled`, so it returns after a reboot without anyone logging in |
| Bound | `MemoryMax=300M` on a 458 MB machine, so a keeper cannot take the host down |

The operator was funded with 3 devnet SOL from the deploy payer. That is a
transfer of value on a test network, not a shared identity: the two keepers have
no key, journal, host or failure in common.

## Does redundancy double the cost?

This was the honest worry: two keepers racing could each open a `CandidateV2` and
burn the evidence rent twice. Measured on the first shared game (player
`6T66H7Wu...`, nonce 3):

- The Frankfurt keeper captured the entry Need (`GHPkH6Zy...`).
- The laptop keeper's next read reported that Need as `DUPLICATE` and **prepared no
  transaction for it**.

So the loser of the race stands down before spending. Redundancy costs the losing
keeper nothing but the reads. That behaviour was already in `nextOperation`; it had
simply never been exercised, because there had never been a second keeper.

## What this still does not fix

The economics are unchanged: whichever keeper wins the race pays ~1 254 760
lamports of unrecoverable rent per captured target and earns 90 000 per shot. Two
keepers make the arcade survive a sleeping laptop; they do not make running one
profitable. See `docs/receipts/devnet-worker-economics-2026-09-10.md`.

Two machines is also not "decentralised". Both are Semir's, funded from the same
payer, watching the same public RPC. It is redundancy, which is the honest word.
