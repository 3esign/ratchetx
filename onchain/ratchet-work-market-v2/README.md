# Ratchet Work Market v2 (draft)

This isolated draft is a manifest-gated RCX voucher market for immutable Solana
completion programs. It does not change Work Market v1, Core, Timepin, or Next
Print.

## Freeze status

There are two separate trust assumptions:

1. A completion program is accepted by `fund_rcx_voucher` only after its
   Loader-v3 `ProgramData.upgrade_authority_address` is `None`. Its manifest,
   subject accounts, and completion locators must all be owned by that exact
   immutable program.
2. This Work Market v2 program is still a beta draft. Its source and fixture
   program id are not a claim of deployment or immutability. Until its own
   upgrade authority is removed, users still trust that authority.

No deploy keypair corresponding to the fixture id in `declare_id!` is tracked
in source. cargo build-sbf may create an ignored throwaway keypair under
target/deploy; its public key is not the canonical program id and it must not be
published or used for deployment.

This immutable-producer rule fixes the release order. An upgradeable Core,
Timepin, or Next Print beta can prove its lifecycle with self-funded
permissionless calls and cleanup bonds, but Work Market v2 must reject its
vouchers. After those producer bytes pass their full evidence gates and the
owner separately authorizes removing their upgrade authorities, real RCX
vouchers may be exercised while Work Market itself remains upgradeable. Only
after that end-to-end value proof may a separate approval remove Work Market's
own authority. Freezing every program at once would make the required bounty
proof circular.

## Why completion is reserved before funding

A producer first reserves one completion record for a live, eligible subject.
The recommended client transaction is atomic:

```text
producer.reserve_completion(subject, kind, expected_index, payer, locator)
work_market_v2.fund_rcx_voucher(..., subject, kind, locator, expected_index)
```

Funding accepts only a structurally exact `Pending` record whose full
`subject` pubkey and `work_kind` match the voucher. If the work already
completed, the subject closed, or the record is malformed, funding fails before
RCX moves.

The Work Market does not inspect the Instructions sysvar and does not require the
two instructions to be adjacent. A pre-existing reservation is safe, but a
single transaction removes the retry race. A producer must make reservation
unique and idempotent for `(subject, work_kind)`; an unaffiliated payer may pay
the rent but gains no worker, sponsor, or cancellation rights.

After reservation, every producer transition that performs the work or makes it
impossible must require the canonical locator and change the record exactly once:

- `Pending (0)` -> `Payable (1)` with a non-default worker, nonzero result
  hash, and nonzero completed slot; or
- `Pending (0)` -> `Nonpayable (2)` with the default worker, nonzero result
  hash, and nonzero completed slot.

There is no timeout refund and therefore no timeout/completion race. Claim and
refund are permissionless crank instructions and use only the terminal record:
`Payable` sends the whole vault balance to the recorded worker, while
`Nonpayable` sends it back to the voucher sponsor.

## Permanent close policy

Completion receipts, packed WorkPages, and WorkManifests are permanent and have
no close, reset, reuse, or mutation path except the one-way Pending-to-terminal
record transition. A subject may close only after its reserved records are
terminal. Vouchers may close after Paid or Refunded; voucher rent always returns
to the original sponsor.

This permanence is required: closing a locator while a funded voucher exists
would strand the vault. It is a producer conformance invariant that must be
audited before that producer removes its upgrade authority.

## WorkManifest ABI

There is exactly one manifest per supported work kind:

```text
PDA = ["work_manifest", MANIFEST_SCHEMA_VERSION.to_le_bytes(), [work_kind]]
owner = completion_program
account discriminator = sha256("account:WorkManifest")[0..8]
total size = 42 bytes (8 discriminator + 34 payload)
```

Payload fields are Borsh encoded in this exact order:

