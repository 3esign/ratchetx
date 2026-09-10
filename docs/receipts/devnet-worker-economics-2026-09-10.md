# Live devnet evidence: every permissionless step is paid

Evidence tier: **devnet with real Pyth accounts** (above exact-SBF, below mainnet).
Recorded 2026-09-10 by the same run that deployed the change.

## What was deployed

| | |
|---|---|
| Program | `ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL` (Core G2, devnet) |
| Deploy signature | `57mbD1FMEsbsPEipit18pA6q5hAuN8WukVVuJkAWcSu62X1aA2T8uG6Mc2Q2Yfq2Gvo7NH9aWHAngNmQSVBu3fVG` |
| Built artifact sha256 | `ae6db7db6f12d09ac2973a6d08d6c8ce08a4329881d4874117dea71dd5116f78` (1 027 952 bytes) |
| On-chain bytes | `solana program dump` returns 1 079 944 bytes; the first 1 027 952 hash to the **same** sha256 and the remainder is zero padding |
| Source commit | `ed3d043` |

The deploy is not trusted because it reported success. It is trusted because the
bytes on the chain are the bytes the receipt describes.

## The game that proves it

Agent `6T66H7WuZp1vuQfMjwxdkL6GLMzEMc8aJLdKoZ9gQU3W`, nonce 2,
shot PDA `495rYgfdVWJ2B6pJ2ks9vxnghfzobSUY5vG6ocUTLkjq`.
Bond unit in this economy: **50 000 lamports**.

| Step | Signature (prefix) | Shot delta | Actor delta |
|---|---|---|---|
| SealForward | `U4g3GJuWk8Us` | **+4 762 640** = rent 4 612 640 + 3 x 50 000 | player pays |
| ActivateEntry | `3KjcihjiqDgV` | **-50 000** | keeper `wJYFx75h…` **+45 000** (= +50 000 gross, -5 000 signature fee) |
| SettleFinal | `7wuK3jgdRzYJ` | **-50 000** | keeper `wJYFx75h…` **+45 000** |
| Reveal (terminal archive + close) | `5HHG48r8wC2y` | **-4 662 640**, account closed | player **+4 657 640** (rent + the third unit, because here the sealer performed the terminal step itself) |

Result: HIT, +11 XP, $101.66014828 -> $101.5275667 on real Pyth prices.

Nothing is stranded: 4 762 640 in, 4 762 640 out, across exactly three paid steps.

## Why this matters

Before `ed3d043` the only paid instruction was the terminal archive. A keeper
earned one unit for letting a game die and nothing for keeping it alive - and
`void_pending_entry` only becomes callable *because* the unpaid capture was not
done in time. The incentive pointed at neglect. It now pays the same for every
step, so advancing a game is never worse than abandoning it.

## What this does NOT show

- The void path is proved only at exact-SBF level (the sealer gets rent + two
  units back, the finalizer takes one). No live void was staged for this receipt.
- Mainnet is untouched. `WORKER_UNITS = 3` and the 50 000-lamport unit are
  devnet economy parameters; the mainnet economy manifest is write-once and
  remains Semir's decision, unapproved.
- One keeper, on one machine, on one throttled public RPC. Permissionless in the
  program is not the same as redundant in practice.
