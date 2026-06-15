import { DataSource } from 'typeorm';
import 'dotenv/config';

const AppDataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3307'),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud',
});

async function check() {
    await AppDataSource.initialize();
    
    const customers = [
        'TK INFRA SOLUTION', 
        'MAA RATNI ENTERPRISES', 
        'SMM PRODUCTS LLP', 
        'Atlas Industrial',
        'ARUNODAY CONTR'
    ];
    
    console.log('--- Customers and Mappings ---');
    for (const name of customers) {
        const [customer] = await AppDataSource.query(`SELECT id, company, customerid FROM customer WHERE company LIKE ?`, [`%${name}%`]);
        if (customer) {
            console.log(`Customer: ${customer.company} (ID: ${customer.id}, LegacyID: ${customer.customerid})`);
            
            // Check mappings
            const mappings = await AppDataSource.query(`
                SELECT cm.*, s.server_ip, s.customer_ip 
                FROM cloud_mappings cm
                LEFT JOIN cloud_servers s ON cm.server_id = s.id
                WHERE cm.customer_id = ? OR cm.customer_id = ?
            `, [customer.id, customer.customerid]);
            
            if (mappings.length > 0) {
                mappings.forEach((m: any) => {
                    console.log(`  - Mapping Found: ServerID=${m.server_id}, ServerIP=${m.server_ip}, CustomerIP=${m.customer_ip}`);
                });
            } else {
                console.log(`  - No mapping found in cloud_mappings table.`);
            }
            
            // Check top activities
            const activities = await AppDataSource.query(`
                SELECT id, server_name, activity_date, record_nature 
                FROM cloud_activities 
                WHERE (customer_id = ? OR customer_id = ? OR customer_name = ?) 
                ORDER BY activity_date DESC LIMIT 3
            `, [customer.id, customer.customerid, customer.company]);
            
            if (activities.length > 0) {
                 console.log(`  - Latest 3 Activities:`);
                 activities.forEach((a: any) => {
                     console.log(`    * [${a.record_nature}] Date: ${a.activity_date}, server_name: "${a.server_name}"`);
                 });
            }
        } else {
            console.log(`Customer like "${name}" not found.`);
        }
        console.log('------------------------------');
    }
    
    await AppDataSource.destroy();
}

check().catch(console.error);
