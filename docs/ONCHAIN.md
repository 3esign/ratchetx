# RatchetX on-chain — the settlement program, and what it proves

**Stage 3 of `RatchetX_ONCHAIN_PATH.md` is done.** The part of RatchetX that decides whether you
were right now exists as a Solana program: no custody, no admin key, no funds, no server.

**Program:** [`4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2`](https://explorer.solana.com/address/4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2?cluster=devnet) (Solana **devnet**)
**Source:** `onchain/ratchet_seal_lib.rs` — 288 lines, zero external crates.
**Reproduce it:** `onchain/smoketest_client.ts` runs the whole seal → settle → reveal cycle from
Solana Playground's client tab against your own wallet. It prints every signature it makes.

## The three instructions

| instruction | who can call it | what it does |
|---|---|---|
| `seal(nonce, commit, feed_id, expiry, kind, threshold)` | the player | stores `sha256("SIDE\|salt")` and an entry price read from Pyth. The side is **not** in the transaction. |
| `settle()` | **anyone** | fixes the exit price from a Pyth update published in `[expiry, expiry+60]`. Permissionless crank; the player need not be online. |
| `reveal(side, salt)` | anyone holding the salt | recomputes the hash, checks it against the stored commitment, scores hit/miss on-chain, bumps a `PlayerRecord` PDA. |

The commitment format is byte-identical to the one the live game has written into its
hash-chained log since h6 — `sha256("YES|salt")` / `sha256("NO|salt")` — so a seal made by the
game and a seal made by the program are the same object.

## The Pyth account is validated by hand, on purpose

The program does not hand the price account to a library and hope. It checks that the owner is
the Pyth receiver (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`) or the push oracle
(`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`), that the account discriminator is
`sha256("account:PriceUpdateV2")[..8]`, and that its verification level is `Full`. A partially
verified or lookalike account is refused. Prices older than 60 seconds are refused at seal.

## The live run — 2026-08-20, devnet

A YES shot on SOL/USD, `kind = direction`, 25-second expiry.

| step | transaction |
|---|---|
| seal | [`5XCSMdr3p6qB6m9zpypQ44t5mJkzFrbxA5gAw7vvoZuEbSs2xU4HCaPb6mSrVkonscDpAK1s5rqHRcdGfKTYMQ9i`](https://explorer.solana.com/tx/5XCSMdr3p6qB6m9zpypQ44t5mJkzFrbxA5gAw7vvoZuEbSs2xU4HCaPb6mSrVkonscDpAK1s5rqHRcdGfKTYMQ9i?cluster=devnet) |
| settle | [`rYK5kjNeZ7SzKbkKb4LwJxnrpXKR2aHHr6iZe4ngtq1bFBoTNTB7Fy3Ta5u3U3CiCXCvgPMjeZVC2MeK9MEXbFH`](https://explorer.solana.com/tx/rYK5kjNeZ7SzKbkKb4LwJxnrpXKR2aHHr6iZe4ngtq1bFBoTNTB7Fy3Ta5u3U3CiCXCvgPMjeZVC2MeK9MEXbFH?cluster=devnet) |
| reveal | [`4DF4iU4hvyjiRv8MiJqxfpCjgGQN9GUWgQNxpm1b7w5ANHtfrjNUokn5BpMXMJYU5bXjgtovp58VcM4MoEfXdJPg`](https://explorer.solana.com/tx/4DF4iU4hvyjiRv8MiJqxfpCjgGQN9GUWgQNxpm1b7w5ANHtfrjNUokn5BpMXMJYU5bXjgtovp58VcM4MoEfXdJPg?cluster=devnet) |

Shot account: [`FDTJCmjnWGTKMKX9YhEaWs5awAJyJueQBWJKz4aaPKvA`](https://explorer.solana.com/address/FDTJCmjnWGTKMKX9YhEaWs5awAJyJueQBWJKz4aaPKvA?cluster=devnet)
Commitment stored on chain: `ceacc2e371677631e363883e95e76ef881a53fd022759384a449dcc191fee043`

```
side          : YES
entry -> exit : $85.1593  ->  $85.0154
HIT           : no
record        : 0/1 hits
state         : 3 (Revealed)
```

The price fell, the YES shot lost, and the program wrote `hit: 0` against the wallet that
deployed it. That is the entire point: a judge that does not know or care who you are.

One detail worth keeping: the crank refused to settle for a full minute, because devnet's Pyth
feed publishes in bursts every ~15–20 seconds and was running behind the chain clock. The
program would not take a price stamped before expiry. Nobody was supervising it.

## Honest limits of this version

- **Devnet.** This is research. The live game still settles on our server; the proof page is
  there because of that, not in spite of it.
- The exit price is the first Pyth update published inside a 60-second post-expiry window, and
  the cranker chooses which update to submit — a bounded but real freedom that v1 tightens.
- Playground's throwaway wallet holds the upgrade authority on devnet. The mainnet deploy
  ceremony, including authority handling, is its own registered step.
- The program holds no funds, so the right gate before mainnet is public review, not a
  five-figure audit. The vault that *will* hold funds (Wave 4) is a different story and will not
  ship without one.
