const axios = require('axios');

async function backfillVAA(feedIdHex, expiryTs, db) {
    console.log(Backfilling missing VAA from Hermes REST for expiryTs ...);
    let targetTs = expiryTs;
    for (let i = 0; i < 10; i++) {
        try {
            const url = https://hermes.pyth.network/v2/updates/price/ + targetTs + ?ids[]= + feedIdHex;
            const res = await axios.get(url);
            if (res.data && res.data.parsed && res.data.parsed.length > 0) {
                const parsed = res.data.parsed[0];
                const pubTime = parsed.price.publish_time;
                if (pubTime >= expiryTs) {
                    const vaaHex = res.data.binary.data[0];
                    const vaaBase64 = Buffer.from(vaaHex, 'hex').toString('base64');
                    await new Promise((resolve) => {
                        db.run('INSERT OR IGNORE INTO vaas (publish_time, feed_id, vaa) VALUES (?, ?, ?)', 
                            [pubTime, feedIdHex, vaaBase64], 
                            () => resolve()
                        );
                    });
                    console.log(Successfully backfilled VAA (publish_time:  + pubTime + ));
                    return { pubTime, vaaBase64 };
                }
            }
        } catch (e) {
            console.error(Backfill failed for ts  + targetTs + :, e.message);
        }
        targetTs++;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return null;
}
