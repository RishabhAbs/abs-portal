const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'absteqwc_absservice'
  });

  console.log('=== 1. Customers matching GURPEE ===');
  const [c] = await conn.query(
    "SELECT id, company, opening_balance, opening_balance_type, billbybill FROM customer WHERE company LIKE '%GURPEE%'"
  );
  console.log(JSON.stringify(c, null, 2));

  console.log('\n=== 2. bill_allocation rows with billname LIKE ABST/320/25-26 ===');
  const [b] = await conn.query(
    "SELECT id, vchid, ledger, billname, amount, bill_date FROM bill_allocation WHERE billname LIKE '%ABST/320/25-26%'"
  );
  console.log(JSON.stringify(b, null, 2));

  if (c.length > 0) {
    for (const cust of c) {
      console.log(`\n=== 3. ALL bill_allocation for customer.id=${cust.id} (${cust.company}) ===`);
      const [rows] = await conn.query(
        "SELECT id, vchid, ledger, billname, amount, bill_date FROM bill_allocation WHERE ledger = ?",
        [cust.id]
      );
      console.log(JSON.stringify(rows, null, 2));

      console.log(`\n=== 4. getPendingRefs simulation for ledger=${cust.id} ===`);
      const [refs] = await conn.query(`
        SELECT billname, ABS(net_amount) AS amount, vch_date, vch_no,
               CASE WHEN net_amount > 0 THEN 'Dr' ELSE 'Cr' END AS direction
        FROM (
            SELECT ba.billname, SUM(ba.amount) AS net_amount,
                   MIN(COALESCE(v.vch_date, ba.bill_date)) AS vch_date,
                   MIN(v.vch_no) AS vch_no
            FROM bill_allocation ba
            LEFT JOIN vch_details v ON ba.vchid = v.id
            WHERE ba.ledger = ? AND ba.billname IS NOT NULL AND ba.billname != ''
            GROUP BY ba.billname
            HAVING ABS(SUM(ba.amount)) > 0.01
            UNION ALL
            SELECT CONCAT('On Acct (', COALESCE(MAX(v.vch_no), MAX(v.id), MAX(ba.id)), ')'),
                   SUM(ba.amount), MIN(COALESCE(v.vch_date, ba.bill_date)), MIN(v.vch_no)
            FROM bill_allocation ba
            LEFT JOIN vch_details v ON ba.vchid = v.id
            WHERE ba.ledger = ? AND (ba.billname IS NULL OR ba.billname = '')
            GROUP BY COALESCE(ba.vchid, ba.id)
            HAVING ABS(SUM(ba.amount)) > 0.01
        ) AS combined
        ORDER BY vch_date DESC LIMIT 50
      `, [cust.id, cust.id]);
      console.log(JSON.stringify(refs, null, 2));
    }
  }

  await conn.end();
}
run().catch(e => { console.error(e); process.exit(1); });
