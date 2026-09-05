# RatchetX permanence execution plan

> **DECISION REGISTER ONLY, from 2026-09-05.** Its decision register is still live and still
> authoritative for decisions already taken. Everything else here is history: the plan of record is
> [`docs/ROAD_TO_MAINNET.md`](ROAD_TO_MAINNET.md). Add decisions here; do not add tasks.


Status: **active execution map, not a completion claim**
Snapshot date: **2026-09-04**
Scope: the path from today's server-authoritative game to a verifiably
permissionless, trust-minimized and API-keyless RatchetX generation on Solana.

## Owner direction recorded on 2026-09-03

The previously discussed freeze is **not the target of this execution cycle**.
Do not revoke any program upgrade authority, do not treat 2026-09-08 as an
execution deadline, and do not let that date pressure an unfinished design into
permanent bytes. `docs/FREEZE.md` is retained as a historical ceremony document,
not as a current instruction or scheduled action. A future immutability ceremony
requires fresh, explicit owner authorization after the system described here has
earned it.

The non-negotiable product direction is:

1. The canonical public runtime remains **API-keyless forever**. No Hermes key,
   database secret, vendor bearer token or founder endpoint may be required to
   read, play, settle, recover or verify the game. A user may choose a private RPC
   for availability, but that credential is their local transport choice and
   never part of protocol authority.
2. Solana becomes the canonical database for economic state and decisions.
   Supabase, a website, an indexer and a cache may improve access, but none may
   create, erase or reinterpret canonical balances, positions, evidence or
   outcomes.
3. RCX should earn infrastructure utility by paying open execution and by being
   usable by other applications, not by adding an administrator, a treasury
   promise or an investment guarantee. RatchetX's preferred board is one client
   of the primitive, not a global policy imposed on every other client.
4. Tests are grouped into meaningful batches. We do not spend the project on
   repeated tiny checks, but every irreversible boundary still needs a positive
   control, adversarial controls and a reproducible release record.
5. After the 2026-09-04 Upstash quota outage, no second off-chain database is an
   accepted migration stage. Upstash is read only as the legacy source needed to
   preserve existing users until a verified snapshot/root is cut over. New
   canonical authority moves directly to Solana. Optional indexers remain
   disposable views and can never become a fallback writer or settlement plane.

## Status authority and locked terminology

This file is the single P0-P10 execution tracker. `ONCHAIN_MIGRATION_PLAN.md`
remains the requirements inventory; its G0-G6 labels map here and do not carry
a second completion status.

| Requirement group | Executed by |
| --- | --- |
| G0 source-ledger safety | P0 and P8 |
| G1 oracle authority | P2 and P3 |
| G2 economic kernel | P5 |
| G3 agent/client execution | P1 and P5 |
| G4 cost, shadow and pilot evidence | P4, P6 and P7 |
| G5 legacy migration | P8 |
| G6 server retirement | P6 and P9; P10 is only an optional later freeze |

`RatchetX Gen3` names the product/cutover generation. The new economic program
keeps the existing plan name `Core G2`; Timepin evolves through explicit schema
versions; immutable canonical bytes and their hash identify a Ruleset. A global
`RULESET_V3` number or another parallel roadmap must not become a second source
of truth.

## Late 2026-09-03 evidence correction

This evidence supersedes earlier same-day completion language:

- production readback and `deploy_check.txt` prove h113 is live and its durable
  store reports Upstash, but canonical settlement is still `ratchet-server`;
- on 2026-09-04 the public game and new Bankr-session creation returned HTTP 500
  because the Upstash account reached its exact 500,000-request plan limit. The
  application failed closed rather than using process memory, so stored state was
  not replaced by an inconsistent fallback. Service availability now depends on
  that provider until direct chain cutover;
- Timepin schema 1 is a local, no-value, undeployed prototype with a fixed
  target-plus-180-second deadline; it cannot support measured 600/870-second
  xStock publication;
- the two running cadence jobs are two polling resolutions over the same feeds,
  not two production stock pipelines;
- the short run observed 600-second AAPLX and 870-second batches, but the longer
  run then observed an hour-scale stall in most of the 870-second group while
  the live SOL control continued; no xStock is approved for listing yet;
- commit `c42baf8` is a rejected historical Core-v1 experiment, not P4, and is
  already reverted by `70de57e`: its nonzero
  levy is invalid for a system-owned payer, source/client/account layouts drift,
  rewards pay raw checkpoints rather than demanded work, and zero constants hide
  every activated money path;
- the existing settle/VOID and reveal/forfeit timing overlap also needs a new
  mutually exclusive successor state machine before value;

## 2026-09-04 P4/Next Print v2 execution update

- A separate RCX Work Market candidate now exists at program ID
  `EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD`. Its exact SBF is deployed
  and byte-verified on devnet; upgrade authority remains during soak.
- It accepts only the production Token-2022 RCX mint, has no mint/faucet/global
  purse/admin withdrawal/cancel/partial-payout path, and routes each complete
  voucher vault only to a receipt-fixed worker or sponsor refund.
- Next Print v2 is a new, isolated completion generation at
  `2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR`. Deployed v1 is unchanged.
  V2 stores the oracle update causing every terminal VOID and permissionlessly
  creates the exact durable CompletionReceipt consumed by Work Market.
- The combined exact-SBF LiteSVM suite passes eight tests: exact 409-byte
  mainnet RCX mint, classic-token/wrong-owner/recipient adversaries, multiple
  sponsors, real v2 successor -> 12 RCX observer payment, real v2 timeout ->
  15 RCX sponsor refund, real v2 missed successor -> 9 RCX sponsor refund, and
  exact 134-byte mainnet TSLAX entry bytes. Only exact direct-successor work is
  payable; missed/revision/broken-chain/timeout terminalization is nonpayable.
- The audited v2 ruleset/SBF upgrade is byte-verified on devnet in slot
  `492867556`. Public devnet then proved official-Pyth OPEN -> VOID_TIMEOUT ->
  durable receipt -> Shot close on those bytes. No direct successor arrived, so
  this is not a public CAPTURED proof. Runners now follow Solana block time and
  use coherent confirmed commitment between dependent transactions.
- The exact RCX mint is absent on devnet. A public devnet RCX transfer is
  therefore impossible with the production-pinned Work Market bytes and must
  not be simulated with a substitute token. P4 remains in progress until review,
  soak/upgrade-authority policy, and an explicitly bounded mainnet value proof.
- None of this changes canonical credits, production settlement or the frozen
  70% burn / 30% pots / 0% team reload rule.
- Timepin schema 2's executable model now passes 163 adversarial checks, plus
  43 independent lifecycle-vector checks. Adapter
  1 accepts only the official Pyth Receiver/Push programs; EvidenceSpec hashing
  is domain-separated; Need is a fixed 132-byte account whose PDA, bump, state,
  candidate hashes and recomputed deadlines are authenticated on every path;
  capture before target is rejected. Completion uses only numeric FirstCapture
  and Terminalize work kinds with the exact 125-byte Work Market receipt ABI;
  expiry makes unperformed FirstCapture nonpayable so its voucher refunds.
  This completes the model-hardening slice, not the full public-devnet P3 gate.
- A separate no-value Timepin-v2 Rust workspace now implements EvidenceSpec,
  Need, immutable Candidate, terminal Timepin and exact Work Market completion
  receipts. Seven host tests and six independent manual-encoding LiteSVM tests
  pass the complete Open/Candidate/Final, Ambiguous and Expired lifecycle against
  the exact 325,592-byte SBF. Its local development hash is
  `c0c78b038fc954d78c0564de4f1626a15b9f45f1781029c53904bfc1bb80deb6`.
  Wrong owner/hash/late creation roll back; duplicate capture creates no second
  entitlement; expiry makes unused FirstCapture nonpayable and Terminalize
  payable. The vectors freeze account sizes, discriminators, instruction order,
  message/result hashes and program-id-dependent PDAs. The public-only `[7;32]`
  id has no matching keypair in the repository. This is not a release artifact:
  the local builder was platform-tools v1.54 rather than pinned v1.52, and a
  generated IDL/client, additional malformed-state vectors, devnet life cycle,
  deployable identity and external review are still absent.
- The devnet deployments recorded above were executed under the owner's standing
  approval. This evidence record does not by itself authorize a mainnet
  deployment, migration, Timepin deployment, push or authority freeze.

