# G2 mainnet parameters — proposal for Semir's signature (B4)

Fable, 2026-09-05 03:2xZ. Status: **PROPOSAL, not registered.** `register_economy` / `register_ruleset` / `register_evidence_spec` are write-once and content-addressed; a wrong number here is permanent for that economy. Every value below is either (F) frozen by the program, (L) the live game's current rule carried over "as is", (M) measured tonight, or (D) a decision Semir must make. Nothing marked (D) may be registered by an agent.

Machine form: `g2-mainnet-economy.proposal.json` beside this file — the intended input for `model.mjs` to derive `economy_hash`, `ruleset_hash[]`, `evidence_spec_hash[]`, and for `tools/permanence-release.mjs --dry-run` to refuse any deployment whose readback differs.

## 1. EconomyArgs (372 B, `state.rs:86-118`)

| field | value | tag | why |
| --- | --- | --- | --- |
| schema | 2 | F | `CORE_SCHEMA_VERSION` |
| timepin_program | `C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp` | F | the only held Timepin key; Core binds the producer here (`lib.rs:86-94`) |
| timepin_schema | 2 | F | `TIMEPIN_SCHEMA_VERSION` |
| cluster_genesis_hash | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | F | mainnet-beta genesis (read back from two RPCs at registration) |
| migration_id | sha256 of a string Semir chooses, e.g. `"ratchetx-g2-mainnet-2026-09-fresh-start"` | D | must be nonzero even with no legacy root (`validate_economy` 566-568); it names this generation forever |
| legacy_root / legacy_snapshot_hash / legacy_cutover_slot / legacy_leaf_count / legacy_total_credits / legacy_total_xp | 0 / 0 / 0 / 0 / 0 / 0 | D | Semir 00:47Z: fresh start, manual distribution later. Consequence stated plainly: this economy can never carry an on-chain legacy claim; a later distribution is a new economy or an off-chain transfer |
| ruleset_policy_root / ruleset_policy_count | derived / 49 | derived | Merkle root over the 49 ruleset policy hashes below (7 feeds × 7 horizons), computed by `model.mjs` from this file |
| rcx_mint | `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` | F | pinned in `lib.rs:36` |
| rcx_token_program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | F | Token-2022 |
| rcx_decimals | 6 | F | |
| raw_units_per_credit | 1,000,000 | F | 1 RCX = 1 credit (`CREDIT_PER_TOKEN = 1` in the live game) |
| burn_per_mille / podium_per_mille / podium_curve | 700 / 300 / [500, 300, 200] | F | the printed rule on the FIRE button |
| rank_shard_count / day_seconds | 16 / 86,400 | F | |
| hit_payout_num / den | **17 / 10** | L | live `HIT_PAYOUT = 1.7` (`lib/core_rules.js`). Not 2:1 (fixture): at ≥ 2:1 an UP+DOWN pair on the same targets is free XP → podium RCX. Also add `require!(num < 2·den)` to `validate_economy` |
| settle_xp | 1 | L | `SETTLE_XP = 1` |
| min_stake / max_stake | 100 / 1,000,000,000 | L | `STAKE_MIN`/`STAKE_MAX`; `maximum_payout ≤ u64::MAX` holds |
| max_open | **5** | L | live `chambersFor` = `min(4, rank+1)+1` ≤ 5. Not 64: 64 × 0.0063 SOL = 0.409 SOL locked per player and 64 `close_shot` calls to recover |
| cleanup_bond_lamports | **100,000** (0.0001 SOL) | D | fixture 5,000 = one signature fee, the terminal crank loses money with any priority fee; 100,000 pays a crank ~20 base fees; bounded by `MAX_CLEANUP_BOND` 1,000,000. Semir may pick 50,000–200,000 |
| reveal_window_seconds | **3,600** | L | live `REVEAL_DEADLINE_SECS = 3600`; with challenge window 900 s the player has 60 min after `D` to reveal; fixture 120 s would forfeit every slow crank |
| max_horizon_seconds | 86,400 | L | 24 h chamber |

## 2. RulesetArgs (163 B, `state.rs:138-152`) — one ruleset per (feed, horizon): 7 × 7 = 49

