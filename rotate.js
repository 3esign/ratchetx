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
rotate('.secret/player-keypair.json');
rotate('.secret/ratchetAuth-keypair.json');
rotate('api/player-keypair.json');
rotate('api/ratchetAuth-keypair.json');