## 2026-09-04 compact Core G2 and Work Market v2 checkpoint

- The Core G2 source candidate now makes the 780-byte rich Shot transient. Every
  terminal path writes a 165-byte compact result into a permanent 16-slot
  HistoryPage, verifies its game-result hash, pays the permissionless actor's
  cleanup bond, and closes the Shot to its immutable rent-refund address.
- Equality and confidence-band outcomes first enter `AwaitVoid`; a separate
  permissionless finalizer performs the deterministic refund. Reveal and
  forfeit are mutually exclusive, and all five terminal routes archive and
  close.
- Optional sponsored execution uses one bounded 106-byte WorkRecord inside a
  permanent 48-record WorkPage. A sponsor prepays the row before voucher
  funding; relevant Core actions terminalize it as Payable or Nonpayable so
  closing the rich Shot cannot strand a voucher.
- Work Market v2 accepts either an exact direct receipt or one exact packed
  WorkPage slot through a producer-owned immutable WorkManifest. Host tests
  cover owner/layout/discriminator/slot/trailing-byte adversaries and
  Token-2022 MemoTransfer ordering. Full cross-program LiteSVM value movement
  remains open.
- Current cluster rent was measured through
  `getMinimumBalanceForRentExemption`, not a fixed historical formula. At the
  2026-09-04 mainnet rate the permanent terminal increment is 1,044,945
  lamports, plus the one-byte reservation made at seal; the full first-result
  page is 2,412,873 lamports. WorkPage packing is more expensive for one record
  but cheaper from two records onward. Transaction fees and compute units are
  still unmeasured.
- Core G2 now passes 25 host tests and 4/4 LiteSVM lifecycle tests against the
  exact 1,085,448-byte SBF with SHA-256
  `4F652AEB0B2E7B6375A4E7825851BF28508F9D532CA72B53C7DE78A2D11CAB81`;
  the final SBF builder emitted no stack/verifier overflow. The full forward
  lifecycle no longer inserts synthetic Timepin-owned Spec/Need/Candidate
  accounts: it invokes Timepin `register_evidence_spec`, both `open_need`, both
  `capture_first` and both `finalize` transitions, then Core authenticates those
  producer-created accounts in `activate_entry` and `settle_final`.
- Timepin v2 passes 14 host and 3/3 LiteSVM tests against its exact 414,264-byte
  SBF with SHA-256
  `8D913A5D65B187D665D35088E577EE231B3F2BDB2954377AD4B986FAC343AB7F`.
  Real-scale Loader-v3 ProgramData, Receiver Config and PriceUpdate inputs in
  this local gate are synthetic fixtures, not a live-cluster-account claim.
- JavaScript byte/model parity now passes 1,954 Core assertions and 226 Timepin
  assertions. The audit specifically removed false-green fixtures that trusted
  caller-mirrored Loader links/configured Wormhole values or omitted the
  canonical absent WorkPage account meta. A regenerated browser-neutral G2
  client/IDL, live-account/devnet execution, independent review, public
  deployment and server-off run remain open. This checkpoint is source and
  local-runtime evidence, not a deploy or completion claim.
- Work Market v2 intentionally refuses to fund work from a producer whose
  Loader-v3 ProgramData still has an upgrade authority. Therefore the old P7
  wording that combined upgradeable producers with a pre-freeze real RCX bounty
  was circular. The corrected release sequence is encoded in P7 and P10 below.

## What "permanent" can honestly mean

A Solana program cannot wake itself, make an HTTP request or submit its own
transaction. There is no literal perpetual-motion machine. The achievable and
stronger engineering promise is a **perpetual protocol, not perpetual compute**:

- no particular operator is required;
- any payer may submit the same deterministic transition;
- RCX bounties can make useful execution economically attractive;
- duplicate actors are harmless;
- after a bounded deadline, absence of every actor makes a deterministic
  VOID/refund transition permissionlessly executable; chain state does not
  change until somebody submits that transition, and no operator chooses it; and
- any website, indexer, RPC endpoint or runner can be replaced without changing
  the ledger.

The irreducible dependencies remain Solana consensus and data availability,
the selected oracle domain's signed messages and live publication, at least one
economically or independently motivated participant capturing a mutable source
message before it is overwritten, transaction submitters, account rent, and a
route to a Solana RPC. If Solana halts, execution halts. If the admissible oracle
source or every capturer stops, new affected play pauses and open positions
follow an explicit fail-closed rule. A finalized Timepin proves which valid
messages were submitted; it cannot cryptographically prove that no other valid
message ever existed and was withheld. Those are protocol dependencies and an
explicit availability assumption, not founder permissions.

## Evidence baseline: what exists now

This table separates chain observations from plans and source-code assertions.
Every quantity is time-stamped because supply and cluster state can change.

| Surface | Evidence as of 2026-09-03 | Honest status |
| --- | --- | --- |
| RCX mint | Mainnet mint `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`, owned by Token-2022, decimals 6. At finalized slot 443,821,054 the supply read 936,699,884.132132 RCX. Mint authority and freeze authority were none; metadata update and metadata-pointer authorities were disabled. | The token layer is fixed-supply and unfreezable. Supply may continue to fall through burns. |
| Seal v2 | Mainnet program `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX` exists and retains upgrade authority. | Optional receipt/referee experiment, not the canonical game ledger. Do not freeze it in this cycle. |
| Core v1 candidate | Candidate program id `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` is absent from mainnet. A devnet prototype exists with an upgrade authority retained. The committed `1ba43717...` artifact reproduced the prototype bytes before the findings below. | Prototype evidence only; not safe to call canonical or final. |
| Legacy migration | `LEGACY_ROOT` in the candidate is all zeroes. | No wallet can make a valid legacy claim. No migration has occurred. |
| Live economy | The production API currently fails closed because Upstash reports `ERR max requests limit exceeded` at 500,000/500,000 requests. Credits, shots, settlement, XP, podium and Bankr session creation still depend on that application state. | The site and Bankr game path are unavailable. Stored state is not evidence of deletion, but the service is neither on-chain nor founder-independent. No second off-chain database or memory fallback will become canonical. |
| Database quota incident | The site/API returns HTTP 500 while the legacy Upstash request quota is exhausted. | This is an active availability failure and direct evidence that the off-chain canonical boundary must be removed. The migration path is legacy snapshot/claim into Solana, not another database. |
| Oracle access | Seven live crypto feeds are read keylessly from Pyth accounts over Solana JSON-RPC. Several xStock accounts are currently Pyth-owned, `Full`, and keylessly readable, but are absent from Pyth's current official sponsored-Solana list. Authenticated Hermes is not a canonical path. | Account existence proves today's experiment, not a perpetual publication SLA. Current-account access alone is not a historical crossing proof. |
| Timepin schema 1 | Local no-value source/spec exists; it requires 30-second predeclaration and uses a fixed target-plus-180-second deadline. It is not deployed. | Useful oracle-state-machine evidence only; incompatible with measured xStock lags and not value-certified. |
| Current repair branch | `c42baf8` is already reverted by `70de57e`; the worktree contains separately gated Timepin/Work-Market/Next-Print work and unrelated drafts. | Do not broad-push the dirty tree. Release only a reviewed, internally complete generation whose source/client/vectors/artifact agree. |

## Known blockers that invalidate earlier "done" language

The following are release blockers, not documentation polish.

**Late-audit status, 2026-09-03.** The eight-row ledger below is retained as
prototype repair history. Its word `closed` means a named source-level control
was added; it does not mean Core v1, Timepin, incentives, migration or a mainnet
successor is release-ready.

Current stop conditions are generated Timepin-v2 IDL/client parity, malformed-state
vectors, reproducible release-toolchain evidence and public multi-runner devnet evidence;
overlapping settle/VOID and
reveal/forfeit transitions;
a Timepin-v1 deadline shorter than observed xStock publication; insufficient
market-close/weekend cadence evidence; and treating an RPC transaction locator
as permanent decision bytes.

Historical prototype ledger:

