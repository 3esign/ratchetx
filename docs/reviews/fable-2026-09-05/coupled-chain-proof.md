# Coupled-chain adversarial proof — Fable, 2026-09-05

**Scope (assigned by Sol/Astra in ROOM, Semir: "Fable takes the hardest"):** prove or break the coupled chain
`C8ww Timepin artifact -> canonical Core Economy/Ruleset -> terminal/recovery -> Work Market v2 identity/immutability/economic conservation`,
with a concrete counterexample or exact acceptance evidence for every link.

**Method:** read-only source review of the laptop snapshot below, attack-driven (each link: claim -> evidence file:line -> attacks tried -> verdict -> gap and the test that closes it). Where a JS model exists I checked which negatives it already executes. I did not run Cargo. This is a source-level proof; the SBF-level gaps are named explicitly in section 6 and are the deliverable for Sol.

**Source snapshot (sha256 prefix):** core lib.rs `369a674bd255de0a` · state.rs `01b606394d9a1612` · foreign_timepin.rs `afbfa3d94bb9519a` · work-market-v2 lib.rs `204f1ccb547f357a` · work_market_v2.rs test `7735d0b54b45dd61` · timepin lib.rs `5bbcd7ec12a1b29b` · timepin lifecycle.rs `b80e00da06259464` · core_g2_lifecycle.rs test `461cdf0bd44b26b4` · core model.mjs `350d66cead9de6ca`. The three Core hashes equal those in `docs/reviews/svemir-2026-09-05/identity-core-binding-report.md` (same snapshot as Astra).

Companion facts established earlier today: US517 == base58([0x07;32]) exactly (placeholder by construction, no key); canonical Timepin id = C8ww (only held key); `tools/repin-timepin-vectors.mjs` reproduces current vectors (idempotence) and refuses mixed-identity staging by default.

---

## 0. Verdict in one paragraph

No link yields a counterexample at source level. Link 1 (artifact -> Economy) and Link 2 (Economy/Ruleset -> terminal) are correct by construction: every consumer reads the producer from immutable `Economy.args`, the Shot pins its exact Need, settlement requires `NEED_FINAL` with the recorded winning candidate, void requires `AMBIGUOUS|EXPIRED`, replay is blocked by state. Link 3 (Work Market v2) is the strongest link: mint pinned, beneficiary token accounts constrained to the receipt worker / recorded sponsor, explicit `Funded` guards, record identity re-validated, and the completion program must be **immutable** at fund time. Link 4 (liveness) holds: every Shot and every Need has a permissionless, chain-time-gated exit, so no voucher can be stuck. The one genuinely dangerous economic attack — manufacturing `AMBIGUOUS` to force refunds — is impossible for a third party because both candidates must be distinct Pyth-signed messages that bracket the target.
**The real finding is a proof gap, not a code defect:** the Core exact-SBF lifecycle test exercises *zero* of the Link 1/2 negative guards. They are proven only in host/model tests, which by this project's own rule cannot see account ownership, PDA seeds, `exact_len` or CPI. Section 6 lists the nine SBF negatives that close the gap. Two sequencing constraints are also made explicit: WMv2 cannot be funded against any upgradeable program (freeze-before-fund), and the void rate is an empirical cadence property that must be measured, not assumed.

---

## 1. Link 1 — C8ww artifact -> canonical Core Economy

**Claim.** Core accepts evidence only from the producer recorded immutably in the Economy; the producer identity is part of the Economy hash/PDA; an existing Shot cannot be retargeted to another Economy/Ruleset/producer.

**Evidence.**
- `lib.rs:76-117 register_economy`: `validate_economy` (state.rs:554 rejects zero producer) -> `economy_hash(args) == expected_hash` -> `timepin_program.key() == args.timepin_program` -> `timepin_program.executable` -> args written once (`schema == 0`), otherwise `ImmutableAccountMismatch` on any difference -> `authenticate_economy` recomputes hash + PDA.
- `state.rs:529-537 economy_hash` hashes the full `EconomyArgs` including `timepin_program` => a different producer is a different Economy PDA.
- Producer source at every consumer: `lib.rs:137, 922, 928, 1079, 1085, 1219, 1226, 1250, 1393, 1400, 1424, 1555, 1562, 1620, 1717, 1723, 1730, 1913` all read `ctx.accounts.economy.args.timepin_program`. The only caller-supplied `timepin_program` is `lib.rs:2354` (register) and it is key- and executable-checked.
- Kernel binding `lib.rs:4257-4295`: `authenticate_kernel` recomputes Economy, authenticates Ruleset against Economy, Ledger against `economy_hash+player`; `authenticate_shot_kernel` additionally requires `shot.economy_hash == economy.economy_hash`, `shot.ruleset_hash == ruleset.ruleset_hash`, `shot.entry_mode == ruleset.args.entry_mode`.

