# Play and settle RatchetX without us

> **Prototype scope, corrected 2026-09-03.** Core v1 is devnet-only, upgradeable
> and not the live credit ledger. Its old ring is not sufficient final evidence.
> Use the signerless chain inspector for present facts and
> `PERMANENCE_EXECUTION_PLAN.md` for the successor acceptance gates.

Written for someone who has no relationship with the people who built this and
would rather verify than trust. Everything below runs against the chain with your
own keys and your own RPC. There is no account to make, no key to request, and no
permission to be granted. If any step here requires something from us, that is a
bug in the claim and we want to hear about it.

## What you need

1. **The program id** — public, below.
2. **Any Solana RPC** — ours is irrelevant; use your own or a public one.
3. **Your own keypair, with a little SOL** — for fees and rent.

That is the whole list. No API key, no allowlist, no IDL file from us. The client
derives Anchor's discriminators locally with sha256, so the open source plus the
program id is sufficient.

## What is live, and where

| | program id | state |
| --- | --- | --- |
| devnet | `CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx` | live — everything below works today |
| mainnet | `6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv` | **not deployed yet** |

Core v1 is not on mainnet at the time of writing. Said plainly so nobody reads a
promise as a fact. The commands are identical once it is.

## Settle somebody else's shot

The program does not care who cranks it. `Checkpoint`, `Settle`, `VoidShot`,
`Forfeit` and `CloseShot` each take an **unconstrained signer** — no `has_one`,
no key comparison, no allowlist. You are indistinguishable from us.

```
git clone https://github.com/3esign/ratchetx
cd ratchetx/onchain/ratchet-core-devnet
node crank.mjs --rpc https://api.devnet.solana.com --keypair ~/id.json --once
```

It finds work with `getProgramAccounts` — scanning the program's own accounts —
not by asking any server. Add `--dry` to watch it plan without sending anything,
`--interval 5` to keep it running, `--close` to also return finished-shot rent.

Cost: transaction fees, plus about **0.015 SOL once per feed** for the clock
account's rent. You get nothing for it beyond the game continuing to work, which
is the point.

Run several from different machines if you like. Duplicates are safe by
construction: a second checkpoint of the same update is a no-op, and a second
settle fails on state for the cost of one fee. No coordination required — which is what
permissionlessness means. It is not the same as liveness: nothing here makes a
cranker exist. What it does is make the set of people allowed to be one include
everybody, and put the person with the most to lose inside it.

## Play a shot yourself

```
node shooter.mjs --rpc https://api.devnet.solana.com --keypair ~/id.json
```

Sealing commits to a hidden side: the chain stores `sha256` over your wallet, the
shot nonce, your side, your stated probability and a **salt**. Only the salt
holder can reveal — a cranker cannot reveal for you, and neither can we.

**Keep your salt.** An unrevealed but settled shot is forfeited once the reveal
deadline (1 hour) passes. The sample player writes salts to a local JSON file;
lose that file and those shots cannot be revealed. A sturdier approach derives
the salt deterministically from a wallet signature (see
`onchain/ratchet-core/client/salt.mjs`), so it is reproducible on any machine
from the wallet alone and never has to be stored at all.

## What cannot go wrong, and the one thing that can

- **Nobody cranks your shot.** After 120 seconds past expiry, `settle` refuses
  and anyone — including you — may call `void_shot`. That is a refund. Neglect by
  every cranker on earth costs you the outcome, never the stake. **This is the
  one thing that can go wrong**, and it is worth being blunt about: against a
  position that was going to win, a refund is a loss. Nobody can pick a price
  that beats you; somebody can decline to record the price that did. The answer
  is not a promise that they won't — it is that recording is permissionless,
  costs one cheap transaction, and you are allowed to do it yourself.
- **A crossing that is recorded and then buried.** Ruleset 2's `bind_crossing`
  copies the crossing out of the 64-slot ring and into the shot, permissionlessly
  and idempotently. Before it, a party who could influence checkpoint volume
  could push a valid crossing out of the ring inside the decision window and
  force the refund at will. After binding, the ring can be flooded to capacity
  and the outcome does not move — there is a LiteSVM test that does exactly that.
- **A hostile cranker.** `settle` does not accept a price. It reads the first
  crossing already recorded in the on-chain clock ring, and `checkpoint` only
  accepts a Pyth print that is fully verified, correctly owned, inside the
  confidence bound and strictly newer. A cranker can tell the truth or stay
  silent. It cannot manufacture, back-date or cherry-pick your settling price.
- **Rent.** `close_shot` is open to anyone and always returns rent to the player,
  never to whoever cleaned up.

## Verify the claims rather than believing them

- **Bytes match the source** — once deployed, the verified build binds the
  program address to a public commit. Check it on any explorer.
- **The rules cannot change** — read the program's upgrade authority. It should
  be none.
- **The token cannot be inflated or frozen** — read the RCX mint
  (`FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`). Mint authority and freeze
  authority are both already revoked; supply only falls.
- **Settlement really is open** — do the thing above. Settle a real shot with
  your keypair and your RPC. That single transaction falsifies or confirms the
  entire claim.

## What stops working if we disappear

Honest, because the difference matters.

**Stops:** the website and its API, the durable off-chain record, the curated
board of targets, the leaderboards, the Observatory, and our runner.

**Keeps working:** the program and all chain state; sealing and revealing through
the open client; settling, voiding, forfeiting and closing by anyone; refunds
past the deadline; and RCX itself, fixed in supply and unfreezable.

You would lose the venue, not the machine. Without our curated board you pick a
feed and an expiry yourself. There is no front end and no leaderboard. But every
stake resolves or refunds, and none of it needs our permission — which is the
only promise here worth making.
