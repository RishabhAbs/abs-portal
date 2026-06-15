import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';

export type BillingCycle = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface TdlBillingActivity {
  id: number;
  tdl_expiry_id: number;
  customer_name: string;
  tdl_name: string;
  type: 'new' | 'renew';
  cycle: BillingCycle;
  amc_amount: number;
  total_amount: number;
  start_date: string;
  expiry_date: string;
  notes: string | null;
  created_at: string;
}

export interface CreateBillingInput {
  tdl_expiry_id: number;
  customer_name: string;
  tdl_name: string;
  cycle: BillingCycle;
  amc_amount?: number;
  total_amount?: number;
  start_date?: string;
  notes?: string;
}

const toYMD = (d: string) => d.split('T')[0];

@Injectable()
export class TdlBillingService {
  constructor(private readonly db: DbService) {}

  private calculateExpiry(startDate: string, cycle: BillingCycle): string {
    const d = new Date(startDate);
    switch (cycle) {
      case 'monthly':     d.setMonth(d.getMonth() + 1); break;
      case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
      case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
      case 'yearly':      d.setFullYear(d.getFullYear() + 1); break;
    }
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  async getCustomers(search = ''): Promise<{ customer_name: string; tdl_count: number }[]> {
    return this.db.query(
      `SELECT customer_name, COUNT(*) as tdl_count
       FROM tdl_expiry_records
       WHERE customer_name LIKE ?
       GROUP BY customer_name
       ORDER BY customer_name`,
      [`%${search}%`],
    );
  }

  async getTdlsByCustomer(customerName: string): Promise<any[]> {
    return this.db.query(
      `SELECT te.id, te.tdl_name, te.expiry_date, te.texpiry, te.release_version,
              COUNT(ba.id) as billing_count,
              MAX(ba.expiry_date) as last_billing_expiry
       FROM tdl_expiry_records te
       LEFT JOIN tdl_billing_activities ba ON ba.tdl_expiry_id = te.id
       WHERE te.customer_name = ?
       GROUP BY te.id, te.tdl_name, te.expiry_date, te.texpiry, te.release_version
       ORDER BY te.tdl_name`,
      [customerName],
    );
  }

  async prepare(tdlExpiryId: number, cycle: BillingCycle, startDateOverride?: string): Promise<{
    type: 'new' | 'renew';
    start_date: string;
    expiry_date: string;
    last_expiry: string | null;
  }> {
    const [lastActivity, tdlRecord] = await Promise.all([
      this.db.queryOne<{ expiry_date: string }>(
        `SELECT expiry_date FROM tdl_billing_activities
         WHERE tdl_expiry_id = ?
         ORDER BY expiry_date DESC LIMIT 1`,
        [tdlExpiryId],
      ),
      this.db.queryOne<{ texpiry: string | null; expiry_date: string | null }>(
        `SELECT texpiry, expiry_date FROM tdl_expiry_records WHERE id = ?`,
        [tdlExpiryId],
      ),
    ]);

    const type: 'new' | 'renew' = lastActivity ? 'renew' : 'new';
    const today = new Date().toISOString().split('T')[0];

    let start_date: string;
    if (startDateOverride) {
      start_date = startDateOverride;
    } else if (type === 'renew') {
      const lastExpiry = toYMD(lastActivity!.expiry_date);
      // Credit back from expiry+1 only when texpiry is actively extending the TDL;
      // if no texpiry, the TDL was genuinely expired — start fresh from today.
      const hasTexpiry = !!(tdlRecord?.texpiry && toYMD(tdlRecord.texpiry) > lastExpiry);
      if (hasTexpiry) {
        const d = new Date(lastExpiry);
        d.setDate(d.getDate() + 1);
        start_date = d.toISOString().split('T')[0];
      } else {
        // No active texpiry — user must choose the start date; default empty (use today as fallback only for expiry calc)
        start_date = '';
      }
    } else {
      start_date = today;
    }

    const expiry_date = start_date ? this.calculateExpiry(start_date, cycle) : '';

    return { type, start_date, expiry_date, last_expiry: lastActivity?.expiry_date ?? null };
  }

  async findAll(page: number, limit: number, search: string): Promise<{ data: TdlBillingActivity[]; total: number }> {
    const offset = (page - 1) * limit;
    const like = `%${search}%`;
    const [rows, countRows] = await Promise.all([
      this.db.query<TdlBillingActivity>(
        `SELECT * FROM tdl_billing_activities
         WHERE customer_name LIKE ? OR tdl_name LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [like, like, limit, offset],
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*) as total FROM tdl_billing_activities
         WHERE customer_name LIKE ? OR tdl_name LIKE ?`,
        [like, like],
      ),
    ]);
    return { data: rows, total: countRows[0]?.total ?? 0 };
  }

  async update(id: number, data: {
    cycle?: BillingCycle;
    start_date?: string;
    amc_amount?: number;
    total_amount?: number;
    notes?: string;
  }): Promise<TdlBillingActivity> {
    const existing = await this.db.queryOne<TdlBillingActivity>(
      'SELECT * FROM tdl_billing_activities WHERE id = ?', [id],
    );
    if (!existing) throw new Error('Record not found');

    const cycle = data.cycle ?? existing.cycle;
    const startDate = data.start_date ?? toYMD(existing.start_date);
    const expiryDate = this.calculateExpiry(startDate, cycle);

    const fields: string[] = ['cycle = ?', 'start_date = ?', 'expiry_date = ?'];
    const values: any[] = [cycle, startDate, expiryDate];

    if (data.amc_amount !== undefined)  { fields.push('amc_amount = ?');  values.push(data.amc_amount); }
    if (data.total_amount !== undefined) { fields.push('total_amount = ?'); values.push(data.total_amount); }
    if ('notes' in data)                { fields.push('notes = ?');        values.push(data.notes || null); }

    values.push(id);
    await this.db.execute(`UPDATE tdl_billing_activities SET ${fields.join(', ')} WHERE id = ?`, values);

    // Re-sync TDL expiry to latest billing activity expiry
    const latest = await this.db.queryOne<{ expiry_date: string }>(
      `SELECT expiry_date FROM tdl_billing_activities
       WHERE tdl_expiry_id = ? ORDER BY expiry_date DESC LIMIT 1`,
      [existing.tdl_expiry_id],
    );
    if (latest) {
      await this.db.execute(
        'UPDATE tdl_expiry_records SET expiry_date = ? WHERE id = ?',
        [latest.expiry_date, existing.tdl_expiry_id],
      );
    }

    return this.db.queryOne<TdlBillingActivity>(
      'SELECT * FROM tdl_billing_activities WHERE id = ?', [id],
    ) as Promise<TdlBillingActivity>;
  }

  async delete(id: number): Promise<void> {
    // Get the activity before deleting so we know which TDL to re-sync
    const activity = await this.db.queryOne<TdlBillingActivity>(
      'SELECT * FROM tdl_billing_activities WHERE id = ?', [id],
    );
    if (!activity) return;

    await this.db.execute('DELETE FROM tdl_billing_activities WHERE id = ?', [id]);

    // Re-sync expiry_date on the TDL record to the latest remaining activity (or NULL)
    const latest = await this.db.queryOne<{ expiry_date: string; start_date: string }>(
      `SELECT expiry_date, start_date FROM tdl_billing_activities
       WHERE tdl_expiry_id = ? ORDER BY expiry_date DESC LIMIT 1`,
      [activity.tdl_expiry_id],
    );
    await this.db.execute(
      'UPDATE tdl_expiry_records SET expiry_date = ? WHERE id = ?',
      [latest?.expiry_date ?? null, activity.tdl_expiry_id],
    );
  }

  async create(data: CreateBillingInput): Promise<TdlBillingActivity> {
    const { type, start_date } = await this.prepare(data.tdl_expiry_id, data.cycle);
    const finalStart = data.start_date || start_date;
    const finalExpiry = this.calculateExpiry(finalStart, data.cycle);

    const result = await this.db.execute(
      `INSERT INTO tdl_billing_activities
         (tdl_expiry_id, customer_name, tdl_name, type, cycle, amc_amount, total_amount, start_date, expiry_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.tdl_expiry_id, data.customer_name, data.tdl_name, type, data.cycle,
        data.amc_amount ?? 0, data.total_amount ?? 0, finalStart, finalExpiry,
        data.notes || null,
      ],
    );

    // Sync the new expiry_date back to tdl_expiry_records
    const tdl = await this.db.queryOne<any>('SELECT * FROM tdl_expiry_records WHERE id = ?', [data.tdl_expiry_id]);
    const syncFields: string[] = ['expiry_date = ?'];
    const syncValues: any[] = [finalExpiry];
    if (type === 'new' && !tdl?.first_activation_date) {
      syncFields.push('first_activation_date = ?');
      syncValues.push(finalStart);
    }
    syncValues.push(data.tdl_expiry_id);
    await this.db.execute(`UPDATE tdl_expiry_records SET ${syncFields.join(', ')} WHERE id = ?`, syncValues);

    return this.db.queryOne<TdlBillingActivity>(
      'SELECT * FROM tdl_billing_activities WHERE id = ?',
      [(result as any).insertId],
    ) as Promise<TdlBillingActivity>;
  }
}
