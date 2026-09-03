> **RETIRED 2026-09-02. Do not apply this patch.** Kept because the engineering
> is sound and the measurements are worth having, not because it is a candidate
> any more.
>
> The pull path needs a signed `PriceUpdateV2` to post, and a signed update comes
> from Hermes, and **Hermes has required an API key on every host since the
> 2026-08-26 Pyth Core upgrade** — measured server-side on both hosts, for SOL
> exactly as for TSLA (commit `04ae938`). The decision on 2026-09-02 is that
> RatchetX buys no credentials: a key is exactly the dependency the frozen core
> exists not to have. So the rail this patch rides is closed, and closed by a
> rule rather than by an outage.
>
> The free alternative was measured the same day and does not clear the bar
> either: tokenized xStocks are filed under `Crypto.*` at sponsored push accounts
> the program can already read (commit `86da685`, `docs/STOCKS_ONCHAIN_TOKENIZED.md`),
> but they publish on an **~870-second batch cadence** against a 60-second seal
> bound — about **7%** of stock seals would land. A feature that refuses six
> times out of seven is not a feature.
>
> **So stocks are held, not cancelled.** Both findings stay on record. If any
> publisher speeds up, adopting them is one line in the feed table — not this
> patch. Note also what this patch was really routing around: an absence we had
> placed in the wrong asset class. It was built to get equities onto a rail that
> turned out to be gated for *crypto* too.

# Equity pull — a proven pre-freeze candidate (not built into the frozen core yet)

Stocks on the same trustless rails as SOL, via the Pyth **pull** path from
`docs/STOCKS_FEEDS.md`. This is a candidate: implemented, built and proven with
the full test battery in the cloud. **Nothing here is deployed or frozen.** The
program on `main` is still the crypto-only candidate `1ba43717…`; adopt this by
applying the patch and running the pre-freeze build (ideally combined with the
legacy build, so there is one new frozen candidate, not two).

## What it does, in one paragraph

Crypto feeds (indices 0–6) keep reading their sponsored shard-0 **push** account
exactly as before. Equity feeds (indices 7–11: TSLA, NVDA, PLTR, COIN, HOOD) are
**pull**: the crank posts a fully verified `PriceUpdateV2` in the same
transaction, and the program reads that posted account instead of a sponsored
PDA. Trust rests on `owner == Pyth receiver` + `Full` verification + a matching
`feed_id` — exactly what the Pyth pull receiver guarantees. The clock ring, the
first-crossing rule, `settle`, `reveal`, XP and payout are **untouched**; only
how a price enters the program differs.

## The change (localized, three edits + the vectors printer)

1. `FEEDS: [[u8;32]; 7] → [[u8;32]; 12]` — the five Equity.Index feed ids
   appended, plus `PULL_FROM_INDEX = 7` and `feed_is_pull(index)`.
2. `load_push_price_update → load_price_update(ai, feed_id, pull)`. The push
   branch keeps the **same check order** as before (owner → address == PDA →
   deserialize → write_authority == PDA → Full), so push behaviour is byte
   identical. The pull branch skips the two sponsored-PDA constraints and
   instead requires the posted update's `feed_id` to match:

   ```rust
   fn load_price_update(ai, feed_id, pull) -> Result<PriceUpdateV2> {
       require!(*ai.owner == PYTH_RECEIVER_ID, BadPriceAccount);
       let expected_feed = if pull { None } else {
           let (e,_) = find_program_address([u16le(0), feed_id], PYTH_PUSH_ORACLE_ID);
           require!(ai.key() == e, BadPriceAccount);          // push: sponsored PDA only
           Some(e)
       };
       let update = PriceUpdateV2::try_deserialize(...)?;
       match expected_feed {
           Some(e) => require!(update.write_authority == e, BadPriceAccount), // push
           None    => require!(update.price_message.feed_id == *feed_id, BadFeed), // pull
       }
       require!(update.verification_level.gte(Full), PartialVerification);
       Ok(update)
   }
   ```
3. `checkpoint` and `seal_inner` pass `feed_is_pull(feed_index)` to the loader.
   The golden-vectors printer emits `"pull":true` (no `pushAccount`) for the
   equity feeds, `"pull":false` for the crypto feeds.