**Attacks tried.** (a) supply a lookalike executable as producer at registration -> creates a *different* Economy (different hash/PDA), cannot touch the canonical one; (b) pass a Need/Candidate owned by a lookalike to settle a canonical Shot -> owner check against stored producer (`foreign_timepin.rs:99-102`) rejects; (c) settle Shot X with Economy'/Ruleset' -> `WrongShot`; (d) re-register the canonical Economy with a changed producer -> `ImmutableAccountMismatch`.

**Verdict: acceptance, no counterexample.** Residual (not on-chain): the canonical *client* must pin the canonical Economy/Ruleset identity, otherwise a generic client can be lured into a parallel game — covered by Astra's acceptance case 1 and Opus's client-pinning review.

**Host/model coverage:** `WrongTimepinProgram`, `TimepinProgramNotExecutable`, `ImmutableAccountMismatch`, `WrongExpectedHash`, `WrongShot` each appear 2-21 times in host tests. **SBF coverage: 0** (see section 6).

---

## 2. Link 2 — Economy/Ruleset -> terminal/recovery

**Claim.** A Shot settles only against its own exit Need in `NEED_FINAL` with the recorded winning candidate; voids only against `AMBIGUOUS|EXPIRED`; settlement cannot be replayed; the sealed Need cannot already be resolved; deadlines recorded at seal are re-derived and enforced at settle.

**Evidence (`lib.rs:1693-1822 settle_final`).**
- `require shot.state == Active` (replay/void-after-settle blocked: second call is `WrongState`).
- `require exit_need.key() == shot.exit_need` — the Need address is stored in the Shot at seal; not caller-chosen.
- spec loaded with `rules.evidence_spec_hash` and `require_spec_ruleset_match`; Need loaded with `(producer, rules.evidence_spec_hash, shot.exit_target_ts)` — all stored values.
- `authenticate_final` (`foreign_timepin.rs:314-345`): `load_need` -> **`require need.state == NEED_FINAL`** (:323) -> spec/policy hash consistency -> `load_candidate(candidate, producer, need_key, &need.candidate_a_hash, ...)` — the candidate must be the PDA for the Need's own recorded winning hash and owned by the producer.
- `fixed_reveal_deadline(...) == shot.reveal_deadline_ts` (`BadTimepinDeadline`) — a Need with different deadlines than sealed is rejected; `exit.feed_id == rules.feed_id`.
- Outcome routing: `delta == 0` -> `AwaitVoid/Equality`; `band_numerator > 0 && in_band` -> `AwaitVoid/ConfidenceBand`; else `AwaitReveal` with `outcome_yes`. Resolver gets a `RECEIPT_PAYABLE` work record (work done = payable).
- `authenticate_void_terminal` (`foreign_timepin.rs:347-355`): **`require state == AMBIGUOUS || state == EXPIRED`** — void cannot be chosen over settle when the Need is Final.
- `load_open_need` (`foreign_timepin.rs:204-214`): seal requires `NEED_OPEN` — no betting on an already-resolved Need.
- `load_need` (`:162-230`) enforces state-consistent candidate shapes (Open/Expired: both zero; Candidate/Final: a set, b zero; Ambiguous: a < b both set) — malformed Need states are rejected before any decision.

**Attacks tried.** settle on Candidate-state Need -> `NeedNotFinal`; void on Final Need -> `WrongTerminalKind`; substitute a different valid Final Need -> `WrongNeed`; substitute a candidate for another message hash -> PDA/owner mismatch; settle twice -> `WrongState`; seal against a Final Need -> `NeedNotOpen`; supply a Need whose deadlines differ -> `BadTimepinDeadline`; wrong feed -> `WrongFeed`.

**Verdict: acceptance, no counterexample.** Model coverage: `test_core_g2_model.mjs:1500-1526` executes 7 terminal-fact negatives (`TIMEPIN_NEED_OWNER/LENGTH/PDA/EVIDENCE_SPEC/STATE`, `TIMEPIN_CANDIDATE_MESSAGE_HASH`, ...). **SBF coverage: 0.**

---

## 3. Link 2b — the ambiguity/griefing attack (the one that could have broken the economy)

**Attack.** Core refunds on `AMBIGUOUS`. If a third party could *manufacture* ambiguity, every losing Shot could be voided and the game degenerates into refund spam.

**Rule (`timepin_lifecycle.rs`).** `capture_conflict_handler` (:896-985) requires `state == CANDIDATE` with `candidate_a` set and `candidate_b` zero; re-authenticates candidate A; loads the second candidate through the **same** `load_evidence` -> `validate_decision_fields` (:1166-1200): `prev_publish_time < target_ts <= publish_time` (`DoesNotBracketTarget`), pre-gap/post-lag bounds, `publish_time <= source_deadline_ts`, positive price, exponent bounds; and requires `expected_message_hash != first_hash` (`DuplicateMustUseFirstCapture`). Both candidates pass `VERIFICATION_FULL` through the official Receiver (generation-pinned).

