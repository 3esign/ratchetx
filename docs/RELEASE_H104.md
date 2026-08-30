# h104 — cross-device owner-session management

Candidate 2026-08-30. MCP1.2.0 / Agent Skill1.2.1 unchanged; existing signed
grant/revoke/status/recover bytes and bearer rights remain unchanged.

## Scope and safety

- Explicit SIGN & FIND MY SESSION before the new-grant form. Same owner wallet
  can sign a read-only lookup without a local session ID or private credential.
- New separately scoped `owner-discover` returns only the latest retained row,
  including revoked/expired/pending state. Signature checked before one strict
  exact-wallet read; no scans, players, settlement, grants or nonce writes.
- Display owner/nonce/schema/time/record validation; wallet lifecycle checked
  after signature AND HTTP response. Clear any old displayed credential before
  lookup. No background signing, automatic retry or recovery of secret material.
- Show allowance-used/pending/expired/revoked states, limits, observed timestamp,
  public report link and explicit copy of nonsecret ID. Manual ID path retained.
- Strict Supabase reads reject malformed/empty HTTP2xx JSON instead of treating
  it as absent. Valid JSONnull and existing bounded retries remain; unrelated
  writer RPC behavior is unchanged. No schema migration or paid service added.

Completed pilot6cce3cd29ed6 and the separate ORACLE_STALE preflight retain their
evidence classifications in RELEASE_H103.md. Owner now reports all grants revoked;
no authenticated verification/new game call was made for this change.

## Verification and publication

Isolated UI covers fresh-device lookup, explicit separate revoke, null records,
expired/revoked/pending/used state, bad wallet/nonce/ID/limits/time, transport error,
late disconnect/account-change/pagehide, credential clearing and optional metadata.
Service/HTTP tests exercise real signed bytes and exact-key/no-side-effect spies.
Strict-parser regression was red before fix and green after, with adapter controls.
Final focused batch: 19/19 passed (17 test suites plus release-safety and version
gates). Solana skill lint and git diff --check also passed. Suites cover service,
KV, atomicity, HTTP, discovery, UI, strict storage reads, storage compatibility,
critical paths, balances, settlement, writer fencing/recovery, release identity
and the smoke runner/contract. Deployment evidence follows after publication.

The browser-control runtime reset during setup; no real wallet was signed or
browser end-to-end success inferred. No token transfers, new RCX reload, global
Bankr X availability or fully on-chain settlement are claimed.

Rollback is forward-only: keep migration003 guarded writers. These additive owner
read/UI changes do not require changing economics, oracle thresholds or program.
Exposed operator credential rotation and quota headroom remain separate backlog.