| # | Blocker | Status | What proves it |
| --- | --- | --- | --- |
| 1 | Fabricated source coverage | **closed** | `checkpoint` stores the signed `prev_publish_time`; `clock_never_fabricates_coverage_across_a_source_gap` |
| 2 | Ring eviction is a refund option | **closed** | `bind_crossing`, permissionless and idempotent; `a_bound_crossing_survives_a_ring_flooded_past_capacity` floods the ring past 64 after binding and settles on the bound print, with an unbound control on identical facts that cannot settle at all |
| 3 | Confidence is not preserved | **closed** | `Observation.conf_e12` and `Shot.exit_conf_e12`; `a_settled_shot_carries_the_confidence_it_settled_on`. The band is implemented and `BAND_K_BPS` is 0 — the mechanism ships, the number does not |
| 4 | Rules are not version-bound | **closed** | `Shot.ruleset` written at seal and enforced at settle; `HORIZON_MASK` checked in `seal`; `a_closed_market_refuses_the_horizons_it_cannot_resolve` is the negative control, and the shipped table is fully open |
| 5 | JS token path names the wrong family | **closed** | `RCX paths are explicitly Token-2022, never classic SPL Token`, with a classic-token negative control |
| 6 | Legacy root empty, source ledger unavailable | **unblocked, waiting on one run** | the rescue took 37,805 rows over a direct Postgres path; `tools/legacy_root.mjs` builds the root with 45 checks against the program's own leaf and pairing rules. Needs `LEGACY_ROOT_BUILD.cmd` run against the snapshot |
| 7 | Prose overclaimed cranker neutrality | **closed** | corrected across the public surfaces; `test/test_settlement_claims.mjs` fails if any of it drifts back |
| 8 | A mutable sponsored account is not an archive | **narrowed; proposal on the table** | `docs/CORE_G3_ARCHIVE.md`. The archival-challenge option is closed by measurement, not opinion: every Hermes host this repo has named answers 401, historical and latest alike, so that path needs a paid key and the standing rule forbids one in the settlement path. What survives is that an uncaptured crossing is unrecoverable — and the proposal measures it rather than assuming it away |

A ruleset bump is also a claim about what did NOT change, and that is held by
`test_core_vectors.mjs`: `core-rules-v2.json` is checked against
`core-rules-v1.json` field by field, and every instruction that existed in
ruleset 1 must still encode byte for byte.

The blockers as originally written:

1. **Fabricated source coverage.** Core v1 `checkpoint` recorded the previous
   protocol checkpoint as `prev_publish_time`. That is not Pyth's signed
   `PriceFeedMessage.prev_publish_time`. After a missed source update it could
   make a late observation appear to bracket an earlier expiry. The current
   repair stores the signed predecessor and rejects that false crossing.
2. **Ring eviction creates a selection/refund option.** A 64-observation
   `FeedClock` can evict the valid crossing during the 120-second decision window.
   An actor who can influence capture volume can then force a refund instead of
   the deterministic outcome. A larger ring changes the bound but does not remove
   the class. Core G2 must not use an evicting ring as final outcome evidence.
3. **Confidence is not preserved.** The current Observation/Shot layout does not
   retain enough confidence evidence to implement or audit a decision band.
   Therefore no `k` value may be frozen from a model or silently added to v1.
4. **Rules are not explicitly version-bound.** A Shot does not carry an explicit
   ruleset version, and the feed/horizon matrix is not enforced as an on-chain
   rule. UI board policy is reversible presentation, not protocol admission.
5. **The shipped JS token path names the wrong family.** The main client derives
   the classic SPL Token ATA/program while RCX is a Token-2022 mint. Existing
   LiteSVM coverage used a classic SPL mock, so it did not positively prove the
   real RCX family. The client, account-owner checks, CPI metas and tests must use
   Token-2022, with an explicit negative classic-token control.
6. **The legacy root is empty and the source ledger is unavailable.** A 500 or
   quota restriction cannot be converted into a guessed Merkle root. Migration
   waits for a consistent, independently checked snapshot and conservation
   report.
7. **Earlier prose overclaimed cranker neutrality.** Owner/PDA/Full-verification
   checks stop fabricated prices, but they do not by themselves stop withholding,
   missed crossing or ring-eviction selection. Documentation must follow the
   executable evidence, not the intended story.

   *Closed 2026-09-03.* Ring-eviction selection is no longer in the list — it is
   closed by `bind_crossing` (blocker 2). Withholding is, and always will be:
   a program cannot compel anyone to send a transaction. So the claim was
   rewritten rather than repaired, in two halves that are both true — **which
   price is not a choice; whether it settles is a liveness assumption, floored
   by a refund and dischargeable by the player** — and the corrected sentence
   now appears on the homepage, `agent/README.md`, `docs/ARENA.md`,
   `docs/SETTLEMENT.md`, `docs/SELF_HOST.md`, `docs/UNKILLABLE.md`,
   `docs/PLAY_WITHOUT_US.md`, `docs/STOCKS_FEEDS.md`, `api/record.js`,
   `tools/crank.mjs` and both article mirrors.
   `test/test_settlement_claims.mjs` scans the repository and fails if any
   document says never settling gives the same number, if a page calls
   settlement trustless without naming the liveness assumption, or if a public
   surface stops telling a stranger that an unsettled shot refunds.
8. **A mutable sponsored account is not an archive.** The sponsored Pyth shard-0
   PDA can be overwritten by the next update. A 180-second challenge deadline
   does not preserve the earlier bytes, and a sponsored-PDA-only instruction
   cannot later accept an independently reposted historical Receiver update.
   Timepin v1 is therefore a no-value live-capture prototype. Core G2 value waits
   for an audited archival-challenge path or a narrower rule whose remaining
   omission assumption is explicitly accepted and economically defended.

   *Superseded 2026-09-03, see `docs/CORE_G3_ARCHIVE.md`.* The earlier
   FeedClock/gap conclusion below is retained only as prototype archaeology.
   Three things changed the shape of the problem. First, the archival-challenge option is closed by
   measurement: `hermes.pyth.network` and `pyth.dourolabs.app/hermes` both
   answer **401** for historical *and* latest updates, so reposting a signed
   historical message needs `PYTH_API_KEY`, and no correctness or liveness path
   here may require a paid credential. Second, the source-predecessor predicate
   identifies an admissible source interval, but distinct Full-valid signed
   revisions may still be submitted; schema 2 records that conflict as
   `Ambiguous` rather than claiming only one message existed. Third,
   `exit_posted_slot` on the ruleset-2 Shot makes a settlement
   locatable when a chosen RPC retains that transaction, but a slot is not the
   decision bytes and public RPC history is not a permanent availability
   guarantee. What genuinely remains is that a crossing nobody captures before the
   next push is unrecoverable. A `FeedClock.gaps` ring cannot prove completeness
   and is rejected as Core G2 outcome evidence. The current target is a shared,
   predeclared, non-evicting Timepin Need with explicit Final/Ambiguous/Expired
   semantics and honest withholding/liveness limits.

The source-predecessor patch was necessary, but its passing controls do not
promote Core v1. The late audit above reopened the release question across ABI
coherence, incentive safety, terminal-state determinism, multi-cadence evidence
and historical availability. Core G2 carries value only after all current stop
conditions and the P0-P6 gates are closed against one exact artifact.

## Hard invariants

These are release constraints. A design that violates one is rejected rather
than patched with an operational promise.

1. **No canonical secret.** Public protocol operation and verification require
   no API key, hosted account, allowlist, signed server result or Ratchet URL.
2. **One canonical ledger.** Solana accounts and transaction ordering decide
   balances, accepted shots, outcome, payout, score, delegation and replay state.
   Off-chain copies are disposable projections.
3. **Source-bound oracle evidence.** A target is satisfied only by a fully
   verified message in the pinned oracle domain whose signed interval proves
   `prev_publish_time < target_ts <= publish_time`.
4. **Predeclared need.** A target that can affect value must be registered before
   its target time. Nobody may wait to see a price path and then ask the protocol
   to preserve only a favorable historical point.
5. **Fail closed without trapping value.** Missing, late, invalid or ambiguous
   evidence cannot become latest-price settlement. It produces the ruleset's
   explicit terminal state, normally VOID and exact credit refund.
6. **Exact asset semantics.** RCX, non-redeemable credits, XP, SOL rent and any
   payment token remain distinct units. A credit payout never mints RCX. An RCX
   burn is never reversed by a credit refund.
7. **Actual Token-2022 compatibility.** Mint, owner, decimals, extensions, ATA
   derivation and CPI program are validated against the real token family. A
   classic SPL mock is a negative control, not the positive test.
8. **Ruleset binding.** Every position names the exact ruleset, feed domain,
   horizon/target, rounding rules and evidence schema that decide it. Existing
   positions never inherit a later rule.
