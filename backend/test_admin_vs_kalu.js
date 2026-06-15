const mysql = require('mysql2/promise');

async function run() {
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'});

    // What Kalu sees (the group filter logic applied automatically to everything)
    const [kalu] = await c.query(`
        SELECT c.company, td.tallyserial, a.name as admin_name, cu.name as cu_name 
        FROM tallydetails td 
        JOIN customer c ON td.customerid = c.id 
        LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) 
        LEFT JOIN cloud_users cu ON c.group = cu.id 
        WHERE (a.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT('Kalu Ram Jakhar', '%') OR 'Kalu Ram Jakhar' LIKE CONCAT(cu.name, '%'))
        AND td.active_status = 'Active' 
        AND DATE(td.tallyexpirydate) >= '2026-03-01' 
        AND DATE(td.tallyexpirydate) <= '2026-03-31'
    `);
    console.log('Kalu View (10?):', kalu.length);

    // What Admin sees when searching for "Kalu" (the global search logic)
    const [admin] = await c.query(`
        SELECT c.company, td.tallyserial, a.name as admin_name, cu.name as cu_name 
        FROM tallydetails td 
        JOIN customer c ON td.customerid = c.id 
        LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR) 
        LEFT JOIN cloud_users cu ON c.group = cu.id 
        WHERE td.active_status = 'Active' 
        AND DATE(td.tallyexpirydate) >= '2026-03-01' 
        AND DATE(td.tallyexpirydate) <= '2026-03-31' 
        AND (td.tallyserial LIKE '%Kalu%' OR c.company LIKE '%Kalu%' OR c.mobile LIKE '%Kalu%' OR a.name LIKE '%Kalu%' OR cu.name LIKE '%Kalu%')
    `);
    console.log('Admin View (6?):', admin.length);

    console.log('Kalu set minus Admin set:');
    const kaluMap = kalu.map(k => k.tallyserial);
    const adminMap = admin.map(a => a.tallyserial);
    const diff = kalu.filter(k => !adminMap.includes(k.tallyserial));
    console.log(diff);

    c.end();
}
run();
