# Bankr integration without platform-team changes

2026-08-30. Research and implementation proposal, not a deployed authorization
feature. User direction: work with Bankr's existing self-service surfaces; fund
only the Bankr pilot if needed. Do not subsidize other players.

**h101 live update:** The bounded HTTP adapter, owner consent page, atomic
player/acceptance receipt and signed recovery are implemented. [Current session
contract](PLAY_SESSION_DESIGN.md) supersedes the historical proposal below. Check
RELEASE_H101.md for production verification at 2026-08-30T13:47:30.236Z. Bankr reports protected
per-user HTTP secrets, not a native Solana message signer. A hosted private-user
pilot still must be demonstrated; no globally enabled X flow is claimed.
The historical accepted-call-only budget below is NOT the implemented conservative
gross-reserved-attempt budget. Do not conflate them.

## Decision

Separate three problems: distribution, wallet authority, and execution UX.
An installable workflow solves distribution; it does not create a missing signer.
Use the existing skill now. Prove available signing surfaces before choosing the
authorization adapter. A Ratchet-owned, bounded play-session grant is the preferred
fallback if native Solana signing remains unavailable. No new Bankr global tool or
catalog approval is a prerequisite for this path.

## Evidence and limits

- Bankr's user-supplied reply reports no arbitrary Solana Ed25519 message signing
  in its X runtime, account-scoped MCP, and public X approvals. This is a runtime
  report, not independently reproduced tool execution here.
