import fs from 'fs';
let code = fs.readFileSync('onchain/rcx-timepin/model-v2.mjs', 'utf8');

const insert = 
  if (spec.adapter === ADAPTER_PYTH_MIN_CAPTURE_V2) {
    const oldPub = asBig(firstCandidate.publishTime);
    const newPub = asBig(checked.message.publishTime);
    if (newPub < oldPub) {
      const next = cloneNeed(need);
      next.candidateAHash = Buffer.from(checked.messageHash);
      return {
        ok: true, code: 'REPLACED', need: next, candidate,
        messageHash: checked.messageHash, workPage, changed: true,
      };
    }
    if (newPub > oldPub) {
      return { ok: false, code: 'NOT_BETTER_THAN_CURRENT', need, candidate: null, workPage, changed: false };
    }
  }
;

code = code.replace(/  const next = cloneNeed\(need\);\n  next\.state = 'Ambiguous';/, insert + "\n  const next = cloneNeed(need);\n  next.state = 'Ambiguous';");
fs.writeFileSync('onchain/rcx-timepin/model-v2.mjs', code);
