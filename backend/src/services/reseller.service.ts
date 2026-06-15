import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface ResellerInput {
  name?: string;
  mobile?: string;
  email?: string;
  pan?: string;
  address?: string;
}

@Injectable()
export class ResellerService {
  constructor(private db: DbService) {}

  async findAll(search: string = ''): Promise<any[]> {
    if (search.trim()) {
      const like = `%${search.trim()}%`;
      return this.db.query<any>(
        `SELECT id, name, mobile, email, pan, address, date
         FROM reseller
         WHERE name LIKE ? OR mobile LIKE ? OR email LIKE ?
         ORDER BY name ASC`,
        [like, like, like],
      );
    }
    return this.db.query<any>(
      `SELECT id, name, mobile, email, pan, address, date FROM reseller ORDER BY name ASC`,
    );
  }

  async findOne(id: number): Promise<any> {
    const row = await this.db.queryOne<any>(
      `SELECT id, name, mobile, email, pan, address, date FROM reseller WHERE id = ?`, [id],
    );
    if (!row) throw new NotFoundException('Reseller not found');
    return row;
  }

  async create(data: ResellerInput): Promise<{ id: number }> {
    if (!data.name || !data.name.trim()) throw new BadRequestException('Name is required');
    // The existing rows use DD/MM/YYYY in `date`. Match that format so the
    // column reads consistently in reports and exports.
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    const result = await this.db.execute(
      `INSERT INTO reseller (name, mobile, email, pan, address, date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.name.trim(),
        data.mobile || '',
        data.email || '',
        data.pan || '',
        data.address || '',
        dateStr,
      ],
    );
    return { id: result.insertId };
  }

  async update(id: number, data: ResellerInput): Promise<void> {
    const existing = await this.findOne(id); // 404 if missing
    const fields: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined)    { fields.push('name = ?');    params.push(data.name.trim()); }
    if (data.mobile !== undefined)  { fields.push('mobile = ?');  params.push(data.mobile); }
    if (data.email !== undefined)   { fields.push('email = ?');   params.push(data.email); }
    if (data.pan !== undefined)     { fields.push('pan = ?');     params.push(data.pan); }
    if (data.address !== undefined) { fields.push('address = ?'); params.push(data.address); }
    if (!fields.length) return;
    params.push(id);
    await this.db.execute(`UPDATE reseller SET ${fields.join(', ')} WHERE id = ?`, params);
    void existing;
  }

  async delete(id: number): Promise<void> {
    // Block delete when any customer still points at this reseller — otherwise
    // we'd leave dangling resellerid references in the customer table.
    const linked = await this.db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM customer WHERE resellerid = ?`, [id],
    );
    if ((linked?.cnt ?? 0) > 0) {
      throw new BadRequestException(
        `Cannot delete: ${linked!.cnt} customer(s) are still assigned to this reseller. Reassign them first.`,
      );
    }
    await this.db.execute(`DELETE FROM reseller WHERE id = ?`, [id]);
  }
}
