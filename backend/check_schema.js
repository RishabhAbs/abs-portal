
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: 3307,
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud'
  });

  try {
    const [rows] = await connection.execute('SELECT id, name FROM singlemaster');
    console.log('--- singlemaster table ---');
    rows.forEach(r => console.log(`${r.id}: ${r.name}`));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

main();