9. **Content-addressed rules, not an admin ruleset.** Every economic ruleset is
   immutable and addressed by a hash of canonical bytes. Registration is
   permissionless. A board may recommend a ruleset, but no founder can edit it
   in place or prevent another application from selecting another supported set.
10. **No privileged economic transition.** No admin may award credits/XP, choose an
   outcome, change a recipient, withdraw player value, pause refunds or replace a
   ruleset in place.
11. **Open execution.** Capture, finalization, settlement, void, forfeit and safe
    cleanup are callable by any funded transaction sender. Rent and rewards go to
    addresses fixed by state, not to arbitrary accounts supplied by the caller.
12. **No dual authority.** During migration, every new position has one named
    canonical generation. The database and chain must never both be able to
    settle or credit the same position.
13. **Evidence before permanence.** Source, deterministic artifact, deployed
    executable, verified-build record, program authority, program accounts and
    full-life transactions must all agree before any future authority revocation.
14. **Permanent publication is last.** Arweave publication and immutability are
    irreversible acts. Drafts, secrets, disputed manifests and unverified claims
    are never made permanent merely to meet a date.
15. **Derive most; materialize only irreversible facts.** Boards, leaderboards,
    history views, aggregates and notifications are recomputed from accounts and
    authenticated inputs. Store only balances, commitments, rules, targets,
    non-recoverable source crossings, terminal results and replay/nullifier state.
16. **Evidence policy is identity.** Every field that changes which source message
    is admissible, including deadlines and gap/lag limits, is inside immutable
    canonical evidence-spec bytes and therefore the Need PDA hash. A first opener
    cannot impose a shorter or different policy on later users of the same target.
17. **Economies are namespaced.** Permissionless market rules cannot share or
    mutate Ratchet credits merely by naming the same Core. Ledger, season and
    podium PDAs include an immutable `economy_hash`; the program enforces hard
    conservation bounds regardless of registered content.
18. **Canonical work and reward claims are separate.** Evidence capture, settle,
    VOID and forfeit do not transfer a bounty inline. They write one completion
    fact; an optional Work Market pays that fact later. Empty incentive escrow can
    reduce liveness but cannot roll back or reinterpret economics.

## Target architecture

### 1. Solana: canonical machine and database

Solana stores the minimum state needed to reproduce every economic consequence:
versioned rules, player ledger, position commitments, source-bound oracle
evidence, terminal outcome, score, replay guards, delegation and RCX bounty
escrow. Account events and transaction history make the state externally
indexable; no SQL row is needed to establish truth.

This is not a byte-for-byte migration of the server database. PDAs are primary
keys for irreducible facts; deterministic clients calculate boards, histories,
leaderboards, feed health and aggregates from those accounts. Indexers may
materialize the same views for speed and can be deleted and rebuilt. Transaction
signatures and slots are provenance locators, not the only copy of decision
material: a program cannot query arbitrary past ledger state, and public RPCs do
not promise permanent historical availability.

### 2. RCX Timepin: reusable public oracle infrastructure

Timepin is a separate, small program so other Solana applications can request and
reuse the same target-time evidence without importing RatchetX game economics.
Its unit of work is a predeclared `Need` for one oracle domain, feed and target
timestamp. In the schema-1 prototype anyone may capture the current observed Pyth
shard-0 account, but the program accepts it only when the signed source interval
brackets the target. That account is mutable: capture must happen before the
qualifying update is overwritten. A later value-bearing schema must additionally
prove a safe permissionless path for replaying a fully Receiver-verified archived
message, or retain the live-capture assumption as a named and tested limitation.

Schema 2 commits a canonical `EvidenceSpec` hash into the Need identity. The spec
contains oracle adapter/domain, feed and source derivation, verification level,
target grid, maximum signed pre-target gap, maximum post-target publication lag,
capture grace, challenge policy and numeric/confidence bounds. The source
deadline is `target + max_post_target_lag`; the capture deadline is that source
deadline plus `capture_grace`. A source message must publish by the first and the
capture transaction must land by the second. This permits explicit 60-second,
600-second and 870-second profiles without letting the first opener grief later
consumers with arbitrary deadline fields.

The permanent `Timepin` records the full decision material, not a rounded display
price: oracle/receiver domain, feed id, price, confidence, exponent, EMA fields,
signed previous and current publish times, verification level, source account,
posted slot, capture slot/time, capturer and message hash. Identical submissions
collapse. Conflicting fully valid submitted messages enter an explicit challenge
path; if uniqueness among submitted evidence cannot be established, the terminal
state is `Ambiguous`, never a caller-selected winner. `Final` means exactly one
valid message reached the account by the deadline; it does not prove global
nonexistence of a withheld Pyth-signed message. No ring can evict a finalized
Timepin.

A keylessly readable Pyth account is the default live ingress, not the only permissible
future delivery route. A public Hermes gateway, self-hosted Hermes/Pythnet
observer, peer, or permanent archive may transport historical signed bytes, but
none is trusted to decide a value. The pinned Pyth Receiver and Timepin validators
must verify the same message on chain. Thus an HTTP service can improve delivery
without becoming a canonical API, API key, or oracle authority.

This is the infrastructure stamp: **Solana decides; Timepin remembers; RCX pays
open execution.** RatchetX is the first consumer, not a privileged consumer.

### 3. RCX Work Market: permissionless liveness without a treasury

Timepin and Core write canonical completion facts; they never pay inside capture,
settle, VOID or forfeit. A separate, optional Work Market lets any sponsor attach
one or more demand-bound vouchers to an existing Need or completion receipt.
This isolates oracle/economic correctness from incentive-program bugs and empty
purses.

A voucher is keyed by schema, Need-or-Shot, exact work kind, asset kind, sponsor
and nonce. Existing Token-2022 RCX is escrowed with `transfer_checked`; an
optional capped SOL reimbursement is escrowed separately through a System
Program transfer CPI. After the work's no-cancel boundary the sponsor cannot
cancel, redirect or change the amount. Canonical completion fixes the worker;
claim is a later instruction that pays exactly once or can be retried safely.
Multiple sponsors may intentionally fund the same shared Need.

The market never mints RCX, has no faucet, global purse, admin withdrawal,
partial payout or privileged runner. Duplicate/no-op checkpoints and unrelated
feed activity earn nothing. With no voucher or no actor, correctness is
unchanged: a participant can perform the transition directly, or after the
deadline the deterministic Expired/VOID transition becomes permissionlessly
executable. It is not written until an actor submits it. RCX pays useful shared execution;
SOL only reimburses a declared network cost and never introduces an RCX/SOL
price-oracle loop.

### 4. Core G2: versioned economic consumer

Core G2 is a new program id, not an in-place reinterpretation of Core v1. At seal
it atomically debits credits, binds the player/nonce/commitment and stores the
hash of canonical immutable ruleset and economy bytes. Ruleset PDAs are derived
from their content hash and can be registered by anyone; they have no authority
or update instruction. It never reads an evicting checkpoint ring as outcome
evidence.

Fast crypto may use `OBSERVED_ENTRY`: seal validates and stores the current Full
Pyth price, confidence and source times, then opens or joins the predeclared exit
Need. Slow xStock profiles use `FORWARD_ENTRY`. Core calculates a future aligned
entry target `T0 = ceil((now + min_open_lead) / target_grid) * target_grid` and
exit target `T1 = T0 + horizon`; in the same seal transaction it fixes the
commitment and stake and opens or validates both Needs. The Shot is
`PendingEntry` until anyone calls `activate_entry` with the Final T0 Timepin.
There is no player cancel or selective stake unwind from the atomic seal onward,
whether before or after the unknown entry later becomes visible. Only the sealed
deterministic expiry/VOID/refund path may release the obligation.

At settlement Core accepts only the finalized Timepin for the exact T1 Need.
`Expired`, `Ambiguous`, out-of-gap/lag/confidence evidence or an expired entry
follows a deterministic named VOID/refund rule. Timepin's terminal states are
mutually exclusive, and Core writes exactly one mutually exclusive terminal
economic result; a valid Final Timepin may still map to Core VOID under the
sealed confidence/tie-band rule. Reveal and forfeit windows are disjoint.
Horizon is T0 to T1, not seal wall time to an arbitrary later publish.

