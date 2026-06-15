const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function importDb() {
  const config = {
    host: 'localhost',
    user: 'root',
    password: 'password',
    port: 3307,
    multipleStatements: true
  };

  const targetDb = 'abs_cloud';
  const sqlFilePath = path.join(__dirname, '..', '..', 'absteqwc_absservice (2).sql');

  console.log(`Connecting to MySQL on port ${config.port}...`);
  const connection = await mysql.createConnection(config);

  try {
    console.log(`Dropping and recreating database: ${targetDb}...`);
    await connection.query(`DROP DATABASE IF EXISTS ${targetDb}`);
    await connection.query(`CREATE DATABASE ${targetDb}`);
    await connection.query(`USE ${targetDb}`);
    
    // Disable strict mode to allow '0000-00-00' dates which are common in old dumps
    console.log('Disabling strict SQL mode for session...');
    await connection.query("SET sql_mode = ''");

    console.log(`Reading SQL file: ${sqlFilePath}...`);
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    console.log('Preprocessing SQL (stripping comments)...');
    // Remove single line comments starting with --
    const cleanedSql = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

    // Splitting by semicolon followed by newline/end of string
    const statements = cleanedSql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('/*'));

    console.log(`Found ${statements.length} statements. Executing...`);

    for (let i = 0; i < statements.length; i++) {
        try {
            await connection.query(statements[i]);
            if ((i + 1) % 500 === 0 || i === statements.length - 1) {
                console.log(`Executed ${i + 1}/${statements.length} statements...`);
            }
        } catch (err) {
            console.error(`Error in statement ${i + 1}:`, err.message);
            // Optional: log first few chars of failing statement
            // console.debug('Statement starts with:', statements[i].substring(0, 50));
        }
    }

    console.log('Import completed.');

  } catch (error) {
    console.error('Import process failed:', error);
  } finally {
    await connection.end();
  }
}

importDb();
