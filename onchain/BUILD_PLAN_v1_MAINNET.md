# What's left, and the order to build it

Written 2026-08-20. Everything below is buildable now — none of it waits on the vault decision.

---

## 0 · Verified first: the Pyth constants are correct for mainnet

`ratchet_seal` hardcodes two program IDs. Both are confirmed against Pyth's own documentation,
and — importantly — **they are identical on mainnet-beta and devnet**:

| | address |
|---|---|
| Pyth Solana Receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |
| Pyth Price Feed / push oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |

Because the programs are the same, the price-feed PDA derivation is too: seeds
`[shard_u16_le, feed_id]` under the push oracle. So the SOL/USD account we already read
successfully on devnet — `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` — is the same address on
mainnet. The single biggest mainnet risk is therefore closed: the program does not need one line
changed to point at real prices.

---

## 1 · v1 of the program (`ratchet_seal_lib_v1.rs`, drafted)

Two changes, both of which should land *before* mainnet, because mainnet is expensive to redo.

### The cranker's last freedom is gone

v0 let whoever settled a shot choose any Pyth update inside a 60-second window after expiry.
Bounded — but a choice is an edge, and we said so publicly.

A `PriceUpdateV2` carries `prev_publish_time`. So an update satisfying

```
prev_publish_time < expiry <= publish_time
```

is provably **the first price published at or after the window closed**. Exactly one update in
existence satisfies it. There is nothing left to pick.

Settling strictly means posting the crossing update from Hermes rather than reading whatever the
sponsored account currently holds. Strict settlement is accepted only before the one-hour
deadline. After that deadline the shot is **voidable, never settleable**, so settle and void are
not two caller-selectable outcomes at the same time.

### Rent comes back

A `Shot` account is 165 bytes — about **0.00204 SOL** of rent. Without a way to reclaim it, every
shot mirrored on-chain would lock that forever, which makes step 3 economically silly.

`close_shot` reclaims it once a shot is Revealed **or Voided**. Anyone may call it; `has_one =
player` pins the refund to the wallet that paid, so a stranger cranking cleanup cannot redirect a
lamport. The earlier draft described a void path but did not implement it, permanently locking the
rent of every unresolvable shot; v1 now includes the instruction explicitly.

**Next action:** paste v1 into a fresh Playground project, Build, deploy to devnet, and re-run the
smoke test — plus a `close_shot` call at the end to prove the rent returns.

---

## 2 · Mainnet deploy

**Cost, honestly:** the program account holds ~1.93 SOL of rent — at SOL near $85 that is roughly
**$165, locked for as long as the program exists** (recoverable only by closing it, which retires
the address permanently). The deploy also needs another ~1.93 SOL *temporarily* for the upload
buffer, refunded when it lands. So: about 2 SOL of real mainnet SOL available, ~1.93 of it parked.

**Deploy with the Playground wallet, not Phantom.** On devnet a Phantom-signed deploy stranded
1.93 SOL in a buffer the terminal could not sign for. On mainnet that mistake costs real money.

**Then the authority question, which is a positioning decision as much as a technical one:**

- *Leave it upgradeable* — bugs stay fixable, but a key exists that can change how the program
  behaves. For a program holding no funds that is a correctness risk, not a theft risk.
- *Set the upgrade authority to `None`* — the program becomes immutable. Nobody, including you,
  can ever change it. The strongest claim available, and it costs nothing.

The move I'd make: deploy upgradeable, **publicly announce the date you will freeze it**, let it
soak and be reviewed until then, and freeze on schedule. Announcing a freeze and then executing it
on time is itself a verifiable act — which is the whole brand.

---

## 3 · Stage 3b — the live game starts using the program

This is what turns a deployed program into a *used* one, and it needs no key.

The game already writes `sha256("SIDE|salt")` into its log, in exactly the format the program
accepts. The player's browser already holds their side and salt. So:

1. A **MIRROR ON-CHAIN** button appears on a sealed shot.
2. The browser builds a `seal` instruction with the same commitment, feed, expiry, kind and
   threshold, and the player signs it. One transaction, their wallet, no server key.
3. The server reads the transaction, checks the on-chain commitment matches its own log entry, and
   awards XP — the same pattern as the existing log anchor.
4. After expiry, **anyone** can crank `settle`, and because the game publishes side and salt at
   settlement, **anyone** can also `reveal`. The game's own log becomes the reveal source for the
   program. The circle closes.
5. `close_shot` returns the rent, so the whole round trip costs the player transaction fees and
   nothing else.

The result is a continuous, public stream of transactions in which the game's private bookkeeping
and the chain's public record are the same object — and neither one needs us.

---

## Order, and why

1. **v1 program** — settlement rule and rent reclaim. Cheap to change now, expensive after mainnet.
2. **Devnet test** of v1, including `close_shot`.
3. **Mainnet deploy** — because Stage 3b is unusable if players must switch cluster.
4. **Stage 3b** in the client and server.
5. **The vault**, once the funding question has an answer that does not break the frozen split.

Steps 1–4 are days of work, not weeks, and every one of them produces something demonstrable.
