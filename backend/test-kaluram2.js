const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud',
  });

  const [res] = await pool.query('SELECT COUNT(*) as c FROM customer WHERE status="Active" AND (`group`=? OR `group`=?)', ['114', 'Kalu Ram']);
  console.log('Customers found active for ID 114 or Kalu Ram:', res[0].c);

  const query = `
    SELECT COUNT(DISTINCT c.id) as total 
    FROM customer c
    LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
    LEFT JOIN cloud_users cu ON c.group = cu.id
    WHERE (c.status = 'Active')
    AND (c.group = ? OR u.name = ? OR cu.name = ? OR c.group = ?)
  `;
  const [total] = await pool.query(query, ['114', 'Kalu Ram', 'Kalu Ram', 'Kalu Ram']);
  console.log("Service Logic Total (Active):", total[0].total);

  pool.end();
}

run().catch(console.error);
