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
- **Trustless.** The posted price is Pyth-signed and receiver-verified on-chain;
  anyone can post it from the keyless Hermes mirror, so no founder is in the loop.
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