| Field | Type | Bytes |
|---|---:|---:|
| schema_version | u16 | 2 |
| bump | u8 | 1 |
| work_kind | u8 | 1 |
| completion_schema_version | u16 | 2 |
| locator_mode | u8 | 1 |
| subject_schema_version | u16 | 2 |
| subject_account_size | u16 | 2 |
| subject_discriminator | [u8; 8] | 8 |
| locator_schema_version | u16 | 2 |
| locator_discriminator | [u8; 8] | 8 |
| records_offset | u16 | 2 |
| entry_len | u16 | 2 |
| locator_capacity | u8 | 1 |

`subject_account_size` is the full Solana account data length, including the
eight-byte Anchor discriminator. `records_offset` is also absolute from byte
zero of account data.

Manifests contain no authority. Each compatible producer generation exposes a
permissionless, compile-time-only publisher. The caller may pay rent, but cannot
choose any field. Publication must be idempotent and dust resistant:

- already-owned exact bytes: return success;
- empty system-owned PDA with lamports: PDA-signed allocate, assign, top-up, and
  initialize;
- any conflicting owner/data/layout: reject.

An already-finalized program that lacks this publisher and reservation lifecycle
cannot become v2-compatible after the fact. Core, Timepin, and Next Print must
publish from compatible successor program ids, then become immutable. New
features use new immutable program/manifest generations; no mutable registry or
admin allowlist is introduced.

## Locator mode 1: direct CompletionReceipt

This mode is intended for low-volume subjects such as compatible Timepin and
Next Print generations.

```text
locator PDA = ["completion", subject, [work_kind]]
locator_slot = 0
total size = 125 bytes
records_offset = 0
entry_len = 0
locator_capacity = 1
```

The account layout is:

| Absolute offset | Field | Type |
|---:|---|---:|
| 0 | manifest-declared discriminator | [u8; 8] |
| 8 | schema_version | u16 |
| 10 | bump | u8 |
| 11 | disposition | u8 |
| 12 | work_kind | u8 |
| 13 | subject | Pubkey |
| 45 | worker | Pubkey |
| 77 | result_hash | [u8; 32] |
| 109 | completed_slot | u64 |
| 117 | completed_ts | i64 |

The PDA, bump, exact length, owner, discriminator, schema, subject, kind, and
state invariants are all checked by Work Market v2.

## Locator mode 2: packed WorkPage

This mode removes one-account-per-completion overhead. The producer defines the
page PDA and header; the manifest fixes the account type/schema and where the
standard Borsh Vec records begin.

```text
Vec<u8> length prefix = records_offset - 4
record i = records_offset + i * 106
exact account length = records_offset + vec_len * 106
0 < locator_capacity <= 48
```

Trailing bytes, truncation, a count above capacity, and a slot outside the live
Vec are rejected. The full locator account must be owned by the voucher's exact
immutable completion program.

`WorkRecord` v1 is exactly 106 bytes:

| Record offset | Field | Type | Bytes |
|---:|---|---:|---:|
| 0 | subject | Pubkey | 32 |
| 32 | work_kind | u8 | 1 |
| 33 | disposition | u8 | 1 |
| 34 | worker | Pubkey | 32 |
| 66 | result_hash | [u8; 32] | 32 |
| 98 | completed_slot | u64 | 8 |

The full subject pubkey is intentionally present. Without it, a generic Work
Market could not prove that a page slot belongs to `voucher.subject` without
hardcoding Core's private account layout.

### Core packed profile

A compatible compact Core generation uses:

```text
WorkPage PDA = ["work_page", economy_hash, player, page_index.to_le_bytes()]
page_index = shot_nonce / 16
payload header = schema:u16, bump:u8, economy_hash:[u8;32],
                 player:Pubkey, page_index:u64, records:Vec<WorkRecord>
WorkPage payload base = 79 bytes
records_offset = 87 (8 discriminator + 79 base)
entry_len = 106
capacity = 48 (16 shots * kinds 3, 4, and 5)
subject type = Shot schema 2, full account size 780
```

Reservation scans at most 48 records to enforce one record per
`(subject, work_kind)`. Relevant Core actions receive the WorkPage and record
index, re-authenticate page PDA/header and record identity, then terminalize the
record. Work Market never hardcodes the Core program id or its WorkPage PDA
formula.

## Voucher ABI

