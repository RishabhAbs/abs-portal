import { Injectable, NotFoundException } from '@nestjs/common';

import { DbService } from '../database/db.service';
import { v4 as uuidv4 } from 'uuid';
import { getISTDateString, getISTComponents, addISTMonths, addISTDays } from '../utils/date.util';
import { IsString, IsNumber, IsOptional, IsBoolean, IsIn } from 'class-validator';
import { VouchersService } from './vouchers.service';

// Home state for CGST+SGST vs IGST — same convention Vouchers.tsx uses.
const HOME_STATE = 'Assam';
// Fixed line item every auto-created Tax Invoice bills against (confirmed choice).
const AUTO_INVOICE_ITEM_NAME = 'Cloud Charges';

// Helper to get days in a specific month
const getDaysInMonth = (year: number, month: number): number => {
  // month is 0-indexed (0=Jan, 1=Feb, ...)
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 1 && ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0))) {
    return 29;
  }
  return days[month];
};


export interface Activity {
  id: string; // Internal UUID
  display_id: string | null; // User-facing ID (ACT-xxx)
  customer_id: string | null;
  customer_name: string;
  customer_domain_ip?: string; // Customer domain IP (for linking)
  server_name: string | null;
  sof_no: string | null;
  activity_date: string;
  activity_type: 'New' | 'Renewal' | 'User';
  bill_type: 'Tax Invoice' | 'Credit Note';
  billing_units: number;
  purchase_units: number;
  last_bill_rate: number | null;
  purchase_rate: number | null;
  billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly' | null;
  old_expiry_date: string | null;
  start_from: string | null;
  new_expiry_date: string | null;
  date_diff_months: number;
  date_diff_days: number;
  bill_amount: number;
  purchase_amount: number;
  record_nature: 'Sales' | 'Purchase';
  group_id: string | null;
  billing_mode?: 'day_to_day' | 'month_to_month' | null;
  custom_period?: boolean;
  is_purchase?: boolean; // Flag for purchase activities
  // Independent activity types for Billing and Purchase
  billing_activity_type?: 'New' | 'Renewal' | 'User';
  purchase_activity_type?: 'New' | 'Renewal' | 'User';
  // Purchase Fields
  purchase_billing_mode?: 'day_to_day' | 'month_to_month' | null;
  purchase_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly' | null;
  purchase_start_from?: string;
  purchase_expiry?: string;
  version?: number;
  created_at: string;
}

export interface CreateActivityDto extends Partial<Activity> {
  is_sales?: boolean;
  is_purchase?: boolean;
  billing_activity_type?: 'New' | 'Renewal' | 'User'; // Independent Type
  purchase_activity_type?: 'New' | 'Renewal' | 'User'; // Independent Type
  server_id?: string; // Explicit Server ID target
}

// Calculation request/response interfaces
export class CalculationRequest {
  @IsString()
  @IsIn(['New', 'Renewal', 'User'])
  activity_type: 'New' | 'Renewal' | 'User';

  @IsString()
  @IsIn(['Tax Invoice', 'Credit Note'])
  bill_type: 'Tax Invoice' | 'Credit Note';

  @IsNumber()
  billing_units: number;

  @IsOptional()
  @IsNumber()
  purchase_units?: number;

  @IsNumber()
  last_bill_rate: number;

  @IsOptional()
  @IsNumber()
  purchase_rate?: number;

  @IsOptional()
  @IsString()
  @IsIn(['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'])
  billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';

  @IsOptional()
  @IsString()
  activity_date?: string;

  @IsOptional()
  @IsString()
  start_from?: string;

  @IsOptional()
  @IsString()
  new_expiry_date?: string;

  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  @IsIn(['day_to_day', 'month_to_month'])
  billing_mode?: 'day_to_day' | 'month_to_month';

  @IsOptional()
  @IsBoolean()
  custom_period?: boolean;

  // Purchase Fields
  @IsOptional()
  @IsString()
  @IsIn(['day_to_day', 'month_to_month'])
  purchase_billing_mode?: 'day_to_day' | 'month_to_month';

  @IsOptional()
  @IsString()
  @IsIn(['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'])
  purchase_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';

  @IsOptional()
  @IsString()
  purchase_start_from?: string;

  @IsOptional()
  @IsString()
  purchase_expiry?: string;
  
  @IsOptional()
  @IsString()
  server_id?: string;

  @IsOptional()
  @IsString()
  server_name?: string;

  @IsOptional()
  @IsString()
  server_ip?: string;
}

export interface CalculationResponse {
  bill_amount: number;
  purchase_amount: number;
  date_diff_months: number;
  date_diff_days: number;
  date_diff_label: string;
  purchase_date_diff_months?: number;
  purchase_date_diff_days?: number;
  purchase_date_diff_label?: string;
  new_expiry_date: string | null;
  purchase_expiry?: string | null; // Added field
  formula_breakdown: string;
}

// Helper function to format date for MySQL (YYYY-MM-DD)
const formatDateForMySQL = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  // Handle DD/MM/YYYY explicitly
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (dateStr.includes('T')) return dateStr.split('T')[0];
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const { year, month, day } = getISTComponents(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Helper to safely parse date string to a Date object at 12:00:00 to avoid shifts
const safeParseDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  const formatted = formatDateForMySQL(dateStr);
  if (!formatted) return null;

  const [y, m, d] = formatted.split('-').map(Number);
  // We use UTC 12:00 to ensure that when we do timezone conversions later,
  // we are far away from the midnight boundary.
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return isNaN(date.getTime()) ? null : date;
};

@Injectable()
export class ActivitiesService {
  // Request deduplication cache (requestId -> timestamp)
  private recentRequests = new Map<string, number>();
  private readonly REQUEST_CACHE_TTL = 5000; // 5 seconds

  constructor(private db: DbService, private vouchersService: VouchersService) {
    // Cleanup expired requests every minute
    setInterval(() => this.cleanupRequestCache(), 60000);
  }

  private cleanupRequestCache() {
    const now = Date.now();
    for (const [key, time] of this.recentRequests.entries()) {
      if (now - time > this.REQUEST_CACHE_TTL) {
        this.recentRequests.delete(key);
      }
    }
  }

  private checkDuplicateRequest(requestId?: string): void {
    if (!requestId) return;
    if (this.recentRequests.has(requestId)) {
      throw new Error('Duplicate request detected. Please wait and try again.');
    }
    this.recentRequests.set(requestId, Date.now());
  }

  // ── Migration: ensure voucher linkage columns exist on cloud_activities ──
  // voucher_id (FK to vch_details.id) is the source of truth — it survives
  // voucher renumbering. voucher_no is kept as a denormalized cache for old
  // rows that pre-date this migration; new rows can leave it NULL and rely
  // on the JOIN below.
  private migrated = false;
  private async ensureVoucherNoColumn() {
    if (this.migrated) return;
    this.migrated = true;
    await this.db.execute(
      `ALTER TABLE cloud_activities ADD COLUMN voucher_no VARCHAR(100) DEFAULT NULL`
    ).catch(() => {});
    await this.db.execute(
      `ALTER TABLE cloud_activities ADD COLUMN voucher_id INT DEFAULT NULL`
    ).catch(() => {});
    await this.db.execute(
      `ALTER TABLE cloud_activities ADD INDEX idx_voucher_id (voucher_id)`
    ).catch(() => {});
    // One-shot backfill: for any row that already has voucher_no but no
    // voucher_id, look up the matching vch_details row by vch_no.
    await this.db.execute(
      `UPDATE cloud_activities ca
         JOIN vch_details v ON v.vch_no = ca.voucher_no
         SET ca.voucher_id = v.id
       WHERE ca.voucher_id IS NULL AND ca.voucher_no IS NOT NULL`
    ).catch(() => {});
  }

  /** Pending (unbilled) activities for a customer — voucher_id IS NULL is
   *  the new authoritative check. Old rows without a voucher_id but with a
   *  voucher_no string are also treated as billed for safety. */
  async findPendingByCustomer(customerId: string, voucherId?: number): Promise<any[]> {
    await this.ensureVoucherNoColumn();
    // When editing an existing voucher, also surface activities already
    // linked to THAT voucher (not just unbilled ones) so the picker can
    // show what's currently selected instead of hiding it as "billed".
    return this.db.query<any>(
      `SELECT ca.*, COALESCE(ca.customer_name, c.company) as customer_name
       FROM cloud_activities ca
       LEFT JOIN customer c ON ca.customer_id = c.id
       WHERE ca.customer_id = ?
         AND (
           (ca.voucher_id IS NULL AND (ca.voucher_no IS NULL OR ca.voucher_no = ''))
           OR ca.voucher_id = ?
         )
         AND ca.record_nature = 'Sales'
       ORDER BY ca.activity_date DESC`,
      [customerId, voucherId ?? null]
    );
  }

  /** Pending (unbilled) purchase activities for a customer —
   *  Joins via sof_no: cloud_mappings -> cloud_servers.sof_no = cloud_activities.sof_no
   *  Falls back to Sales activities if no Purchase activities exist for the customer. */
  async findPendingPurchaseByCustomer(customerId: string, voucherId?: number): Promise<any[]> {
    await this.ensureVoucherNoColumn();
    // Try Purchase activities first via sof_no join. As above, activities
    // already linked to the voucher being edited are surfaced too so the
    // picker reflects the current selection rather than hiding it.
    const purchaseRows = await this.db.query<any>(
      `SELECT ca.*
       FROM cloud_activities ca
       JOIN cloud_servers cs ON cs.sof_no = ca.sof_no AND ca.sof_no IS NOT NULL AND ca.sof_no != ''
       JOIN cloud_mappings cm ON cm.server_id = cs.id
         AND cm.customer_id = ?
         AND cm.status = 'Active'
       WHERE (
           (ca.voucher_id IS NULL AND (ca.voucher_no IS NULL OR ca.voucher_no = ''))
           OR ca.voucher_id = ?
         )
         AND ca.record_nature = 'Purchase'
       ORDER BY ca.activity_date DESC`,
      [customerId, voucherId ?? null]
    );
    if (purchaseRows.length > 0) return purchaseRows;

    // Fallback: Sales activities directly on the customer (for customers billed directly)
    return this.db.query<any>(
      `SELECT ca.*
       FROM cloud_activities ca
       WHERE ca.customer_id = ?
         AND (
           (ca.voucher_id IS NULL AND (ca.voucher_no IS NULL OR ca.voucher_no = ''))
           OR ca.voucher_id = ?
         )
         AND ca.record_nature = 'Sales'
       ORDER BY ca.activity_date DESC`,
      [customerId, voucherId ?? null]
    );
  }

