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
    
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('--- ALL TABLES ---');
    tables.forEach(t => console.log(Object.values(t)[0]));
    
    await connection.end();
}

check().catch(console.error);
