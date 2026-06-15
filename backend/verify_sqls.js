const mysql = require('mysql2/promise');

async function verify() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password', // Updated from .env
    database: 'abs_cloud'
  });

  console.log('--- EXPLAIN for Customer search (Prefix Match) ---');
  const [rows] = await connection.execute(`
    EXPLAIN SELECT 
      c.id, 
      c.company
    FROM customer c
    WHERE c.status = 'Active' 
      AND (c.company LIKE 'Test%' OR c.customerid LIKE 'Test%')
    LIMIT 20
  `);
  console.table(rows);

  console.log('--- EXPLAIN for Mobile search (Subquery check) ---');
  const [mobileRows] = await connection.execute(`
    EXPLAIN SELECT 
        c.id, 
        c.company, 
        c.customerid,
        ccmd.mobile_id as mobile
    FROM customer_contact_mapping_data ccmd
    INNER JOIN customer c ON ccmd.customer_id = c.id
    WHERE c.status = 'Active' 
      AND ccmd.mobile_id LIKE '9876%'
    LIMIT 20
  `);
  console.table(mobileRows);

  await connection.end();
}

verify().catch(console.error);
