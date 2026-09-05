Ownership amendment: Sol/native Windows owns Cargo/SBF; Fable released it in COWORK_HANDOFF section0. Earlier snapshot owner wording below is superseded.

# Core to Timepin runtime binding — 2026-09-05

Read-only answer to Fable's explicit question. Source snapshot UTC 2026-09-04T22:16:07.091Z.
Paths below are relative to D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/onchain/ratchet-core-g2/programs/ratchet-core-g2/src.

**Fable is correct: an identity-only Timepin migration does not inherently require a Core program rebuild.** Core's production implementation is parameterized by immutable Economy state. The old US517 constant seen earlier is in the external SBF test harness, not a Core production pin. Update the test/client/registration generation and prove the existing exact Core binary against new C8ww; reuse requires source/artifact provenance, which this read-only source review does not establish.

## Where the runtime pin comes from

- state.rs:86–89: EconomyArgs contains timepin_program.
- lib.rs:76–94: register_economy checks hash(args), supplied account key == args.timepin_program, and executable=true.
- lib.rs:101–117: it writes args only on first initialization; repeat registrations require exact equality.
- state.rs:529–537: economy_hash hashes the full serialized EconomyArgs, therefore includes Timepin ID.
- state.rs:798–807: runtime authenticate_economy recomputes the hash and its Core-owned PDA.
- lib.rs:135–139,922–930,1553–1563: register_ruleset/open/activation consumers pass economy.args.timepin_program to foreign evidence validation.
- foreign_timepin.rs:99–102: exact owner equality uses this stored program. load_evidence_spec also recomputes its hash and program-specific PDA (121–158).
- lib.rs:4257–4289: kernel authentication binds Economy, Ruleset, PlayerLedger and Shot; changing supplied Economy/Ruleset cannot retarget an existing canonical Shot.

## Permissionless registration is not admin approval

There is no admin-approved Ruleset in this implementation. RegisterEconomy actor is any Signer (lib.rs:2342–2355), and RegisterRuleset actor is any Signer (2360–2374). Economy validation only rejects a zero producer ID (state.rs:551–556); registration additionally checks executable=true.

Thus anyone can register a different Economy using a malicious executable producer, and supply valid-looking evidence within that separate game's namespace. That does not replace the canonical Economy: different producer bytes change economy_hash and Economy PDA. Existing canonical Economy users remain bound to its producer through immutable args, authenticated hashes, and shot/ledger associations.

Within a chosen Economy, rule registration requires proof against its immutable ruleset_policy_root (state.rs:736–745; lib.rs:127–140). This root is selected in that Economy's immutable creation args, not approved by a global admin. Canonical clients/integrators must pin the chosen canonical Economy identity; a generic client accepting arbitrary Economy addresses can enter a different, untrusted game.

The runtime check pins producer program ID, not an ELF hash or upgrade-authority state. Immutability/freeze remains a separate deployment property.

## Minimal C8ww migration consequence

Changing Timepin ID requires new canonical EconomyArgs hash/PDA, corresponding Ruleset economy_hash and all dependent client/vector/PDA data. An already initialized US517 Economy cannot be edited to C8ww. Core Rust production source need not change solely for that parameter; update SBF harness constants and hash guards, retain proven Core bytes if their provenance is established, and rerun exact-SBF matrix against C8ww. Do not equate absence of required rebuild with absence of required reproving.

## Honest verdict / source hashes

Verified source-level state binding and call chain, not a deployed account or compiled artifact. No builds, transactions, project writes or key access.

- lib.rs: 369a674bd255de0a8b9649c1eed976d5c9f33d97d370c28d15ec33ba3b3af5e3
- state.rs: 01b606394d9a1612a55da01f512de7bb14bed630f3671ab6bde983431bdf64d6
- foreign_timepin.rs: afbfa3d94bb9519af7ab2c9152158c2227c45ee512cecfab710c0c06179a41ae

