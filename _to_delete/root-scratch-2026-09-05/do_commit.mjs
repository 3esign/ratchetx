import { commitPaths } from './tools/git-commit-paths.mjs';
const msg = 	est: add MIN-CAPTURE S1 model tests

Rust host test must assert:
1. publish_time < current -> Replaced (reward assigned to new worker)
2. publish_time > current -> NotBetterThanCurrent
3. publish_time == current AND diff hash -> Ambiguous (no reward)
4. Same hash -> Duplicate (no-op);
commitPaths(process.cwd(), ['test/test_min_capture_logic.mjs', 'onchain/rcx-timepin/model-v2.mjs'], { message: msg });