  /** Stamp voucher linkage on selected activities after voucher save.
   *  Accepts either a numeric vch_id (preferred) or the legacy voucher_no
   *  string. When vch_id is given we resolve and persist both fields, so a
   *  later renumbering of the voucher just needs the JOIN to surface the
   *  fresh vch_no. */
  async markActivitiesBilled(activityIds: string[], opts: { voucherId?: number; voucherNo?: string }): Promise<number> {
    await this.ensureVoucherNoColumn();
    if (!activityIds.length) return 0;
    let { voucherId, voucherNo } = opts;
    if (!voucherId && !voucherNo) return 0;

    // Resolve missing field from the other (best-effort).
    if (voucherId && !voucherNo) {
      const row = await this.db.queryOne<{ vch_no: string }>(
        `SELECT vch_no FROM vch_details WHERE id = ? LIMIT 1`,
        [voucherId],
      );
      voucherNo = row?.vch_no || undefined;
    } else if (!voucherId && voucherNo) {
      const row = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM vch_details WHERE vch_no = ? LIMIT 1`,
        [voucherNo],
      );
      voucherId = row?.id || undefined;
    }

    const placeholders = activityIds.map(() => '?').join(',');
    const result = await this.db.execute(
      `UPDATE cloud_activities SET voucher_id = ?, voucher_no = ? WHERE id IN (${placeholders})`,
      [voucherId ?? null, voucherNo ?? null, ...activityIds]
    );
    return result.affectedRows || 0;
  }

  /** Auto-create a Sales-family voucher for a just-created Billing
   *  Activity: one line of the fixed AUTO_INVOICE_ITEM_NAME item, qty 1,
   *  rate = the activity's own bill_amount, using this type's own
   *  auto-numbering (falls back to no number under manual numbering).
   *
   *  Voucher type: the caller-picked Sales child if given (validated as a
   *  Sales-family type), else "Cloud Billing", else "Tax Invoice".
   *  Returns null (never throws) if no usable type or the fixed item
   *  isn't set up — the caller logs that as a soft failure. */
  private async autoCreateTaxInvoiceForActivity(activity: Activity, voucherTypeId?: number): Promise<{ id: number; vch_no: string } | null> {
    // Family follows the activity's bill type:
    //   Tax Invoice → Sales family,       default "Cloud Billing"
    //   Credit Note → Credit Note family, default "Cloud CN"
    const isCreditNote = (activity as any).bill_type === 'Credit Note';
    const family = isCreditNote ? 'credit note' : 'sales';
    const defaultName = isCreditNote ? 'cloud cn' : 'cloud billing';
    const fallbackName = isCreditNote ? 'credit note' : 'tax invoice';

    let vchType: { id: number } | null = null;
    if (voucherTypeId) {
      // Only accept a type inside the correct family — an arbitrary id must
      // not create Payments/Journals (or the wrong side) from here. Family
      // membership walks the WHOLE parent chain, so sub-types of sub-types
      // (e.g. a custom type under Cloud Billing) validate correctly.
      const all = await this.db.query<any>(`SELECT id, name, parent_id FROM vchtype`);
      const byId = new Map(all.map((t: any) => [Number(t.id), t]));
      let cur: any = byId.get(Number(voucherTypeId));
      for (let hops = 0; cur && hops < 20; hops++) {
        if (String(cur.name || '').toLowerCase() === family) {
          vchType = { id: Number(voucherTypeId) };
          break;
        }
        if (cur.parent_id === cur.id || cur.parent_id == null) break; // hit a different root
        cur = byId.get(Number(cur.parent_id));
      }
    }
    if (!vchType) {
      vchType = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM vchtype WHERE LOWER(name) = ? LIMIT 1`, [defaultName],
      );
    }
    if (!vchType) {
      vchType = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM vchtype WHERE LOWER(name) = ? LIMIT 1`, [fallbackName],
      );
    }
    if (!vchType) return null;

    const item = await this.db.queryOne<{ id: number; gst: number }>(
      `SELECT id, gst FROM items WHERE LOWER(item_name) = ? LIMIT 1`,
      [AUTO_INVOICE_ITEM_NAME.toLowerCase()],
    );
    if (!item) return null;

    const activityDate = (activity as any).activity_date
      ? new Date((activity as any).activity_date).toISOString().split('T')[0]
      : getISTDateString();

    // Resolve customer's state the same way Vouchers.tsx does (direct
    // state name, else pincode lookup) to decide CGST+SGST vs IGST.
    let stateName = '';
    const customer = await this.db.queryOne<{ state: string | null; pincode: string | null }>(
      `SELECT state, pincode FROM customer WHERE id = ?`, [activity.customer_id],
    );
    if (customer?.state && isNaN(Number(customer.state))) {
      stateName = customer.state;
    } else if (customer?.pincode) {
      const pin = await this.db.queryOne<{ state: string | null }>(
        `SELECT s.name AS state FROM pincode p LEFT JOIN state s ON p.stateid = s.id WHERE p.pincode = ? LIMIT 1`,
        [String(customer.pincode).replace(/\D/g, '')],
      );
      if (pin?.state) stateName = pin.state;
    }
    const isIgst = stateName ? stateName.toLowerCase() !== HOME_STATE.toLowerCase() : false;

    // Credit Note activities carry negative units/amounts — the voucher line
    // itself is entered positive; the Credit Note type's deemed_positive=NO
    // flips the accounting direction.
    const rate = +Math.abs(Number(activity.bill_amount)).toFixed(2);
    const gstRate = Number(item.gst) || 0;
    const cgstAmount = isIgst ? 0 : +(rate * gstRate / 2 / 100).toFixed(2);
    const sgstAmount = isIgst ? 0 : +(rate * gstRate / 2 / 100).toFixed(2);
    const igstAmount = isIgst ? +(rate * gstRate / 100).toFixed(2) : 0;
    const grandTotal = +(rate + cgstAmount + sgstAmount + igstAmount).toFixed(2);

    // ALWAYS auto-number (even if the type is set to manual numbering) so
    // the bill allocation below can always be "New" with the voucher's own
    // number as its reference.
    const suggestedVchNo = await this.vouchersService.getNextVoucherNo(vchType.id, activityDate, { force: true });

    // Auto-remark: the voucher itself records what was billed — type,
    // bill type, cycle, mode, start → expiry, users @ rate = amount.
    // Mirrors the remark the Vouchers page writes when activities are
    // hand-picked via the Cloud Billing popup.
    const fmtD = (s: any) => {
      if (!s) return '';
      const d = new Date(String(s).replace(' ', 'T'));
      return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    };
    const a: any = activity;
    const autoRemark = [
      a.activity_type || 'Renewal',
      a.bill_type || '',
      a.billing_cycle || '',
      String(a.billing_mode || '').replace(/_/g, ' '),
      [fmtD(a.start_from), fmtD(a.new_expiry_date)].filter(Boolean).join(' to '),
      `${Number(a.billing_units) || 0} users @ ${Number(a.last_bill_rate) || 0} = ${Number(a.bill_amount || 0).toLocaleString('en-IN')}`,
    ].filter(Boolean).join(', ');

    const created = await this.vouchersService.create({
      remark: autoRemark || undefined,
      vch_type_id: vchType.id,
      vch_no: suggestedVchNo || undefined,
      vch_date: activityDate,
      party_ledger_id: Number(activity.customer_id),
      is_igst: isIgst,
      items: [{
        item_id: item.id,
        qty: 1,
        rate,
        amount: rate,
        gst_rate: gstRate,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        batch_rows: null,
      }],
      ledgers: [],
      // Always "New": the forced auto-number above guarantees a reference
      // (the backend uses the saved vch_no as the bill name for New rows).
      bill_allocation: [{ type: 'New', refno: '', amount: grandTotal, direction: isCreditNote ? 'Cr' : 'Dr' }],
    } as any);

    return { id: (created as any).id, vch_no: (created as any).vch_no };
  }

  async findAll(filters?: {
    activity_type?: string;
    bill_type?: string;
    customer_id?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
    record_nature?: string;
    server_name?: string;
    billing_cycle?: string;
    billing_mode?: string;
    min_amount?: number;
    max_amount?: number;
  }, page: number = 1, limit: number = 50): Promise<{ data: Activity[]; total: number; page: number; limit: number }> {
    // findAll JOINs cloud_activities.voucher_id, so the lazy migration must
    // run before the first read too — not just from the billing-picker path.
    await this.ensureVoucherNoColumn();
    const offset = (page - 1) * limit;
    let query = `
      SELECT ca.*,
        COALESCE(ca.customer_name, c.company) as customer_name,
        COALESCE(ca.customer_domain_ip, c.customerid) as customer_domain_ip,
        COALESCE(s.server_ip, s2.server_ip, s3.server_ip, c.customerid) as mapped_server_ip,
        COALESCE(s.customer_ip, s2.customer_ip, s3.customer_ip) as mapped_customer_ip,
        COALESCE(s.company, s2.company, s3.company) as mapped_server_company,
        COALESCE(s.server_ip, s2.server_ip, s3.server_ip) as server_ip,
        -- Live vch_no resolved from voucher_id (FK). Falls back to the
        -- denormalized voucher_no for legacy rows that pre-date the FK.
        COALESCE(v.vch_no, ca.voucher_no) AS voucher_no
      FROM cloud_activities ca
      LEFT JOIN customer c ON ca.customer_id = c.id
      LEFT JOIN vch_details v ON v.id = ca.voucher_id
      LEFT JOIN (
         SELECT customer_id, MAX(server_id) as server_id
         FROM cloud_mappings
         GROUP BY customer_id
      ) cm ON c.id = cm.customer_id
      LEFT JOIN cloud_servers s ON cm.server_id = s.id
      LEFT JOIN cloud_servers s2 ON (ca.server_name = s2.server_ip OR ca.server_name = s2.customer_ip)
      LEFT JOIN cloud_servers s3 ON (c.customerid = s3.server_ip OR c.customerid = s3.customer_ip)
      WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) as total FROM cloud_activities ca 
      LEFT JOIN customer c ON ca.customer_id = c.id
      WHERE 1=1`;
    const params: any[] = [];

    if (filters?.search) {
      const searchLike = `%${filters.search}%`;
      query += ` AND (ca.customer_name LIKE ? OR c.company LIKE ? OR ca.server_name LIKE ? OR ca.sof_no LIKE ?)`;
      countQuery += ` AND (ca.customer_name LIKE ? OR c.company LIKE ? OR ca.server_name LIKE ? OR ca.sof_no LIKE ?)`;
      params.push(searchLike, searchLike, searchLike, searchLike);
    }

    if (filters?.activity_type) {
      query += ` AND ca.activity_type = ?`;
      countQuery += ` AND ca.activity_type = ?`;
      params.push(filters.activity_type);
    }

    if (filters?.bill_type) {
      query += ` AND ca.bill_type = ?`;
      countQuery += ` AND ca.bill_type = ?`;
      params.push(filters.bill_type);
    }

    if (filters?.customer_id) {
      query += ` AND ca.customer_id = ?`;
      countQuery += ` AND ca.customer_id = ?`;
      params.push(filters.customer_id);
    }

    if (filters?.start_date) {
      query += ` AND ca.activity_date >= ?`;
      countQuery += ` AND ca.activity_date >= ?`;
      params.push(filters.start_date);
    }

    if (filters?.end_date) {
      query += ` AND ca.activity_date <= ?`;
      countQuery += ` AND ca.activity_date <= ?`;
      params.push(filters.end_date);
    }

    if (filters?.record_nature) {
      query += ` AND ca.record_nature = ?`;
      countQuery += ` AND ca.record_nature = ?`;
      params.push(filters.record_nature);
      
      // For Purchase view, only show activities with actual purchase data
      if (filters.record_nature === 'Purchase') {
        query += ` AND (ca.purchase_units != 0 OR ca.purchase_amount != 0)`;
        countQuery += ` AND (ca.purchase_units != 0 OR ca.purchase_amount != 0)`;
      }
    }

    // Server name filter (search in server_name field)
    if (filters?.server_name) {
      const serverLike = `%${filters.server_name}%`;
      query += ` AND ca.server_name LIKE ?`;
      countQuery += ` AND ca.server_name LIKE ?`;
      params.push(serverLike);
    }

    // Billing cycle filter
    if (filters?.billing_cycle) {
      query += ` AND ca.billing_cycle = ?`;
      countQuery += ` AND ca.billing_cycle = ?`;
      params.push(filters.billing_cycle);
    }

    // Billing mode filter
    if (filters?.billing_mode) {
      query += ` AND ca.billing_mode = ?`;
      countQuery += ` AND ca.billing_mode = ?`;
      params.push(filters.billing_mode);
    }

    // Amount filters (based on record_nature: Purchase uses purchase_amount, Sales uses bill_amount)
    if (filters?.min_amount !== undefined && filters.min_amount !== null) {
      const amountField = filters.record_nature === 'Purchase' ? 'ca.purchase_amount' : 'ca.bill_amount';
      query += ` AND ${amountField} >= ?`;
      countQuery += ` AND ${amountField} >= ?`;
      params.push(filters.min_amount);
    }

    if (filters?.max_amount !== undefined && filters.max_amount !== null) {
      const amountField = filters.record_nature === 'Purchase' ? 'ca.purchase_amount' : 'ca.bill_amount';
      query += ` AND ${amountField} <= ?`;
      countQuery += ` AND ${amountField} <= ?`;
      params.push(filters.max_amount);
    }

    const countResult = await this.db.queryOne<{ total: number }>(countQuery, params);

    query += ` ORDER BY ca.activity_date DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    const data = await this.db.query(query, params);