The ruleset binds its feed/horizon matrix on chain, but RatchetX's selected matrix
is not a global allowlist. Any application may register another canonical
ruleset using feeds and horizons admitted by the program's source-safety bounds.
Every ruleset names an immutable `economy_hash`; PlayerLedger, season and podium
PDAs are namespaced by that hash. A third-party ruleset may share Ratchet credits
only when the complete economy bytes match, and permissionless registration can
never create credit inflation.
Horizons and PUMP may remain reversible RatchetX board presentation before G2;
they become this game's economic policy only when their source, Timepin vectors
and exact ruleset hash pass the same gate. Held equities stay out of RatchetX's
ruleset until they have an equally permissionless, source-bound on-chain evidence
path. Today-observed xStock accounts are a separate candidate domain, not native
equities and not a promise of Pyth sponsorship; this distinction does not give
RatchetX an administrator over third-party rulesets.

The program may implement a versioned integer confidence-band algorithm without
hardcoding one universal `k`. Each immutable ruleset carries its explicit
rational band multiplier and every Shot binds that ruleset hash; both entry and
exit confidence are stored. RatchetX can choose a measured policy later while
another application chooses another visible parameter today. Until real
observations justify RatchetX's selection, the canonical board must not pretend a
model-picked `k` is universal or permanent truth.

### 4.1 Infrastructure-shaped games

The game adapts to the current API-keyless source instead of asking the source to imitate the
game. Every immutable market/ruleset declares a target grid, minimum opening
lead, maximum pre-target source gap, maximum post-target publication lag,
capture/challenge duration, confidence-band formula and horizon. These values
are visible before sealing and cannot be widened afterward.

A replaceable board derives recommendations from Timepin history already on
Solana: observed cadence, gap distribution, confidence distribution, successful
capture rate and price movement relative to uncertainty. Fast, tight feeds may
offer short games. Slower, gapped or wider-confidence feeds automatically move to
longer horizons, a wider symmetric VOID zone, or an explicitly unranked lab mode.
The protocol still permits every feed/ruleset inside hard source-safety bounds;
the board is a deterministic suitability filter, not an authority or an attempt
to steer outcomes toward RatchetX.

This creates a neutral validity envelope:

- accept only the signed first bracket around the predeclared target;
- reject a bracket whose before/after gaps exceed the sealed tolerance;
- resolve only when the strike lies outside the sealed symmetric uncertainty
  band;
- VOID/refund when evidence is missing, late, too uncertain or ambiguous; and
- lengthen the next offered horizon from public on-chain observations rather than
  substituting a friendlier price.

Tolerance changes which questions are safe to ask, never which side wins after a
question was asked. That is how RatchetX can maximize valid games on keyless
on-chain infrastructure without pretending RPC, rent or transaction execution
has zero cost.

### 5. Replaceable clients, runners and indexers

The reference client reads program accounts directly, derives PDAs and Anchor
discriminators locally, builds transactions locally and can use any compatible
RPC. A read-only inspector needs no signer. A runner needs only its own fee-payer
key; it discovers work with program-account queries and never receives a founder
capability.

An indexer may provide search, board views, leaderboards and notifications. Every
row must contain the chain address/slot/transaction needed to reconstruct it, and
deleting the index must not delete the game. The canonical UI has a keyless public
RPC pool by default and permits a user-supplied endpoint; keyed endpoints are an
optional personal availability improvement, never required functionality.

### 6. Arweave: permanent memory, not a second database

Arweave stores reviewed release bundles: source archive, commit, lockfiles,
deterministic build recipe, binary hashes, program ids, schemas, golden vectors,
client/runner, migration root and leaf rules, authority proofs, transaction
evidence and human-readable recovery instructions. A small on-chain release
account or memo may bind the Arweave transaction id to the deployed generation.

Arweave does not decide balances or outcomes and is not queried inside economic
instructions. If an Arweave gateway disappears, another gateway or local copy can
serve the same immutable bytes. Upload tooling may need a publisher wallet, but
reading, verifying and operating the protocol must not require an API key.

## PDA and instruction sketch

All Timepin rows below are now frozen in schema-2 source and golden vectors. The
complete no-value lifecycle has Rust/SBF/LiteSVM evidence in the isolated
workspace. This is local implementation evidence only; no deployment may infer
P3 completion from this table.

### Timepin and Work Market program accounts

| Account | Candidate PDA seeds | Essential fields |
| --- | --- | --- |
| `EvidenceSpec` | `['evidence_spec', u16_le(2), sha256('rcx-timepin:evidence-spec:v2\0' \|\| canonical_spec_bytes)]` | exact 142-byte immutable official-Pyth adapter/feed/source derivation, verification, grid, gap/lag/deadline and confidence policy |
> NOTE 2026-09-05 (Fable, source-verified vs onchain/rcx-timepin/model-v2.mjs): current compact ABI is EvidenceSpec 262 / Need 132 (terminal) / Candidate 119; optional WorkPage capacity 2. The Need=182, Candidate=315 and separate Timepin=229 rows below describe a SUPERSEDED layout — re-verify against source before use.

| `Need` | `['need', u16_le(2), evidence_spec_hash_32, target_i64_le]` | exact 132-byte account: schema/bump/state, spec hash, target, opened slot/time/opener, recomputed source/capture deadlines, candidate count/ordinal and two candidate hashes |
| `Candidate` | `['candidate', need, message_hash_32]` | exact 315-byte account: Need plus 272-byte raw signed-message/source/capture record and truthful ordinal |
| `Timepin` | `['timepin', need]` | exact 229-byte immutable terminal kind, Need/spec/target, canonical candidate hashes, result hash and terminal provenance |
| `CompletionReceipt` | `['completion', need, work_kind_u8]` | exact 125-byte shared receipt; work kinds are `1=FirstCapture`, `2=Terminalize`; immutable disposition/worker/slot/time/result hash |
| `Voucher` | `['voucher', schema_u16_le, subject, work_kind_u8, asset_kind_u8, sponsor, nonce_u64_le]` | Work Market state, exact amount, no-cancel boundary, sponsor/refund, derived beneficiary, paid/refunded flag |
| `VoucherVault` | `['vault', voucher]` | SOL above rent floor or Token-2022 RCX escrow authority; no arbitrary withdrawal path |

Candidate Timepin instructions:

- `register_evidence_spec(canonical_bytes)`: permissionless create-only account
  whose address proves the exact accepted-source policy.
- `open_need(schema, evidence_spec_hash, target)`: permissionless, but only
  before the spec's minimum lead; idempotent only at the exact derived PDA.
- `capture_first(expected_message_hash)`: validates receiver/source owner, sponsored
  PDA, feed, Full verification and the signed source bracket. Stores full message
  fields and recomputed hash; an exact retry is a no-op and never accepts a
  caller-provided decoded price without the source account.
- `capture_conflict(expected_message_hash)`: accepts only a second distinct valid
  source revision and atomically creates terminal Ambiguous evidence plus receipt.
- `finalize()`: permissionless after the common capture deadline with one Candidate.
- `expire()`: permissionless after the capture deadline when no admissible
  candidate exists; creates a permanent terminal Timepin.
  There is no Candidate, Need, Timepin or receipt close instruction in this
  generation, so no cleanup can erase the decision evidence.

Candidate Work Market instructions are separate: `fund_sol_voucher` uses a
System Program CPI; `fund_rcx_voucher` uses Token-2022 `transfer_checked`;
`claim_voucher` derives its recipient from immutable Timepin/Core completion;
`refund_voucher` returns only a predeclared nonpayable terminal voucher to its
sponsor; and `close_voucher` returns rent only after Paid/Refunded. No reward
transfer occurs inside a Timepin or Core instruction.

P2 now has exact Candidate and terminal Timepin layouts, no-close rent policy,
same-publish-time revision semantics, official-Pyth Full verification and fresh
SBF/LiteSVM lifecycle evidence. It still cannot recover a qualifying message
after the mutable sponsored account is overwritten. No value is attached until
P3 proves real source capture, independent runners, chain-only inspection and
server-off operation on devnet.

### Core G2 program accounts and instructions

