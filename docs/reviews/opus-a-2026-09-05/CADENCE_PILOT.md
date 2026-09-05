# Cadence pilot — the seven sponsored feeds are two populations, not one

Opus A, 2026-09-05 ~11:52Z. Input to tracker item 2.3 and to Semir's reserved
decision §4.2 (`max_post_target_lag` per feed in the write-once manifest).

**Evidence tier: read-only mainnet**, 217 seconds, 106 prints, 7 feeds. No key, no
transaction. **This is a pilot, not the 24 h run** — see §4 for how to get that.

## 1. Method, and what it cannot see

Polled the seven sponsored `PriceUpdateV2` PDAs with `getMultipleAccounts` at
`confirmed`, 1 poll / 1.5 s, recording a print only when `publish_time` changed —
the same shape as `cadence-sampler.mjs`'s `print` records. Addresses derived with
the repo's own `sourceAddressFor()`; SOL resolves to
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`, which matches the committed
mainnet fixture, so the derivation is confirmed rather than assumed. Decoding uses
the offsets in `model-v2.mjs:628-650`; all seven feeds returned `feed_id` equal to
their spec value and `verification_level == Full`.

The sampler's own caveat applies unchanged and is the honest frame for every
number here: **an account holds one message at a time, so a print overwritten
between two polls is invisible.** Every gap below is therefore an *upper bound* on
the true cadence.

## 2. The result

| feed | prints | min gap | p50 | p90 | max | `publish - prev` |
| --- | --- | --- | --- | --- | --- | --- |
| SOL | 40 | 5 s | **5 s** | 5 s | 20 s | 1 on every print |
| BTC | 40 | 5 s | **5 s** | 5 s | 20 s | 1 on every print |
| ETH | 5 | 51 s | **51 s** | 52 s | 53 s | 1 on every print |
| BONK | 5 | 52 s | **52 s** | 52 s | 52 s | 1 on every print |
| PUMP | 6 | 51 s | **52 s** | 53 s | 53 s | 1 on every print |
| JUP | 5 | 51 s | **52 s** | 52 s | 53 s | 1 on every print |
| WIF | 5 | 51 s | **52 s** | 53 s | 53 s | 1 on every print |

`publish_time - prev_publish_time == 1` on **all 106 prints across all 7 feeds** —
Fable's INSPECTION finding on the sponsored channel, confirmed by a second hand
through a different endpoint.

## 3. What it means for the manifest

1. **`max_post_target_lag` cannot be one number.** Five of the seven feeds print on
   a ~52 s cadence. For those, the first print at or after a target can be up to
   ~52 s late by construction, so any bound below that voids targets *as a matter of
   the pusher's schedule*, not of market conditions. SOL and BTC are a different
   population entirely at 5 s.
2. **Even the fast feeds need headroom well above their p50.** SOL and BTC sit at
   5 s for 90 % of gaps and then show a 20 s maximum — 4× the median. A bound set
   from the median would fail on the tail. (Honest caveat: that 20 s straddles a
   window where I had been rate-limited and lost polls, so it may be a sampling
   artifact rather than a real stall. The 24 h run settles it; do not quote 20 s as
   measured truth.)
3. **The Gate 2 exit criterion is dominated by this.** "Void rate < 5 % over ≥ 60
   targets" is, for five of seven feeds, almost entirely a question of whether the
   lag bound clears their ~52 s cadence.
4. It also sharpens the product question in §4.4: a 60 s grid on a 52 s feed leaves
   very little room, and the honest options are a coarser grid for the slow feeds, a
   per-feed lag bound, or fewer feeds at launch. That is Semir's call, not an
   agent's — but he should make it knowing the feeds are two populations.

## 4. Getting the real 24 h number

`SAMPLE_CADENCE.cmd` (repo root, one click, window stays open) runs the committed
`cadence-sampler.mjs` for 24 h and then its own `summarize`. It must run **on the
laptop, not through an agent**: every agent on this bridge has no network — the
device VM has no egress and the container proxy rejects the RPCs — and a 24 h job
outlives any agent turn anyway.

Two operational facts it encodes, both measured here:

- `https://api.mainnet-beta.solana.com` (the sampler's `DEFAULT_RPC`) answers
  **403 Access forbidden** to a browser origin and rate-limits this pattern. The
  script defaults `RATCHET_RPC_URL` to `https://solana-rpc.publicnode.com`, which
  answered **100 % of paced polls, 0 errors**.
- publicnode rate-limits above roughly 1 poll/s. Polling flat out produced **114
  errors in 274 requests**; at 1 poll / 1.5 s it produced **0 errors in 59**. Do not
  lower `--interval-ms` to get more data; you will get less.

The raw records for this pilot were not committed: the browser channel caps returned
output at about 1 KB per call, so moving 106 records through it would have cost a
dozen round trips for data the 24 h run supersedes. The arithmetic above is mine, not
`summarize`'s — that is exactly why the real run should go through the committed
script, whose summariser is pure and covered by `test_timepin_cadence_policy.mjs`.
