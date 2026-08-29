const fs = require('fs');
const { Keypair } = require('@solana/web3.js');

function rotate(path) {
    if (fs.existsSync(path)) {
        const kp = Keypair.generate();
        fs.writeFileSync(path, '[' + kp.secretKey.toString() + ']');
        console.log('Rotated: ' + path);
    } else {
        console.log('Not found: ' + path);
    }
}
rotate('onchain/core-passport-benchmark/player-keypair.json');
rotate('onchain/core-passport-benchmark/ratchetAuth-keypair.json');
