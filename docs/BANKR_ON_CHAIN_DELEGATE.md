# Bankr does not need a session server. The program already is one.

**2026-09-06, lead.** Semir asked me to take the Bankr piece. I went looking for
how much work it would be to point the agent path at G2 instead of the legacy
server, expecting the biggest unestimated item on the board. It is the opposite:
**the thing Phase B of `BANKR_SELF_SERVICE_INTEGRATION.md` proposes to build is
already deployed on chain, and nobody connected the two.**

---

## 1. What the August design proposed

`BANKR_SELF_SERVICE_INTEGRATION.md`, Phase B, step 2:

> User signs one versioned session grant, explicitly binding Ratchet domain,
> Solana mainnet, owner wallet, session/challenge ID, expiry, permitted actions…

A signed token, held by our server, checked by our code on every request
(`lib/play_session.js`, `lib/play_session_game.js`, `api/session_play.js` — 620
lines of authorization). The bounds live in our store. The enforcement is our
promise.

## 2. What is actually deployed

`grant_delegate`, in the Core program, live on devnet since 00:12Z:

```rust
pub fn grant_delegate(
    ctx: Context<GrantDelegate>,
    grant_id: [u8; 16],
    max_stake: u64,
    max_gross_stake: u64,
    max_shots: u16,
    min_interval_seconds: u32,
    expires_at_ts: i64,
) -> Result<()>
```

and the account it writes:

```rust
pub struct DelegateGrant {
    grant_id, economy_hash, ruleset_hash, player, delegate,
    max_stake, max_gross_stake, max_shots, min_interval_seconds, expires_at_ts,
    gross_stake_used, shots_used, last_seal_ts, revoked,
}
```

Per-shot cap, total cap, shot count, a minimum interval between shots, an expiry,
a used-counter for each, and a revoked flag. **That is the bounded session grant,
field for field, enforced by the program instead of by us.**

The signers settle the rest. `grant_delegate` is signed by the **player** —
once. `seal_forward_delegated` is signed by the **delegate**, and the player does
not sign at all. `reveal_delegated` finishes the game the same way.
`revoke_delegate` ends it, from the player's wallet, without asking us.

## 3. What this changes

| | the August plan | what the chain already does |
|---|---|---|
| where the grant lives | our store | a PDA |
| who enforces the caps | our code | the program |
| what a player trusts | our promise | the bytes they signed |
| how it is revoked | an API call to us | a transaction, from their wallet |
| which chain it binds | a text field saying "mainnet" | the cluster it exists on |

That last row deletes a problem I raised an hour ago. The August grant text
hard-codes *Solana mainnet*, which after tonight's devnet decision would have a
player signing authorization for a chain we are not playing on. **An on-chain
grant has no such field to get wrong: it is an account on a cluster, and a devnet
grant cannot be replayed on mainnet because the account is not there.**

And the legacy server leaves the agent path entirely. That matters beyond
tidiness: a Bankr shot landing on `api/game` would demonstrate an agent playing a
game that **is not the one we deployed**.

## 4. The path, end to end

1. **Semir signs one transaction** — `grant_delegate`, from his own wallet, naming
   Bankr's wallet as delegate, with the caps he chooses. This is the only human
   step, and it is his and nobody else's.
2. **Bankr seals** — `seal_forward_delegated`, signed by Bankr's wallet. The
   program checks the grant, the caps and the interval, and refuses on its own.
3. **The crank settles** — unchanged; settlement is permissionless.
4. **Reveal** — `reveal_delegated`, so the agent can finish what it started.
5. **He revokes whenever he likes** — `revoke_delegate`, from his wallet.

The Shot account records `delegate` as a field, so every shot an agent took says
so on chain, forever, without our labelling it.

## 5. What is still unknown, stated as unknown

**Whether Bankr can sign an arbitrary Solana instruction.** Everything above
requires Bankr's runtime to sign a transaction we construct. If it can only make
HTTP calls, then the delegate is not Bankr itself but a small signer we run on
its behalf — which is weaker, and would need saying out loud rather than hiding
in an integration. `BANKR_SELF_SERVICE_INTEGRATION.md:79` gestures at this
("if a native Solana message method exists"), and it was never answered.

**GeminiForge owns that question.** It is one answer, not a workstream, and it
decides whether §4 is the plan or whether we need a bridge. Nothing else in this
document depends on anything unmeasured: the instructions exist, the accounts
exist, the program is deployed, and the delegated path has been in the client's
instruction list all along.

## 6. What nobody should do next

Do not extend `lib/play_session.js` to speak G2. Six hundred and twenty lines of
server-side authorization exist to do what one PDA now does better, and adding a
chain to them makes two enforcement points that can disagree — which is the same
shape as a server record standing next to a chain record and being called
verified.

The legacy session path keeps working for the legacy game for as long as that
runs. It is not the road to the agent surface.
