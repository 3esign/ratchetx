'use strict';

const game = require('./game.js');
const { RELEASE } = require('../lib/release.js');
const { publicSpec, cleanHandle, progressFromState } = require('../lib/gauntlet.js');

function send(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(body);
}

async function readCanonicalState(outerReq, handle) {
  let status = 200;
  let payload;
  let ended = false;
  const req = {
    method: 'GET',
    query: { action: 'state', wallet: 'demo-' + handle },
    body: null,
    headers: outerReq.headers || {},
    socket: outerReq.socket || {},
  };
  const res = {
    status(code) { status = code; return this; },
    setHeader() {},
    json(value) { payload = value; ended = true; return value; },
    end(value) {
      if (value) {
        try { payload = JSON.parse(String(value)); } catch { payload = value; }
      }
      ended = true;
    },
  };
  await game(req, res);
  if (!ended) throw new Error('canonical game state returned no response');
  if (status >= 400) throw new Error('canonical game state returned HTTP ' + status);
  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  if (req.method === 'OPTIONS') { res.status(204); return res.end(); }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return send(res, 405, { ok: false, v: RELEASE, reason: 'GET only' });
  }

  const raw = req.query && req.query.handle;
  if (raw == null || raw === '') {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return send(res, 200, {
      ok: true,
      v: RELEASE,
      gauntlet: publicSpec(),
      progress: null,
      next: 'call ratchet_new_demo through https://ratchetx.xyz/api/mcp',
    });
  }

  let handle;
  try { handle = cleanHandle(Array.isArray(raw) ? raw[0] : raw); }
  catch (error) {
    return send(res, 400, {
      ok: false,
      v: RELEASE,
      code: error.code || 'BAD_HANDLE',
      reason: error.message,
      next: 'call ratchet_new_demo and pass its returned handle',
    });
  }

  try {
    res.setHeader('Cache-Control', 'no-store');
    const state = await readCanonicalState(req, handle);
    return send(res, 200, {
      ok: true,
      v: RELEASE,
      gauntlet: publicSpec(),
      progress: progressFromState(state, handle),
      derivedFrom: 'GET /api/game?action=state&wallet=demo-' + handle,
    });
  } catch (error) {
    return send(res, 503, {
      ok: false,
      v: RELEASE,
      code: 'CANONICAL_STATE_UNAVAILABLE',
      reason: String(error && error.message || error),
      retryable: true,
    });
  }
};