| field | value | tag | why |
| --- | --- | --- | --- |
| schema | 2 | F | |
| economy_hash | derived | derived | |
| evidence_spec_hash / evidence_policy_hash | derived per feed (§3) | derived | |
| feed_id | per feed (§3) | F | the seven sponsored feeds in `lib/onchain_px.js:76-82` |
| entry_mode | **2 = FORWARD** | D | proposed. Observed (1) is a look-back option (`seal_observed` 1217-1247) and with `D = T + 900` needs `max_entry_age ≥ 900 + lag`, i.e. entries ≥ 15 min stale. Product feel changes: FIRE commits to the *next* minute print instead of "the price now". If Semir keeps observed, set `max_entry_age_seconds = 1,020` and publish the residual |
| horizon_seconds | 300 / 600 / 900 / 1,800 / 3,600 / 21,600 / 86,400 | L | live `HORIZONS` minutes 5/10/15/30/60/360/1440 |
| target_grid_seconds | 60 | L | minute grid; every horizon is a multiple (`UnalignedHorizon` check) |
| min_open_lead_seconds | 30 | F | `MIN_OPEN_LEAD_SECONDS` |
| max_entry_age_seconds | 0 (forward) | F | must be 0 in forward mode (`validate_ruleset` 685) |
| band_numerator / band_denominator | 0 / 1 | L | `k = 0` until observed data justify a value (decision register 2026-09-03) |
| base_xp | 10 / 11 / 12 / 14 / 16 / 20 / 24 | L | live `HORIZONS[i][1]` |

## 3. EvidenceSpecArgs (Timepin, `lib.rs:271-296`) — one per feed

| field | value | tag | why |
| --- | --- | --- | --- |
| schema | 2 | F | |
| adapter | **3** (SUBMITTED_PYTH_MIN, `ADAPTER3_ADJUDICATION.md`) | D | requires the lifecycle change; adapter 1/2 semantics are 0/25 on measured cadence |
| receiver_program / push_oracle_program | `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` / `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` | F | |
| shard_id | 0 | F | sponsored shard |
| feed_id | SOL `ef0d8b6f…b56d`, BTC `e62df6c8…5b43`, ETH `ff61491a…0ace`, BONK `72b02121…4419`, PUMP `7a01fca2…c3b9`, JUP `0a0408d6…0996`, WIF `4ca4beec…61fc` | F | full ids in the JSON |
| required_verification | 1 = Full | F | |
| target_grid_seconds | 60 | L | |
| min_open_lead_seconds | 30 | L | |
| max_target_ahead_seconds | 90,000 | L | 24 h horizon + 1 h slack (bound 30 d) |
| max_pre_target_gap_seconds | 1 (reserved; validate_spec requires > 0 today — adapter 3 ignores it) | F | |
| max_post_target_lag_seconds | **SOL 30, BTC 30, ETH 120, BONK 120, PUMP 120, JUP 120, WIF 120** | M | measured first-print lag: SOL/BTC +2…3 s (300 msgs), ETH +2…51 s (31 msgs); BONK/PUMP/JUP/WIF ≈ 45 s cadence in Sol's 555 s sample (12–13 states each) — confirm with the 24 h run before signing |
| capture_grace_seconds → challenge window | **900** (absolute: `D = T + 900`) | D | 15 min for anyone to replay an earlier print from the ledger; every deadline downstream (reveal) is anchored to `D` |
| max_future_skew_seconds | 30 | M | Solana clock lag vs the print's `publish_time`; fixture 5 s would reject fresh captures (Timepin M1) |
| min_exponent / max_exponent | −12 / 2 | F | |
| max_confidence_bps | 200 | L | live `MAX_CONF_BPS = 200` |
| receiver_programdata_slot / receiver_config_hash / wormhole_program / wormhole_programdata_slot | read back at registration from finalized mainnet (two RPCs must agree) | derived | pin `wormhole`, `valid_data_sources`, `minimum_signatures` only if the generation-pin change (Timepin M2) lands; otherwise the full config hash with the documented void-storm consequence |

## 4. What this fixes that the fixtures would have shipped

hit_payout 2:1 → free-XP hedges; reveal 120 s → forfeits on every slow crank; bond 5,000 → unpaid cranks; max_open 64 → 0.4 SOL locked per player; skew 5 s → rejected fresh captures; lag 120/grace 60 with adapter 1 → 0/25 settlements. None of these is a bug in Rust; all are numbers that a write-once account would have frozen.

## 5. Procedure (no build needed)

1. Semir edits the (D) rows in the JSON and signs the file (a line in BRIDGE_LOG with its sha256 is enough).
2. `model.mjs` gains `deriveGenerationFromManifest(json)` → `economy_hash`, 49 `ruleset_hash`, 7 `evidence_spec_hash`; `test_core_g2_model.mjs` pins them as golden vectors.
3. `tools/permanence-release.mjs --dry-run --manifest releases/g2-mainnet-economy.json` must reproduce the same hashes from the file and refuse anything else.
4. Registration transactions are built from the file, never typed.
