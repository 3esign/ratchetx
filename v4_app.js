const PROGRAM_ID = new solanaWeb3.PublicKey('CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB');
const BTC_FEED = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const connection = new solanaWeb3.Connection('https://api.mainnet-beta.solana.com'); // WIP draft: set your own RPC locally - never commit API keys
let wallet = null;

const $ = id => document.getElementById(id);

connectWallet.onclick = async () => {
    if (!window.phantom || !window.phantom.solana) return alert("Install Phantom Wallet!");
    const resp = await window.phantom.solana.connect();
    wallet = resp.publicKey;
    walletStatus.innerText = "Connected: " + wallet.toBase58();
};

function buildCreateMatchIx(side, kind, targetBps) {
    const data = new Uint8Array(62);
    // discriminator: create_match
    data.set(new Uint8Array([107, 2, 184, 145, 70, 142, 17, 165]), 0);
    // feed_id
    data.set(new Uint8Array(BTC_FEED.match(/.{1,2}/g).map(byte => parseInt(byte, 16))), 8);
    // side (1 = YES, 0 = NO)
    data[40] = side;
    // kind (1 = Thr Up, 2 = Thr Down)
    data[41] = kind;
    // target_bps (100 = 1%)
    new DataView(data.buffer).setInt32(42, targetBps, true);
    // duration_secs (300 = 5 mins)
    new DataView(data.buffer).setBigInt64(46, 300n, true);
    // wager (0.1 SOL = 100,000,000 lamports)
    new DataView(data.buffer).setBigUint64(54, 100000000n, true);

    const ts = Math.floor(Date.now() / 1000);
    const tsBuf = new Uint8Array(8);
    new DataView(tsBuf.buffer).setBigInt64(0, BigInt(ts), true);
    
    const [gamePda] = solanaWeb3.PublicKey.findProgramAddressSync([
        new TextEncoder().encode("match"),
        wallet.toBytes(),
        tsBuf
    ], PROGRAM_ID);

    return new solanaWeb3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: gamePda, isSigner: false, isWritable: true },
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data
    });
}

async function sendTx(ix) {
    if (!wallet) return alert("Connect wallet first!");
    const tx = new solanaWeb3.Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = wallet;
    try {
        const { signature } = await window.phantom.solana.signAndSendTransaction(tx);
        console.log("Sent:", signature);
        alert("Transaction Sent! " + signature);
    } catch (e) {
        console.error(e);
        alert("Tx failed: " + e.message);
    }
}

btnYes.onclick = () => sendTx(buildCreateMatchIx(1, 100));
btnNo.onclick = () => sendTx(buildCreateMatchIx(0, 100));

async function fetchLobbies() {
    // memcmp filter for state = 0 (Open) at offset 142
    const filters = [
        { dataSize: 143 },
        { memcmp: { offset: 142, bytes: '1' } } // '1' is base58 for 0
    ];
    // wait, base58 for 0 is '1' in bs58 library!
    // Let's just fetch all 143 byte accounts and filter locally if memcmp is tricky
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 143 }]
    });
    
    let html = '';
    for (const acc of accounts) {
        const state = acc.account.data[142];
        if (state !== 0) continue; // Only open
        const creator = new solanaWeb3.PublicKey(acc.account.data.subarray(8, 40)).toBase58();
        const side = acc.account.data[40] === 1 ? 'YES' : 'NO';
        html += <div style="padding:10px; border:1px solid var(--ink2); margin-bottom:10px;">
            Creator: \<br>
            Side: \<br>
            <button onclick="joinMatch('\')" style="margin-top:10px;">JOIN MATCH</button>
        </div>;
    }
    if (html === '') html = 'No open lobbies found.';
    lobbyList.innerHTML = html;
}

window.joinMatch = (pubkeyStr) => {
    const game = new solanaWeb3.PublicKey(pubkeyStr);
    const data = new Uint8Array(8);
    // discriminator: join_match
    data.set(new Uint8Array([244, 8, 47, 130, 192, 59, 179, 44]), 0);
    
    const ix = new solanaWeb3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: game, isSigner: false, isWritable: true },
            { pubkey: wallet, isSigner: true, isWritable: true },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        data
    });
    sendTx(ix);
};

setInterval(fetchLobbies, 5000);
fetchLobbies();