- Its [advanced features](https://docs.bankr.bot/agent/advanced/) document
  per-wallet skill installation from arbitrary GitHub directories, custom MCP and
  encrypted environment variables. Self-installing for each user is sufficient;
  a builder's install does not equip every X account automatically.
- [Public/forkable apps](https://docs.bankr.bot/apps/overview/) are another
  self-service distribution surface. Start private; sharing is a separate action.
- [App permissions](https://docs.bankr.bot/apps/permissions/) distinguish owner
  and viewer execution. Use viewer identity for user actions. Scheduled scripts
  still run as owner; never schedule visitor spending or expose owner secrets.
- [Wallet signing](https://docs.bankr.bot/wallet-api/sign/) documents EVM methods;
  [raw submission](https://docs.bankr.bot/wallet-api/submit/) explicitly documents
  EVM transactions. Neither establishes arbitrary Solana transaction support.
  A successful Solana swap/transfer is not that proof either.
- [App SDK](https://docs.bankr.bot/apps/sdk/) separates backend HTTP from the
  opaque-origin iframe. Its sample wallet address is EVM. A signature permission
  is not a documented Solana method. App x402 currently describes Base USDC, not
  Ratchet's Solana payment rail. Do not introduce a bridge or silently pay on Base.
- [Privy's Solana signer](https://docs.privy.io/wallets/using-wallets/solana/sign-a-message)
  exists, but Bankr using Privy does not give our app authority to invoke that
  wallet. Do not assume an SDK import bypasses app ownership or runtime policy.

At 2026-08-30T10:31:19.959Z a credential-free GET of the public Ratchet skill
returned HTTP 200 (9,089 bytes) with the correct skill name and MCP URL:
https://raw.githubusercontent.com/3esign/ratchetx/main/skills/ratchetx/SKILL.md

No Bankr wallet/API key was used. No external app or skill was installed this turn.

## Phase A: self-service cockpit and no-spend capability check

Existing install command for Bankr chat:

```text
Install the ratchetx skill from https://github.com/3esign/ratchetx/tree/main/skills/ratchetx
```

The existing skill supports Pyth inspection and demo play. It is not a new signing
adapter. Do not interpret its local-stdio guidance as a reason to export keys into
Bankr. Remote MCP already advertises ranked prepare/submit; discover live schemas.

Have Bankr build a PRIVATE cockpit using existing app capabilities:

1. Read the public Pyth context, board and selected public scorecards/proofs.
2. Begin with read-only behavior: no new demo, polling a lazy-settling state route,
   registration, signature, paid request, forecast or transfer during preflight.
3. Configure viewer identity for user-specific actions. Verify exact wallet fields
   rather than treating an EVM address as Solana. Until then show "unverified".
4. Enumerate the actual exposed signer/transaction schemas in X and private web
   runtime separately. Ask for exact method, input encoding and returned artifact.
   A plain promise that "signing is supported" is not acceptance evidence.
5. If a native Solana message method exists, the next approved test is a fresh,
   domain-separated capability challenge with no spend authority, not a live shot.
   Verify the signature bytes independently against the asserted public key.
6. If only arbitrary Solana transaction signing exists, first inspect a locally
   constructed, non-broadcast fixture. Signing its transaction message does not
   make it a valid signature over Ratchet's existing raw JSON payload.

No repeated minute scheduler or new oracle collector: use shared public context.
Do not infer private Bankr approval from public tweet consent. Prototype in web
terminal and measure the X -> private web -> public settled-proof handoff.

## Phase B: bounded play-session adapter if required

This is a NEW authorization surface requiring implementation, review and negative
tests. Do not ship it as an undocumented bypass of lib/ranked.js.

Proposed flow:

1. User opens Ratchet directly in a private wallet-capable browser and selects
   the actual Solana wallet that will own the game record. If it cannot be the
   Bankr-held wallet without exporting keys, use a separate user-controlled wallet
   explicitly. Never label that wallet as the Bankr wallet or merge demo records.
2. User signs one versioned session grant, explicitly binding Ratchet domain,
   Solana mainnet, owner wallet, session/challenge ID, expiry, permitted actions,
   maximum accepted calls, per-shot credit cap and total gross credit cap.
3. Ratchet verifies the owner's Ed25519 signature and issues a random, revocable
   play capability. Store only a secure hash server-side. Deliver the secret only
   to the owner through an authenticated private setup; no logs/public URLs.
4. User explicitly places it into Bankr's protected per-user secret storage. Prove
   private HTTP use from the intended runtime; never expose the value to chat,
   public app data, browser HTML or a shared owner-scoped integration.
5. Bankr presents that capability to a separate scoped play adapter. It can submit
   forecasts within the grant and inspect their results; it cannot sign chain
   transactions, transfer SOL/RCX, reload, register, change recipients, enlarge its
   limits, issue another grant or act for another wallet.
6. After authorization, invoke the SAME canonical target validation, fresh Pyth
   sealing, debit, settlement, refund, score and receipt logic as normal play.
   Do not fabricate a wallet signature or use the broad two-hour browser auth as
   the delegated credential. Add an explicit, separately tested trusted context.
7. User revokes instantly from Ratchet; expiry also fails closed. Network payment
   approval stays outside the session. RCX reload remains a normal, separately
   wallet-approved Solana transaction when credits are actually needed.

Threat model: the capability holder can spend the remaining authorized PLAY
CREDITS and influence this wallet's forecasts, so it is sensitive even though it
cannot move tokens. Its authority is possession-based, not proof of Bankr authorship
or X-handle ownership. Label delegated activity honestly. Keep consent and budget
enforcement server-side, not only in a skill prompt or an app manifest.

Budget and crash invariants:

- Reserve accepted-call count and gross credit spend atomically with canonical
  shot acceptance under one durable owner/session operation. Do not debit a
  separate KV counter and hope a second write succeeds.
- Rejections spend neither credits nor call budget. Accepted VOID shots refund
  game credits under existing rules, but do not replenish gross session authority.
- Persist a request ID and full request digest. Exact retry returns its receipt;
  same ID with different target/side/p/stake is rejected. Ambiguous timeout means
  lookup/reconcile, never a fresh ID. Include all sessions in owner-wide limits.
- Crash recovery, concurrent submits, revoke-versus-submit and expiry boundaries
  must have deterministic outcomes. Fail closed on unreadable session state.

If protected capability storage/HTTP is unavailable in X, the bounded session can
operate in the private web terminal; X remains initiation and optional reporting.
Do not claim fully autonomous X execution until it is actually demonstrated.

## Conditional alternative: transaction-authorized intent

Only if Bankr demonstrates arbitrary Solana transaction signing: we can design an
adapter that validates a domain-bound intent commitment carried by the signed
transaction. Restrict programs, signers, fee payer, amounts, recent blockhash,
nonce, expiry and canonical intent hash; reject unexpected instructions. A memo
hash by itself is not an authorization check. A submitted transaction also needs
successful chain status and replay-safe reconciliation. This is distinct from
the optional SOL seal and does not change the frozen referee program.

Do not build a second payment path or use an unreviewed micro-transfer as a login
challenge. Native transaction signing is still unproven by Bankr's reply.

## Acceptance and release sequence

1. Existing read-only endpoints and per-user skill installation verified.
2. Private cockpit shows accurate data and caller identity; no owner leakage.
3. Exact available signer/secret-storage capability demonstrated without spending.
4. Selected adapter passes offline positive and negative tests: other wallet,
   altered intent, cross-domain replay, expired/revoked grant, budget exhaustion,
   concurrency, restart, duplicate X requests, and forbidden reload/transfer.
5. Re-run existing core tests and release checks. Keep mainnet account diagnostics,
   mocked tests and funded client E2E evidence separately labeled.
6. ONLY THEN agree the pilot's wallet and exact RCX/SOL limits with the operator.
   Bankr reported DuqnyhLHPAARS9dhCL3d3ZVxwYi48XtuZ3yRH38AgQAy as the user's
   Bankr wallet; that assertion has not been independently ownership-verified.
   Its ~0.01 SOL was an estimate, not a required fee or approved funding amount.
7. Run one bounded case, verify receipt/replay/outcome, then extend within the
   agreed cap. Mark reports as RatchetX-funded integration tests, including misses.
   Other users pay their own way; a fork/share does not authorize sponsorship.

## Earlier capability-inspection reply (superseded; not sent here)

We can build this using self-service skills/apps; no platform-team changes.
Install our public ratchetx skill from
https://github.com/3esign/ratchetx/tree/main/skills/ratchetx and prepare a PRIVATE,
viewer-scoped Ratchet cockpit for public context/board/proof reads only.

Inspect the actual signing schemas available in your private web runtime and X
runtime separately: raw Solana Ed25519, serialized Solana transaction signing, or
neither. Do not sign or broadcast yet. If neither is exposed, can you use a
user-provisioned secret from protected per-user storage in a private HTTPS request
to ratchetx.xyz from each surface, without ever printing the secret?

We can then implement a wallet-approved, expiring Ratchet play capability with
strict call/credit limits and revocation; no transfer/reload/key access. That
adapter is proposed, not live. Report exact supported methods and limitations.
No funds, new shots, public publication or scheduled runs yet.

## Local references

- [Value and funding plan](RCX_AGENT_VALUE_PLAN.md)
- [Solana test baseline](SOLANA_BANKR_PREFLIGHT_2026-08-30.md)
- lib/ranked.js: raw payload verification and internal verified-shot context.
- api/mcp.js: 60-second prepare window, nonce lease, replay receipt, canonical shot.
- lib/verify.js: general browser auth is broader than a bounded delegated grant.
- api/game.js: existing registration, credits, reload and settlement boundaries.
