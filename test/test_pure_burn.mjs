// PURE BURNS ARE ALWAYS HONORED (h69).
//
// The Champion's Cut added strict podium-snapshot matching to decideBurn, and
// the strict path had one shape that could keep a player's tokens: a plain
// wallet -> incinerator burn (the oldest promise on the page: "paste the
// signature and we will credit it") carries no champion legs, matches no
// snapshot by construction, and was refused AFTER the RCX was already
// destroyed on-chain. h69 rescues exactly that shape — zero champion legs,
// outflow fully destroyed — and nothing else. These tests pin both sides:
// the rescue fires for pure burns, and every previously-refused abuse shape
// stays refused.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decideBurn } = require('../lib/burn.js');

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

const MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
const W   = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const C1  = 'ExtQrxJeSsvWxZADQS7mrpWvqq8w52VRcxLoCbh7cmqV';
const C2  = 'A5mxnvhCWmk4Wn2MPiKcz1n33qjTSQirNg4eP9vcAp1p';
const C3  = 'DJrqFArqzZzKfEJvzXvergFcYyLLNTyN6TqLA1zDw9Yk';
const INC = '1nc1nerator11111111111111111111111111111111';
const OUTSIDER = 'bBMzC1kJ5UGSJgYzXfBMSGSTLBrbYYd3wjF7VmzfxGp1'.slice(0, 43);

const DEC = 6;
const bal = (owner, ui) => ({ mint: MINT, owner,
  uiTokenAmount: { amount: String(Math.round(ui * 10 ** DEC)), decimals: DEC, uiAmount: ui } });

/** A parsed transaction whose token balances move by `moves` (owner -> delta). */
function tx(moves, { blockTime = Math.floor(Date.now() / 1000) - 30 } = {}) {
  const pre = [], post = [];
  const base = { [W]: 5_000_000, [INC]: 500, [C1]: 5_000_000, [C2]: 100, [C3]: 100, [OUTSIDER]: 0 };
  for (const [owner, start] of Object.entries(base)) {
    const d = moves[owner] || 0;
    if (d === 0 && !(owner in moves)) continue;
    pre.push(bal(owner, start));
    post.push(bal(owner, start + d));
  }
  return { blockTime, meta: { err: null, preTokenBalances: pre, postTokenBalances: post },
    transaction: { message: { accountKeys: [{ pubkey: W, signer: true }], instructions: [] } } };
}

const PODIUM = { v: 2, t: Date.now() - 60_000,
  list: [{ w: C1, pct: 0.5 }, { w: C2, pct: 0.3 }, { w: C3, pct: 0.2 }] };
const opts = (sets) => ({ wallet: W, mint: MINT, minAmount: 1,
  podiumSets: sets, podiumPct: 0.3 });

// ---- 1. THE PROMISE: a plain manual burn is credited in full ----
{
  const d = decideBurn(tx({ [W]: -1000, [INC]: 1000 }), opts([PODIUM]));
  ok(d.ok === true, `manual pure burn is accepted (${d.reason || 'ok'})`);
  ok(d.amount === 1000, `credited the full outflow (${d.amount})`);
  ok(d.burned === 1000 && d.champPaid === 0, 'all of it counted as burned, none as champion pay');
  ok(d.podiumVersion === 'pure-burn', `marked as a pure burn (${d.podiumVersion})`);
}

// ---- 2. the empty-podium day: a 100% site burn must also settle ----
{
  const d = decideBurn(tx({ [W]: -700, [INC]: 700 }),
    opts([{ t: Date.now() - 60_000, list: [] }]));
  ok(d.ok === true, `100% burn against an empty podium is accepted (${d.reason || 'ok'})`);
  ok(d.amount === 700, `and credited in full (${d.amount})`);
}

// ---- 3. a champion's own manual pure burn (previously refused) ----
{
  const d = decideBurn(tx({ [C1]: -1000, [INC]: 1000 }),
    { ...opts([PODIUM]), wallet: C1 });
  ok(d.ok === true, `a podium wallet's pure burn is accepted (${d.reason || 'ok'})`);
  ok(d.amount === 1000 && d.selfRouted === 0, 'credited in full, nothing counted as routed');
}

