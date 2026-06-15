const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'absteqwc_absservice'
  });
  const customerId = 13590;
  const excludeVchId = 553;
  const excludeFilter = 'AND (ba.vchid IS NULL OR ba.vchid != ?)';
  const sql = `SELECT billname, ABS(net_amount) AS amount, vch_date, vch_no,
            CASE WHEN net_amount > 0 THEN 'Dr' ELSE 'Cr' END AS direction
     FROM (
        SELECT
            ba.billname,
            SUM(ba.amount) AS net_amount,
            MIN(COALESCE(v.vch_date, ba.bill_date)) AS vch_date,
            MIN(v.vch_no)   AS vch_no
        FROM bill_allocation ba
        LEFT JOIN vch_details v ON ba.vchid = v.id
        WHERE ba.ledger = ?
          AND ba.billname IS NOT NULL AND ba.billname != ''
          ${excludeFilter}
        GROUP BY ba.billname
        HAVING ABS(SUM(ba.amount)) > 0.01

        UNION ALL

        SELECT CONCAT('On Acct (', COALESCE(MAX(v.vch_no), MAX(v.id), MAX(ba.id)), ')'),
            SUM(ba.amount), MIN(COALESCE(v.vch_date, ba.bill_date)), MIN(v.vch_no)
        FROM bill_allocation ba
        LEFT JOIN vch_details v ON ba.vchid = v.id
        WHERE ba.ledger = ?
          AND (ba.billname IS NULL OR ba.billname = '')
          ${excludeFilter}
        GROUP BY COALESCE(ba.vchid, ba.id)
        HAVING ABS(SUM(ba.amount)) > 0.01
     ) AS combined
     ORDER BY vch_date DESC LIMIT 50`;

  console.log('=== Editing voucher 553 (excludeVchId=553) — should now show ABST/320/25-26 as pending ===');
  const [refs] = await conn.query(sql, [customerId, excludeVchId, customerId, excludeVchId]);
  console.log(JSON.stringify(refs, null, 2));

  console.log('\n=== Creating new receipt (no exclude) — bill should remain hidden because it is fully settled ===');
  const sqlNoExclude = sql.replaceAll('AND (ba.vchid IS NULL OR ba.vchid != ?)', '');
  const [refsNoExclude] = await conn.query(sqlNoExclude, [customerId, customerId]);
  console.log(JSON.stringify(refsNoExclude, null, 2));

  await conn.end();
}
run().catch(e => { console.error(e); process.exit(1); });
