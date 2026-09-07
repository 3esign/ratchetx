# RatchetX Trustless Now: Next Print

Status: implementation contract for the smallest server-free game generation.

## Product

The first trustless market is not described as a five-minute market. It asks one
precise question:

> Is the next fully verified Pyth print higher or lower than the print at entry?

Entry and exit are authenticated Pyth PriceUpdateV2 facts read from Solana. The
Shot account stores the complete entry fact. Any caller may submit the exit, but
the program accepts it only when:

    exit.prev_publish_time == entry.publish_time
    exit.publish_time > entry.publish_time

This removes the operator's ability to choose a later favorable price. If the
direct successor is missed and the current account has already advanced beyond
it, the result is VOID. If Pyth revises the entry timestamp with different
bytes, the result is VOID. If no successor arrives before the ruleset deadline,
any caller may VOID. These are deterministic terminal states.

## Why this can ship before Timepin

- no Ratchet server, database, cadence worker, archive, API key, or historical
  RPC method determines the outcome;
- the mutable Pyth push account is sufficient while its direct successor is
  current;
- every player or third party can run the same tiny watcher;
- missed work cannot create a selected price: it creates a refund;
- token and tracker feeds use the same proof. An xStock tracker is playable
  only while its pinned Pyth-owned account passes the entry-freshness rule; it
  must not be described as officially sponsored unless Pyth lists it there.

The trade-off is explicit: this is a next-print game, not a timed game. Timed
5m/10m/870s markets still require Timepin v2 to retain the unique source
crossing. Next Print is the honest immediate product while that rail is built.

## Permanent rules

The on-chain program must pin the Pyth Receiver program, Pyth Push Oracle
program, feed allowlist, source-PDA derivation, account length/discriminator,
Full verification level, maximum confidence, entry freshness, future skew,
maximum wait and exact integer outcome math. Ruleset identity is stored on each
Shot.

Core consumes a versioned Evidence Adapter ABI; it is not permanently coupled
to one vendor layout. The first adapter is `PYTH_PUSH_V1` and pins the official
program identities. Every Shot stores its exact adapter id and ruleset hash.
Changing an adapter, adding a second oracle, or accepting a new Pyth format
creates a new opt-in ruleset and cannot reinterpret an open Shot. If a pinned
adapter stops working, new entry fails freshness/authentication and old Shots
reach their already-pinned VOID path.

For equities, some external oracle trust is unavoidable because the underlying
price does not originate on Solana. The trustless claim is therefore precise:
Ratchet's operator cannot choose or rewrite the oracle fact or payout. A later
multi-oracle ruleset may require a deterministic quorum and VOID on
disagreement, but it must pin that policy before entry; there is no
after-the-result fallback choice.

The program must never:

- accept any later print when the direct successor was missed;
- let timeout or a bounty failure replace a valid captured result;
- depend on a founder signer for capture, settle, VOID, refund or close;
- call an HTTP API or trust an indexer's claimed price;
- label a stock market open when its entry print is stale.

## Launch gate

1. Pure model and adversarial vectors pass.
2. Separate Rust program and LiteSVM transactions reproduce the vectors.
3. Real devnet SOL capture uses the official sponsored account with Ratchet
   services off. Stock feeds absent from devnet must not be impersonated.
4. A public mainnet stock account snapshot passes owner/PDA/layout/freshness
   checks through the exact SBF binary in LiteSVM.
5. Opt-in mainnet beta launches under a new program id with upgrade authority
   retained and clearly labelled.
6. Independent runner and static client are published before any freeze.

This is immediately implementable, but not literally free or self-waking:
transactions still need a caller and SOL fees. Integrity is permissionless;
liveness is supplied by players or replaceable public runners.

## Devnet status -- 2026-09-04

The candidate is deployed under
`5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4`. A real official SOL entry
reached `OPEN -> VOID_TIMEOUT -> CLOSED`: no successor arrived inside the
pinned window, so the program refused to invent an outcome and a permissionless
caller closed the Shot rent. The captured happy path remains to be demonstrated
live; it is already covered transactionally in LiteSVM.
