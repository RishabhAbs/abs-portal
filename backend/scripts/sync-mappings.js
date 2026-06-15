const mysql = require('mysql2/promise');

async function syncMappings() {
  // Configuration - Update these for production if running there
  const config = {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'abs_cloud',
    port: 3307
  };

  console.log('Connecting to database...');
  const connection = await mysql.createConnection(config);

  try {
    // 1. Fetch all mappings
    console.log('Fetching mappings...');
    const [mappings] = await connection.execute(`
      SELECT m.id, m.customer_id, c.company,
             m.billing_cycle, m.billing_mode, m.billing_rate, m.expiry_date,
             s.billing_cycle as s_cycle, s.billing_mode as s_mode, s.purchase_rate as s_rate, s.server_expiry as s_expiry
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
    `);

    console.log(`Found ${mappings.length} mappings. Starting sync...`);

    let updatedCount = 0;

    for (const m of mappings) {
      // 2. Look up latest Sales/Billing activity
      // We check by ID OR Company Name because production has ID mismatches
      const [activities] = await connection.execute(`
        SELECT last_bill_rate, new_expiry_date, billing_cycle, billing_mode
        FROM cloud_activities 
        WHERE (customer_id = ? OR customer_name = ?) 
          AND record_nature = 'Sales' 
          AND (activity_type IN ('New', 'Renewal') OR billing_activity_type IN ('New', 'Renewal'))
        ORDER BY activity_date DESC LIMIT 1
      `, [m.customer_id, m.company]);

      const act = activities[0] || {};
      
      // 3. Calculate Effective Fields
      // Logic from MappingsService:
      // - Rate: Mapping Rate > 0 ? Mapping Rate : (Activity Rate || Server Rate)
      // - Expiry: Mapping Expiry || Activity Expiry || Server Expiry
      // - Cycle: Mapping Cycle || Server Cycle (Note: Activity cycle could also be checked)
      // - Mode: Mapping Mode || Server Mode
      
      const effCycle = m.billing_cycle || m.s_cycle || act.billing_cycle || 'Monthly';
      const effMode = m.billing_mode || m.s_mode || act.billing_mode || 'month_to_month';
      
      const mRate = parseFloat(m.billing_rate || 0);
      const actRate = parseFloat(act.last_bill_rate || 0);
      const sRate = parseFloat(m.s_rate || 0);
      const effRate = mRate > 0 ? mRate : (actRate > 0 ? actRate : sRate);
      
      const effExpiry = m.expiry_date || act.new_expiry_date || m.s_expiry;

      // 4. Update the mapping
      await connection.execute(`
        UPDATE cloud_mappings 
        SET effective_cycle = ?, 
            effective_mode = ?, 
            effective_rate = ?, 
            effective_expiry = ?
        WHERE id = ?
      `, [effCycle, effMode, effRate, effExpiry, m.id]);

      updatedCount++;
      if (updatedCount % 50 === 0) {
        console.log(`Updated ${updatedCount}/${mappings.length} mappings...`);
      }
    }

    console.log(`Successfully synchronized ${updatedCount} mappings.`);
    
    // Summary of some key fixes
    const [checkBimal] = await connection.execute(`
      SELECT company, effective_rate, effective_expiry 
      FROM cloud_mappings m 
      JOIN customer c ON m.customer_id = c.id 
      WHERE c.company LIKE '%BIMAL AUTO AGENCY%'
    `);
    if (checkBimal.length > 0) {
       console.log('\nVerification (BIMAL AUTO AGENCY):');
       console.log(JSON.stringify(checkBimal, null, 2));
    }

  } catch (error) {
    console.error('Error during synchronization:', error);
  } finally {
    await connection.end();
  }
}

syncMappings();
