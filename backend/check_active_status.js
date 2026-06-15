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
    const [rows] = await conn.query("DESCRIBE tallydetails");
    const statusCols = rows.filter(r => r.Field.toLowerCase().includes('status'));
    console.log('Status related columns:', JSON.stringify(statusCols, null, 2));

    const [activeCounts] = await conn.query("SELECT active_status, COUNT(*) as count FROM tallydetails GROUP BY active_status");
    console.log('Active Status Counts (All):', JSON.stringify(activeCounts, null, 2));

    const [marchActiveCounts] = await conn.query("SELECT active_status, COUNT(*) as count FROM tallydetails WHERE DATE(tallyexpirydate) >= '2026-03-01' AND DATE(tallyexpirydate) <= '2026-03-31' GROUP BY active_status");
    console.log('March 2026 Active Status Counts:', JSON.stringify(marchActiveCounts, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
