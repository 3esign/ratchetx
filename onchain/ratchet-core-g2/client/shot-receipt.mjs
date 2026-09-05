// Browser-only ShotArchived decoding. No RPC, wallet, Buffer or web3 dependency.
// ABI: programs/ratchet-core-g2/src/lib.rs::ShotArchived and state.rs::ShotResult.
// Public keys and hashes are copied Uint8Array(32); every u64/i64 is a bigint.
export const SHOT_ARCHIVED_SIZE = 319;
export const SHOT_RESULT_SIZE = 165;
// sha256("event:ShotArchived")[0..8]; independently derived in the source ABI test.
export const SHOT_ARCHIVED_DISCRIMINATOR = '5cb262d9a8a3b3cf';
const discriminator = Uint8Array.from(
  SHOT_ARCHIVED_DISCRIMINATOR.match(/../g), byte => parseInt(byte, 16));
const PROGRAM = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const programIdPattern = new RegExp('^' + PROGRAM + '$');
const invokePattern = new RegExp('^Program (' + PROGRAM + ') invoke \\[([1-9][0-9]*)\\]$');
const successPattern = new RegExp('^Program (' + PROGRAM + ') success$');
const failurePattern = new RegExp('^Program (' + PROGRAM + ') failed: .+$');
const hasDiscriminator = bytes => bytes.length >= 8 &&
  discriminator.every((value, index) => bytes[index] === value);

/** Decode one complete Anchor event, including its eight-byte discriminator.
 * Numeric enum bytes deliberately remain raw, including values unknown today.
 * This checks the ABI and nonce/page metadata, not economic correctness or hashes.
 */
export function decodeShotArchived(data) {
  if (!(data instanceof Uint8Array)) throw new TypeError('ShotArchived requires Uint8Array');
  if (data.byteLength !== SHOT_ARCHIVED_SIZE)
    throw new RangeError('ShotArchived must contain exactly ' + SHOT_ARCHIVED_SIZE + ' bytes');
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (!hasDiscriminator(bytes)) throw new TypeError('ShotArchived discriminator mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const take = length => { const result = bytes.slice(offset, offset + length); offset += length; return result; };
  const u8 = () => view.getUint8(offset++);
  const u16 = () => { const value = view.getUint16(offset, true); offset += 2; return value; };
  const u64 = () => { const value = view.getBigUint64(offset, true); offset += 8; return value; };
  const i64 = () => { const value = view.getBigInt64(offset, true); offset += 8; return value; };
  const event = {
    economyHash: take(32), player: take(32), nonce: u64(), pageIndex: u64(),
    slot: u8(), sequence: u8(), rowHash: take(32), resultsRoot: take(32),
    result: {
      rulesetHash: take(32), proofMaterial: take(32), state: u8(), voidReason: u8(),
      stake: u64(), sealedTs: i64(), entryTargetTs: i64(), exitTargetTs: i64(),
      side: u8(), pBps: u16(), delegate: take(32), gameResultHash: take(32),
    },
  };
  if (offset !== bytes.length) throw new RangeError('ShotArchived ABI length mismatch');
  if (event.slot >= 16 || event.sequence < 1 || event.sequence > 16)
    throw new RangeError('ShotArchived slot/sequence is outside HistoryPage capacity');
  if (event.pageIndex !== event.nonce / 16n || event.slot !== Number(event.nonce % 16n))
    throw new RangeError('ShotArchived nonce/page/slot mismatch');
  return event;
}

function decodeBase64(encoded) {
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new TypeError('Malformed Core Program data base64');
  const raw = atob(encoded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

/** Extract completed Core events from a successful getTransaction RESULT object.
 * Pass an explicit base58 coreProgramId; no default cluster or program is trusted.
 * Returns {event, transaction:{signature,slot}, provenance}[] in log order.
 * RPC logs are evidence supplied by that RPC, not signature/chain verification.
 * Complete invocation nesting is mandatory. A caught failed CPI (or ancestor)
 * rolls back its events even when the overall transaction reports success.
 * A single receipt does not prove HistoryPage completeness, its root, or economics.
 */
export function extractShotArchivedReceipts(transaction, { coreProgramId } = {}) {
  if (typeof coreProgramId !== 'string' || !programIdPattern.test(coreProgramId))
    throw new TypeError('An explicit base58 coreProgramId is required');
  if (!transaction || !transaction.meta || transaction.meta.err !== null)
    throw new TypeError('Receipt extraction requires meta.err === null');
  const logs = transaction.meta.logMessages;
  if (!Array.isArray(logs) || logs.some(line => typeof line !== 'string'))
    throw new TypeError('Transaction logMessages must be a complete string array');
  if (!Number.isSafeInteger(transaction.slot) || transaction.slot < 0)
    throw new TypeError('Transaction slot must be a nonnegative safe integer');
  const signatures = transaction.transaction?.signatures;
  const signature = Array.isArray(signatures) ? signatures[0] : null;
  if (typeof signature !== 'string' || !signature.trim())
    throw new TypeError('Transaction signature is missing');
  const receipts = [], stack = [];
  for (let logIndex = 0; logIndex < logs.length; logIndex++) {
    const line = logs[logIndex];
    // A program controls this entire string, including embedded newlines. Never
    // parse it as runtime provenance or as a sol_log_data event.
    if (line.startsWith('Program log:')) continue;
    if (/^Logs? truncated\b/i.test(line)) throw new TypeError('Truncated transaction logs');
    const invocation = invokePattern.exec(line);
    if (invocation) {
      if (Number(invocation[2]) !== stack.length + 1)
        throw new TypeError('Malformed invocation depth at log ' + logIndex);
      stack.push({ programId: invocation[1], start: logIndex, receipts: [] });
      continue;
    }
    const success = successPattern.exec(line), failure = failurePattern.exec(line);
    if (success || failure) {
      const programId = (success || failure)[1], frame = stack.at(-1);
      if (!frame || frame.programId !== programId)
        throw new TypeError('Unmatched invocation completion at log ' + logIndex);
      stack.pop();
      if (failure && !stack.length)
        throw new TypeError('Failed root invocation contradicts successful transaction');
      if (success) (stack.at(-1)?.receipts || receipts).push(...frame.receipts);
      continue;
    }
    if (/^Program \S+ (?:invoke|success|failed)\b/.test(line))
      throw new TypeError('Malformed invocation provenance at log ' + logIndex);
    if (line.startsWith('Program data:')) {
      const frame = stack.at(-1);
      if (!frame) throw new TypeError('Program data has no invocation provenance');
      if (frame.programId !== coreProgramId) continue;
      if (!line.startsWith('Program data: ')) throw new TypeError('Malformed Core Program data');
      const bytes = decodeBase64(line.slice('Program data: '.length));
      if (bytes.length < 8) throw new TypeError('Truncated Core event discriminator');
      if (!hasDiscriminator(bytes)) continue;
      frame.receipts.push({
        event: decodeShotArchived(bytes),
        transaction: { signature, slot: transaction.slot },
        provenance: {
          source: 'getTransaction.meta.logMessages', coreProgramId, logIndex,
          invocationLogIndex: frame.start, invocationDepth: stack.length,
          invocationPath: stack.map(item => item.programId), rpcReportedSuccess: true,
          independentVerification: false, historyPageVerified: false, economicsVerified: false,
        },
      });
    }
  }
  if (stack.length) throw new TypeError('Truncated or incomplete invocation stack');
  return receipts;
}
