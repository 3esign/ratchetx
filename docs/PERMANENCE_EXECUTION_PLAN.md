# RatchetX permanence execution plan

Status: **active execution map, not a completion claim**
Snapshot date: **2026-09-03**
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
   promise or an investment guarantee.
4. Tests are grouped into meaningful batches. We do not spend the project on
   repeated tiny checks, but every irreversible boundary still needs a positive
   control, adversarial controls and a reproducible release record.

## What "permanent" can honestly mean

A Solana program cannot wake itself, make an HTTP request or submit its own
transaction. There is no literal perpetual-motion machine. The achievable and
stronger engineering promise is a **perpetual protocol, not perpetual compute**:

- no particular operator is required;
- any payer may submit the same deterministic transition;
- RCX bounties can make useful execution economically attractive;
- duplicate actors are harmless;
- absence of every actor leads to a bounded, deterministic terminal state such
  as VOID/refund, never to confiscation or an operator-chosen result; and
- any website, indexer, RPC endpoint or runner can be replaced without changing
  the ledger.

The irreducible dependencies remain Solana consensus and data availability,
Pyth's signed price messages and sponsored account publication, transaction
submitters, account rent, and a route to a Solana RPC. If Solana halts, execution
halts. If the admissible oracle source stops, new affected play pauses and open
positions follow an explicit fail-closed rule. Those are protocol dependencies,
not founder permissions.

## Evidence baseline: what exists now

This table separates chain observations from plans and source-code assertions.
Every quantity is time-stamped because supply and cluster state can change.

| Surface | Evidence as of 2026-09-03 | Honest status |
| --- | --- | --- |
| RCX mint | Mainnet mint `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`, owned by Token-2022, decimals 6. At finalized slot 443,821,054 the supply read 936,699,884.132132 RCX. Mint authority and freeze authority were none; metadata update and metadata-pointer authorities were disabled. | The token layer is fixed-supply and unfreezable. Supply may continue to fall through burns. |
| Seal v2 | Mainnet program `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX` exists and retains upgrade authority. | Optional receipt/referee experiment, not the canonical game ledger. Do not freeze it in this cycle. |
| Core v1 candidate | Candidate program id `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` is absent from mainnet. A devnet prototype exists with an upgrade authority retained. The committed `1ba43717...` artifact reproduced the prototype bytes before the findings below. | Prototype evidence only; not safe to call canonical or final. |
| Legacy migration | `LEGACY_ROOT` in the candidate is all zeroes. | No wallet can make a valid legacy claim. No migration has occurred. |
| Live economy | Credits, shots, settlement, XP and podium consequences still depend on the production application and Supabase state. | The live game is not fully on-chain or founder-independent. |
| Production incident | The site/API was returning HTTP 500 while the database service was restricted. | This is evidence that an off-chain authority/availability boundary still exists. It is not permission to bypass conservation checks or invent a snapshot. |
| Oracle access | The current public route reads Pyth sponsored push accounts over Solana JSON-RPC; authenticated Hermes is not a canonical path. | Correct API-keyless direction, but current-account access alone is not a historical crossing proof. |
| Current repair branch | A source-predecessor correction and adversarial regression are being built and batch-tested. | Work in progress until exact SBF bytes, tests and a release record agree. Not deployment evidence. |

## Known blockers that invalidate earlier "done" language

The following are release blockers, not documentation polish:

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

The source-predecessor patch is necessary, but it does not solve items 2-6 and is
therefore not a reason to deploy Core v1 as the permanent mainnet generation.

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
9. **No privileged economic transition.** No admin may award credits/XP, choose an
   outcome, change a recipient, withdraw player value, pause refunds or replace a
   ruleset in place.
10. **Open execution.** Capture, finalization, settlement, void, forfeit and safe
    cleanup are callable by any funded transaction sender. Rent and rewards go to
    addresses fixed by state, not to arbitrary accounts supplied by the caller.
11. **No dual authority.** During migration, every new position has one named
    canonical generation. The database and chain must never both be able to
    settle or credit the same position.
12. **Evidence before permanence.** Source, deterministic artifact, deployed
    executable, verified-build record, program authority, program accounts and
    full-life transactions must all agree before any future authority revocation.