    return {
      data,
      total: countResult?.total || 0,
      page: Number(page),
      limit: Number(limit)
    };
  }

  /** Aggregated stats grouped by activity bucket (New / Renewal / User Increase /
   *  User Decrease) for the Billing Activity dashboard cards. Honors the same
   *  filter set as findAll. The User bucket is split by bill_type — Credit Note
   *  rows are treated as decreases and reported with absolute values, while all
   *  other bill types count as increases.
   *
   *  Sales tab returns bill_amount + billing_units totals; Purchase tab uses
   *  purchase_amount + purchase_units. Defaults to the Sales fields when no
   *  record_nature is supplied. */
  async getStats(filters?: {
    activity_type?: string;
    bill_type?: string;
    customer_id?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
    record_nature?: string;
    server_name?: string;
    billing_cycle?: string;
    billing_mode?: string;
    min_amount?: number;
    max_amount?: number;
  }) {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    const isPurchase = filters?.record_nature === 'Purchase';
    const unitsField = isPurchase ? 'ca.purchase_units' : 'ca.billing_units';
    const amountField = isPurchase ? 'ca.purchase_amount' : 'ca.bill_amount';

    if (filters?.search) {
      const s = `%${filters.search}%`;
      where.push('(ca.customer_name LIKE ? OR ca.server_name LIKE ? OR ca.sof_no LIKE ?)');
      params.push(s, s, s);
    }
    if (filters?.activity_type) { where.push('ca.activity_type = ?'); params.push(filters.activity_type); }
    if (filters?.bill_type)     { where.push('ca.bill_type = ?');     params.push(filters.bill_type); }
    if (filters?.customer_id)   { where.push('ca.customer_id = ?');   params.push(filters.customer_id); }
    if (filters?.start_date)    { where.push('ca.activity_date >= ?'); params.push(filters.start_date); }
    if (filters?.end_date)      { where.push('ca.activity_date <= ?'); params.push(filters.end_date); }
    if (filters?.record_nature) {
      where.push('ca.record_nature = ?');
      params.push(filters.record_nature);
      if (isPurchase) where.push('(ca.purchase_units != 0 OR ca.purchase_amount != 0)');
    }
    if (filters?.server_name)  { where.push('ca.server_name LIKE ?'); params.push(`%${filters.server_name}%`); }
    if (filters?.billing_cycle){ where.push('ca.billing_cycle = ?'); params.push(filters.billing_cycle); }
    if (filters?.billing_mode) { where.push('ca.billing_mode = ?');  params.push(filters.billing_mode); }
    if (filters?.min_amount !== undefined && filters.min_amount !== null) { where.push(`${amountField} >= ?`); params.push(filters.min_amount); }
    if (filters?.max_amount !== undefined && filters.max_amount !== null) { where.push(`${amountField} <= ?`); params.push(filters.max_amount); }

    const sql = `
      SELECT
        CASE
          WHEN ca.activity_type = 'User' AND ca.bill_type = 'Credit Note' THEN 'user_decrease'
          WHEN ca.activity_type = 'User' THEN 'user_increase'
          WHEN ca.activity_type = 'Renewal' THEN 'renewal'
          WHEN ca.activity_type = 'New' THEN 'new'
          ELSE 'other'
        END AS bucket,
        COUNT(*) AS count,
        COALESCE(SUM(ABS(${unitsField})), 0)  AS units_total,
        COALESCE(SUM(ABS(${amountField})), 0) AS amount_total
      FROM cloud_activities ca
      WHERE ${where.join(' AND ')}
      GROUP BY bucket`;

    const rows = await this.db.query<{ bucket: string; count: number; units_total: number; amount_total: number }>(sql, params);
    const empty = { count: 0, units_total: 0, amount_total: 0 };
    const out: Record<string, { count: number; units_total: number; amount_total: number }> = {
      new: { ...empty },
      renewal: { ...empty },
      user_increase: { ...empty },
      user_decrease: { ...empty },
    };
    for (const r of rows) {
      if (r.bucket in out) out[r.bucket] = { count: Number(r.count), units_total: Number(r.units_total), amount_total: Number(r.amount_total) };
    }
    return out;
  }

  async findById(id: string): Promise<Activity> {
    // First try to find by exact id
    let activity = await this.db.queryOne<Activity>(`SELECT * FROM cloud_activities WHERE id = ?`, [id]);

    // If not found, try by display_id (for compatibility with frontend using display_id)
    if (!activity) {
      activity = await this.db.queryOne<Activity>(`SELECT * FROM cloud_activities WHERE display_id = ?`, [id]);
    }

    if (!activity) throw new NotFoundException(`Activity ${id} not found`);

    return activity;
  }



  async findByCustomerId(customerId: string): Promise<Activity[]> {
    return this.db.query(`
      SELECT * FROM cloud_activities
      WHERE customer_id = ?
      ORDER BY activity_date DESC
    `, [customerId]);
  }

  async create(data: CreateActivityDto & { requestId?: string }): Promise<Activity> {
    // DEBUG: Trace incoming customer data


    // Check for duplicate request
    this.checkDuplicateRequest(data.requestId);

    // FIX: Resolve customer_id EARLY so it persists in the activity record
    if (!data.customer_id && data.customer_name) {
       const customer = await this.db.queryOne<{ id: string }>(`SELECT id FROM customer WHERE company = ?`, [data.customer_name]);
       if (customer) {
          data.customer_id = customer.id;
       }
    }
    // Also support mapping customer_domain_ip to customer_id if it looks like a User ID?
    // Current frontend sets customer_domain_ip = customer.id.
    if (!data.customer_id && data.customer_domain_ip && data.customer_domain_ip.length > 10) {
        // Evaluate if this UUID exists in customer table
        // We'll trust it for now or query? Query is safer.
        const customer = await this.db.queryOne<{ id: string }>(`SELECT id FROM customer WHERE id = ?`, [data.customer_domain_ip]);
        if (customer) data.customer_id = customer.id;
    }

    // Generate Group ID if both sales and purchase (Linked Siblings)
    const groupId = (data.is_sales && data.is_purchase) ? uuidv4() : null;
    const today = getISTDateString();


    // Generate Shared Display ID for this transaction
  // RETRY LOGIC for ID generation to prevent duplicates in bulk ops
  let displayId = '';
  let attempt = 0;
  while (attempt < 5) {
     const lastActivity = await this.db.queryOne<{ display_id: string, id: string }>(`
        SELECT display_id, id FROM cloud_activities 
        WHERE display_id IS NOT NULL 
        ORDER BY created_at DESC, id DESC LIMIT 1
      `);
      
      let nextNum = 1;
      if (lastActivity) {
        const lastStr = lastActivity.display_id || lastActivity.id;
        const match = lastStr.match(/(\d+)/);
        if (match) nextNum = parseInt(match[0]) + 1 + attempt; 
      }
      
      displayId = `ACT-${String(nextNum).padStart(3, '0')}`;
      break; 
  }


    // Helper to create a single record
    const createSingleActivity = async (nature: 'Sales' | 'Purchase', activityData: CreateActivityDto) => {
      // Use a unique UUID for the primary key to prevent collisions, but keep the shared displayId for user-facing displays
      const id = uuidv4();

      // Prepare data based on nature
      const isSales = nature === 'Sales';

      // Determine Target Fields based on independent logic
      const targetType = isSales
        ? (activityData.billing_activity_type || activityData.activity_type)
        : (activityData.purchase_activity_type || activityData.activity_type);

      const targetCycle = (isSales
        ? activityData.billing_cycle
        : (activityData.purchase_cycle || activityData.billing_cycle)) || 'Monthly';

      const targetMode = (isSales
        ? (activityData.billing_mode || 'day_to_day')
        : (activityData.purchase_billing_mode || 'day_to_day')) || 'day_to_day';

      const targetStartFrom = isSales
        ? activityData.start_from
        : (activityData.purchase_start_from || activityData.start_from);

      const targetExpiryDate = isSales
        ? activityData.new_expiry_date
        : (activityData.purchase_expiry || activityData.new_expiry_date);

      // If splitting, isolate the units
      let billingUnits = activityData.billing_units || 0;
      let purchaseUnits = activityData.purchase_units || 0;
      let billRate = activityData.last_bill_rate || 0;
      let purchaseRate = activityData.purchase_rate || 0;

      if (groupId) {
        if (isSales) {
          purchaseUnits = 0;
          purchaseRate = 0;
        } else {
          billingUnits = 0;
          billRate = 0;
        }
      } else {
        if (nature === 'Sales' && !activityData.is_purchase) {
          purchaseUnits = 0;
          purchaseRate = 0;
        }
        if (nature === 'Purchase' && !activityData.is_sales) {
          billingUnits = 0;
          billRate = 0;
        }
      }

      // Calculate amounts using TARGET fields
      const calcData = {
        ...activityData,
        activity_type: targetType,
        billing_cycle: targetCycle,
        billing_mode: targetMode,
        billing_units: billingUnits,
        purchase_units: purchaseUnits,
        last_bill_rate: billRate,
        purchase_rate: purchaseRate,
        start_from: targetStartFrom,
        new_expiry_date: targetExpiryDate
      };
      const amounts = this.calculateFinalAmounts(calcData);

      // SMART DUPLICATE CHECK & UPDATE
      // Check for existing activity matching strict criteria (Customer + Date + Type + NATURE)
      // If found -> UPDATE instead of Throwing Error
      const existingMatch = await this.db.queryOne<{ id: string }>(`
        SELECT id FROM cloud_activities 
        WHERE (customer_id = ? OR customer_domain_ip = ?)
        AND activity_date = ? 
        AND activity_type = ?
        AND record_nature = ?
        LIMIT 1
      `, [
        activityData.customer_id || activityData.customer_domain_ip,
        activityData.customer_id || activityData.customer_domain_ip,
        formatDateForMySQL(activityData.activity_date),
        targetType,
        nature // Crucial: Differentiate Sales vs Purchase
      ]);

      if (existingMatch) {

        // Perform direct UPDATE on the existing record with new calculated values
        // This serves as "Update matching entry"
        await this.db.execute(`
            UPDATE cloud_activities SET 
            customer_id = ?, customer_name = ?, customer_domain_ip = ?, server_name = ?,
            bill_type = ?, billing_units = ?, purchase_units = ?, 
            last_bill_rate = ?, purchase_rate = ?, billing_cycle = ?, 
            old_expiry_date = ?, start_from = ?, new_expiry_date = ?,
            date_diff_months = ?, date_diff_days = ?, 
            bill_amount = ?, purchase_amount = ?,
            billing_mode = ?, version = COALESCE(version, 0) + 1
            WHERE id = ?
         `, [
          activityData.customer_id || null,
          activityData.customer_name || null,
          activityData.customer_domain_ip || null,
          activityData.server_name || null,
          activityData.bill_type,
          billingUnits, purchaseUnits,
          billRate, purchaseRate, targetCycle,
          formatDateForMySQL(activityData.old_expiry_date),
          formatDateForMySQL(targetStartFrom),
          formatDateForMySQL(targetExpiryDate),
          isSales ? amounts.date_diff_months : (amounts.purchase_date_diff_months || 0),
          isSales ? amounts.date_diff_days : (amounts.purchase_date_diff_days || 0),
          amounts.bill_amount, amounts.purchase_amount,
          targetMode,
          existingMatch.id
        ]);
        // Return the updated record
        return this.findById(existingMatch.id);
      }

      // Credit Note handling
      if (activityData.bill_type === 'Credit Note') {
        if (isSales) billingUnits = billingUnits ? -Math.abs(billingUnits) : 0;
        else purchaseUnits = purchaseUnits ? -Math.abs(purchaseUnits) : 0;
      }

      const activityDate = formatDateForMySQL(activityData.activity_date);
      const oldExpiryDate = formatDateForMySQL(activityData.old_expiry_date);
      const startFrom = formatDateForMySQL(targetStartFrom);
      const newExpiryDate = formatDateForMySQL(targetExpiryDate);

      await this.saveActivityRecord({
        id,
        display_id: displayId,
        customer_id: activityData.customer_id || null,
        customer_name: activityData.customer_name,
        customer_domain_ip: activityData.customer_domain_ip || null,
        server_name: activityData.server_name || null,
        sof_no: null,
        activity_date: activityDate,
        activity_type: targetType,
        bill_type: activityData.bill_type,
        billing_units: billingUnits,
        purchase_units: purchaseUnits,
        last_bill_rate: billRate,
        purchase_rate: purchaseRate,
        billing_cycle: targetCycle,
        old_expiry_date: oldExpiryDate,
        start_from: startFrom,
        new_expiry_date: newExpiryDate,
        date_diff_months: isSales ? amounts.date_diff_months : (amounts.purchase_date_diff_months || 0),
        date_diff_days: isSales ? amounts.date_diff_days : (amounts.purchase_date_diff_days || 0),
        bill_amount: amounts.bill_amount,
        purchase_amount: amounts.purchase_amount,
        record_nature: nature,
        group_id: groupId,
        billing_mode: targetMode
      });

      // Update Server Expiry if Purchase (Manual or Renewed via Single Activity)
      // We match server by the provided server_id (Best) or server_name (IP backup)
      if (nature === 'Purchase' && newExpiryDate) {
        try {
          const expiryMySQL = formatDateForMySQL(newExpiryDate);

          if (activityData.server_id) {
            await this.db.execute(`UPDATE cloud_servers SET server_expiry = ? WHERE id = ?`, [expiryMySQL, activityData.server_id]);
          } else if (activityData.server_name) {
            await this.db.execute(`
               UPDATE cloud_servers 
               SET server_expiry = ? 
               WHERE customer_ip = ? OR server_ip = ?
            `, [expiryMySQL, activityData.server_name, activityData.server_name]);
          }
        } catch (e) {
        }
      }

      return this.findById(id);
    };

    let resultActivity: Activity | undefined;

    // Infer flags if missing
    if (!data.is_sales && !data.is_purchase && data.record_nature) {
      if (data.record_nature === 'Sales') data.is_sales = true;
      if (data.record_nature === 'Purchase') data.is_purchase = true;
    }

    // Create Purchase Record first (if applicable)
    if (data.is_purchase) {
      resultActivity = await createSingleActivity('Purchase', data);

      // Update server_expiry on the server if this is a New or Renewal Purchase activity
      // Update server_expiry on the server if this is a New or Renewal Purchase activity
      const purchaseType = data.purchase_activity_type || data.activity_type;
      if ((purchaseType === 'New' || purchaseType === 'Renewal') && data.purchase_expiry && data.customer_id) {

        let targetServerId = data.server_id;

        // If no explicit ID, try to find single mapping (Backwards compatibility / Single Server customers)
        if (!targetServerId) {
          const mapping = await this.db.queryOne<{ server_id: string }>(`
              SELECT server_id FROM cloud_mappings WHERE customer_id = ? LIMIT 1
            `, [data.customer_id]);
          if (mapping) targetServerId = mapping.server_id;
        }

        if (targetServerId) {
          await this.db.execute(`
            UPDATE cloud_servers SET server_expiry = ? WHERE id = ?
          `, [formatDateForMySQL(data.purchase_expiry), targetServerId]);
        }
      }
    }

    // Create Sales Record (if applicable)
    // We return the Sales record as the primary response if both exist, or whichever was created
    if (data.is_sales) {
      resultActivity = await createSingleActivity('Sales', data);
    }

    if (!resultActivity) {
      throw new Error('Failed to create activity: No valid activity nature specified');
    }

    // Auto-create the linked Tax Invoice voucher for a freshly-created Sales
    // Billing Activity. Guarded by "not already billed" so re-saving a match
    // (the existingMatch update path above) never double-invoices. Fail-soft:
    // a problem here must not undo the activity that already saved — same
    // philosophy as linkLeadAndAutoClose in vouchers.service.ts.
    if (
      resultActivity.record_nature === 'Sales' &&
      (resultActivity.bill_type === 'Tax Invoice' || resultActivity.bill_type === 'Credit Note') &&
      Math.abs(Number(resultActivity.bill_amount)) > 0 &&
      resultActivity.customer_id &&
      !(resultActivity as any).voucher_id &&
      !(resultActivity as any).voucher_no
    ) {
      try {
        const voucherInfo = await this.autoCreateTaxInvoiceForActivity(
          resultActivity,
          (data as any).voucher_type_id ? Number((data as any).voucher_type_id) : undefined,
        );
        if (voucherInfo) {
          await this.markActivitiesBilled([resultActivity.id], { voucherId: voucherInfo.id, voucherNo: voucherInfo.vch_no });
          (resultActivity as any).voucher_id = voucherInfo.id;
          (resultActivity as any).voucher_no = voucherInfo.vch_no;
          (resultActivity as any).auto_invoice_created = true;
        }
      } catch (e: any) {
        console.error('[ActivitiesService] Auto-invoice creation failed:', e?.message || e);
        (resultActivity as any).auto_invoice_error = e?.message || 'Failed to auto-create Tax Invoice';
      }
    }

    // If splitting, we might want to sync both, but they share the same customer_id usually
    if (data.customer_id) {
      console.log('DEBUG: Calling syncUserCounts with', { customerId: data.customer_id, serverId: data.server_id });
      await this.syncUserCounts(data.customer_id, data.server_id);
    } else if (data.customer_name) {
      // Search for customer_id by company name if not provided
      const customer = await this.db.queryOne<{ id: string }>(`SELECT id FROM customer WHERE company = ?`, [data.customer_name]);
      if (customer) await this.syncUserCounts(customer.id, data.server_id);
    }

    // Sync billing details to mapping if present in creation data (Only for New/Renewal Sales)
    if (resultActivity?.customer_id &&
      resultActivity!.record_nature === 'Sales' &&
      (resultActivity!.activity_type === 'New' || resultActivity!.activity_type === 'Renewal')) {
      const targetServerId = data.server_id || (resultActivity.server_name ? await this.resolveServerId(resultActivity.server_name) : undefined);
      console.log('DEBUG: Calling syncMappingDetails with', { 
        cust: resultActivity!.customer_id, 
        resolvedServerId: targetServerId, 
        originalServerName: resultActivity.server_name,
        inputServerId: data.server_id 
      });
      console.log('DEBUG: Create Data Payload:', JSON.stringify(data));
      
      await this.syncMappingDetails(
        resultActivity!.customer_id,
        targetServerId,
        data.billing_cycle || resultActivity!.billing_cycle || undefined,
        data.billing_mode || resultActivity!.billing_mode || undefined,
        resultActivity!.billing_units ?? undefined,
        resultActivity!.purchase_units ?? undefined,
        resultActivity!.last_bill_rate ?? undefined,
        resultActivity!.purchase_rate ?? undefined,
        resultActivity!.new_expiry_date || undefined
      );
    }

    return resultActivity!;
  }

  async update(id: string, data: Partial<Activity> & { requestId?: string; expectedVersion?: number; isSyncUpdate?: boolean }): Promise<Activity> {
    // Check for duplicate request
    this.checkDuplicateRequest(data.requestId);

    await this.findById(id); // Check exists

    const fields: string[] = [];
    const values: any[] = [];

    const current = await this.findById(id);

    // Activity is locked once it has been billed (voucher_id or voucher_no set).
    // Users must delete/edit the voucher first to unlink the activity, otherwise
    // the bill and the activity could drift out of sync.
    if (((current as any).voucher_id || (current as any).voucher_no) && !data.isSyncUpdate) {
      throw new Error('This activity is linked to a voucher and cannot be edited. Open the voucher and unlink it first.');
    }

    // Optimistic locking: check version if provided
    if (data.expectedVersion !== undefined && current.version !== undefined) {
      if (current.version !== data.expectedVersion) {
        throw new Error(`Concurrent modification detected. Record was modified by another user. Please refresh and try again.`);
      }
    }



    if (data.customer_id !== undefined) {
      let cid = data.customer_id;
      if (typeof cid === 'string' && cid.trim() === '') cid = null;
      fields.push('customer_id = ?');
      values.push(cid);
    }
    if (data.customer_name) { fields.push('customer_name = ?'); values.push(data.customer_name); }
    if (data.customer_domain_ip !== undefined) { fields.push('customer_domain_ip = ?'); values.push(data.customer_domain_ip); }
    if (data.server_name !== undefined) { fields.push('server_name = ?'); values.push(data.server_name); }
    if (data.sof_no !== undefined) { fields.push('sof_no = ?'); values.push(data.sof_no); }
    if (data.activity_date) { fields.push('activity_date = ?'); values.push(formatDateForMySQL(data.activity_date)); }
    if (data.activity_type) { fields.push('activity_type = ?'); values.push(data.activity_type); }
    if (data.bill_type) { fields.push('bill_type = ?'); values.push(data.bill_type); }
    if (data.billing_units !== undefined) { fields.push('billing_units = ?'); values.push(data.billing_units); }
    if (data.purchase_units !== undefined) { fields.push('purchase_units = ?'); values.push(data.purchase_units); }
    if (data.last_bill_rate !== undefined) { fields.push('last_bill_rate = ?'); values.push(data.last_bill_rate); }
    if (data.purchase_rate !== undefined) { fields.push('purchase_rate = ?'); values.push(data.purchase_rate); }
    if (data.billing_cycle) { fields.push('billing_cycle = ?'); values.push(data.billing_cycle); }
    if (data.old_expiry_date !== undefined) { fields.push('old_expiry_date = ?'); values.push(formatDateForMySQL(data.old_expiry_date)); }
    if (data.start_from !== undefined) { fields.push('start_from = ?'); values.push(formatDateForMySQL(data.start_from)); }
    if (data.new_expiry_date !== undefined) { fields.push('new_expiry_date = ?'); values.push(formatDateForMySQL(data.new_expiry_date)); }
    if (data.date_diff_months !== undefined) { fields.push('date_diff_months = ?'); values.push(data.date_diff_months); }
    if (data.date_diff_days !== undefined) { fields.push('date_diff_days = ?'); values.push(data.date_diff_days); }
    if (data.billing_mode) { fields.push('billing_mode = ?'); values.push(data.billing_mode); }

    // Allow updating nature if needed, though rare
    if (data.record_nature) { fields.push('record_nature = ?'); values.push(data.record_nature); }

    // Ensure BU and PU are negative if Credit Note
    if (data.bill_type === 'Credit Note') {
      const buFieldIdx = fields.indexOf('billing_units = ?');
      if (buFieldIdx !== -1) { values[buFieldIdx] = -Math.abs(values[buFieldIdx]); }
      const puFieldIdx = fields.indexOf('purchase_units = ?');
      if (puFieldIdx !== -1) { values[puFieldIdx] = -Math.abs(values[puFieldIdx]); }
    }

    // Recalculate amounts if relevant fields changed
    if (data.activity_type || data.billing_units || data.purchase_units || data.last_bill_rate || data.purchase_rate || data.billing_cycle || data.date_diff_months || data.date_diff_days || data.bill_type) {
      const currentActivity = await this.findById(id);
      const updatedData = { ...currentActivity, ...data };
      const amounts = this.calculateFinalAmounts(updatedData);

      fields.push('bill_amount = ?');
      values.push(amounts.bill_amount);
      fields.push('purchase_amount = ?');
      values.push(amounts.purchase_amount);
    }

    // Always increment version on successful update
    fields.push('version = COALESCE(version, 0) + 1');

    if (fields.length > 0) {
      values.push(id);
      await this.db.execute(`UPDATE cloud_activities SET ${fields.join(', ')} WHERE id = ?`, values);

      // Sync counts after update
      const updatedActivity = await this.findById(id);

      // Update Mapping if this was a significant update
      if (updatedActivity.record_nature === 'Sales' &&
        (updatedActivity.activity_type === 'New' || updatedActivity.activity_type === 'Renewal') &&
        updatedActivity.customer_id) {

        // Resolve server_id for mapping sync
        const targetServerId = (data as any).server_id || (updatedActivity.server_name ? await this.resolveServerId(updatedActivity.server_name) : undefined);
        await this.syncMappingDetails(
          updatedActivity.customer_id,
          targetServerId,
          updatedActivity.billing_cycle || undefined,
          updatedActivity.billing_mode,
          updatedActivity.billing_units ?? undefined,
          updatedActivity.purchase_units ?? undefined,
          updatedActivity.last_bill_rate ?? undefined,
          updatedActivity.purchase_rate ?? undefined,
          updatedActivity.new_expiry_date
        );
      }
      if (updatedActivity.customer_id) {
        const targetServerId = (data as any).server_id || (updatedActivity.server_name ? await this.resolveServerId(updatedActivity.server_name) : undefined);
        await this.syncUserCounts(updatedActivity.customer_id, targetServerId);
      }
    }

    // Sync with linked sibling (if exists and not already a sync update)
    if (current.group_id && !data.isSyncUpdate) {
      const sibling = await this.db.queryOne<Activity>(`
        SELECT * FROM cloud_activities WHERE group_id = ? AND id != ?
      `, [current.group_id, id]);

      if (sibling) {
        const sharedFields = [
          'customer_id', 'customer_name', 'server_name', 'sof_no',
          'activity_date', 'billing_cycle',
          'start_from', 'old_expiry_date', 'new_expiry_date',
          'date_diff_months', 'date_diff_days', 'billing_mode'
        ];

        const syncData: any = { isSyncUpdate: true };
        let hasSyncUpdate = false;

        // 1. Sync Shared Fields
        for (const field of sharedFields) {
          if (field in data) {
            syncData[field] = data[field as keyof Activity];
            hasSyncUpdate = true;
          }
        }

        // 2. Sync Nature-Specific Fields (Forwarding)
        // If we are Sales and updated Purchase fields, forward them to Sibling (which is Purchase)
        if (current.record_nature === 'Sales' && sibling.record_nature === 'Purchase') {
          if (data.purchase_units !== undefined) { syncData.purchase_units = data.purchase_units; hasSyncUpdate = true; }
          if (data.purchase_rate !== undefined) { syncData.purchase_rate = data.purchase_rate; hasSyncUpdate = true; }
          if (data.purchase_activity_type !== undefined) { syncData.activity_type = data.purchase_activity_type; hasSyncUpdate = true; }
          else if (data.activity_type !== undefined && !data.billing_activity_type) {
            // If only global activity_type changed, sync it too if appropriate
            syncData.activity_type = data.activity_type; hasSyncUpdate = true;
          }
        }
        // If we are Purchase and updated Billing fields, forward them to Sibling (which is Sales)
        else if (current.record_nature === 'Purchase' && sibling.record_nature === 'Sales') {
          if (data.billing_units !== undefined) { syncData.billing_units = data.billing_units; hasSyncUpdate = true; }
          if (data.last_bill_rate !== undefined) { syncData.last_bill_rate = data.last_bill_rate; hasSyncUpdate = true; }
          if (data.billing_activity_type !== undefined) { syncData.activity_type = data.billing_activity_type; hasSyncUpdate = true; }
          else if (data.activity_type !== undefined && !data.purchase_activity_type) {
            syncData.activity_type = data.activity_type; hasSyncUpdate = true;
          }
        }

        if (hasSyncUpdate) {
          await this.update(sibling.id, syncData);
        }
      }
    }

    // Sync billing details to mapping if updated (Only for New/Renewal Sales)
    const finalActivity = await this.findById(id);
    if (finalActivity.customer_id &&
      finalActivity.record_nature === 'Sales' &&
      (finalActivity.activity_type === 'New' || finalActivity.activity_type === 'Renewal') &&
      (data.billing_cycle || data.billing_mode)) {
      // Sync update needs serverId too? Usually updates don't change server, but let's try to find it
      const srvId = finalActivity.server_name ? await this.resolveServerId(finalActivity.server_name) : undefined;
      await this.syncMappingDetails(finalActivity.customer_id, srvId, data.billing_cycle || undefined, data.billing_mode || undefined);
    }

    return finalActivity;
  }

  async delete(id: string): Promise<void> {

    const activity = await this.findById(id);

    // Activity locked once billed (voucher linked).
    if ((activity as any).voucher_id || (activity as any).voucher_no) {
      throw new Error('This activity is linked to a voucher and cannot be deleted. Delete the voucher first.');
    }

    // If part of a group, delete all siblings
    if (activity.group_id) {
      // First, check how many records will be deleted
      const countResult = await this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM cloud_activities WHERE group_id = ?`,
        [activity.group_id]
      );


      const result = await this.db.execute(`DELETE FROM cloud_activities WHERE group_id = ?`, [activity.group_id]);

    } else {

      const result = await this.db.execute(`DELETE FROM cloud_activities WHERE id = ?`, [activity.id]);

    }

    // Sync counts after delete
    if (activity.customer_id) {

      await this.syncUserCounts(activity.customer_id);
    }

    // Rollback Server Expiry if Purchase Activity
    // Logic: Find the latest remaining Purchase activity (New/Renewal) for this server and set expiry to its end date.
    // If no activities remain, default back to NULL or Created Date (logic: NULL is safest to indicate no active subscription)
    if (activity.record_nature === 'Purchase' || activity.is_purchase) {
      // Identify Server: Use server_name (which stores IP) or customer_domain_ip (if linked)
      const serverIdentity = activity.server_name || activity.customer_domain_ip; // Basic fallback

      if (serverIdentity) {


        // Find latest valid purchase activity for this server
        // Matches against customer_ip OR server_ip columns in servers check
        // We need to query activities containing this server identity
        const latestActivity = await this.db.queryOne<{ new_expiry_date: string }>(`
                SELECT new_expiry_date 
                FROM cloud_activities 
                WHERE server_name = ?
                AND record_nature = 'Purchase'
                AND (activity_type = 'New' OR activity_type = 'Renewal')
                AND new_expiry_date IS NOT NULL
                ORDER BY new_expiry_date DESC, id DESC
                LIMIT 1
            `, [serverIdentity]);

        const newExpiry = latestActivity?.new_expiry_date
          ? formatDateForMySQL(latestActivity.new_expiry_date)
          : null; // If no activity, set to NULL (or could initiate to created_at if we had it, but NULL is cleaner "expired")



        // Update Server
        await this.db.execute(`
                UPDATE cloud_servers 
                SET server_expiry = ? 
                WHERE customer_ip = ? OR server_ip = ?
            `, [newExpiry, serverIdentity, serverIdentity]);
      }
    } else if (activity.customer_id && (activity.record_nature === 'Sales' || !activity.record_nature)) {
      // Revert Mapping State for Sales Activities
      const serverIdentity = activity.server_name || activity.customer_domain_ip;
      if (serverIdentity) {
        await this.recalcMappingState(activity.customer_id, serverIdentity);
      }
    }
  }

  /**
   * Re-calculates and updates the mapping state (expiry, rate, cycle) based on the latest remaining activity.
   * Called after activity deletion to revert state.
   */
  private async recalcMappingState(customerId: string, serverIdentity: string) {
    try {
      // 1. Resolve Server ID
      const server = await this.db.queryOne<{ id: string, server_ip: string, customer_ip: string }>(`
      SELECT id, server_ip, customer_ip FROM cloud_servers 
      WHERE server_ip = ? OR customer_ip = ?
    `, [serverIdentity, serverIdentity]);

      if (!server) return; // Cannot map to server

      const serverId = server.id;

      // 2. Find Latest Sales Activity for this Customer + Server
      const latest = await this.db.queryOne<Activity>(`
      SELECT * FROM cloud_activities
      WHERE customer_id = ?
      AND (server_name = ? OR server_name = ?)
      AND record_nature = 'Sales'
      AND (activity_type = 'New' OR activity_type = 'Renewal')
      ORDER BY activity_date DESC, created_at DESC
      LIMIT 1
    `, [customerId, server.server_ip, server.customer_ip || server.server_ip]);

      if (latest) {
        // Revert mapping to this activity's state
        await this.db.execute(`
        UPDATE cloud_mappings SET 
        expiry_date = ?,
        billing_cycle = ?,
        billing_mode = ?,
        billing_rate = ?,
        purchase_rate = ?,
        billed_users = ?,
        purchase_users = ?
        WHERE customer_id = ? AND server_id = ?
      `, [
          latest.new_expiry_date,
          latest.billing_cycle || 'Yearly',
          latest.billing_mode || 'day_to_day',
          latest.last_bill_rate || 0,
          latest.purchase_rate || 0,
          latest.billing_units || 0,
          latest.purchase_units || 0,
          customerId, serverId
        ]);

        // Legacy sync
        try {
          if (latest.new_expiry_date) {
            await this.db.execute(
              `UPDATE clouddetails SET cloud_expiry = ? WHERE customerid = ?`,
              [formatDateForMySQL(latest.new_expiry_date), customerId]
            );
          }
        } catch (e) { }

      } else {
        // No activities remain! Reset mapping to defaults/null
        await this.db.execute(`
        UPDATE cloud_mappings SET 
        expiry_date = NULL,
        billing_rate = 0,
        billed_users = 0,
        purchase_users = 0
        WHERE customer_id = ? AND server_id = ?
      `, [customerId, serverId]);

        try {
          await this.db.execute(
            `UPDATE clouddetails SET cloud_expiry = NULL WHERE customerid = ?`,
            [customerId]
          );
        } catch (e) { }
      }

      // --- Refresh Effective Fields ---
      await this.db.execute(`
        UPDATE cloud_mappings m
        JOIN cloud_servers s ON m.server_id = s.id
        JOIN customer c ON m.customer_id = c.id
        SET m.effective_cycle = COALESCE(m.billing_cycle, s.billing_cycle),
            m.effective_mode = COALESCE(m.billing_mode, s.billing_mode),
            m.effective_rate = COALESCE(
                NULLIF(m.billing_rate, 0), 
                (SELECT COALESCE(NULLIF(last_bill_rate, 0), NULLIF(purchase_rate, 0), NULLIF(billing_rate, 0)) FROM cloud_activities WHERE (customer_id = m.customer_id OR customer_name = c.company) AND record_nature = 'Sales' AND activity_type IN ('New', 'Renewal') ORDER BY activity_date DESC LIMIT 1),
                s.purchase_rate
            ),
            m.effective_expiry = COALESCE(
                m.expiry_date, 
                (SELECT new_expiry_date FROM cloud_activities WHERE (customer_id = m.customer_id OR customer_name = c.company) AND record_nature = 'Sales' AND activity_type IN ('New', 'Renewal') ORDER BY activity_date DESC LIMIT 1),
                s.server_expiry
            )
        WHERE m.customer_id = ? AND m.server_id = ?
      `, [customerId, serverId]);

    } catch (err) {
      console.error('[recalcMappingState] Error:', err);
    }
  }

  async getRevenueSummary(): Promise<{
    total: number;
    by_type: { activity_type: string; total: number }[];
    by_cycle: { billing_cycle: string; total: number }[];
    recent_activities: Activity[];
  }> {
    const total = await this.db.queryOne<{ total: number }>(`
      SELECT SUM(bill_amount) as total FROM cloud_activities
    `);

    const byType = await this.db.query(`
      SELECT activity_type, SUM(bill_amount) as total 
      FROM cloud_activities 
      GROUP BY activity_type
    `);

    const byCycle = await this.db.query(`
      SELECT billing_cycle, SUM(bill_amount) as total 
      FROM cloud_activities 
      GROUP BY billing_cycle
    `);

    const recentActivities = await this.db.query(`
      SELECT * FROM cloud_activities 
      ORDER BY activity_date DESC 
      LIMIT 10
    `);

    return {
      total: total?.total || 0,
      by_type: byType,
      by_cycle: byCycle,
      recent_activities: recentActivities
    };
  }



  private calculateFinalAmounts(data: any): {
    bill_amount: number;
    purchase_amount: number;
    date_diff_months: number;
    date_diff_days: number;
    date_diff_label: string;
    purchase_date_diff_months: number;
    purchase_date_diff_days: number;
    purchase_date_diff_label: string;
  } {
    const billingUnits = data.billing_units || 0;
    const purchaseUnits = data.purchase_units || 0;
    const billingRate = data.last_bill_rate || 0;
    const purchaseRate = data.purchase_rate || 0;
    const billingMode = data.billing_mode || 'day_to_day';
    const purchaseBillingMode = data.purchase_billing_mode || billingMode;

    // Get cycle months for full cycle mode
    const getFullCycleMonths = (cycle: string): number => {
      switch (cycle) {
        case 'Monthly': return 1;
        case 'Quarterly': return 3;
        case 'Half-Yearly': return 6;
        case 'Yearly': return 12;
        default: return 1;
      }
    };

    // Get remaining full months for M2M pro-rata (after first partial month)
    const getRemainingFullMonths = (cycle: string): number => {
      switch (cycle) {
        case 'Monthly': return 0;      // No additional months
        case 'Quarterly': return 2;    // 2 more months after first
        case 'Half-Yearly': return 5;  // 5 more months after first
        case 'Yearly': return 11;      // 11 more months after first
        default: return 0;
      }
    };

    // Helper to calculate amount for a single side
    const calculateSingle = (
      units: number,
      rate: number,
      mode: 'day_to_day' | 'month_to_month',
      startDateStr: string,
      expiryDateStr: string,
      cycle: string,
      activityType: string
    ) => {
      let amount = 0;
      let months = 0;
      let days = 0;
      let label = '';

      const start = safeParseDate(startDateStr);
      const end = safeParseDate(expiryDateStr);

      // Calculate date diff for display and for User type calculation
      // Calculate date diff for display and for User type calculation
      // For M2M, Expiry is Inclusive, so add 1 day for Diff calculation to show correct label
      let calcExpiry = expiryDateStr;
      if (mode === 'month_to_month' && expiryDateStr) {
        calcExpiry = addISTDays(expiryDateStr, 1);
      }

      const diff = this.calculateDateDiff(startDateStr, calcExpiry);
      months = diff.months;
      days = diff.days;
      label = `${months} Month ${days} Days`;

      if (!start) {
        return { amount: 0, months, days, label };
      }

      const startYear = start.getFullYear();
      const startMonth = start.getMonth();
      const startDay = start.getDate();
      const daysInStartMonth = getDaysInMonth(startYear, startMonth);

      // Remaining days in start month (from start day to end of month)
      // Inclusive of start date: (Total - Start) + 1
      const remainingDaysInStartMonth = daysInStartMonth - startDay + 1;

      if (activityType === 'User') {
        // USER TYPE: Calculate based on calendar months
        // Same date to same date of next month = 1 month (e.g., Jan 10 → Feb 10 = 1 month)
        // 1st to last day of same month = 1 full month (e.g., Feb 1 → Feb 28 = 1 month)

        let effectiveMonths = months;
        let effectiveDays = days;

        // Special case: If start is 1st and end is last day of same month, count as 1 month
        if (months === 0 && start && end) {
          const startDay = start.getDate();
          const endDay = end.getDate();
          const endYear = end.getFullYear();
          const endMonth = end.getMonth();
          const lastDayOfEndMonth = getDaysInMonth(endYear, endMonth);

          if (startDay === 1 && endDay === lastDayOfEndMonth) {
            // Full month coverage (1st to last day)
            effectiveMonths = 1;
            effectiveDays = 0;
          }
        }

        // Full months amount
        const fullMonthsAmount = rate * effectiveMonths;

        // Partial days amount (using days in the END month for pro-rata calculation)
        let partialDaysAmount = 0;
        if (effectiveDays > 0 && end) {
          const endYear = end.getFullYear();
          const endMonth = end.getMonth();
          const daysInEndMonth = getDaysInMonth(endYear, endMonth);
          partialDaysAmount = (rate / daysInEndMonth) * effectiveDays;
        }

        // Total per user
        const amountPerUser = fullMonthsAmount + partialDaysAmount;

        // Apply units (can be negative for Credit Note)
        amount = amountPerUser * units;
      } else {
        // NEW / RENEWAL TYPE
        if (mode === 'month_to_month') {
          // M2M (Pro-Rata) Mode
          // Formula: [{(rate / daysInStartMonth) × P} + (rate × N)] × users
          // N = remaining full months based on CYCLE (0/2/5/11)

          // First month partial amount
          const firstMonthAmount = (rate / daysInStartMonth) * remainingDaysInStartMonth;

          // Remaining full months based on cycle
          const remainingFullMonths = getRemainingFullMonths(cycle);
          const fullMonthsAmount = rate * remainingFullMonths;

          // Total per user
          const amountPerUser = firstMonthAmount + fullMonthsAmount;

          // Apply units
          amount = amountPerUser * units;
        } else {
          // D2D (Full Cycle) Mode
          // Formula: rate × users × cycleMonths
          const cycleMonths = getFullCycleMonths(cycle);
          amount = rate * units * cycleMonths;
        }
      }

      return {
        amount: Number(amount.toFixed(2)),
        months,
        days,
        label
      };
    };

    const billingCycle = data.billing_cycle || 'Yearly';
    const purchaseCycle = data.purchase_cycle || 'Monthly';
    const billingActivityType = data.billing_activity_type || data.activity_type || 'New';
    const purchaseActivityType = data.purchase_activity_type || data.activity_type || 'New';

    const purchaseStart = data.purchase_start_from || data.start_from;
    const purchaseEnd = data.purchase_expiry || data.new_expiry_date;

    const billingResult = calculateSingle(billingUnits, billingRate, billingMode, data.start_from, data.new_expiry_date, billingCycle, billingActivityType);
    const purchaseResult = calculateSingle(purchaseUnits, purchaseRate, purchaseBillingMode, purchaseStart, purchaseEnd, purchaseCycle, purchaseActivityType);

    return {
      bill_amount: Math.round(billingResult.amount * 100) / 100,
      purchase_amount: Math.round(purchaseResult.amount * 100) / 100,
      date_diff_months: billingResult.months,
      date_diff_days: billingResult.days,
      date_diff_label: billingResult.label,
      purchase_date_diff_months: purchaseResult.months,
      purchase_date_diff_days: purchaseResult.days,
      purchase_date_diff_label: purchaseResult.label,
    };
  }

  // Get cycle months from billing cycle
  private getCycleMonths(cycle?: string): number {
    switch (cycle) {
      case 'Monthly': return 1;
      case 'Quarterly': return 3;
      case 'Half-Yearly': return 6;
      case 'Yearly': return 12;
      default: return 3; // Default to Quarterly
    }
  }

  // Calculate date difference between two dates
  private calculateDateDiff(startDate: string | null, endDate: string | null): { months: number; days: number } {
    const start = safeParseDate(startDate);
    const end = safeParseDate(endDate);

    if (!start || !end || end <= start) {
      return { months: 0, days: 0 };
    }

    const { year: startY, month: startM } = getISTComponents(start);
    const { year: endY, month: endM } = getISTComponents(end);

    let months = (endY - startY) * 12 + (endM - startM);

    const tempDate = new Date(start);
    tempDate.setMonth(tempDate.getMonth() + months);

    if (tempDate > end) {
      months--;
      tempDate.setTime(start.getTime());
      tempDate.setMonth(tempDate.getMonth() + months);
    }

    const days = Math.floor((end.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));

    return { months, days };
  }

  // Calculate expiry date based on activity type, billing cycle, and billing mode
  private calculateExpiryDate(
    activityType: string,
    activityDate: string | null,
    billingCycle?: string,
    billingMode: 'day_to_day' | 'month_to_month' = 'day_to_day'
  ): string | null {
    const date = safeParseDate(activityDate);
    if (!date) return null;

    // For New and Renewal: Calculate based on billing cycle and mode
    if (activityType === 'New' || activityType === 'Renewal') {
      const cycleMonths = this.getCycleMonths(billingCycle);

      if (billingMode === 'month_to_month') {
        // Month-to-Month (PRO-RATA):
        // For Monthly (1 mo): End of current month (cur + 0).
        // For Yearly (12 mo): End of current + 11 months.
        const { year: curY, month: curM } = getISTComponents(date);

        const targetOffset = cycleMonths - 1;
        let targetMonth = curM + targetOffset;
        let targetYear = curY + Math.floor(targetMonth / 12);
        targetMonth = targetMonth % 12;

        const lastDay = getDaysInMonth(targetYear, targetMonth);
        return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      } else {
        const { year: curY, month: curM, day: startDay } = getISTComponents(date);
        let targetMonth = curM + cycleMonths;
        let targetYear = curY + Math.floor(targetMonth / 12);
        targetMonth = ((targetMonth % 12) + 12) % 12;

        const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
        const targetDay = Math.min(startDay, daysInTargetMonth);

        // D2D: Same Date of next month (e.g. 1st March -> 1st April)
        return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
      }
    }

    return null;
  }

  // Get last expiry date for a customer (Prioritize Plan activities for specific server if provided)

  async getLastExpiryDate(customerId: string, serverIp?: string): Promise<string | null> {
    console.log(`DEBUG: getLastExpiryDate searching for: ${customerId}, server: ${serverIp}`);
    
    // 1. Prioritize Active Plan (New/Renewal) - Matches Frontend Logic
    // Case Insensitive check for type, and check both ID and Domain IP columns
    let planQuery = `
      SELECT new_expiry_date FROM cloud_activities 
      WHERE (customer_id = ? OR customer_domain_ip = ?)
      AND UPPER(activity_type) IN ('NEW', 'RENEWAL')
      AND new_expiry_date IS NOT NULL
    `;
    let planParams: any[] = [customerId, customerId];

    if (serverIp) {
      planQuery += ` AND (server_name = ? OR server_ip = ?)`;
      planParams.push(serverIp, serverIp);
    }
    
    planQuery += ` ORDER BY new_expiry_date DESC LIMIT 1`;
    
    const lastPlan = await this.db.queryOne<{ new_expiry_date: string }>(planQuery, planParams);

    if (lastPlan) {
        console.log(`DEBUG: getLastExpiryDate FOUND Plan: ${lastPlan.new_expiry_date}`);
        return lastPlan.new_expiry_date;
    }

    // 2. Fallback to any activity if no plan found
    let fbQuery = `
      SELECT new_expiry_date FROM cloud_activities 
      WHERE (customer_id = ? OR customer_domain_ip = ?) 
      AND new_expiry_date IS NOT NULL
    `;
    let fbParams: any[] = [customerId, customerId];

    if (serverIp) {
      fbQuery += ` AND (server_name = ? OR server_ip = ?)`;
      fbParams.push(serverIp, serverIp);
    }

    fbQuery += ` ORDER BY activity_date DESC, created_at DESC LIMIT 1`;

    const lastActivity = await this.db.queryOne<{ new_expiry_date: string }>(fbQuery, fbParams);

    console.log(`DEBUG: getLastExpiryDate Fallback result: ${lastActivity?.new_expiry_date}`);
    return lastActivity?.new_expiry_date || null;
  }



  // Calculate all values for an activity (called from frontend)
  async calculate(data: CalculationRequest): Promise<CalculationResponse> {
    console.log('DEBUG: calculate request (TOP)', { type: data.activity_type, start: data.start_from, payload: data });
    
    let dateDiffMonths = 0;
    let dateDiffDays = 0;
    let newExpiryDate: string | null = null;
    let formulaBreakdown = '';
    const billingMode = data.billing_mode || 'day_to_day';

    // Calculate expiry date for New/Renewal
    if (data.activity_type === 'New' || data.activity_type === 'Renewal') {
      // Use start_from as the base date, inherit billing_mode from server
      const startDate = data.start_from || data.activity_date || null;
      console.log('DEBUG: calculate request', { type: data.activity_type, start: startDate, payload: data });
      // billingMode defined at top of function now

      // Respect user's manual expiry date for D2D (Full Cycle) mode
      if (billingMode === 'day_to_day' && data.new_expiry_date) {
        newExpiryDate = formatDateForMySQL(data.new_expiry_date);
      } else {
        newExpiryDate = this.calculateExpiryDate(
          data.activity_type,
          startDate,
          data.billing_cycle,
          billingMode
        );
      }

      const cycleMonths = this.getCycleMonths(data.billing_cycle);

      // For M2M, Expiry is Inclusive, so add 1 day for Diff calculation to show correct label
      let calcExpiry = newExpiryDate;
      if (billingMode === 'month_to_month' && newExpiryDate) {
        calcExpiry = addISTDays(newExpiryDate, 1);
      }

      const diff = this.calculateDateDiff(startDate, calcExpiry);
      dateDiffMonths = diff.months;
      dateDiffDays = diff.days;

      if (data.billing_mode === 'month_to_month' && data.activity_date && newExpiryDate) {
        const start = safeParseDate(data.activity_date);
        const end = safeParseDate(newExpiryDate);
        if (start && end) {
          // Simplified Calculation to match 'calculateDateDiff' (UI Display)
          // Cost = (Months * Rate) + (Days * Rate/DaysInEndMonth)
          const { year: endY, month: endM } = getISTComponents(end);
          const daysInEndMonth = getDaysInMonth(endY, endM);

          // Formula breakdown
          formulaBreakdown = `${data.billing_units} Units × [ (${dateDiffMonths} Mo × ₹${data.last_bill_rate}) + (${dateDiffDays} Days × ₹${data.last_bill_rate}/${daysInEndMonth}) ]`;
        }
      } else {
        formulaBreakdown = `${data.billing_units} Units × ₹${data.last_bill_rate} × ${cycleMonths} Mo.`;
      }

    } else if (data.activity_type === 'User') {
      let mappingRef: any = null;

       // USER: Try to inherit from matching active mapping first
       // We prioritize this to enforce "Same Expiry" rule logic
       if (data.customer_id) {
          mappingRef = await this.db.queryOne<{ expiry_date: string, billing_cycle: string, billing_rate: number }>(`
           SELECT expiry_date, billing_cycle, billing_rate 
           FROM cloud_mappings 
           WHERE customer_id = ? 
           ${data.server_id || data.server_name ? `AND (server_id = ? OR server_ip = ?)` : ''}
           ORDER BY expiry_date DESC LIMIT 1
         `, data.server_id || data.server_name ? [data.customer_id, data.server_id || '', data.server_name || ''] : [data.customer_id]);
       }

       // Smart Expiry Inheritance:
       // If we found an active plan, and the activity start date is BEFORE that plan expires,
       // we MUST inherit that expiry date. User activities shouldn't normally extend beyond the plan.
       const authExp = data.customer_id ? await this.getLastExpiryDate(data.customer_id, data.server_ip || data.server_name) : null;
       if (authExp || (mappingRef && mappingRef.expiry_date)) {
            const planExpiry = authExp ? formatDateForMySQL(authExp) : formatDateForMySQL(mappingRef.expiry_date);
            const actStart = data.start_from ? formatDateForMySQL(data.start_from) : null;
            
            // If No start date provided yet, we can't compare, but if provided:
            if (planExpiry && actStart && actStart <= planExpiry) {
                 newExpiryDate = planExpiry;
                 // Also inherit cycle/rate if not manually overridden (though rate usually is)
                 if (!data.billing_cycle && mappingRef.billing_cycle) data.billing_cycle = mappingRef.billing_cycle as any;
                 if (!data.last_bill_rate && mappingRef.billing_rate) data.last_bill_rate = Number(mappingRef.billing_rate);
            }
       }

      // Fallback or if no mapping found (or explicitly overriding which shouldn't happen often)
      // FOR USER TYPE: Trust the frontend's new_expiry_date if it was provided, as the frontend
      // already did the complex "current_plan_expiry" lookup from defaults or mapping.
      if (data.new_expiry_date) {
        newExpiryDate = formatDateForMySQL(data.new_expiry_date);
      } else if (!newExpiryDate && data.start_from && data.new_expiry_date) {
        newExpiryDate = formatDateForMySQL(data.new_expiry_date);
      } else if (!newExpiryDate && data.customer_id) {
            // Get last expiry date for pre-fill as fallback
            newExpiryDate = await this.getLastExpiryDate(data.customer_id, data.server_ip || data.server_name);
      }
      
      // Calculate Diff based on resolved dates
      console.log('DEBUG: User Calc Internal', { start: data.start_from, resolvedExpiry: newExpiryDate, mappingFound: !!mappingRef });
      
      if (data.start_from && newExpiryDate) {
        const diff = this.calculateDateDiff(data.start_from, newExpiryDate);
        console.log('DEBUG: User Calc Diff Result', diff);
        dateDiffMonths = diff.months;
        dateDiffDays = diff.days;
      }

      if (data.billing_mode === 'month_to_month' && data.start_from && newExpiryDate) {
        const start = safeParseDate(data.start_from);
        const end = safeParseDate(newExpiryDate);
        if (start && end) {
          const { year: startY, month: startM } = getISTComponents(start);
          const daysInStartMonthDate = new Date(startY, startM + 1, 0);
          const daysInStartMonth = daysInStartMonthDate.getDate();

          // Simplified Calculation to match UI Display (e.g. 11 Months + 13 Days)
          // Cost = (Months * Rate) + (Days * Rate / DaysInEndMonth)
          const { year: endY, month: endM } = getISTComponents(end);
          const daysInEndMonth = getDaysInMonth(endY, endM);

          // Note: Actual Amount calculation happens in calculateFinalAmounts but we need to ensure it uses the same "day fraction" logic?
          // calculateFinalAmounts usually takes date_diff_months/days and does the math.
          // Let's check calculateFinalAmounts logic. If it does standard math, we just need to update breakdown explanation here.

          formulaBreakdown = `${data.billing_units} Units × [ (${dateDiffMonths} Mo × ₹${data.last_bill_rate}) + (${dateDiffDays} Days × ₹${data.last_bill_rate}/${daysInEndMonth}) ]`;
        }
      } else {
        // D2D Standard Breakdown
        const cycleMonths = this.getCycleMonths(data.billing_cycle);
        if (dateDiffMonths > 0) {
          formulaBreakdown = `(${data.billing_units} Units × ₹${data.last_bill_rate} × ${dateDiffMonths} Mo.) + (${data.billing_units} Units × (₹${data.last_bill_rate}/30) × ${dateDiffDays} Days)`;
        } else {
          formulaBreakdown = `${data.billing_units} Units × (₹${data.last_bill_rate}/30) × ${dateDiffDays} Days`;
        }
      }
    }



    // Calculate expiry date for New/Renewal
    if (data.activity_type === 'New' || data.activity_type === 'Renewal') {
      // ... existing billing expiry calculation ...
    }

    // Calculate Purchase Expiry explicitly (if purchase params provided)
    let purchaseExpiryDate: string | null = null;
    if (data.activity_type === 'New' || data.activity_type === 'Renewal') {
      const pStartDate = data.purchase_start_from || data.start_from || data.activity_date || null;
      const pMode = data.purchase_billing_mode || 'day_to_day';
      // Default purchase cycle to Yearly if missing? Or inherit? 
      // Frontend sends purchase_cycle.

      purchaseExpiryDate = this.calculateExpiryDate(
        data.activity_type,
        pStartDate,
        data.purchase_cycle, // ensure this is passed in CalculationRequest interface
        pMode
      );
    } else if (data.activity_type === 'User') {
      // For User, use provided or existing
      purchaseExpiryDate = data.purchase_expiry || null;
    }

    const amounts = this.calculateFinalAmounts({
      activity_type: data.activity_type,
      bill_type: data.bill_type,
      billing_units: data.billing_units,
      purchase_units: data.purchase_units ?? data.billing_units,
      last_bill_rate: data.last_bill_rate,
      purchase_rate: data.purchase_rate || 0,
      billing_cycle: data.billing_cycle,
      date_diff_months: dateDiffMonths,
      date_diff_days: dateDiffDays,
      billing_mode: data.billing_mode || 'day_to_day',
      start_from: data.start_from || data.activity_date,
      new_expiry_date: newExpiryDate,
      // PASS PURCHASE FIELDS
      purchase_billing_mode: data.purchase_billing_mode,
      purchase_cycle: data.purchase_cycle,
      purchase_start_from: data.purchase_start_from,
      purchase_expiry: purchaseExpiryDate || data.purchase_expiry // Use calculated or passed
    });

    if (data.bill_type === 'Credit Note') {
      formulaBreakdown += ' (Credit Note)';
    }

    return {
      bill_amount: amounts.bill_amount,
      purchase_amount: amounts.purchase_amount,
      date_diff_months: amounts.date_diff_months,
      date_diff_days: amounts.date_diff_days,
      date_diff_label: amounts.date_diff_label,

      purchase_date_diff_months: amounts.purchase_date_diff_months,
      purchase_date_diff_days: amounts.purchase_date_diff_days,
      purchase_date_diff_label: amounts.purchase_date_diff_label,

      new_expiry_date: newExpiryDate,
      purchase_expiry: purchaseExpiryDate, // Return calculated purchase expiry
      formula_breakdown: formulaBreakdown,
    };
  }

  // Get total users for a customer (cumulative calculation)
  async getTotalUsersByCustomerId(customerId: string): Promise<number> {
    const customerActivities = await this.db.query<Activity>(`
      SELECT * FROM cloud_activities 
      WHERE customer_id = ? 
      ORDER BY activity_date ASC, created_at ASC
    `, [customerId]);

    if (customerActivities.length === 0) return 0;

    let totalUsers = 0;

    for (const activity of customerActivities) {
      if (activity.activity_type === 'New') {
        totalUsers = activity.billing_units;
      } else if (activity.activity_type === 'User') {
        if (activity.bill_type === 'Credit Note') {
          totalUsers -= Math.abs(activity.billing_units);
        } else {
          totalUsers += activity.billing_units;
        }
      } else if (activity.activity_type === 'Renewal') {
        totalUsers = activity.billing_units;
      }
    }

    return totalUsers;
  }

  // Get total purchase users for a customer (cumulative calculation)
  // Optimized: Finds the latest 'New' or 'Renewal' baseline and only adds subsequent 'User' adjustments
  async getTotalPurchaseUsersByCustomerId(customerId: string): Promise<number> {
    // 1. Get the latest baseline (New or Renewal) - Purchase only
    const [latestBase] = await this.db.query<{ purchase_units: number; activity_date: Date; created_at: Date }>(`
      SELECT purchase_units, activity_date, created_at
      FROM cloud_activities
      WHERE customer_id = ? 
        AND record_nature = 'Purchase' 
        AND activity_type IN ('New', 'Renewal')
      ORDER BY activity_date DESC, created_at DESC
      LIMIT 1
    `, [customerId]);

    let totalUsers = latestBase ? Number(latestBase.purchase_units) : 0; // Ensure number type
    const baseDate = latestBase ? latestBase.activity_date : '1970-01-01';
    const baseCreatedAt = latestBase ? latestBase.created_at : '1970-01-01';

    // 2. Get adjustments (User type) that happened AFTER the baseline
    const adjustments = await this.db.query<{ activity_type: string; bill_type: string; purchase_units: number }>(`
      SELECT activity_type, bill_type, purchase_units
      FROM cloud_activities
      WHERE customer_id = ? 
        AND record_nature = 'Purchase' 
        AND activity_type = 'User'
        AND (activity_date > ? OR (activity_date = ? AND created_at > ?))
    `, [customerId, baseDate, baseDate, baseCreatedAt]);

    // 3. Apply adjustments
    for (const adj of adjustments) {
      if (adj.bill_type === 'Credit Note') {
        totalUsers -= Math.abs(Number(adj.purchase_units));
      } else {
        totalUsers += Number(adj.purchase_units);
      }
    }

    return totalUsers;
  }

  // Generate PURCHASE renewal activities for selected servers ONLY
  // Creates P.U (Purchase Unit) activities - does NOT create customer sales activities
  // Customer sales activities should be created separately via bulkCustomerRenewal from Mapping page
  async generateActivitiesForServers(serverIds: string[], purchaseRate?: number): Promise<{
    created: Activity[];
    skipped: { id: string; type: 'server'; reason: string }[];
  }> {
    const created: Activity[] = [];
    const skipped: { id: string; type: 'server'; reason: string }[] = [];
    
    // Initialize ID counter once to avoid N+1 queries
    let currentIdNum = await this.getNextActivityId() - 1;
    const today = getISTDateString();

    for (const serverId of serverIds) {
      try {
        // Get server details
        const server = await this.db.queryOne<{
          id: string;
          server_ip: string;
          customer_ip: string;
          sof_no: string;
          company: string;
          purchase_rate: number;
          billing_mode: 'day_to_day' | 'month_to_month';
          billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
        }>(`SELECT * FROM cloud_servers WHERE id = ?`, [serverId]);

        if (!server) {
          skipped.push({ id: serverId, type: 'server', reason: 'Server not found' });
          continue;
        }

        // Get all active mappings for this server to calculate total purchase users
        const mappings = await this.db.query<{
          id: string;
          customer_id: string;
        }>(`SELECT * FROM cloud_mappings WHERE server_id = ? AND status = 'Active'`, [serverId]);

        if (mappings.length === 0) {
          skipped.push({ id: serverId, type: 'server', reason: 'No active customer mappings' });
          continue;
        }

        // Calculate total purchase users from all mapped customers
        let totalServerUsers = 0;
        for (const mapping of mappings) {
          const pUnits = await this.getTotalPurchaseUsersByCustomerId(mapping.customer_id);
          totalServerUsers += pUnits;
        }

        // Generate new activity ID for server
        const lastGlobalActivities = await this.db.query<{ id: string }>(`
          SELECT id FROM cloud_activities 
          WHERE id NOT LIKE '%NaN%'
          ORDER BY LENGTH(id) DESC, id DESC 
          LIMIT 50
        `);

        let maxServerNum = 0;
        // Generate new activity ID
        currentIdNum++;
        const serverActivityId = `ACT${String(currentIdNum).padStart(3, '0')}`;

        // Use server's own rate, mode, and cycle
        // Use server's own rate, mode, and cycle
        const serverRate = purchaseRate ?? server.purchase_rate ?? 0;
        const billingMode = server.billing_mode || 'day_to_day';
        let billingCycle = server.billing_cycle;

        // If server cycle is missing or default 'Yearly', try to find it from the last 'New' activity
        if (!billingCycle || billingCycle === 'Yearly') {
          const lastNewActivity = await this.db.queryOne<{ billing_cycle: string }>(`
            SELECT billing_cycle FROM cloud_activities 
            WHERE server_name = ? AND activity_type = 'New' AND billing_cycle IS NOT NULL
            ORDER BY activity_date DESC LIMIT 1
          `, [server.customer_ip || server.server_ip]);

          if (lastNewActivity && lastNewActivity.billing_cycle) {
            billingCycle = lastNewActivity.billing_cycle as any;
          }
        }

        billingCycle = billingCycle || 'Yearly';

        // Calculate expiry date based on server's mode and cycle
        const serverExpiryStr = this.calculateExpiryDate(
          'Renewal',
          today,
          billingCycle,
          billingMode
        ) || today;

        // Calculate amounts using standardized logic
        const diff = this.calculateDateDiff(today, serverExpiryStr);
        const amounts = this.calculateFinalAmounts({
          activity_type: 'Renewal',
          billing_mode: billingMode,
          billing_units: 0,
          purchase_units: totalServerUsers,
          last_bill_rate: 0,
          purchase_rate: serverRate,
          billing_cycle: billingCycle,
          start_from: today,
          new_expiry_date: serverExpiryStr,
          date_diff_months: diff.months,
          date_diff_days: diff.days
        });

        const serverPurchaseAmount = amounts.purchase_amount;

        await this.saveActivityRecord({
          id: serverActivityId,
          customer_id: null,
          customer_name: server.company || `Server ${server.server_ip}`,
          server_name: server.customer_ip || server.server_ip,
          sof_no: server.sof_no || null,
          activity_date: today,
          activity_type: 'Renewal',
          bill_type: 'Tax Invoice',
          billing_units: 0,
          purchase_units: totalServerUsers,
          last_bill_rate: 0,
          purchase_rate: serverRate,
          billing_cycle: billingCycle,
          old_expiry_date: null,
          start_from: today,
          new_expiry_date: serverExpiryStr,
          date_diff_months: diff.months,
          date_diff_days: diff.days,
          bill_amount: 0,
          purchase_amount: serverPurchaseAmount,
          remark: `Server purchase renewal (${mappings.length} mapped customers, ${totalServerUsers} total users)`,
          record_nature: 'Purchase',
          group_id: null,
          billing_mode: billingMode
        });

        const activity = await this.findById(serverActivityId);
        created.push(activity);

        // Update server cache - Purchase Units AND Server Expiry
        await this.db.execute(`
          UPDATE cloud_servers 
          SET purchase_units = ?, server_expiry = ? 
          WHERE id = ?
        `, [totalServerUsers, serverExpiryStr, serverId]);

      } catch (error: any) {
        skipped.push({ id: serverId, type: 'server', reason: error.message || 'Unknown error' });
      }
    }

    return { created, skipped };
  }

  // Helper to synchronize user counts across Mappings and Servers
  private async syncUserCounts(customerId: string, serverId?: string): Promise<void> {
    try {
      let ipFilter = '';
      let params: any[] = [customerId];

      // If specific server targeted, filter activities by that server's IPs
      if (serverId) {
          const server = await this.db.queryOne<{ server_ip: string; customer_ip: string }>(
             `SELECT server_ip, customer_ip FROM cloud_servers WHERE id = ?`, [serverId]
          );
          if (server) {
             // Match activity against server identifiers
             ipFilter = `AND (server_name = ? OR customer_domain_ip = ? OR server_name = ?)`;
             params.push(server.server_ip, server.customer_ip, server.server_ip);
          }
      }

      // 1. Active users = sum of billing_units across activities whose period
      //    is currently RUNNING (today is between start_from and new_expiry_date).
      //    A bare Renewal of 4 users covers the same 4 — its period replaces
      //    the previous one, so the previous activity is no longer running and
      //    drops out automatically. User adjustments inside the running period
      //    contribute their delta. Past / future activities are excluded.
      const result = await this.db.queryOne<{ bu: number, pu: number }>(`
        SELECT
          SUM(CASE
            WHEN record_nature = 'Sales'
             AND CURDATE() BETWEEN start_from AND new_expiry_date
            THEN billing_units ELSE 0
          END) as bu,
          SUM(CASE
            WHEN record_nature = 'Purchase'
             AND CURDATE() BETWEEN start_from AND new_expiry_date
            THEN purchase_units ELSE 0
          END) as pu
        FROM cloud_activities
        WHERE customer_id = ? ${ipFilter}
      `, params);

      const bu = Number(result?.bu || 0);
      const pu = Number(result?.pu || 0);

      // 2. Update mapping table - Targeted or Global
      if (serverId) {
          console.log(`DEBUG: syncUserCounts UPDATING SPECIFIC SERVER: Cust=${customerId}, Srv=${serverId}, BU=${bu}, PU=${pu}`);
          await this.db.execute(`
            UPDATE cloud_mappings 
            SET billed_users = ?, purchase_users = ? 
            WHERE customer_id = ? AND server_id = ?
          `, [bu, pu, customerId, serverId]);
      } else {
          // Safety Check: Do not fallback to global update if multiple mappings exist
          const count = await this.db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM cloud_mappings WHERE customer_id = ?`, [customerId]);
          if ((count?.c || 0) > 1) {
             console.warn(`[syncUserCounts] Aborted global update for customer ${customerId} because they have multiple mappings and no specific serverId was provided.`);
          } else {
              // Fallback: Update ALL mappings (Legacy / Global update) - Only safe for single-server customers
              await this.db.execute(`
                UPDATE cloud_mappings 
                SET billed_users = ?, purchase_users = ? 
                WHERE customer_id = ?
              `, [bu, pu, customerId]);
          }
      }

      // 3. Sync Cloud Server Purchase Units
      // If we know the serverId, update only that server. Otherwise try to find one.
      const targetServerId = serverId 
        ? serverId 
        : (await this.db.queryOne<{ server_id: string }>(`SELECT server_id FROM cloud_mappings WHERE customer_id = ? LIMIT 1`, [customerId]))?.server_id;

      if (targetServerId) {
        // 4. Recalculate total purchase_units for the server
        const serverResult = await this.db.queryOne<{ total_pu: number }>(`
          SELECT SUM(purchase_users) as total_pu FROM cloud_mappings WHERE server_id = ? AND status = 'Active'
        `, [targetServerId]);

        const totalPu = Number(serverResult?.total_pu || 0);

        // 5. Update server table
        await this.db.execute(`
          UPDATE cloud_servers SET purchase_units = ? WHERE id = ?
        `, [totalPu, targetServerId]);
      }
    } catch (err) {
      console.error('Failed to sync user counts:', err);
    }
  }

  /**
   * Bulk renewal - creates renewal activities for selected mappings
   * Uses details from the mapping and falls back to last activity of that specific server
   */
  async bulkCustomerRenewal(mappingIds: string[], activityDate: string): Promise<{
    created: Activity[];
    skipped: { customer_id: string; customer_name: string; reason: string }[];
  }> {
    const created: Activity[] = [];
    const skipped: { customer_id: string; customer_name: string; reason: string }[] = [];
    
    // Initialize ID counter once to avoid N+1 queries
    let currentIdNum = await this.getNextActivityId() - 1;

    const today = formatDateForMySQL(activityDate) || getISTDateString();

    for (const mappingId of mappingIds) {
      try {
        // 1. Get Mapping Details (The Source of Truth for the target)
      // Use alias for customer_ip to avoid any collision or undefined issue
      const mapping = await this.db.queryOne<any>(`
        SELECT m.*, c.company as customer_name, s.server_ip, s.customer_ip as s_customer_ip 
        FROM cloud_mappings m
        JOIN customer c ON m.customer_id = c.id
        JOIN cloud_servers s ON m.server_id = s.id
        WHERE m.id = ?
      `, [mappingId]);

      if (!mapping) {
        skipped.push({ customer_id: mappingId, customer_name: 'Unknown', reason: 'Mapping record not found' });
        continue;
      }

      const customerId = mapping.customer_id;
      const serverId = mapping.server_id;
      const mappingServerIp = mapping.server_ip;
      const mappingCustomerIp = mapping.s_customer_ip;

      console.log(`[BulkRenew] Processing: ${mapping.customer_name} (${mappingServerIp})`);

      // 2. Find the last New or Renewal activity FOR THIS SPECIFIC SERVER
      // We look for activities matching either customer_id + server IP or customer_id + customer IP
      // FIX: Also match by customer_name if customer_id is NULL (Legacy data support)
      const lastActivity = await this.db.queryOne<Activity>(`
        SELECT * FROM cloud_activities 
        WHERE (customer_id = ? OR (customer_id IS NULL AND customer_name = ?))
        AND (server_name = ? OR server_name = ?)
        AND activity_type IN ('New', 'Renewal', 'NEW', 'RENEWAL')
        AND record_nature = 'Sales'
        ORDER BY activity_date DESC, created_at DESC
        LIMIT 1
      `, [customerId, mapping.customer_name, mappingServerIp, mappingCustomerIp || mappingServerIp]);

      console.log(`[BulkRenew] matched activity:`, lastActivity ? lastActivity.id : 'NONE');

        // Fallback to customer-wide LAST activity only if NO server specific activity found
        const baseActivity = lastActivity || await this.db.queryOne<Activity>(`
          SELECT * FROM cloud_activities 
          WHERE customer_id = ? 
          AND activity_type IN ('New', 'Renewal')
          AND record_nature = 'Sales'
          ORDER BY activity_date DESC, created_at DESC
          LIMIT 1
        `, [customerId]);

        if (!baseActivity) {
          skipped.push({
            customer_id: customerId,
            customer_name: mapping.customer_name,
            reason: 'No previous activity found to base renewal on'
          });
          continue;
        }

        // Generate new activity ID
        // Use local counter to ensure uniqueness within this bulk operation and avoid N+1 queries
        currentIdNum++;
        const activityId = `ACT${String(currentIdNum).padStart(3, '0')}`;

        // Calculate new expiry date
        const billingCycle = mapping.billing_cycle || baseActivity.billing_cycle || 'Yearly';
        const billingMode = mapping.billing_mode || baseActivity.billing_mode || 'month_to_month';

        // Start from current mapping expiry if exists, else base activity expiry
        let startDateBase = today;
        const currentExpiryStr = mapping.expiry_date || baseActivity.new_expiry_date;
        
        if (currentExpiryStr) {
          // Use Expiry as Start Date (User Request: "if expiry 09/03, start should be 09/03")
          startDateBase = formatDateForMySQL(currentExpiryStr) || today;
        }

        const newExpiryDateStr = this.calculateExpiryDate('Renewal', startDateBase, billingCycle, billingMode) || today;
        const oldExpiryDateStr = currentExpiryStr;

        const diff = this.calculateDateDiff(startDateBase, newExpiryDateStr);

      // FIX: Cast to Number because mysql2 returns DECIMAL as string "0.00" which is truthy!
      const billingUnits = Number(mapping.billed_users) || Number(baseActivity?.billing_units) || 0;
      const billRate = Number(mapping.billing_rate) || Number(baseActivity?.last_bill_rate) || 0;
      // purchase_users -> purchase_units fallback to billingUnits if 0
      const mapPurUnits = Number(mapping.purchase_users);
      const actPurUnits = Number(baseActivity?.purchase_units);
      const purchaseUnits = mapPurUnits || actPurUnits || billingUnits;
      
      const purchaseRate = Number(mapping.purchase_rate) || Number(baseActivity?.purchase_rate) || 0;

        const amounts = this.calculateFinalAmounts({
          activity_type: 'Renewal',
          billing_mode: billingMode,
          billing_units: billingUnits,
          purchase_units: purchaseUnits,
          last_bill_rate: billRate,
          purchase_rate: purchaseRate,
          billing_cycle: billingCycle,
          start_from: startDateBase,
          new_expiry_date: newExpiryDateStr,
          date_diff_months: diff.months,
          date_diff_days: diff.days
        });

        await this.saveActivityRecord({
          id: activityId,
          customer_id: customerId,
          customer_name: mapping.customer_name,
          server_name: mapping.s_customer_ip || mapping.server_ip, // Prefer Customer URL for consistency with Tally Sync
          activity_date: startDateBase,
          activity_type: 'Renewal',
          bill_type: 'Tax Invoice',
          billing_units: billingUnits,
          purchase_units: purchaseUnits,
          last_bill_rate: billRate,
          purchase_rate: purchaseRate,
          billing_cycle: billingCycle as any,
          old_expiry_date: oldExpiryDateStr,
          start_from: startDateBase,
          new_expiry_date: newExpiryDateStr,
          date_diff_months: diff.months,
          date_diff_days: diff.days,
          bill_amount: amounts.bill_amount,
          purchase_amount: amounts.purchase_amount,
          record_nature: 'Sales',
          group_id: null,
          billing_mode: billingMode as any
        });

        // Sync Mapping and Server Counts with ISOLATION
        await this.syncMappingDetails(customerId, serverId, billingCycle, billingMode, billingUnits, purchaseUnits, billRate, purchaseRate, newExpiryDateStr);
        await this.syncUserCounts(customerId, serverId);

        const activity = await this.findById(activityId);
        created.push(activity);

      } catch (error: any) {
        skipped.push({
          customer_id: mappingId,
          customer_name: 'Mapping Error',
          reason: error.message || 'Unknown error'
        });
      }
    }

    return { created, skipped };
  }

  private async getNextActivityId(): Promise<number> {
    const lastActivitiesRecord = await this.db.query<{ id: string }>(`
      SELECT id FROM cloud_activities 
      WHERE id LIKE 'ACT%'
      ORDER BY LENGTH(id) DESC, id DESC 
      LIMIT 1
    `);

    let maxGenericNum = 0;
    if (lastActivitiesRecord.length > 0) {
       const match = lastActivitiesRecord[0].id.match(/(\d+)/);
       if (match) {
         maxGenericNum = parseInt(match[0]);
       }
    }
    return maxGenericNum + 1;
  }





  /**
   * Get smart defaults for renewal based on identifier (Customer ID or Server ID/IP)
   */
  async getRenewalDefaults(identifier: string, type: 'customer' | 'server', serverName?: string) {
    if (type === 'server') {
      // 1. Get Server Details
      const server = await this.db.queryOne<{
        id: string;
        server_ip: string;
        purchase_rate: number;
        billing_mode: 'day_to_day' | 'month_to_month';
        billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
        server_expiry: string;
        company: string;
      }>(`SELECT * FROM cloud_servers WHERE id = ? OR server_ip = ?`, [identifier, identifier]);

      if (!server) {
        throw new NotFoundException('Server not found');
      }

      // 2. Get Last Purchase Activity (fallback if needed)
      const lastActivity = await this.db.queryOne<Activity>(`
        SELECT * FROM cloud_activities 
        WHERE (server_name = ? OR server_name = ?) 
        AND (record_nature = 'Purchase' OR activity_type = 'New')
        ORDER BY activity_date DESC, created_at DESC LIMIT 1
      `, [server.server_ip, server.company]);

      return {
        type: 'server',
        server_name: server.server_ip,
        customer_name: server.company,
        rate: server.purchase_rate || (lastActivity?.purchase_rate) || 0,
        cycle: server.billing_cycle || (lastActivity?.billing_cycle) || 'Yearly',
        mode: server.billing_mode || (lastActivity?.billing_mode) || 'day_to_day',
        // Start Date = Expiry (User Request)
        start_date: server.server_expiry ? formatDateForMySQL(server.server_expiry) : (lastActivity?.new_expiry_date ? formatDateForMySQL(lastActivity.new_expiry_date) : getISTDateString()),
        last_expiry: server.server_expiry,
        units: lastActivity?.purchase_units || 0
      };
    } else {
      // 1. Get Customer Mapping — if serverName provided, filter by it for multi-server customers
      let mappingQuery = `
        SELECT m.*, s.server_ip, s.customer_ip, s.billing_cycle as server_default_cycle, s.billing_mode as server_default_mode
        FROM cloud_mappings m
        LEFT JOIN cloud_servers s ON m.server_id = s.id
        WHERE m.customer_id = ? AND m.status = 'Active'
      `;
      const mappingParams: any[] = [identifier];
      if (serverName) {
        mappingQuery += ` AND (s.server_ip = ? OR s.customer_ip = ?)`;
        mappingParams.push(serverName, serverName);
      }

      const mapping = await this.db.queryOne<{
        server_id: string;
        server_ip: string;
        customer_ip: string;
        billed_users?: number;
        purchase_users?: number;
        billing_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
        billing_mode?: 'day_to_day' | 'month_to_month';
        billing_rate?: number;
        server_default_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
        server_default_mode?: 'day_to_day' | 'month_to_month';
      }>(mappingQuery, mappingParams);

      // 2. Get Last Sales Activity — filter by server if provided
      // server_name in activities could be stored as server_ip OR customer_ip, match both
      let activityQuery = `
        SELECT * FROM cloud_activities 
        WHERE (customer_id = ? OR customer_domain_ip = ?)
        AND (record_nature = 'Sales' OR record_nature IS NULL)
      `;
      const activityParams: any[] = [identifier, identifier];
      if (serverName) {
        // Use both server_ip and customer_ip from mapping if available
        const sIp = mapping?.server_ip || '';
        const cIp = mapping?.customer_ip || '';
        const serverValues = [serverName, sIp, cIp].filter(v => v && v.length > 0);
        const uniqueValues = [...new Set(serverValues)];
        if (uniqueValues.length > 0) {
          activityQuery += ` AND server_name IN (${uniqueValues.map(() => '?').join(',')})`;
          activityParams.push(...uniqueValues);
        }
      }
      activityQuery += ` ORDER BY activity_date DESC, created_at DESC LIMIT 1`;

      const lastActivity = await this.db.queryOne<Activity>(activityQuery, activityParams);

      // TOTAL users on the running plan = base plan units + every mid-cycle
      // User addition that expires WITH the plan. Mid-cycle "User" activities
      // are saved with new_expiry_date = the plan's expiry, so summing
      // billing_units across all Sales activities sharing the current plan's
      // expiry gives the real active count (e.g. 12 base + 3 added = 15).
      // Renewing must carry ALL of them forward, not just the last row's
      // count — which is why a renewal used to show only the 3 added users.
      let planTotalUnits: number | null = null;
      const planExpiry = lastActivity?.new_expiry_date;
      if (planExpiry) {
        let unitsQuery = `
          SELECT COALESCE(SUM(billing_units), 0) AS total_units
          FROM cloud_activities
          WHERE (customer_id = ? OR customer_domain_ip = ?)
            AND (record_nature = 'Sales' OR record_nature IS NULL)
            AND new_expiry_date = ?
        `;
        const unitsParams: any[] = [identifier, identifier, planExpiry];
        if (serverName) {
          const sIp = mapping?.server_ip || '';
          const cIp = mapping?.customer_ip || '';
          const uniq = [...new Set([serverName, sIp, cIp].filter(v => v && v.length > 0))];
          if (uniq.length > 0) {
            unitsQuery += ` AND server_name IN (${uniq.map(() => '?').join(',')})`;
            unitsParams.push(...uniq);
          }
        }
        const sumRow = await this.db.queryOne<{ total_units: number }>(unitsQuery, unitsParams);
        const t = Number(sumRow?.total_units || 0);
        if (t > 0) planTotalUnits = t;
      }

      // BASE plan activity for the running plan = the most recent New/Renewal
      // that established it (activity_type != 'User'), sharing the current
      // plan's expiry. Its cycle/mode/rate are the plan's real cadence — a
      // mid-cycle "User" top-up is billed M2M/Monthly pro-rata, so reading
      // cycle/mode off the last activity made a Quarterly/D2D plan renew as
      // Monthly/M2M. The base activity is the authoritative source.
      let basePlan: Activity | null = null;
      if (planExpiry) {
        let baseQuery = `
          SELECT * FROM cloud_activities
          WHERE (customer_id = ? OR customer_domain_ip = ?)
            AND (record_nature = 'Sales' OR record_nature IS NULL)
            AND new_expiry_date = ?
            AND (activity_type IS NULL OR activity_type != 'User')
        `;
        const baseParams: any[] = [identifier, identifier, planExpiry];
        if (serverName) {
          const sIp = mapping?.server_ip || '';
          const cIp = mapping?.customer_ip || '';
          const uniq = [...new Set([serverName, sIp, cIp].filter(v => v && v.length > 0))];
          if (uniq.length > 0) {
            baseQuery += ` AND server_name IN (${uniq.map(() => '?').join(',')})`;
            baseParams.push(...uniq);
          }
        }
        baseQuery += ` ORDER BY activity_date DESC, created_at DESC LIMIT 1`;
        basePlan = await this.db.queryOne<Activity>(baseQuery, baseParams);
      }
      // Everything that describes the recurring plan comes from the base
      // activity when we found one; the last (possibly User) activity is only
      // the fallback.
      const planSource = basePlan || lastActivity;

      console.log('[getRenewalDefaults] customer:', identifier, 'serverName:', serverName || 'ALL', 'planTotalUnits:', planTotalUnits, 'planSource:', planSource ? {
        id: planSource.id, type: planSource.activity_type, rate: planSource.last_bill_rate, units: planSource.billing_units,
        cycle: planSource.billing_cycle, mode: planSource.billing_mode, expiry: planSource.new_expiry_date,
        server_name: planSource.server_name
      } : 'NULL', 'mapping:', mapping ? { billing_cycle: mapping.billing_cycle, billing_mode: mapping.billing_mode, billed_users: mapping.billed_users } : 'NULL');

      return {
        type: 'customer',
        customer_id: identifier,
        server_ip: mapping?.server_ip || '',
        customer_domain_ip: mapping?.customer_ip || '',
        // Cadence (rate / cycle / mode) follows the BASE plan, not a mid-cycle
        // User top-up. Priority: basePlan > mapping > server > default.
        rate: planSource?.last_bill_rate || mapping?.billing_rate || 0,
        cycle: planSource?.billing_cycle || mapping?.billing_cycle || mapping?.server_default_cycle || 'Yearly',
        mode: planSource?.billing_mode || mapping?.billing_mode || mapping?.server_default_mode || 'day_to_day',
        // Start Date = Expiry (User Request)
        start_date: lastActivity?.new_expiry_date ? formatDateForMySQL(lastActivity.new_expiry_date) : getISTDateString(),
        last_expiry: lastActivity?.new_expiry_date,
        // Plan window for the User-vs-New auto-detection. Start comes from the
        // base activity (the true plan start), expiry is shared.
        current_plan_start: planSource?.start_from || planSource?.activity_date || lastActivity?.start_from || lastActivity?.activity_date,
        current_plan_expiry: lastActivity?.new_expiry_date,
        server_expiry: mapping?.server_id ? (await this.db.queryOne<{ server_expiry: string }>(`SELECT server_expiry FROM cloud_servers WHERE id = ?`, [mapping.server_id]))?.server_expiry : null,
        // Renewal default = full active user count on the running plan
        // (base + mid-cycle additions), falling back to the last activity /
        // mapping only if the plan-sum couldn't be computed.
        units: planTotalUnits ?? lastActivity?.billing_units ?? (mapping as any)?.billed_users ?? 0
      };
    }
  }


  /**
   * Private helper to save an activity record following the 24-column structure.
   * This ensures all hidden fields like record_nature and group_id are always set.
   */
  private async saveActivityRecord(data: any): Promise<void> {
    console.log('[TRACE] saveActivityRecord PUSHING TO DB:', JSON.stringify(data));
    await this.db.execute(`
      INSERT INTO cloud_activities (
        id, display_id, customer_id, customer_name, customer_domain_ip, server_name, sof_no, activity_date, 
        activity_type, bill_type, billing_units, purchase_units, last_bill_rate, 
        purchase_rate, billing_cycle, old_expiry_date, start_from, new_expiry_date, 
        date_diff_months, date_diff_days, bill_amount, purchase_amount, 
        record_nature, group_id, billing_mode, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      data.id,
      data.display_id || null, // New field
      data.customer_id || null,
      data.customer_name,
      data.customer_domain_ip || null, // Added field
      data.server_name || null,
      data.sof_no || null,
      formatDateForMySQL(data.activity_date),
      data.activity_type,
      data.bill_type || 'Tax Invoice',
      data.billing_units || 0,
      data.purchase_units || 0,
      data.last_bill_rate || 0,
      data.purchase_rate || 0,
      data.billing_cycle || 'Yearly',
      formatDateForMySQL(data.old_expiry_date),
      formatDateForMySQL(data.start_from),
      formatDateForMySQL(data.new_expiry_date),
      data.date_diff_months || 0,
      data.date_diff_days || 0,
      data.bill_amount || 0,
      data.purchase_amount || 0,
      data.record_nature || 'Sales',
      data.group_id || null,
      data.billing_mode || 'month_to_month'
    ]);
  }


  /**
   * Helper to resolve server_name (IP) to ID
   */
  private async resolveServerId(ipOrName: string): Promise<string | undefined> {
    const server = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM cloud_servers WHERE server_ip = ? OR customer_ip = ?`,
      [ipOrName, ipOrName]
    );
    console.log('DEBUG: resolveServerId', { input: ipOrName, found: server?.id });
    return server?.id;
  }

  /**
   * Syncs the selected billing cycle and mode to the customer mapping.
   * Performs a lazy migration by adding columns if they don't exist.
   */
  /**
   * Syncs all billing details (units, rates, cycle, mode, expiry) to the customer mapping.
   */
  private async syncMappingDetails(
    customerId: string,
    serverId?: string,
    billingCycle?: string | null,
    billingMode?: string | null,
    billingUnits?: number,
    purchaseUnits?: number,
    billRate?: number,
    purchaseRate?: number,
    newExpiry?: string | null
  ) {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      // SAFETY: If customer has multiple mappings, we MUST have a serverId to update specific details.
      // Otherwise we risk overwriting valid data on other servers with data from this activity.
      if (!serverId) {
          const count = await this.db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM cloud_mappings WHERE customer_id = ?`, [customerId]);
          if ((count?.c || 0) > 1) {
              console.warn(`[syncMappingDetails] Aborted global update for customer ${customerId} because they have multiple mappings and no specific serverId was provided.`);
              return; 
          }
      }

      if (billingCycle) { updates.push('billing_cycle = ?'); values.push(billingCycle); }
      if (billingMode) { updates.push('billing_mode = ?'); values.push(billingMode); }
      if (billingUnits !== undefined) { updates.push('billed_users = ?'); values.push(billingUnits); }
      if (purchaseUnits !== undefined) { updates.push('purchase_users = ?'); values.push(purchaseUnits); }
      if (billRate !== undefined) { updates.push('billing_rate = ?'); values.push(billRate); }
      if (purchaseRate !== undefined) { updates.push('purchase_rate = ?'); values.push(purchaseRate); }

      // Update expiry only if it extends the current one or if explicitly setting a new valid range
      if (newExpiry) {
        // Fetch current expiry to compare
        const currentMapping = await this.db.queryOne<{ expiry_date: string }>(
             `SELECT expiry_date FROM cloud_mappings WHERE customer_id = ? ${serverId ? 'AND server_id = ?' : ''} LIMIT 1`, 
             serverId ? [customerId, serverId] : [customerId]
        );

        let shouldUpdateExpiry = true;
        if (currentMapping && currentMapping.expiry_date) {
            // Check if New Expiry is actually LATER than current
            // Handle potentially mixed date formats by extracting YYYY-MM-DD
            const currentStr = formatDateForMySQL(currentMapping.expiry_date) || '';
            const newStr = formatDateForMySQL(newExpiry) || '';
            // Only compare if both are valid strings
            // Check if New Expiry is actually LATER than current
            // Use Date object comparison for safety vs string comparison
            const cDate = new Date(currentStr);
            const nDate = new Date(newStr);

            console.log(`[syncMappingDetails] Expiry Check: Current=${currentStr} (${cDate.toISOString()}), New=${newStr} (${nDate.toISOString()})`);

            if (!isNaN(cDate.getTime()) && !isNaN(nDate.getTime())) {
                 if (cDate >= nDate) {
                     shouldUpdateExpiry = false; // Current is later, don't overwrite
                     console.log(`[syncMappingDetails] Skipping expiry update (Current >= New)`);
                 }
            } else {
                // Fallback to string comparison if parsing fails (Legacy safety)
                if (currentStr && newStr && currentStr >= newStr) {
                    shouldUpdateExpiry = false;
                }
            }
        }

        if (shouldUpdateExpiry) {
            updates.push('expiry_date = ?');
            values.push(formatDateForMySQL(newExpiry));
        }
      }

      if (updates.length === 0) return;

      let whereClause = `WHERE customer_id = ?`;
      values.push(customerId);

      if (serverId) {
        whereClause += ` AND server_id = ?`;
        values.push(serverId);
      }

      console.log(`DEBUG: syncMappingDetails EXECUTING: UPDATE cloud_mappings SET ${updates.join(', ')} ${whereClause}`, values);

      await this.db.execute(
        `UPDATE cloud_mappings SET ${updates.join(', ')} ${whereClause}`,
        values
      );

      if (newExpiry) {
        // Also update legacy clouddetails if needed (only if no server specific or just last one)
        // Check if table exists first to be safe or ignore error
        try {
            await this.db.execute(
            `UPDATE clouddetails SET cloud_expiry = ? WHERE customerid = ?`,
            [formatDateForMySQL(newExpiry), customerId]
            );
        } catch(e) {}
      }

      // Sync Cloud Server Purchase Units
      // If we know the serverId, update only that server
      const targetServerId = serverId 
        ? serverId 
        : (await this.db.queryOne<{ server_id: string }>(`SELECT server_id FROM cloud_mappings WHERE customer_id = ?`, [customerId]))?.server_id;

      if (targetServerId) {
        await this.db.execute(`
           UPDATE cloud_servers s
           SET purchase_units = (
             SELECT COALESCE(SUM(purchase_users), 0)
             FROM cloud_mappings
             WHERE server_id = ? AND status = 'Active'
           )
           WHERE id = ?
         `, [targetServerId, targetServerId]);
      }

      // --- Refresh Effective Fields for Optimized Filters ---
      await this.db.execute(`
        UPDATE cloud_mappings m
        JOIN cloud_servers s ON m.server_id = s.id
        JOIN customer c ON m.customer_id = c.id
        SET m.effective_cycle = COALESCE(m.billing_cycle, s.billing_cycle),
            m.effective_mode = COALESCE(m.billing_mode, s.billing_mode),
            m.effective_rate = COALESCE(
                NULLIF(m.billing_rate, 0), 
                (SELECT COALESCE(NULLIF(last_bill_rate, 0), NULLIF(purchase_rate, 0), NULLIF(billing_rate, 0)) FROM cloud_activities WHERE (customer_id = m.customer_id OR customer_name = c.company) AND record_nature = 'Sales' AND activity_type IN ('New', 'Renewal') ORDER BY activity_date DESC LIMIT 1),
                s.purchase_rate
            ),
            m.effective_expiry = COALESCE(
                m.expiry_date, 
                (SELECT new_expiry_date FROM cloud_activities WHERE (customer_id = m.customer_id OR customer_name = c.company) AND record_nature = 'Sales' AND activity_type IN ('New', 'Renewal') ORDER BY activity_date DESC LIMIT 1),
                s.server_expiry
            )
        WHERE m.customer_id = ? ${serverId ? 'AND m.server_id = ?' : ''}
      `, serverId ? [customerId, serverId] : [customerId]);

    } catch (error: any) {
      console.error('Failed to sync mapping details:', error);
    }
  }
}