```text
PDA = [
  "voucher",
  SCHEMA_VERSION.to_le_bytes(),
  completion_program,
  subject,
  [work_kind],
  sponsor,
  nonce.to_le_bytes()
]
total size = 246 bytes (8 discriminator + 238 payload)
vault PDA = ["vault", voucher]
```

Payload order:

```text
schema_version:u16 | bump:u8 | state:u8 | work_kind:u8 |
completion_program:Pubkey | subject:Pubkey | completion_locator:Pubkey |
locator_slot:u8 | sponsor:Pubkey | nonce:u64 | funded_amount:u64 |
settled_amount:u64 | funded_slot:u64 | funded_ts:i64 |
beneficiary:Pubkey | result_hash:[u8;32]
```

The voucher stores the authoritative locator and slot at funding. Settlement
cannot substitute a different page or record.

## Funding validation

`fund_rcx_voucher(nonce:u64, work_kind:u8, locator_slot:u8, amount:u64)`
checks, before transfer:

- nonzero amount and nonzero work kind;
- the exact RCX Token-2022 mint and six decimals;
- `completion_program.programdata_address() == completion_program_data.key()`;
- `completion_program_data.upgrade_authority_address == None`;
- exact manifest owner, PDA, size, discriminator, schema, bump, and work kind;
- exact subject owner, full size, discriminator, and schema from the manifest;
- exact locator owner/header and the mode-specific canonical layout;
- record subject/kind identity and a clean Pending state:
  default worker, zero result hash, and completed slot zero.

The program then creates the voucher and Token-2022 vault and transfers RCX.
Solana transaction atomicity rolls all of that back on any later failure.

## Token-2022 MemoTransfer compatibility

Both outbound paths require the canonical SPL Memo program. Immediately before
each vault `transfer_checked`, Work Market computes this 32-byte hash:

```text
sha256(
  "rcx-work-market:settle:v2\0" |
  work_market_program | completion_program | subject | work_kind |
  sponsor | nonce | completion_locator | locator_slot | disposition |
  beneficiary | destination_token | rcx_mint | amount | result_hash
)
```

The canonical CPI payload is the digest's deterministic 64-byte (64-character)
lowercase ASCII hexadecimal UTF-8 representation. SPL Memo rejects arbitrary raw hash bytes
because its payload must be valid UTF-8. The hash preimage and protocol state
ABI remain unchanged.

That instruction ordering lets a worker or sponsor use a real Token-2022
`MemoTransfer` account with `require_incoming_transfer_memos = true` without
gaining a veto over claim or refund. Funding does not need a memo because its
destination is the freshly initialized base vault.

## Tests and vectors

```powershell
cargo fmt --all -- --check
cargo test --workspace
cargo run --quiet -p ratchet-work-market-v2 --example print_abi_vectors
cargo build-sbf --manifest-path programs/ratchet-work-market-v2/Cargo.toml --sbf-out-dir target/deploy
cargo test --offline --manifest-path svm-tests/Cargo.toml -- --nocapture
```

The unit suite freezes sizes and offsets and covers unsupported kinds, invalid
manifest modes, direct PDA/bump, wrong packed owner, cross-subject/kind binding,
malformed pending/payable/nonpayable records, out-of-range slots, over-capacity
pages, truncation, trailing bytes, memo-domain mutation, and a real initialized
Token-2022 MemoTransfer destination fixture.

Machine-readable ABI details are in `abi-v2.json`; deterministic byte/PDA
fixtures are in `vectors/abi-v2.json`.

The manual-encoding LiteSVM suite loads the exact built Work Market v2 SBF,
LiteSVM's real Token-2022 and Memo processors, a real frozen Loader-v3 mock
producer boundary, the exact 409-byte captured mainnet RCX mint, and enabled
MemoTransfer destination accounts. It covers complete packed-locator
fund/claim/refund paths, vault closure and terminal voucher state, plus atomic
wrong/missing-Memo, locator mutation/substitution, and mutable-ProgramData
negative controls. See svm-tests/README.md for the precise proof boundary.
