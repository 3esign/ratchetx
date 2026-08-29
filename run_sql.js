const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const client = new Client({
        connectionString: 'postgresql://postgres:Trench%40bench1@db.jydrysrqfqdpadnljnbk.supabase.co:5432/postgres',
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        console.log("Connected to Supabase DB");
        const sql = fs.readFileSync('supabase/002_ratchet_kv_sweep.sql', 'utf8');
        await client.query(sql);
        console.log("Executed 002_ratchet_kv_sweep.sql successfully");
    } catch (e) {
        console.error("DB Error:", e);
    } finally {
        await client.end();
    }
}
run();
