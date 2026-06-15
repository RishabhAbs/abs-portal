import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import * as crypto from 'crypto';

export interface TdlExpiryRecord {
  id: number;
  customer_name: string;
  tdl_name: string;
  first_activation_date: string | null;
  total_amount: number;
  amc_amount: number;
  billing_cycle: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  start_date: string | null;
  remark: string | null;
  expiry_date: string;
  texpiry: string | null;
  release_version: string | null;
  token: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TdlExpiryInput {
  customer_name: string;
  tdl_name: string;
  first_activation_date?: string;
  total_amount?: number;
  amc_amount?: number;
  billing_cycle?: string;
  start_date?: string;
  remark?: string;
  expiry_date?: string;
  texpiry?: string | null;
  release_version?: string;
}

@Injectable()
export class TdlExpiryService implements OnModuleInit {
  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    try {
      const cols = await this.db.query<{ Field: string }>('DESCRIBE tdl_expiry_records');
      const names = cols.map(c => c.Field);
      if (!names.includes('billing_cycle'))
        await this.db.execute(`ALTER TABLE tdl_expiry_records ADD COLUMN billing_cycle ENUM('monthly','quarterly','half_yearly','yearly') NOT NULL DEFAULT 'yearly'`);
      if (!names.includes('start_date'))
        await this.db.execute(`ALTER TABLE tdl_expiry_records ADD COLUMN start_date DATE NULL`);
      if (!names.includes('remark'))
        await this.db.execute(`ALTER TABLE tdl_expiry_records ADD COLUMN remark TEXT NULL`);
    } catch (e: any) {
      // Table may not exist yet — ignore, it will be created by first usage
    }
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  async findAll(page = 1, limit = 25, search = ''): Promise<{ data: TdlExpiryRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const like = `%${search}%`;

    const [rows, countRows] = await Promise.all([
      this.db.query<TdlExpiryRecord>(
        `SELECT * FROM tdl_expiry_records
         WHERE customer_name LIKE ? OR tdl_name LIKE ? OR release_version LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [like, like, like, limit, offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) as total FROM tdl_expiry_records
         WHERE customer_name LIKE ? OR tdl_name LIKE ? OR release_version LIKE ?`,
        [like, like, like],
      ),
    ]);

    return { data: rows, total: countRows[0]?.total ?? 0 };
  }

  async findByToken(token: string): Promise<{ expiry_date: string; texpiry?: string; effective_expiry_date: string; release_version: string | null } | null> {
    const row = await this.db.queryOne<TdlExpiryRecord>(
      `SELECT expiry_date, texpiry, release_version, is_active FROM tdl_expiry_records WHERE token = ?`,
      [token],
    );
    if (!row || !row.is_active) return null;
    const effective_expiry_date = row.texpiry && row.texpiry > row.expiry_date
      ? row.texpiry
      : row.expiry_date;
    return {
      expiry_date: row.expiry_date,
      ...(row.texpiry ? { texpiry: row.texpiry } : {}),
      effective_expiry_date,
      release_version: row.release_version,
    };
  }

  async setActive(id: number, isActive: boolean): Promise<void> {
    await this.db.execute(
      'UPDATE tdl_expiry_records SET is_active = ? WHERE id = ?',
      [isActive ? 1 : 0, id],
    );
  }

  async create(data: TdlExpiryInput): Promise<TdlExpiryRecord> {
    let token: string;
    // Retry on the rare collision chance
    for (let i = 0; i < 5; i++) {
      token = this.generateToken();
      const existing = await this.db.queryOne('SELECT id FROM tdl_expiry_records WHERE token = ?', [token]);
      if (!existing) break;
    }

    const result = await this.db.execute(
      `INSERT INTO tdl_expiry_records
         (customer_name, tdl_name, first_activation_date, total_amount, amc_amount,
          billing_cycle, start_date, remark, expiry_date, release_version, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.customer_name,
        data.tdl_name,
        data.first_activation_date || null,
        data.total_amount ?? 0,
        data.amc_amount ?? 0,
        data.billing_cycle || 'yearly',
        data.start_date || null,
        data.remark || null,
        data.expiry_date || null,
        data.release_version || null,
        token!,
      ],
    );

    return this.db.queryOne<TdlExpiryRecord>('SELECT * FROM tdl_expiry_records WHERE id = ?', [(result as any).insertId]) as Promise<TdlExpiryRecord>;
  }

  async update(id: number, data: Partial<TdlExpiryInput>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.customer_name !== undefined) { fields.push('customer_name = ?'); values.push(data.customer_name); }
    if (data.tdl_name !== undefined)      { fields.push('tdl_name = ?');      values.push(data.tdl_name); }
    if (data.first_activation_date !== undefined) { fields.push('first_activation_date = ?'); values.push(data.first_activation_date || null); }
    if (data.total_amount !== undefined)  { fields.push('total_amount = ?');  values.push(data.total_amount); }
    if (data.amc_amount !== undefined)    { fields.push('amc_amount = ?');    values.push(data.amc_amount); }
    if (data.expiry_date !== undefined)   { fields.push('expiry_date = ?');   values.push(data.expiry_date); }
    if ('texpiry' in data)               { fields.push('texpiry = ?');        values.push(data.texpiry || null); }
    if (data.release_version !== undefined) { fields.push('release_version = ?'); values.push(data.release_version || null); }
    if (data.billing_cycle !== undefined)  { fields.push('billing_cycle = ?');  values.push(data.billing_cycle); }
    if (data.start_date !== undefined)     { fields.push('start_date = ?');     values.push(data.start_date || null); }
    if (data.remark !== undefined)         { fields.push('remark = ?');         values.push(data.remark || null); }

    if (fields.length === 0) return;
    values.push(id);
    await this.db.execute(`UPDATE tdl_expiry_records SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM tdl_expiry_records WHERE id = ?', [id]);
  }
}