Candidate PDAs include
`Ruleset['ruleset', sha256(canonical_ruleset_bytes)]`,
`PlayerLedger['ledger', economy_hash, player]`,
`Shot['shot', economy_hash, player, nonce]`,
`HistoryPage['history_page', economy_hash, player, page_index]`,
`WorkPage['work_page', economy_hash, player, page_index]`,
`DelegateGrant['delegate', economy_hash, player, delegate]` and
`Season/Podium['season' or 'podium', economy_hash, season_id]`
accounts. A Shot stores ruleset hash, feed/domain, target, Need/Timepin address,
entry price/confidence/exponent/source times, stake, commit, status and every value
needed to reproduce the final integer transition while it is live. At terminal
the program stores only the proof-bearing compact result in its fixed HistoryPage
slot and closes the rich Shot. Optional sponsored transitions reserve a bounded
WorkPage record before funding; every action that performs or makes the work
impossible changes that record exactly once to Payable or Nonpayable. Direct
CompletionReceipts remain the low-volume profile for future compatible Timepin
and Next Print generations. Permanent locators outlive closed subjects, so a
pre-funded voucher never loses the canonical beneficiary it must pay.

`register_ruleset(canonical_bytes)` is permissionless and create-only: it
verifies the schema and content hash, then has no edit/close/authority path. The
minimum economic instruction surface is `init_ledger`, `reload`, `seal`,
`seal_delegated`, `activate_entry`, `settle`, `reveal`, `void_shot`, `forfeit`, `close_shot`,
`grant_delegate`, `revoke_delegate`, and a one-time `claim_legacy` in the migration
build. Initialization may create a named immutable ruleset; it must not create a
mutable admin configuration. Settlement consumes the exact finalized Timepin and
performs the outcome/balance transition exactly once.

## Ordered execution phases and gates

### P0 - repair truth and token-family controls

Finish the signed-source-predecessor patch and regression. Correct the JS client
to Token-2022 and make LiteSVM include a real Token-2022 positive control plus a
classic SPL negative control. Correct documentation that says the ring makes
selection impossible. Produce exact SBF bytes with the pinned CI toolchain and a
hash, but label this as a repaired prototype, not a mainnet candidate.

Gate: host rules, golden vectors, client tests and adversarial LiteSVM batch all
green against the same artifact; source predecessor is demonstrably Pyth-signed;
actual Token-2022 CPI/account flow succeeds. **No Core v1 mainnet deploy.**

### P1 - ship a chain-only inspector and recovery client

Build a signerless inspector that validates program owner, executable flag,
ProgramData address, upgrade authority, exact account size, discriminator, PDA,
context slot and decoded state. Add player-shot discovery by on-chain filters.
Display devnet/mainnet identity prominently and serialize all large integers as
decimal strings. Support any compatible RPC for the intended Solana cluster that
provides the required methods, commitment and account state, and no
Ratchet/Supabase endpoint.

Gate: from a clean machine, the inspector reconstructs the prototype state using
only program id plus a keyless public RPC, and the same state is consistent at a
finalized slot through a second independent endpoint.

### P2 - specify Timepin before funds

Preserve schema 1 as no-value evidence and specify schema 2 separately. Write
canonical EvidenceSpec bytes/hash, binary layouts, source and capture deadlines,
source-domain pinning, challenge/expiry rules and formal invariants. Implement a
pure model and property/adversarial harness for 60/600/870-second profiles,
future aligned T0/T1 targets, gap, reorder, duplicate, conflict, withholding,
first-opener deadline grief and expiry. Make the source interval and exact target
eligibility visible in every vector. EvidenceSpec/Need register-open now have
exact Rust and LiteSVM parity; Candidate/Timepin/receipt layouts and all three
terminal results now execute against the same local SBF. P2 is locally evidenced;
P3 public-source and independent-runner evidence remains the next gate.

Gate: each declared evidence stream has exactly one terminal result (`Final`,
`Ambiguous` or `Expired`); message records have canonical hash order while
capture provenance truthfully remains transaction-order dependent; no ring or
cleanup deletes terminal evidence. This no-value gate does not certify global
source completeness or unblock Core G2 value.

### P3 - deploy Timepin schema 2 no-value devnet

Create a new schema-2 program id and deploy an explicitly upgradeable devnet build;
schema 1 remains historical prototype evidence and cannot satisfy this gate. Open
targets before time, capture real sponsored Pyth accounts, finalize/expire them
from at least two unrelated runners, and verify through the chain-only inspector.
Turn off every Ratchet service during one full-life exercise.

Gate: a stranger needs only source, program id, their fee payer and a compatible
RPC for the intended Solana cluster that serves the required methods, commitment
and state; late creation, wrong domain/feed/owner/PDA, partial verification, false
bracket and conflicting evidence all fail or terminalize exactly as specified.
Devnet remains labeled experimental and no production value is represented.

### P4 - add the demand-bound RCX Work Market

Build a separate voucher program. Exercise nonzero SOL funding through System
Program CPI and RCX escrow through Token-2022 `transfer_checked`, first with a
devnet lab mint and then with an exact fixture/read of the actual mainnet RCX
extension layout. Test multiple sponsors, exact work kinds, first/duplicate
completion, no post-target cancel, fixed recipient, retryable separate claim,
nonpayable refund and rent cleanup. No mint, global purse, partial payout,
treasury or admin-withdraw instruction is permitted.

Gate: conservation holds for every RCX base unit and lamport above the vault rent
floor; only sponsor -> vault -> fixed worker or sponsor-refund paths exist;
classic SPL/wrong mint/wrong ATA/wrong recipient attempts fail; an empty or
failed voucher cannot roll back Timepin/Core completion; unrelated feed spam
earns zero.

### P5 - implement Core G2 as a new generation

Port the smallest directional game kernel. Namespace ledgers/seasons/podiums by
immutable economy hash. Bind every Shot to exact ruleset/economy/evidence-spec
hashes and the Needs required by its sealed entry mode: `OBSERVED_ENTRY` preserves
authenticated crypto entry evidence and binds the exact exit Need, while
`FORWARD_ENTRY` binds both T0 and T1 Needs. Implement future aligned xStock
`PendingEntry -> Active` through a Final T0 Timepin; consume only the exact T1
Timepin for outcome. Enforce feed/horizon admission and exact integer
credit/XP/podium/delegation rules. Keep any decision-band experiment out until
separately accepted from observed data.

Gate: atomic seal/activate/settle/reveal or deterministic named VOID; Timepin
terminal states are mutually exclusive and Core reaches exactly one terminal
economic result under every ordering (including a sealed confidence/tie-band VOID
from otherwise valid Final evidence); reveal versus forfeit is mutually exclusive;
no arbitrary credit grant or cross-economy ruleset access; no selective reveal
advantage; every replay/concurrent write is safe; 1,000 shots can share one Need;
full conservation matches reviewed JS/Rust vectors.

### P6 - prove operator independence for 72 hours

This is an acceptance window, not a reason to delay coding or labeled devnet
prototypes; it is a prerequisite to the P7 mainnet beta. Run Timepin and Core G2
for 72 continuous hours with Ratchet API,
Supabase, our indexer and our runner disabled. Independent runners must discover
and finish work; clients must recover all state from chain; injected oracle/RPC
outages must result in pause/VOID/refund, not latest-price fallback.

Gate: no founder endpoint or secret appears in traces; no unresolved position or
balance divergence; costs and liveness are measured; at least one full life is
executed by a non-Ratchet runner. A shorter run may inform engineering but cannot
be called this gate.

xStock listing has an additional seven-day capture drill spanning US market
open/close and a weekend, with two runners and two RPCs. Every target must reach
`Final`, `Ambiguous` or `Expired`; no stale/latest fallback is permitted; per-feed
p95/p99/max lag and capture success are published. For each feed proposed for
listing, at least 100 admission-eligible targets must be observed and at least
99% must become `Final`; any active-session expiry streak or `Ambiguous` result
requires an explained, encoded policy response before listing. An on-chain
pre-seal liveness rule rejects a stopped/intermittent source rather than relying
on a one-time list. A dead feed cannot pass merely because all targets expire.

### P7 - opt-in mainnet generation

Deploy new Timepin schema-2, Work Market and Core G2 program ids with upgrade
authorities retained for the opt-in pilot. Verify each source/artifact/deployed
byte set and register each verified build while authority exists. Admission is
permissionless under the published
rules; there is no founder-controlled spend or exposure cap. Existing production
positions stay under their original authority and are not mirrored as G2
positions. Because Work Market v2 rejects mutable completion producers, it must
also reject Core/Timepin vouchers throughout this upgradeable pilot. Independent
execution uses ordinary self-funded transactions and Core's cleanup bond; this
keeps the game permissionless without pretending its RCX bounty rail is already
trustless.

