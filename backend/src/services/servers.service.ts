import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { encryptPassword, decryptPassword } from '../utils/crypto.util';

export interface Server {
  id: string;
  server_ip: string;
  sof_no: string | null;
  port: string;
  customer_ip: string | null;
  admin_username: string | null;
  admin_password_enc: string | null;
  admin_password?: string | null; // Decrypted password for frontend display
  status: 'Active' | 'Inactive' | 'Maintenance';
  company: string | null;
  purchase_rate: number | null;
  purchase_units: number;
  billing_mode: 'day_to_day' | 'month_to_month';
  billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
  server_expiry: string | null;  // Server subscription expiry date
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ServersService implements OnModuleInit {
  constructor(private db: DbService) { }

  async onModuleInit() {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS cloud_servers (
          id VARCHAR(50) PRIMARY KEY,
          server_ip VARCHAR(50) NOT NULL,
          sof_no VARCHAR(50),
          port VARCHAR(10) DEFAULT '22',
          customer_ip VARCHAR(50),
          admin_username VARCHAR(100),
          admin_password_enc TEXT,
          status ENUM('Active', 'Inactive', 'Maintenance') DEFAULT 'Active',
          company VARCHAR(255),
          purchase_rate DECIMAL(10, 2) DEFAULT 0,
          purchase_units INT DEFAULT 0,
          billing_mode ENUM('day_to_day', 'month_to_month') DEFAULT 'month_to_month',
          billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') DEFAULT 'Monthly',
          server_expiry DATE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // Check for columns (migrations)
      const cols = await this.db.query<any>(`DESCRIBE cloud_servers`);
      const colNames = cols.map((c: any) => c.Field);

      if (!colNames.includes('billing_mode')) await this.db.execute(`ALTER TABLE cloud_servers ADD COLUMN billing_mode ENUM('day_to_day', 'month_to_month') DEFAULT 'month_to_month'`);
      if (!colNames.includes('billing_cycle')) await this.db.execute(`ALTER TABLE cloud_servers ADD COLUMN billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') DEFAULT 'Monthly'`);
      if (!colNames.includes('server_expiry')) await this.db.execute(`ALTER TABLE cloud_servers ADD COLUMN server_expiry DATE`);
      if (!colNames.includes('sof_no')) await this.db.execute(`ALTER TABLE cloud_servers ADD COLUMN sof_no VARCHAR(50)`);
      if (!colNames.includes('ping_test')) await this.db.execute(`ALTER TABLE cloud_servers ADD COLUMN ping_test TINYINT(1) NOT NULL DEFAULT 0`);

    } catch (error) {
      console.error('ServersService: Schema error:', error.message);
    }
  }

  async findAll(page: number = 1, limit: number = 50, search: string = '', filters: any = {}): Promise<{ data: Server[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const params: any[] = [];
    let whereClause = '1=1';



    if (search) {
      whereClause += ` AND (server_ip LIKE ? OR company LIKE ? OR admin_username LIKE ? OR customer_ip LIKE ? OR sof_no LIKE ? OR id LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    // Apply specific filters
    if (filters.server_ip) {
      whereClause += ` AND server_ip LIKE ?`;
      params.push(`%${filters.server_ip}%`);
    }
    if (filters.company) {
      whereClause += ` AND company LIKE ?`;
      params.push(`%${filters.company}%`);
    }
    if (filters.status && filters.status !== 'all') {
      whereClause += ` AND status = ?`;
      params.push(filters.status);
    }
    if (filters.port) {
      whereClause += ` AND port LIKE ?`;
      params.push(`%${filters.port}%`);
    }
    if (filters.customer_ip) {
      whereClause += ` AND customer_ip LIKE ?`;
      params.push(`%${filters.customer_ip}%`);
    }
    if (filters.admin_username) {
      whereClause += ` AND admin_username LIKE ?`;
      params.push(`%${filters.admin_username}%`);
    }
    if (filters.billing_mode && filters.billing_mode !== 'all') {
      whereClause += ` AND billing_mode = ?`;
      params.push(filters.billing_mode);
    }
    if (filters.billing_cycle && filters.billing_cycle !== 'all') {
      whereClause += ` AND billing_cycle = ?`;
      params.push(filters.billing_cycle);
    }
    if (filters.expiry_start) {
      whereClause += ` AND server_expiry >= ?`;
      params.push(filters.expiry_start);
    }
    if (filters.expiry_end) {
      whereClause += ` AND server_expiry <= ?`;
      params.push(filters.expiry_end);
    }

    const finalQuery = `
      SELECT s.*,
        (SELECT COUNT(*) FROM cloud_mappings WHERE server_id = s.id) as customer_count
      FROM cloud_servers s
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;



    const rows = await this.db.query<Server>(finalQuery, params);

    const countResult = await this.db.queryOne<{ total: number }>(`
      SELECT COUNT(*) as total FROM cloud_servers s WHERE ${whereClause}
    `, params);

    // Decrypt passwords for display
    const data = rows.map(server => {
      let decryptedPassword = null;
      if (server.admin_password_enc) {
        try {
          decryptedPassword = decryptPassword(server.admin_password_enc);
        } catch (e) {
          console.warn(`Could not decrypt password for server ${server.id} in findAll`);
          decryptedPassword = '[encrypted]';
        }
      }
      return { ...server, admin_password_enc: decryptedPassword, admin_password: decryptedPassword };
    });

    return {
      data,
      total: countResult?.total || 0,
      page: Number(page),
      limit: Number(limit)
    };
  }

  async getForDropdown(): Promise<any[]> {
    return this.db.query(`SELECT id, server_ip, company FROM cloud_servers WHERE status = 'Active' ORDER BY server_ip`);
  }

  async findById(id: string): Promise<Server> {
    const server = await this.db.queryOne<Server>(`SELECT * FROM cloud_servers WHERE id = ?`, [id]);
    if (!server) throw new NotFoundException(`Server ${id} not found`);

    // Decrypt password for display (gracefully handle key mismatch)
    let decryptedPassword = null;
    if (server.admin_password_enc) {
      try {
        decryptedPassword = decryptPassword(server.admin_password_enc);
      } catch (e) {
        console.warn(`Could not decrypt password for server ${id}`);
        decryptedPassword = '[encrypted]';
      }
    }

    return {
      ...server,
      admin_password_enc: decryptedPassword,
      admin_password: decryptedPassword
    };
  }

  async create(data: Partial<Server>): Promise<Server> {
    // Generate ID
    const lastServer = await this.db.queryOne<{ id: string }>(`
      SELECT id FROM cloud_servers ORDER BY id DESC LIMIT 1
    `);
    const nextNum = lastServer ? parseInt(lastServer.id.replace('SRV', '')) + 1 : 1;
    const id = `SRV${String(nextNum).padStart(3, '0')}`;

    // Encrypt password using AES-256-GCM
    // Frontend sends 'admin_password', we need to check both fields
    const passwordToEncrypt = (data as any).admin_password || data.admin_password_enc;
    const encryptedPassword = passwordToEncrypt
      ? encryptPassword(passwordToEncrypt)
      : null;

    await this.db.execute(`
      INSERT INTO cloud_servers(id, server_ip, sof_no, port, customer_ip, admin_username, admin_password_enc, status, company, purchase_rate, billing_mode, billing_cycle, server_expiry, ping_test, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      id,
      data.server_ip,
      data.sof_no || null,
      data.port,
      data.customer_ip || null,
      data.admin_username || null,
      encryptedPassword,
      data.status || 'Active',
      data.company || null,
      data.purchase_rate || null,
      data.billing_mode || 'day_to_day',
      data.billing_cycle || 'Yearly',
      data.server_expiry || null,
      (data as any).ping_test ? 1 : 0
    ]);

    return this.findById(id);
  }

  async update(id: string, data: Partial<Server>): Promise<Server> {
    await this.findById(id); // Check exists

    const fields: string[] = [];
    const values: any[] = [];

    if (data.server_ip) { fields.push('server_ip = ?'); values.push(data.server_ip); }
    if (data.sof_no !== undefined) { fields.push('sof_no = ?'); values.push(data.sof_no); }
    if (data.port) { fields.push('port = ?'); values.push(data.port); }
    if (data.customer_ip !== undefined) { fields.push('customer_ip = ?'); values.push(data.customer_ip); }
    if (data.admin_username !== undefined) { fields.push('admin_username = ?'); values.push(data.admin_username); }

    // Check for password update - frontend sends 'admin_password'
    const passwordToUpdate = (data as any).admin_password !== undefined ? (data as any).admin_password : data.admin_password_enc;
    if (passwordToUpdate !== undefined) {
      // Encrypt password using AES-256-GCM
      const encrypted = passwordToUpdate ? encryptPassword(passwordToUpdate) : null;
      fields.push('admin_password_enc = ?');
      values.push(encrypted);
    }
    if (data.status) { fields.push('status = ?'); values.push(data.status); }
    if (data.company !== undefined) { fields.push('company = ?'); values.push(data.company); }
    if (data.purchase_rate !== undefined) { fields.push('purchase_rate = ?'); values.push(data.purchase_rate); }
    if (data.billing_mode) { fields.push('billing_mode = ?'); values.push(data.billing_mode); }
    if (data.billing_cycle) { fields.push('billing_cycle = ?'); values.push(data.billing_cycle); }
    if (data.server_expiry !== undefined) {
      fields.push('server_expiry = ?');
      values.push(data.server_expiry || null);
    }
    if ((data as any).ping_test !== undefined) {
      fields.push('ping_test = ?');
      values.push((data as any).ping_test ? 1 : 0);
    }

    if (fields.length > 0) {
      // fields.push('updated_at = NOW()');
      values.push(id);
      await this.db.execute(`UPDATE cloud_servers SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    return this.findById(id);
  }

  async setPingTest(id: string, enabled: boolean): Promise<void> {
    await this.db.execute(`UPDATE cloud_servers SET ping_test = ? WHERE id = ?`, [enabled ? 1 : 0, id]);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);

    // Check if server has mappings
    const mappings = await this.db.query(`SELECT id FROM cloud_mappings WHERE server_id = ?`, [id]);
    if (mappings.length > 0) {
      throw new ConflictException('Cannot delete server with active mappings');
    }

    await this.db.execute(`DELETE FROM cloud_servers WHERE id = ?`, [id]);
  }

  async getCustomerCount(serverId: string): Promise<number> {
    const result = await this.db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM cloud_mappings WHERE server_id = ? AND status = 'Active'
  `, [serverId]);
    return result?.count || 0;
  }
}
