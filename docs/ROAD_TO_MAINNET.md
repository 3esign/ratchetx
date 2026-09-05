# RatchetX — Road to mainnet (single tracker)

**Opened:** 2026-09-05 by Opus (Cowork). **Tree:** `codex/core-source-bracket` @ `fcaab92`.
**This supersedes as the working tracker:** `MAINNET_PLAN.md`, `AGENTS_CHANNEL.md`, `COWORK_HANDOFF.md`,
`docs/FINISH_PLAN_2026-09-02.md`, `CUTOVER_RUNBOOK.md` (kept as history; do not plan from them).
`PERMANENCE_EXECUTION_PLAN.md` keeps its decision register only.

Evidence tiers used below, always stated: `host` < `exact-SBF (LiteSVM)` < `devnet with real Pyth accounts` < `mainnet`.
A green compile or model run is never a GO.

---

## 1. Where we actually are (verified, not asserted)

| Surface | State | Evidence |
| --- | --- | --- |
| Settlement rule in this tree | STILL the strict bracket `prev_publish_time < T <= publish_time` | `onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs:1172` |
| That rule against the real feed | **Unplayable as canonical — and the "0/25" that first proved it was a window, not the rule.** 63-minute mainnet run, all 7 feeds, 442 targets at grid 60, zero RPC errors: strict bracket hits **11.1 %** on SOL/BTC (15.4 % at grid 300) and **0–1.6 %** on the five slow feeds. The publish phase sweeps — SOL visited all five values in 63 minutes — so Fable's 0/25 and Opus C's own 0/19 were unlucky windows. 11 % is still not a game, and a swept phase makes the phase-pin idea worse rather than better. | Opus C, `docs/reviews/cadence/cadence-2026-09-05.ndjson`; original window: Fable `INSPECTION_2026-09-05.md` App. A |
| MIN-CAPTURE against the same run | **100.0 % on every feed, 442 of 442 targets.** Not 95, not 99. First-print lag p99: **4 s** for SOL/BTC, **51–52 s** for the other five — two populations, so `max_post_target_lag` cannot be one number. | same file |
| Keyless recovery of an upgraded Pyth proof | **Proven possible** for prints actually submitted on Solana: tx `3jsTus...` slot 444408680 reconstructed end-to-end from public RPC — full 292 B HDw2 VAA from `WriteEncodedVaa` chunks, guardian set 1, 3 valid sigs of 5, 342 B rec2 `PostUpdate`, leaf folds to root. | Codex 10:16Z; `docs/reviews/svemir-2026-09-05/REPLAY_FEASIBILITY_ADDENDUM.md` |
| Keyless source for *every* Pyth root | **Does not exist for us.** Upgraded wrapper uses chain-26 emitter `507974…`, guardian set 1 — not the legacy `e101`/set-7 PAS1 wrapper; Wormholescan lookup for the new emitter returns empty. Public quorum hosts answer without a key (HTTP 200, `wss://quorum-{1,2,3}.pyth.network/ws` handshake succeeds) but emitted **0 messages in a simultaneous 50 s observation**. The ledger exposes only submitted leaves; the unsubmitted tree cannot be recovered from a root. | Sol 10:08Z/10:23Z, Codex 10:16Z/10:30Z |
| The strict-bracket adapter as shipped in the candidate (called "Adapter 2" that morning; the code now numbers it **1**, see the note under §2) | Its exact-SBF test fabricates a rec2-owned `Full` account with `set_account`; HDw2/rec2 never execute, so it is **not** an acceptance receipt. `PriceUpdateV2` stores no emitter/guardian/config provenance, so a current-config check at capture cannot prove the account was posted under that config. | Codex 10:22Z |
| Forward landing race | Core computes `T = ceil((Clock@execution + lead)/grid)*grid`; the client freezes `T` from an earlier `chainNow`. Remaining landing budget is `0..grid-1`, not `lead`: at grid 60 s a 5 s wallet delay fails in **8.3 %** of clock phases. | Codex 10:00Z |
| Candidate economics | `CandidateV2` is permanent actor-funded rent (measured 1,564,251 lamports; Need 1,646,580). Repeated candidate replacement strands rent. Existing irreversible `WORK_KIND_FIRST_CAPTURE` pays the first submitter, who can be displaced by a better one — double/wrong-worker payout. | Codex 10:23Z |
| Programs on chain | Nothing G2 is deployed anywhere. Seal v2 `23k3r8…` on mainnet (authority retained); Core v1 `6sJn9…` is devnet. No C8ww / ANVG / SBPFv3 artifact exists yet. | Fable §1, Astra receipts |
| Production | `ratchetx.xyz` `/api/game` HTTP 500 since >= 2026-09-03 — Upstash free plan 500,000/500,000 consumed. Not code: a decision. | Fable B2 |
| Public promise | README + `llms.txt` still say the authority "is revoked for good on 2026-09-08 … Ever." The freeze was cancelled 09-03 and no public surface says so. **Expires in 3 days.** | Fable B8 |
| Client | Production UI has no G2 path; `client-v2.mjs` has two encoder defects that make EvidenceSpec registration impossible. | Fable B5 |

