import * as fs from 'fs';
import * as readline from 'readline';
import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env relative to backend root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  console.log('Starting DB Data Import...');
  
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

  // Turn off checks for importing large dumps quickly
  await connection.query('SET FOREIGN_KEY_CHECKS=0;');

  const fileStream = fs.createReadStream(sqlFile);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let buffer = '';
  let inInsert = false;
  let linesProcessed = 0;
  let insertions = 0;

  for await (const line of rl) {
    linesProcessed++;
    if (linesProcessed % 50000 === 0) console.log(`Processed ${linesProcessed} lines... (${insertions} insertions)`);

    const trimmed = line.trim();

    if (trimmed.startsWith('INSERT INTO')) {
      inInsert = true;
      buffer = line + '\n';
      
      // Check if the INSERT statement completes on the same line
      if (trimmed.endsWith(';')) {
        inInsert = false;
        await executeBuffer(connection, buffer);
        insertions++;
        buffer = '';
      }
    } else if (inInsert) {
      buffer += line + '\n';
      // If it ends properly we execute
      if (trimmed.endsWith(';')) {
        inInsert = false;
        await executeBuffer(connection, buffer);
        insertions++;
        buffer = '';
      }
    }
  }

  await connection.query('SET FOREIGN_KEY_CHECKS=1;');
  await connection.end();
  console.log(`Finished processing ${linesProcessed} lines. Total Insertion Blocks: ${insertions}`);
}

async function executeBuffer(connection: mysql.Connection, query: string) {
  try {
    // Change INSERT INTO ... to INSERT IGNORE INTO ... to avoid crashing out on existing lines
    const safeQuery = query.replace(/^INSERT INTO/i, 'INSERT IGNORE INTO');
    await connection.query(safeQuery);
  } catch (err: any) {
    // Ignore duplicates if any somehow get past IGNORE
    if (err.code !== 'ER_DUP_ENTRY') {
      console.error(`Error executing partial batch chunk: ${err.message}`);
    }
  }
}

run().catch(console.error);
