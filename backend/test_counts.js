const mysql = require('mysql2/promise'); 
async function run() { 
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'}); 
    const [c1] = await c.query("SELECT count(*) as c1 FROM customer c LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) WHERE a.name LIKE '%Kalu%'"); 
    const [c2] = await c.query("SELECT count(*) as c2 FROM tallydetails td JOIN customer c ON td.customerid = c.id LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) WHERE a.name LIKE '%Kalu%'"); 
    console.log('Customer count:', c1[0].c1, 'Tallydetails count:', c2[0].c2); 
    
    // Let's also test the exact tally.service.ts where query
    const [c3] = await c.query(`
        SELECT count(*) as c3 
        FROM tallydetails td 
        JOIN customer c ON td.customerid = c.id 
        LEFT JOIN cloud_users cu ON c.group = cu.id
        LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) 
        WHERE (a.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(cu.name, '%'))
    `);
    console.log('Exact query match:', c3[0].c3);

    c.end(); 
} 
run();
