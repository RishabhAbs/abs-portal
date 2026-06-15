import * as mysql from 'mysql2/promise';

async function fix() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password',
    database: 'abs_cloud'
  });

  try {
    console.log('--- Adding admin_id column to cloud_user_sessions ---');
    await connection.query('ALTER TABLE cloud_user_sessions ADD COLUMN admin_id INT NULL');
    console.log('Success!');

  } catch (err: any) {
    if (err.message.includes('Duplicate column name')) {
        console.log('Column already exists.');
    } else {
        console.error('Error:', err.message);
    }
  } finally {
    await connection.end();
  }
}

fix();
