const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root',
    password: 'root_password', database: 'absteqwc_absservice'
  });
  try {
    const [rows] = await conn.query(
      `SELECT COALESCE(parent.id, lg.id) AS group_id,
              COALESCE(parent.name, lg.name, 'Ungrouped') AS group_name,
              COUNT(DISTINCT c.id) AS ledger_count
       FROM ledger_entries le
       INNER JOIN vch_details v ON le.vch_id = v.id
       LEFT JOIN customer c ON le.ledger_id = c.id
       LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
       LEFT JOIN ledgergroup parent ON lg.parent_id = parent.id
       GROUP BY COALESCE(parent.id, lg.id), COALESCE(parent.name, lg.name)
       LIMIT 5`
    );
    console.log("SQL OK:", JSON.stringify(rows, null, 2));
  } catch(e) { console.error('SQL ERROR:', e.message); }
  await conn.end();
}
run().catch(console.error);
