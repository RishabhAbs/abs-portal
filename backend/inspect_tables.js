
const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
    const env = fs.readFileSync('.env', 'utf8');
    const config = {};
    env.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) config[key.trim()] = value.trim();
    });

    const pool = mysql.createPool({
        host: config.DB_HOST || 'localhost',
        port: parseInt(config.DB_PORT) || 3306,
        user: config.DB_USERNAME || 'root',
        password: config.DB_PASSWORD || 'password',
        database: config.DB_DATABASE || 'abs_cloud',
    });

    const tables = ['customer', 'tallydetails', 'reseller', 'admin', 'singlemaster', 'pincode', 'customer_contact_details', 'customer_contact_mapping_data'];
    
    for (const table of tables) {
        console.log(`\n--- TABLE: ${table} ---`);
        try {
            const [rows] = await pool.execute(`DESCRIBE ${table}`);
            rows.forEach(row => {
                console.log(`${row.Field.padEnd(20)} | ${row.Type.padEnd(20)} | Null: ${row.Null} | Key: ${row.Key}`);
            });
        } catch (e) {
            console.log(`Error describing table ${table}: ${e.message}`);
        }
    }

    await pool.end();
}

main();
