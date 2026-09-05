// Fixture-based tests for the P6 canary. No network: Loader-v3 accounts are synthesized around a real SBF ELF.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { sha256, elfInfo, parseProgramAccount, parseProgramData, verifyElfBytes, verifyProgram, compareReadsets, stateRegressions, NEED_ORDER, publishGaps, evaluateThresholds, LOADER_V3 } from '../tools/p6-canary/checks.mjs';
import { replay, race, rollback, timeout, foldScenario } from '../tools/p6-canary/actions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0; const eq = (a, b, m) => { checks++; assert.equal(a, b, m); }; const ok = (v, m) => { checks++; assert.ok(v, m); };

// ---- a real ELF (historical Timepin v0) wrapped in synthetic Loader-v3 accounts ----
const elf = readFileSync(join(root, 'onchain', 'rcx-timepin-v2', 'target', 'deploy', 'rcx_timepin_v2.so'));
const authority = new PublicKey('C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp').toBuffer();
const pdKey = PublicKey.findProgramAddressSync([new PublicKey('US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx').toBuffer()], new PublicKey(LOADER_V3))[0].toBuffer();
const programAccount = { owner: LOADER_V3, executable: true, data: Buffer.concat([Buffer.from([2, 0, 0, 0]), pdKey]) };
const mkPd = (auth, padding = 10_200, elfBytes = elf) => { const h = Buffer.alloc(45); h.writeUInt32LE(3, 0); h.writeBigUInt64LE(123_456n, 4); h[12] = auth ? 1 : 0; if (auth) auth.copy(h, 13); return { owner: LOADER_V3, data: Buffer.concat([h, elfBytes, Buffer.alloc(padding)]) }; };
const expected = { size: elf.length, sha256: sha256(elf), sbpfVersion: 0, authorityHex: authority.toString('hex') };

eq(elfInfo(elf).sbpfVersion, 0, 'historical elf is sbpf v0');
ok(parseProgramAccount(programAccount.data).ok, 'program account parses');
const pd = parseProgramData(mkPd(authority).data); ok(pd.ok, 'programdata parses'); eq(pd.slot, 123_456n, 'slot'); eq(Buffer.from(pd.authority).toString('hex'), authority.toString('hex'), 'authority');
const ve = verifyElfBytes(pd.elf, elf.length, sha256(elf)); ok(ve.ok, 'elf prefix hash + zero padding'); eq(ve.padding, 10_200, 'padding measured');
ok(!verifyElfBytes(Buffer.concat([elf, Buffer.from([1])]), elf.length, sha256(elf)).ok, 'nonzero padding rejected');

// PASS on the exact tuple
const v = verifyProgram({ programAccount, programDataAccount: mkPd(authority), programDataKey: pdKey, expected }); ok(v.ok, `program verifies: ${v.problems}`);
// drift: authority changed
ok(!verifyProgram({ programAccount, programDataAccount: mkPd(Buffer.alloc(32, 9)), programDataKey: pdKey, expected }).ok, 'authority drift detected');
// drift: authority removed (frozen) while tuple expects an authority
ok(!verifyProgram({ programAccount, programDataAccount: mkPd(null), programDataKey: pdKey, expected }).ok, 'authority NONE vs pinned pubkey detected');
// frozen tuple accepts NONE
ok(verifyProgram({ programAccount, programDataAccount: mkPd(null), programDataKey: pdKey, expected: { ...expected, authorityHex: null } }).ok, 'frozen tuple verifies with NONE');
// drift: one flipped byte in the elf
const bad = Buffer.from(elf); bad[1000] ^= 0xff;
ok(!verifyProgram({ programAccount, programDataAccount: mkPd(authority, 0, bad), programDataKey: pdKey, expected }).ok, 'elf byte flip detected');
// sbpf pin: tuple says v3, artifact is v0
const s = verifyProgram({ programAccount, programDataAccount: mkPd(authority), programDataKey: pdKey, expected: { ...expected, sbpfVersion: 3 } }); ok(!s.ok && s.problems.some(p => p.startsWith('sbpf')), 'sbpf version mismatch detected');
// wrong link
ok(!verifyProgram({ programAccount, programDataAccount: mkPd(authority), programDataKey: Buffer.alloc(32, 1), expected }).ok, 'program->programdata link mismatch detected');

// ---- rpc agreement ----
const A = Buffer.from('hello').toString('base64'), B = Buffer.from('world').toString('base64');
ok(compareReadsets({ r1: { slot: 10, accounts: { x: A, y: null } }, r2: { slot: 12, accounts: { x: A, y: null } } }).ok, 'agreement');
const dis = compareReadsets({ r1: { slot: 10, accounts: { x: A } }, r2: { slot: 10, accounts: { x: B } } }); ok(!dis.ok && dis.disagreements.length === 1, 'disagreement counted');
ok(!compareReadsets({ r1: { slot: 1, accounts: {} } }).ok, 'single endpoint refused');

// ---- monotonicity ----
eq(stateRegressions({ n: 0 }, { n: 1 }, NEED_ORDER).length, 0, 'Open->Candidate ok');
eq(stateRegressions({ n: 1 }, { n: 2 }, NEED_ORDER).length, 0, 'Candidate->Final ok');
eq(stateRegressions({ n: 2 }, { n: 1 }, NEED_ORDER).length, 1, 'Final->Candidate is a regression');
eq(stateRegressions({ n: 2 }, { n: 3 }, NEED_ORDER).length, 1, 'Final->Ambiguous terminal kind change flagged');
eq(stateRegressions({ n: 0 }, { n: 4 }, NEED_ORDER).length, 0, 'Open->Expired ok');

