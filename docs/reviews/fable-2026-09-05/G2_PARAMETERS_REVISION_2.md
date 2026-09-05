# G2 mainnet parameters — revision 2, after the keyless result

Fable, 2026-09-05 09:4xZ. Supersedes the rows named below in `G2_MAINNET_PARAMETERS_PROPOSAL.md` (03:2xZ). Same discipline: every value is (F) frozen by the program, (L) carried from the live game, (M) measured tonight, or (D) a decision only Semir may make. Still a **PROPOSAL, not registered** — `register_*` is write-once and content-addressed, so a wrong number is permanent for that economy.

Three of the rows I proposed this morning are wrong. Two are wrong because of what got measured after I wrote them; one was wrong when I wrote it. They are listed first.

## 1. Rows I am changing, with the reason

| field | was | now | tag | why it changed |
| --- | --- | --- | --- | --- |
| `max_pre_target_gap_seconds` | **1** | **5** | M | I set 1 from the measurement `pub − prev = 1`. That is the *observed* value, so the pin sits exactly on it with **zero margin**: one skipped Pythnet aggregate makes the gap 2, the unique admissible message is rejected, and the target voids — a gap we manufacture, not one Pyth caused. `test_pre_gap.mjs` G4 proves raising it can never admit a second message at any bound (the filter is a conjunction with a unique-satisfier predicate), so it carries **no safety duty at all**; G3 shows one skip every 7 s voids 14.3 % of targets at 1 and 0 % at 5. A tight bound buys nothing and costs targets. |
| `cleanup_bond_lamports` | **100,000** | **300,000**, split **100,000 archive / 200,000 settlement** | D | 100,000 funded the archiver only. `SOLVENCY_AND_INCENTIVES.md` shows the posting nobody is paid for costs ~45,000 lamports, and that with a 200,000 settlement share the break-even is **k\* = 1** — a single shot pays for the posting that settles its whole target. Requires the settlement wire (one `winner_submitter` field, one transfer); **without that wire this row is pointless and VOID+refund should not ship**. |
| `min_stake` | **100** (L, from the live game) | **4,500,000** — or make the bond proportional to stake | D | carried over unexamined. At a 100-lamport stake the fee needed to attract a poster is **450× the entire bet**. Either the minimum stake rises so the fee is ≤1 % of the bet, or the bond scales with the stake (my preference: one rule at every size), or small shots settle only when several share a target — which is a liveness dependency on other players and must not be sold as a guarantee. |

## 2. Rows the keyless result changes in kind, not just in value

| field | value | tag | why |
| --- | --- | --- | --- |
| `adapter` | **1 — strict bracket**, with generic Receiver-owned `Full` replay admissible | D | the whole adapter 2/3/4 line existed because the strict bracket was unplayable through the sponsored PDA (0/25, Sol 0–1/9, Svemir 0/9–10). Through the keyless ring it is **7 feeds × 100 %** of target seconds. Adapter 1 is the only rule with no candidate choice, no residual and no chooser; the others were engineering around an exclusivity a public RPC read dissolves. Requires dropping the two sponsored-PDA pins (`lifecycle.rs` 1250–1255, 1270–1274, mirrored in `foreign_timepin.rs`) and nothing else — every other pin stays. |
| `max_confidence_bps` | **200 today; do not freeze yet** | D + M | under a unique admissible message this is a volatility-triggered **void switch**, not a quality filter: if it fires, it fires on the targets that matter most and refunds whoever was losing. Measured calm state: SOL 6, BTC 3, ETH 5, JUP 14, WIF 15, BONK 26, **PUMP 44** bps. Headroom is 4.5× on PUMP in quiet conditions and unknown in a spike. **This row needs a stress percentile from Pyth history that nobody has measured yet** — the running soak accumulates a per-feed confidence histogram for exactly this. Options in `CONTENT_PINS_ARE_VOID_SWITCHES.md` §3B. |
| `challenge_window_seconds` / capture window | **120** | D | unchanged. Astra's A3 constraint is independent of everything measured tonight: `D − T` shorter than the shortest horizon minus the exit lag, with `require!(entry_need.capture_deadline_ts <= exit_target_ts)` at `seal_forward`. |

## 3. Rows that stand unchanged

`hit_payout 17/10`, `settle_xp 1`, `max_open 5`, `reveal_window_seconds 3,600`, `max_horizon_seconds 86,400`, the seven horizons, `target_grid_seconds 60`, `min_open_lead_seconds 30`, `band 0/1`, `entry_mode 2 = FORWARD`, all legacy fields zero, `migration_id` still Semir's string to choose. `max_post_target_lag_seconds 30` stands and has wide margin (the bracket message sits at the target second itself).

## 4. What must be true before any of this is registered

1. The settlement wire exists, or `cleanup_bond_lamports` reverts to archiver-only and the terminal policy is not VOID+refund.
2. `max_confidence_bps` is sized against a stress percentile, not against my quiet sample.
3. Sol's devnet numbers replace my ~45,000-lamport posting estimate; every threshold here moves linearly with it, since `k* = ceil(cost / settlement_bond)`.
4. The two sponsored-PDA pins are dropped and Astra has vetoed or cleared the generic-replay surface.

None of these is a number an agent may set. I have marked every one of them D.
