import * as fs from 'fs';
import * as readline from 'readline';
import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env relative to backend root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  console.log('Starting DB Schema Sync...');
  
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

  const fileStream = fs.createReadStream(sqlFile);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inCreateTable = false;
  let currentTable = '';
  let createStatement = '';

  for await (const line of rl) {
    if (line.startsWith('CREATE TABLE')) {
      inCreateTable = true;
      createStatement = line + '\n';
      const match = line.match(/CREATE TABLE `([^`]+)`/);
      if (match) currentTable = match[1];
    } else if (inCreateTable) {
      createStatement += line + '\n';
      if (line.startsWith(') ENGINE=')) {
        inCreateTable = false;
        await processTable(connection, currentTable, createStatement);
      }
    }
  }

  await connection.end();
  console.log('Sync complete!');
}

async function processTable(connection: mysql.Connection, tableName: string, createStatement: string) {
  // Check if table exists
  const [rows] = await connection.query(`SHOW TABLES LIKE '${tableName}'`);
  if ((rows as any[]).length === 0) {
    console.log(`[New Table] Creating table ${tableName}...`);
    try {
      await connection.query(createStatement);
      console.log(`  -> Success`);
    } catch (e: any) {
      console.error(`  -> Failed creating table ${tableName}: ${e.message}`);
    }
  } else {
    // Exists, check columns
    const [existingCols] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const existingColNames = (existingCols as any[]).map(c => c.Field);

    const lines = createStatement.split('\n');
    for (const l of lines) {
      const trimmed = l.trim();
      // Match lines defining a column (start with backtick)
      if (trimmed.startsWith('`')) {
        const cleanLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
        const match = cleanLine.match(/^`([^`]+)`\s+(.*)$/);
        
        if (match) {
          const colName = match[1];
          const colDef = match[2]; 
          
          if (!existingColNames.includes(colName)) {
             console.log(`[Missing Column] Adding column \`${colName}\` to table \`${tableName}\`...`);
             try {
               await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${colDef}`);
               console.log(`  -> Success`);
             } catch(e: any) {
               console.error(`  -> Failed adding column ${colName}: ${e.message}`);
             }
          }
        }
      }
    }
  }
}

run().catch(console.error);
