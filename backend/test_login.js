const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function run() {
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'});

    // Create a temporary mock user with Kaluram's name and 'user' role
    await c.execute(`UPDATE cloud_users SET password_hash = ? WHERE name LIKE '%Kalu%'`, [await bcrypt.hash('password123', 10)]);
    const [u] = await c.query('SELECT email FROM cloud_users WHERE name LIKE "%Kalu%" LIMIT 1');
    const email = u[0].email;
    console.log("Testing with email:", email);
    c.end();

    try {
        const fetch = require('node-fetch'); // Let's use native fetch inside node 24
    } catch(e) {}

    // Login payload
    const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: 'password123' })
    });
    
    const loginData = await res.json();
    console.log("Login res:", loginData.success);

    if (loginData.token) {
        const expiryReq = await fetch('http://localhost:5000/api/tally/expiry-report?customer_type=our', {
            headers: { 'Authorization': 'Bearer ' + loginData.token }
        });
        const data = await expiryReq.json();
        console.log("Total records returned by API:", data.total);
    }
}
run();