**Analysis.** Pyth chains `prev_publish_time` to the previous update; under a consistent chain exactly one update brackets a given target. Two distinct bracketing messages therefore require Pyth itself to sign two different aggregates that both bracket (same-second double aggregate, revision, or a broken chain). A third party controls neither Pyth signatures nor the publish-time chain.

**Verdict: not manufacturable — acceptance.** What remains is **empirical, not adversarial**: the frequencies of (i) an unbracketable feed post (`prev_publish_time >= target`, leading to `EXPIRED`) and (ii) genuine double bracketing (`AMBIGUOUS`) set the game's void rate. They must be measured on the selected feeds over the P6 window (the stock-cadence work already showed five of six "24/7" feeds stop at US close). Owner: cadence measurements (Sol/Opus). Do not tune `max_pre_target_gap` / `max_post_target_lag` to "make captures happen" — that weakens the bracket; measure and choose feeds/horizons instead.

---

## 4. Link 3 — terminal -> Work Market v2 (identity, immutability, conservation)

**Claim.** A voucher pays exactly the funded RCX to the worker named by a PAYABLE completion receipt, or refunds the sponsor on NONPAYABLE; nobody else can receive; no double settlement; the completion program cannot change semantics under a live voucher.

**Evidence (`wm2.rs`).**
- Mint pinned: `address = RCX_MINT` on fund/claim/refund (:453, :494, :546); `RCX_MINT` is a PDA seed (:356).
- **Immutable producer:** `FundRcxVoucher` (:421-424) `constraint = completion_program.programdata_address()? == Some(completion_program_data.key())` and `completion_program_data.upgrade_authority_address.is_none() @ CompletionProgramMutable`. A voucher can only be funded against a program that can never change; irreversibility makes re-checking at claim unnecessary.
- Fund (:39-131): `work_kind > 0`, `amount > 0`, Token-2022, decimals; manifest loaded by owner+PDA+len+discriminator+bump (:738-772); subject validated; completion record must be `RECEIPT_PENDING` (no funding a known outcome); voucher stores completion_program/subject/locator/slot/sponsor/nonce/amount; RCX moved sponsor -> vault by `transfer_checked`.
- Claim (:132-200): manifest and record re-loaded from the **voucher's stored** program/subject/kind/slot; `disposition == PAYABLE`; `worker.key() == receipt.worker`; `worker_token` constrained `token::mint = mint, token::authority = worker` (:498-504) — funds can only land in an account owned by the receipt worker; claim is permissionless (anyone submits, nobody chooses the destination); full vault balance transferred, vault closed (rent -> sponsor), state `Paid`, `beneficiary`/`result_hash` frozen; settlement memo CPI records voucher/destination/disposition/beneficiary/result_hash/amount (:306-318).
- Refund (:201-264): mirror with `NONPAYABLE`, `sponsor_token` constrained `token::authority = sponsor`, sponsor address-pinned to `voucher.sponsor`.
- State guards: `constraint = voucher.state == Funded @ VoucherNotFunded` on claim and refund (:482, :534) — double-claim, claim-after-refund, refund-after-claim all rejected explicitly. `close_voucher` (:265-279) requires `Paid || Refunded` (`VoucherStillFunded`), `close = sponsor`, `has_one = sponsor`.
- Record identity: `load_completion_record` (:810-856) checks non-executable, owner == completion program, discriminator/schema from manifest, then **`validate_completion_identity(record, subject, work_kind)`** (:849) and `validate_completion_record` — a reorganized page cannot substitute another subject's PAYABLE record at the same slot.

**Attacks tried.** attacker's own token account with the real worker key -> `token::authority = worker` rejects; wrong mint -> `WrongMint`; fund against an upgradeable Core/Timepin -> `CompletionProgramMutable`; fund against an already-PAYABLE record -> `CompletionNotPending`; claim twice / refund after claim -> `VoucherNotFunded`; close while Funded -> `VoucherStillFunded`; substitute locator or slot -> address pin + identity validation; mutated record -> discriminator/schema/identity checks.

**SBF coverage: present.** `work_market_v2.rs` runs `mutated_or_substituted_packed_locator_fails_atomically_then_canonical_record_pays`, `mutable_completion_programdata_is_rejected_before_funding_moves_rcx`, `wrong_and_missing_memo_programs_fail_atomically_before_outbound_value_moves`, plus fund->claim, fund->refund and the frozen-programdata + real-RCX-mint positive controls.

**Verdict: acceptance, no counterexample — the strongest link.**

