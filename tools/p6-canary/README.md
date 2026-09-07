# P6 adversarial canary — executable permanence pack (Fable, 2026-09-05)

Turns `docs/reviews/fable-2026-09-05/p6-false-green-attack.md` and Astra's C1–C9 into something that runs. It measures; it never deploys, spends, or freezes. Owner for running it: whoever operates the 72h window (Sol + at least one external operator). Owner of the write-side adapter: Astra (chain-only client).

```
node tools/p6-canary/canary.mjs --config p6.json --t0            # T0 record; exit 1 = do not start the clock
node tools/p6-canary/canary.mjs --config p6.json --run --hours 72 # read-side ticks until 72h of CHAIN time have elapsed
node tools/p6-canary/canary.mjs --config p6.json --scenarios --adapter ./adapter.mjs   # write-side scenarios
node tools/p6-canary/canary.mjs --config p6.json --t72           # thresholds -> PASS | FAIL | INCOMPLETE
node test/test_p6_canary.mjs                                      # 42 fixture checks, no network
```

## What a tick measures (read-side, executable today against any deployed generation, e.g. devnet next-print-v2 `2TV2…`)
| Check | Fail condition | Why it exists |
|---|---|---|
| genesis on every RPC | any endpoint ≠ pinned genesis | wrong cluster / poisoned endpoint |
| authority + ELF + SBPF drift | ProgramData ELF prefix sha ≠ pinned, nonzero padding, upgrade authority ≠ pinned (or ≠ NONE for frozen), `e_flags` ≠ 3 | a redeploy or authority change resets the window (rollback boundary) |
| finalized RPC agreement | byte disagreement on the canonical read-set across ≥2 endpoints | RPC disagreement / reorg awareness; slot spread recorded |
| state monotonicity | any tracked Need moves backwards or changes terminal kind | reorg/rollback or a program bug |
| oracle liveness | max publish gap over `thresholds.oracleMaxGapSeconds` | expired-rate is an oracle property; measured, not assumed |
| founder unreachable | any `founderMustBeUnreachable` URL answers < 500 | server-off is a measured fact for the whole window |
| tick continuity | gap between ticks > 2× interval | a paused canary is not 72 continuous hours |

Chain time only: slot/blockTime from RPC; the tool contains no `Date.now`.

## Write-side scenarios (through the adapter; SKIPPED until wired — SKIPPED never counts as PASS)
- **replay** — land a terminal op, submit it again: must fail with the program's state error, readback byte-identical.
- **race** — two operators submit the same permissionless op for the same subject: exactly one lands, the loser gets the state error, readbacks identical.
- **rollback** — an op that must fail (e.g. `void_active_shot` on a FINAL Need) leaves the subject byte-identical.
- **timeout** — one second before the program's deadline the op is rejected; at/after it lands. Chain Clock only.
Adapter contract is at the top of `actions.mjs`; it maps 1:1 onto the terminal builders in the chain-only client.

## Thresholds (config) and the verdict
`genesis`, `rpc disagreement`, `authority/elf drift`, `sbpf pin`, `state monotonic`, `founder unreachable`, `tick continuity` must be **zero events**; `oracle max gap ≤ limit`; `lifecycles ≥ minLifecycles`; the four write-side rows must be zero failures. Verdict = `PASS` only when every row passes AND elapsed chain time ≥ 72h; otherwise `FAIL` or `INCOMPLETE`. `T0.json`, `ticks.jsonl`, `scenarios.jsonl`, `T72.json` are the evidence; the T0/T72 shape follows the false-green attack note.

## Proof: does Work Market v2 join this build generation, or wait for the immutable-producer gate? — BOTH, and the distinction is exact
- `onchain/ratchet-work-market-v2/programs/ratchet-work-market-v2/src/lib.rs:421-424`: `fund_rcx_voucher` requires `completion_program.programdata_address()? == Some(completion_program_data.key())` **and** `completion_program_data.upgrade_authority_address.is_none()` (`CompletionProgramMutable`). A voucher can only ever be funded against an **immutable** completion program.
- Therefore, during the upgradeable pilot (P6 on devnet, P7 mainnet beta) **no WMv2 voucher can be funded against Core G2 or Timepin v2 by construction**. Not a policy choice — the program refuses.
- **Build it in the generation now** (SBPFv3, same tuple): its identity, hash and SBF negatives become part of the frozen tuple, and its source will not drift between the pilot and the immutable stage. Cost: one build. Benefit: no second tuple later.
- **Exercise it only against an immutable producer**: either a frozen throwaway devnet generation (recommended for P6, after the short upgradeable rehearsal has shaken out bugs), or mainnet after P10. The pilot's crank/settle liveness therefore runs on volunteer runners — say so in the T72 disclaimers.
- Consequently the canary treats `programs.work_market` as optional; when present, its `upgradeAuthority` pin must be `null` (frozen) or the WMv2 scenarios stay SKIPPED.

## What this pack does not do
It does not prove that strangers will run the game (see the false-green note, V1); it proves the bundle runs without us and that the measured window had no drift, no disagreement, no regression, no reachable founder service, and correct replay/race/rollback/timeout behaviour on the exact pinned generation.
