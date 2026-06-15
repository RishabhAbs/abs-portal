import { Injectable, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class BillingService implements OnModuleInit {
  constructor(private db: DbService) {}

  async onModuleInit() {
    // Bills table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS bills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        voucher VARCHAR(20) NOT NULL DEFAULT 'Sales',
        billing_company VARCHAR(255) NULL,
        customer_id INT NULL,
        bill_type VARCHAR(20) NOT NULL DEFAULT 'Tally',
        invoice_no VARCHAR(100) NULL,
        invoice_date DATE NULL,
        task_add VARCHAR(5) DEFAULT 'No',
        ref_no VARCHAR(100) NULL,
        ref_date DATE NULL,
        subtotal DECIMAL(12,2) DEFAULT 0,
        discount DECIMAL(12,2) DEFAULT 0,
        total DECIMAL(12,2) DEFAULT 0,
        cgst DECIMAL(12,2) DEFAULT 0,
        sgst DECIMAL(12,2) DEFAULT 0,
        igst DECIMAL(12,2) DEFAULT 0,
        grand_total DECIMAL(12,2) DEFAULT 0,
        bill_status VARCHAR(20) DEFAULT 'Pending',
        pay_status VARCHAR(20) DEFAULT 'Pending',
        pay_type VARCHAR(50) NULL,
        pay_date DATE NULL,
        pay_remarks TEXT NULL,
        no_followup INT DEFAULT 0,
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Bill items table (unified for Tally + Cloud)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS bill_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bill_id INT NOT NULL,
        item_type VARCHAR(50) NULL,
        serial_no VARCHAR(100) NULL,
        old_expiry DATE NULL,
        new_expiry DATE NULL,
        period VARCHAR(50) NULL,
        remarks TEXT NULL,
        no_users INT DEFAULT 0,
        rate DECIMAL(12,2) DEFAULT 0,
        amount DECIMAL(12,2) DEFAULT 0,
        product VARCHAR(100) NULL,
        serial_tally_info TEXT NULL,
        inc_rate DECIMAL(12,2) DEFAULT 0,
        qty INT DEFAULT 0,
        commission DECIMAL(12,2) DEFAULT 0,
        c_discount DECIMAL(12,2) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Payments table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS bill_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bill_id INT NOT NULL,
        payment_ledger VARCHAR(255) NULL,
        payment_type VARCHAR(50) NULL,
        instrument VARCHAR(100) NULL,
        amount DECIMAL(12,2) DEFAULT 0,
        tds DECIMAL(12,2) DEFAULT 0,
        bank VARCHAR(255) NULL,
        bank_date DATE NULL,
        status VARCHAR(20) DEFAULT 'Pending',
        payment_complete VARCHAR(5) DEFAULT 'No',
        added_by VARCHAR(100) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns safely
    const billCols = [
      { name: 'commission_total', def: 'DECIMAL(12,2) DEFAULT 0 AFTER grand_total' },
      { name: 'c_discount_total', def: 'DECIMAL(12,2) DEFAULT 0 AFTER commission_total' },
    ];
    for (const col of billCols) {
      try {
        await this.db.execute(`ALTER TABLE bills ADD COLUMN ${col.name} ${col.def}`);
      } catch (e) { /* already exists */ }
    }
  }

  // ─── Bills CRUD ────────────────────────────────────────────────────────────

  async createBill(data: any, created_by: string) {
    const result = await this.db.execute(
      `INSERT INTO bills (voucher, billing_company, customer_id, bill_type, invoice_no, invoice_date, task_add, ref_no, ref_date, subtotal, discount, total, cgst, sgst, igst, grand_total, commission_total, c_discount_total, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.voucher || 'Sales',
        data.billing_company || null,
        data.customer_id || null,
        data.bill_type || 'Tally',
        data.invoice_no || null,
        data.invoice_date || null,
        data.task_add || 'No',
        data.ref_no || null,
        data.ref_date || null,
        data.subtotal || 0,
        data.discount || 0,
        data.total || 0,
        data.cgst || 0,
        data.sgst || 0,
        data.igst || 0,
        data.grand_total || 0,
        data.commission_total || 0,
        data.c_discount_total || 0,
        created_by,
      ]
    );

    const billId = result.insertId;

    // Insert line items
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        await this.db.execute(
          `INSERT INTO bill_items (bill_id, item_type, serial_no, old_expiry, new_expiry, period, remarks, no_users, rate, amount, product, serial_tally_info, inc_rate, qty, commission, c_discount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            billId,
            item.item_type || null,
            item.serial_no || null,
            item.old_expiry || null,
            item.new_expiry || null,
            item.period || null,
            item.remarks || null,
            item.no_users || 0,
            item.rate || 0,
            item.amount || 0,
            item.product || null,
            item.serial_tally_info || null,
            item.inc_rate || 0,
            item.qty || 0,
            item.commission || 0,
            item.c_discount || 0,
          ]
        );
      }
    }

    return { success: true, data: { id: billId }, message: 'Bill created successfully' };
  }

  async getBills(filters: {
    bill_type?: string;
    bill_status?: string;
    pay_status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    reseller?: boolean;
    no_follow?: boolean;
    today?: boolean;
    after_today?: boolean;
  }) {
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (filters.bill_type) {
      where += ' AND b.bill_type = ?';
      params.push(filters.bill_type);
    }
    if (filters.bill_status) {
      where += ' AND b.bill_status = ?';
      params.push(filters.bill_status);
    }
    if (filters.pay_status) {
      where += ' AND b.pay_status = ?';
      params.push(filters.pay_status);
    }
    if (filters.search) {
      where += ' AND (c.company LIKE ? OR b.invoice_no LIKE ? OR b.billing_company LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s);
    }
    if (filters.startDate) {
      where += ' AND b.invoice_date >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where += ' AND b.invoice_date <= ?';
      params.push(filters.endDate);
    }
    if (filters.no_follow) {
      where += ' AND (b.no_followup = 0 OR b.no_followup IS NULL)';
    }
    if (filters.today) {
      where += ' AND b.invoice_date = CURDATE()';
    }
    if (filters.after_today) {
      where += ' AND b.invoice_date > CURDATE()';
    }

    const sql = `
      SELECT b.*, c.company as customer_name,
        (SELECT GROUP_CONCAT(cu2.company) FROM customer cu2 WHERE cu2.reseller = c.id LIMIT 1) as reseller_name,
        (SELECT u.name FROM cloud_users u WHERE u.id = c.\`group\` LIMIT 1) as group_name
      FROM bills b
      LEFT JOIN customer c ON b.customer_id = c.id
      ${where}
      ORDER BY b.created_at DESC
    `;

    const data = await this.db.query(sql, params);
    return { success: true, data };
  }

  async getBillWithItems(id: number) {
    const bill = await this.db.queryOne<any>('SELECT b.*, c.company as customer_name FROM bills b LEFT JOIN customer c ON b.customer_id = c.id WHERE b.id = ?', [id]);
    if (!bill) throw new NotFoundException('Bill not found');

    const items = await this.db.query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [id]);
    return { success: true, data: { ...bill, items } };
  }

  async updateBill(id: number, data: any) {
    const bill = await this.db.queryOne<any>('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw new NotFoundException('Bill not found');

    await this.db.execute(
      `UPDATE bills SET voucher=?, billing_company=?, customer_id=?, invoice_no=?, invoice_date=?, task_add=?, ref_no=?, ref_date=?, subtotal=?, discount=?, total=?, cgst=?, sgst=?, igst=?, grand_total=?, commission_total=?, c_discount_total=? WHERE id=?`,
      [
        data.voucher || bill.voucher,
        data.billing_company || bill.billing_company,
        data.customer_id || bill.customer_id,
        data.invoice_no || bill.invoice_no,
        data.invoice_date || bill.invoice_date,
        data.task_add || bill.task_add,
        data.ref_no || bill.ref_no,
        data.ref_date || bill.ref_date,
        data.subtotal ?? bill.subtotal,
        data.discount ?? bill.discount,
        data.total ?? bill.total,
        data.cgst ?? bill.cgst,
        data.sgst ?? bill.sgst,
        data.igst ?? bill.igst,
        data.grand_total ?? bill.grand_total,
        data.commission_total ?? bill.commission_total,
        data.c_discount_total ?? bill.c_discount_total,
        id,
      ]
    );

    // Replace items if provided
    if (data.items && Array.isArray(data.items)) {
      await this.db.execute('DELETE FROM bill_items WHERE bill_id = ?', [id]);
      for (const item of data.items) {
        await this.db.execute(
          `INSERT INTO bill_items (bill_id, item_type, serial_no, old_expiry, new_expiry, period, remarks, no_users, rate, amount, product, serial_tally_info, inc_rate, qty, commission, c_discount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, item.item_type||null, item.serial_no||null, item.old_expiry||null, item.new_expiry||null, item.period||null, item.remarks||null, item.no_users||0, item.rate||0, item.amount||0, item.product||null, item.serial_tally_info||null, item.inc_rate||0, item.qty||0, item.commission||0, item.c_discount||0]
        );
      }
    }

    return { success: true, message: 'Bill updated' };
  }

  async updateBillStatus(id: number, data: { bill_status?: string; pay_status?: string; pay_type?: string; pay_date?: string; pay_remarks?: string }) {
    const bill = await this.db.queryOne<any>('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw new NotFoundException('Bill not found');

    const sets: string[] = [];
    const vals: any[] = [];
    if (data.bill_status) { sets.push('bill_status = ?'); vals.push(data.bill_status); }
    if (data.pay_status) { sets.push('pay_status = ?'); vals.push(data.pay_status); }
    if (data.pay_type) { sets.push('pay_type = ?'); vals.push(data.pay_type); }
    if (data.pay_date) { sets.push('pay_date = ?'); vals.push(data.pay_date); }
    if (data.pay_remarks !== undefined) { sets.push('pay_remarks = ?'); vals.push(data.pay_remarks); }

    if (sets.length === 0) throw new BadRequestException('No fields to update');

    vals.push(id);
    await this.db.execute(`UPDATE bills SET ${sets.join(', ')} WHERE id = ?`, vals);
    return { success: true, message: 'Bill status updated' };
  }

  async incrementFollowup(id: number) {
    await this.db.execute('UPDATE bills SET no_followup = COALESCE(no_followup, 0) + 1 WHERE id = ?', [id]);
    return { success: true, message: 'Follow-up recorded' };
  }

  // ─── Payments CRUD ─────────────────────────────────────────────────────────

  async addPayment(data: any, added_by: string) {
    const result = await this.db.execute(
      `INSERT INTO bill_payments (bill_id, payment_ledger, payment_type, instrument, amount, tds, bank, bank_date, status, payment_complete, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.bill_id,
        data.payment_ledger || null,
        data.payment_type || null,
        data.instrument || null,
        data.amount || 0,
        data.tds || 0,
        data.bank || null,
        data.bank_date || null,
        data.status || 'Pending',
        data.payment_complete || 'No',
        added_by,
      ]
    );
    return { success: true, data: { id: result.insertId }, message: 'Payment added' };
  }

  async getPayments(filters: {
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    payment_complete?: string;
  }) {
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (filters.status) {
      where += ' AND bp.status = ?';
      params.push(filters.status);
    }
    if (filters.payment_complete) {
      where += ' AND bp.payment_complete = ?';
      params.push(filters.payment_complete);
    }
    if (filters.search) {
      where += ' AND (c.company LIKE ? OR b.invoice_no LIKE ? OR bp.payment_ledger LIKE ? OR bp.instrument LIKE ?)';
      const s = `%${filters.search}%`;
      params.push(s, s, s, s);
    }
    if (filters.startDate) {
      where += ' AND bp.created_at >= ?';
      params.push(filters.startDate + ' 00:00:00');
    }
    if (filters.endDate) {
      where += ' AND bp.created_at <= ?';
      params.push(filters.endDate + ' 23:59:59');
    }

    const sql = `
      SELECT bp.*, b.invoice_no, b.invoice_date, b.bill_type, b.billing_company,
        c.company as customer_name
      FROM bill_payments bp
      LEFT JOIN bills b ON bp.bill_id = b.id
      LEFT JOIN customer c ON b.customer_id = c.id
      ${where}
      ORDER BY bp.created_at DESC
    `;

    const data = await this.db.query(sql, params);
    return { success: true, data };
  }

  async updatePayment(id: number, data: any) {
    const payment = await this.db.queryOne<any>('SELECT * FROM bill_payments WHERE id = ?', [id]);
    if (!payment) throw new NotFoundException('Payment not found');

    const sets: string[] = [];
    const vals: any[] = [];

    const fields = ['payment_ledger', 'payment_type', 'instrument', 'amount', 'tds', 'bank', 'bank_date', 'status', 'payment_complete'];
    for (const f of fields) {
      if (data[f] !== undefined) { sets.push(`${f} = ?`); vals.push(data[f]); }
    }

    if (sets.length === 0) throw new BadRequestException('No fields to update');

    vals.push(id);
    await this.db.execute(`UPDATE bill_payments SET ${sets.join(', ')} WHERE id = ?`, vals);
    return { success: true, message: 'Payment updated' };
  }

  // ─── Billing Companies (from singlemaster or hardcoded) ─────────────────

  async getBillingCompanyItems(companyId: number) {
    try {
      const data = await this.db.query(
        `SELECT b.*, p.name as product_name
         FROM billingitem b
         LEFT JOIN product p ON b.productid = p.id
         WHERE b.billingid = ?`,
        [companyId]
      );
      return { success: true, data };
    } catch {
      return { success: true, data: [] };
    }
  }

  async getBillingCompanies() {
    try {
      const data = await this.db.query("SELECT id, name FROM billingcompany ORDER BY name");
      return { success: true, data };
    } catch {
      return { success: true, data: [] };
    }
  }

  async getProducts() {
    try {
      const data = await this.db.query("SELECT id, name FROM singlemaster WHERE type = 'Product' ORDER BY name");
      return { success: true, data };
    } catch {
      return { success: true, data: [] };
    }
  }

  async getTallyItemTypes() {
    return {
      success: true,
      data: [
        { value: 'Gold', label: 'Gold' },
        { value: 'Silver', label: 'Silver' },
        { value: 'Auditor', label: 'Auditor' },
        { value: 'TDL', label: 'TDL' },
        { value: 'Rental', label: 'Rental' },
      ]
    };
  }
}
