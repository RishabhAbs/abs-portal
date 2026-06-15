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
    
    const [users] = await connection.execute('SELECT name, email, role, permissions FROM cloud_users');
    console.log(JSON.stringify(users, null, 2));
    
    await connection.end();
}

check().catch(console.error);
