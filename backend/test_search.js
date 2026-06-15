
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3307,
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud'
  });

  try {
    const tables = ['customer', 'tallydetails', 'clouddetails', 'customer_contact_details', 'customer_contact_mapping_data'];
    for (const t of tables) {
      try {
        const [rows] = await connection.execute(`DESCRIBE ${t}`);
        console.log(`Table ${t} exists. Columns:`, rows.map(r => r.Field).join(', '));
      } catch (e) {
        console.log(`Table ${t} DOES NOT EXIST:`, e.message);
      }
    }

    // Check row counts
    for (const t of ['customer', 'tallydetails', 'clouddetails']) {
      try {
        const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM ${t}`);
        console.log(`Table ${t} row count:`, rows[0].count);
      } catch (e) {}
    }

    // Test a sample search - check if any customer has an email
    const [emailRows] = await connection.execute(`SELECT id, company, email FROM customer WHERE email IS NOT NULL AND email != '' LIMIT 3`);
    console.log('Sample customers with email:', emailRows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await connection.end();
  }
}

run();