Gate: a real RCX Token-2022 reload and a complete owner-chosen position work
through independent clients; on-chain conservation and Timepin evidence match;
stop-admission and deterministic resolution/VOID procedures are proven. No
Work Market v2 voucher may be funded against a mutable producer. The honest
label is **upgradeable mainnet beta**, not permanent, bounty-complete or frozen.

### P8 - migrate legacy state without dual-write

Recover a consistent source snapshot, enumerate every balance/shot/reload/queue
and reconcile liabilities. Define a deterministic leaf format, publish all
eligible leaves or a privacy-preserving reproducible generator, independently
rebuild the Merkle root, compile it into a dedicated migration build and test
one-time claims. Choose a cutover slot/time after which no new legacy position can
be accepted. Old open positions settle under old rules; new positions exist only
in G2.

The final authoritative legacy snapshot comes from the current Upstash economic
store. Supabase is read only as labeled legacy recovery/evidence and cannot
silently add balances absent from the reconciled authority snapshot. After the
root, totals, open-position disposition and cutover point are independently
verified, remove Upstash write/read authority plus Supabase imports and
environment variables from every canonical runtime path. Keep both raw exports
as protected audit evidence; never keep a silent database fallback or a second
writable economy.

Gate: total credits/XP and pending obligations conserve exactly; root is nonzero
and reproduced independently; duplicate/cross-wallet claims fail; there is no
period when server and chain can credit or settle the same identity.

### P9 - publish the recovery and provenance bundle on Arweave

Build a deterministic release directory containing source commit, binaries and
hashes, lockfiles/toolchain, ABIs/layouts, vectors, inspector, runner, release
manifest, migration rules/root, chain transaction ids, authority state and plain
recovery instructions. Scan for secrets and disputed/draft claims, upload once,
read back through multiple gateways, hash-compare, then bind the Arweave id in the
release record.

Gate: a clean machine can recover the exact clients and verify chain state from
the bundle without Ratchet infrastructure. Arweave is never an outcome oracle or
canonical balance store.

### P10 - prepare, but do not schedule, a separately authorized staged immutability ceremony

After every prior gate is green, produce a decision packet: remaining authority,
known limitations, audit findings, build verification, dependency/failure model
and exact irreversible command. **P10 does not authorize execution.** Verification
registration must precede any revocation. The owner must explicitly reopen and
approve each stage at that future time.

The safety order is asymmetric:

1. Stage A removes authority only from the reviewed completion producers
   (compatible Timepin/Core/Next Print generations).
2. Work Market remains upgradeable while an exact real-RCX fund, terminalize,
   claim/refund, MemoTransfer and rent-close lifecycle proves those now-immutable
   producer ABIs end to end.
3. Only after that proof and a fresh Stage B approval may Work Market's own
   authority be removed.

This staged ceremony is optional for operating the upgradeable generation, but
mandatory before claiming the full immutable, trustless destination: every named
program must prove on chain `upgrade_authority = none` (or the
loader-equivalent frozen state). A failed Stage-A bounty proof cannot mutate the
already-frozen producers; it stops Stage B and requires a new Work Market
generation rather than weakening producer immutability.

Gate: today there is intentionally no gate to revoke. No date, countdown,
automation or old document may substitute for fresh consent.

## Grouped test batches

One batch produces one machine-readable result and one concise human summary.
Incremental developer checks are allowed, but release evidence is collected in
these groups rather than dozens of ad-hoc probes.

| Batch | Coverage | Required positive and negative controls |
| --- | --- | --- |
| A - Oracle/Timepin | signed source bracket, domain/feed/PDA/owner, Full verification, confidence/exponent, gaps, duplicates, ordering, conflict, fork-slot policy, expiry | exact crossing finalizes; fabricated predecessor, late Need, omitted crossing and ambiguous conflict cannot settle |
| B - Token/economy | actual Token-2022 layouts/CPI, reload burn/route, bounty escrow/payout/refund, credits, XP, payout integer vectors | real-family success; classic SPL, wrong mint/owner/ATA/recipient, overflow, replay and dust controls fail safely |
| C - State/concurrency | simultaneous seals, duplicate candidates, competing finalizers/runners, settle/void boundary, reveal/forfeit/close, rent recipients | many actors converge on one transition; no trapped stake, double payout or caller-chosen rent |
| D - Independence/client | inspector, account discovery, transaction construction, public RPC failover, server-off lifecycle, second implementation | clean machine and unrelated runner succeed; Ratchet URL/API key/DB absence does not change validity |
| E - Migration/conservation | consistent snapshot, queues/receipts/open positions, Merkle leaves/proofs, cutover barrier | independently reproduced root and totals; duplicate/cross-wallet/stale snapshot/dual-write controls fail |
| F - Release/provenance | pinned rebuild, SBF hash, deployed ProgramData bytes, verified-build record, authorities, manifest, Arweave readback | source == artifact == deployed executable; wrong cluster/id/hash/authority or secret scan failure stops release |

Release batches run once per candidate commit. A failure invalidates the candidate;
it does not trigger an authority bypass, stale artifact reuse or selective rerun
report. Performance/load cases are grouped inside C/D and use realistic batches,
which follows the owner's request to test broadly without wasting time.

## What can be completed today, and what cannot honestly be completed today

### Realistic 2026-09-03 deliverables

- land the signed-source-predecessor regression and actual Token-2022 client/test
  controls;
- produce the pinned candidate build and batch report;
- add the chain-only inspector and state discovery;
- publish this canonical plan and correct superseded trust claims;
- write the Timepin executable specification, layouts and adversarial model;
- if the build/network/authority path is available, deploy a clearly labeled
  no-value Timepin devnet candidate and run first lives; and
- prepare the guarded one-command release tool and manifest format.

### Things engineering speed cannot truthfully compress into today

- 72 hours of independent operation;
- a verified legacy snapshot while the authoritative database is unavailable;
- proof that unrelated parties actually operated the system over time;
- production conservation across a cutover that has not occurred;
- a final Arweave bundle before the source, artifacts and manifest are final;
- a claim that mainnet G2 is canonical before an opt-in pilot exists; or
- immutability/authority revocation without a separate future decision.

We can deploy experimental bytes quickly. We cannot manufacture elapsed-time
evidence, historical source data or an irreversible safety proof. The plan keeps
implementation moving today without laundering speed into a false permanence
claim.

## Final deploy-click runbook

The final release must be one guarded manifest-driven action, not a person copying
addresses between terminals. The first tool slice now exists:
`tools/permanence-release.mjs` is offline and read-only, validates identities,
the local ELF hash, one-time-snapshot -> Solana-only migration, and one exact
declared action. It has no signer, RPC, transaction or secret path and actively
refuses `--execute`, authority revocation and refreeze.

```text
node tools/permanence-release.mjs \
  --dry-run \
  --manifest releases/permanence-manifest.example.json
```

P7 must extend that reviewed schema with the network/simulation/execution layer.
Only then is the intended final click available; this command is a target, not a
currently accepted invocation:

```text
node tools/permanence-release.mjs \
  --manifest releases/g2-mainnet-v1.json \
  --signer <local-authority-keypair> \
  --execute
```

The signer is a local Solana deployment authority, not an API credential. The
manifest pins genesis hash, RPC commitment, Timepin/Work-Market/Core program ids, source
commit, exact SBF hashes, loader, upgrade authority, RCX mint and Token-2022
program, Pyth receiver/push-oracle/domain/feed accounts, schemas, ruleset values,
exact expected transaction movements/destinations and initialization PDAs.

The command must perform and journal these steps in order:

1. Require a clean tagged commit, committed lockfiles and all A-F candidate
   batches green for that exact commit/artifact pair.
2. Read cluster genesis hash and finalized context from two RPC endpoints; prove
   program ids are unused (or exactly the expected upgradeable pilot) and print
   every address and exact expected SOL/RCX movement.
3. Verify local signer public keys only and balances. Compute and display every
   expected fee, rent payment and token movement; reject undeclared instructions
   or destinations. Never print or copy secret key material.
4. Rebuild or verify the pinned artifacts and reject any byte/hash difference.
5. Deploy Timepin schema 2, then Work Market, then Core G2, with upgrade
   authorities **retained** for the pilot. Read every ProgramData account back
   and compare executable bytes/hash to the manifest.
