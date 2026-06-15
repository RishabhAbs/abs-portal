import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function syncAll() {
    console.log('Starting Tally Serial Sync Script for ALL records...');
    
    // Connect to the DB manually (mirroring DbService logic)
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_DATABASE || 'abscloud',
    });

    console.log('Connected to database.');

    try {
        console.log("Renaming 'Partner-Change' to 'Call-Back Later' in singlemaster...");
        const [result] = await connection.execute(`
            UPDATE singlemaster 
            SET name = 'Call-Back Later' 
            WHERE name = 'Partner-Change' AND type = 'ExpiryStatus'
        `);
        console.log("Renamed:", result);
    } catch (e: any) {
        console.error('Error:', e);
    } finally {
        await connection.end();
    }
}

syncAll();
