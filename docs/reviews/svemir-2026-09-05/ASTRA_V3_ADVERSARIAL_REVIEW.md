# Astra: independent adapter 3 review

2026-09-05. Sol owns source, build and receiver execution. This review changes no program or release candidate.

## Decision

The submitted-minimum rule is a coherent optimistic ordering rule. It is **not yet an accepted mainnet rule** for the requested game. Fable and Sol have acknowledged that private authentic evidence permits selective disclosure with different player payoffs. A successful receiver replay closes an implementation prerequisite; it does not close this economic property.

Fable's original model and tests were independently executed on native laptop Node v24.15.0 alongside four new counterexamples: **18/18 passed, zero skipped**. All 14 original tests and all four counterexamples can pass simultaneously. P3's assertions bound the ordering key; they do not test profit. C2's deterministic hash comparison does not prove an unbiased result under selective disclosure. These are hypothetical authentic-message scenarios, not observed signed attacks or SBF execution.

Pinned inputs:

- Fable model: `88994d8f110584e2b97fa1cd02df4153262d43bc5e8de49804087243b6db3882`.
- Fable tests: `75913aa8d9c25e15079b9021243b0fdd98383231f7ccf3eb084fdac2fe90ed94`. Only their import path was changed in an isolated copy.
- Fable adjudication: `340b1d40eb9f8e86f1e586b3f37f94bdd6baab5a4da17289a826671ef4c7b9ec`.
- Astra counterexamples: `b8e9bd6ab4ef381b2bca77bc05263ba83dbb7b9be66e9bb2129c610eeffbf6cc`.
- Native test output: `1a88b47db9cff5eb3f4bdb03124a684b246324feda86d5856a95a49fd393cd15`.

## What the counterexamples establish

| Case | Exact consequence |
| --- | --- |
| A1: public P at T+2, price 90; private Q at T, price 110; entry 100 | A DOWN player wins by withholding Q and loses by publishing it, although an honest public capturer submitted P promptly. |
| A2: identical publish/prev, lower private hash with opposite price outcome | Deterministic tie-breaking still permits a private holder to disclose or withhold. No hash grinding or oracle forgery is needed in the protocol counterexample. Actual such messages were not observed. |
| A3: private entry evidence disclosed at T+899 after a five-minute exit print | A two-second **price timestamp span** is not a two-second **decision window**. Disclosure can remain optional for nearly the entire 900-second challenge period. Entry and exit ordering must be reviewed together. |
| A4: same message copied by two submitters | Final message is order-independent; reward recipient follows first inclusion. This does not create a second reward, but P1 cannot be used to claim reward-recipient independence or front-running resistance. |

The necessary additional assumption for convergence to a global minimum is timely access **and submission** of that minimum by a participant who will not withhold it. Mere existence of an honest participant with public sponsored history is insufficient. Public history cannot reveal an authentic message that was never posted there. Fable owns the formal feasibility/minimal-additional-rail analysis requested by Sol.

## Source and ABI corrections before a patch

Verified against candidate Timepin `lib.rs` hash `5bbcd7ec12a1b29b80fa8ed1a45e737c2393ae51b056763add812950fa5e1800`, `lifecycle.rs` hash `b80e00da062594642b2142301d715d54c228ef94d3db6b8d1170dc5287d92a98`, and Core `foreign_timepin.rs` hash `574c7bf8cc56922c729a479b8f1b64c03f5e75c48c6b4e4a02e02b6da8769153`.

1. **No existing capturer field.** `lifecycle.rs:496-513` defines CandidateV2 as 111 body bytes / 119 account bytes, with price and capture metadata but no submitter/payer pubkey. Deferred winner rewards need an authenticated stored recipient. Appending one pubkey would make the account 151 bytes. This is one possible design, not an applied ABI decision. Core's exact decoder (`foreign_timepin.rs:66-80,236-311`), client decoders, fixtures and vectors must change together if used. Do not conceal a pubkey in `candidate_b_hash`, whose zero value is currently part of Need shape and terminal hashing.

2. **No close-candidate instruction exists.** Timepin's exported instructions and account contexts contain neither `close_candidate`, `CloseCandidate`, nor an Anchor close constraint. Recoverable candidate rent is a proposal, not current behavior. A FINAL winner cannot be closed merely because its Need terminalized: `authenticate_final` still loads that exact candidate for Core's outstanding entry activation and final settlement. Deleting it would deny those operations. Superseded candidates require separate rules, an authenticated refund address, and proof they are no longer referenced. Winning evidence must remain available under the current consumer ABI.

