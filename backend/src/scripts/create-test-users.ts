import * as mysql from 'mysql2/promise';
import * as bcrypt from 'bcryptjs';

// Default permissions
const defaultUserPermissions = {
  servers: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
  customers_our: { view: true, create: false, edit: false, delete: false, export: false },
  customers_not_our: { view: true, create: false, edit: false, delete: false, export: false },
  mappings: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
  users: { view: false, create: false, edit: false, delete: false },
  tasks: { view: true, create: false, edit: false, delete: false, checkin: false, view_history: false },
  visits_our: { view: true, create: false, edit: false, delete: false, checkin: false, force_checkin: false, pause: false },
  visits_not_our: { view: true, create: false, edit: false, delete: false, checkin: false, force_checkin: false, pause: false },
  pincodes: { view: false, create: false, edit: false, delete: false },
  activities: { view: true, create: false, edit: false, delete: false, export: false },
  tdl: { view: false, create: false, edit: false, delete: false, add_requirement: false, delete_requirement: false, add_task: false },
  service_calls: { view: false, create: false, take: false, close: false, transfer: false, cancel: false, view_all: false },
};

const adminPermissions = {
  servers: { view: true, create: true, edit: true, delete: true, export: true, bulk_renewal: true },
  customers_our: { view: true, create: true, edit: true, delete: true, export: true },
  customers_not_our: { view: true, create: true, edit: true, delete: true, export: true },
  mappings: { view: true, create: true, edit: true, delete: true, export: true, bulk_renewal: true },
  users: { view: true, create: true, edit: true, delete: true },
  tasks: { view: true, create: true, edit: true, delete: true, checkin: true, view_history: true },
  visits_our: { view: true, create: true, edit: true, delete: true, checkin: true, force_checkin: true, pause: true },
  visits_not_our: { view: true, create: true, edit: true, delete: true, checkin: true, force_checkin: true, pause: true },
  pincodes: { view: true, create: true, edit: true, delete: true },
  activities: { view: true, create: true, edit: true, delete: true, export: true },
  tdl: { view: true, create: true, edit: true, delete: true, add_requirement: true, delete_requirement: true, add_task: true },
  service_calls: { view: true, create: true, take: true, close: true, transfer: true, cancel: true, view_all: true },
};

async function createTestUsers() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password',
    database: 'abs_cloud'
  });

  const hashedPwd = bcrypt.hashSync('testpassword', 12);
  
  // Create Admin
  await connection.execute(`
    INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
  `, [
    'USR998', 'Test Admin', 'admin@test.com', hashedPwd, 'admin', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(adminPermissions)
  ]);

  // Create Employee
  const employeePerms = { ...defaultUserPermissions };
  // Just view permissions, exactly as user says "only view permission"
  employeePerms.service_calls.view = true;
  
  await connection.execute(`
    INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
  `, [
    'USR999', 'Test Employee', 'employee@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(employeePerms)
  ]);

  // Create Creator (Can Add, cannot Take/Close)
  const creatorPerms = { ...defaultUserPermissions };
  creatorPerms.service_calls = { ...defaultUserPermissions.service_calls, view: true, create: true };
  
  await connection.execute(`
    INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
  `, [
    'USR997', 'Test Creator', 'creator@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(creatorPerms)
  ]);

  // Create Editor (Can Take/Close, cannot Add)
  const editorPerms = { ...defaultUserPermissions };
  editorPerms.service_calls = { ...defaultUserPermissions.service_calls, view: true, take: true, close: true };
  
  await connection.execute(`
    INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
  `, [
    'USR996', 'Test Editor', 'editor@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(editorPerms)
  ]);

  console.log('Test users created successfully!');
  await connection.end();
}

createTestUsers().catch(async (e) => {
  console.log("Failed with root/password, trying root/root");
  try {
    const connection = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'root', database: 'abscloud' });
    const hashedPwd = bcrypt.hashSync('testpassword', 12);
  
    // Create Admin
    await connection.execute(`
      INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
    `, [
      'USR998', 'Test Admin', 'admin@test.com', hashedPwd, 'admin', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(adminPermissions)
    ]);
  
    // Create Employee
    const employeePerms = { ...defaultUserPermissions };
    employeePerms.service_calls.view = true;
    
    await connection.execute(`
      INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
    `, [
      'USR999', 'Test Employee', 'employee@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(employeePerms)
    ]);
  
    // Create Creator (Can Add, cannot Take/Close)
    const creatorPerms = { ...defaultUserPermissions };
    creatorPerms.service_calls = { ...defaultUserPermissions.service_calls, view: true, create: true };
    
    await connection.execute(`
      INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
    `, [
      'USR997', 'Test Creator', 'creator@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(creatorPerms)
    ]);
  
    // Create Editor (Can Take/Close, cannot Add)
    const editorPerms = { ...defaultUserPermissions };
    editorPerms.service_calls = { ...defaultUserPermissions.service_calls, view: true, take: true, close: true };
    
    await connection.execute(`
      INSERT INTO cloud_users (id, name, email, password_hash, role, status, is_two_fa_enabled, two_fa_secret, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), is_two_fa_enabled = VALUES(is_two_fa_enabled), permissions = VALUES(permissions)
    `, [
      'USR996', 'Test Editor', 'editor@test.com', hashedPwd, 'user', 'active', 1, 'TESTSECRETABCDEF', JSON.stringify(editorPerms)
    ]);

    console.log('Test users created successfully!');
    await connection.end();
  } catch (err) {
    console.error(err);
  }
});
