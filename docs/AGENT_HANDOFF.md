# RatchetX Agent Handoff

**Live Release:** `h91-2026-08-29`

## Known End-to-End Proof Handles
- Bankr pass 1: `009d2bf7f3be` / shot `308c9b77fcd3`
- Bankr pass 2: `301e30592c97` / shot `68aef803bf7a`

## Deployment Surfaces
- Ratchet Server (Vercel)
- On-chain Pyth Push Accounts
- Ratchet Seal v2: `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX`
- MCP Remote Server

## Known Issues / Risks
- Next anchor deployment (Seal v3) requires new Pyth Owner checks (resolved locally, waiting for on-chain freeze window migration).
- Strict-Transport-Security missing on test instances (fixed in local vercel.json).
- `benchmarks.pyth.network/v1` API may return 401 unauthorized in certain CI environments if `PYTH_API_KEY` is not provided.

## Exact Next Task (Faza 2)
Faza 1 (Independent Pyth Verifier & Durable AgentRunReceipt Shadow Replay) is **COMPLETE**. The CLI `scripts/verifier.mjs` has been built and the continuous shadow pipeline `scripts/shadow-replay.mjs` is ready.

Next task: Await further instructions (Faza 5 is complete).
