'use strict';

// The capability never becomes generic wallet auth. Only a request object with
// a process-local permit and its exact reserved intent can enter canonical shot.
const kv = require('./kv.js');
const playerWrites = require('./player_writes.js');
const sessions = require('./play_session.js');
function fail(code) { throw Object.assign(new Error(code),{code}); }

function createBridge({service = sessions.createService({kv}), writes = playerWrites} = {}) {
  const verified = new WeakMap();
  function markVerified(req, permit, intent) {
    if (!req || typeof req !== 'object') fail('INVALID_SESSION_REQUEST');
    const context = service.permitContext(permit,intent);
    verified.set(req,{...context,permit,
      gameRequestId:`session:${context.id}:${context.requestId}`});
  }
  function isVerifiedRequest(req, body) {
    const context = req && verified.get(req);
    if (!context || !body || body.action !== 'shot') return false;
    const intent = context.intent;
    return body.auth?.wallet === context.wallet && body.requestId === context.gameRequestId
      && body.target === intent.target && body.side === intent.side
      && body.p === intent.p && body.stake === intent.stake;
  }
  async function acceptanceExtra(req, shot) {
    const context = req && verified.get(req);
    if (!context || !isVerifiedRequest(req,req.body)) fail('INVALID_SESSION_REQUEST');
    if (!shot || shot.requestId !== context.gameRequestId || shot.side !== context.intent.side
      || shot.sp !== context.intent.p || shot.stake !== context.intent.stake) fail('REQUEST_CONFLICT');
    const entry = await service.prepareAcceptance(context.permit,shot.id);
    // The transaction, not a pre-write clock check, enforces the grant deadline.
    writes.limitLease('lock:u:'+context.wallet,context.expiresAt);
    return entry;
  }
  async function recover(command, player) {
    const prepared = await service.prepareRecovery(command);
    if (!player || player.w !== command.wallet) fail('OWNER_PLAYER_MISMATCH');
    if (prepared.entry) await writes.save([player],[prepared.entry]);
    return {idempotent:prepared.idempotent,request:prepared.request};
  }
  return {service,markVerified,isVerifiedRequest,acceptanceExtra,recover};
}

module.exports = {...createBridge(),createBridge};
