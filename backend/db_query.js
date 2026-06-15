const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3307,
      user: 'root',
      password: 'password',
      database: 'abs_cloud'
    });
    const [rows] = await conn.query("SELECT id, name, email, role, is_two_fa_enabled FROM cloud_users WHERE email = 'rishabh@abstechnologies.org.in'");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
