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
      `SELECT vch_type_id, name, parent_id, deemed_positive
       FROM vchtype`
    );
    console.log("All vchtype rows in DB:");
    console.log(JSON.stringify(rows, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
