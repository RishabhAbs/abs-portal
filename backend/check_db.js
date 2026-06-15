const mysql = require('mysql2/promise');
const fs = require('fs');

async function run() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password',
    database: 'abs_cloud'
  });

  let out = '';
  const log = (msg) => { out += msg + '\n'; };

    try {
      log('\n--- TESTING SEARCH DETAIL AFTER FIX ---');
      const response = await fetch('http://localhost:5000/api/customers/11240', { 
        method: 'GET'
      });
      log(`Response Status: ${response.status}`);
      const data = await response.json().catch(() => ({}));
      log(`Response Data: ${JSON.stringify(data).substring(0, 500)}...`); // Truncated for safety
    } catch (err) {
      log(`Error: ${err.message}`);
    }

    fs.writeFileSync('db_schema_output.txt', out);
    console.log('Saved to db_schema_output.txt');

  } catch (e) {
    console.error(e);
  } finally {
    await connection.end();
  }
}

run();
