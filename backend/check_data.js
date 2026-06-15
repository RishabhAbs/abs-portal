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
    const [rows] = await conn.query("SELECT tallyserial, tallyexpirydate, expiry_status FROM tallydetails LIMIT 10");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
