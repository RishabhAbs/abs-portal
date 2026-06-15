import * as fs from 'fs';
import * as readline from 'readline';
import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env relative to backend root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  console.log('Starting DB Structure Bindings Fix (Primary Keys, Auto Increments)...');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud',
  });

  const sqlFile = 'c:\\Users\\DELL\\Downloads\\absteqwc_absservice.sql';
  if (!fs.existsSync(sqlFile)) {
    console.error(`File not found: ${sqlFile}`);
    process.exit(1);
  }

  // Turn off checks
  await connection.query('SET FOREIGN_KEY_CHECKS=0;');

  const fileStream = fs.createReadStream(sqlFile);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let buffer = '';
  let inAlter = false;
  let executed = 0;

  for await (const line of rl) {
    const trimmed = line.trim();

    if (trimmed.startsWith('ALTER TABLE')) {
      inAlter = true;
      buffer = line + '\n';
      
      if (trimmed.endsWith(';')) {
        inAlter = false;
        await executeBuffer(connection, buffer);
        executed++;
        buffer = '';
      }
    } else if (inAlter) {
      buffer += line + '\n';
      if (trimmed.endsWith(';')) {
        inAlter = false;
        await executeBuffer(connection, buffer);
        executed++;
        buffer = '';
      }
    }
  }

  await connection.query('SET FOREIGN_KEY_CHECKS=1;');
  await connection.end();
  console.log(`Finished processing bindings. Total ALTER blocks executed: ${executed}`);
}

async function executeBuffer(connection: mysql.Connection, query: string) {
  try {
    await connection.query(query);
  } catch (err: any) {
    // Ignore duplicates if they already exist
    if (err.code !== 'ER_MULTIPLE_PRI_KEY' && !err.message.includes('only one auto column')) {
      // console.error(`Error resolving binding: ${err.message} - Snippet: ${query.split('\n')[0]}`);
    }
  }
}

run().catch(console.error);
