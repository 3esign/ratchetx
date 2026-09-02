# RatchetX Core v1 — the whole game as one frozen program

Program id: `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` (keypair generated
2026-09-02 on the founder's machine, outside every repository).
Source: `onchain/ratchet-core/programs/ratchet-core/src/lib.rs`.
Toolchain: anchor-lang 1.0.2, pyth-solana-receiver-sdk 2.0.0 (pro-compatible),
solana 3.1.10 / platform-tools v1.52 — the same recipe that reproduced Seal v2
byte for byte.

Core is Seal v2 plus the economy. Seal v2 proved the referee on mainnet: a
sponsored Pyth push update read in-program, a permissionless checkpoint clock,
settlement on the unique first update crossing expiry, equality is void. Core
keeps that code path unchanged and adds everything the server used to decide.

## What lives on chain (and nowhere else)

| rule | where |
|---|---|
| play credits (non-redeemable) | `PlayerLedger.credits` |
| stake 100..1e9, debited at seal, 1.7x back on HIT, refunded on VOID | `seal`, `reveal`, `settle`/`void_shot` |
| RCX reload: burn 70%, pay 30% to the live daily podium 50/30/20, credits 1:1 per whole token | `reload` — in the player's own transaction; the program never holds a token |
| XP: `max(1, round(base_xp(minutes) * min(20, sqrt(stake/100))))` at seal; on HIT `max(1, round(xp * min(2, 1 + 0.15*streak))) + 1`; on MISS `+1` — rounded exactly in integers, half up | `seal_xp`, `skill_xp` (golden vectors shared with the server) |
| rank thresholds 0/300/900/2200/5000, chambers `min(4, rank+1)+1` | `rank_of`, `chambers_for` |
| seal freshness `min(60, max(30, 0.15 * window))` s, confidence ≤ 200 bps | `max_seal_age`, `check_confidence` |
| settle window `[expiry, expiry+900)`, void after | `settle`, `void_shot` |
| daily podium (UTC day), top 3 by XP earned today | `Podium` PDA, updated on every reveal |
| referee table (7 Pyth feed ids) and horizons (5/10/15/30/60/360/1440 min) | constants |
| $RCX mint | constant |
| legacy balance claim (Merkle, once per wallet) | `claim_legacy` against a compiled root |
| agent delegation: allowance, per-shot cap, expiry; seal only | `DelegateGrant`, `seal_delegated` |

There is no admin key, no config account, no pause, no upgrade hook. Every
number above is a constant in the bytes. The upgrade authority is burned after
the G6 drill; from then on the only way to change a rule is a successor program
under a new id that reads these accounts.

## Instructions

| ix | signer | effect |
|---|---|---|
| `reload(amount)` | player | burn 70% (or all if no podium in the last two UTC days / seat ATA missing), transfer_checked 30% split to seat ATAs passed as remaining accounts, credits += amount / 10^decimals |
| `seal(nonce, commit, feed_index, minutes, stake)` | player | reads the sponsored Pyth account (owner = receiver, PDA = push oracle shard 0, Full verification, fresh, tight), debits stake, opens a chamber, stores entry price |
| `seal_delegated(...)` | delegate | same, under an unexpired grant; allowance shrinks by stake |
| `checkpoint(feed_index)` | anyone | records a verified update into the feed's ring clock (64 observations) |
| `settle()` | anyone | first crossing in the strict window → `Settled` (or `Voided` on equality, refund) |
| `reveal(side, p_bps, salt)` | anyone with the salt | verifies `RATCHET\|v3\|<wallet>\|<nonce>\|<YES/NO>\|<p_bps>\|<salt>`, scores HIT/MISS, pays credits, updates streak/XP/daily XP/podium |
| `forfeit()` | anyone | a `Settled` shot not revealed within 3600 s of expiry becomes a MISS with no XP |
| `void_shot()` | anyone | `Sealed` shot past `expiry+900` → refund |
| `close_shot()` | anyone | rent back to the player once the shot is Revealed/Voided/Forfeited |
| `grant_delegate(allowance, max_stake, expiry)` / `revoke_delegate()` | player | bounded delegation, ≤ 30 days |
| `claim_legacy(credits, xp, proof)` | player | one-time Merkle claim; leaf = sha256(wallet ‖ credits_le ‖ xp_le) |

## Deliberate absences

- **No welcome grant.** On the server a new wallet got 5,000 credits once. On
  chain that is free XP → podium → RCX for every fresh keypair. Entry is a
  reload or a legacy claim. (Soft-staking credits are likewise out.)
- **No Brier / calibration state.** `p_bps` is stored on every revealed shot,
  so any successor or indexer computes it from public records; the first frozen
  program stays small.
- **No threshold / race / range shots.** Only directional `kind 0` is scored,
  as decided for v3 (one comparison, nothing to farm).
- **No board.** Any supported feed × horizon can be sealed at any time; a
  client may present a "board", the program does not care.
- **No off-chain oracle input.** Entry and exit prices come only from the
  sponsored push account inside the transaction.

## Trust boundary after freeze

Depends on: Solana, the Pyth receiver program that owns the sponsored accounts
(one compiled generation; when it dies, sealing stops and open shots void by
rule), RPC availability, rent. Depends on nobody: not the founder, not the
website, not Bankr, not Supabase.

## What still has to happen (G-plan)

1. ~~SBF build with the v1.52 recipe; record the executable hash.~~ done, see the
   build record.
2. ~~Localnet exercise of every instruction, including the adversarial set~~
   done on LiteSVM (`svm-tests/`, 8 batteries: replay, wrong delegate, expired
   grant, cap races, ring wrap, forfeit, equality, deadline void, oracle
   forgeries, reload split). Devnet run of the same client path still open.
3. ~~JS golden vectors~~ done: `vectors/core-rules-v1.json` printed by the
   program, checked by `test/test_core_vectors.mjs`; the server now computes XP
   and payout through `lib/core_rules.js`, the same integers (h108).
4. ~~Static client + open runner~~ done offline: `client/core.mjs` (every
   instruction, PDA, parser and the commit, byte-checked against the program's
   vectors by `test/test_core_client.mjs`) and `client/crank.mjs` (the open
   runner). First run against a real cluster still open (devnet, then mainnet).
5. Legacy snapshot → Merkle root compiled in → migration build → capped pilot.
6. 72 h drill with everything of ours off, then `--final`.

## Client and open runner

`client/core.mjs` needs only `@solana/web3.js`: instruction builders in the
program's account order, PDAs, the sponsored push account per feed, the ATA,
the v3 commit, parsers for every account and for `PriceUpdateV2`, the crossing
rule, and `planActions` — the pure decision of what a runner may do now.
`client/crank.mjs` executes that plan in a loop:

```sh
node onchain/ratchet-core/client/crank.mjs --rpc <url> --keypair <fee payer> [--once] [--interval 5] [--close] [--dry]
```

A runner keeps each open feed's clock warm (one checkpoint when the clock is
older than five minutes, so the first post-expiry capture forms a crossing),
captures the first fully verified update at/after expiry and settles in the
same transaction, voids after the 15-minute window, forfeits unrevealed shots
after an hour, and with `--close` returns shot rent to players. It never
reveals — only the salt holder can — and never needs a player key. Several
runners in parallel are harmless: a second checkpoint of the same update is a
no-op, a second settle fails on state.

