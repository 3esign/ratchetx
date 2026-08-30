# Solana / Bankr-on-X preflight

2026-08-30. Scoped verification of existing h100 components, not a full independent
security audit or proof that the proposed Bankr-on-X product is deployed.
Production code 9b3e7f0; this work changed documentation only.

Funding scope: the user will fund Bankr's integration test if needed, not other
players. No test wallet destination, amount or gas cap has been selected. No
payment, burn, new demo, registration, wallet signature or deploy was performed.

## Existing regression suite

Ran npm test against the current canonical repository. Release safety and
version/digest checks passed, including frozen v2 source identity and no metered
Pyth dependency in protected economic paths. The safety scan covered 292 tracked
files; this is not proof of credential rotation or absence from old Git history.

Result: **65 test files passed, 0 failed, 5 skipped**.

Coverage includes ranked domain/network-bound Ed25519 requests, replay protection,
burn verification, balances/settlement, Pyth validation/order/pagination, MCP HTTP
and scorecards, agent onboarding, and x402/premium-proof/browser-smoke fixtures.
These tests use local fixtures/mocks where appropriate; a browser-smoke test name
does not establish a new Phantom or Bankr funded mainnet execution.

Skipped: test_align, test_chal_ui, test_funnel, test_notify, test_widths. Required
fixture http://127.0.0.1:8247 was absent. No rendered browser QA is claimed.

## Public mainnet checks

At 10:16:30.107Z, RPC context slot 442854246:

- Full mainnet genesis:
  5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d.
  The full hash was also returned independently by solana-rpc.publicnode.com.
- Derived CAIP-2 solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp matches lib/x402.js.
- RCX mint FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump exists, owned by
  Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb), six decimals,
  mint authority None, freeze authority None.
- Optional seal program 23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX exists
  and is executable; its program account points to
  BiMrv5BAjxCPzH2sFFARbDnrXmn4FRTULfnKgeAVL4CF.
- ProgramData still has an upgrade authority. This matches the staged freeze
  posture; do not call the optional program immutable or canonical game settlement.
  This probe did not independently reproduce the deployed binary build.
- All seven configured Pyth accounts (SOL, BTC, ETH, BONK, PUMP, JUP, WIF) were
  present with receiver rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp ownership,
  fully verified PriceUpdateV2 encoding and exact expected feed IDs. Decoded
  confidence, EMA, publish timestamps and posted slots; observation slots
  442854250-442854251. These are point-in-time account checks, not an admission
  guarantee for a later forecast or proof of complete capture history.

Diagnostic correction: the first attempt compared the full genesis hash to the
32-character CAIP-2 reference and incorrectly rejected valid endpoints. Corrected
the probe using the published mapping and reran successfully. No product code
shared that diagnostic comparison. The tried dRPC fallback reported unavailable
on its free plan; working public endpoints were used, no plan was purchased.

## Live application checks

- 10:16:37.632Z: MCP initialize reports h100, MCP 1.2.0, protocol 2025-03-26;
  tools/list returns all 13 advertised tools. Ranked prepare requires wallet,
  target, side and p; submit requires wallet, base64 Ed25519 signature, nonce and
  exact payload. Discovery alone does not prove Bankr can sign them.
- 10:17:19.187Z: public Pyth context reports seven atomic feeds, no legacy feeds,
  shared-read access and requestTriggeredOracleRead:false.
- Earlier 10:00:53.410Z readback reproduced Bankr's four-page/17-row WIF window and
  one scored MISS/Brier 0.2704 on both reported BTC handles. See
  RCX_AGENT_VALUE_PLAN.md for exact evidence and attribution boundaries.

## Required before calling Bankr-on-X ranked play complete

1. Bankr must demonstrate raw Solana Ed25519 signing from the intended X runtime
   and preserve the caller's authenticated wallet context. Its public sign API
   documents EVM methods; Solana swap support alone is insufficient evidence.
2. Agree and verify the test wallet and a capped budget with separate SOL gas.
   RatchetX sponsors only Bankr's test, disclosed in any public results.
3. Complete one authorized RCX reload if needed, verify exact token routing and
   credited amount, then ranked prepare/sign/submit and post-expiry settlement.
4. Test repeat and failed calls, declined signing, budget exhaustion and recovery.
   Winner-payout replay and VOID/refund need their own deterministic controls,
   not an assumption from two observed MISS receipts.
5. Test multi-user isolation and duplicate-X-prompt handling without funding outside
   players. Keep open predictions/signatures private; share settled proof only
   when the caller opts in.
6. Close the five missing browser checks and prove the intended confirmation
   handoff. If X cannot sign safely, provide a labeled private wallet handoff;
   do not advertise a no-handoff feature until it actually works.

No claim of all-green end-to-end mainnet Bankr support is made here. Existing
canonical settlement remains the Ratchet server using validated Pyth-on-Solana
evidence; independentPythReplay stays false.

Sources:

- [Solana getGenesisHash](https://solana.com/docs/rpc/http/getgenesishash)
- [Solana CAIP-2 mapping](https://namespaces.chainagnostic.org/solana/caip2)
- [Bankr signing](https://docs.bankr.bot/wallet-api/sign/)
- [Bankr per-wallet MCP and skills](https://docs.bankr.bot/agent/advanced/)

Documentation validation: git diff --check and focused local link/heading checks.
The skill-creator Python validator could not run because its bundled environment
lacked PyYAML; no package was installed. Unchanged skill frontmatter identity and
new reference links were checked separately.
