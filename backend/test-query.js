const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'root',
    database: 'absteqwc_absservice'
  });
  
  const [rows] = await conn.query(`
    WITH ranked AS (
      SELECT le.id, le.vch_id, le.ledger_id, le.amount,
             c.company AS ledger_name,
             ROW_NUMBER() OVER (PARTITION BY le.vch_id ORDER BY le.id ASC) AS rn
      FROM ledger_entries le
      LEFT JOIN customer c ON le.ledger_id = c.id
    )
    SELECT v.id AS vch_id, v.vch_no, v.vch_date,
           party_le.amount AS party_amount,
           first_le.id AS first_le_id,
           second_le.ledger_name AS second_ledger_name
    FROM ledger_entries party_le
    INNER JOIN vch_details v ON party_le.vch_id = v.id
    LEFT JOIN ranked first_le ON first_le.vch_id = v.id AND first_le.rn = 1
    LEFT JOIN ranked second_le ON second_le.vch_id = v.id AND second_le.rn = 2
    WHERE party_le.ledger_id = 13192
  `);
  
  console.log('Rows:', rows);
  conn.end();
}

run().catch(console.error);
