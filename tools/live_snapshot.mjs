// Take a fresh player snapshot from the LIVE store, in the shape
// tools/legacy_root.mjs already reads.
//
// WHY THIS EXISTS. The migration root is a claim about who owns what. Until now
// the only way to build one was from a rescue file -- and the only rescue file
// we have was taken on 2026-09-03 at 01:40, while the game was off the air
// because of the Supabase egress quota. The site has been live since, Bankr has
// played, and a root built from that file would be a precise, verifiable claim
// about a moment that has passed.
//
// So the root should be built from the store the game is actually using, at a
// moment somebody chose. This reads it. It writes nothing back, ever: the only
// Redis commands it sends are SCAN, MGET and PTTL.
//
// WHAT IT DOES NOT DECIDE. It does not filter, exclude, reconcile or judge. It
// copies `u:*` rows out and writes them down. Every rule about who becomes a
// leaf lives in legacy_root.mjs, where it is tested against the program's own
// hashing. A snapshot tool that also had opinions would be two sources of truth.
//
// Output goes to the private folder, never the repository -- it is every
// player's balance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

export const SNAPSHOT_TOOL_VERSION = '2026-09-05.2';

/** sha256 of a file, as the hex string written into the sibling .sha256. */
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** How many rows would change if they were parsed and re-serialised.
 *  This is not paranoia: JSON.parse/stringify silently rounds any integer past
 *  2^53 (9007199254740993 becomes ...992) and rewrites number formatting, so a
 *  digest taken over re-serialised rows is a digest of something the store never
 *  held. We keep the raw strings and we COUNT the drift rather than hide it. */
export function fidelityReport(rows) {
  let reserialised = 0, unparsable = 0;
  const examples = [];
  for (const [key, value, , raw] of rows) {
    if (typeof raw !== 'string') continue;
    let round;
    try { round = JSON.stringify(value); } catch { unparsable++; continue; }
    if (round !== raw) {
      reserialised++;
      if (examples.length < 5) examples.push(key);
    }
  }
  return { reserialised, unparsable, examples };
}

const clean = v => String(v || '').replace(/[\x00-\x1f\x7f]/g, '').trim();

function privateRoot() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!base || !path.isAbsolute(base)) throw new Error('PRIVATE_ROOT_UNAVAILABLE');
  return path.join(path.resolve(base), 'RatchetX', 'private-snapshots');
}

/** One Upstash REST call. Throws with the store's own words rather than a code. */
export function makeRedis(url, token, fetchImpl = fetch) {
  return async function redis(command) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error('kv ' + r.status + ': ' + (body.error || r.statusText));
    return body.result;
  };
}

/** Every player key, by SCAN. Never KEYS: this runs against a live store. */
export async function scanPlayers(redis, { batch = 500 } = {}) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, page] = await redis(['SCAN', cursor, 'MATCH', 'u:*', 'COUNT', String(batch)]);
    cursor = next;
    for (const key of page || []) keys.push(key);
  } while (cursor !== '0');
  keys.sort();
  return keys;
}

/** Rows as [key, value, expiresAt] -- the triple legacy_root.mjs reads.
 *  PTTL travels with the value on purpose: a row that is about to expire is not
 *  the same fact as a row that is permanent, and the reconciler is entitled to
 *  know the difference rather than be handed a null and told to assume. */
export async function readRows(redis, keys, { chunk = 100, now = Date.now() } = {}) {
  const rows = [];
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const values = await redis(['MGET', ...slice]);
    const ttls = [];
    for (const key of slice) ttls.push(await redis(['PTTL', key]));
    slice.forEach((key, j) => {
      const raw = (values || [])[j];
      if (raw == null) return;                       // vanished between SCAN and MGET
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      const ms = Number(ttls[j]);
      // -1 no expiry, -2 gone. Anything positive becomes an absolute instant,
      // because a relative TTL written into a file stops being true immediately.
      const expiresAt = Number.isFinite(ms) && ms > 0 ? new Date(now + ms).toISOString() : null;
      // Fourth element is the RAW store string, byte for byte. Existing readers
      // destructure the first three and are unaffected; the archive keeps what
      // the store actually returned rather than our re-serialisation of it.
      rows.push([key, value, expiresAt, typeof raw === 'string' ? raw : JSON.stringify(raw)]);
    });
  }
  return rows;
}

