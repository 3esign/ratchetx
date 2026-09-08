// Typed browser adapters over the canonical client's generated account map.
// Callers supply objects returned by validateEconomyAccount / validateRulesetAccount
// / validateShotAccount. Decoded fields alone cannot prove owner, hash or freshness.
// These functions build instructions only: no connection, wallet, signing or send.
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n), I64_MAX = (1n << 63n) - 1n;
const UTF8 = new TextEncoder();

function integer(value, min, max, label) {
  if (typeof value !== 'bigint' && !(typeof value === 'number' && Number.isSafeInteger(value)))
    throw new TypeError(label + ' must be a bigint or safe integer');
  const n = BigInt(value);
  if (n < min || n > max) throw new RangeError(label + ' is out of range');
  return n;
}
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new TypeError(label + ' must be an integer number');
  if (value < min || value > max) throw new RangeError(label + ' is out of range');
  return value;
}
function bytes32(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32)
    throw new TypeError(label + ' must contain exactly 32 bytes');
  return new Uint8Array(value);
}
function sameBytes(a, b, label) {
  if (a.length !== b.length || !a.every((byte, i) => byte === b[i]))
    throw new TypeError(label + ' mismatch');
}
function u64(value) {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, value, true);
  return data;
}

/** createPlayerActions({client, web3}) -> {claimLegacyIx, claimDevnetCreditsIx, revealIx}.
 * Uses injected, already-loaded web3; imports no packages or remote scripts.
 * Account objects must already have passed the canonical client validators.
 */
