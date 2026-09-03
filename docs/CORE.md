# RatchetX Core v1 — the whole game as one frozen program

> **Status correction, 2026-09-03.** Core v1 is a devnet prototype, absent
> from mainnet and not a freeze candidate. The 2026-09-02 artifact/deployment
> used the previous protocol checkpoint instead of Pyth's signed predecessor;
> its 64-slot ring can also evict a valid crossing. The source-predecessor and
> Token-2022 client/test repairs described below are newer than that deployment,
> and the ring/confidence/ruleset design requires successor Core G2 plus Timepin.
> Do not interpret older "frozen", "done" or "cannot choose" language on this
> page as current evidence. `PERMANENCE_EXECUTION_PLAN.md` is authoritative.

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
| settle window `[expiry, expiry+120)`, void and refund after (was 900; see the decision below) | `settle`, `void_shot` |
| daily podium (UTC day), top 3 by XP earned today | `Podium` PDA, updated on every reveal |
| referee table (7 Pyth feed ids) and horizons (5/10/15/30/60/360/1440 min) | constants |
| $RCX mint | constant |
| legacy balance claim (Merkle, once per wallet) | `claim_legacy` against a compiled root |
| agent delegation: allowance, per-shot cap, expiry; seal only | `DelegateGrant`, `seal_delegated` |

There is no game-admin key, config account or pause instruction inside the
program. The devnet loader upgrade authority is still retained, and owner
direction on 2026-09-03 explicitly deferred every freeze. Core G2 will use a new
program id after the evidence architecture and migration gates are satisfied.

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
| `void_shot()` | anyone | `Sealed` shot at/past `expiry+120` → refund |
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
5. Legacy snapshot -> Merkle root compiled in -> migration build -> opt-in pilot.
6. 72 h drill with everything of ours off, then `--final`.

## Client and open runner

`client/inspect.mjs` is the signerless truth view. It defaults to the public
Solana devnet RPC at `finalized` commitment and prints
`DEVNET - NOT LIVE CREDITS` before reporting the executable program, loader,
ProgramData/upgrade authority, RPC context slots, Podium and (when supplied)
one player's ledger and canonical shot PDAs:

```sh
node onchain/ratchet-core/client/inspect.mjs
node onchain/ratchet-core/client/inspect.mjs --player <wallet>
node onchain/ratchet-core/client/inspect.mjs --rpc <standard-solana-rpc> --player <wallet>
```

It accepts no signer or keypair, sends no transaction, and has no application
API, API-key or Supabase dependency. Core account reads fail closed unless the
owner, exact allocation, discriminator and derived PDA all match.

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
same transaction, voids after the 120-second window, forfeits unrevealed shots
after an hour, and with `--close` returns shot rent to players. It never
reveals — only the salt holder can — and never needs a player key. Several
runners in parallel are harmless: a second checkpoint of the same update is a
no-op, a second settle fails on state.

## Decided 2026-09-02: the settlement window is two minutes

`settle` takes the earliest checkpointed observation at/after expiry (G1's
"checkpoint race"). In the PvP design the winner had a reason to checkpoint
at once; in Core v1 the counterparty is the credit pool, so nobody but the
player and public runners has one. With a 15-minute window and no runner
live, a player could wait and checkpoint only when the price had moved their
way — a free option on every shot, worth far more than the 59% break-even.

So `SETTLE_DEADLINE_SECS` is 120: a shot with no captured crossing within two
minutes voids and refunds — nobody gains. Two minutes is longer than any
sponsored feed's cadence (the seal rule already assumes ≤ 60 s of staleness),
so a single live runner still settles every shot; the residual option is
bounded, public, and closed entirely while any runner runs. This supersedes
the 900 s in `docs/G1_DECISION_MEMO.md`; the LiteSVM deadline cases and the
client carry 120.

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
- 2026-09-02 third build, same recipe, `Cargo.lock` unchanged: settlement
  window 900 s → 120 s (`SETTLE_DEADLINE_SECS`), nothing else.
  `artifacts/ratchet_core-v1-2026-09-02.so` — 414,360 bytes,
  sha256 `1ba4371752cf1e5de39b87ea40f4be190166032dd319cc877eaa9ccf0ded61f6`,
  executable hash (trailing zeros stripped)
  `d73331461e50bf77f847ee9e3b9a6d467ffb6d1626ccbd8cee74f6e96f2bb0f3`.
  Host 8/8, LiteSVM 8/8 (deadline cases at 119/120 s), vectors 8/8, JS client
  9/9. **Deployed on devnet** 2026-09-02 at slot 491787400 under
  `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv`; `DEVNET_EXERCISE.cmd` 6/6
  (live, sponsored SOL referee receiver-owned, real `checkpoint`, grant/revoke,
  zero-credit seal refused `InsufficientCredits`). Not on mainnet.
- 2026-09-02 reproducibility: a clean rebuild of the committed source (lib.rs
  blob `185cb53f`, `Cargo.lock` `9d10758f`) in an empty target directory with
  the same recipe produced `1ba43717…` again, byte for byte.
  `.github/workflows/core-build.yml` now does this on every push that touches
  `onchain/ratchet-core/`: host tests, golden vectors diffed against
  `vectors/core-rules-v1.json`, `cargo build-sbf`, sha256 must equal the newest
  `artifacts/*.so` (else red), LiteSVM battery on the fresh bytes, and an
  informational dump-and-compare of the program deployed on devnet (or
  mainnet-beta via "Run workflow"). A build no longer needs any particular
  machine or session; artifacts are named `ratchet_core-v1-YYYY-MM-DD[-n].so`
  so the newest sorts last.
- 2026-09-03 fourth build, source commit `848ab24`, same pinned CI recipe.
  `artifacts/ratchet_core-v1-2026-09-03.so` - 414,344 bytes, sha256
  `ca09f0a830d0b523d0f39a27bf66f47fdc18e9deb5816f4ddf99de77d4e1ef80`.
  GitHub Actions run `33696960306` produced the bundle after host tests,
  golden-vector comparison and SBF build passed; its expected first failure was
  comparison with the older committed artifact. The downloaded CI lockfile and
  vectors hash-match the repository, and the exact `.so` passes the nine-case
  LiteSVM battery including signed-source gaps and real Token-2022 reload.
  Follow-up run `33697443251` is green through fresh-byte equality and the
  LiteSVM battery on those exact pinned-toolchain bytes.
  This repairs `checkpoint` to retain Pyth's signed `prev_publish_time`; it does
  not remove the evicting ring or add confidence/ruleset evidence, is not
  deployed, and is explicitly not a permanent or mainnet candidate.
- devnet faucet flavour (separate crate `onchain/ratchet-core-devnet`, id
  `CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx`, mint PDA
  `9Becn57cNDJmRMrEBwtGbgfzY8eUF7VNjsgrQbfLpBRm`): sha256
  `0558b594c66e5112ecbb3d029d21212bd81c0f7644256ef35fff92446cdb2aa0`. Devnet
  only, never the mainnet id; exists because adding the faucet under a cargo
  feature to the mainnet crate changed the mainnet bytes (measured).
