const fs = require('fs');
const content = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');
const lines = content.split('\n');
const imports = lines.slice(0, 31).join('\n');
const helpers = lines.slice(90, 140).join('\n') + '\n' + lines.slice(249, 267).join('\n') + '\n' + lines.slice(267, 340).join('\n');
const tests = \
{
  const fresh = () => createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  const MIN_SPEC = { ...LIVE_SPEC, adapter: ADAPTER_PYTH_MIN_CAPTURE_V2 };
  
  const MSG_T = MESSAGE_A;
  const MSG_LATE = { ...MESSAGE_A, publishTime: TARGET + 1n, price: 999n };
  const MSG_T_B = MESSAGE_B;

  let need = fresh();
  let page = createWorkPage(PROGRAM_ID, need.address);
  page = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID).page;
  page = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID).page;

  // 1. minimum selection (later print must not win)
  let first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  let conflict = captureNeed(MIN_SPEC, first.need, source(MSG_LATE), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'NOT_BETTER_THAN_CURRENT', 'minimum selection (later print must not win)');

  // 2. replacement (an earlier admissible print must displace a later one)
  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_LATE), context(), ACTOR_B, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_A, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'REPLACED', 'replacement (an earlier admissible print must displace a later one)');

  // 3. duplicate (same message hash twice is not ambiguity)
  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'DUPLICATE_MUST_USE_FIRST_CAPTURE', 'duplicate (same message hash twice is not ambiguity)');

  // 4. genuine ambiguity (two distinct prints with the same publish_time - the only case that may be ambiguous)
  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T_B), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'AMBIGUOUS', 'genuine ambiguity (two distinct prints with the same publish_time)');
  console.log('MIN-CAPTURE logic: ' + checks + ' checks passed');
}
\;
fs.writeFileSync('test/test_min_capture_logic.mjs', imports + '\n' + helpers + tests);
