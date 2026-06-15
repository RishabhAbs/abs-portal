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

  const [users] = await pool.query('SELECT * FROM cloud_users WHERE name LIKE ? OR email LIKE ?', ['%Kaluram%', '%Kaluram%']);
  console.log("Found cloud_users:", users.map(u => ({ id: u.id, name: u.name, role: u.role })));

  if (users.length > 0) {
    const user = users[0];
    const userId = user.id;
    const userName = user.name;
    const adminId = null; // cloud user usually has null adminId
    const adminName = userName; 

    // service logic uses: const fallbackGroupId = adminId || userId;
    const fallbackGroupId = userId;

    const query = `
      SELECT COUNT(DISTINCT c.id) as total 
      FROM customer c
      LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
      LEFT JOIN cloud_users cu ON c.group = cu.id
      WHERE (c.status = 'Active')
      AND (c.group = ? OR u.name = ? OR cu.name = ? OR c.group = ?)
    `;
    const [total] = await pool.query(query, [fallbackGroupId.toString(), adminName, adminName, adminName]);
    console.log("Service Logic Total (Active):", total[0].total);
    
    // Also test "Not Our Customer"
    const queryNotActive = `
      SELECT COUNT(DISTINCT c.id) as total 
      FROM customer c
      LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
      LEFT JOIN cloud_users cu ON c.group = cu.id
      WHERE ((c.status != 'Active' OR c.status IS NULL))
      AND (c.group = ? OR u.name = ? OR cu.name = ? OR c.group = ?)
    `;
    const [totalNotActive] = await pool.query(queryNotActive, [fallbackGroupId.toString(), adminName, adminName, adminName]);
    console.log("Service Logic Total (Not Active):", totalNotActive[0].total);
    
    // Check if they have ANY customers mapped to Kaluram Jakhar as string, or mapped to their cloud_user id
    const [rawMapping] = await pool.query('SELECT COUNT(*) as cnt FROM customer WHERE `group` = ? OR `group` = ?', [fallbackGroupId.toString(), adminName]);
    console.log("Raw mapping count:", rawMapping[0].cnt);
  }

  pool.end();
}

run().catch(console.error);
