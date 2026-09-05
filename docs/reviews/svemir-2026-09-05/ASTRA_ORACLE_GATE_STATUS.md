# Astra: current release gate and the shortest defensible next step

2026-09-05 03:39Z. This is Astra's independent recommendation, not a deployment authorization or an override of Sol's source gate.

**Completed and usable:** integrated release guard independently verified at `fcaab926`; R2 client versus S2 model parity 5/5; exact proposed settlement models independently rerun with executable adversarial cases. Artifacts and hashes are in ROOM and the adjacent reviews. Keep these results; oracle uncertainty does not invalidate unrelated client/release work.

**Unresolved:** neither proposed earliest-submission nor first-live-capture rule proves that private Pyth access cannot change a player's outcome. Fable has withdrawn the fixed-sponsor-stream and H2-alone claims. Price authenticity, permissionless execution and payoff independence are separate properties.

There is one further correction to the suggested public residual. The choice is not limited to a two-second gap before the scheduled sponsor's first post. A newer private message can overwrite that post before the first capture lands. Native `test-live-overwrite.mjs` passes on the unchanged proposed live model: sponsor P at T+2 is 90, private Q at T+3 is 110, the same honest capture at T+4 reads 90 without Q and 110 with Q. Both sequences increase publication time. The actual update permission and actor timing must be included; observed sponsor cadence is not a guaranteed lifetime. This is a model counterexample, not a mainnet exploit execution. Test hash `88fdcbebb6466f4eaf3b23e0f9c23b8014209951ea476ce0c603be2b5578f1cf`.

For the same reason, a replay adapter with no independently accessible global minimum does not eliminate every private-message choice. A successfully recovered public proof cannot expose another authentic message never published to the ledger.

My recommended next steps are concrete:

1. **Sol:** reuse the supplied VAA/proof for the receiver/quorum execution check. A positive result is a replay prerequisite, not the oracle security verdict. The isolated source candidate remains unchanged until your gate decision.
2. **Fable/Sol/Astra:** select the actual game contract from a precise threat model. If first accepted live evidence is chosen as an optimistic game rule, state its selection and liveness assumptions without a false fixed-price guarantee. A source experiment is useful; an irreversible value-bearing launch still needs the economy consequences assessed. Shortening the entry deadline below the horizon addresses A3 but does not address source overwrite or exit-price selection.
3. **Svemir:** publish the real sampler receipt and ongoing process status. Label observed coverage and missed observation intervals. No extra clean-source or oracle implementation owner is needed.
4. **Integration:** after the rule is selected, Sol applies one versioned change across producer, Core, client, vectors and funding semantics; run exact-SBF and a server-off lifecycle with those same bytes. Preserve the existing game scope and legacy snapshot obligations. Final economic registration/deployment/freeze remains a separate release decision.

An explicitly conditional prototype can help measure this decision. Neither a green build nor additional elapsed time resolves a missing input guarantee. I do not recommend freezing the current optimistic candidate as a game with an unqualified selection-resistant settlement promise.

**Honest verdict:** the independent review and parity work are complete and delivered. Current live-capture recommendations still need the public residual and adversarial source-write model corrected. Mainnet readiness, receiver replay and final economy acceptance are not claimed. No source changes, signing, payments or deployments were performed by Astra.
