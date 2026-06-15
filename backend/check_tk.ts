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
    
    console.log('--- TK INFRA Detailed Check ---');
    const [customer] = await AppDataSource.query(`SELECT id, company, customerid FROM customer WHERE company LIKE '%TK INFRA%'`);
    if (customer) {
        console.log(`Customer: ${customer.company}`);
        console.log(`ID: ${customer.id}`);
        console.log(`LegacyID (customerid): ${customer.customerid}`);
        
        const allMappings = await AppDataSource.query(`SELECT * FROM cloud_mappings WHERE customer_id = ? OR customer_id = ?`, [customer.id, customer.customerid]);
        console.log(`Mappings found: ${allMappings.length}`);
        allMappings.forEach((m: any) => console.log('  M:', m));
        
        const activities = await AppDataSource.query(`SELECT id, customer_id, customer_name, customer_domain_ip, server_name, activity_date FROM cloud_activities WHERE customer_name LIKE '%TK INFRA%' ORDER BY activity_date DESC`);
        console.log(`Activities found: ${activities.length}`);
        activities.forEach((a: any) => console.log('  A:', a));
    }
    
    await AppDataSource.destroy();
}

check().catch(console.error);
