const jwt = require('jsonwebtoken');
const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env'));
const mysql = require('mysql2/promise');

async function run() {
    const c = await mysql.createConnection({host:'localhost', port:3307, user:'root', password:'password', database:'abs_cloud'});
    const [u] = await c.query("SELECT * FROM cloud_users WHERE name LIKE '%Kalu%' LIMIT 1");
    const user = u[0];
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions
    };
    const token = jwt.sign(payload, env.JWT_SECRET || 'secret');
    
    const fetch = require('node-fetch');
    const res = await fetch('http://localhost:5000/api/tally/expiry-report?customer_type=our', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    console.log('API RESPONSE TOTAL:', data.total);

    c.end();
}
run();
