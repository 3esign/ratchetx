const TARGET = 'https://ratchetx.xyz/api/game?action=heartbeat';

export default {
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(run());
  },
  async fetch() {
    return run();
  },
};

async function run() {
  const started = Date.now();
  try {
    const response = await fetch(TARGET, {
      headers: {
        accept: 'application/json',
        'user-agent': 'ratchet-sampler-worker/1.0',
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
    return Response.json({ ok:true, game, elapsedMs:Date.now()-started });
  } catch (error) {
    return Response.json({ ok:false, reason:String(error && error.message || error),
      elapsedMs:Date.now()-started }, { status:502 });
  }
}