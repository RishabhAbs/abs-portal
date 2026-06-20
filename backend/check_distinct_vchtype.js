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

    const [distinctIds] = await conn.query(
      `SELECT vch_type_id, COUNT(*) as cnt FROM vch_details GROUP BY vch_type_id`
    );
    console.log("Distinct vch_type_id in vch_details:");
    console.log(JSON.stringify(distinctIds, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
