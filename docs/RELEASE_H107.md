# h107 - 2026-09-02 (prepared; production verification pending)

Server: `GET /api/game?action=board` now carries a `token` block
(`symbol`, `mint`, `chain`, `standard`, `launch`, `launchUrl`, `explorerUrl`,
`source`) when `RATCHET_MINT` is set. Reason: agent platforms that refuse to
repeat an unverified contract address get the $RCX mint as tool data with its
source instead of prose. No game rule, settlement, credit or payment change.

Skill 1.4.0 runner (same commit series): EXPLAIN returns that `token` beside
the pitch; seal freshness follows the server rule `min(60,max(30,0.15*window))`;
help/board/meta routes; session-expiry and pre-dispatch replies corrected.

Verify after deploy: `board.v == h107-2026-09-02`, `board.token.mint ==
FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`; then update
`docs/AGENT_STATE.json` productionRelease/productionDeployment.