## Open decision before freeze: the settlement window is a free option

`settle` takes the earliest checkpointed observation at/after expiry (G1's
"checkpoint race"). In the PvP design the winner had a reason to checkpoint
at once; in Core v1 the counterparty is the credit pool, so nobody but the
player and public runners has one. If no runner is live, a player may wait
inside `[expiry, expiry+900)` and checkpoint only when the price has moved
their way — a 15-minute option on every shot, worth far more than the 59%
break-even. Runners close the option while they run; "nothing depends on us"
means the rule must hold with none running.

Recommendation: `SETTLE_DEADLINE_SECS` 900 → 120. A shot with no capture
within two minutes voids and refunds — nobody gains, and two minutes is
longer than any sponsored feed's cadence (the seal rule already assumes ≤ 60 s
of staleness), so a single live runner still settles every shot. The residual
two-minute option is bounded and public. This changes a published number in
`docs/G1_DECISION_MEMO.md` and the LiteSVM battery's deadline cases, so it is
the founder's call, not a silent edit; the program in the build record still
carries 900.

## Tests, and how to run them

- Host unit tests (rules, podium, ledger): `cargo test` in `onchain/ratchet-core`.
- LiteSVM battery (the program bytes under a hostile client, no network, no
  keys, no validator): `cargo test` in `onchain/ratchet-core/svm-tests`. It
  loads `../target/deploy/ratchet_core.so` when a build exists, otherwise the
  newest file in `../artifacts/` — so it also runs against the committed bytes;
  `RATCHET_CORE_SO=<path>` overrides. Pyth accounts are hand-built
  `PriceUpdateV2` records under the real receiver id and push-oracle PDA, so
  every forgery the program must reject (wrong owner, wrong PDA, partial
  verification, stale, wide confidence, wrong feed) is tried.
- Golden vectors: `cargo test print_golden_vectors -- --ignored --nocapture`
  prints `vectors/core-rules-v1.json` (between the BEGIN/END markers): rule
  constants and XP/payout/rank grids, the feed table with push accounts,
  instruction encodings, account discriminators, sizes, serialized samples,
  PDAs and the commit. `node --test test/test_core_vectors.mjs
  test/test_core_client.mjs` from the repo checks the server and the JS client
  against it. Re-print whenever a rule constant changes; the JSON is the
  contract between the two.

## Build record

- 2026-09-02 first SBF build (cloud, recipe of Seal v2): platform-tools v1.52,
  cargo-build-sbf 3.1.10, anchor-lang 1.0.2, anchor-spl 1.0.2,
  pyth-solana-receiver-sdk 2.0.0, `Cargo.lock` committed.
  413,288 bytes, sha256 `4dfa81f028d3b1d7ee6c3bca9f66bb885fd2269addb0b24310a4cd6d13224432`
  (stripped `b42b969379f1813a1d69539ff5e6461bfb191fad21b439f2442297a669c528d0`).
  Superseded the same day — never deployed. Two findings from the LiteSVM
  battery against it: (a) `reload` failed with PrivilegeEscalation because the
  `mint` account was not declared `mut` — the burn CPI writes the supply; (b)
  `seal_xp` truncated sqrt to hundredths, off by one XP against the live server
  in ~0.14% of (base, stake) pairs (e.g. base 24, stake 105: 24.59 → 24 instead
  of 25). Both fixed in source.
- 2026-09-02 second build, same recipe, `Cargo.lock` unchanged.
  `artifacts/ratchet_core-v1-2026-09-02.so` — 414,360 bytes,
  sha256 `4edf23dbfe1542dc90564c9badecc8a216d6cb13f2ce0a588421396be145c328`,
  executable hash (trailing zeros stripped)
  `fddebb11e990f3a6a748b0f2222468986f527120b787ddc4080c540daa7d50f9`.
  Not deployed anywhere yet. Host unit tests 8/8, LiteSVM battery 8/8, golden
  vectors 8/8 against the server's `lib/core_rules.js`.
