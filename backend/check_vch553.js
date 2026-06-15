const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'absteqwc_absservice'
  });
  console.log('=== voucher 553 ===');
  const [v] = await conn.query(
    "SELECT id, vch_no, vch_date, vch_type_id, remark, created_at FROM vch_details WHERE id = 553"
  );
  console.log(JSON.stringify(v, null, 2));

  console.log('\n=== ledger_entries for voucher 553 ===');
  const [le] = await conn.query(
    `SELECT le.id, le.ledger_id, c.company, le.amount
     FROM ledger_entries le LEFT JOIN customer c ON le.ledger_id = c.id
     WHERE le.vch_id = 553 ORDER BY le.id`
  );
  console.log(JSON.stringify(le, null, 2));

  await conn.end();
}
run().catch(e => { console.error(e); process.exit(1); });
