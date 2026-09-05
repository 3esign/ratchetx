# RatchetX — external inspection of the mainnet preparation

**Date:** 2026-09-05, 01:40–03:10 UTC (03:40–05:10 CEST)
**Mode:** read-only, external. Nothing in the repository, the laptop working tree, the agents' staging folders, the room, the queue or the chain was modified. No agent was contacted.
**Sources actually read:** GitHub `3esign/ratchetx` `main` @ `039580b` (full clone, tests executed in a sandbox); the laptop working tree `D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean` (branch `codex/core-source-bracket`, 33 modified + ~110 untracked files, read through the Svemir mesh); the agents' staging on the PC (`data/brain/scratch/ratchetx-mainnet-20260905/*`); `ROOM.md`, `COWORK_HANDOFF.md`, `AGENTS_CHANNEL.md`, `MAINNET_PLAN.md`, `PERMANENCE_EXECUTION_PLAN.md`, `docs/reviews/*`; the live site (`ratchetx.xyz`); and a live read-only measurement of Pyth's sponsored mainnet feeds (script in Appendix B).
**Method:** three independent full-source reviews (Core G2 program, Timepin v2 program, JS clients/tests/tooling) followed by my own verification of every finding that appears below as CONFIRMED. Items marked PLAUSIBLE were not reproduced and need a test.

---

## 0. Verdict