## Why it is safe

- **Push feeds cannot be loosened.** A crypto feed still requires its exact
  sponsored PDA and PDA write-authority. Test `pull_guards_hold_and_push_stays_strict`
  case 4 proves an arbitrary receiver-owned, fully verified SOL account is
  refused (`BadPriceAccount`).
- **Pull feeds cannot be forged.** The same test proves a stranger-owned posted
  account (`BadPriceAccount`), a partially verified one (`PartialVerification`),
  and one carrying the wrong feed id (`BadFeed`) are all refused.
- **Nobody can pick the price.** The posted price is Pyth-signed and
  receiver-verified on-chain; anyone can post it from the keyless Hermes mirror,
  so no founder is in the loop. Note what that is and is not: it is
  fabrication-resistance and open access. It is not trustlessness, because it
  does not make anyone post, and for equities the set of parties willing to pay
  for a post is smaller than for crypto.
- **Same safety valve.** An equity shot with no posted crossing inside the 120 s
  window voids and refunds, exactly like a quiet feed today.

## Proof (in the cloud, against the frozen recipe)

- Build: `cargo build-sbf`, agave 3.1.10 / platform-tools v1.52 →
  `ratchet_core.so` **415,112 bytes, sha256
  `15000b8cb85bcc8d0383839b85d9ab8b33ec76f5ca91ed2c52861edce74a909a`**
  (the crypto-only candidate is `1ba43717…`, 414,360 bytes — this is a distinct,
  larger binary, as expected from five extra feeds and one branch).
- Host unit tests: **8/8** (incl. `feed_table_is_the_live_referee_table` with the
  new `FEEDS.len()==12`, `feed_is_pull(6)==false`, `feed_is_pull(7)==true`).
- LiteSVM adversarial battery: **10/10** — the 8 originals unchanged, plus
  `equity_pull_feed_seals_settles_and_hits` (full life on TSLA: post → seal →
  warm → crossing checkpoint → settle → reveal HIT, ledger 1000 − 500 + 850 =
  1350) and `pull_guards_hold_and_push_stays_strict` (the four refusals above).
- Golden vectors reprinted: `candidates/core-rules-equity.json` — 12 feeds, 7–11
  `pull:true`.

## Adoption (the founder's build decision — NOT done here)

This is the one stocks change that must land **before freeze** (the feed table is
compiled in forever). To adopt:

1. `git apply onchain/ratchet-core/candidates/equity-pull.patch` (program +
   harness), then `cargo build-sbf` — reproduces `15000b8c…`.
2. Fold into the pre-freeze build (ideally the same build as the legacy root, so
   there is one final frozen candidate). Record its sha in `docs/CORE.md`; put
   the `.so` under `onchain/ratchet-core/artifacts/`; the CI `core-build` job
   rebuilds, diffs vectors, runs the battery, and turns green.
3. Replace `onchain/ratchet-core/vectors/core-rules-v1.json` with the reprinted
   vectors and update the pinned readers: server `lib/core_rules.js` /
   the board generator and client `client/core.mjs` `FEEDS` — add the five
   equities with a `pull` flag.
4. Crank equity branch (`client/crank.mjs`): for an open equity shot near expiry,
   fetch the `Equity.Index` update from the keyless Hermes
   (`https://pyth.dourolabs.app/hermes`), post it with
   `@pythnetwork/pyth-solana-receiver`, then checkpoint/settle against the posted
   account in the same transaction (`closeUpdateAccounts: true` reclaims rent).
5. UI: label equity targets `Pyth 24/7 index` (a continuous synthetic mark
   overnight), never "NASDAQ".

The program change (steps 1–2) is the part that had to be right before freeze,
and it is proven. Steps 3–5 are runtime wiring that ships with the build.

## Pre-freeze verification: the five feed ids (2026-09-02)

Checked against the same keyless Hermes mirror the crank posts from
(`pyth.dourolabs.app/hermes/v2/price_feeds?asset_type=equity`). Every id
compiled into the candidate resolves to a real Pyth feed, and every one is the
**Equity.Index (24/7)** variant — deliberately, not the market-hours `Equity.US`
variant, which also exists under the same ticker:

