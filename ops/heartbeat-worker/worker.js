const DEFAULT_TARGET = 'https://ratchetx.xyz/api/game';
const DEFAULT_SOLANA_WS = [
  'wss://api.mainnet-beta.solana.com/',
  'wss://solana-rpc.publicnode.com/',
  'wss://solana.drpc.org/',
];
const SESSION_MS = 85_000;
const ACCOUNTS = [
  '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE',
  'APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5',
  '7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH',
  '3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w',
  '4KL8nVtrXmLjbbHtrDz5YCHNqmii62oHfr9bsUtx1bgi',
  'EitcZS5LtbR4EyNhCSy56vvUHPhsifSfWFG5gwSkjNpV',
  '9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG',
];

export default {
  async scheduled(_controller, env, ctx) {
    // The poller is independent evidence fallback. The overlapping 85-second
    // subscriptions capture exact account transitions and are idempotent at
    // the durable store, so a cron boundary cannot create duplicate evidence.
    ctx.waitUntil(runCycle(env));
  },

  async fetch(_request, env) {
    // A manual request remains a fast health/wakeup check. Long-lived stream
    // sessions are owned by Cron, not by a browser connection.
    return runHeartbeat(env);
  },
};

async function runCycle(env) {
  console.log('ratchet oracle cycle starting');
  const [heartbeat, stream] = await Promise.allSettled([
    runHeartbeat(env), runStream(env),
  ]);
  console.log(JSON.stringify({ event:'ratchet-oracle-cycle',
    heartbeat:heartbeat.status,
    stream:stream.status === 'fulfilled' ? stream.value
      : { ok:false, reason:String(stream.reason && stream.reason.message || stream.reason) } }));
}

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

function notificationKey(update) {
  return `${update.account}:${update.slot}:${update.data}`;
}

