const mysql = require('mysql2/promise');

async function run() {
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'});

    // What Kalu sees distribution
    const [kalu] = await c.query(`
        SELECT td.tally_status, count(*) as count
        FROM tallydetails td 
        JOIN customer c ON td.customerid = c.id 
        LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) 
        LEFT JOIN cloud_users cu ON c.group = cu.id 
        WHERE (a.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(cu.name, '%'))
        AND td.active_status = 'Active' 
        AND DATE(td.tallyexpirydate) >= '2026-03-01' 
        AND DATE(td.tallyexpirydate) <= '2026-03-31'
        GROUP BY td.tally_status
    `);
    console.log('Distribution for Kalu in March 2026:');
    console.log(kalu);

    c.end();
}
run();
