# Core v1: permissionless settlement, verified at the source (2026-09-02)

> **Superseded finding (2026-09-02), and where it stands now (2026-09-03).**
> Open instruction access is real. The conclusion that a cranker cannot
> delay-select or force a VOID was not: the source-predecessor bug and the
> evicting 64-entry ring both invalidated it, and RCX's real Token-2022 path was
> not the positive control in the old LiteSVM run.
>
> All three have since been fixed — the signed predecessor is stored, ruleset 2
> adds permissionless `bind_crossing` so a recorded crossing cannot be buried,
> and Token-2022 is the positive control with a classic-SPL negative one. **One
> part of the old claim is still wrong and is not being repaired**, because it
> is not a bug: a cranker who simply does nothing still turns a settlement into
> a refund. That is a liveness assumption, not an attack the program can
> forbid, and it is stated as an assumption throughout — see
> `SETTLEMENT.md`. Do not quote a "cannot choose the outcome" line from this
> page without it.

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

## 3. The cranker cannot choose the settling price. It can choose not to act.

`settle` does not accept a price. It reads `feed_clock.crossing(shot.expiry_ts)`
— the first crossing already recorded in the on-chain clock ring. `checkpoint`
accepts only a validated Pyth print (owner, feed id, Full verification,
confidence, `prev_publish_time < publish_time`) and advances the ring only when
`publish_time` is newer. A hostile cranker can contribute a true observation or
do nothing; it cannot manufacture, delay-select or back-date the settling price.

Doing nothing is not neutral, and this section used to imply it was. A shot
whose crossing nobody records inside the window voids and refunds, and against a
position that was going to win, a refund is a loss. So the accurate statement is
narrower than the old heading: **nobody can make you lose on a price they
picked; somebody can decline to record the price that beat them.**

Ruleset 2 removed the version of this that was an attack rather than an
absence. `bind_crossing` is permissionless, idempotent, and costs one cheap
transaction; once a crossing is bound into the shot, flooding the ring past
capacity does not move the outcome (there is a LiteSVM test that floods it and
proves the answer does not move, alongside an unbound control on identical facts
that cannot settle at all). What remains is the seconds between a crossing
appearing and anybody binding it — and the party with the most to lose is
allowed to bind it themselves.

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

---

## 6. Stranger-runnable in practice, not only in principle (verified 2026-09-02)

Program-level permission (§2) is worth nothing if, in practice, only we can find
the work. Verified in **both** runners — `onchain/ratchet-core/client/{crank,core}.mjs`
(mainnet) and `onchain/ratchet-core-devnet/{crank,core}.mjs` (devnet):

- **The only inputs are an RPC and a keypair.** Each runner reads exactly two
  settings: `RATCHET_RPC` (any endpoint) and `RATCHET_CRANK_KEYPAIR` (the
  cranker's own key). Grepping both pairs of files for `ratchetx.xyz`, `/api/`,
  `API_KEY`, `SUPABASE` and `Bearer` returns nothing. There is no founder
  endpoint, token or database anywhere in the settlement path.
- **Work is discovered from the chain.** `readShots()` is
  `getProgramAccounts(PROGRAM_ID, { filters: [dataSize, memcmp(discriminator)] })`.
  Open shots are found by scanning the program's own accounts — no index, no
  server, no list handed down by us.
- **No IDL is required.** Account and instruction discriminators are derived
  locally with sha256 from their names, exactly as Anchor derives them. A
  stranger needs the program id and the open source; they need no file from us.
- **Duplicate runners are safe.** Per the runner's own contract: a second
  checkpoint of the same update is a no-op, and a second settle fails on state
  for the cost of one fee. Any number of unrelated crankers may race with zero
  coordination — which is what liveness without an operator would need, and is
  not by itself enough to produce it. Permissionlessness widens the set of
  parties who MAY crank to everybody; it does not make one exist.
- **The runner cannot act as a player.** It never holds a player's key and
  cannot reveal; only the salt holder can. A hostile cranker gains nothing.
- **Cost of being a cranker:** transaction fees plus roughly 0.015 SOL once per
  feed for clock rent.

**Result: a stranger holding only the program id, any RPC and a funded keypair
can discover, plan and execute every action the program permits — checkpoint,
settle, void, forfeit, close. The program cannot distinguish them from us.**

Gate status: **stranger-runnable settlement VERIFIED at the client level.**
The remaining founder dependence is unchanged and singular: §5, the upgrade
authority.

## The demonstration this unlocks

"Settle it yourself." Publish the program id and the runner, and invite any
skeptic to settle a real shot with their own RPC and their own keypair, holding
nothing of ours. It is checkable in minutes and almost nobody on Solana can
offer it. That is the honest way to earn attention: not a claim about the token,
a claim about the machine — one a stranger can falsify.

---

## 7. Token layer: already finished (verified 2026-09-02)

Read back from our own chain-reading supply endpoint, which sources the mint
account, the incinerator account and signatures:

- **Mint authority: revoked.** Nobody, us included, can ever mint another RCX.
  Supply is fixed at launch and can only fall.
- **Freeze authority: revoked.** Nobody can freeze or seize a holder's tokens.
  There is no blacklist and no seizure path.
- Supply 936,699,884 of 1,000,000,000; 63,300,116 destroyed (6.33%), of which
  3,716,964 are player burns and the rest launchpad-side.

The token half of "forever independent" is therefore **complete**. What remains
is entirely on the program half.

## 8. The ceremony order — verification MUST precede revocation

A Solana **verified build** is the artifact that lets a stranger confirm the
deployed bytes are the open source at a named commit. It is recorded in a PDA
owned by the OtterSec verify program, and — this is the trap — **only the
program's upgrade authority may create or update that PDA.**

If the upgrade authority is revoked first, self-service verification becomes
impossible; the only remaining route is asking OtterSec to whitelist the program
by hand. That would add a third-party dependency at precisely the moment we are
removing every dependency. The order is therefore not a preference:

1. **Build deterministically** — `solana-verify build` (Docker), reproducing the
   frozen hash for the candidate being shipped.
2. **Deploy** the program.
3. **Verify and register** — `solana-verify verify-from-repo` against the public
   repo and commit, signed by the still-live upgrade authority. This writes the
   PDA binding program address ↔ git url ↔ commit hash.
4. **Only then revoke the upgrade authority**, making the program immutable in
   fact.

(Confirm exact CLI invocations against the tool's own docs at execution time;
the ordering constraint above is the part that cannot be undone.)

### What the finished position looks like

| layer | property | state |
| --- | --- | --- |
| token | mint authority revoked | done |
| token | freeze authority revoked | done |
| program | no admin / config / pause / governance | done |
| program | anyone may crank | done |
| program | cranker cannot choose the settling PRICE | done |
| program | cranker cannot bury a recorded crossing (ruleset 2 `bind_crossing`) | done |
| — | cranker can decline to act; the shot then refunds | standing liveness assumption, not closable by the program |
| program | stake cannot be trapped | done |
| client | stranger-runnable with only RPC + keypair | done |
| program | deployed and verified build registered | pending deploy |
| program | upgrade authority revoked | pending deploy |

Two boxes left, both in one ceremony, both Semir's alone — and they must happen
in that order.