6. Register verified builds while each upgrade authority still exists. Confirm
   the public repository/commit binding from chain.
7. Initialize only the manifest-pinned schema/ruleset accounts. Prove there is no
   admin award, pause, oracle-post or arbitrary withdrawal capability.
8. Execute a zero-value Timepin sentinel: pre-open Need, capture a real sponsored
   message, finalize/expire as appropriate, and decode it with the independent
   inspector.
9. Execute an explicit opt-in pilot: one owner-chosen RCX bounty/reload path and
   one complete G2 shot life, then reconcile every base unit and account
   transition. The protocol does not impose a founder spend cap.
10. Emit an append-only JSON result containing slots, signatures, account bytes,
    hashes, costs and pass/fail status. A partial execution is `INCOMPLETE`, never
    success.
11. Enable only opt-in G2 admission after the result passes. Existing server
    positions remain visibly legacy and are never copied as live G2 positions.
12. After P8 later passes (P6 was already a prerequisite to this P7 pilot), run a
    separate cutover manifest that closes legacy admission at a named finalized
    slot and publishes the migration root. It must not mutate old open-position
    rules.
13. After P9, append and verify the Arweave bundle id. Publication does not change
    economic state.

There is deliberately no `--revoke-authority` in the deploy command. A future
finalization tool, if explicitly authorized, must first re-read all evidence and
require a separate human confirmation containing the exact program id and
artifact hash. The old September date is not valid confirmation.

### Automatic stop conditions

The release tool exits before the next write if any of these is true:

- wrong cluster/genesis hash, program id, signer, loader, authority, mint or token
  program;
- source/artifact/deployed/verified-build hash mismatch;
- any canonical path references an API key, Ratchet endpoint, Supabase result or
  operator-signed outcome;
- actual RCX Token-2022 positive control or extension validation is missing;
- Timepin cannot prove the signed source bracket, a valid conflict is not
  terminally ambiguous, or a target was not predeclared;
- bounty cancellation/recipient/withdrawal can be changed after target;
- an admin can alter rules, award balances, choose an outcome or block refunds;
- any batch is red, a report belongs to another commit, or only selective tests
  were rerun;
- finalized RPC views disagree and the difference is not resolved at a common
  slot;
- fees, rent, instructions, destinations or RCX movement differ from the exact
  manifest declaration;
- legacy totals/root do not reproduce, `LEGACY_ROOT` is zero at migration, or a
  dual-write window exists;
- a full-life position cannot resolve or deterministically void with Ratchet
  services off;
- secret scanning or Arweave readback/hash comparison fails; or
- any revocation is requested without new explicit owner authorization after all
  prior gates.

The closed historical HTTP 500 incident is never a reason to disable these
stops. It is evidence for why the destination architecture is necessary, not a
claim that h113 is currently unhealthy.

## Decision register

| Date | Decision | Consequence |
| --- | --- | --- |
| 2026-09-03 | Canonical runtime is API-keyless forever. | Sponsored on-chain Pyth plus public/user-chosen RPC; no authenticated Hermes, vendor token or founder endpoint in validity. |
| 2026-09-03 | Solana is the economic database; caches are projections. | Website, Upstash, Supabase and indexers may disappear without changing balances/outcomes. |
| 2026-09-03 | Freeze is removed from the current target. | No authority revocation and no September 8 deadline. `FREEZE.md` is historical until fresh explicit authorization. |
| 2026-09-03 | Build toward Timepin as reusable RCX infrastructure. | Public target-time evidence and multi-sponsor execution vouchers are separate from RatchetX game rules. |
| 2026-09-03 | RCX utility must preserve existing token truth. | Token-2022 only, existing supply only, no new mint/faucet/treasury promise; bounties transfer escrowed RCX. |
| 2026-09-03 | Test in grouped batches. | One candidate, six broad batches, one evidence report; no ceremony based on scattered green probes. |
| 2026-09-03 | No founder-controlled pilot/spend cap. | Admission follows public rules; deployment tooling only rejects transactions whose exact movements or destinations differ from the reviewed manifest. |
| 2026-09-03 | Upstash is the current legacy authority; Supabase is labeled recovery evidence, not the destination. | Snapshot and independently reconcile Upstash against permitted legacy evidence once, cut admission without dual-write, then remove both stores from every canonical runtime path. |
| 2026-09-03 | No model-picked decision-band constant becomes permanent. | Preserve confidence evidence and collect actual shadow outcomes before a separately versioned rule decision. |
| 2026-09-03 | Games adapt to the API-keyless on-chain source, not the reverse. | Seal feed-specific gap, lag, horizon and symmetric uncertainty tolerances up front; change future questions, never a live outcome. |
| 2026-09-03 | Rulesets are permissionless and content-addressed. | RatchetX may recommend one immutable ruleset; other applications may use other supported canonical bytes without Ratchet authority. |
| 2026-09-03 | Transport is replaceable; verification is on chain. | Sponsored Pyth is the current no-subscription live path, while RPC, rent and submission still cost resources; public gateways, peers or archives may deliver signed history but cannot decide validity. |
| 2026-09-03 | Timepin v1 Final means unique submitted evidence only. | Mutable-source archival challenge and explicit liveness assumptions remain blockers before Core G2 carries value. |
| current | Native equities remain held. | They return only with a permissionless source-bound on-chain evidence route; an authenticated market-data API is not acceptable. |
| current | xStocks are a candidate source domain, not an approved listing. | Pyth-owned Full accounts are keylessly readable today, but are not on Pyth's current official sponsored-Solana list; cadence stalled in the longer run. Cards must say tokenized tracker (for example TSLAX), never direct TSLA equity. |
| current | Stock architecture uses shared future targets. | Slow profiles seal commitment/stake before aligned T0, open T0 and T1 Needs atomically, and consume reusable Timepins; no FeedClock-ring entry binding. |
| current | Historical `c42baf8` CrankPurse is rejected and reverted by `70de57e`. | No raw-checkpoint reward or inline transfer enters the release; P4 is a separate demand-bound Work Market with activated nonzero tests. |
| current | Horizons/PUMP board policy is reversible until G2. | UI changes can ship independently, but economic support requires on-chain ruleset and Timepin vectors. |
| current | New canonical economics use a new program generation. | Core v1 repairs are evidence and learning; they do not justify in-place permanence or a silent mainnet cutover. |
| current | Arweave preserves reviewed knowledge, not live authority. | Publish final source/build/recovery evidence; keep outcome and balance consensus on Solana. |
| current | Work Market v2 funds only immutable completion producers. | Upgradeable P7 proves Core/Timepin without v2 vouchers; a separately approved Stage A freezes producers, real RCX proves the still-upgradeable market, and only a separate Stage B may freeze Work Market. |

## Claim ladder and definition of done

Use only the highest claim whose evidence gate has passed:

- **Today:** "RCX's token authorities are revoked; the live game is still
  server-authoritative; the on-chain successor is under construction."
- **After P3:** "A no-value Timepin devnet prototype is stranger-runnable."
- **After P5:** "Core G2 passes local/devnet economic and oracle adversarial
  batches." This still is not a production claim.
- **After P7:** "An opt-in, upgradeable mainnet on-chain beta exists."
- **After P6/P8/P9 and canonical cutover:** "RatchetX economic state and outcomes
  are recoverable and operable without Ratchet infrastructure."
- **Only after a separately authorized P10:** "This named program generation is
  immutable," accompanied by the program id, source commit, executable hash,
  verified-build record and on-chain `authority = none` proof.

RatchetX reaches the operator-independent cutover state when a clean-room operator can obtain
the public release bundle, choose any compatible RPC, reconstruct every canonical
player balance and open position from Solana, create valid play, capture/reuse
Timepins, fund or earn RCX execution bounties, settle/VOID/reveal/close positions,
revoke delegations and verify scores without a Ratchet server, secret or
permission. Turning off our site, database, indexer and runner may reduce comfort
and speed; it must not change truth, seize value or make recovery depend on us.
The user's full trustless/immutable destination additionally requires the
separately authorized P10 ceremony and on-chain proof that every named program's
upgrade authority is gone; before that, the honest claim is operator-independent
but upgradeable.

That is the epic on-chain stamp worth aiming for: not a promise that software can
never encounter failure, but a machine whose rules, evidence and recovery remain
public after its builders are gone.
