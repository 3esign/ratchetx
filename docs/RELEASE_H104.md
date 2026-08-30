# h104 — cross-device owner-session management

Deployed 2026-08-30. MCP1.2.0 / Agent Skill1.2.1 unchanged; existing signed
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
and the smoke runner/contract.

Production verified 2026-08-30T18:58:04.342Z: 19/19 non-spending readbacks PASS.
Clean detached code commit dd02cd1b7e7df38065b91a298f7024fa721c258b; deployment
dpl_GNtuSrsQeJtypgvjmag68V9pBdLG; immutable URL
https://ratchetx-7fa6x3ziz-3esigns-projects.vercel.app; alias https://ratchetx.xyz.
Build-time guarded database prerequisite passed; no migration performed.
Release h104 returned on session/board/Pyth context; new owner discovery metadata
and unchanged bearer rights verified. Invalid signature and bearer-on-owner were
401; foreign origin403. Six private source/config paths remained404.
Five public files matched the clean artifact byte-for-byte. SHA256:

- play-session.html: fc062ab3324dd14fafb8541ba867823dedd9459309bd2f6bf3c7003f1e3bed34
- play-session.js: b8f6f12e1f2ad011659bd1464e35df4e95c67749a55c48bcf79c52b2819a65f0
- Agent Skill: 1d0955d2c4fbca21eb4299276a78a31cecb2f6322dfeeea61dee364e3bb4afc0
- owner-session-test.md: 98d48c1c77b8c8742641b7e929199acf2f98ac3c6aca3fd85c0610a6665d9c23
- session-smoke.mjs: 1b6592079a27a912de796d3aa035e67540b7514f982b5cbd850d7998efcc98b5

Publication metadata is a subsequent docs-only commit; the deployed code remains
the exact detached artifact above. No valid owner signature/capability was used.

The browser-control runtime reset during setup; no real wallet was signed or
browser end-to-end success inferred. No token transfers, new RCX reload, global
Bankr X availability or fully on-chain settlement are claimed.

Rollback is forward-only: keep migration003 guarded writers. These additive owner
read/UI changes do not require changing economics, oracle thresholds or program.
Exposed operator credential rotation and quota headroom remain separate backlog.
