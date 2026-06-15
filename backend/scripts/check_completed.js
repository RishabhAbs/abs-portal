const mysql = require('mysql2/promise');

async function check() {
    const conn = await mysql.createConnection({
        host: 'localhost',
        port: 3307,
        user: 'root',
        password: 'password',
        database: 'abs_cloud'
    });

    const [r1] = await conn.query(`
        SELECT v.id, v.status, v.user_name, c.company as customer_name 
        FROM cloud_visits v 
        LEFT JOIN customer c ON v.customer_id = c.id 
        WHERE v.status = 'Completed' 
        LIMIT 5
    `);
    console.log('Completed visits with customer names:');
    console.log(JSON.stringify(r1, null, 2));

    await conn.end();
}

check().catch(console.error);
