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

    const [columns] = await conn.query("SHOW COLUMNS FROM vch_details");
    console.log("vch_details columns:");
    console.log(JSON.stringify(columns, null, 2));

    const [sample] = await conn.query("SELECT * FROM vch_details WHERE vch_type_id = 9 LIMIT 5");
    console.log("Sample vouchers with type_id = 9:");
    console.log(JSON.stringify(sample, null, 2));

    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();
