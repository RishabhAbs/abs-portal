const mysql = require('mysql2/promise');

async function migrateAndBackfill() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3307,
    user: 'root',
    password: 'password',
    database: 'abs_cloud'
  });

  try {
    console.log('--- Phase 1: Migration (Creating Columns) ---');
    try {
      await connection.execute(`
        ALTER TABLE cloud_mappings
        ADD COLUMN effective_rate DECIMAL(10,2) DEFAULT 0.00,
        ADD COLUMN effective_expiry DATE DEFAULT NULL,
        ADD COLUMN effective_cycle VARCHAR(50) DEFAULT NULL,
        ADD COLUMN effective_mode VARCHAR(50) DEFAULT NULL;
      `);
      console.log('Columns added successfully.');
    } catch (e) {
      if (e.code === 'ER_DUP_COLUMN_NAME') {
        console.log('Columns already exist, skipping creation.');
      } else {
        throw e;
      }
    }

    await connection.execute(`CREATE INDEX idx_effective_rate ON cloud_mappings(effective_rate)`);
    await connection.execute(`CREATE INDEX idx_effective_expiry ON cloud_mappings(effective_expiry)`);
    console.log('Indexes created.');

    console.log('\n--- Phase 2: Backfill (Calculating Values) ---');
    
    // 1. Get all mappings with their server defaults and latest activities
    const [mappings] = await connection.execute(`
      SELECT m.id, m.customer_id, c.company,
        m.billing_cycle, m.billing_mode, m.billing_rate, m.expiry_date,
        s.billing_cycle as s_cycle, s.billing_mode as s_mode, s.purchase_rate as s_rate, s.server_expiry as s_expiry
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
    `);

    console.log(`Processing ${mappings.length} mappings...`);

    for (const m of mappings) {
      // Find latest activity
      const [activities] = await connection.execute(`
        SELECT last_bill_rate, new_expiry_date 
        FROM cloud_activities 
        WHERE (customer_id = ? OR customer_name = ?) 
          AND record_nature = 'Sales' 
          AND activity_type IN ('New', 'Renewal') 
        ORDER BY activity_date DESC LIMIT 1
      `, [m.customer_id, m.company]);

      const act = activities[0] || {};

      const effective_cycle = m.billing_cycle || m.s_cycle;
      const effective_mode = m.billing_mode || m.s_mode;
      const effective_rate = parseFloat(m.billing_rate) > 0 ? parseFloat(m.billing_rate) : (parseFloat(act.last_bill_rate || m.s_rate || 0));
      const effective_expiry = m.expiry_date || act.new_expiry_date || m.s_expiry;

      await connection.execute(`
        UPDATE cloud_mappings 
        SET effective_cycle = ?, effective_mode = ?, effective_rate = ?, effective_expiry = ?
        WHERE id = ?
      `, [effective_cycle, effective_mode, effective_rate, effective_expiry, m.id]);
    }

    console.log('--- Migration & Backfill Complete ---');

  } catch (err) {
    console.error('Migration/Backfill failed:', err);
  } finally {
    await connection.end();
  }
}

migrateAndBackfill();
