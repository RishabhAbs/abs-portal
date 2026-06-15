const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password',
    database: 'abs_cloud'
  });

  try {
    const [rows] = await connection.execute('SELECT status, COUNT(*) as count FROM customer GROUP BY status');
    console.log('Customer Status Counts:');
    console.log(JSON.stringify(rows, null, 2));

    const [kaluram] = await connection.execute('SELECT permissions FROM cloud_users WHERE email = "kaluram@abstechnologies.org.in"');
    console.log('\nKaluram Permissions:');
    console.log(kaluram[0]?.permissions);

    const [sample] = await connection.execute('SELECT company, status FROM customer LIMIT 10');
    console.log('\nSample Customers:');
    console.log(JSON.stringify(sample, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

check();
