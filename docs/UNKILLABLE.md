# The Unkillable Roadmap

RatchetX's endgame is a prediction market arcade that nobody — including us — can
change, stop, censor, or quietly rug. Not as a slogan: as a sequence of properties,
each one **checkable the day we claim it**, most of them checkable on
[the proof page](https://ratchetx.xyz/api/proof) already.

> **Status correction, 2026-09-03:** dates and completed rings below are
> historical, not current execution authority. No freeze is scheduled. Core v1
> remains an upgradeable devnet prototype with known evidence gaps; follow
> `PERMANENCE_EXECUTION_PLAN.md` for the active chain-first roadmap.

This document is the map. Like [the freeze](FREEZE.md), it is registered in the
repo before the fact, so you can hold us to it.

---

## The five rings

Each ring removes one way to kill the product. Inner rings are done or dated;
outer rings are directional and land after the current sprint.

### Ring 0 — Nothing to steal, nothing to change *(now → September 8, 2026)*

| Property | How to check |
|---|---|
| No private key exists anywhere in the system — the backend cannot custody or move player funds even if fully compromised | read the code; the proof page re-verifies the no-treasury claims |
| 70% burn / 30% players / 0% team, frozen | burn address + splits verified on-chain, per transaction |
| Hash-chained public event log, anchorable to Solana by anyone with one [Blink](https://ratchetx.xyz/anchor) | replay the chain from [/api/snapshot](https://ratchetx.xyz/api/snapshot) |
| Open source, and the on-chain program byte-verified against this repo | verified build published before the freeze |
| **September 8, 2026: the seal program's upgrade authority is revoked — the program becomes immutable, forever** | the revoke transaction, on the explorer, on the date we registered in [FREEZE.md](FREEZE.md) |

After Ring 0 closes, "trust us" is no longer part of the seal program's threat
model. Nobody can change it. Including us.

### Ring 1 — The game settles without us *(v3: devnet this sprint, mainnet after soak)*

The v3 program takes the full shot lifecycle on-chain: **seal → checkpoint →
settle → reveal → void → close**, with settlement reading the Pyth print
directly ([SETTLEMENT.md](SETTLEMENT.md) documents the exact, Pyth-confirmed
mechanism) and **permissionless cranks** — anyone can settle anyone's expired
shot, and settling early or late produces the same number. Not settling produces
a refund, which is the honest shape of the guarantee: nobody can choose your exit
price, and nobody can be made to crank.

You do not have to wait for v3 to hold us to the principle: settlement is
already lazy and permissionless at the API layer, and
[`tools/crank.mjs`](../tools/crank.mjs) is a zero-dependency crank **anyone can
run today**. If our cron dies, you are the cron.

*Claim when it lands: kill our servers, and every sealed shot still settles or
refunds — on a price nobody in the world got to choose.* The "or refunds" is not
a hedge added to be safe; it is the part that is actually guaranteed. Settlement
needs somebody to send a transaction, and the design's answer is that anybody
may, including the player, rather than a promise that somebody will.

### Ring 2 — The economics live in bytecode *(after v3 mainnet)*

The 70/30/0 split, the burn, and the credit ledger move from API code into the
program itself: stakes in program PDAs, the burn as an instruction, receipts as
compressed NFTs in the player's own wallet. What is enforced by the chain does
not depend on our honesty; what is in your wallet does not depend on our
database.

*Claim when it lands: the split is a property of the program, not a promise of
the operator.*

### Ring 3 — The frontend and access are unkillable

The site is a single self-contained page by design. This ring pins snapshots of
it to permanent storage (Arweave/IPFS) with a mirror address, and documents in
[SELF_HOST.md](SELF_HOST.md) how anyone can run the frontend, the API layer,
and the crank themselves. Third-party frontends over the same program are
welcome — the API is documented, the state is public, and nothing about the
game requires our domain to exist.

*Claim: kill ratchetx.xyz and the game is inconvenienced, not dead.*

### Ring 4 — The operator is optional

The endgame ring. No team tokens existed on day one; creator trading fees are
the only team economics, and the plan is to route them transparently into the
players' prize flow. Board parameters move under player governance. And we
prove the whole stack the honest way: a public **Chaos Day** on devnet — we
switch off every server we run, for an hour, announced in advance, and publish
what kept working. The parts that survive are the product. The parts that
don't are the remaining roadmap.

*Claim: we are optional, and we can prove it on camera.*

---

## Why bother

Every prediction market asks for trust somewhere: a custodian, a resolution
committee, an admin key, terms of service. The category's answer to "what if
the operator goes bad?" is a lawyer. Ours is a bytecode freeze, an oracle, a
public log, and a crank you can run yourself.

We would rather be checked than believed. That is the whole product.

*Questions, holes, attack ideas: open an issue. Finding a way to kill the
unkillable is a contribution.*

---

## Two things this ring already cost us

**The gap at entry 345.** Our own verifier reported the event log broken. One
entry was issued before the atomic-append fix and never stored, and its hash is
unrecoverable. We could have rebuilt it — it would have hashed correctly and
the page would have gone green. We did not, and we published why:
[CHAIN_GAP.md](CHAIN_GAP.md). The Black Box check is no longer green because
of it.

**The Coinflip Ledger.** We score ourselves next to Kalshi and Polymarket on
the questions that were actually in doubt, under the same oracle rule, with
our own row allowed to lose: [LEDGER.md](LEDGER.md). The board advances on the
public crank, so it keeps grading us whether or not we run it.

A roadmap that only ever produces good news is a brochure.