// ---- oracle gaps ----
const g = publishGaps([100, 105, 110, 400, 405]); eq(g.maxGap, 290, 'max gap'); eq(g.samples, 5, 'samples');

// ---- thresholds ----
const base = { ticks: 10, genesisMismatch: 0, rpcDisagreement: 0, authorityDrift: 0, sbpfMismatch: 0, stateRegression: 0, founderReachable: 0, tickGaps: 0, oracleMaxGap: 120, lifecycles: 0, writeSideWired: false, replayAccepted: 0, raceDoubleLand: 0, rollbackLeak: 0, earlyTimeoutAccepted: 0, outcomes: {} };
const th = { oracleMaxGapSeconds: 600, minLifecycles: 200, hours: 72 };
const e1 = evaluateThresholds(base, th); ok(e1.verdict.startsWith('INCOMPLETE'), 'unwired write-side is INCOMPLETE, never PASS'); ok(e1.rows.filter(r => r.status === 'SKIPPED').length === 5, 'five write-side rows skipped');
const e2 = evaluateThresholds({ ...base, writeSideWired: true, lifecycles: 250 }, th); eq(e2.verdict, 'PASS', 'wired + enough lifecycles passes');
const e3 = evaluateThresholds({ ...base, writeSideWired: true, lifecycles: 250, authorityDrift: 1 }, th); eq(e3.verdict, 'FAIL', 'one drift event fails the window');
const e4 = evaluateThresholds({ ...base, writeSideWired: true, lifecycles: 250, founderReachable: 1 }, th); eq(e4.verdict, 'FAIL', 'a reachable founder service fails the window');
const e5 = evaluateThresholds({ ...base, writeSideWired: true, lifecycles: 250, oracleMaxGap: 900 }, th); eq(e5.verdict, 'FAIL', 'oracle gap over limit fails');

// ---- scenarios with a fake adapter ----
function fakeAdapter({ replayRejects = true, raceSingle = true, leak = false, earlyRejects = true }) {
  let landedOnce = false; let bytes = 'aaaa'; let clock = 1000;
  return {
    clock: async () => ({ slot: clock, unixTimestamp: clock }),
    readback: async () => ({ stateName: 'x', bytesSha256: bytes }),
    deadline: async () => ({ unixTimestamp: 1005 }),
    expectedReplayError: () => 'WrongState',
    expectedEarlyError: () => 'DeadlineOpen',
    submit: async (op, subject, actor) => {
      if (op === 'forfeit') { if (clock < 1005) { if (!earlyRejects) return { sig: 'e', landed: true, error: null }; return { sig: 'e', landed: false, error: 'custom program error: DeadlineOpen' }; } return { sig: 'l', landed: true, error: null }; }
      if (op === 'void_active_shot') { if (leak) bytes = 'bbbb'; return { sig: 'v', landed: false, error: 'WrongTerminalKind' }; }
      if (!landedOnce) { landedOnce = true; return { sig: 's1', landed: true, error: null }; }
      if (!replayRejects || !raceSingle) return { sig: 's2', landed: true, error: null };
      return { sig: 's2', landed: false, error: 'custom program error: WrongState' };
    },
    _advance: () => { clock = 1010; },
  };
}
const actors = [{ name: 'a', pubkey: 'A' }, { name: 'b', pubkey: 'B' }];
eq((await replay(fakeAdapter({}), { subject: 'S', op: 'settle_final', actor: actors[0] })).status, 'PASS', 'replay rejected -> PASS');
eq((await replay(fakeAdapter({ replayRejects: false }), { subject: 'S', op: 'settle_final', actor: actors[0] })).status, 'FAIL', 'replay accepted -> FAIL');
eq((await race(fakeAdapter({}), { subject: 'S', op: 'settle_final', actors })).status, 'PASS', 'single landing -> PASS');
eq((await race(fakeAdapter({ raceSingle: false }), { subject: 'S', op: 'settle_final', actors })).status, 'FAIL', 'double landing -> FAIL');
eq((await rollback(fakeAdapter({}), { subject: 'S', op: 'void_active_shot', actor: actors[0] })).status, 'PASS', 'rejected op leaves bytes -> PASS');
eq((await rollback(fakeAdapter({ leak: true }), { subject: 'S', op: 'void_active_shot', actor: actors[0] })).status, 'FAIL', 'state leak -> FAIL');
{ const ad = fakeAdapter({}); const r = await timeout(ad, { subject: 'S', op: 'forfeit', actor: actors[0], waitUntil: async () => ad._advance() }); eq(r.status, 'PASS', 'early rejected + late landed -> PASS'); }
{ const ad = fakeAdapter({ earlyRejects: false }); const r = await timeout(ad, { subject: 'S', op: 'forfeit', actor: actors[0], waitUntil: async () => ad._advance() }); eq(r.status, 'FAIL', 'early acceptance -> FAIL'); }
eq((await replay(null, { subject: 'S', op: 'settle_final', actor: actors[0] })).status, 'SKIPPED', 'no adapter -> SKIPPED');
const c = { ...base }; foldScenario(c, { scenario: 'replay', status: 'SKIPPED' }); ok(!c.writeSideWired, 'skipped does not wire'); foldScenario(c, { scenario: 'replay', status: 'FAIL' }); ok(c.writeSideWired && c.replayAccepted === 1, 'fail counted');

console.log(`p6 canary: ${checks} checks passed`);