13. **Permanent publication is last.** Arweave publication and immutability are
    irreversible acts. Drafts, secrets, disputed manifests and unverified claims
    are never made permanent merely to meet a date.

## Target architecture

### 1. Solana: canonical machine and database

Solana stores the minimum state needed to reproduce every economic consequence:
versioned rules, player ledger, position commitments, source-bound oracle
evidence, terminal outcome, score, replay guards, delegation and RCX bounty
escrow. Account events and transaction history make the state externally
indexable; no SQL row is needed to establish truth.

### 2. RCX Timepin: reusable public oracle infrastructure

Timepin is a separate, small program so other Solana applications can request and
reuse the same target-time evidence without importing RatchetX game economics.
Its unit of work is a predeclared `Need` for one oracle domain, feed and target
timestamp. Anyone may capture the current sponsored Pyth shard-0 account, but the
program accepts it only when the signed source interval brackets the target.

The permanent `Timepin` records the full decision material, not a rounded display
price: oracle/receiver domain, feed id, price, confidence, exponent, EMA fields,
signed previous and current publish times, verification level, source account,
posted slot, capture slot/time, capturer and message hash. Identical submissions
collapse. Conflicting fully valid messages enter an explicit challenge path; if
uniqueness cannot be proven, the terminal state is `Ambiguous`, never a
caller-selected winner. No ring can evict a finalized Timepin.

This is the infrastructure stamp: **Solana decides; Timepin remembers; RCX pays
open execution.** RatchetX is the first consumer, not a privileged consumer.

### 3. Need/Bounty: permissionless liveness without a treasury

A sponsor may attach one or more independent RCX `Bounty` vouchers to a Need.
Existing Token-2022 RCX is escrowed; the program never mints it and has no faucet.
After the target, the sponsor cannot cancel or redirect the voucher. A finalized
Timepin fixes the recipient to the eligible capturer's RCX ATA. If the Need
expires without admissible evidence, the refund address is the original sponsor.
Anyone may submit the payout/refund transaction, but cannot select its recipient.
Multiple games can sponsor the same Need and reuse one public Timepin.

The bounty is an incentive, not an outcome input. With no bounty or no actor, the
protocol still reaches an explicit expiry/VOID path. No founder runner is special.

### 4. Core G2: versioned economic consumer

Core G2 is a new program id, not an in-place reinterpretation of Core v1. At seal
it atomically debits credits, binds the player/nonce/commitment, stores the
ruleset, validates and stores entry price plus confidence, and creates or joins a
Need for expiry. At settlement it accepts only a finalized Timepin for that exact
Need. `Missing`, `Expired` or `Ambiguous` evidence follows a deterministic refund
rule. It never reads an evicting checkpoint ring.

The ruleset enforces the supported feed/horizon matrix on chain. Horizons and
PUMP may remain reversible board presentation before G2, but they become economic
protocol support only when their sponsored source account, Timepin vectors and
ruleset entry pass the same gate. Held equities stay out until they have an
equally permissionless, source-bound on-chain evidence path.

If a confidence decision band is later accepted, the ruleset names its integer
formula and constant, and both entry and exit confidence are stored. Until real
shadow observations justify that separate rule decision, G2 must not pretend a
model-picked `k` is permanent truth.

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

This is the input to P2's executable specification, not yet a frozen ABI. All
integer seed encodings must be fixed in golden vectors before deployment.

### Timepin program accounts

| Account | Candidate PDA seeds | Essential fields |
| --- | --- | --- |
| `Need` | `['need', schema_u16_le, oracle_domain_32, feed_id_32, target_i64_le]` | schema, domain, feed, target, opened slot/time, capture deadline, challenge deadline, state, terminal Timepin |
| `Candidate` | `['candidate', need, message_hash_32]` | raw signed-message fields, source account, posted/capture slot, capturer, validation result |
| `Timepin` | `['timepin', need]` | immutable terminal kind plus the complete finalized evidence or ambiguity/expiry proof |
| `Bounty` | `['bounty', need, sponsor, nonce_u64_le]` | Token-2022 mint, amount, sponsor/refund address, fixed eligible recipient, paid/refunded flag |
| `BountyVault` | `['vault', bounty]` | Token-2022 escrow authority; no arbitrary withdrawal path |

Candidate Timepin instructions:

