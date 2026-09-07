# Ratchet RCX Work Market v1

Status: **devnet candidate; not deployed on mainnet and not wired into canonical play**.

This program lets any sponsor lock existing RCX behind one exact onchain work item. A separate completion program performs the canonical work and writes a durable receipt. After that, any caller can permissionlessly send the complete voucher vault either to the receipt's fixed worker (`Payable`) or back to the sponsor (`Nonpayable`).

The Work Market is deliberately separate from game settlement. It does not mint RCX, burn RCX, award game credits, alter RatchetX's 70/30/0 reload rule, rank players, choose a worker, hold a global treasury, or expose an admin withdrawal.

## Identity

- Program ID: `EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD`
- RCX mint: `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`
- Token program: Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)
- Voucher schema: `1`
- Completion-receipt schema: `1`

The byte-verified SBF is deployed on devnet at the program ID above (slot `492838526`, deployment signature `377dfvu4g9gyh7ZTa2KPWpCrwXA2hqYyJXDGSyt3BfgPXGmh8ZLfSrqcFxQ1ECervvU3rCbEXr5pN1SsX2Gxs4HT`). Its upgrade authority remains the deployer during soak; it is not frozen and must not be described as immutable.

The mainnet RCX mint is fixed-supply in operational terms: mint authority and freeze authority are both absent. Work Market v1 accepts only this exact mint through Token-2022.

## State machine

```text
fund_rcx_voucher
        |
        v
     Funded
      /   \
 Payable  Nonpayable      <- exact durable receipt owned by pinned program
    |        |
   Paid   Refunded
      \     /
   close_voucher          <- permissionless; rent returns only to sponsor
```

Funding creates a voucher PDA and a voucher-owned Token-2022 vault. Claim/refund transfers the vault's entire actual token balance and closes the vault in the same transaction. This means unsolicited RCX dust cannot prevent cleanup or redirect value: extra units follow the already fixed worker or sponsor destination.

## Pinned receipt boundary

The sponsor chooses a `completion_program`, `subject`, `work_kind`, `nonce`, and amount when funding. Those values are committed into the voucher address:

```text
["voucher", schema_u16_le, completion_program, subject,
 work_kind_u8, sponsor, nonce_u64_le]
```

The program accepts only the canonical receipt PDA under that chosen completion program:

```text
["completion", subject, work_kind_u8]
```

It validates the receipt owner, PDA, discriminator, exact 125-byte layout, schema, bump, subject, work kind and disposition. For a payable receipt, the receipt itself fixes the non-default worker; a caller cannot substitute another beneficiary.

This pinning gives RatchetX flexibility: a future Pyth adapter, stock-price adapter or game generation can use a new completion program without reinterpreting already funded vouchers. It does **not** magically remove trust from an upgradeable completion program. A fully trustless production rail must pin a reviewed generation whose terminalization is permissionless and whose code/upgrade authority policy is acceptable. That still has a liveness assumption: permissionless access does not make anybody post, so the compatible completion program must make unperformed work reach a durable nonpayable receipt rather than strand sponsor RCX.

## Deliberate no-cancel rule

There is no sponsor timeout or unilateral cancellation. Such a path could race valid completed work. Therefore a compatible completion program must guarantee that every subject can reach a durable terminal `Payable` or `Nonpayable` receipt without a privileged operator, and must keep that receipt available while vouchers may still claim it.

Funding an incompatible or abandoned completion program can strand the voucher. Clients must treat completion-program compatibility as a hard funding gate.

## Current integration limit

Next Print v2 now emits the exact durable receipt. The combined exact-SBF LiteSVM suite proves both real producer paths: a valid Pyth successor pays nonzero RCX to the actual observer, while a real v2 timeout emits `Nonpayable` and refunds the complete voucher to its sponsor. It also passes the exact 409-byte mainnet RCX mint and exact 134-byte mainnet TSLAX Pyth fixtures. Existing deployed Next Print v1 remains unchanged.

Both programs are byte-verified on devnet, and v2 has a public official-Pyth timeout -> durable receipt -> Shot cleanup proof. The exact RCX mint does not exist on devnet, and this program deliberately accepts no substitute mint. Therefore a public devnet RCX transfer would be fake evidence and is impossible with the production bytes. The remaining value gate is an explicitly opt-in mainnet beta after review/soak and an upgrade-authority policy decision. No UI or Bankr surface should advertise live RCX work rewards before that gate passes.

## Verification

```powershell
cargo test --workspace --quiet
cargo build-sbf -- --locked
cargo test --manifest-path svm-tests/Cargo.toml --test work_market -- --nocapture
node ../../test/test_work_market_client.mjs
```

See [BUILD_EVIDENCE.md](./BUILD_EVIDENCE.md) for the exact tested artifact and [abi-v1.json](./abi-v1.json) for the machine-readable contract. Rust-generated cross-language vectors are in [vectors/abi-v1.json](./vectors/abi-v1.json).
