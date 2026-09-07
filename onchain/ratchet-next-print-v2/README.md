# Ratchet Next Print v2

Status: **byte-verified devnet candidate; not deployed on mainnet and not canonical production play**.

Next Print v2 is an isolated successor to deployed v1. It preserves the server-free direct-successor Pyth game and adds a durable completion receipt compatible with the separate RCX Work Market. V1 was not upgraded or reinterpreted.

## Identity

- program ID: `2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR`
- devnet ProgramData: `ELapjd76gKGPyRtYc6cVRaJA1qAcp8ni5NBsiPME2mbd`
- SBF SHA-256: `01bab651f511cd72c480c432425c1bb343c91ab17f4df63c5ffdac1a8b0d52cc`
- ruleset SHA-256: `78b15cfe2ac9f4c69f60d42a65b544f143ea9a253efbde2f890a26549a15b3f0`
- schema: `2`
- completion work kind: `1` (`next-print-terminalize`)
- completion-receipt schema: `1`

The devnet deployment retains upgrade authority `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy` during soak. It is not immutable or fully trustless yet.

## Lifecycle

```text
player-signed OPEN at fresh Full Pyth print
              |
              +-- same print ------------------------> no-op
              |
              +-- direct successor ------------------> completion frozen
              |       (price / equal / scale)           Payable(observer)
              |
              +-- missed / revision / broken chain --> completion frozen
              |                                        Nonpayable
              |
              +-- onchain deadline -----------------> completion frozen
                                                       Nonpayable

anyone writes durable CompletionReceipt
              |
              +-- optional Work Market claim/refund (separate transaction)
              |
player reveals or anyone forfeits after reveal deadline
              |
anyone closes Shot only after exact receipt exists; rent returns to player
receipt remains permanently available
```

Canonical observation and timeout never call Work Market. A missing voucher, token account or reward claim cannot block the game. The caller who writes the receipt cannot choose the worker. Only an observer who supplies the exact direct successor is frozen as a payable worker, including equal-price or exponent-change terminal states. Missed successor, source revision, broken chain and timeout freeze a default worker and `Nonpayable`, allowing sponsor refund but no reward for failed work.

Oracle-derived VOID states store the exact update that caused them before freezing the result hash. Missed successor, same-time revision, broken source chain, exponent change and equal price therefore retain explanatory evidence.

## Oracle and stock boundary

V2 reads Pyth push accounts owned by the official Receiver program, requires
`Full` verification, pins each feed PDA, checks publish/previous-publish
ordering, future time, posted slot, confidence and positive price, and accepts
only the direct successor. SOL is on Pyth's official sponsored-Solana list.
The xStock tracker accounts are Pyth-owned and keylessly readable today but are
not on that sponsored list, so their publication continuity is not promised.

The seven fixed feeds are SOL plus Pyth tokenized-stock trackers TSLAX, NVDAX, SPYX, AAPLX, MSTRX and CRCLX. They are tracker instruments, not direct ownership of company shares. Stock entry freshness is 120 seconds and its successor wait window is 7,200 seconds; SOL uses 30 and 300 seconds respectively.

Pyth remains a trust dependency for signed data publication. V2 removes dependence on Ratchet servers or paid historical APIs; it does not claim that an oracle can never stop, revise data or change its external service. Future oracle/adapter semantics require a new program ID, so old Work Market vouchers never follow a silent upgrade.

## Permanent-state cost

The 125-byte receipt is rent-exempt, not literally free: the receipt writer makes a one-time SOL deposit that remains locked with the permanent account. There is no recurring Ratchet fee, keeper subscription or privileged cleanup. The larger temporary Shot is closed and its rent returns only to its recorded player.

## Evidence and current limit

- host tests: 5 passed;
- static Rust/JavaScript ABI and Work Market PDA parity: passed;
- exact-SBF LiteSVM composition suite: 8 passed, including direct-successor payment, missed/timeout refunds and exact mainnet TSLAX bytes;
- audited upgrade in devnet slot `492867556`, with deployed SBF prefix byte-identical to the local artifact and zero-only allocation padding;
- post-upgrade public official-Pyth lifecycle: OPEN -> VOID_TIMEOUT -> durable receipt -> CLOSED;
- dumped devnet SBF hash equals the local build hash.

The public run did not capture a successor, so it is not a public CAPTURED proof. The exact RCX mint is absent from devnet; therefore public devnet RCX transfer cannot exercise the production-pinned Work Market bytes. Local LiteSVM proves that composition with the exact real RCX mint account bytes.

See [BUILD_EVIDENCE.md](./BUILD_EVIDENCE.md), [DEVNET_EVIDENCE_2026-09-04.md](./DEVNET_EVIDENCE_2026-09-04.md), [abi-v2.json](./abi-v2.json), and [vectors/abi-v2.json](./vectors/abi-v2.json).

## Verification

```powershell
cargo fmt --all -- --check
cargo test --workspace --quiet
cargo build-sbf -- --locked
node ../../test/test_next_print_v2_client.mjs
node client/devnet-smoke.mjs
```
