require('dotenv').config();
const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  const [cols] = await conn.query('DESCRIBE customer_contact_details');
  console.log('customer_contact_details:', cols.map(c => c.Field + '(' + c.Key + ')').join(', '));
  const [cols2] = await conn.query('DESCRIBE customer_contact_mapping_data');
  console.log('customer_contact_mapping_data:', cols2.map(c => c.Field + '(' + c.Key + ')').join(', '));
  const [tables] = await conn.query('SHOW TABLES LIKE "%service%"');
  console.log('Service tables:', tables.map(t => Object.values(t)[0]));
  const [tables2] = await conn.query('SHOW TABLES LIKE "%update%"');
  console.log('Update tables:', tables2.map(t => Object.values(t)[0]));
  await conn.end();
}
main().catch(e => console.error('ERROR:', e.message));
