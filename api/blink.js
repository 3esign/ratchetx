const { getJSON } = require('../lib/kv');
const { b58decode } = require('../lib/verify');
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').replace(/\/$/, '');
const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://solana-rpc.publicnode.com';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// A legacy Solana transaction containing one Memo instruction. Keeping this
// tiny endpoint zero-dependency removes the web3 -> jayson -> uuid advisory
// chain from the production deployment. The 64 zero bytes are the fee payer's
// unsigned signature slot; the wallet replaces them when the Action is signed.
const shortvec = n => {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
};
function publicKeyBytes(s) {
  const b = Buffer.from(b58decode(String(s || '')));
  if (b.length !== 32) throw new Error('Account must be a Solana public key');
  return b;
}
function memoTransaction(account, blockhash, memo) {
  const payer = publicKeyBytes(account), program = publicKeyBytes(MEMO_PROGRAM);
  const recent = publicKeyBytes(blockhash), data = Buffer.from(memo, 'utf8');
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),                 // one signer; memo program readonly
    shortvec(2), payer, program,
    recent,
    shortvec(1),                           // one instruction
    Buffer.from([1]), shortvec(0), shortvec(data.length), data,
  ]);
  return Buffer.concat([shortvec(1), Buffer.alloc(64), message]).toString('base64');
}
async function latestBlockhash() {
  const r = await fetch(SOLANA_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(6000),
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getLatestBlockhash', params:[{ commitment:'confirmed' }] }),
  });
  if (!r.ok) throw new Error(`Solana RPC ${r.status}`);
  const j = await r.json();
  const h = j && j.result && j.result.value && j.result.value.blockhash;
  if (!h) throw new Error('Solana RPC returned no blockhash');
  return h;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids');
  res.setHeader('X-Action-Version', '2.1.3');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  if (action === 'anchor') {
    if (req.method === 'GET') {
      const response = {
        title: "Anchor the Ratchet Log",
        icon: PUBLIC_ORIGIN + "/og-v2.png",
        description: "Notarize the prediction log's current head hash onto the Solana ledger. Earn 25 XP in Ratchet (once per day).",
        label: "Anchor Log (+25 XP)",
        links: {
          actions: [
            {
              label: "Anchor (+25 XP)",
              href: "/api/blink?action=anchor"
            }
          ]
        }
      };
      return res.status(200).json(response);
    }

    if (req.method === 'POST') {
      try {
        const { account } = req.body;
        if (!account) return res.status(400).json({ error: 'Account is required' });

        const log = (await getJSON('g:log:head')) || null;
        let headHash = log ? log.h : 'GENESIS';
        let index = log ? log.i : 0;
        const memo = "RATCHET|" + index + "|" + headHash;

        const payload = {
          transaction: memoTransaction(account, await latestBlockhash(), memo),
          message: "Log Anchored! Your wallet will receive 25 XP (once per day)."
        };

        return res.status(200).json(payload);
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message });
      }
    }
  }

  return res.status(404).json({ error: 'Not found' });
};

module.exports.memoTransaction = memoTransaction;
