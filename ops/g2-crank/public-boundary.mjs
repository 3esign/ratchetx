// Public maintenance has chain pins, not a bootstrap-wallet allowlist.
import { isDeepStrictEqual } from 'node:util';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAMS, DEVNET_GENESIS } from './public-pins.mjs';
import { createCoreG2Client, INSTRUCTION_ACCOUNTS, CORE_INSTRUCTION, TIMEPIN_INSTRUCTION } from '../../lib/g2/client-v2.mjs';

const fact = (ok, why) => { if (!ok) throw new Error(why); };
const pk = value => new web3.PublicKey(value);
const TIMEPIN = new Set(['capture_first', 'capture_conflict', 'finalize', 'expire']);
const CORE = new Set(['activate_entry', 'settle_final', 'void_pending_entry', 'void_active_shot', 'finalize_resolved_void', 'forfeit']);

export function assertChainBoundary(genesis, programs) {
  fact(genesis === DEVNET_GENESIS, 'Keeper genesis is not pinned devnet');
  fact(isDeepStrictEqual(programs, PROGRAMS), 'Keeper programs differ from pinned devnet programs');
}

export function operatorKey(value) {
  fact(typeof value === 'string' || value instanceof web3.PublicKey, 'Explicit operator public key is required');
  const key = pk(value);
  fact((typeof value !== 'string' || key.toBase58() === value) && web3.PublicKey.isOnCurve(key.toBytes()) && !key.equals(web3.SystemProgram.programId), 'Invalid operator public key');
  return key;
}

export function journalBinding(config, operator) {
  assertChainBoundary(config.clusterGenesis, config.programs);
  const hashes = {};
  for (const name of ['economyHash', 'rulesetHash', 'evidenceSpecHash']) {
    fact(typeof config[name] === 'string' && /^[a-f0-9]{64}$/i.test(config[name]), 'Invalid keeper ' + name);
    hashes[name] = config[name].toLowerCase();
  }
  return { schema: 2, purpose: 'G2_PUBLIC_KEEPER', clusterGenesis: DEVNET_GENESIS,
    programs: { ...PROGRAMS }, ...hashes, payer: operatorKey(operator).toBase58() };
}

export const createJournal = (config, operator) => ({ ...journalBinding(config, operator), events: [] });

export function assertJournal(journal, config, operator) {
  const expected = journalBinding(config, operator);
  fact(journal && Object.entries(expected).every(([name, value]) => isDeepStrictEqual(journal[name], value)),
    'Keeper journal belongs to another game/operator or an older format; use a separate public keeper journal');
  fact(Array.isArray(journal.events), 'Invalid keeper journal events');
  if (journal.pending) pendingBytes(journal);
  return journal;
}

// Applies both before signing and after decoding a saved signed transaction.
// It permits only public maintenance, its selected actor and pinned accounts.
export function assertMaintenance(operation, journal) {
  const { name, subject, instruction: ix } = operation;
  const timepin = TIMEPIN.has(name), core = CORE.has(name);
  fact(timepin || core, 'Keeper instruction is outside public maintenance');
  const crate = timepin ? 'rcx-timepin-v2' : 'ratchet-core-g2';
  const declared = INSTRUCTION_ACCOUNTS[crate][name].accounts;
  const discriminator = (timepin ? TIMEPIN_INSTRUCTION : CORE_INSTRUCTION)[name];
  const capture = name === 'capture_first' || name === 'capture_conflict';
  fact(ix?.programId?.equals(pk(timepin ? PROGRAMS.timepin : PROGRAMS.core)) &&
    ix.keys?.length === declared.length && ix.data?.length === (capture ? 40 : 8) &&
    Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from(discriminator, 'hex')), 'Keeper instruction program/data mismatch');
  const actor = operatorKey(journal.payer), accounts = {};
  declared.forEach((account, index) => {
    const actual = ix.keys[index];
    // Compiled messages promote duplicate accounts' privileges, e.g. when the
    // operator is also a shot's frozen rent refund destination.
    fact((!account.signer || actual.isSigner) && (!account.mut || actual.isWritable) &&
      (!actual.isSigner || actual.pubkey.equals(actor)), 'Keeper instruction signer/accounts mismatch');
    accounts[account.name] = actual.pubkey;
  });
  fact(accounts.actor.equals(actor), 'Keeper actor does not match selected operator');
  fact((timepin ? accounts.need : accounts.shot).equals(pk(subject)), 'Keeper instruction subject mismatch');
  const c = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
  const pins = { economy: c.economyPda(Buffer.from(journal.economyHash, 'hex'))[0],
    ruleset: c.rulesetPda(Buffer.from(journal.rulesetHash, 'hex'))[0],
    evidence_spec: c.evidenceSpecPda(Buffer.from(journal.evidenceSpecHash, 'hex'))[0],
    system_program: web3.SystemProgram.programId };
  for (const [name, expected] of Object.entries(pins)) if (accounts[name])
    fact(accounts[name].equals(expected), 'Keeper instruction pinned account mismatch: ' + name);
}

export function pendingBytes(journal) {
  const p = journal.pending;
  fact(p && typeof p.signedTransaction === 'string' && p.signedTransaction.length <= 1644,
    'Keeper pending transaction has no valid saved bytes');
  const raw = Buffer.from(p.signedTransaction, 'base64');
  fact(raw.length > 0 && raw.length <= 1232 && raw.toString('base64') === p.signedTransaction,
    'Keeper pending transaction encoding is invalid');
  const tx = web3.Transaction.from(raw);
  fact(tx.verifySignatures() && tx.signatures.length === 1 && tx.feePayer?.equals(operatorKey(journal.payer)) &&
    bs58.encode(tx.signature) === p.signature && tx.recentBlockhash === p.blockhash &&
    Number.isSafeInteger(p.lastValidBlockHeight) && p.lastValidBlockHeight >= 0 && tx.instructions.length === 1,
  'Keeper pending transaction signature/payer/blockhash mismatch');
  assertMaintenance({ name: p.name, subject: p.subject, instruction: tx.instructions[0] }, journal);
  return raw;
}
