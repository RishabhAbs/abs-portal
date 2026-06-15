import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface Mapping {
  id: string;
  server_id: string;
  customer_id: number;  // INT reference to customer.id
  serial_no: string | null;
  billed_users: number;
  purchase_users: number;
  status: 'Active' | 'Inactive';
  mapped_at: string;
  // Joined data
  server_ip?: string;
  customer_name?: string;
  billing_cycle?: string;
  billing_mode?: string;
  billing_rate?: number;
  expiry_date?: string;
}

@Injectable()
export class MappingsService implements OnModuleInit {
  constructor(private db: DbService) { }

  async onModuleInit() {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS cloud_mappings (
          id VARCHAR(50) PRIMARY KEY,
          server_id VARCHAR(50) NOT NULL,
          customer_id INT NOT NULL,
          serial_no VARCHAR(100),
          billed_users INT DEFAULT 0,
          purchase_users INT DEFAULT 0,
          status ENUM('Active', 'Inactive') DEFAULT 'Active',
          mapped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // FIX: Relax constraints to allow Multi-Server Mapping (One customer -> Multiple Servers)
      // But prevent duplicate (Customer + Server) pairs.

      // 1. Drop old strict constraint if exists
      try {
        const check = await this.db.query(`SHOW INDEX FROM cloud_mappings WHERE Key_name = 'unique_customer'`);
        if (check.length > 0) {
          console.log('Migrating: Dropping strict unique_customer constraint...');
          await this.db.execute(`ALTER TABLE cloud_mappings DROP INDEX unique_customer`);
        }
      } catch (e) {
        // Ignore if error
      }

      // 2. Add new composite constraint if not exists
      try {
        const checkComposite = await this.db.query(`SHOW INDEX FROM cloud_mappings WHERE Key_name = 'unique_mapping'`);
        if (checkComposite.length === 0) {
          console.log('Migrating: Adding composite unique_mapping constraint...');
          await this.db.execute(`CREATE UNIQUE INDEX unique_mapping ON cloud_mappings(customer_id, server_id)`);
        }
      } catch (e) {
        console.error('Failed to add composite index:', e.message);
      }

      try {
        const columns = await this.db.query<any>(`DESCRIBE cloud_mappings`);
        const columnNames = columns.map((c: any) => c.Field);

        if (!columnNames.includes('billing_cycle')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN billing_cycle VARCHAR(50)`);
        if (!columnNames.includes('billing_mode')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN billing_mode VARCHAR(50)`);
        if (!columnNames.includes('billing_rate')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN billing_rate DECIMAL(10, 2) DEFAULT 0`);
        if (!columnNames.includes('purchase_rate')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN purchase_rate DECIMAL(10, 2) DEFAULT 0`);
        if (!columnNames.includes('expiry_date')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN expiry_date DATE`);
        if (!columnNames.includes('purchased_users')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN purchased_users INT DEFAULT 0`);
        if (!columnNames.includes('effective_cycle')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN effective_cycle VARCHAR(50)`);
        if (!columnNames.includes('effective_mode')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN effective_mode VARCHAR(50)`);
        if (!columnNames.includes('effective_rate')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN effective_rate DECIMAL(10, 2) DEFAULT 0`);
        if (!columnNames.includes('effective_expiry')) await this.db.execute(`ALTER TABLE cloud_mappings ADD COLUMN effective_expiry DATE`);

      } catch (e) {
        console.error('MappingsService: Column check error:', e.message);
      }

      // Backfill: populate customer_id from numeric customer_domain_ip where customer_id is NULL
      try {
        const result = await this.db.execute(`
          UPDATE cloud_activities ca
          JOIN customer c ON ca.customer_domain_ip = CAST(c.id AS CHAR)
          SET ca.customer_id = c.id
          WHERE ca.customer_id IS NULL
            AND ca.customer_domain_ip IS NOT NULL
            AND ca.customer_domain_ip REGEXP '^[0-9]+$'
        `);
        if (result.affectedRows > 0) {
          console.log(`MappingsService: Backfilled customer_id for ${result.affectedRows} activities`);
        }
      } catch (e) {
        console.error('MappingsService: customer_id backfill error:', e.message);
      }

      // Backfill: populate server_expiry from latest Purchase activity (New/Renewal) for each server
      try {
        const result = await this.db.execute(`
          UPDATE cloud_servers s
          JOIN (
            SELECT ca.server_name, MAX(ca.new_expiry_date) as purchase_expiry
            FROM cloud_activities ca
            WHERE ca.record_nature = 'Purchase'
              AND ca.activity_type IN ('New', 'Renewal')
              AND ca.new_expiry_date IS NOT NULL
            GROUP BY ca.server_name
          ) pa ON (s.customer_ip = pa.server_name OR s.server_ip = pa.server_name)
          SET s.server_expiry = pa.purchase_expiry
          WHERE s.server_expiry IS NULL
        `);
        if (result.affectedRows > 0) {
          console.log(`MappingsService: Backfilled server_expiry for ${result.affectedRows} servers from purchase activities`);
        }
      } catch (e) {
        console.error('MappingsService: server_expiry backfill error:', e.message);
      }
    } catch (error) {
      console.error('MappingsService: Schema error:', error.message);
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 50,
    serverId?: string,
    search?: string,
    filters?: {
      status?: string;
      billing_mode?: string;
      billing_cycle?: string;
      expiry_start?: string;
      expiry_end?: string;
      mapped_at_start?: string;
      mapped_at_end?: string;
      company?: string;
      customer_ip?: string;
      serial_no?: string;
      min_rate?: string | number;
      max_rate?: string | number;
    },
    sort?: { field: string; dir: 'ASC' | 'DESC' }
  ): Promise<{ data: Mapping[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    let whereConditions: string[] = [];
    const params: any[] = [];



    // --- FILTERS ---
    if (serverId) {
      whereConditions.push('m.server_id = ?');
      params.push(serverId);
    }

    if (search) {
      whereConditions.push('(c.company LIKE ? OR m.serial_no LIKE ? OR s.server_ip LIKE ? OR s.customer_ip LIKE ? OR c.id LIKE ?)');
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    if (filters?.status && filters.status !== 'all' && filters.status !== 'All' && filters.status !== '') {
      whereConditions.push('m.status = ?');
      params.push(filters.status);
    }

    if (filters?.billing_mode && filters.billing_mode !== 'all' && filters.billing_mode !== '') {
      whereConditions.push('m.effective_mode = ?');
      params.push(filters.billing_mode);
    }

    if (filters?.billing_cycle && filters.billing_cycle !== 'all' && filters.billing_cycle !== '') {
      whereConditions.push('m.effective_cycle = ?');
      params.push(filters.billing_cycle);
    }

    if (filters?.expiry_start && filters.expiry_start !== '') {
      if (filters?.expiry_end && filters.expiry_end !== '') {
        whereConditions.push(`m.effective_expiry BETWEEN ? AND ?`);
        params.push(filters.expiry_start, filters.expiry_end);
      } else {
        whereConditions.push(`m.effective_expiry >= ?`);
        params.push(filters.expiry_start);
      }
    } else if (filters?.expiry_end && filters.expiry_end !== '') {
      whereConditions.push(`m.effective_expiry <= ?`);
      params.push(filters.expiry_end);
    }

    // New specific filters
    if (filters?.company && filters.company !== '') {
      whereConditions.push('c.company LIKE ?');
      params.push(`%${filters.company}%`);
    }

    if (filters?.customer_ip && filters.customer_ip !== '') {
      whereConditions.push('(s.customer_ip LIKE ? OR s.server_ip LIKE ?)');
      params.push(`%${filters.customer_ip}%`, `%${filters.customer_ip}%`);
    }

    if (filters?.serial_no && filters.serial_no !== '') {
      whereConditions.push('m.serial_no LIKE ?');
      params.push(`%${filters.serial_no}%`);
    }

    if (filters?.mapped_at_start && filters.mapped_at_start !== '') {
       if (filters?.mapped_at_end && filters.mapped_at_end !== '') {
         whereConditions.push('m.mapped_at BETWEEN ? AND ?');
         params.push(`${filters.mapped_at_start} 00:00:00`, `${filters.mapped_at_end} 23:59:59`);
       } else {
         whereConditions.push('m.mapped_at >= ?');
         params.push(`${filters.mapped_at_start} 00:00:00`);
       }
    } else if (filters?.mapped_at_end && filters.mapped_at_end !== '') {
       whereConditions.push('m.mapped_at <= ?');
       params.push(`${filters.mapped_at_end} 23:59:59`);
    }

    if (filters?.min_rate !== undefined && filters.min_rate !== '') {
      whereConditions.push(`m.effective_rate >= ?`);
      params.push(filters.min_rate);
    }
    if (filters?.max_rate !== undefined && filters.max_rate !== '') {
      whereConditions.push(`m.effective_rate <= ?`);
      params.push(filters.max_rate);
    }

    const where = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // --- SORTING ---
    let orderBy = 'm.mapped_at DESC'; // Default
    if (sort?.field) {
      const fieldMap: any = {
        'customer': 'c.company',
        'server_ip': 's.server_ip',
        'sof_no': 'm.serial_no', // Assuming serial_no is SOF No
        'expiry_date': 'm.expiry_date',
        'billing_rate': 'm.billing_rate',
        'billing_mode': 'm.billing_mode',
        'created_at': 'm.mapped_at',
        'status': 'm.status'
      };
      const dbField = fieldMap[sort.field] || sort.field;
      // Sanitize dir
      const dir = sort.dir === 'ASC' ? 'ASC' : 'DESC';
      orderBy = `${dbField} ${dir}`;
    }

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      ${where}
    `;

    const countResult = await this.db.queryOne<{ total: number }>(countQuery, params);

    // Live B.U. / P.U. — sum of billing/purchase_units across activities whose
    // running period covers today. Overrides the stored cloud_mappings.billed_users
    // / purchase_users so the column is always in sync with cloud_activities,
    // no manual backfill needed when an activity is added or expires.
    const finalQuery = `
      SELECT m.*,
        s.server_ip,
        s.customer_ip,
        c.company as customer_name,
        c.email as customer_email,
        c.area as customer_area,
        m.effective_cycle,
        m.effective_mode,
        m.effective_rate,
        m.effective_expiry,
        m.billing_cycle,
        m.billing_mode,
        m.billing_rate,
        m.expiry_date,
        COALESCE(la.live_bu, m.billed_users)   AS billed_users,
        COALESCE(la.live_pu, m.purchase_users) AS purchase_users
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id,
          SUM(CASE WHEN record_nature = 'Sales'    AND CURDATE() BETWEEN start_from AND new_expiry_date THEN billing_units  ELSE 0 END) AS live_bu,
          SUM(CASE WHEN record_nature = 'Purchase' AND CURDATE() BETWEEN start_from AND new_expiry_date THEN purchase_units ELSE 0 END) AS live_pu
        FROM cloud_activities
        WHERE start_from IS NOT NULL AND new_expiry_date IS NOT NULL
        GROUP BY customer_id
      ) la ON la.customer_id = m.customer_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;



    const data = await this.db.query<Mapping>(finalQuery, params);

    return {
      data,
      total: countResult?.total || 0,
      page: Number(page),
      limit: Number(limit)
    };
  }

  async findById(id: string): Promise<Mapping> {
    const mapping = await this.db.queryOne<Mapping>(`
      SELECT m.*, 
        s.server_ip, 
        s.customer_ip,
        c.company as customer_name,
        c.email as customer_email,
        c.area as customer_area,
        m.billing_cycle,
        m.billing_mode,
        m.billing_rate,
        m.expiry_date
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      WHERE m.id = ?
    `, [id]);

    if (!mapping) throw new NotFoundException(`Mapping ${id} not found`);
    return mapping;
  }

  async findByCustomerId(customerId: number): Promise<Mapping | null> {
    return this.db.queryOne<Mapping>(`
      SELECT m.*, 
        s.server_ip, 
        s.customer_ip,
        c.company as customer_name,
        c.email as customer_email,
        c.area as customer_area,
        m.billing_cycle,
        m.billing_mode,
        m.billing_rate,
        m.expiry_date
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      WHERE m.customer_id = ?
    `, [customerId]);
  }

  async findAllByCustomerId(customerId: number): Promise<Mapping[]> {
    return this.db.query<Mapping>(`
      SELECT m.*, 
        s.server_ip, 
        s.customer_ip,
        c.company as customer_name,
        c.email as customer_email,
        c.area as customer_area,
        m.billing_cycle,
        m.billing_mode,
        m.billing_rate,
        m.expiry_date
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      WHERE m.customer_id = ?
    `, [customerId]);
  }

  async findByServerId(serverId: string): Promise<Mapping[]> {
    return this.db.query(`
      SELECT m.*, 
        s.server_ip, 
        s.customer_ip,
        c.company as customer_name,
        c.email as customer_email,
        c.area as customer_area,
        m.billing_cycle,
        m.billing_mode,
        m.billing_rate,
        m.expiry_date
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      WHERE m.server_id = ?
      ORDER BY m.mapped_at DESC
    `, [serverId]);
  }

  async create(data: Partial<Mapping>): Promise<Mapping> {
    // Validate server exists
    const server = await this.db.queryOne(`SELECT id FROM cloud_servers WHERE id = ?`, [data.server_id]);
    if (!server) throw new NotFoundException('Server not found');

    // Validate customer exists
    const customer = await this.db.queryOne(`SELECT id FROM customer WHERE id = ?`, [data.customer_id]);
    if (!customer) throw new NotFoundException('Customer not found');

    // Check if customer is already mapped to THIS server (UNIQUE constraint on pair)
    const existing = await this.db.queryOne(
      `SELECT id FROM cloud_mappings WHERE customer_id = ? AND server_id = ?`,
      [data.customer_id, data.server_id]
    );

    if (existing) throw new ConflictException('Customer is already mapped to this server');

    // Generate ID
    const lastMapping = await this.db.queryOne<{ id: string }>(`
      SELECT id FROM cloud_mappings ORDER BY id DESC LIMIT 1
    `);
    const nextNum = lastMapping ? parseInt(lastMapping.id.replace('MAP', '')) + 1 : 1;
    const id = `MAP${String(nextNum).padStart(3, '0')}`;

    await this.db.execute(`
      INSERT INTO cloud_mappings (id, server_id, customer_id, serial_no, billed_users, purchase_users, status, mapped_at)
      VALUES (?, ?, ?, ?, 0, 0, ?, NOW())
    `, [id, data.server_id, data.customer_id, data.serial_no || null, data.status || 'Active']);

    await this.refreshEffectiveFields({ mappingId: id });

    return this.findById(id);
  }

  async update(id: string, data: Partial<Mapping>): Promise<Mapping> {
    const current = await this.findById(id); // Check exists & Get current state

    // Check for potential duplicate if changing server or customer
    if (data.server_id || data.customer_id) {
      const targetServerId = data.server_id || current.server_id;
      const targetCustomerId = data.customer_id || current.customer_id;

      const existing = await this.db.queryOne(
        `SELECT id FROM cloud_mappings WHERE customer_id = ? AND server_id = ? AND id != ?`,
        [targetCustomerId, targetServerId, id]
      );

      if (existing) throw new ConflictException('Customer is already mapped to this server');
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (data.server_id) { fields.push('server_id = ?'); values.push(data.server_id); }
    if (data.serial_no !== undefined) { fields.push('serial_no = ?'); values.push(data.serial_no); }
    if (data.status) { fields.push('status = ?'); values.push(data.status); }
    if (data.billing_rate !== undefined) { fields.push('billing_rate = ?'); values.push(data.billing_rate); }
    if (data.expiry_date !== undefined) { fields.push('expiry_date = ?'); values.push(data.expiry_date); }
    if (data.billing_cycle !== undefined) { fields.push('billing_cycle = ?'); values.push(data.billing_cycle); }
    if (data.billing_mode !== undefined) { fields.push('billing_mode = ?'); values.push(data.billing_mode); }

    if (fields.length > 0) {
      values.push(id);
      await this.db.execute(`UPDATE cloud_mappings SET ${fields.join(', ')} WHERE id = ?`, values);
      await this.refreshEffectiveFields({ mappingId: id });
    }

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.db.execute(`DELETE FROM cloud_mappings WHERE id = ?`, [id]);
  }

  async getUnmappedCustomers(): Promise<any[]> {
    return this.db.query(`
      SELECT c.*
      FROM customer c
      WHERE c.id NOT IN (SELECT DISTINCT customer_id FROM cloud_mappings WHERE status = 'Active')
      ORDER BY c.company
    `);
  }

  async isCustomerMapped(customerId: number): Promise<boolean> {
    const mapping = await this.findByCustomerId(customerId);
    return !!mapping;
  }

  async refreshEffectiveFields(params: { mappingId?: string; customerId?: number; serverId?: string }): Promise<void> {
    let where = '';
    const queryParams: any[] = [];

    if (params.mappingId) {
      where = 'WHERE m.id = ?';
      queryParams.push(params.mappingId);
    } else if (params.customerId) {
      where = 'WHERE m.customer_id = ?';
      queryParams.push(params.customerId);
    } else if (params.serverId) {
      where = 'WHERE m.server_id = ?';
      queryParams.push(params.serverId);
    } else {
      return; // Safety
    }

    const mappings = await this.db.query<any>(`
      SELECT m.id, m.server_id, m.customer_id, c.company,
        m.billing_cycle, m.billing_mode, m.billing_rate, m.expiry_date,
        s.billing_cycle as s_cycle, s.billing_mode as s_mode, s.purchase_rate as s_rate, s.server_expiry as s_expiry
      FROM cloud_mappings m
      JOIN cloud_servers s ON m.server_id = s.id
      JOIN customer c ON m.customer_id = c.id
      ${where}
    `, queryParams);

    for (const m of mappings) {
      const activities = await this.db.query<any>(`
        SELECT last_bill_rate, new_expiry_date
        FROM cloud_activities
        WHERE (customer_id = ? OR customer_name = ?)
          AND record_nature = 'Sales'
          AND activity_type IN ('New', 'Renewal')
        ORDER BY activity_date DESC LIMIT 1
      `, [m.customer_id, m.company]);

      const act = activities[0] || {};
      const effCycle = m.billing_cycle || m.s_cycle;
      const effMode = m.billing_mode || m.s_mode;
      const effRate = parseFloat(m.billing_rate) > 0 ? parseFloat(m.billing_rate) : (parseFloat(act.last_bill_rate || m.s_rate || 0));
      const effExpiry = m.expiry_date || act.new_expiry_date || m.s_expiry;

      await this.db.execute(`
        UPDATE cloud_mappings
        SET effective_cycle = ?, effective_mode = ?, effective_rate = ?, effective_expiry = ?
        WHERE id = ?
      `, [effCycle, effMode, effRate, effExpiry, m.id]);
    }
  }
}