- `open_need(schema, domain, feed, target, capture_deadline, challenge_slots)`:
  permissionless, but only before `target`; idempotent when all fields match.
- `post_candidate(raw_price_update)`: validates receiver/source owner, sponsored
  PDA, feed, Full verification and the signed source bracket. Stores full message
  fields and hash; never accepts a caller-provided decoded price without the
  source account.
- `finalize_timepin()`: permissionless after the challenge interval. Identical
  candidates converge; a proved conflict becomes `Ambiguous`.
- `expire_need()`: permissionless after the capture deadline when no admissible
  candidate exists; creates a permanent terminal Timepin.
- `fund_bounty(nonce, amount)`: sponsor transfers existing Token-2022 RCX into
  the derived vault before the no-cancel boundary.
- `settle_bounty()`: permissionless; pays only the finalized eligible capturer.
- `refund_expired_bounty()`: permissionless; returns only to the recorded sponsor
  after an `Expired`/nonpayable terminal state.
- `close_candidate()`: optional rent cleanup only after terminalization; rent
  recipient is fixed in state. `Need`/`Timepin` evidence remains addressable.

P2 must decide the exact treatment of same-publish-time messages, forks,
verification upgrades, challenge duration, rent and whether a compact raw message
is copied or hash-bound to an immutable source account. No value is attached
until those decisions have adversarial vectors.

### Core G2 program accounts and instructions

Candidate PDAs include `Ruleset['ruleset', version]`,
`PlayerLedger['ledger', player]`, `Shot['shot', player, nonce]`,
`DelegateGrant['delegate', player, delegate]` and bounded/sharded season or podium
accounts. A Shot stores ruleset version, feed/domain, target, Need/Timepin address,
entry price/confidence/exponent/source times, stake, commit, status and every value
needed to reproduce the final integer transition.

The minimum instruction surface is `init_ledger`, `reload`, `seal`,
`seal_delegated`, `settle`, `reveal`, `void_shot`, `forfeit`, `close_shot`,
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
decimal strings. Support any RPC and no Ratchet/Supabase endpoint.

Gate: from a clean machine, the inspector reconstructs the prototype state using
only program id plus a keyless public RPC, and the same state is consistent at a
finalized slot through a second independent endpoint.

### P2 - specify Timepin before funds

Write the state machine, binary layouts, source-domain pinning, challenge rule,
expiry rule and formal invariants. Implement a pure model and property/adversarial
harness for gaps, reorder, duplicate, conflict, withholding and expiry. Make the
source interval and exact target eligibility visible in every vector.

Gate: each declared evidence stream has exactly one terminal result (`Final`,
`Ambiguous` or `Expired`); no submission order can improve a player's economic
outcome; no ring or cleanup deletes terminal evidence.

### P3 - deploy Timepin no-value devnet

Create a new program id and deploy an explicitly upgradeable devnet build. Open
targets before time, capture real sponsored Pyth accounts, finalize/expire them
from at least two unrelated runners, and verify through the chain-only inspector.
Turn off every Ratchet service during one full-life exercise.

Gate: a stranger needs only source, program id, their fee payer and any RPC; late
creation, wrong domain/feed/owner/PDA, partial verification, false bracket and
conflicting evidence all fail or terminalize exactly as specified. Devnet remains
labeled experimental and no production value is represented.

### P4 - add Need/Bounty with Token-2022

Exercise voucher escrow first with a devnet Token-2022 lab mint, then prove the
actual mainnet RCX mint/extension layout read path without moving value. Test
multiple sponsors on one Need, first/duplicate capturers, no post-target cancel,
fixed recipient, expiry refund and rent cleanup. No mint, treasury or admin
withdraw instruction is permitted.

Gate: conservation holds for every RCX base unit; only sponsor -> vault -> fixed
capturer or sponsor-refund paths exist; classic SPL/wrong mint/wrong ATA/wrong
recipient attempts fail.

### P5 - implement Core G2 as a new generation

Port the smallest directional game kernel. Bind every Shot to an immutable
ruleset and expiry Need, preserve entry confidence, consume finalized Timepins,
enforce feed/horizon admission, and implement exact integer credit/XP/podium and
delegation rules. Keep any decision-band experiment out until separately accepted
from observed data.

