const mysql = require('mysql2/promise');

async function test() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3307,
            user: 'root',
            password: 'password',
            database: 'abs_cloud'
        });

        console.log('Testing Dropdown Query Logic...');
        const query = `
          SELECT c.id, c.company, c.customerid, c.group, c.status
          FROM customer c
          WHERE c.status IN ('Active', 'Not Our Customer')
          ORDER BY c.company
        `;
        
        const [rows] = await connection.execute(query);
        const sagar = rows.filter(r => r.company.toLowerCase().includes('sagar'));
        
        console.log('Sagar results in dropdown list:');
        console.log(JSON.stringify(sagar, null, 2));
        console.log('Total results in dropdown:', rows.length);

        await connection.end();
    } catch (err) {
        console.error('Error:', err);
    }
}

test();