/** What the operator has to know before deciding to build a root now. */
export function census(rows) {
  let players = 0, openShots = 0, openStake = 0, latestExpiry = 0, demo = 0;
  for (const [key, value] of rows) {
    if (!key.startsWith('u:')) continue;
    players++;
    if (/^u:demo-[a-z0-9]{1,18}$/.test(key)) demo++;
    const open = value && Array.isArray(value.open) ? value.open : [];
    for (const shot of open) {
      const stake = Number(shot && shot.stake);
      if (Number.isFinite(stake) && stake > 0) { openShots++; openStake += stake; }
      const exp = Number(shot && shot.exp);
      if (Number.isFinite(exp) && exp > latestExpiry) latestExpiry = exp;
    }
  }
  return { players, demo, openShots, openStake, latestExpiry: latestExpiry || null };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (invoked) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, a => res(clean(a))));
  try {
    const url = clean(process.env.KV_REST_API_URL) || await ask('KV_REST_API_URL: ');
    const token = clean(process.env.KV_REST_API_TOKEN) || await ask('KV_REST_API_TOKEN: ');
    if (!url || !token) { console.log('Need both a URL and a token. Nothing was read.'); process.exit(2); }

    const redis = makeRedis(url, token);
    console.log('Scanning the live store for player rows ...');
    const keys = await scanPlayers(redis);
    console.log('  found ' + keys.length + ' player key(s)');
    const rows = await readRows(redis, keys);

    const root = privateRoot();
    fs.mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const takenAt = new Date().toISOString();

    // The reader's file keeps its exact three-element shape.
    const file = path.join(root, 'legacy-kv-' + stamp + '.ndjson');
    fs.writeFileSync(file, rows.map(r => JSON.stringify([r[0], r[1], r[2]])).join('\n') + '\n');

    // The archive's file keeps the store's own bytes. Deliberately NOT named
    // legacy-kv-*: legacy_root.mjs picks the newest file matching that prefix,
    // and it must never pick this one up as a source.
    const rawFile = path.join(root, 'legacy-raw-' + stamp + '.ndjson');
    fs.writeFileSync(rawFile, rows.map(r => JSON.stringify([r[0], r[3], r[2]])).join('\n') + '\n');

    const fileSha = sha256File(file);
    const rawSha = sha256File(rawFile);
    fs.writeFileSync(file + '.sha256', fileSha + '  ' + path.basename(file) + '\n');
    fs.writeFileSync(rawFile + '.sha256', rawSha + '  ' + path.basename(rawFile) + '\n');

    // A snapshot with no chain anchor is still a snapshot, but it is not a
    // MOMENT. If an RPC is reachable we pin one; if not we say so out loud
    // rather than writing a file that looks anchored and is not.
    let chainAnchor = null;
    const rpc = clean(process.env.SOLANA_RPC_URL);
    if (rpc) {
      try {
        const call = async (method, params = []) => {
          const r = await fetch(rpc, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          });
          const j = await r.json();
          if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
          return j.result;
        };
        chainAnchor = {
          finalizedSlot: await call('getSlot', [{ commitment: 'finalized' }]),
          genesisHash: await call('getGenesisHash'),
          rpc,
        };
      } catch (e) {
        chainAnchor = { error: String(e && e.message || e).slice(0, 200), rpc };
      }
    }

    const fidelity = fidelityReport(rows);
    const c = census(rows);
    const manifest = {
      tool: 'live_snapshot.mjs',
      toolVersion: SNAPSHOT_TOOL_VERSION,
      takenAt,
      readerFile: path.basename(file),
      readerSha256: fileSha,
      rawFile: path.basename(rawFile),
      rawSha256: rawSha,
      rowCount: rows.length,
      census: c,
      fidelity,
      chainAnchor,
      migrationId: clean(process.env.RATCHET_MIGRATION_ID) || null,
      note: 'rawFile holds the store bytes verbatim; readerFile is the three-element shape legacy_root.mjs consumes. Digests are over the files as written.',
    };
    const manifestFile = path.join(root, 'legacy-snapshot-' + stamp + '.manifest.json');
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

    console.log('');
    console.log('  wrote ' + file);
    console.log('  wrote ' + rawFile + '   (store bytes verbatim)');
    console.log('  wrote ' + manifestFile);
    console.log('  sha256 reader  ' + fileSha);
    console.log('  sha256 raw     ' + rawSha);
    if (fidelity.reserialised) {
      console.log('');
      console.log('  NOTE: ' + fidelity.reserialised + ' row(s) do not survive parse+stringify byte-exact.');
      console.log('  The raw file is authoritative for those rows. Examples: ' + fidelity.examples.join(', '));
    }
    if (!chainAnchor) {
      console.log('');
      console.log('  NOT ANCHORED: no SOLANA_RPC_URL, so this snapshot records a wall-clock');
      console.log('  time and not a chain moment. Set SOLANA_RPC_URL and re-run if the');
      console.log('  snapshot is going to become a migration root.');
    } else if (chainAnchor.error) {
      console.log('');
      console.log('  NOT ANCHORED: the RPC refused (' + chainAnchor.error + ').');
    } else {
      console.log('  anchored at finalized slot ' + chainAnchor.finalizedSlot);
    }
    if (!manifest.migrationId) {
      console.log('  no RATCHET_MIGRATION_ID set - the manifest records null, decide it before any root.');
    }
    console.log('  player rows          ' + String(c.players).padStart(7));
    console.log('  of those, demo       ' + String(c.demo).padStart(7) + '   excluded from any root');
    console.log('  open shots           ' + String(c.openShots).padStart(7));
    console.log('  credits committed    ' + String(c.openStake).padStart(7) + '   in flight, in nobody\'s cr');
    if (c.openShots) {
      const when = new Date(c.latestExpiry);
      const mins = Math.max(0, Math.ceil((c.latestExpiry - Date.now()) / 60000));
      console.log('');
      console.log('  A ROOT TAKEN NOW WOULD BE SHORT BY ' + c.openStake + ' CREDITS.');
      console.log('  The last open shot expires ' + when.toISOString() + ' (in about ' + mins + ' min).');
      console.log('  Settlement follows expiry, so take the snapshot after that and');
      console.log('  every stake is back in somebody\'s cr where a leaf can see it.');
    } else {
      console.log('');
      console.log('  No open shots. Every credit is in somebody\'s cr, which is the');
      console.log('  only condition under which this snapshot can become a root.');
    }
    console.log('');
    console.log('  Next:  node tools\\legacy_root.mjs');
  } catch (e) {
    console.error('\nFAILED: ' + (e && e.message || e));
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