| feed | id compiled in | resolves to |
| --- | --- | --- |
| TSLA | `e6da44bf…ae3fc0` | `Equity.Index.TSLA/USD` — "PYTH PRICE IN USD FOR TSLA 24/7" |
| NVDA | `a470c4ac…27b852` | `Equity.Index.NVDA/USD` |
| PLTR | `52c7c6b7…400bb9` | `Equity.Index.PLTR/USD` |
| COIN | `49387483…7db1ac` | `Equity.Index.COIN/USD` |
| HOOD | `4a4f9628…70a630` | `Equity.Index.HOOD/USD` |

(For contrast, the market-hours ids are TSLA `16dad506…`, NVDA `b1073854…`,
PLTR `11a70634…`, COIN `fee33f2a…`, HOOD `306736a4…`. Those are NOT in the table.)

**Why 24/7 is the right table entry.** The machine seals shots around the clock.
`Equity.US.*` publishes only inside US market hours, so an overnight or weekend
equity shot would fail the freshness guard and void every time. The 24/7 index
keeps a continuous mark, so the clock ring and the first-crossing rule work for
equities exactly as they already do for SOL. No rule change needed.

**Consequence for the runtime rule — not for the frozen table.** Because the mark
is continuous there is no oracle-level "market closed": a shot outside US hours
is settleable. The FINISH_PLAN gate as written ("refused outside hours, post-close
expiry voids with refund") assumed the market-hours feed and does not describe
this table. Two honest options, both leaving the frozen ids untouched:

  a) allow 24/7 play and label every equity target **"Pyth 24/7 index"** (never
     "NASDAQ"), stating plainly that outside US hours the mark is Pyth's synthetic
     price and can diverge from the next open; or
  b) keep the 24/7 feed but have the server and UI refuse equity seals outside a
     declared market-hours window.

This is a runtime/UI decision for Semir. It does not block the freeze.

**Gate status: feed table VERIFIED — safe to compile.**

## Independently reproduced, and the binary is now in the repo (2026-09-02)

The candidate above was built once and its `.so` was not kept, so the hash it
claimed rested on a record of a build nobody could repeat. It has now been
rebuilt from scratch — clean tree, patch applied, no cached target — and it
lands on the same bytes:

| | |
| --- | --- |
| toolchain | `solana-cargo-build-sbf 3.1.10`, platform-tools **v1.52**, rustc 1.89.0 |
| output | `target/deploy/ratchet_core.so`, **415,112 bytes** |
| sha256 | `15000b8cb85bcc8d0383839b85d9ab8b33ec76f5ca91ed2c52861edce74a909a` |
| host unit tests | **8/8** (`feed_table_is_the_live_referee_table` sees `FEEDS.len()==12`) |
| LiteSVM battery | **10/10**, including `equity_pull_feed_seals_settles_and_hits` and `pull_guards_hold_and_push_stays_strict` |
| golden vectors | reprinted and **byte-identical** to `candidates/core-rules-equity.json` |

The binary is kept at `artifacts/ratchet_core-equity-2026-09-02.so`, beside the
crypto-only `ratchet_core-v1-2026-09-02.so`. A hash in a document proves nothing
on its own; the artifact and the recipe that reproduces it are the claim.

### What is deliberately NOT done yet

`vectors/core-rules-v1.json` and every reader pinned to it — `lib/core_rules.js`,
`client/core.mjs`, `drift-check.mjs`, `test_core_vectors.mjs` — still describe
the **seven-feed program that is actually on chain**. That is the point of those
files: they say what the deployed referee does, and `drift-check` is only
meaningful while they do. Swapping them to twelve feeds before the twelve-feed
program is deployed would make every one of those checks pass against a table no
chain implements — a green light for something that does not exist.

So the order on deploy day is: deploy this binary, confirm the on-chain hash,
then swap the vectors and the four readers in one commit, then verify, and only
then revoke. Not before.

Historical note: an earlier server draft exposed `H*S0..S2` through an
authenticated Hermes merge. h113 removed that path and the slots: a secret
cannot enable an economic feature. Stocks stay held until a sponsored,
API-keyless on-chain equity account satisfies the same rule as crypto.
