// P1 asks whether the economy manifest is APPROVED rather than a draft.
//
// The gate's own P1 row asked JSON.stringify(manifest).includes('DRAFT'), which
// is a search of the whole document for six letters. On 2026-09-05 that row
// turned the manifest RED for a reason that has nothing to do with approval:
// commit 7ca9be5 recorded Semir's signature and, alongside it, the HISTORY it
// replaced --
//
//   approval.signingStatementContext: "... The status this replaces was:
//   DRAFT - NOT APPROVED FOR REGISTRATION; ..."
//
// -- so the manifest said APPROVED in its status field and PENDING in the gate,
// from the very commit that recorded the approval. It printed "status is DRAFT -
// NOT APPROVED BY THE OWNER" about a manifest whose status is "APPROVED BY THE
// OWNER 2026-09-05". I reported 4 of 21 blocking while it was 5, because I read
// the row's name instead of its output.
//
// A record of what a document USED TO SAY is not the document saying it. The
// check therefore reads STATUS FIELDS, by key, at any depth - and prose is
// prose. That is not a weakening: the old row could not see a nested status of
// "DRAFT" either (it saw the same six letters wherever they were and could not
// tell which), and it treated a manifest with NO status at all as approved,
// which is the vacuous pass that P2 was rewritten to stop.
//
// Every rule below is proved RED in this same file against mutated copies, so
// the predicate cannot rot into one that passes everything.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PATH = new URL('../releases/g2-mainnet-economy.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(PATH, 'utf8'));

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };

// A key is a status field when the key itself is named one - not when a
// sentence somewhere happens to quote one.
const IS_STATUS_KEY = /^(status|state|approvalstatus)$/i;

export function draftReasons(m) {
  const reasons = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return ['the manifest is not a JSON object, so it carries no approval at all'];
  }
  (function walk(node, path) {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (typeof node !== 'string') return;
    const key = path.split('.').pop();
    if (!IS_STATUS_KEY.test(key)) return;
    const value = node.trim().toUpperCase();
    if (value.startsWith('DRAFT') || value.includes('NOT APPROVED')) {
      reasons.push(`${path} is "${node.trim().slice(0, 80)}"`);
    }
  })(m, '');

  // A missing statement is a failure, never a pass. The whole class of defect
  // this gate keeps finding is a comparison that silently did not happen.
  const top = m.status;
  if (typeof top !== 'string' || !top.trim()) {
    reasons.push('the manifest has no top-level status field, so nothing states that it was approved');
  } else if (!top.toUpperCase().includes('APPROVED')) {
    reasons.push(`the top-level status is "${top.trim().slice(0, 80)}", which does not say approved`);
  }
  const a = m.approval;
  if (!a || typeof a !== 'object') {
    reasons.push('the manifest carries no approval block');
  } else {
    if (typeof a.approvedBy !== 'string' || !a.approvedBy.trim()) {
      reasons.push('approval.approvedBy is missing, so the approval names no owner');
    }
    if (typeof a.signingStatement !== 'string' || !a.signingStatement.trim()) {
      reasons.push('approval.signingStatement is missing, so no one signed it in their own words');
    }
  }
  return reasons;
}

// ---- the manifest in this tree -------------------------------------------
const live = draftReasons(manifest);
ok(live.length === 0, `the economy manifest is not approved: ${live.join('; ')}`);

// ---- the predicate, proved red -------------------------------------------
const copy = () => JSON.parse(JSON.stringify(manifest));
const mustFail = (label, mutate) => {
  const m = copy();
  mutate(m);
  const r = draftReasons(m);
  checks += 1;
  assert.ok(r.length > 0, `MUTATION NOT CAUGHT: ${label} still reads as approved. `
    + 'A check that cannot fail is not a check.');
};

mustFail('top-level status set back to DRAFT', m => { m.status = 'DRAFT - NOT APPROVED FOR REGISTRATION'; });
mustFail('top-level status deleted', m => { delete m.status; });
mustFail('top-level status blanked', m => { m.status = '   '; });
mustFail('top-level status says NOT APPROVED', m => { m.status = 'NOT APPROVED BY THE OWNER'; });
mustFail('a NESTED status set to DRAFT', m => { m.approval.identityResolution.status = 'DRAFT'; });
mustFail('a nested status the old substring row could not name', m => {
  m.evidenceSpecTemplate = { ...(m.evidenceSpecTemplate || {}), status: 'draft, pending review' };
});
mustFail('the approval block deleted', m => { delete m.approval; });
mustFail('approvedBy deleted', m => { delete m.approval.approvedBy; });
mustFail('signingStatement deleted', m => { delete m.approval.signingStatement; });
checks += 1;
assert.ok(draftReasons([]).length > 0, 'an array is not an approved manifest');

// ---- and proved GREEN where the old row was wrong -------------------------
// This is the false red of 2026-09-05, pinned so it cannot come back: history,
// recorded in prose, is not a status.
{
  const m = copy();
  m.approval.somethingHistorical =
    'The status this replaces was: DRAFT - NOT APPROVED FOR REGISTRATION; build authorization still required';
  m.notes = 'Earlier revisions of this file were a DRAFT and were NOT APPROVED.';
  const r = draftReasons(m);
  checks += 1;
  assert.ok(r.length === 0,
    'prose recounting an earlier DRAFT was treated as the manifest BEING a draft: ' + r.join('; '));
}

console.log(`ok - the economy manifest is approved, and the predicate fails on 9 mutations (${checks} checks)`);
