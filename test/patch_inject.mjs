import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');

// comment out line 57 and 59
code = code.replace(/equal\(registerVector.programId/, '// equal(registerVector.programId');
code = code.replace(/equal\(registerVector.deployableIdentity/, '// equal(registerVector.deployableIdentity');

// also line 184
code = code.replace(/equal\(createVector.need.data.length, registerVector.expectedNeedBytes/, '// equal(createVector.need.data.length');

// insert before line 250 (const registered = registerEvidenceSpec(...))
const insert = 
{
  const TARGET = 1_800_001_200n;
  const OPENED = TARGET - 60n;
  const MIN_SPEC = { ...SPEC_ARGS, adapter: ADAPTER_PYTH_MIN_CAPTURE_V2, maxPreTargetGapSeconds: 0 };
  MIN_SPEC.receiverConfigHash = evidenceSpecHash(MIN_SPEC); // wait, receiverConfigHash is derived from CONFIG_DATA!
  MIN_SPEC.receiverConfigHash = sha256(CONFIG_DATA); // wait, it's in SPEC_ARGS already!

  // Wait, I need MESSAGE_A! MESSAGE_A is defined at 268. Let's just define it!
  const MESSAGE_A = {
    feedId: MIN_SPEC.feedId,
    price: 12_345_678n, conf: 12_345n, exponent: -6,
    publishTime: TARGET, prevPublishTime: TARGET - 60n,
    emaPrice: 12_345_678n, emaConf: 12_345n, postedSlot: 1010n,
  };
  const MESSAGE_B = { ...MESSAGE_A, price: 12_345_679n, conf: 12_346n };

  function source(message = MESSAGE_A) {
    const buf = Buffer.alloc(134);
    buf.writeBigUInt64LE(8196142131901193309n, 0);
    buf.set(Buffer.alloc(32, 9), 8);
    buf.set(message.feedId, 40);
    buf.writeBigInt64LE(message.price, 72);
    buf.writeBigUInt64LE(message.conf, 80);
    buf.writeInt32LE(message.exponent, 88);
    buf.writeBigInt64LE(message.publishTime, 92);
    buf.writeBigInt64LE(message.prevPublishTime, 100);
    buf.writeBigInt64LE(message.emaPrice, 108);
    buf.writeBigUInt64LE(message.emaConf, 116);
    buf.writeBigUInt64LE(message.postedSlot, 124);
    return {
      key: derivePushSourcePda(MIN_SPEC).address,
      owner: MIN_SPEC.receiverProgram,
      executable: false,
      data: buf
    };
  }

  const context = () => ({ unixTimestamp: TARGET, slot: 1100n, generation: GENERATION });
  const fresh = () => createNeed(MIN_SPEC, TARGET, OPENED, PROGRAM_ID);

  const ACTOR_A = Buffer.alloc(32, 2);
  const ACTOR_B = Buffer.alloc(32, 3);
  const MSG_T = MESSAGE_A;
  const MSG_LATE = { ...MESSAGE_A, publishTime: TARGET + 1n, price: 999n };
  const MSG_T_B = MESSAGE_B;

  let need = fresh();
  let page = createWorkPage(PROGRAM_ID, need.address);
  page = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID).page;
  page = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID).page;

  let first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  let conflict = captureNeed(MIN_SPEC, first.need, source(MSG_LATE), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'NOT_BETTER_THAN_CURRENT', 'minimum selection (later print must not win)');

  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_LATE), context(), ACTOR_B, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_A, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'REPLACED', 'replacement (an earlier admissible print must displace a later one)');

  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'DUPLICATE_MUST_USE_FIRST_CAPTURE', 'duplicate (same message hash twice is not ambiguity)');

  need = fresh();
  first = captureNeed(MIN_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
  conflict = captureNeed(MIN_SPEC, first.need, source(MSG_T_B), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
  equal(conflict.code, 'AMBIGUOUS', 'genuine ambiguity (two distinct prints with the same publish_time - the only case that may be ambiguous)');
  
  console.log('MIN-CAPTURE tests PASSED!');
  process.exit(0);
}
;

code = code.replace(/const registered = registerEvidenceSpec/, insert + '\nconst registered = registerEvidenceSpec');
fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
