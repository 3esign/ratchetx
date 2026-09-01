# h106 — 2026-09-01 (prepared; production verification pending)

Server:
- play-session status now returns `xp` and `chambers` (`min(4, rank+1)+1`), so
  the skill runner can use the real chamber cap instead of its floor of 2.
- Grant bounds widened: per-attempt stake 100..10,000,000, gross up to
  100,000,000, minimum interval 1,000 ms (was 10,000 / 100,000 / 5,000 ms).
  `lib/play_session.js`, `lib/play_session_http.js`, `lib/ranked.js`,
  `play-session.html/js`, tests and live probe updated together.
- No new actions. A local `claim_migration` experiment and a MINT-check bypass
  that were sitting uncommitted in the worktree were removed before this
  commit and never deployed.

Skill 1.4.0 (`skills/ratchetx`): `--auto --say` intent resolution in the runner;
see `references/owner-session-play.md` and `test/test_session_play_intent.mjs`.

Verification after deploy (fill in): `GET /api/game?action=board` -> `v` must
read `h106-2026-09-01`; `GET /api/game?action=play-session` -> `limitBounds`
must show 10000000 / 100000000; then update `docs/AGENT_STATE.json`
`productionRelease`.
