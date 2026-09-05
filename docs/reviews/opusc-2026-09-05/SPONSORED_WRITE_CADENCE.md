# Sponsored write cadence, measured from the ledger — SOL/USD, 2026-09-05

**Author:** Opus C. **Evidence tier:** `mainnet`, read-only, keyless, no transaction sent.
**Feed:** `Crypto.SOL/USD`, `ef0d8b6f…b56d`. **Account:** `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`.
**RPC:** `https://solana-rpc.publicnode.com` (no key, no account).
**Reproduce:** `node onchain/rcx-timepin-v2/scripts/ledger-cadence.mjs walk --symbol SOL --hours 1`

This is **not** the 24-hour measurement GATE 2 requires. It is 19.6 minutes, one feed, and it
exists to establish the method and to answer three questions that were open in `ROOM.md` while
Opus A was writing the rule.

## Method, and why not the obvious one

`cadence-sampler.mjs` polls the sponsored **account**. An account holds one message at a time, so
a print overwritten between two polls is invisible, and it needs a process awake for the whole
window. This walked the **ledger** instead: `getSignaturesForAddress` on the sponsored account,
then `getTransaction … encoding=base64` on each signature, then locate the 32-byte feed id inside
the raw transaction and read the big-endian `PriceFeedMessage` that follows it.

Two self-checks make a coincidental byte match impossible to count: the exponent must be a
plausible Pyth exponent, and the publish time must sit within 120 s of the transaction's own
`blockTime`, which the ledger supplies and the bytes cannot forge. The very first decode was
cross-checked against the same feed's **live account** decoded by `model-v2.mjs`
`decodePriceUpdateV2` — two independent paths, one answer.

**The trap this method exists to avoid.** `getSignaturesForAddress` returned 1000 signatures over
34.6 minutes — 28.9/min, one every 2.07 s, with 473 zero-second gaps. Read naively that refutes
"push every 5 s". It does not: that call returns every transaction *mentioning* the account, and a
Pyth price account is read by every program using the oracle. Classified by whether our account is
writable: **5 writes in 16 sampled**, and **235 writes in 598 signatures** in the full scan — about
35 %. *Anyone computing a push cadence from raw signature counts overestimates it by ~3×.*

## The numbers — 235 writes over 19.6 minutes

| Quantity | Result |
| --- | --- |
| Writes recovered | 235 |
| Distinct `publish_time` | **235 — zero duplicates** |
| `publish_time` gap histogram | `{5 s: 232, 7 s: 1, 9 s: 1}` |
| `publish_time − prev_publish_time` | `{1: 235}` — always 1 |
| `blockTime − publish_time` | `{0 s: 146, 1 s: 89}` — on chain within one second, always |
| Failed write transactions | **0** |
| `publish_time mod 5` | `{1: 115, 2: 116, 3: 4}` — **the phase moved through three values** |
| MIN-CAPTURE first-print lag, grid 60 (19 targets) | `{1 s: 9, 2 s: 10}` — never worse than 2 s |
| Strict bracket hits, same 19 targets | **0** |

## Three conclusions, and one correction of my own

**1. There is no tie on the pinned sponsored account.** 235 writes, 235 distinct publish times.
Fable's `uniqueness_check.js` found up to three distinct signed messages sharing a `publish_time`
in the Pythnet accumulator **ring**, which carries every aggregate at ~2.5/s. The sponsor posts
**one** of them every 5 s. Adapter 1 reads the account, pinned by `sponsored_price_address(spec)`
and `write_authority` (`lifecycle.rs:1245-1280`), so the repeats do not reach it. This is 19.6
minutes and does not settle the question forever — but it is the first direct measurement of it on
the path the rule actually uses, and it is cheap to extend to a day.

**2. The strict bracket has a duty cycle, it is not dead.** `prev = pub − 1` always, so
`prev < T <= pub` requires `T == pub` exactly. Every `pub` is `≡ 1..3 mod 5` in this window and
every grid target is `≡ 0 mod 5`, so the sets are disjoint and the bracket is 0/19. **But the phase
does not hold still — it sweeps**, ~1 s per 10 min, completing a 5 s cycle in roughly 50 minutes.
So the phase sits on 0 for about a fifth of every cycle, and during those windows the bracket
*would* hit. Fable's 0/25 and this 0/19 are two windows that both missed the good fifth.

The honest statement is **not** "the bracket never works". It is: *the bracket is a rule with a
~20 % duty cycle, and which fifth of the hour you are in is somebody else's cron.* That is still
NO-GO as canonical, and it makes the phase-pin (tracker verdict C) **worse**, not better — a
write-once `target_grid_phase_seconds` would pin a value that sweeps past it every ~50 minutes.
Nobody should carry "0/25" around as if the rule were dead in all phases: a 24-hour sample will
show it alive about a fifth of the time, and someone will read that as a contradiction. It is the
same fact.

**3. My own 11:47Z claim was wrong and this corrects it.** On an 8.8-minute window that was 100 %
phase 2 I told the room the phase drift was slower than Fable's line implied. Over 19.6 minutes the
phase moved through three values. She was right; I was reading noise as stability.

## The finding that changes the schedule

**The 24-hour measurement does not need 24 hours of wall clock.** The history is already on chain.
Paginating `getSignaturesForAddress` backwards reached `blockTime 1788572871` — **ten hours old** —
and `getTransaction` still resolved at that depth. A full day is reconstructible *today*, with no
awake machine, no 1 s poll, and **no blind spot**.

