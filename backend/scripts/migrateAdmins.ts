import * as mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const defaultUserPermissions = {
  servers: { view: true, create: false, edit: false, delete: false },
  customers_our: { view: true, create: false, edit: false, delete: false },
  customers_not_our: { view: true, create: false, edit: false, delete: false },
  mappings: { view: true, create: false, edit: false, delete: false },
  users: { view: false, create: false, edit: false, delete: false },
  tasks: { view: true, create: false, edit: false, delete: false, view_history: false },
  visits_our: { view: true, create: false, edit: false, delete: false },
  visits_not_our: { view: true, create: false, edit: false, delete: false },
  pincodes: { view: false, create: false, edit: false, delete: false },
  activities: { view: true, create: false, edit: false, delete: false },
  tdl: { view: false, create: false, edit: false, delete: false },
};

const adminPermissions = {
  servers: { view: true, create: true, edit: true, delete: true },
  customers_our: { view: true, create: true, edit: true, delete: true },
  customers_not_our: { view: true, create: true, edit: true, delete: true },
  mappings: { view: true, create: true, edit: true, delete: true },
  users: { view: true, create: true, edit: true, delete: true },
  tasks: { view: true, create: true, edit: true, delete: true, view_history: true },
  visits_our: { view: true, create: true, edit: true, delete: true },
  visits_not_our: { view: true, create: true, edit: true, delete: true },
  pincodes: { view: true, create: true, edit: true, delete: true },
  activities: { view: true, create: true, edit: true, delete: true },
  tdl: { view: true, create: true, edit: true, delete: true },
};

async function run() {
  console.log('Starting Legacy Admin to Cloud Users Migration...');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'abs_cloud',
  });

  const [admins] = await conn.query<any[]>('SELECT * FROM admin');
  let [cloudUsers] = await conn.query<any[]>('SELECT id, email FROM cloud_users');
  console.log(`Found ${admins.length} legacy admins, and ${cloudUsers.length} existing cloud_users`);

  let count = 0;
  for (const admin of admins) {
    const email = admin.username;
    if (!cloudUsers.find(u => u.email === email)) {
      // Find max ID to increment
      const [lastUser] = await conn.query<any[]>(`SELECT id FROM cloud_users ORDER BY id DESC LIMIT 1`);
      
      let nextNum = 1;
      if (lastUser && lastUser.length > 0 && lastUser[0].id) {
         nextNum = parseInt(lastUser[0].id.replace('USR', '')) + 1;
      }
      
      const userId = `USR${String(nextNum).padStart(3, '0')}`;
      const passwordHash = await bcrypt.hash(admin.password || '123456', 12);

      const isActive = admin.active.toUpperCase() === 'YES' ? 'active' : 'inactive';
      const role = email === 'sumit@abssolutions.in' || admin.id === 1 ? 'admin' : 'user';
      const perms = JSON.stringify(role === 'admin' ? adminPermissions : defaultUserPermissions);

      try {
        await conn.query(`
          INSERT INTO cloud_users (id, name, email, password_hash, role, status, permissions, tag, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [userId, admin.name || email, email, passwordHash, role, isActive, perms, 'Outside']);
        console.log(`Migrated user ${email}`);
        count++;
        // Re-fetch users so max-id works
        [cloudUsers] = await conn.query<any[]>('SELECT id, email FROM cloud_users');
      } catch (e: any) {
        console.error(`Failed to migrate ${email}:`, e.message);
      }
    }
  }

  await conn.end();
  console.log(`Successfully migrated ${count} users!`);
}

run().catch(console.error);