**Sequencing constraint (hard, not a bug):** because funding requires an *immutable* completion program, **WMv2 cannot be exercised against Core G2 or Timepin v2 until they are frozen** — yet P10 (authority retirement) is the last gate. This is the "circular pre-freeze funding gate". Do not waive the constraint. Resolution: the devnet generation is a throwaway — **freeze the devnet Core/Timepin candidates on devnet** and run WMv2 + P6 against them; mainnet freeze stays a separately authorized ceremony.

---

## 5. Link 4 — liveness: no stuck value

**Claim.** Every PENDING work record reaches PAYABLE or NONPAYABLE through a permissionless, chain-time-gated instruction, so no sponsor can be locked and no player can be held hostage.

**Evidence.** Core receipt sites: `activate_entry` PAYABLE (:1584); `void_pending_entry` (:1649/1661/1673); `settle_final` PAYABLE (:1805); `finalize_resolved_void` NONPAYABLE (:1870); `void_active_shot` (:1942/1954); `reveal`/`reveal_delegated` NONPAYABLE (:2094/:2254 — player revealed, forfeit not needed); `forfeit` PAYABLE (:2320) — requires `AwaitReveal` and `clock.unix_timestamp >= shot.reveal_deadline_ts`, any signer. Timepin: `expire` is permissionless after the capture deadline; `AMBIGUOUS|EXPIRED` feed `void_active_shot`. Chain-`Clock` gating everywhere (the next-print devnet run proved the wall-clock trap is a runner bug, not a program bug).

**Verdict: acceptance.** Every state has an exit that does not depend on the founder, a keeper, or the original submitter.

---

## 6. The deliverable for Sol: nine exact-SBF negative cases that close the proof gap

The Core exact-SBF lifecycle (`core_g2_lifecycle.rs`, 6 positive cases) contains **zero** of the following error paths. Each is one transaction against the real Core + C8ww Timepin SBF with one mutation and one expected error; add them to the same LiteSVM harness (no new fixtures needed beyond what the positive lifecycle already builds).

| # | Mutation | Expected rejection |
|---|---|---|
| 1 | `settle_final` while exit Need is `NEED_CANDIDATE` (captured, not finalized) | `NeedNotFinal` |
| 2 | `void_active_shot` while exit Need is `NEED_FINAL` | `WrongTerminalKind` |
| 3 | `settle_final` with a candidate account that is a valid PDA for a *different* message hash | candidate PDA/owner mismatch |
| 4 | `settle_final` twice on the same Shot | `WrongState` |
| 5 | `settle_final` supplying a different, valid, Final Need than `shot.exit_need` | `WrongNeed` |
| 6 | `seal_forward` against a Need already `NEED_FINAL` | `NeedNotOpen` |
| 7 | `settle_final` with Economy'/Ruleset' from a second registration | `WrongShot` |
| 8 | `register_economy` with (a) non-executable producer, (b) key != `args.timepin_program`, (c) re-register with changed args | `TimepinProgramNotExecutable` / `WrongTimepinProgram` / `ImmutableAccountMismatch` |
| 9 | Need + Candidate with identical bytes but owned by a lookalike program id | foreign-owner error (`foreign_timepin.rs:462`) |

Optional 10: `settle_final` with a Need whose deadlines were altered (synthetic) -> `BadTimepinDeadline`.

These are the security properties of the whole chain; until they pass on the SBF they are proven only at host/model level. Estimated cost: one link cycle if added to the existing harness file.

---

## 7. Other findings (non-blocking, recorded so they are not lost)
- `state.rs:2536` Core host unit test uses `timepin_program: [7;32]` as a synthetic producer — harmless for a hash test, but for hygiene migrate to C8ww with the rest of the identity re-lock (Timepin `lib.rs:1049-1050` is already on Sol's list).
- `test/test_timepin_v2_lifecycle_vectors.mjs` hardcodes the Timepin SBF sha (`8d913a5d…`, ~line 305) — the fourth re-lock site, already reported in ROOM.
- `settle_final` band void only triggers when `band_numerator > 0`; with the shipped 0 only equality voids — consistent with the recorded decision not to freeze `k` before measurement.
- WMv2 pays the **entire** vault balance to the beneficiary (`amount = vault.amount >= funded_amount`); a donor who tops up a vault gifts the beneficiary. Not a defect; document it.

## 8. What this proof does not claim
It does not claim the C8ww SBF exists yet, that any of the nine negatives pass, that the devnet lifecycle has run, or that the void rate is acceptable. It claims that, at this source snapshot, the coupled chain has no retarget, replay, void-instead-of-settle, beneficiary-substitution, mint-substitution, mutable-producer or stuck-value path, and it names exactly what must be executed to turn that reading into SBF evidence.
