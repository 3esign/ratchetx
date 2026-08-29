'use strict';
const { getJSONStrict, getCached } = require('../lib/kv.js');
const { RELEASE } = require('../lib/release.js');
const { b58decode } = require('../lib/verify.js');
const fs = require('fs');

function isWalletShaped(v) { return typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v); }

module.exports = async function agentReportCard(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, reason: 'GET only' });

  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, reason: 'id (wallet or demo-handle) required' });
  
  const isWallet = isWalletShaped(id);
  const isDemo = /^demo-[a-z0-9]{3,18}$/.test(id);
  if (!isWallet && !isDemo) return res.status(400).json({ ok: false, reason: 'invalid id format' });

  try {
    const p = await getJSONStrict(id);
    if (!p) return res.status(404).json({ ok: false, reason: 'agent not found or has no state' });

    const history = (await getCached(`hist:${id}`, 3_000)) || [];
    
    // Calculate stats
    let scored = 0;
    let voided = 0;
    const bins = { 0:[], 1:[], 2:[], 3:[], 4:[] };
    const feeds = {};
    const days = new Set();
    let totalScoredDuration = 0;
    
    for (const row of history) {
      if (row.res === 'void') {
        voided++;
        continue;
      }
      if (row.res === 'hit' || row.res === 'miss') {
        scored++;
        if (row.feed) feeds[row.feed] = (feeds[row.feed] || 0) + 1;
        if (row.t) {
           const d = new Date(row.t).toISOString().split('T')[0];
           days.add(d);
        }
        if (row.exp && row.sealedAt) {
           totalScoredDuration += (row.exp - row.sealedAt);
        }
        if (row.sp != null) {
           let b = Math.floor(Number(row.sp) * 5); // 0..4
           if (b >= 5) b = 4;
           if (b < 0) b = 0;
           bins[b].push(row);
        }
      }
    }
    
    const bn = p.bn || 0;
    const bsum = p.bsum || 0;
    const brier = bn > 0 ? Number((bsum / bn).toFixed(4)) : null;
    const brierVsHalf = brier !== null ? Number((1 - brier / 0.25).toFixed(4)) : null;
    
    const probBins = {};
    for (let i=0; i<5; i++) {
       if (bins[i].length >= 5) {
         probBins[`bin_${i*20}_to_${(i+1)*20}`] = {
           count: bins[i].length,
           hits: bins[i].filter(r => r.res === 'hit').length
         };
       }
    }
    
    const coverage = scored > 0 ? (totalScoredDuration / scored / 3600000).toFixed(1) + ' avg hrs' : null;
    const voidRate = (scored + voided) > 0 ? Number((voided / (scored + voided)).toFixed(3)) : 0;
    
    let status = 'PROVISIONAL';
    const feedCount = Object.keys(feeds).length;
    if (scored >= 30 && feedCount >= 3 && days.size >= 7) {
       status = 'ESTABLISHED';
    }
    
    // Look up shadow ledger receipt for latest
    let latestReceipt = null;
    if (fs.existsSync('data/shadow_ledger.ndjson')) {
      const lines = fs.readFileSync('data/shadow_ledger.ndjson', 'utf8').split('\n').filter(Boolean);
      // find latest for this identity
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const doc = JSON.parse(lines[i]);
          const shotIdMatch = history.find(r => r.id === doc.id);
          if (shotIdMatch) {
            latestReceipt = {
              digest: 'sha256:' + require('crypto').createHash('sha256').update(lines[i]).digest('hex'),
              result: doc.result,
              proofLink: `https://ratchetx.xyz/api/proof?id=${doc.id}`,
              settlementAuthority: doc.result === 'MATCH' ? 'ratchet-server AND independentPythReplay' : 'ratchet-server',
            };
            break;
          }
        } catch(e){}
      }
    }
    
    if (!latestReceipt && history.length > 0) {
      latestReceipt = {
         settlementAuthority: 'ratchet-server',
         independentPythReplay: 'pending'
      };
    }

    const reportCard = {
       identity: id,
       isSignedAgent: isWallet,
       status,
       eligibility: status === 'ESTABLISHED' ? 'Leaderboard Eligible' : 'Requires ESTABLISHED status to rank',
       stats: {
         scoredCalls: scored,
         voidCalls: voided,
         brierScore: brier,
         brierVsHalf,
         probabilityBins: probBins,
         feedDistribution: feeds,
         coverage,
         voidRate
       },
       latestReceipt
    };

    res.setHeader('cache-control', 'public, max-age=60');
    return res.json({ ok: true, v: RELEASE, reportCard });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: String(e && e.message || e) });
  }
};