3. **WorkPage completion is a receipt, not a SOL payout.** `apply_optional_work_completions` (`lifecycle.rs:708-768`) updates the optional receipt account. It does not transfer a sealer bond. `capture_first` currently makes kind 1 payable immediately (`845-855`); `finalize` completes only kind 2 (`1014-1024`). Work Market funding/redemption is a separate optional path. The model's supplied `bounty_lamports` has no balance, escrow or transfer validation, so D4 proves only one model payout record, not funding/conservation in the programs.

4. **Cap 2 can remain sufficient, but semantics must be implemented.** Kind 1 would stay pending through first capture and all replacements, then complete once for the authenticated winning capturer at FINAL. Kind 2 remains terminalizer work. EXPIRED completes kind 1 as nonpayable. Missing work pages and unreserved records must continue to permit progress. Bind the completion to the Need, work kind, winning message/terminal fact and worker; update producer manifests/consumers atomically. Validate actual funded redemption separately. Self-submission may earn the single advertised reward; there must be no sequence of replacement payouts or caller-chosen refund recipient.

5. **State numbers are not the same as the abstract model.** Fable's model uses EXPIRED=3. Current Timepin and Core use AMBIGUOUS=3, EXPIRED=4. Keeping an unreachable defensive AMBIGUOUS branch requires retaining the existing value 4 for expiry, or an explicit versioned migration of every consumer. Do not copy abstract state numbers into byte vectors silently.

## Time windows and game behavior

- Use absolute submission interval `[T,D)` and finalization at `now >= D`. No challenge or late first capture may extend D. Require the source publication window to fit the capture/challenge window, and mirror exact deadline derivation in Timepin, Core and clients. The existing spec uses `capture_grace_seconds`; adding a separate challenge field changes canonical hashes/ABI unless encoded through a documented existing-field relation.
- `seal_observed` accepts only a FINAL entry and checks `age = now - publish_time`. With D=T+900 and a print at T+2, its earliest age is about 898 seconds, not 300. For a candidate at T it is 900 seconds plus finalizer/client delay. Raising the age limit makes the entry reference older; it does not preserve existing gameplay by itself. Observed exit time is aligned from **seal time plus horizon**, not entry time. Removing observed mode remains a scope proposal, not approval inferred from this review.
- Forward entry selection can remain open after a short-horizon exit price becomes observable (A3). Review the combined entry/exit payoff, not only isolated Need ordering. Current `activate_entry` authenticates the final entry and does not require activation before the exit target.
- Reveal deadline is derived from exit capture deadline plus reveal window. A longer reveal window reduces a late-crank failure probability but cannot prove liveness. Test activation, settlement and reveal at exact boundary times, including late permissionless settlement and the existing forfeit behavior.
- Sampled 5-second cadences and observed lag extrema are observations, not permanent SLA bounds. `publish-prev=1` on a sample does not prove there cannot be other unseen same-second messages. Do not label the tie-break a fair coin.

## Rent and the minimum implementation boundary

Actual read-only mainnet rent query at 03:18:46Z (genesis checked) returned 1,564,251 lamports for a 119-byte candidate and 1,646,580 for a 132-byte Need: **3,210,831 lamports retained per unique Need plus one candidate**, before other accounts and transaction fees. A proposed 151-byte candidate returns 1,766,907 lamports, making that pair 3,413,487 lamports. `TIMEPIN_RENT_OBSERVATION.json` contains raw response hashes.

Need sharing amortizes these accounts across shots with the same feed/spec/target. Open only demanded targets; blanket creation of every minute on all seven feeds would be 10,080 pairs/day, approximately 32.365 SOL/day retained at current queried rates, even before Core state. This is an illustrative capacity bound, not current traffic, spending, or a proposed purchase. Permanent winners cannot be budgeted as refunded until a safe reclamation/archive design exists.

If an optimistic rule is ultimately chosen, the smallest coherent implementation includes predicate and ordering, authenticated reward attribution, consumer/ABI synchronization, explicit persistent-evidence costs and a funded optional worker path. The current draft's single-predicate edit and already-closeable-candidate assumptions are insufficient. Source changes stay with Sol after the shared gate; this review applies no patch.

## Honest verdict

**Verified:** exact model reproduction, four executable counterexamples, current source layouts and receipt behavior, exact candidate consumption by Core, current mainnet rent values and release-guard integration (separate ACK).

**Concluded:** the proposed model provides ordering among submitted evidence but does not remove selective-disclosure payoffs; deferred rewards and rent reclamation require changes beyond the described predicate; closing winners at terminal would break current settlement.

**Not verified:** actual private-message exploit on mainnet, SBF implementation, receiver replay, deployed Wormhole quorum, 24-hour availability, final economy parameters, funded Work Market redemption, or mainnet readiness. No signing, transactions, source edits or deployment were performed.
