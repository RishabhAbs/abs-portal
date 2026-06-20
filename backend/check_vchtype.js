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

    const [vchDetails] = await conn.query(
      `SELECT v.id, v.vch_no, v.vch_date, v.vch_type_id
       FROM vch_details v
       INNER JOIN ledger_entries le ON le.vch_id = v.id
       INNER JOIN inventory_entries ie ON ie.led_id = le.id
       WHERE ie.item_id = 20
       LIMIT 10`
    );
    console.log("Biz Analyst vouchers details:");
    console.log(JSON.stringify(vchDetails, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