// ---- 4. the site-built 70/30 reload still matches its snapshot exactly ----
{
  const d = decideBurn(tx({ [W]: -1000, [INC]: 700, [C1]: 150, [C2]: 90, [C3]: 60 }),
    opts([PODIUM]));
  ok(d.ok === true, `a snapshot-matching reload still verifies (${d.reason || 'ok'})`);
  ok(d.podiumVersion !== 'pure-burn', `via the snapshot path, not the rescue (${d.podiumVersion})`);
  ok(d.champPaid === 300 && d.burned === 700, `legs and burn attributed (${d.champPaid}/${d.burned})`);
  ok(d.amount === 1000, `and the full gross is credited (${d.amount})`);
}

// ---- 5. paying anyone outside the podium is still refused outright ----
{
  const d = decideBurn(tx({ [W]: -1000, [INC]: 900, [OUTSIDER]: 100 }), opts([PODIUM]));
  ok(d.ok === false && /outside the published podium/.test(d.reason),
     `outside transfer refused (${d.reason})`);
}

// ---- 6. champion legs above the published 30% cut are still refused ----
{
  const d = decideBurn(tx({ [W]: -1000, [INC]: 500, [C1]: 500 }), opts([PODIUM]));
  ok(d.ok === false && /exceed the published 30%/.test(d.reason),
     `over-cut legs refused (${d.reason})`);
}

// ---- 7. legs that fit the cut but match no snapshot are still refused ----
// The rescue requires ZERO legs; a wrong split must keep failing loudly.
{
  const d = decideBurn(tx({ [W]: -1000, [INC]: 700, [C1]: 60, [C2]: 90, [C3]: 150 }),
    opts([PODIUM]));
  ok(d.ok === false && /does not match a podium snapshot/.test(d.reason),
     `mismatched legs still refused (${d.reason})`);
}

// ---- 8. small stakes survive floor-rounding across three seats ----
// Before h69 the gross reconstruction (round(destroyed / 0.7)) rounded one
// token high, that token was attributed to the NON-podium reloader as a
// phantom retained share, and the ghost seat made expected.size mismatch
// observed.size — refusing the reload. Every dust-carrying reload from a
// wallet without a podium seat failed this way.
{
  const gross = 40;                                  // tiny reload
  const burn = Math.floor(gross * 0.7);              // 28
  const pod = gross - burn;                          // 12
  const legs = { [C1]: Math.floor(pod * 0.5), [C2]: Math.floor(pod * 0.3), [C3]: Math.floor(pod * 0.2) }; // 6/3/2
  const dust = pod - legs[C1] - legs[C2] - legs[C3]; // 1 -> incinerator, like reload_build
  const d = decideBurn(tx({ [W]: -gross, [INC]: burn + dust, ...legs }), opts([PODIUM]));
  ok(d.ok === true, `a 40-token reload with rounding dust verifies (${d.reason || 'ok'})`);
}

// ---- 9. THE GHOST SEAT: a big non-podium reload with dust must verify ----
{
  const gross = 1_000_003;                           // messy Jupiter outAmount
  const burn = Math.floor(gross * 0.7);              // 700,002
  const pod = gross - burn;                          // 300,001
  const legs = { [C1]: Math.floor(pod * 0.5), [C2]: Math.floor(pod * 0.3), [C3]: Math.floor(pod * 0.2) };
  const dust = pod - legs[C1] - legs[C2] - legs[C3]; // 1
  const d = decideBurn(tx({ [W]: -gross, [INC]: burn + dust, ...legs }), opts([PODIUM]));
  ok(d.ok === true, `a new player's dusty reload verifies (${d.reason || 'ok'})`);
  ok(d.amount === gross, `and the full gross is credited (${d.amount})`);
  ok(d.selfRouted === 0, 'with no phantom retained share invented for them');
}

// ---- 10. a seated reloader's retained share still reconstructs ----
{
  const gross = 6316;                                // the shape seen live on 08-24
  const burn = Math.floor(gross * 0.7);              // 4421
  const pod = gross - burn;                          // 1895
  const legs = { [C2]: Math.floor(pod * 0.3), [C3]: Math.floor(pod * 0.2) }; // own seat skipped
  const dust = 0;
  const d = decideBurn(tx({ [C1]: -(burn + legs[C2] + legs[C3] + dust), [INC]: burn + dust, ...legs }),
    { ...opts([PODIUM]), wallet: C1 });
  ok(d.ok === true, `a champion's own reload still verifies (${d.reason || 'ok'})`);
  ok(d.selfRouted > 0, `and the retained seat share is reconstructed (${d.selfRouted})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nPURE BURN OK');
process.exit(fails ? 1 : 0);