1. **The on-chain successor cannot play a shot on mainnet as designed.** Timepin v2 admits a price only if `prev_publish_time < T ≤ publish_time`. Pyth's sponsored SOL/BTC accounts push every 5 s at a slowly drifting phase (`publish_time ≡ 2 mod 5` for 90 % of the window, sliding to 3 and 4; always `prev = publish − 1`); ETH every ~52 s. Over a 25-minute live window no minute-aligned target was ever bracketed (0 of 25 on each of SOL, BTC, ETH; 0 of 5 five-minute targets; Appendix A), and the pusher's phase drift means the rule can only ever succeed in short windows nobody controls. Every G2 shot would EXPIRE → VOID → refund. This is a one-rule design change and it must land **before** the SBPFv3 build, the vector re-pin and the ELF hash lock, or all of that is redone.
2. **The team's engineering is unusually careful and the two programs have no code-level theft path** (owner/PDA/discriminator/length/Token-2022/arithmetic all verified). The risks are economic-rule choices, liveness, the client, and release hygiene — not exploits.
3. **Production is down for players right now** (`/api/game?action=state` → HTTP 500 since ≥ 2026-09-03; the store moved to Upstash on 09-03 and exhausted the free plan's 500 K commands/month within two days). Nobody is working on it; it is a decision, not code.
4. **The next `DEPLOY.cmd` from the laptop tree would publish scratch files** (`fix*.js`, `add-xp.js`, `claim.js`, `*.txt`, `merkle_excluded.json`, …) at `ratchetx.xyz/<name>` — the h69 incident class. Fix is 10 minutes and is listed first in §2.
5. **A public promise breaks in three days:** README and `llms.txt` (which agents read) still say the Seal v2 upgrade authority "is revoked for good on **2026-09-08** … After that nobody can change how it settles. Ever." The freeze was cancelled on 09-03 (`docs/FREEZE.md` superseded) but the public surfaces were not updated.
6. Process: five agents, six plan documents, a "nobody idle" rule and a single integrator (Sol) produced enormous, high-quality *staging* — and a bottleneck. §5 gives a leaner protocol.

---

## 1. Where things actually stand (2026-09-05 ~03:00 UTC)

| Surface | State | Evidence |
| --- | --- | --- |
| GitHub `main` | `039580b` (claim.html hotfix, 04.09 23:52Z). `h113` is the live release. | clone; `/api/proof` reports `v: h113-2026-09-03` |
| Laptop working tree | branch `codex/core-source-bracket`, HEAD `c840fa7` (= same content as `039580b`, different commit), 33 modified tracked files (index.html, api/game.js, PERMANENCE plan…), ~110 untracked (new programs, tests, tools, scratch). | `git status --short --branch` |
| Release candidate | separate worktree `D:/Work/Software_Projects/ratchetx-c8-core-release-candidate`, branch `codex/c8-core-release-candidate`, source freeze S = `fbdc173` (tree `eb9208c`), parent `70de57e`. Sol is retargeting Core's program id from the placeholder `cGf…` (= 32×0x09) to the held key `ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL`. Timepin id = `C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp` (held). Work Market v2 excluded (its id `gBx…` is 32×0x0a, also a placeholder). | ROOM 01:13–01:56Z |
| Artifacts on disk | Core G2 `1,085,448 B` sha `4f652aeb…` (SBPF v0, built 04.09 18:58Z, old id); Timepin `414,264 B` sha `8d913a5d…` (embeds keyless `US517`). **No C8ww / ANVG / SBPFv3 artifact exists yet. Nothing G2 is deployed anywhere.** | ROOM, COWORK_HANDOFF §1–2 |
| Mainnet | Seal v2 `23k3r8…` deployed (authority retained); Core v1 `6sJn9…` is a **devnet** program (ProgramData `HVWnt…`, authority `9R17s…`); `ANVG`, `C8ww`, `cGf` absent on mainnet and devnet (finalized, two providers). | Astra receipts 01:25–01:28Z |
| Build toolchain plan | SBPFv3: `cargo-build-sbf 4.3.0` (crates.io 2026-09-03 ✓), `platform-tools v1.56` (GitHub release 2026-08-18 ✓; v1.57 also exists), `--arch v3`, `litesvm 0.16.0`. Facts check out. | crates.io / GitHub |
| Client | Production UI (`index.html`, 170 KB) has **no G2 path**: FIRE → `POST /api/game`. Builders exist only in staging: R2 `lifecycle-v2.mjs` (23 tests), `economic-v2.mjs` (15 tests), `browser-g2-bridge.mjs` (6 mock tests, held by Astra's review). `client-v2.mjs` in the tree has two encoder defects (below). | ROOM 01:25–01:57Z, Svemir inventory |
| Store / production | Store moved Supabase → Upstash on 09-03 (`lib/check_store_schema.js:11-12`); Upstash free plan `500,000/500,000` commands consumed (COWORK_HANDOFF §6). `/api/game` 500, `/api/proof` and `/api/supply` fine, event-log anchor 206 h stale, 2,485 entries behind. | live probes 02:00Z |
| Owner decisions on record (00:45–00:47Z) | fresh generation first; no 72 h wait; **legacy migration deferred**, snapshot preserved, manual distribution later; **full game rules/economy must carry over**. | ROOM (Astra relays) |
| Release gate | `npm test` on `main`: **105 passed · 0 failed · 6 skipped** (browser suites) and exits 0 — skips do not fail the gate (`scripts/run-tests.mjs:143`). | sandbox run |

---

## 2. Blocking — fix before the next deploy / before any mainnet transaction

Ordered by (impact × cheapness). Each item: evidence → consequence → exact fix → owner → effort.

### B1. Timepin v2 admissibility rule vs. the real sponsored cadence (CONFIRMED by measurement)

**Rule.** `onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs` `validate_decision_fields`:
```rust
require!(candidate.prev_publish_time < need.target_ts && need.target_ts <= candidate.publish_time, DoesNotBracketTarget);
```
re-checked at finalize/conflict, and again by the consumer `ratchet-core-g2/.../foreign_timepin.rs` (`validate_record_against_spec`). Only the sponsored shard-0 PDA is admissible (`lifecycle.rs:1250-1255`). Pyth's `prev_publish_time` is the previous **Pythnet aggregate** (one per second), so exactly one message in Pyth's whole history brackets a given `T`: the first aggregate of second `T`. That message reaches the sponsored account only if the pusher happens to post *that* one.

**Measurement (mainnet, read-only `getMultipleAccounts` every second; Appendix A).** SOL and BTC: one push every **5 s** (two 6 s gaps in 25 min), `publish_time ≡ 2 (mod 5)` for 270 of 300 messages and drifting to 3/4, every message `publish_time − prev_publish_time = 1`. ETH: pushes every ~52 s (deviation/heartbeat). Minute-aligned targets bracketed: **0 of 25** on each of the three feeds; five-minute targets: **0 of 5**. The first print *after* each target arrived 2–3 s later on SOL/BTC and 2–51 s later on ETH (median 29 s).

**Consequence.** While the pusher phase is off `:00` no grid-aligned Need can reach `FINAL`; every one expires at `T + max_post_target_lag + capture_grace` → Core `void_pending_entry` / `void_active_shot` → full refund. The phase slides ~1 s per 10–12 min, so for roughly 10–15 minutes of each ~60-minute cycle *every* SOL/BTC target would succeed and for the rest none would — the game's playability would be dictated by Pyth's scheduler jitter, in all-or-nothing stretches. Nobody wins, nobody loses, XP and podium never move, RCX reloads have no purpose. The devnet lifecycle "B" step would have revealed this later, after the build, the vector re-pin and the ELF locks — all of which encode the rule.

**Fix (design, one rule in two files, then rebuild once).**
1. Replace the bracket with the rule the live game already uses (`lib/pxlog.js:405-451`, `priceCrossing`): the admissible message is the **earliest sponsored print with `publish_time ≥ T`**, captured no later than `T + max_post_target_lag` (choose per feed from Appendix A: SOL/BTC 30 s, ETH 120 s; measure the other four feeds first). Keep every other check (owner, PDA, `Full`, feed, exponent, confidence, posted-slot bounds, source deadline).
2. Allow several `Candidate`s per Need; `finalize` selects the minimum `(publish_time, posted_slot)`. A second candidate with a *larger* publish_time is not a conflict and must not produce `AMBIGUOUS`. Keep `AMBIGUOUS` only for two distinct Pyth-signed messages with the **same** `publish_time` (theoretically impossible, harmless safety net).
3. Keep the strict bracket as `adapter = 2` for sources that deliver every aggregate (a future self-hosted Hermes/Pythnet observer). Do not make it the default.
4. Same predicate in `foreign_timepin.rs::validate_record_against_spec`, in `model.mjs`, in the vectors, and in `docs/CORE_G3_ARCHIVE.md` / `SETTLEMENT.md` (the honest residual becomes: "whoever captures the first print decides between it and the next print ≤ 5 s later; any independent capturer removes that option").
5. Gate: run the Appendix B sampler for 24 h on all seven feeds, publish the hit-rate table, and add `test/test_timepin_cadence_policy.mjs` that fails if a ruleset's `max_post_target_lag` is below the measured p99 first-print lag for its feed.

Owner: Sol (Rust, one owner) with Astra re-deriving vectors. Effort: half a day plus one build.

### B2. Production is down for players (Upstash command quota) — decision needed, then a command diet

**Evidence.** `GET /api/game?action=state` → 500 (checked 02:00Z); `/api/proof` reports rate limits and a 206 h-old anchor. COWORK_HANDOFF §6: "Production ratchetx.xyz is DOWN: Upstash 500,000/500,000 limit." Upstash free plan = 500 K commands/month; pay-as-you-go = $0.2 per 100 K commands with a hard monthly budget cap you set yourself.

**Why it burned 500 K in two days.** The client polls `state` every 10 s, `proof` and `challenges` every 30 s, `arena` every 60 s, `tryPB` every 6 s (`index.html:1509,1545,2123,2306`), each poll costing several KV commands; the settlement watch re-walks hour buckets on every retry; the sampler read-modify-writes buckets every minute; agents' own smoke tests and Bankr sessions hit the same store. At 1,000 players this design would exhaust a paid plan too.

**Fix.**
1. Decision (yours): (a) pay-as-you-go with a budget cap (≈ $0.5/day at today's rate; the cap makes the worst case a rate-limit, not a bill), or (b) wait for the monthly reset and accept a dead site until then. (a) is the only option that keeps players and Bankr alive while G2 is built.
2. Engineering (one day, no build): serve `state/board/feeds` from a per-instance cache with a 5–10 s TTL; collapse the client's five timers into one `/api/game?action=state` every 15 s that carries board+proof+challenges; make the settlement watch read one bucket per retry; move `pxlog` samples to a ring per hour written once per minute (already partially done) — target ≤ 1 command per player-poll. Add `test/test_kv_command_budget.mjs` asserting the command count per `state` call (the repo already has `test_read_budget.mjs` — extend it to count Redis commands, not reads).
3. Snapshot the store **now** while it is still authoritative (see B7) — the quota outage is exactly the window in which a snapshot cannot be taken through the API.

Owner: Semir (decision) + Astra/Svemir helper (command diet). Effort: 1 day.

### B3. The deploy set is "whatever is in the folder" (CONFIRMED)

**Evidence.** `DEPLOY.cmd:39` runs `npx vercel deploy --prod` from the working directory; `vercel.json` `outputDirectory: "."`; `.vercelignore` excludes `onchain/ docs/ token/ agent/ ops/ supabase/ scripts/ tools/ test/ *.cmd *.md *keypair*.json mcp/` and nothing else — no rule matches root-level `*.js`, `*.mjs`, `*.txt`, `*.patch`, `*.sh`, `*.json`. Root `.js`/`.txt` are served today (`play-session.js`, `rescue_census.txt`). `scripts/check-release-safety.mjs:17-20` scans only `git ls-files` (tracked files), so untracked files are invisible to the gate. The laptop tree holds untracked `fix.js…fix12.js`, `fix_backend_limits.js`, `fix_limits_safe.js`, `fix_play.js`, `fix_smoke.js`, `add-xp.js`, `claim.js`, `build.sh`, `rx-derive*.tmp.mjs`, `push_report.txt`, `equity_gate_check.txt`, `replacement.txt`, `ratchetx-stocks-and-freeze.patch`, `merkle_excluded.json`. `tools/legacy_root.mjs:285-291` writes `merkle_balances.json` (every player wallet + balance) into the CWD — the repo root when run per the runbook — and `.vercelignore` does not exclude it either.

**Fix (10 minutes, then permanent).**
1. Move the scratch files to `_to_delete/2026-09-05-root-scratch/` (do not delete).
2. Turn `.vercelignore` into an allowlist:
   ```
   /*
   !*.html
   !*.css
   !play-session.js
   !llms.txt
   !robots.txt
   !sitemap.xml
   !manifest.json
   !openapi.json
   !actions.json
   !server.json
   !agent-registration.json
   !rescue_census.txt
   !merkle_tree.json
   !icon-*.png
   !og*.png
   !og.jpg
   !api/
   !lib/
   !vendor/
   !releases/
   !.well-known/
   !skills/
   (keep the existing skills/ negations)
   ```
   Decide explicitly whether `releases/` (public manifests) and `merkle_tree.json` are meant to be public — today they ship by accident of the denylist.
3. `scripts/check-release-safety.mjs`: enumerate the **deploy set** (`git ls-files` ∪ `git ls-files --others --exclude-standard`, minus `.vercelignore` matches) and fail on any root-level file not on the allowlist, and on any file matching the existing secret patterns regardless of tracking.
4. `DEPLOY.cmd`: refuse to run when `git status --porcelain` is non-empty unless `RATCHET_DEPLOY_DIRTY=1` is set — the hotfix showed the right pattern (clean worktree at an exact commit); make it the only pattern.

Owner: Sol. Effort: 30 min.

### B4. The write-once Economy/Ruleset needs a reviewed parameter manifest before anything is registered

`register_economy` (`lib.rs:76-117`) and `register_ruleset` are content-addressed and immutable; a wrong number is permanent for that economy (a new economy = new PDAs, every player re-opens a ledger). No document in either tree lists the intended mainnet values. The fixtures use `hit_payout 2:1`, `reveal_window 120 s`, `cleanup_bond 5,000`, `max_open 64`, `max_entry_age 300 s` — none of which should ship:

| Parameter | Fixture | Should be | Why (evidence) |
| --- | --- | --- | --- |
| `entry_mode` | observed in some rulesets | **forward only** for launch | observed mode is a look-back option (B6.1) |
| `hit_payout_num/den` | 2/1 | **1.7×** (today's live rule; `state.rs:2557` unit test uses 1.85) and add `require!(num < 2·den)` in `validate_economy` (`state.rs:612-617`) | at ≥ 2:1 an UP+DOWN pair on the same targets is free XP → podium RCX (`state.rs` M1) |
| `reveal_window_seconds` | 120 | **≥ 3,600** (max 86,400) | finalize + settle + reveal are three transactions after `capture_deadline`; a late crank silently converts hits into forfeits (`lib.rs:937-946, 1992-1995, 2294-2297`) |
| `cleanup_bond_lamports` | 5,000 | ≥ 50,000 | floor equals one signature fee; the terminal crank loses money with any priority fee (`state.rs:82`) |
| `max_open` | 64 | 5 (today's `min(4, rank+1)+1`) | 64 × 0.0063 SOL = 0.409 SOL locked per player and 64 `close_shot` calls to recover (AGENTS_CHANNEL §G2 cost) |
| `max_post_target_lag`, `capture_grace` per feed | 60/180 | from Appendix A: SOL/BTC lag 30 s; ETH 120 s; others measured first | B1 |
| `band_numerator` | 0 | 0 (keep) | no data yet; mechanism ships, number does not |
| `legacy_root` etc. | — | **all zero** for the fresh generation, `migration_id` nonzero | your 00:47Z decision; `validate_economy` `state.rs:569-586` requires all-zero-or-all-set |
| `timepin_program` | C8ww | C8ww | binds the Timepin generation; Core does not check the producer's upgrade authority (B6.6) |

Put these in `releases/g2-mainnet-economy.json` with one line of rationale each, have `model.mjs` derive `economy_hash`/`ruleset_hash` from that file, and make `tools/permanence-release.mjs --dry-run` refuse a manifest whose hashes differ. This is the single document you must personally approve; everything else is engineering.

Owner: Semir approves; Astra drafts. Effort: 2 hours.

### B5. There is no client for the game that is being built (CONFIRMED)

Production UI FIRE → `POST /api/game` (`index.html:1955`); the only chain path today is the env-gated legacy mirror (`api/game.js:3539/3612`, server builds an unsigned tx, Phantom signs, server verifies). `client-v2.mjs` builds 3 of Core G2's 24 instructions; Timepin v2 has no client except a broken rehearsal script. The missing builders exist only in staging (R2 `lifecycle-v2.mjs`, `economic-v2.mjs`, Svemir `browser-g2-bridge.mjs`) and the shipped `client-v2.mjs` has two defects that make EvidenceSpec registration and validation impossible (both reproduced):
- `encodeEvidenceSpecArgs` (`client/client-v2.mjs:254-279`) omits `u8(adapter)` after `u16(schema)` → 213 bytes, throws on its own 214-byte guard; `model.mjs:779` is correct.
- `decodeEvidenceSpec` (`:393`) reads a phantom `bump` (Rust `EvidenceSpecV2` has none, 262 B) → every field shifted, throws "truncated"; `:526` validates a bump the chain does not store. Fix: delete the `bump` read, authenticate by PDA address only.

**Fix.** Name one client integrator (Astra) and one integration window (hours, not days): import R2 + economic-v2 + the two-line client patch into the candidate, add `test/test_client_model_parity.mjs` that asserts `client-v2.mjs` and `model.mjs` produce byte-identical output for every encoder (this test alone would have caught both defects), then wire `index.html` FIRE through the mirror_build pattern *or* the browser bridge — decide one. Without this, "mainnet" is two programs and no players.

Owner: Astra (client), Sol (import). Effort: 1–2 days.

### B6. Program-level findings that change money, XP or liveness (all CONFIRMED unless marked)

1. **Observed entry is a look-back option** — `lib.rs:1217-1247` (`seal_observed`) and `:1391-1421`: the entry must be a `FINAL` Need (≥ `capture_deadline` old, 180 s in fixtures) and may be up to `max_entry_age_seconds` stale; the horizon starts at `now`. A player watches the live price and commits *after* seeing the drift since the entry print; `validate_ruleset` (`state.rs:663-690`) puts no upper bound on `max_entry_age_seconds`. Fix: forward-only rulesets for mainnet (`require!(args.entry_mode == ENTRY_FORWARD)` in `validate_ruleset`), or cap `max_entry_age_seconds ≤ target_grid_seconds` and publish the residual edge. The live game already caps staleness at ≤ 60 s.
2. **Expiry is a free option unless capture is guaranteed** — refund on `NEED_EXPIRED` (`lib.rs:1618-1634, 1911-1927`) + permissionless capture with no obligation: after `T` the print is public; a player captures if it favours them and withholds otherwise; if nobody else captures in the window the stake comes back. Timepin's first-capture attribution goes to whoever pushes+captures atomically (`lifecycle.rs:845-855`). Fix: run ≥ 2 independent capture cranks for every registered Need from day one (this is cheap: one tx per Need), escrow a per-shot capture bounty at seal that any capturer claims through the Timepin work receipt, and state the assumption on the settlement page (the repo's `test_settlement_claims.mjs` already polices the prose). With B1's rule the window is a whole push interval, not one aggregate, which makes the crank's job possible at all.
3. **Reloads stop at every UTC midnight until D-1 is finalized** — `reload_rcx` requires `DayFinal(utc_day(now) − 1)` (`lib.rs:432-444`); `finalize_day` needs every accepted shot of that day terminal across 16 shards (`:674`) and somebody paying ~0.003 SOL permanent rent with no reward. One un-cranked shot from yesterday blocks *all* reloads today. Fix: accept the most recent finalized day ≤ D-1 (empty seats → router burn, the code path exists), and pay the finalizer from the podium pool or a bond.
4. **`settle_final` after the reveal deadline is a guaranteed forfeit** (`lib.rs:1992-1995, 2294-2297`); choose `reveal_window_seconds` in hours (B4) and have the client show "pending action + deadline" (the FIRST_LAUNCH handoff already requires this).
5. **PLAUSIBLE — compute budget:** `void_pending_entry` calls `complete_optional_work` three times (`lib.rs:1642-1677`), each re-loading/validating/serialising a WorkPage with O(n²) validation over 48 records (`state.rs:1678-1686`, four passes). No SBF test fills a page. Test: 16 shots × 3 reservations then void the first; set a compute budget in cranks.
6. **Core never checks that its oracle producer is immutable** (`lib.rs:86-94`: key equality + executable only). During the upgradeable beta this is inherent; document it on the proof page ("evidence program upgradeable, authority = …"), and sequence Timepin freeze before Core freeze when P10 ever comes.
7. **Timepin clock-skew gate can reject a fresh capture** — `lifecycle.rs:1236-1239` requires `Clock::unix_timestamp ≥ target_ts`; Solana's clock lags wall time by seconds and the first post-T print lives ~5 s on the account. Fix: `clock + max_future_skew ≥ target`, floor `max_future_skew_seconds ≥ 30` in `validate_spec` (`lib.rs:468-471`), same relaxation in `foreign_timepin.rs:291-294`.
8. **Generation pin hashes the entire 370-byte Receiver config** (`lib.rs:553-565`): any benign Pyth governance action (fee change, authority handover) makes every spec uncapturable → every open Need expires → every shot voids, and `open_need` (`lib.rs:244-268`, no generation accounts) keeps admitting Needs against the dead spec. Fix: pin `wormhole`, `valid_data_sources`, `minimum_signatures` only; pass the generation accounts to `open_need` (`authenticate_generation_accounts` already exists).
9. **Players now need SOL** — 0.0063 SOL locked per open shot (Shot 780 B), ~0.0235 SOL per player with three chambers, four transactions per shot, plus fees; guests/demo cannot exist on chain for free. Decide the product shape: keep a free off-chain demo lane (no XP/podium) beside the on-chain ranked lane, or require SOL for everything. This is not a bug; it is a decision the UI and the Bankr skill must reflect before launch.
10. **`claim_legacy` totals are caps, not a ledger** — each claim must be ≤ `legacy_total_credits/xp` (`lib.rs:733-734`), there is no running remainder; irrelevant for the zero-root launch, decisive for any later migration economy.

### B7. Preserve the obligations snapshot now, not "alongside"

You decided legacy migration is deferred and balances will be distributed manually later. That requires a trustworthy snapshot of the Upstash store **before** the quota reset/plan change and before any store surgery — and no existing tool produces a hash-pinned, G2-compatible one: `tools/live_snapshot.mjs` (reads Upstash, writes `~/.local/share/RatchetX/private-snapshots/legacy-kv-<stamp>.ndjson`) has no digest and re-serialises through `JSON.parse` (a balance > 2^53 rounds silently — reproduced: `9007199254740993 → 9007199254740992`); `tools/supabase_final_snapshot.mjs` has the rigorous quiesce/digest/barrier machinery but reads the store the game left on 09-03. Fix (2 hours): in `live_snapshot.mjs` keep the raw Redis string per key, write a sibling `.sha256`, record `getSlot('finalized')` + genesis hash + a chosen `migration_id`, and feed the file to `onchain/ratchet-core-g2/legacy-snapshot.mjs` (its leaf/node hashing is byte-exact against `state.rs:847-884`). Also: `RX_MIGRATION_FREEZE` blocks only `takeStake` (`api/game.js:1925`) while `loadPlayer` still mints the welcome grant (`:421,426`), stake yield still credits (`:2463`) and anchor XP still pays (`:3708`) — the snapshot is taken against a moving ledger unless those are gated too (extend `test/test_migration_freeze.mjs` with one case per writer).

### B8. Public promises that expire on 2026-09-08

`README.md:104,215` ("revoked for good on **2026-09-08**"), `llms.txt:18,104` ("destroyed on 2026-09-08. After that nobody can change how it settles. Ever."), `docs/AGENT_STATE.json:31-33` (`freezeDates.sealV2`). The freeze was cancelled on 09-03 (`docs/FREEZE.md`, `PERMANENCE_EXECUTION_PLAN.md` decision register) and nothing public says so. On a project whose thesis is "the machine that cannot lie", silently missing a registered date is worse than the freeze itself. Fix today: update the three surfaces to "no freeze is scheduled; the authority is retained while the on-chain successor is built; a future ceremony will be registered in advance again", and publish the short post `docs/POST_FREEZE.md` was drafted for — in the honest version.

---

## 3. Important, not blocking (MEDIUM)

- **Release gate passes with skipped suites** — `scripts/run-tests.mjs:143` `process.exit(failed ? 1 : 0)`; 6 browser suites skip without a browser and the gate is green (reproduced: 105 ok / 6 skipped / exit 0). Fix: `process.exit(failed || (skipped && !process.env.RATCHET_ALLOW_SKIPS) ? 1 : 0)`; `DEPLOY.cmd` never sets the escape hatch.
- **Burn credit at `confirmed`** — `lib/burn.js:50`; a forked-out burn keeps its credit and the replay gate remembers the signature. Use `finalized`.
- **P6 canary false greens** (`tools/p6-canary/*`, reproduced): one exercised scenario marks all four write-side rows PASS (`actions.mjs:79`, `checks.mjs:124-127`); RPC outage scores perfect agreement (`canary.mjs:78`); a frozen oracle scores gap 0 (`checks.mjs:101-108`); rollback passes on any non-landing (`actions.mjs:56`); missing readback hashes compare equal; same fee payer twice passes the race; non-ELF bytes satisfy the pin when `sbpfVersion` is omitted (`checks.mjs:44-67`); T0 state is discarded (`canary.mjs:113-116`). Astra's 7/7 guard fixes exist only in `p6-staging`. Do not cite any canary verdict as launch evidence until the fixed pack is in the tree; the "unknown Need state ignored" claim was refuted (`checks.mjs:93`).
- **`scripts/devnet-lifecycle.mjs` cannot run** — `const`s scoped inside `try` used outside (`:52,56` vs `:101,104`), imports a non-existent `../../rcx-timepin/model-v2.mjs` (`:73`), passes the `init` spec account read-only (`:99`), target not grid-aligned (`:111-112`). `generate-vectors.mjs` imports the same missing model and reads a `vectors/` dir that does not exist — the vector staleness gate cannot fire.
- **Legacy tooling is the wrong generation** — `tools/legacy_root.mjs` (v1 leaf rule, no domain separation), `scripts/set-legacy-root.mjs` (patches Core **v1** `lib.rs`), `docs/CUTOVER_RUNBOOK.md` steps 5/8 (flags the tool silently drops; `--cluster/--program/--migration-id/--cutover-slot` are ignored at `:227-228`); `tools/legacy_root_rules.mjs` and `test/test_cutover_rehearsal.mjs` exist only on the laptop. Since migration is deferred: mark the v1 tools `OBSOLETE FOR G2` in their headers, keep `onchain/ratchet-core-g2/legacy-snapshot.mjs` as the only builder, and add strict argv parsing (unknown flag = hard error).
- **Exact-SBF coverage gaps** — Core: `forfeit`, `finalize_day` (every test fabricates `DayFinal`), `seal_observed_delegated`, page rollovers, confidence-band void, `AMBIGUOUS` voids, and ~30 negative codes are host-only (`core_g2_lifecycle.rs` §5 of the Core review). Timepin: **no bracket negatives at any level** (no host test calls `validate_decision_fields`/`load_evidence`), no `capture_conflict`/`finalize`/`expire` on SBF, `register_fails_with_trailing_bytes` asserts a failure Anchor 1.0.2 does not produce, `malformed_state.rs` assertions match any error. After B1 the bracket negatives are the first tests to write.
- **`open_history_page`/`open_work_page` `init_if_needed` with fixed `space`** fails with `ConstraintSpace` once a page has grown (`lib.rs:2406-2418, 2464-2476`; Anchor 1.0.2 `space == data_len` for existing accounts) — harmless, but the "idempotent" comment and README are wrong.
- **Runtime never refuses the in-memory store** — `lib/kv.js:25,576` `durable = !!(URL && TOKEN)`; only `play_session_http.js:28` checks it; `api/game.js` never does. The build-time gate (`check_store_schema.js`) is the sole protection. Add `if (!kv.durable) return 503` at the top of `api/game.js`, `api/ledger.js`, `api/record.js`, `api/shot.js`.
- **Keypair custody** — `onchain/rcx-timepin-v2/timepin-v2-keypair.json` sits inside the repo folder (gitignored and vercelignored by `*keypair*.json`, so safe today); COWORK_HANDOFF §1 already recommends moving it to `D:\keys\`. Do it before the build so the release manifest records public keys only.
- **Docs drift that misleads agents** — `docs/PYTH_ONCHAIN.md:40-48` lists v1 push-oracle PDAs while the program and `lib/onchain_px.js` use pyt2 PDAs; `docs/AGENT_STATE.json` says production is `h108` while `/api/proof` says `h113`; `MAINNET_PLAN.md` §P5 (compile the root) contradicts `CUTOVER_RUNBOOK` (root is a transaction) — mark superseded; `tools/p6-canary/README.md` cites a test file that does not exist.
- **`mirror_confirm` accepts `LEGACY_V2_PROGRAM_ID`** (`api/game.js:3644`) — cosmetic flag only; remove when G2 lands.
- **Hedged pairs at 2:1** (B4) and `hit_payout_num < hit_payout_den` allowed (`state.rs:612`) — both parameter hygiene.

---

## 4. Verified correct — do not re-audit

Core G2: no admin/owner key anywhere; no caller-chosen rent recipient (`close = rent_refund` frozen at seal, `lib.rs:3105-3107` etc.); Economy/Ruleset registration is content-addressed, idempotent and un-replaceable (`lib.rs:110-116, 151-157`); every shot instruction re-derives Economy/Ruleset/Ledger/Shot from authenticated content (`lib.rs:4257-4419`); nonce/one-shot init/sequential history make replay and close-then-reuse impossible; ledger conservation asserted after every mutation (`state.rs:749-796`); Token-2022 pinned program, mint pinned by key/length/decimals/no authorities, canonical ATA seeds, `StateWithExtensions`, memo-before-transfer, exact reload conservation; all arithmetic checked (`overflow-checks = true`), exponent range −12..2, 160-bit band compare, `u128→u64` bounded at registration; day finalization and work pages structurally sound; the prior review's nine negative SBF cases are implemented (`core_g2_lifecycle.rs:3589-4008`).

Timepin v2: Pyth account authentication is complete (owner `rec2…`, sponsored PDA under `pyt2…` with shard+feed seeds, exact 134 B, discriminator, `Full`, `write_authority`, feed id, posted-slot bounds); content-addressed candidates; state machine has no edit/close path; PDAs canonical with fixed-width seeds; WorkPage can never gate evidence. Fabricated/partial/backdated/wrong-feed/wrong-shard messages all fail closed.

JS: all 11 discriminators, every PDA seed, `encodeEconomyArgs` (372 B), `encodeRulesetArgs` (163 B), account sizes, `decodeLedger`, `decodeHistoryPage`, `decodeNeed`, `commitmentHash`, `legacy-snapshot.mjs` leaf/node hashes — byte-exact against Rust. Keyless-oracle constraint holds in the live backend (`lib/prices.js`, `lib/onchain_px.js`, `api/game.js:1180, 2647-2654`). `mirror_build/confirm` awards nothing. Toolchain versions in Fable's SBPFv3 memo exist.

---

## 5. Process — how to reach mainnet with less motion

What I saw in ROOM/COWORK_HANDOFF/AGENTS_CHANNEL: five agents plus internal sub-agents, six overlapping plan documents (MAINNET_PLAN, PERMANENCE_EXECUTION_PLAN, COWORK_HANDOFF, AGENTS_CHANNEL, CUTOVER_RUNBOOK, OPERATOR_INDEPENDENCE_PLAN), a "nobody idle — auto-claim the next item" rule, and staging folders on two machines holding the only copies of finished work (R1, R2, economic-v2, p6-staging fixes, legacy-staging fixes, browser bridge). The quality of individual pieces is high; the system produced one integration bottleneck (Sol), a growing pile of unintegrated artifacts, and several false-green tools written to have something to do. Concretely:

1. **One tracker, one integrator, one queue.** Keep `PERMANENCE_EXECUTION_PLAN.md` as the sole tracker (its decision register is good); archive MAINNET_PLAN/AGENTS_CHANNEL/COWORK_HANDOFF as history. Sol integrates; nobody else edits Rust. Staging work that is not integrated within 24 h is discarded, not preserved — evidence lives in git, not in scratch.
2. **Replace "nobody idle" with "nothing unowned".** Idle is fine; a fourth review of the same file is not. Every claim names files and a test that will prove it; a DONE without an integrated commit hash is a draft.
3. **Cadence measurement is a gate, not an opinion** (B1). Any rule that depends on an external feed's behaviour gets a measured number in the repo and a test that pins it.
4. **Evidence tiers, stated in every receipt:** host test < exact-SBF (LiteSVM) < devnet with real Pyth accounts < mainnet. The team already writes this; make it a required field so "23/23" never reads as "works on chain".
5. **Two agents are enough now:** Sol (build/integrate/deploy) and Astra (client + independent verification). Reactivate a third only for a bounded, named task (e.g. the command diet, B2). The Svemir helper's bridge work should be folded into Astra's client lane or dropped.
6. **Semir's decisions, in one list, answered once:** B2 (pay a capped Upstash budget or wait), B4 (the parameter manifest), B6.9 (SOL requirement / demo lane), B8 (the freeze copy), and "zero legacy root for the first economy" (permanent for that economy).

---

## 6. Shortest honest path to mainnet (sequenced)

| Day | Step | Exit evidence |
| --- | --- | --- |
| 0 (today) | B3 deploy-set fix; B8 public copy; B2 decision + command diet started; B7 snapshot taken and hashed; parameter manifest drafted (B4) | `.vercelignore` allowlist merged; README/llms.txt corrected; snapshot sha + slot in a private receipt |
| 1 | B1 rule change in Timepin + Core + model + vectors; client encoder patches (B5) and parity test; Core id → ANVG; one SBPFv3 build of Timepin C8ww + Core ANVG; exact-SBF matrix incl. the new bracket negatives | both ELF hashes + `verify-artifact` PASS with `EXPECT_SBPF=3`; vectors regenerated by a script that exists |
| 2 | Devnet: register spec/economy/ruleset, open Needs on the minute grid against **real** sponsored accounts, capture with two independent cranks, seal → settle → reveal → close, plus expire/void/forfeit paths | signatures for every instruction; measured void rate on devnet < 5 % over ≥ 60 targets |
| 3 | Client integration (B5) + server-off drill (FIRST_LAUNCH handoff §"Short server-off drill"); Bankr skill pointed at G2 delegate path | a stranger's browser profile completes a shot with `/api/game` blocked; trace of hosts contacted |
| 4 | Mainnet: deploy Timepin + Core with authorities retained (P7), register the manifest economy/ruleset, one owner shot end-to-end, publish the tuple (program ids, ELF hashes, economy/ruleset hashes) on the proof page; keep the legacy server lane visibly "legacy" | `permanence-release --dry-run` manifest = deployed readback on two RPCs |
| after | run cranks (capture + terminal + finalize) as a resident process on the PC and on the VPS; measure daily void rate, reload blackouts, rent per player; then the parameters you deferred (band k, bounties) from data | weekly numbers on `/api/feeds` |

Skipping B1 makes day 2 fail; skipping B5 makes day 4 a program without a game.

---

## Appendix A — sponsored-feed measurement (mainnet, 2026-09-05)

Method: `getMultipleAccounts` on the shard-0 sponsored PriceUpdateV2 accounts for SOL (`7AviUf9n…`), BTC (`APgzQGGd…`), ETH (`7odryi4W…`) once per second through `api.mainnet-beta.solana.com` / `solana-rpc.publicnode.com`, recording every distinct `(posted_slot, publish_time, prev_publish_time)`. Decoder per `lib/onchain_px.js`. Read-only.

Window: 02:29:50Z – 02:54:50Z (25 min, 1,259 polls, 0 RPC errors).

| feed | distinct messages | push gap (s) | `publish − prev_publish` | phase `publish mod 5` | minute targets bracketed | 5-min targets bracketed | first print after T (lag) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOL | 300 | 5 (297×), 6 (2×) | 1 (300×) | 2 (270×), 3 (23×), 4 (7×) | **0 / 25** | **0 / 5** | 2–3 s |
| BTC | 300 | 5 (297×), 6 (2×) | 1 (300×) | 2 (270×), 3 (23×), 4 (7×) | **0 / 25** | **0 / 5** | 2–3 s |
| ETH | 31 | 52–54 (29×), 4 (1×) | 1 (31×) | spread | **0 / 25** | **0 / 5** | 2–51 s, median 29 s |

The SOL/BTC phase drifted from `:02` to `:04` during the window (two 6-second gaps), i.e. the pusher's scheduler slides ~1 s per 10–12 min. When the phase passes `:00`, every SOL/BTC minute target will be bracketed for a stretch of roughly 10–15 minutes, then none for the rest of the cycle. The settle rate is therefore dictated by Pyth's scheduler jitter — a few short "everything settles" windows per hour and "everything voids" otherwise — not by anything the game or its cranks can influence. ETH never matched because its 52-second pushes are deviation/heartbeat driven.

Reading the table: with `prev = publish − 1` always, the bracket `prev < T ≤ publish` is satisfied only when `publish_time == T`; SOL/BTC publish only at seconds `≡ 2 (mod 5)`, so no target `≡ 0 (mod 5)` can ever match while this phase holds. The first print *after* the target is what the live game settles on today (`lib/pxlog.js:445-451`), and it arrives 2 s later on SOL/BTC.

## Appendix B — the sampler (90 lines, read-only)

`pyth_sample.js <minutes> <out.json>` — see attached file. Extend `ACC` with BONK/PUMP/JUP/WIF (`lib/onchain_px.js:76-82`) and run 24 h before choosing per-feed `max_post_target_lag`.

## Appendix C — file:line index of everything cited

Core G2: `onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs` (76-117 register_economy; 432-444 reload day; 937-946 reveal deadline; 1217-1247 seal_observed; 1618-1634 / 1911-1927 void refunds; 1642-1677 work completions; 1992-1995 reveal; 2294-2297 forfeit; 2406-2418 / 2464-2476 init_if_needed; 3105-3107 rent_refund; 3729-3730 cleanup bond; 3758-3764 ATA; 3785-3860 mint/seat auth; 4257-4419 binding), `state.rs` (82 bond floor; 569-586 legacy args; 612-632 payout bounds; 663-690 ruleset validation; 749-796 conservation; 847-884 legacy hashes; 895-907 exponent; 1678-1686 work page validation), `foreign_timepin.rs` (88-119 auth; 291-294 skew; 323 FINAL; 365-415 record vs spec). Timepin v2: `lifecycle.rs` (845-855 first capture; 1005-1011 finalize gate; 1034-1049 expire; 1166-1212 decision fields; 1236-1244 capture window; 1245-1280 price account auth), `lib.rs` (244-268 open_need; 422-490 validate_spec; 522-593 generation pins). Backend: `api/game.js` (421, 426, 1919-1925, 2463, 3539, 3612-3680, 3644, 3708), `lib/burn.js:50`, `lib/kv.js:25,576`, `lib/pxlog.js:405-451`, `lib/check_store_schema.js:11-19`, `scripts/run-tests.mjs:143`, `scripts/check-release-safety.mjs:17-21`, `DEPLOY.cmd:39`, `.vercelignore`, `vercel.json:3`, `index.html:1509,1545,1955,2123,2306`, `README.md:104,215`, `llms.txt:18,104`, `docs/AGENT_STATE.json:31-33`. Tools: `tools/legacy_root.mjs:227-228,285-291`, `tools/live_snapshot.mjs:79,128`, `scripts/set-legacy-root.mjs:18-38`, `tools/p6-canary/{actions.mjs:31,39,44-45,56,79; checks.mjs:44-67,71-83,93,101-108,124-127; canary.mjs:41,78,82,95-96,113-116}`, `onchain/rcx-timepin-v2/scripts/{devnet-lifecycle.mjs:52-112, generate-vectors.mjs:14-23}`, `onchain/ratchet-core-g2/client/client-v2.mjs:254-279,393,526`.
