/**
 * Customer CSV Import Script
 * Run: node scripts/import_customers.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// CSV file path - update this if needed
const CSV_FILE = 'C:\\Users\\DELL\\Downloads\\customer.csv';

// Database connection config
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307'),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'abs_cloud',
  charset: 'utf8mb4'
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      let value = values[index] || '';
      // Handle NULL values
      if (value === 'NULL' || value === '') {
        value = null;
      }
      row[header] = value;
    });
    data.push(row);
  }
  
  return data;
}

// Convert DD-MM-YYYY to YYYY-MM-DD for MySQL
function convertDate(dateStr) {
  if (!dateStr || dateStr === 'NULL' || dateStr === '0000-00-00') return null;
  
  // Check if already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Convert DD-MM-YYYY to YYYY-MM-DD
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  
  return null;
}

async function importCustomers() {
  console.log('Starting customer import...');
  console.log('Reading CSV file:', CSV_FILE);
  
  // Read CSV file
  const csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
  const customers = parseCSV(csvContent);
  
  console.log(`Found ${customers.length} customers to import`);
  
  // Connect to database
  const connection = await mysql.createConnection(dbConfig);
  console.log('Connected to database');
  
  try {
    // Optional: Clear existing data
    // await connection.execute('DELETE FROM customer WHERE id >= 95');
    // console.log('Cleared existing customer data');
    
    let imported = 0;
    let errors = 0;
    
    for (const customer of customers) {
      try {
        const sql = `
          INSERT INTO customer (
            id, company, \`group\`, address1, address2, address3, pincode, state, area, city, 
            gstin, person, designation, email, mobile, image, customerid, tempid, remarks, status, 
            date, tally, broadcastid, whatsapp, lastvisitid, lastvisitperson, lastvisitdate, lastvisitremark,
            lastcallid, lastcallperson, lastcalldate, lastcallremark, lastcallstatus, lastcalluserid,
            btype, grade, e_invoice, business_type, accounts_person_type, it_person, ca_name, 
            business_description, e_way_bill, connected_banking, whatsapp_enabled, customisation, 
            tally_slow, loyalty, conversion_probability, customer_behaviour
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            company = VALUES(company),
            \`group\` = VALUES(\`group\`),
            address1 = VALUES(address1),
            address2 = VALUES(address2),
            address3 = VALUES(address3),
            pincode = VALUES(pincode),
            state = VALUES(state),
            area = VALUES(area),
            city = VALUES(city),
            gstin = VALUES(gstin),
            person = VALUES(person),
            designation = VALUES(designation),
            email = VALUES(email),
            mobile = VALUES(mobile),
            image = VALUES(image),
            customerid = VALUES(customerid),
            remarks = VALUES(remarks),
            status = VALUES(status),
            tally = VALUES(tally),
            whatsapp = VALUES(whatsapp),
            btype = VALUES(btype),
            grade = VALUES(grade)
        `;
        
        const values = [
          customer.id ? parseInt(customer.id) : null,
          customer.company,
          customer.group ? parseInt(customer.group) : null,
          customer.address1,
          customer.address2,
          customer.address3,
          customer.pincode,
          customer.state ? parseInt(customer.state) : null,
          customer.area,
          customer.city,
          customer.gstin,
          customer.person,
          customer.designation,
          customer.email,
          customer.mobile,
          customer.image,
          customer.customerid,
          customer.tempid,
          customer.remarks,
          customer.status,
          convertDate(customer.date),
          customer.tally,
          customer.broadcastid ? parseInt(customer.broadcastid) : null,
          customer.whatsapp,
          customer.lastvisitid ? parseInt(customer.lastvisitid) : null,
          customer.lastvisitperson,
          convertDate(customer.lastvisitdate),
          customer.lastvisitremark,
          customer.lastcallid ? parseInt(customer.lastcallid) : null,
          customer.lastcallperson,
          convertDate(customer.lastcalldate),
          customer.lastcallremark,
          customer.lastcallstatus,
          customer.lastcalluserid ? parseInt(customer.lastcalluserid) : null,
          customer.btype ? parseInt(customer.btype) : null,
          customer.grade,
          customer.e_invoice,
          customer.business_type,
          customer.accounts_person_type,
          customer.it_person,
          customer.ca_name,
          customer.business_description,
          customer.e_way_bill,
          customer.connected_banking,
          customer.whatsapp_enabled,
          customer.customisation,
          customer.tally_slow,
          customer.loyalty,
          customer.conversion_probability,
          customer.customer_behaviour
        ];
        
        await connection.execute(sql, values);
        imported++;
        
        if (imported % 50 === 0) {
          console.log(`Imported ${imported} customers...`);
        }
      } catch (err) {
        errors++;
        console.error(`Error importing customer ${customer.id} (${customer.company}):`, err.message);
      }
    }
    
    console.log('\n========================================');
    console.log(`Import complete!`);
    console.log(`Successfully imported: ${imported}`);
    console.log(`Errors: ${errors}`);
    console.log('========================================');
    
  } finally {
    await connection.end();
  }
}

importCustomers().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
