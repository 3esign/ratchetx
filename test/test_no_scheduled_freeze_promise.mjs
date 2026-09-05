// "The freeze is scheduled" is on the forbidden-claims list: it was measured and
// refuted, and docs/FREEZE.md was retitled "CANCELLED on 2026-09-03" to match.
//
// The gate's X1 row asks whether any surface still promises the 2026-09-08
// revocation. It reads four paths -- README.md, llms.txt, docs/AGENT_STATE.json,
// docs/FREEZE.md -- and matches three literal sentences. Measured 2026-09-05:
// three of those four are NOT DEPLOYED (this repo publishes 104 files and README
// and docs/ are not among them), and the one served file that still promises the
// date is not in the list and matches none of the three sentences:
//
//   api/proof.js:295
//     push('progauth', 'grey', 'Program upgrade authority retained until 2026-09-08', ...)
//
// A rendered badge on a page we serve. "Retained until" asserts an end date, and
// its own body text cites docs/FREEZE.md as the authority for a statement that
// document no longer makes.
//
// So this asks the question against the DEPLOY SET rather than a hand-written
// list, and it matches the DATE rather than sentences somebody already fixed. A
// check that greps for the exact wording we corrected can only ever be green.
//
// To satisfy it, say on the same line that the ceremony was cancelled. That is
// the whole rule: the date may appear anywhere, as history, as long as the line
// that carries it does not leave a reader thinking it is still coming.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDeployInput } from '../scripts/check-deploy-input.mjs';

const DATE = '2026-09-08';
// Any of these on the same line marks the mention as historical.
const CANCELLED = /cancell?ed|superseded|no longer|not scheduled|no freeze is scheduled|historical|retired|withdrawn|never executed/i;

const repo = fileURLToPath(new URL('..', import.meta.url));
const { files } = inspectDeployInput(repo);
assert.ok(files.length > 0, 'the deploy set is empty - check-deploy-input could not enumerate it');

const offenders = [];
let scanned = 0;
for (const rel of files) {
  let text;
  try { text = fs.readFileSync(path.join(repo, rel), 'utf8'); }
  catch { continue; }               // binary or unreadable: nothing to promise
  scanned += 1;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.includes(DATE)) return;
    if (CANCELLED.test(line)) return;
    offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}

assert.deepEqual(offenders, [],
  `these DEPLOYED lines still carry ${DATE} without saying the ceremony was cancelled:\n  `
  + offenders.join('\n  ')
  + `\n\n"The freeze is scheduled" is a forbidden claim - it was measured and refuted, and `
  + `docs/FREEZE.md is titled "CANCELLED on 2026-09-03". A served surface that says the `
  + `authority is "retained until ${DATE}" promises the revocation as plainly as any sentence `
  + `the X1 row greps for, and more visibly, because it renders. Fix the line or say on it `
  + `that the ceremony was cancelled on 2026-09-03.`);

console.log(`PASS  no scheduled freeze promise: ${scanned} deployed files scanned, `
  + `every mention of ${DATE} is marked historical`);