Gate: atomic seal/settle/reveal or deterministic void; no arbitrary credit grant;
no selective reveal advantage in published reputation; every replay/concurrent
write is safe; full economic conservation matches reviewed JS/Rust vectors.

### P6 - prove operator independence for 72 hours

This is an acceptance window, not a reason to delay coding, devnet deployment or
a labeled beta. Run Timepin and Core G2 for 72 continuous hours with Ratchet API,
Supabase, our indexer and our runner disabled. Independent runners must discover
and finish work; clients must recover all state from chain; injected oracle/RPC
outages must result in pause/VOID/refund, not latest-price fallback.

Gate: no founder endpoint or secret appears in traces; no unresolved position or
balance divergence; costs and liveness are measured; at least one full life is
executed by a non-Ratchet runner. A shorter run may inform engineering but cannot
be called this gate.

### P7 - capped, opt-in mainnet generation

Deploy new Timepin and Core G2 program ids with upgrade authorities retained for
the bounded pilot. Verify source/artifact/deployed bytes and register the verified
build while authority exists. Admit only explicit opt-in positions under a hard
published exposure cap. Existing production positions stay under their original
authority and are not mirrored as G2 positions.

Gate: real RCX Token-2022 reload/bounty and a complete small-value position work
through independent clients; on-chain conservation and Timepin evidence match;
stop-admission and deterministic resolution/VOID procedures are proven. The
honest label is **upgradeable mainnet beta**, not permanent or frozen.

### P8 - migrate legacy state without dual-write

Recover a consistent source snapshot, enumerate every balance/shot/reload/queue
and reconcile liabilities. Define a deterministic leaf format, publish all
eligible leaves or a privacy-preserving reproducible generator, independently
rebuild the Merkle root, compile it into a dedicated migration build and test
one-time claims. Choose a cutover slot/time after which no new legacy position can
be accepted. Old open positions settle under old rules; new positions exist only
in G2.

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

### P10 - prepare, but do not schedule, an optional immutability ceremony

After every prior gate is green, produce a decision packet: remaining authority,
known limitations, audit findings, build verification, dependency/failure model
and exact irreversible command. **P10 does not authorize execution.** Verification
registration must precede any revocation. The owner must explicitly reopen and
approve the ceremony at that future time.

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
addresses between terminals. P7 must deliver a tool with this interface (the tool
does not yet exist and this document does not pretend otherwise):

```text
node tools/permanence-release.mjs \
  --manifest releases/g2-mainnet-v1.json \
  --cluster mainnet-beta \
  --signer <local-authority-keypair> \
  --dry-run

node tools/permanence-release.mjs \
  --manifest releases/g2-mainnet-v1.json \
  --cluster mainnet-beta \
  --signer <local-authority-keypair> \
  --execute
```

The signer is a local Solana deployment authority, not an API credential. The
manifest pins genesis hash, RPC commitment, Timepin/Core program ids, source
commit, exact SBF hashes, loader, upgrade authority, RCX mint and Token-2022
program, Pyth receiver/push-oracle/domain/feed accounts, schemas, ruleset values,
pilot caps, fee/spend caps and expected initialization PDAs.

The command must perform and journal these steps in order:

1. Require a clean tagged commit, committed lockfiles and all A-F candidate
   batches green for that exact commit/artifact pair.
2. Read cluster genesis hash and finalized context from two RPC endpoints; prove
   program ids are unused (or exactly the expected upgradeable pilot) and print
   every address and maximum SOL/RCX movement.
3. Verify local signer public keys only, balances and spend caps. Never print or
   copy secret key material.
4. Rebuild or verify the pinned artifacts and reject any byte/hash difference.
5. Deploy Timepin, then Core G2, with upgrade authorities **retained** for the
   pilot. Read ProgramData back and compare executable bytes/hash to the manifest.
6. Register verified builds while each upgrade authority still exists. Confirm
   the public repository/commit binding from chain.
7. Initialize only the manifest-pinned schema/ruleset accounts. Prove there is no
   admin award, pause, oracle-post or arbitrary withdrawal capability.
8. Execute a zero-value Timepin sentinel: pre-open Need, capture a real sponsored
   message, finalize/expire as appropriate, and decode it with the independent
   inspector.
