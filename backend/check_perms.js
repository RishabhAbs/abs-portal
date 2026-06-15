const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3307'),
        user: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_DATABASE || 'abs_cloud',
    });
    
    console.log('--- Table List ---');
    const [tables] = await connection.execute('SHOW TABLES');
    tables.forEach(t => console.log(Object.values(t)[0]));
    
    console.log('\n--- User Roles ---');
    try {
        const [users] = await connection.execute('SELECT username, role, role_id FROM users LIMIT 10');
        console.table(users);
    } catch (e) {
        console.log('Error checking users:', e.message);
    }
    
    await connection.end();
}

check().catch(console.error);
