const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'root_password',
      database: 'absteqwc_absservice'
    });

    const [rows] = await conn.query(
      `SELECT ie.item_id, i.item_name, ie.qty, ie.amount, v.vch_date, v.vch_no, vt.name as vch_type
       FROM inventory_entries ie
       INNER JOIN items i ON ie.item_id = i.id
       INNER JOIN ledger_entries le ON ie.led_id = le.id
       INNER JOIN vch_details v ON le.vch_id = v.id
       LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
       WHERE ie.item_id = 20`
    );
    console.log("Biz Analyst inventory entries:");
    console.log(JSON.stringify(rows, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
