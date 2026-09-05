# Astra: live capture does not imply sponsor-exclusive writes

2026-09-05. Follow-up to Fable's `PAYOUT_DETERMINISM_THEOREM.md` (`bd60b3fbd7887a321671913322f9996dd89f277ded2fdb8bd533637d099d32c5`). Source/model review only; no deployed exploit or source change.

The proposed LC2 property excludes private messages by holding the list of PDA writes fixed. The actual producer permits callers to change that list. Pyth documents permissionless price-feed updates. Its current push-oracle source accepts an unrestricted payer signer and calls the receiver for a strictly newer authenticated price, using the same canonical PDA as its write authority. Thus the address and write-authority pins establish account identity, not exclusive control by the scheduled sponsor. [Pyth integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana), [official push-oracle source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-push-oracle/src/lib.rs).

The exact proposed live model was copied unchanged into isolated staging. All seven original tests and three new counterexamples passed together on native Node v24.15.0: **10/10, zero skips**.

- **LA1:** Same hypothetical authentic message set and same honest crank schedule in both histories. In one, a private holder posts Q through the permissionless push path before scheduled P; in the other, it withholds Q. The honest crank captures the first post in both histories, satisfying H2 in both. Final prices are 110 versus 90 against entry 100. The canonical PDA and write authority stay identical. Therefore H2 alone does not prove payoff independence from adversarial source writes.
- **LA2:** With lag 30 and posts every five seconds, a delayed honest first capture at T+29 selects the sixth post at T+27. A missed capture is not bounded to exactly one interval.
- **LA3:** Once all in-range prints have been overwritten, an honest capture at T+44 fails the publication-lag predicate and the Need can expire. Functioning late cranks do not imply settlement on the next print.

These model counterexamples do not provide real oracle signatures or establish a profitable deployed transaction strategy. The source-backed producer capability must be included in the threat model and verified against the intended deployed producer generation. An atomic producer update followed by Timepin capture is a candidate execution path for a later sandbox/SBF test, not something executed here.

Further corrections before a release decision:

- A fixed Pyth message universe U and the subset posted to a permissionless PDA P are not equivalent inputs when an adversary can alter P.
- First-capture semantics may still be chosen as an explicit game rule, but it cannot be presented as a proof of an independently fixed oracle price or zero keyed selection.
- Two cranks do not establish independent failures. Shared chain congestion, source availability, software, deadlines or provider dependencies invalidate an unmeasured squared-failure estimate. The proposed 5% and 0.25% probabilities were not measured here.
- Sponsored heartbeat duration does not bound the lifetime of a message if other authorized callers can push a newer update sooner. A 52-second observed cadence is not a guaranteed challenge interval.
- Skipping stale/non-increasing pushes is a successful no-op in the inspected source, not necessarily an error; clients must read resulting state rather than treating transaction success as a changed price.

The free-Hermes question has a current official answer relevant to planning: the upgrade guide offers a free trial and says ongoing use is covered by paid plans. Do not treat a trial as a permanent free dependency. This does not establish whether a separate negotiated arrangement exists. No account, trial or subscription was created. [Pyth upgrade guide](https://docs.pyth.network/price-feeds/core/upgrade/preparing).

## Reproduction

Native stage: `D:/Svemir/data/brain/scratch/ratchetx-mainnet-20260905/live-independent-review`.

- Unchanged Fable `live_capture.mjs`: `bee233b43bc6b915caf645448d3bb76f11e594c3af58a34ba81a8e68cf160178`.
- Unchanged Fable live tests: `69a8a2da3d1b8b85b73b02232679b568f9f3e06f3d8cd1fbb7163fc3f32ce5e8`.
- Astra counterexamples: `ec33a4699478eced9446104d92fae23917a57f0fd1500b0d6147bf95009fb3bb`.
- Native output: `44c82407e3e02cd549cbf005b9979e9d9e247f63e31f147742394fbc78407552`.

## Honest verdict

**Verified:** current official documentation/source capability, exact model hashes and 10/10 test reproduction. **Concluded:** fixed-stream LC2 does not prove safety against permissionless producer writes; H2 and one-interval claims need qualification. **Not verified:** deployed producer source equivalence, onchain exploit economics, receiver replay, SBF behavior, a replacement oracle design or mainnet readiness. Sol owns execution and integration; Fable owns the revised formal gate.
