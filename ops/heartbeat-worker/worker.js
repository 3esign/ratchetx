const DEFAULT_TARGET = 'https://ratchetx.xyz/api/game';
const DEFAULT_SOLANA_WS = 'wss://api.mainnet-beta.solana.com/';
const SESSION_MS = 85_000;
const ACCOUNTS = [
  '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
  '4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo',
  '42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC',
  'DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX',
  'HMm3GPbdnqGwbkTnUUqCFsH8AMHDdEC3Lg8gcPD3HJSH',
  '7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5',
  '6B23K3tkb51vLZA14jcEQVCA1pfHptzEHFA93V5dYwbT',
];

export default {
  async scheduled(_controller, env, ctx) {
    // The poller is independent evidence fallback. The overlapping 85-second
    // subscriptions capture exact account transitions and are idempotent at
    // the durable store, so a cron boundary cannot create duplicate evidence.
    ctx.waitUntil(Promise.allSettled([
      runHeartbeat(env),
      runStream(env),
    ]));
  },

  async fetch(_request, env) {
    // A manual request remains a fast health/wakeup check. Long-lived stream
    // sessions are owned by Cron, not by a browser connection.
    return runHeartbeat(env);
  },
};

function target(env) {
  return String(env.TARGET || DEFAULT_TARGET).replace(/[?].*$/, '');
}

async function runHeartbeat(env) {
  const started = Date.now();
  try {
    const response = await fetch(`${target(env)}?action=heartbeat`, {
      headers: {
        accept: 'application/json',
        'user-agent': 'ratchet-sampler-worker/2.0',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const body = await response.text();
    if (!response.ok) {
      return Response.json({ ok:false, targetStatus:response.status,
        reason:body.slice(0,160), elapsedMs:Date.now()-started }, { status:502 });
    }
    let game;
    try { game = JSON.parse(body); } catch {
      return Response.json({ ok:false, reason:'target returned non-JSON',
        elapsedMs:Date.now()-started }, { status:502 });
    }
    if (!game.ok || game.src !== 'pyth-onchain' || !game.durable) {
      return Response.json({ ok:false, reason:'target health gate failed',
        game, elapsedMs:Date.now()-started }, { status:503 });
    }
    return Response.json({ ok:true, game, streamConfigured:!!env.CAPTURE_SECRET,
      elapsedMs:Date.now()-started });
  } catch (error) {
    return Response.json({ ok:false, reason:String(error && error.message || error),
      elapsedMs:Date.now()-started }, { status:502 });
  }
}

export function extractAccountNotification(message, subscriptions) {
  if (!message || message.method !== 'accountNotification') return null;
  const account = subscriptions.get(message.params && message.params.subscription);
  const result = message.params && message.params.result;
  const value = result && result.value;
  const data = value && value.data;
  if (!account || !value || !Array.isArray(data) || typeof data[0] !== 'string') return null;
  return {
    account,
    owner:String(value.owner || ''),
    data:data[0],
    slot:Number(result.context && result.context.slot),
  };
}

async function postUpdates(env, updates) {
  if (!updates.length) return { accepted:0, duplicates:0 };
  const response = await fetch(`${target(env)}?action=oracle-ingest`, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      authorization:`Bearer ${env.CAPTURE_SECRET}`,
      'user-agent':'ratchet-oracle-stream/1.0',
    },
    body:JSON.stringify({ action:'oracle-ingest', updates }),
    signal:AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ingest ${response.status}: ${body.slice(0,160)}`);
  const parsed = JSON.parse(body);
  if (!parsed.ok) throw new Error('ingest health gate failed');
  return parsed;
}

async function connectOnce(env, deadline, pending, stats, WebSocketImpl) {
  const ws = new WebSocketImpl(env.SOLANA_WS || DEFAULT_SOLANA_WS);
  const requests = new Map();
  const subscriptions = new Map();
  let requestId = 1;
  let flushTimer = null;
  let flushing = Promise.resolve();

  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!pending.size) return flushing;
    const batch = [...pending.values()];
    pending.clear();
    flushing = flushing.then(async () => {
      try {
        const result = await postUpdates(env, batch);
        stats.accepted += Number(result.accepted) || 0;
        stats.duplicates += Number(result.duplicates) || 0;
      } catch (error) {
        stats.postErrors++;
        // Preserve the newest event for each account and retry shortly. A
        // reconnect also sends the current account value, so the latest valid
        // transition remains recoverable without inventing a price.
        for (const item of batch) if (!pending.has(item.account)) pending.set(item.account, item);
        if (Date.now() + 500 < deadline && !flushTimer)
          flushTimer = setTimeout(flush, 500);
      }
    });
    return flushing;
  };

  const scheduleFlush = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 100);
  };

  return new Promise(resolve => {
    let finished = false;
    const finish = async reason => {
      if (finished) return;
      finished = true;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      await flush();
      await flushing.catch(() => {});
      resolve(reason);
    };
    const timer = setTimeout(() => {
      try { ws.close(1000, 'session rotation'); } catch {}
      finish('rotation');
    }, Math.max(1, deadline - Date.now()));

    ws.addEventListener('open', () => {
      stats.connections++;
      for (const account of ACCOUNTS) {
        const id = requestId++;
        requests.set(id, account);
        ws.send(JSON.stringify({ jsonrpc:'2.0', id, method:'accountSubscribe',
          params:[account, { encoding:'base64', commitment:'confirmed' }] }));
      }
    });

    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (Number.isInteger(message.id) && requests.has(message.id) &&
          Number.isInteger(message.result)) {
        subscriptions.set(message.result, requests.get(message.id));
        requests.delete(message.id);
        stats.subscriptions = Math.max(stats.subscriptions, subscriptions.size);
        return;
      }
      const update = extractAccountNotification(message, subscriptions);
      if (!update || !Number.isSafeInteger(update.slot)) return;
      pending.set(update.account, update);
      stats.notifications++;
      scheduleFlush();
    });

    ws.addEventListener('error', () => {
      stats.socketErrors++;
      try { ws.close(); } catch {}
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      finish('closed');
    });
  });
}

export async function runStream(env, options = {}) {
  const stats = { ok:false, configured:!!env.CAPTURE_SECRET, connections:0,
    subscriptions:0, notifications:0, accepted:0, duplicates:0,
    socketErrors:0, postErrors:0 };
  if (!env.CAPTURE_SECRET) return { ...stats, reason:'CAPTURE_SECRET missing' };

  const deadline = Date.now() + (Number(options.sessionMs) || SESSION_MS);
  const pending = new Map();
  const WebSocketImpl = options.WebSocket || WebSocket;
  let backoff = Number(options.backoffMs) || 250;
  while (Date.now() < deadline - 1000) {
    try {
      await connectOnce(env, deadline, pending, stats, WebSocketImpl);
    } catch {
      stats.socketErrors++;
    }
    if (Date.now() >= deadline - 1000) break;
    await new Promise(resolve => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, Number(options.maxBackoffMs) || 4000);
  }
  stats.ok = stats.subscriptions === ACCOUNTS.length && stats.postErrors === 0;
  return stats;
}
