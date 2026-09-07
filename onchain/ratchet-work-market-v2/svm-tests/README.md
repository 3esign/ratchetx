# Work Market v2 LiteSVM proof

This is a manual-wire-format, transaction-level suite. It never imports the
Work Market Rust crate as a client, so instruction discriminators, argument
bytes, account ordering, PDA seeds, account layouts, and signer/writable flags
are exercised independently against the compiled SBF.

Run it only after building the exact program artifact:

    cargo build-sbf --manifest-path programs/ratchet-work-market-v2/Cargo.toml --sbf-out-dir target/deploy
    cargo test --offline --manifest-path svm-tests/Cargo.toml -- --nocapture

LiteSVM installs its bundled Token-2022 11.0.0 and Memo 4.0.0 SBF processors.
The harness additionally:

- loads target/deploy/ratchet_work_market_v2.so under the declared Work Market
  id;
- installs the same inert bytes under a separate mock completion-program id
  solely to obtain a real executable Loader-v3 Program plus frozen ProgramData
  with no upgrade authority; it never invokes those bytes as a producer;
- injects a compile-time-shaped producer manifest, live subject, and canonical
  packed pending WorkPage record owned by that frozen program;
- loads the exact captured 409-byte mainnet RCX mint fixture;
- creates Token-2022 recipient accounts with a real enabled MemoTransfer
  extension.

This is deliberately a Work Market consumer proof, not a replacement for each
producer generation's own lifecycle suite. It proves nonzero fund, payable
claim, nonpayable refund, Memo CPI compatibility, vault closure, terminal
voucher state, immutable-program rejection, and atomic failure for missing or
wrong Memo accounts and mutated/substituted packed locators.

The Memo positive controls use the canonical 64-byte (64-character) lowercase
ASCII hexadecimal UTF-8 encoding of the unchanged 32-byte settlement digest. This is intentional:
Memo 4.0.0 rejects arbitrary raw digest bytes as invalid UTF-8.

The SBF builder may create an ignored throwaway keypair under target/deploy.
That keypair is not the declared program identity and must never be published
or used for deployment.