The limit is the RPC, not the ledger: `publicnode` stopped at 18 pages with *"Rate limit exceeded.
To obtain higher limits, please request a personal token or a dedicated node."* A bulk pull needs
patience and backoff — **not a token**. `ledger-cadence.mjs` backs off exponentially to 60 s and
keeps the data; it is append-only, so a kill leaves a valid file.

## What is still owed

- 24 h × 7 feeds, by either collector, reduced by `cadence-sampler.mjs summarize`, committed to
  `docs/reviews/cadence/`. Until then `test_timepin_cadence_policy.mjs` refuses any
  `releases/g2-mainnet-economy.json`, and it is right to.
- The tie question at day scale, on all seven feeds, not 19.6 minutes on one.
- The drift rate measured over hours rather than inferred from a 20-minute slope.

---

# Addendum, ~12:20Z — one walk instead of seven

**Evidence tier:** `mainnet`, read-only, keyless. Same method.

The 24 h collection looked infeasible at ~292,000 `getTransaction` calls (41,760 signatures per
feed per day × 7 feeds, of which only ~35 % are writes). It is not, and the reason is that we were
walking the wrong address.

## The sponsor has one fee payer, and it signs nothing but pushes

`9F6ApEtzkHVdZXzsury6BYmyEh4pahDBxuhNLaGC6saC`

| Measurement | Result |
| --- | --- |
| Fee payer of sampled SOL writes | **25 of 25** are that address |
| Its own signature list | **1000 transactions in 998 s = 1.00 tx/s** |
| Failed transactions on the payer | **0 %** (vs 7.4 % `err` on the price account's list — those were readers) |
| Feeds per push transaction | **one** (4/4 sampled, 1150 bytes each — no batching today) |
| Of 30 sampled payer transactions | 12 carried one of our seven feeds, 18 carried other Pyth feeds |

So the payer signs the pushes for every feed it sponsors, and nothing else. Walking it:

```
per-account   ~41,760 signatures/day/feed × 7 feeds ≈ 292,000 getTransaction, 65 % of them readers
per-payer     ~86,400 transactions/day, ALL SEVEN FEEDS, one pass, zero reader waste
```

**~3.4× cheaper, one walk instead of seven, and no failed transactions to filter.** At 10 req/s that
is under three hours for a full day of history — an evening, not a day.

## The assumption that would have made it wrong

A payer walk is complete **only if that payer is the only one posting those feeds**. If the sponsor
rotates payers, the walk silently misses writes — which is precisely the blind spot the ledger
method exists to remove, smuggled back in as an optimisation, and it would produce a cadence table
with invented gaps and no way to tell.

So it is a checked precondition, not a comment. `verifyPayerCoverage()` samples the *price
account's* own writes (separating them from the 55-65 % readers by whether the account is writable
in that transaction) and `walkPayer()` **refuses to start** unless every sampled write came from one
payer, naming the others if not. Measured today: single payer, 25/25.

```
node onchain/rcx-timepin-v2/scripts/ledger-cadence.mjs check-payer --symbol SOL
node onchain/rcx-timepin-v2/scripts/ledger-cadence.mjs walk-payer --hours 24 --delay-ms 100
node onchain/rcx-timepin-v2/scripts/cadence-sampler.mjs summarize --in docs/reviews/cadence/payer-*.ndjson
```

The payer is **discovered**, not hardcoded: `walkPayer` derives it from the price account's own
writes at start-up, so a sponsor that changes address is detected rather than followed blindly.

---

# Addendum 2, 14:04Z — the answer is TWO payers, and the guard is what found it

**Measured by Svemir** on the laptop, `check-payer --all`, publicnode, no key, no retries on 429;
started 13:52:02Z, finished 13:52:35Z. **Evidence tier: `mainnet`.**

| payer | feeds | coverage |
| --- | --- | --- |
| `9F6ApEtzkHVdZXzsury6BYmyEh4pahDBxuhNLaGC6saC` | SOL, BTC | 100 % over 12 sampled writes each |
| `4p16wya1Vw2u9w22oah4yXQgySb6eWKRRLMsEXCreish` | ETH, BONK, PUMP, JUP, WIF | 100 % over 12 sampled writes each |

**Every one of the seven feeds has exactly one payer, and there are two payers.** The five that the
first addendum could not account for are accounted for.

## What this settles

1. **A payer walk needs exactly TWO runs.** Not one — my 12:26 claim, refuted at 13:09 — and not
   seven. `groupFeedsByPayer` prints the two lines; each is one `walk-payer` invocation with its own
   feed table.
2. **The two-population split runs all the way down.** It is not only a cadence difference (5 s vs
   ~52 s) and a window-utilisation difference (12 % vs 90–98 %): the two groups have **different
   sponsors**. Whatever decision is taken about the slow five — grid, lag, or dropping them — it is a
   decision about a different pusher, not about a slower setting on the same one.
3. **The cost is dominated by the fast payer.** `9F6ApEtz` runs at 1.00 tx/s (measured, 1000
   transactions in 998 s), so ~86,400 transactions/day; the slow-five payer posts roughly
   5 × 1,662 = ~8,300 writes/day for our feeds. At the measured 6.34× real-time walk rate, a full day
   of history is about 3.8 h for the fast payer and much less for the slow one.

## The part worth keeping

The guard is what produced this. At 12:26 I claimed one payer covered all seven feeds and committed a
coverage check to make that claim safe — and the check tested `feeds[0]` and generalised. The data
refuted it at 13:09; the fix (`3996979`) made coverage per feed and added the grouping; and the
grouping is what turned "who posts the other five?" into a single command whose output is the answer.

A guard that only confirms what you already believe is decoration. This one contradicted its author
twice — once by being wrong, once by being right — and the second time it printed the job plan.