9. Execute the explicitly capped pilot: one small RCX bounty/reload path and one
   complete G2 shot life, then reconcile every base unit and account transition.
10. Emit an append-only JSON result containing slots, signatures, account bytes,
    hashes, costs and pass/fail status. A partial execution is `INCOMPLETE`, never
    success.
11. Enable only opt-in G2 admission after the result passes. Existing server
    positions remain visibly legacy and are never copied as live G2 positions.
12. After P6 and P8 later pass, run a separate cutover manifest that closes legacy
    admission at a named finalized slot and publishes the migration root. It must
    not mutate old open-position rules.
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
- fees, rent or RCX movement exceed manifest caps;
- legacy totals/root do not reproduce, `LEGACY_ROOT` is zero at migration, or a
  dual-write window exists;
- a full-life position cannot resolve or deterministically void with Ratchet
  services off;
- secret scanning or Arweave readback/hash comparison fails; or
- any revocation is requested without new explicit owner authorization after all
  prior gates.

The current HTTP 500 is never a reason to disable these stops. It is the reason
the destination architecture is necessary.

## Decision register

| Date | Decision | Consequence |
| --- | --- | --- |
| 2026-09-03 | Canonical runtime is API-keyless forever. | Sponsored on-chain Pyth plus public/user-chosen RPC; no authenticated Hermes, vendor token or founder endpoint in validity. |
| 2026-09-03 | Solana is the economic database; caches are projections. | Website, Supabase and indexers may disappear without changing balances/outcomes. |
| 2026-09-03 | Freeze is removed from the current target. | No authority revocation and no September 8 deadline. `FREEZE.md` is historical until fresh explicit authorization. |
| 2026-09-03 | Build toward Timepin as reusable RCX infrastructure. | Public target-time evidence and multi-sponsor execution vouchers are separate from RatchetX game rules. |
| 2026-09-03 | RCX utility must preserve existing token truth. | Token-2022 only, existing supply only, no new mint/faucet/treasury promise; bounties transfer escrowed RCX. |
| 2026-09-03 | Test in grouped batches. | One candidate, six broad batches, one evidence report; no ceremony based on scattered green probes. |
| 2026-09-03 | No model-picked decision-band constant becomes permanent. | Preserve confidence evidence and collect actual shadow outcomes before a separately versioned rule decision. |
| current | Equities remain held. | They return only with a permissionless source-bound on-chain evidence route; an authenticated market-data API is not acceptable. |
| current | Horizons/PUMP board policy is reversible until G2. | UI changes can ship independently, but economic support requires on-chain ruleset and Timepin vectors. |
| current | New canonical economics use a new program generation. | Core v1 repairs are evidence and learning; they do not justify in-place permanence or a silent mainnet cutover. |
| current | Arweave preserves reviewed knowledge, not live authority. | Publish final source/build/recovery evidence; keep outcome and balance consensus on Solana. |

## Claim ladder and definition of done

Use only the highest claim whose evidence gate has passed:

- **Today:** "RCX's token authorities are revoked; the live game is still
  server-authoritative; the on-chain successor is under construction."
- **After P3:** "A no-value Timepin devnet prototype is stranger-runnable."
- **After P5:** "Core G2 passes local/devnet economic and oracle adversarial
  batches." This still is not a production claim.
- **After P7:** "An opt-in, capped, upgradeable mainnet on-chain beta exists."
- **After P6/P8/P9 and canonical cutover:** "RatchetX economic state and outcomes
  are recoverable and operable without Ratchet infrastructure."
- **Only after a separately authorized P10:** "This named program generation is
  immutable," accompanied by the program id, source commit, executable hash,
  verified-build record and on-chain `authority = none` proof.

RatchetX reaches the requested destination when a clean-room operator can obtain
the public release bundle, choose any compatible RPC, reconstruct every canonical
player balance and open position from Solana, create valid play, capture/reuse
Timepins, fund or earn RCX execution bounties, settle/VOID/reveal/close positions,
revoke delegations and verify scores without a Ratchet server, secret or
permission. Turning off our site, database, indexer and runner may reduce comfort
and speed; it must not change truth, seize value or make recovery depend on us.

That is the epic on-chain stamp worth aiming for: not a promise that software can
never encounter failure, but a machine whose rules, evidence and recovery remain
public after its builders are gone.
