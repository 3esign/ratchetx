// A stranger with no allocation: claim devnet credits, then seal one shot. Devnet only.
import fs from 'node:fs'; import { webcrypto } from 'node:crypto';
const ROOT = 'file:///D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/';
const { loadWeb3, confirmWithHttp } = await import(ROOT + 'skills/ratchetx-g2/scripts/g2-session.mjs');
const { createBrowserGame } = await import(ROOT + 'lib/g2/browser-game.mjs');
const config = JSON.parse(fs.readFileSync('D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/lib/g2/devnet-config.json', 'utf8'));
const web3 = loadWeb3();
const connection = new web3.Connection('https://api.devnet.solana.com', { commitment: 'confirmed', disableRetryOnRateLimit: true });
connection.confirmTransaction = (s, c) => confirmWithHttp(connection, s, c);
const kpPath = process.argv[2]; const mode = process.argv[3] || 'claim';
const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))));
const wallet = { publicKey: kp.publicKey, signTransaction: async tx => { tx.sign([kp]); return tx; } };
const mem = new Map(); const storage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
const game = createBrowserGame({ web3, connection, config, wallet, storage, cryptoImpl: webcrypto, onStatus: s => console.error('..', s.phase || JSON.stringify(s)) });
const j = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x?.toBase58 ? x.toBase58() : x);
const before = await game.load();
console.log('player', kp.publicKey.toBase58(), 'allocation', before.allocation, 'ledger', before.ledger ? j({ credits: before.ledger.credits, legacy: before.ledger.legacyCredits }) : null, 'slot', before.slot);
if (mode === 'claim') { const out = await game.claim(); console.log('CLAIM', out.signature, 'credits', out.ledger.credits.toString(), 'legacy', out.ledger.legacyCredits.toString()); }
if (mode === 'seal') { const out = await game.seal({ side: 0, pBps: 6000, stake: '100', expectedTargets: before.timing }); console.log('SEAL', j({ signature: out.signature, nonce: out.result?.shot?.nonce, kind: out.result?.kind, timing: before.timing })); }
if (mode === 'claim-again') { try { await game.claim(); console.log('SECOND CLAIM UNEXPECTEDLY OK'); } catch (e) { console.log('SECOND CLAIM REFUSED:', e.message.slice(0, 200)); } }
