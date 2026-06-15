const mysql = require('mysql2/promise'); 
async function run() { 
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'}); 
    
    // Test the exact tally.service.ts query for Kalu in March 2026
    const [c3] = await c.query(`
        SELECT count(*) as c3 
        FROM tallydetails td 
        JOIN customer c ON td.customerid = c.id 
        LEFT JOIN cloud_users cu ON c.group = cu.id
        LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) 
        WHERE (a.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(cu.name, '%'))
        AND td.active_status = 'Active'
        AND DATE(td.tallyexpirydate) >= '2026-03-01' 
        AND DATE(td.tallyexpirydate) <= '2026-03-31'
    `);
    console.log('Exact query match in March 2026:', c3[0].c3);

    const [call] = await c.query(`SELECT count(*) as total FROM tallydetails td JOIN customer c ON td.customerid = c.id LEFT JOIN cloud_users cu ON c.group = cu.id LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) WHERE (a.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(cu.name, '%')) AND td.active_status = 'Active'`);
    console.log('Total Active for Kalu:', call[0].total);

    c.end(); 
} 
run();