export function createPlayerActions({ client, web3 } = {}) {
  if (!web3?.PublicKey?.findProgramAddressSync || !web3?.SystemProgram?.programId)
    throw new TypeError('web3 PublicKey and SystemProgram are required');
  for (const name of ['buildIx', 'economyPda', 'rulesetPda', 'ledgerPda', 'shotPda',
    'playerDayPda', 'rankShardFor', 'rankShardPda', 'historyPagePda', 'commitmentHash'])
    if (typeof client?.[name] !== 'function') throw new TypeError('client.' + name + ' is required');
  const { PublicKey, SystemProgram } = web3;
  const key = (value, label) => {
    try { return new PublicKey(value); }
    catch { throw new TypeError(label + ' is not a public key'); }
  };
  const coreProgram = key(client.coreProgram, 'Core program');
  const timepinProgram = key(client.timepinProgram, 'Timepin program');
  const economyContext = economy => {
    if (economy?.schema !== 2 || economy.args?.schema !== 2 || economy.args?.timepinSchema !== 2)
      throw new TypeError('Economy schema mismatch');
    if (!key(economy.args.timepinProgram, 'Economy Timepin').equals(timepinProgram))
      throw new TypeError('Economy Timepin identity mismatch');
    const hash = bytes32(economy.economyHash, 'economyHash');
    const [address, bump] = client.economyPda(hash);
    if (number(economy.bump, 0, 255, 'Economy bump') !== bump)
      throw new TypeError('Economy PDA bump mismatch');
    return { hash, address };
  };

  /** Encode an existing migration claim. [] is the valid one-leaf proof.
   * Proof membership, cutover slot and previous-claim state are checked on chain;
   * this synchronous builder does not assert they have already passed.
   */
  const claimLegacyIx = ({ economy, player, credits, xp, proof } = {}) => {
    const context = economyContext(economy), playerKey = key(player, 'player');
    const amount = integer(credits, 0n, U64_MAX, 'credits');
    const experience = integer(xp, 0n, U64_MAX, 'xp');
    if (!amount && !experience) throw new RangeError('Claim credits and xp cannot both be zero');
    if (!bytes32(economy.args.legacyRoot, 'legacyRoot').some(Boolean))
      throw new TypeError('Economy has no legacy snapshot');
    if (amount > integer(economy.args.legacyTotalCredits, 0n, U64_MAX, 'legacyTotalCredits') ||
        experience > integer(economy.args.legacyTotalXp, 0n, U64_MAX, 'legacyTotalXp'))
      throw new RangeError('Claim exceeds immutable migration totals');
    if (!Array.isArray(proof) || proof.length > 32)
      throw new TypeError('proof must be an array of at most 32 siblings');
    const siblings = Array.from(proof, (item, i) => bytes32(item, 'proof[' + i + ']'));
    const payload = new Uint8Array(20 + siblings.length * 32), view = new DataView(payload.buffer);
    view.setBigUint64(0, amount, true); view.setBigUint64(8, experience, true);
    view.setUint32(16, siblings.length, true);
    siblings.forEach((sibling, i) => payload.set(sibling, 20 + i * 32));
    return client.buildIx('ratchet-core-g2', 'claim_legacy', {
      player: playerKey, economy: context.address,
      ledger: client.ledgerPda(context.hash, playerKey)[0], system_program: SystemProgram.programId,
    }, payload);
  };

  /** Devnet playground entry: any wallet, once per economy, DEVNET_PLAYGROUND_CREDITS
   * (10 000) into the legacy bucket. No arguments; the program checks the economy's
   * cluster genesis against devnet and refuses everywhere else, so this builder does not
   * pretend to know more than the chain does.
   */
  const claimDevnetCreditsIx = ({ economy, player } = {}) => {
    const context = economyContext(economy), playerKey = key(player, 'player');
    return client.buildIx('ratchet-core-g2', 'claim_devnet_credits', {
      player: playerKey, economy: context.address,
      ledger: client.ledgerPda(context.hash, playerKey)[0], system_program: SystemProgram.programId,
    }, new Uint8Array(0));
  };

  /** Build owner reveal only after checking the saved secret against the live Shot.
   * The live deadline, capacities and other accounts are still enforced on chain.
   */
  const revealIx = async ({ economy, ruleset, shotAddress, shot, side, pBps, salt } = {}) => {
    const context = economyContext(economy);
    if (ruleset?.schema !== 2 || ruleset.args?.schema !== 2 || shot?.schema !== 2)
      throw new TypeError('Ruleset/Shot schema mismatch');
    const rulesetHash = bytes32(ruleset.rulesetHash, 'rulesetHash');
    sameBytes(bytes32(ruleset.args.economyHash, 'Ruleset economyHash'), context.hash, 'Ruleset Economy');
    sameBytes(bytes32(shot.economyHash, 'Shot economyHash'), context.hash, 'Shot Economy');
    sameBytes(bytes32(shot.rulesetHash, 'Shot rulesetHash'), rulesetHash, 'Shot Ruleset');
    const [rulesetAddress, rulesetBump] = client.rulesetPda(rulesetHash);
    if (number(ruleset.bump, 0, 255, 'Ruleset bump') !== rulesetBump)
      throw new TypeError('Ruleset PDA bump mismatch');
    if (shot.state !== 3) throw new TypeError('Shot must be in AwaitReveal state (3)');
    const player = key(shot.player, 'Shot player'), rentRefund = key(shot.rentRefund, 'Shot rentRefund');
    const nonce = integer(shot.nonce, 0n, U64_MAX, 'Shot nonce');
    const scoreDay = integer(shot.scoreDay, I64_MIN, I64_MAX, 'Shot scoreDay');
    const [expectedShot, shotBump] = client.shotPda(context.hash, player, nonce);
    if (!key(shotAddress, 'shotAddress').equals(expectedShot) ||
        number(shot.bump, 0, 255, 'Shot bump') !== shotBump)
      throw new TypeError('Shot PDA mismatch');
    const direction = number(side, 0, 1, 'side'), probability = number(pBps, 1, 9999, 'pBps');
    const secret = bytes32(salt, 'salt');
    const expectedCommit = await client.commitmentHash({
      economyHash: context.hash, rulesetHash, player, nonce,
      side: direction, probability, salt: secret,
    });
    sameBytes(bytes32(shot.commit, 'Shot commitment'), expectedCommit, 'Shot commitment');
    const rank = number(shot.rankShard, 0, 15, 'Shot rankShard');
    if (rank !== await client.rankShardFor(player)) throw new TypeError('Shot rankShard mismatch');
    const rankShard = (await client.rankShardPda(context.hash, scoreDay, player))[0];
    const pageIndex = nonce / 16n;
    const workPage = PublicKey.findProgramAddressSync([
      UTF8.encode('work_page'), context.hash, player.toBytes(), u64(pageIndex),
    ], coreProgram)[0];
    const payload = new Uint8Array(35), view = new DataView(payload.buffer);
    payload[0] = direction; view.setUint16(1, probability, true); payload.set(secret, 3);
    return client.buildIx('ratchet-core-g2', 'reveal', {
      economy: context.address, ruleset: rulesetAddress,
      ledger: client.ledgerPda(context.hash, player)[0], shot: expectedShot,
      player_day: client.playerDayPda(context.hash, scoreDay, player)[0], rank_shard: rankShard,
      history_page: client.historyPagePda(context.hash, player, pageIndex)[0], work_page: workPage,
      player, rent_refund: rentRefund, system_program: SystemProgram.programId,
    }, payload);
  };
  return Object.freeze({ claimLegacyIx, claimDevnetCreditsIx, revealIx });
}
