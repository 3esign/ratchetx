# Uncommitted G2-G4 simulation sketches (moved out of test/ on 2026-09-03)

These four files were never committed and are not part of the shipped system.
They re-implement the economics as a plain JS `RatchetCore` class and run a
100,000-shot stress loop.

They were moved here because `npm test` runs everything in `test/`, and
`DEPLOY.cmd` runs `npm test` as its release gate. `test_g4_stress_batches.mjs`
imports `test_g2_economic_kernel.mjs` as a module -- which executes that file's
tests on import -- and the parent was cancelled before its subtests finished.
So a work-in-progress sketch was refusing production deploys.

Nothing was deleted. Move them back into `test/` when they are finished, or
keep them here as a scratch model. If they are meant to be a real suite, they
need to stop importing another test file for its side effects and the stress
loop needs a bound that finishes.

Also uncommitted and referenced by them: `scripts/g3_runner.mjs`.
