/**
 * RATCHET SEAL V3 - Pyth VAA Archiver
 * 
 * This script connects to the free Pyth Hermes WebSocket and saves VAAs locally.
 * It ensures we always have the exact crossing VAA for settlement without paying for
 * Pyth Enterprise Historical APIs.
 * 
 * Run this continuously on a VPS (e.g. using pm2):
 * pm2 start scripts/vaa_archiver.js
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// SOL/USD Feed ID
const SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const DB_PATH = path.join(__dirname, '..', 'vaa_archive.sqlite');

// Init DB
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS vaas (
            publish_time INTEGER PRIMARY KEY,
            feed_id TEXT,
            vaa TEXT
        )
    `);
});

function startArchiver() {
    console.log('Connecting to Pyth Hermes WebSocket...');
    const ws = new WebSocket('wss://hermes.pyth.network/ws');

    ws.on('open', () => {
        console.log('Connected! Subscribing to SOL/USD...');
        ws.send(JSON.stringify({
            type: 'subscribe',
            price_ids: [SOL_FEED_ID]
        }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'price_update' && msg.price_feed && msg.price_feed.vaa) {
                const publishTime = msg.price_feed.price.publish_time;
                const vaa = msg.price_feed.vaa;
                
                // Store in DB
                db.run('INSERT OR IGNORE INTO vaas (publish_time, feed_id, vaa) VALUES (?, ?, ?)', 
                    [publishTime, SOL_FEED_ID, vaa], 
                    (err) => {
                        if (err) console.error('DB Error:', err);
                    }
                );
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket closed. Reconnecting in 5s...');
        setTimeout(startArchiver, 5000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
}

// Optional cleanup cron: delete VAAs older than 48 hours to save space
setInterval(() => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - (48 * 3600);
    db.run('DELETE FROM vaas WHERE publish_time < ?', [twoDaysAgo], function(err) {
        if (!err && this.changes > 0) {
            console.log(`Cleaned up ${this.changes} old VAAs`);
        }
    });
}, 3600_000); // Check every hour

startArchiver();