**Two things everyone has been circling that are now settled and must not be re-litigated:**
1. There is no free every-tick Pyth source. Stop looking for one. (Three independent probes, two agents.)
2. Recovering an already-submitted proof keylessly works. That is enough to build on, and it is *not* enough
   to claim "Pyth-first". Never write that phrase again.

---

## 2. The one open node: what price settles a shot

Three candidates were on the table this morning. Verdict on each:

**REOPEN CONDITION for A, registered 2026-09-05 11:12Z (Opus A's finding, accepted).** Fable measured
that a free keyless source delivering *every* aggregate already exists: the Pythnet PAS1 accumulator
ring PDA, 7 feeds x 100 % of target seconds, roots recomputed and required to equal the guardian-signed
root, 0 mismatches. The strict bracket is therefore blocked on **consumability, not availability** —
the ring carries emitter `e101…`, while `rec2` accepts only chain-26 `507974…` under guardian set 1, and
nobody can post ring leaves to Solana without an acceptable wrapper. If a keyless route to the upgraded
wrapper for every root is ever found, the strict-bracket adapter (**adapter 1** in the code) becomes
viable and this decision is reopened. The named
decider Fable left open: read the encoded-VAA account of a live sponsored transaction *before* it is
closed.

**A — strict bracket `prev < T <= pub` as canonical (today's code).**
NO-GO as default, and the reason is now measured rather than inferred: **11.1 %** on SOL/BTC over 442
targets, **0–1.6 %** on the five slow feeds. The earlier "0/25" was a single unlucky phase window and
anyone quoting it as if the rule were dead in all phases will be contradicted by the run. It does not
matter: an 11 % settlement rate is not a game, and because the phase *sweeps*, pinning it into a
write-once ruleset is worse than leaving it alone. The rule still needs a per-aggregate source we do
not have (§1).

**B — "first accepted sponsored capture wins" (Sol 10:23Z).**
NO-GO as canonical. Correctly rejected by Codex 10:27Z: the first — possibly only — capturer may withhold
until a later print favours them. Permissionless access and disclosure do not remove that option. It is a
chooser, and a chooser is exactly the thing this project exists to eliminate.

**C — strict bracket + immutable per-feed `target_grid_phase_seconds` (Sol 10:31Z).**
NO-GO. It is safe and it does not work. The phase is *someone else's cron*: it already moved through three
values (2, 3, 4) inside one 25-minute sample, sliding ~1 s per 10–12 min. A phase pinned into a **write-once**
ruleset would hold for a fraction of each cycle and VOID everything else, permanently, with no way to retune
except a new economy and a re-opened ledger for every player. Trading a chooser for "the game works when
Pyth's scheduler happens to agree" is not the better trade.

### Recommendation — D: MIN-CAPTURE (canonical, **adapter 2** in the code) — now measured at 100 %

> **442 of 442 targets on all seven feeds**, 63-minute mainnet run, zero RPC errors. This is the
> number Gate 2's void rate is built on, and it is the difference between a rule that argues well and
> a rule that works.

> **Numbering, fixed 2026-09-05 after I confused it myself.** The code is the authority and it reads:
> `ADAPTER_PYTH_PUSH_V2 = 1` is the **strict bracket**, kept and marked experimental;
> `ADAPTER_PYTH_MIN_CAPTURE_V2 = 2` is **MIN-CAPTURE**, the canonical rule
> (`rcx-timepin-v2/src/lib.rs:29`, `onchain/rcx-timepin/model-v2.mjs:10,24`). Earlier prose in this
> file said "adapter 2" for the strict bracket, because that is what Sol's candidate was called on
> the morning of 09-05. Wherever the two disagree, the constant wins.

> Admissible price for target `T` = the sponsored print with the **smallest `publish_time` such that
> `publish_time >= T`**, among **all** candidates submitted before `T + max_post_target_lag`.
> Ties: smaller `posted_slot`, then smaller message hash. Submission order does **not** select the price.

Why this and not B: under B the *first submitter* fixes the price, so withholding always pays. Under
MIN-CAPTURE a submitter with an *earlier* `publish_time` wins regardless of who landed first, so a
single capturer cannot fix the price while anyone else is watching.

**Corrected 2026-09-05 11:12Z, after Opus A's P1 — the first version of this paragraph overstated the
guarantee.** The sponsored account holds one message at a time and the pusher overwrites it every ~5 s
(SOL/BTC; ~52 s ETH). The program reads the live account, so a message that was there at `T+2` is gone
by `T+7` and cannot be submitted afterwards by anyone. Replacement therefore works only *while the
message is still on the account*, not until `capture_deadline_ts`. The honest claim is **1-of-N among
observers watching in real time during that availability window**, which makes running at least two
independent second-by-second cranks part of the security argument rather than an optimisation
(Phase 3.4 is load-bearing for Phase 1). The residual, for the settlement page:

> "Every observer watching the feed in real time can submit the earliest print they see, and the
> earliest `publish_time` wins no matter who submits first. If no independent observer is watching
> during the seconds a print is live on chain, the single capturer chose between that print and the
> next one, at most ~5 s apart."

That is weaker than "no chooser exists" and stronger than anything reachable without a per-tick source.
It is the sentence Semir approves or rejects, in §4.5.

Consequences that come with it, and are part of the decision, not follow-ups:

1. **Candidate storage changes shape.** No PDA per candidate. One replaceable *best observation* stored
   inline in the Need, fixed width, with `replace_if_better` (strictly smaller `publish_time`, else smaller
   `posted_slot`). Zero extra rent, zero stranded rent, and it kills Codex's rent finding at the root.
2. **`WORK_KIND_FIRST_CAPTURE` must be versioned or removed.** The reward is owed to the worker recorded in
   the *final selected* observation, paid once, in the same atomic terminal transition, to the stored
   signer — never to `PriceUpdate.write_authority`, never to a displaced submitter.
3. **`AMBIGUOUS` narrows** to two distinct Pyth-signed messages with the *same* `publish_time` (a safety net
   that should never fire). A later candidate with a larger `publish_time` is not a conflict — it is a no-op.
4. **The strict bracket (adapter 1) stays in the code, marked experimental**, unusable until a source that
   delivers every aggregate exists. It is not the default and must not be registered on mainnet.
5. **The trust statement changes and must be published:** `rec2` governance is inside the TCB. Pin
   `wormhole`, `valid_data_sources` and `minimum_signatures` only — not the whole 370-byte config (Fable
   B6.8) — and say plainly on the proof page: "evidence program upgradeable, authority = …".

This is a design decision, not an implementation detail: **it must land before the SBPFv3 build, the vector
re-pin and the ELF hash lock**, or all three are redone.

---

## 2b. The design law this project is being built under

Stated by Semir, 2026-09-05, and it governs every step below: **go fully on-chain, keep the rules
flexible enough that the game stays meaningful and playable, and do not be afraid to throw things
away.** The target is the elegant form that *emerges from the nature of the technology* — discovered
through the failures, narrowed to the minimum: only the nodes and the connections that matter, the
way a formula is minimal. Reduction is not cost-cutting here; it is the method.

Applied to what we learned today, the reduction is this:

**Stop treating a settlement price as an approximation of a price that exists somewhere else.**
There is no keyless per-tick source (§1, proven three times). So the "true first print at `T`" is not
a thing our machine can ever see, and every rule that pretends otherwise inherits a residual. What the
chain actually contains is: *signed messages somebody recorded*. Define the game over **that**, and
the residual stops being a defect in the rule and becomes the rule.

**And then the residual shrinks on its own, for a reason that was already in the design.** A capturer
who withholds one print to submit a later one is choosing a price — but the shots are **sealed**:
directions are commitments, revealed after settlement. A capturer therefore does not know which way
the shots on that target point. Better: the Need is shared — one per `(spec, target_ts)` — so a
capturer who is also a player moves the price for *every* shot on that target, their opponents
included. Their edge is diluted by the size of the book. **The residual is inversely proportional to
the number of players**, which is the same shape as every other guarantee in this system, and it is
why 1000 players is a security parameter and not only a growth target.

> **VERIFIED 2026-09-05 11:30Z by the lead, in the code, file:line — the ordering holds.**
> `reveal` (`ratchet-core-g2/src/lib.rs:1974`) requires `shot.state == AwaitReveal` (`:1986-1989`).
> A shot reaches `AwaitReveal` only through `settle_final` (`:1693`), which requires
> `shot.state == Active` (`:1705-1708`) **and** an exit Need that is already `FINAL`
> (`authenticate_final`, `:1727`). A Need reaches `FINAL` only through Timepin's `finalize_handler`,
> which runs after capture. Therefore **no direction for a target can be revealed before that target
> has been captured and finalized** — not for shots exiting on `T`, and not for shots entering on `T`
> either, since those are sealed at entry and revealed only after their own later exit. `settle_final`
> is permissionless but discloses nothing: it moves state, the direction stays inside the commitment.
>
> **What this makes true, and it is the strongest honest claim we have:** a capturer choosing between
> two prints is blind to every direction on that target except their own. They can see the *size* of
> the book (account state is public) but not its *lean*. So the exploitable residual is bounded by
> **the capturer's own share of the book on that target** — not by the whole book, and not by the
> price gap. One player alone on a target is fully exposed; a target with a real book is not. This is
> a bound we can state publicly, it is falsifiable, and it is the reason the game gets *safer* as it
> grows rather than merely bigger.

### The test that follows from it: what holds this in place when nobody is watching?

Semir, 2026-09-05, watching the agents correct each other: *the elements catch each other — recognise
that as gravity in the physical world; the natural laws of the chain.* That is not decoration, it is
the acceptance criterion, and it has one question in it that every remaining decision has to pass:

> **What holds this in place when nobody is watching? If the answer names a person, a process, or a
> promise, it is not finished. If it names a force already present in the parts, it is.**

Gravity has no supervisor. Nothing enforces it; it is a property of the bodies. A settlement rule
that needs an honest operator, a crank we personally run, or a document somebody remembers to read,
is held up by attention — and attention is the one input that fails at 3am, at scale, and after we
are gone. A rule held up by the shape of its own parts does not.

Everything decided today passes or fails on that question, and it is worth seeing that it is the same
law twice, at two scales:

**In the protocol.** MIN-CAPTURE holds because any observer can displace a worse observation with an
earlier one — no honest operator required, only a non-empty set of watchers. Commit-reveal holds
because the capturer is blind to the directions on the target; the ordering that guarantees it was
verified in the code, not promised. The shared Need holds because a capturer who is also a player
moves the price for their own opponents too. The write-once economy holds because there is no field
an operator could turn. In every one, the restraint is *in the parts*.

**In the team.** Six agents caught four defects in each other's work in three hours, including two of
mine, and none of it needed me to notice. The room is not supervision — it is the medium the force
travels through. Claims are public, evidence is a file path, and a wrong number is cheaper to correct
than to defend. Same law: nobody is watching, and it still holds.

Where the two disagree, the protocol wins, because agents get tired and programs do not.

**The corollary that costs us work, and we take it anyway:** anything currently held up by a person is
a debt on this list, and it should be named as one rather than lived with. Today's list of such debts:
the capture cranks we intend to run ourselves (Phase 3.4 — which is why the inline bounty matters, it
turns our attention into anyone's incentive), the parameters no constant enforces yet, and every
document that has to be read to be obeyed rather than executed as a gate.

Three things follow for the sequence, and they are why the phases are ordered as they are:

1. **Fewer moving parts beats more guarantees.** MIN-CAPTURE removes a whole account kind
   (`CandidateV2`), a whole instruction (`capture_conflict`), and a decoder in Core. That is the
   right direction of travel; keep looking for the next thing to delete.
2. **A rule that needs a source we do not have is not a rule.** The strict bracket was elegant on
   paper and unplayable in fact. Its reopen condition is registered, and it stays shut until the
   source is real.
3. **Flexibility lives in the ruleset, not in the program.** Parameters are content-addressed and
   write-once per economy, so the place to allow future change is a *new registered ruleset*, never a
   mutable field. Anything an operator could turn is an operator we said we would not have.

## 2c. Open reduction proposal — delete the work market from the launch generation

**Status: proposed by the lead 2026-09-05, NOT decided. Wants two adversarial reviews before it goes
near the tracker's sequence.** Filed here because §2b says to keep looking for the next thing to
delete, and this is the largest thing on the board.

**CORRECTED 2026-09-05 12:1xZ — my first version of this proposal aimed at the wrong program, and
the measurement that fixed it also found a better repair than deletion.** Pinned in
`test/test_work_page_cost_model.mjs`, read out of the source so it cannot go stale:

| | Core G2 | Timepin v2 |
| --- | --- | --- |
| `WORK_PAGE_CAP` | **48** (`HISTORY_PAGE_CAP × WORK_KINDS_PER_SHOT`, asserted at `lib.rs:5038`) | **2** (`lifecycle.rs:36`) |
| comparisons per `validate_contents` on a full page | **1128** | **1** |
| record bytes per pass | 5,088 (`WorkRecord::LEN` = 106) | 212 |

So Timepin's work market is *cheap* — deleting it would have removed the inexpensive one and left the
expensive one standing. The surface count (118 occurrences in Timepin's `lifecycle.rs`, 95 in Core's
`lib.rs`) measures text, not cost, and I let it stand in for cost.

**And the real defect is not the page at all — it is validating on read.**
`lookup_optional_index` (`state.rs:1690-1697`) calls `validate_contents()` on *every lookup*, so the
O(n²) duplicate scan is paid per access rather than once per write. `void_pending_entry` issues three
`complete_optional_work` calls back to back, so the failure path pays **≥ 3,384 comparisons and
30,528 bytes of (de)serialisation** before a single CU is counted — and **no SBF test fills a page**,
so the actual ceiling is still unknown.

The minimal repair is therefore not deletion: **enforce the no-duplicate invariant where records are
inserted, and stop re-validating on read.** One invariant, checked once, O(n) at the write. That is
smaller than deleting a subsystem and it removes the same risk.

**What it buys.** It is what makes capture permissionless *and* paid, so that cranks exist without us
running them. That matters: a game whose settlement depends on Semir's machine has an operator, and
we said we would not have one.

**The reduction, still worth considering but no longer urgent.** The same meaning in a fraction of
the form: **an inline capture bounty in the Need.** Escrow it when the Need is opened, record the worker in the observation (MIN-CAPTURE already
adds that field), pay it once at finalize to the recorded worker. No `WorkPage`, no `WorkManifest`,
no reservations, no page rollover, no O(n²) validation, no extra rent, and the compute path that
currently has no test simply stops existing. Permissionless and paid, both kept.

**What this would lose, honestly:** the general market — sponsoring arbitrary future work kinds,
several workers splitting one job, work that is not capture. None of that is needed to play a shot,
and none of it is on the path to mainnet. It can return later as its own program without touching a
frozen Core.

**Before this becomes a decision it needs, in the room:**
1. An adversarial review that names a launch-critical thing the inline bounty cannot do
   (Astra-class: try to break it, do not try to agree).
2. A measurement of what actually depends on `WorkPage` today outside capture and terminalize —
   if the answer is "nothing", that is the answer.
3. Semir's call, because it changes what the launch economy pays for, and payment shape is his §4.

**What changed in priority:** the validate-on-read repair is now the item worth doing, and it is
small, local and independent of MIN-CAPTURE. The deletion stays proposed and unhurried.
Until all three exist, **nobody deletes anything.** MIN-CAPTURE lands as specified, with
`WORK_KIND_FIRST_CAPTURE` versioned per `MIN_CAPTURE_SPEC.md` §5, and this proposal stays proposed.

## 3. Sequence, with the gate that closes each step

No step is "done" without its exit evidence in git. A DONE without a commit hash is a draft.

### Phase 0 — today, no build required, nothing blocks it

> **Status 2026-09-05 12:10Z.** 0.1 DONE and committed (`d7c9162`), but the exit is not reached: the
> corrected copy is in git and **not on the live site** — that needs a push and a redeploy, which is
> Semir's and nobody else's, and the old promise expires Monday. 0.2 DONE (`0a166f5`) after Opus B
> refuted the first "closed" ruling; 0.4 DONE (`0a166f5`); 0.5 DONE (`04d3192`, all 120 evidence
> files tracked — before it, every evidence pointer in this file resolved to a path a clean checkout
> would erase). 0.3 the tool is fixed and tested (`b0ba8d2`) but **the snapshot has not been taken**:
> it needs the store credentials, which only Semir has.

| # | Item | Exit evidence |
| --- | --- | --- |
| 0.1 | **DONE 2026-09-05.** **Public promise** (Fable B8): README:104,215 + `llms.txt`:18,104 + `docs/AGENT_STATE.json`:31-33 → "no freeze is scheduled; authority retained while the on-chain successor is built; a future ceremony will be registered in advance." | diff merged; live surfaces re-fetched |
| 0.2 | **Deploy set** (B3) — **ROOT CLOSED, TREE NOT. Retracted 11:13Z after Opus B's P1:** a *tracked* file in a *new top-level directory* (`notes/dump.txt`) ships with zero errors, because `check-deploy-input.mjs:50` allowlists root names only and `:52` catches only *untracked* files inside directories. Fix belongs in `check-deploy-input.mjs` (a `ROOT_DIRS` allowlist beside `ROOT_FILES`), not in `.vercelignore`. Owner: Opus B. Also P2: untracked root `.css/.png/.jpg` ship through the extension escape in `:50`. Verified working part of `fcaab92`: `scripts/check-deploy-input.mjs` enumerates tracked ∪ untracked minus `.vercelignore` (deliberately without `--exclude-standard`), holds a `ROOT_FILES` allowlist, and rejects symlinks, private paths and untracked subdirectory files. Do **not** convert `.vercelignore` into an allowlist — enforcement belongs in the gate. | **New exit test (replaces the old one, Opus B's wording):** (a) unanticipated root name `notes.txt` → red (already true); (b) **tracked `notes/dump.txt` → red (green today, this is the one that must change)**. Measured baseline: 103 deployment files, root set clean; planted `zzz_gate_probe.js` + `lib/zzz_probe_dir/probe.js` → exit=1 naming both, clean run exit=0 |
| 0.3 | **Obligations snapshot** (B7): raw Redis strings, sibling `.sha256`, finalized slot + genesis hash + chosen `migration_id`; gate the other writers (`loadPlayer` welcome grant, stake yield, anchor XP) not just `takeStake`. | snapshot sha + slot in a private receipt; `test_migration_freeze.mjs` has one case per writer |
| 0.4 | **Test gate honesty** — **DONE 2026-09-05.** `scripts/run-tests.mjs` now exits non-zero on any skipped suite unless `RATCHET_ALLOW_SKIPS` is set, and prints why. `DEPLOY.cmd` never sets it. Note: the skips Fable reproduced came from a Linux sandbox where Playwright probes `chromium`; on Windows the probe uses `channel: 'chrome'`, so the suites may already run there — confirm on the real deploy machine. | code in place; confirm the count on Windows before treating the browser suites as covered |
| 0.5 | **Preserve the signed bytes** we reconstructed (Codex 10:30Z) before RPC pruning. | bytes + hashes committed under `docs/reviews/` |

### Phase 1 — the rule (single owner, one Rust editor at a time)

> **Status 2026-09-05 12:45Z.** The predicate is IN and adapter-gated (`lifecycle.rs:1177` for
> MIN-CAPTURE, the strict bracket kept in the `else`), both JS models carry it, and the rule has
> tests for the first time: **20 Timepin + 25 Core host tests, all green**, executed in the cloud
> container (`cargo test --lib`). Still open in Phase 1: the inline observation in the Need,
> `replace_if_better`, the narrowed `AMBIGUOUS`, `finalize >= capture_deadline_ts`, and moving the
> reward to finalize. Spec §7 items 3, 5 and 7 are blocked on that code existing, not on time.
>
> **Anyone can now get a Rust compile and the host tests in about ninety seconds** — the cloud
> container has cargo 1.95 and crates.io; only `build-sbf` is missing. Ask the lead. This was
> discovered at 12:27Z after the team spent the morning assuming the toolchain was Windows-only.
>
> **Implementation spec: `docs/MIN_CAPTURE_SPEC.md` (written 2026-09-05, owner Opus A).** It carries
> three things found by reading the code rather than reasoning about it: `finalize` must require
> `clock >= capture_deadline_ts` or the rule degenerates back into a chooser; the candidate PDA is
> seeded by message hash, so the observation moves inline into the Need; and `AMBIGUOUS` narrows to
> same-`publish_time`-different-hash only. Do not implement a different predicate.
| # | Item | Exit evidence |
| --- | --- | --- |
| 1.1 | MIN-CAPTURE in `lifecycle.rs` (replace :1172 predicate), inline best-observation + `replace_if_better`, narrowed `AMBIGUOUS`, adapter 1 (strict bracket) gated experimental | host tests incl. **bracket negatives** (none exist today at any level) |
| 1.2 | Same predicate in `foreign_timepin.rs::validate_record_against_spec`, `model.mjs`, vectors, `SETTLEMENT.md`, `CORE_G3_ARCHIVE.md` | `test_client_model_parity.mjs`: byte-identical encoders JS vs Rust |
| 1.3 | Clock-skew gate (B6.7): `clock + max_future_skew >= target`, floor `max_future_skew_seconds >= 30`, same in `foreign_timepin.rs:291-294` | host test at the boundary |
| 1.4 | Forward landing race (Codex 10:00Z): accept any aligned `entry_target_ts >= Clock + minLead`, then authenticate the exact OPEN Need; client picks `align_up(freshClock + lead + oneGridSlack)` | boundary tests: succeeds at `e = T-L`, fails at `T-L+1`; misaligned/past fail; same `T` → same Need; full rollback |
| 1.5 | Generation pin narrowed to `wormhole` + `valid_data_sources` + `minimum_signatures`; generation accounts passed to `open_need` | benign config change no longer voids open Needs (host sim) |
| 1.6 | Reward wiring: `WORK_KIND_FIRST_CAPTURE` versioned/removed; payout to the stored final worker, once per leg, alias rejected | conservation test: `C + 2R` vs Shot rent floor |
| **GATE 1** | **One** SBPFv3 build: Timepin `C8ww` + Core `ANVG`, `--arch v3`, `cargo-build-sbf 4.3.0` / platform-tools v1.56 | both ELF hashes + `verify-artifact` PASS with `EXPECT_SBPF=3`; vectors regenerated by a script that exists |

### Phase 2 — devnet, against real Pyth accounts (not fabricated ones)
| # | Item | Exit evidence |
| --- | --- | --- |
| 2.1 | Fix `scripts/devnet-lifecycle.mjs` (scoping bug :52/:56 vs :101/:104, missing model import :73, spec account read-only :99, unaligned target :111) | script runs unattended |
| 2.2 | Register spec/economy/ruleset; open Needs on the grid against **real sponsored accounts**; capture with **two independent cranks**; seal → settle → reveal → close; plus expire/void/forfeit | a signature per instruction; **measured void rate < 5 % over >= 60 targets** |
| 2.3 | 24 h cadence sampler on all 7 feeds; `test_timepin_cadence_policy.mjs` fails if a ruleset's `max_post_target_lag` is below the measured p99 first-print lag | hit-rate table committed |
| **GATE 2** | Devnet lifecycle green **and** the void rate measured, not estimated | receipts in `docs/reviews/` |

### Phase 3 — the game (without this, mainnet is two programs and no players)
| # | Item | Exit evidence |
| --- | --- | --- |
| 3.1 | `client-v2.mjs` two encoder defects (`:254-279` missing `u8(adapter)`; `:393` phantom `bump`) | parity test green |
| 3.2 | Import R2 `lifecycle-v2.mjs` + `economic-v2.mjs`; wire `index.html` FIRE through **one** chosen path (mirror_build or browser bridge — decide, don't keep both) | a stranger's browser profile completes a shot with `/api/game` blocked; host trace attached |
| 3.3 | Reload blackout fix (B6.3): accept the most recent finalized day <= D-1; pay the finalizer | test with an un-cranked shot from D-1 |
| 3.4 | Two resident capture cranks + a per-shot capture bounty escrowed at seal | drill: one crank killed, settlement still lands |
| **GATE 3** | Server-off drill passes on a machine that is not Semir's | trace of hosts contacted |

### Phase 4 — mainnet, authorities retained
Deploy Timepin + Core, register the manifest economy/ruleset, one owner shot end-to-end, publish the tuple
(program ids, ELF hashes, economy/ruleset hashes) on the proof page, legacy lane visibly labelled "legacy".
**Exit:** `permanence-release --dry-run` manifest equals the deployed readback on two independent RPCs.

Freeze is a separate, later ceremony that needs fresh authorization. It is not part of this path.

---

## 4. Decisions only Semir takes (no agent may set these)

1. **Upstash** (B2): pay-as-you-go with a budget cap (~$0.5/day at current traffic; the cap turns the worst
   case into a rate-limit, not a bill) **or** wait for the monthly reset and accept a dead site until then.
   Option (a) is the only one that keeps players and Bankr alive while G2 is built.
2. **`releases/g2-mainnet-economy.json`** (B4) — the write-once parameter manifest. One wrong number is
   permanent for that economy, and a new economy means every player re-opens a ledger.
   **The numbers below are the LEAD's proposal, for Semir to accept, change or reject. No agent may
   cite them as his, quote them as approved, or register from a file that does. A draft manifest
   carries `"status": "DRAFT - NOT APPROVED BY THE OWNER, MUST NOT BE REGISTERED"` until he says
   otherwise.** (Written after an agent attributed every one of these to him on 2026-09-05.)
   Lead's proposal: `entry_mode = forward only`;
   `hit_payout = 1.7x` plus `require!(num < 2*den)`; `reveal_window >= 3600 s`; `cleanup_bond >= 50,000`;
   `max_open = 5`; `max_post_target_lag` per feed from the 24 h measurement; `band_numerator = 0`;
   legacy root all-zero with a nonzero `migration_id`; `timepin_program = C8ww`.
3. **`max_confidence_bps`, `min_stake` vs posting fee, bond split, `migration_id`** — tagged D by Fable, unset.
4. **Product shape** (B6.9): players now need ~0.0063 SOL locked per open shot. Free demo lane beside the
   ranked on-chain lane, or SOL for everything? The UI and the Bankr skill both depend on the answer.
5. **The residual sentence in §2** — it goes on the settlement page in your name. Read it and approve the wording.

---

## 5. Lanes, when the swarm returns

Five agents produced excellent staging and one integration bottleneck. Two lanes plus bounded guests:

- **Sol — Rust + build + deploy.** Sole editor of Rust and sole owner of the Cargo target. Phases 1, 2, 4.
- **Astra — client + independent verification.** Phase 3, plus adversarial veto on the settlement wire.
- **Guests, bounded and named** (Codex / Fable / Gemini swarm): one task, one exit artifact, 24 h. Staging
  not integrated within 24 h is discarded, not preserved. Evidence lives in git, not in scratch folders.
- **Rule replacing "nobody idle":** *nothing unowned*. Idle is fine; a fourth review of the same file is not.
  Every claim names files and the test that will prove it.
- **Channel:** `ROOM.md` for findings, this file for state. Do not open a seventh plan.

## 6. Honesty register — claims that are now forbidden

- "Pyth-first" / "global first print" — no keyless source proves it (§1).
- "exact-SBF proves acceptance" for any test that builds the price account with `set_account`.
- Any canary verdict from `tools/p6-canary/*` until Astra's fixed pack is in the tree (7 false-green paths).
- "The freeze is scheduled" — it is not, and the public copy must stop saying so today.
