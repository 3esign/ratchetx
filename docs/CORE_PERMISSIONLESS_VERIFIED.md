# Core v1: permissionless settlement, verified at the source (2026-09-02)

Source read of `onchain/ratchet-core/programs/ratchet-core/src/lib.rs` (the
crypto-only candidate on `main`). This is an audit of *who may act*. It is not a
fresh mainnet audit.

## 1. There is no operator in the program

No admin, no config account, no pause, no governance, no authority field on any
program account. The file says so at the top — "No admin, no upgrade path by
design, no config account" — and the source agrees: the only `authority`
occurrences are the SPL-token CPI authority (the player signing for their own
token account) and Pyth's own `write_authority` inside the price account. There
is nothing for a founder to hold.

## 2. Anyone may crank

`Checkpoint`, `Settle`, `VoidShot`, `Forfeit` and `CloseShot` each take
`cranker: Signer<'info>` with **no constraint** — no `has_one`, no key
comparison, no allowlist. Any wallet may call them. The cranker pays the
transaction fee and the account rent, and receives no privilege for it.

## 3. The cranker cannot choose the outcome

`settle` does not accept a price. It reads `feed_clock.crossing(shot.expiry_ts)`
— the first crossing already recorded in the on-chain clock ring. `checkpoint`
accepts only a validated Pyth print (owner, feed id, Full verification,
confidence, `prev_publish_time < publish_time`) and advances the ring only when
`publish_time` is newer. A hostile cranker can contribute a true observation or
do nothing; it cannot manufacture, delay-select or back-date the settling price.

## 4. A stake cannot be trapped

If nobody settles inside `SETTLE_DEADLINE_SECS` (120s), `settle` refuses with
`SettlementDeadlinePassed`, and **anyone** may then call `void_shot`, which
records `VoidReason::Deadline` and closes the position as `Outcome::Void` — a
refund. Neglect by every cranker, the founder included, costs the player the
outcome but never the stake. `close_shot` is likewise open to anyone, and rent
always returns to the player.

## 5. The one thing that is not yet true

The program is immutable **by design**; it is not yet immutable **in fact**.
On-chain trustlessness requires the BPF **upgrade authority to be revoked** (set
to none) at or after deploy. Until then the rules above can be replaced by a new
deploy, and everything on this page is a statement of intent rather than a
property of the chain.

**This is the last founder dependence.** It is a deploy-time action, Semir's
alone, and it is what converts "permissionless by design" into "permissionless
in fact".

## What this earns, once the authority is revoked

A program that is admin-less, config-less, permissionlessly crankable,
non-trapping and immutable is a claim very few Solana projects make and fewer
prove. Publish it verifiably, never as an assertion:

- a reproducible build, so anyone confirms deployed bytes == source == `1ba43717…`;
- the revoked upgrade authority, readable on-chain by anyone;
- a stranger-runnable crank, so someone with no relationship to us settles a real
  shot with their own RPC and keypair; and
- replayable settlement evidence in the Observatory.