async function connectOnce(env, endpoint, deadline, pending, stats, WebSocketImpl,
    subscriptionTimeoutMs) {
  let ws;
  if (WebSocketImpl) {
    ws = new WebSocketImpl(endpoint);
  } else {
    // Cloudflare supports both client constructors and fetch-based upgrades.
    // Some Solana public RPC edges reject the constructor handshake from a
    // Worker but accept the explicit Upgrade request, which also exposes an
    // HTTP status when the handshake fails.
    const response = await fetch(endpoint.replace(/^wss:/, 'https:'), {
      headers:{ Upgrade:'websocket' },
    });
    ws = response.webSocket;
    if (!ws) throw new Error('websocket upgrade rejected with HTTP ' + response.status);
    ws.accept();
  }
  const requests = new Map();
  const subscriptions = new Map();
  let requestId = 1;
  let flushTimer = null;
  let flushing = Promise.resolve();
  let retryMs = 500, nextPostAt = 0;

  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!pending.size) return flushing;
    flushing = flushing.then(async () => {
      while (pending.size) {
        const entries = [...pending.entries()].slice(0, 32);
        for (const [key] of entries) pending.delete(key);
        const batch = entries.map(([, item]) => item);
        const waitMs = Math.max(0, nextPostAt - Date.now());
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        try {
          const result = await postUpdates(env, batch);
          stats.accepted += Number(result.accepted) || 0;
          stats.duplicates += Number(result.duplicates) || 0;
          retryMs = 500;
          nextPostAt = 0;
        } catch (error) {
          stats.postErrors++;
          stats.lastPostError = String(error && error.message || error).slice(0, 180);
          console.error('oracle ingest failed: ' + stats.lastPostError);
          // Put every unsent transition back. A Pyth account can change more
          // than once inside the 100ms batching window; keeping only the latest
          // state would erase the unique first-crossing settlement evidence.
          for (const [key, item] of entries) if (!pending.has(key)) pending.set(key, item);
          nextPostAt = Date.now() + retryMs;
          retryMs = Math.min(retryMs * 2, 10_000);
          if (nextPostAt < deadline && !flushTimer)
            flushTimer = setTimeout(flush, Math.max(1, nextPostAt - Date.now()));
          break;
        }
      }
    });
    return flushing;
  };

  const scheduleFlush = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 100);
  };

  return new Promise(resolve => {
    let finished = false;
    let subscriptionTimer = null;
    let rotationTimer = null;
    const finish = async reason => {
      if (finished) return;
      finished = true;
      if (subscriptionTimer) { clearTimeout(subscriptionTimer); subscriptionTimer = null; }
      if (rotationTimer) { clearTimeout(rotationTimer); rotationTimer = null; }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      await flush();
      await flushing.catch(() => {});
      resolve(reason);
    };
    rotationTimer = setTimeout(() => {
      try { ws.close(1000, 'session rotation'); } catch {}
      finish('rotation');
    }, Math.max(1, deadline - Date.now()));

    let subscribed = false;
    const subscribe = () => {
      if (subscribed) return;
      subscribed = true;
      stats.connections++;
      console.log('solana websocket open');
      for (const account of ACCOUNTS) {
        const id = requestId++;
        requests.set(id, account);
        ws.send(JSON.stringify({ jsonrpc:'2.0', id, method:'accountSubscribe',
          params:[account, { encoding:'base64', commitment:'confirmed' }] }));
      }
      const remaining = Math.max(1, deadline - Date.now() - 250);
      subscriptionTimer = setTimeout(() => {
        if (subscriptions.size === ACCOUNTS.length) return;
        stats.socketErrors++;
        stats.lastSocketError = `subscription gate confirmed ${subscriptions.size}/${ACCOUNTS.length}`;
        console.error('stream connection failed: ' + stats.lastSocketError);
        try { ws.close(1013, 'incomplete subscriptions'); } catch {}
        finish('subscription-gate');
      }, Math.min(subscriptionTimeoutMs, remaining));
    };
    ws.addEventListener('open', subscribe);

    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (Number.isInteger(message.id) && requests.has(message.id) &&
          Number.isInteger(message.result)) {
        subscriptions.set(message.result, requests.get(message.id));
        requests.delete(message.id);
        stats.subscriptions = Math.max(stats.subscriptions, subscriptions.size);
        if (subscriptions.size === ACCOUNTS.length) {
          if (subscriptionTimer) { clearTimeout(subscriptionTimer); subscriptionTimer = null; }
          console.log('seven Pyth accounts subscribed');
        }
        return;
      }
      const update = extractAccountNotification(message, subscriptions);
      if (!update || !Number.isSafeInteger(update.slot)) return;
      pending.set(notificationKey(update), update);
      stats.notifications++;
      scheduleFlush();
    });

    ws.addEventListener('error', () => {
      stats.socketErrors++;
      console.error('solana websocket error');
      try { ws.close(); } catch {}
    });
    ws.addEventListener('close', () => {
      finish('closed');
    });
    // fetch(Upgrade) sockets are already open after accept() and do not emit
    // the browser constructor's future open event.
    if (!WebSocketImpl) subscribe();
  });
}

export async function runStream(env, options = {}) {
  const stats = { ok:false, configured:!!env.CAPTURE_SECRET, connections:0,
    subscriptions:0, notifications:0, accepted:0, duplicates:0,
    socketErrors:0, postErrors:0 };
  if (!env.CAPTURE_SECRET) return { ...stats, reason:'CAPTURE_SECRET missing' };

  const deadline = Date.now() + (Number(options.sessionMs) || SESSION_MS);
  const pending = new Map();
  const WebSocketImpl = options.WebSocket || null;
  const endpoints = env.SOLANA_WS
    ? [env.SOLANA_WS, ...DEFAULT_SOLANA_WS.filter(endpoint => endpoint !== env.SOLANA_WS)]
    : DEFAULT_SOLANA_WS;
  let endpointIndex = 0;
  let backoff = Number(options.backoffMs) || 250;
  while (Date.now() < deadline - 1000) {
    try {
      await connectOnce(env, endpoints[endpointIndex], deadline, pending, stats, WebSocketImpl,
        Number(options.subscriptionTimeoutMs) || 6000);
    } catch (error) {
      stats.socketErrors++;
      stats.lastSocketError = String(error && error.message || error).slice(0, 180);
      console.error('stream connection failed: ' + stats.lastSocketError);
    }
    if (Date.now() >= deadline - 1000) break;
    endpointIndex = (endpointIndex + 1) % endpoints.length;
    await new Promise(resolve => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, Number(options.maxBackoffMs) || 4000);
  }
  stats.ok = stats.subscriptions === ACCOUNTS.length && stats.postErrors === 0;
  return stats;
}
