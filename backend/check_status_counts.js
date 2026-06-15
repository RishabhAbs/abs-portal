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
    const [rows] = await conn.query("SELECT tally_status, COUNT(*) as total FROM tallydetails WHERE DATE(tallyexpirydate) >= '2026-03-01' AND DATE(tallyexpirydate) <= '2026-03-31' GROUP BY tally_status");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
