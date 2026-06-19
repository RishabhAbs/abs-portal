import { Injectable, NotFoundException, ConflictException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { PincodeService } from './pincode.service';

// Interface matches existing abs_service.customer table structure
export interface Customer {
  id: number;  // INT auto-increment (existing table)
  company: string;
  group: number | null;  // INT reference to admin table
  group_name?: string;  // Joined from admin table
  customerid: string | null;  // Domain
  address1: string | null;
  address2: string | null;
  address3: string | null;
  pincode: string | null;
  area: string | null;
  state: number | null;
  city: string | null;
  gstin: string | null;
  email: string | null;
  mobile: string | null;
  person: string | null;
  remarks: string | null;
  status: string | null;
  date: string | null;
  // New Fields
  designation?: string | null;
  whatsapp?: string | null;
  tally?: string | null;
  btype?: string | null;
  grade?: string | null;
  aging_days?: number | null;
  reseller?: string | null;
  resellerid?: number | null;
}

@Injectable()
export class CustomersService implements OnModuleInit {
  constructor(
    private db: DbService,
    private pincodeService: PincodeService
  ) { }

  async onModuleInit() {
    try {
      const cols = await this.db.query<any>(`DESCRIBE customer`);
      const colNames = cols.map((c: any) => c.Field);


      // Ensure core customer columns exist (local dev DB may be missing them)
      const coreCols: Record<string, string> = {
        mobile: `VARCHAR(255) DEFAULT NULL`,
        person: `VARCHAR(255) DEFAULT NULL`,
        area: `VARCHAR(255) DEFAULT NULL`,
        city: `VARCHAR(255) DEFAULT NULL`,
        state: `INT DEFAULT NULL`,
        grade: `VARCHAR(255) DEFAULT 'Good'`,
        tally: `VARCHAR(255) DEFAULT 'No'`,
        broadcastid: `INT DEFAULT 0`,
        whatsapp: `VARCHAR(10) DEFAULT 'Yes'`,
        image: `VARCHAR(255) DEFAULT NULL`,
        group2: `VARCHAR(20) DEFAULT NULL`,
        reason: `VARCHAR(255) DEFAULT NULL`,
        partner: `VARCHAR(255) DEFAULT NULL`,
        designation: `VARCHAR(255) DEFAULT '53'`,
        ledgergroup: `INT DEFAULT 26`,
      };
      for (const [col, def] of Object.entries(coreCols)) {
        if (!colNames.includes(col)) {
          await this.db.execute(`ALTER TABLE customer ADD COLUMN ${col} ${def}`).catch(() => {});
        }
      }

      // Ensure cloud_group_id column exists
      if (!colNames.includes('cloud_group_id')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN cloud_group_id VARCHAR(20) DEFAULT NULL`);
        await this.db.execute(`ALTER TABLE customer ADD INDEX idx_cloud_group_id (cloud_group_id)`).catch(() => {});
      }

      // Ensure subgroupid column exists
      if (!colNames.includes('subgroupid')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN subgroupid VARCHAR(20) DEFAULT NULL`);
        await this.db.execute(`ALTER TABLE customer ADD INDEX idx_subgroupid (subgroupid)`).catch(() => {});
      }

      // Ensure lastvisitperson and lastcallperson are VARCHAR(50) for USR... support
      const lvpCol = cols.find((c: any) => c.Field === 'lastvisitperson');
      if (lvpCol && !lvpCol.Type.includes('varchar')) {
        await this.db.execute(`ALTER TABLE customer MODIFY COLUMN lastvisitperson VARCHAR(50)`);
        await this.db.execute(`ALTER TABLE customer MODIFY COLUMN lastcallperson VARCHAR(50)`);
      }

      // Add billbybill column — 'Yes' for customers, 'No' for other ledgers
      if (!colNames.includes('billbybill')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN billbybill ENUM('Yes','No') DEFAULT 'Yes'`);
        // Set 'No' for all existing non-Sundry-Debtor records (other ledgers)
        await this.db.execute(
          `UPDATE customer SET billbybill = 'No' WHERE ledgergroup != 26 AND ledgergroup IS NOT NULL`
        );
      }

      // Active/Inactive flag — independent of OC/NOC. Inactive customers are
      // hidden from OC/NOC lists and only visible on the dedicated Inactive
      // Customers page (admin-only).
      if (!colNames.includes('active_status')) {
        await this.db.execute(
          `ALTER TABLE customer ADD COLUMN active_status ENUM('Active','Inactive') DEFAULT 'Active'`
        );
        await this.db.execute(`ALTER TABLE customer ADD INDEX idx_active_status (active_status)`).catch(() => {});
      }
      if (!colNames.includes('deactivated_at')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN deactivated_at DATETIME DEFAULT NULL`);
      }

      // Legacy table — opening bills now live in bill_allocation with
      // vchid=NULL. Kept here as IF NOT EXISTS so old DBs don't blow up
      // when we run the migration below.
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS customer_opening_bills (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT           NOT NULL,
          bill_name   VARCHAR(100)  NOT NULL,
          bill_date   DATE          DEFAULT NULL,
          amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
          ref_type    ENUM('Bill','On Account') DEFAULT 'Bill',
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_customer (customer_id),
          INDEX idx_bill_name (bill_name)
        )
      `);

      // One-time migration: any rows that ever made it into
      // customer_opening_bills get copied into bill_allocation with
      // vchid=NULL and the customer's Dr/Cr direction baked into the sign.
      // Idempotent: checks whether bill_allocation already has matching
      // (ledger, billname) opening rows before inserting.
      try {
        const legacyRows = await this.db.query<any>(`
          SELECT cob.customer_id, cob.bill_name, cob.bill_date, cob.amount,
                 c.opening_balance_type
          FROM customer_opening_bills cob
          INNER JOIN customer c ON c.id = cob.customer_id
        `);
        for (const r of legacyRows) {
          const sign = r.opening_balance_type === 'Cr' ? -1 : 1;
          const signed = Math.abs(Number(r.amount) || 0) * sign;
          // Skip if an opening row already exists for this (ledger, billname)
          // — keeps the migration idempotent across multiple boots.
          const existing = await this.db.queryOne<any>(
            `SELECT id FROM bill_allocation
             WHERE vchid IS NULL AND ledger = ? AND billname = ? LIMIT 1`,
            [r.customer_id, r.bill_name],
          );
          if (existing) continue;
          await this.db.execute(
            `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount, bill_date)
             VALUES (NULL, NULL, ?, ?, ?, ?)`,
            [r.customer_id, r.bill_name, signed, r.bill_date || null],
          );
        }
      } catch (e) {
        // Ignore — migration already done, or column not yet present.
      }

    } catch (error) {
      console.error('CustomersService: Schema migration warning (might be handled elsewhere):', error.message);
    }
  }

  /** Fetch the opening-balance bill allocation for a single customer.
   *
   *  Opening bills live in `bill_allocation` with `vchid IS NULL` — same
   *  table the Outstanding Report reads from, so saving here automatically
   *  surfaces them as outstanding receivables/payables without any extra
   *  UNION. The amount is signed: positive for Dr (receivable), negative
   *  for Cr (payable), matching the rest of bill_allocation's convention.
   */
  async getOpeningBills(customerId: number) {
    const customer = await this.db.queryOne<any>(
      `SELECT id, company, billbybill,
              COALESCE(opening_balance, 0)   AS opening_balance,
              opening_balance_type
       FROM customer WHERE id = ?`,
      [customerId],
    );
    if (!customer) {
      return { customer: null, bills: [], total: 0 };
    }
    const isCr = customer.opening_balance_type === 'Cr';
    const rows = await this.db.query<any>(
      `SELECT id, billname AS bill_name, bill_date, amount
       FROM bill_allocation
       WHERE ledger = ? AND vchid IS NULL
       ORDER BY bill_date ASC, id ASC`,
      [customerId],
    );
    // The DB stores signed amounts (Dr positive / Cr negative) but the
    // popup edits absolute values, so flip back to magnitude here.
    const total = rows.reduce((s: number, b: any) => s + Math.abs(Number(b.amount || 0)), 0);
    return {
      customer: {
        id: customer.id,
        company: customer.company,
        billbybill: customer.billbybill,
        opening_balance: +Number(customer.opening_balance || 0).toFixed(2),
        opening_balance_type: customer.opening_balance_type || 'Dr',
      },
      bills: rows.map((b: any) => ({
        id:        b.id,
        bill_name: b.bill_name,
        bill_date: b.bill_date,
        amount:    +Math.abs(Number(b.amount || 0)).toFixed(2),
        ref_type:  'Bill',
      })),
      total: +total.toFixed(2),
      direction: isCr ? 'Cr' : 'Dr',
    };
  }

  /** Replace the customer's opening-bill breakdown. Replace-all semantics:
   *  every existing opening row (`vchid IS NULL`) is wiped and the supplied
   *  list inserted fresh. customer.opening_balance is NOT changed here —
   *  the caller (popup) is responsible for keeping the sum aligned with
   *  the master opening before submit.
   *
   *  Sign convention: amount is stored as +value for Dr, -value for Cr,
   *  picked up from the customer's opening_balance_type so subsequent
   *  outstanding queries can sum signed columns directly. */
  async saveOpeningBills(
    customerId: number,
    bills: Array<{ bill_name: string; bill_date?: string | null; amount: number; ref_type?: 'Bill' | 'On Account' }>,
  ) {
    const cust = await this.db.queryOne<any>(
      `SELECT id, opening_balance_type FROM customer WHERE id = ?`, [customerId],
    );
    if (!cust) throw new NotFoundException('Customer not found');
    const sign = cust.opening_balance_type === 'Cr' ? -1 : 1;

    return this.db.withTransaction(async (conn) => {
      // Wipe every previous opening row for this customer. Voucher-driven
      // bill_allocation rows have vchid != NULL so they're unaffected.
      await this.db.execute(
        `DELETE FROM bill_allocation WHERE ledger = ? AND vchid IS NULL`,
        [customerId], conn,
      );
      for (const b of bills) {
        if (!b.bill_name?.trim()) continue;
        const mag = Math.abs(Number(b.amount) || 0);
        if (mag === 0) continue;
        const signed = mag * sign;
        await this.db.execute(
          `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount, bill_date)
           VALUES (NULL, NULL, ?, ?, ?, ?)`,
          [customerId, b.bill_name.trim(), signed, b.bill_date || null],
          conn,
        );
      }
      return { ok: true };
    });
  }

  async getDebugSchema() {
    try {
      const t1 = await this.db.query('DESCRIBE customer');
      const t2 = await this.db.query('DESCRIBE customer_contact_details').catch(e => [{ Field: 'Table not found: customer_contact_details' }]);
      const t3 = await this.db.query('DESCRIBE customer_contact_mapping_data').catch(e => [{ Field: 'Table not found: customer_contact_mapping_data' }]);
      return { customer: t1, customer_contact_details: t2, customer_contact_mapping_data: t3 };
    } catch (e) {
      return { error: e.message };
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 50,
    search: string = '',
    status: string = 'all',
    mappedOnly: boolean = false,
    aging: string = '',
    city: string = '',
    pincode: string = '',
    group: string = '',
    state: string = '',
    dateFrom: string = '',
    dateTo: string = '',
    lastVisitPerson: string = '',
    sortBy: string = 'lastvisitdate',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    userRole?: string,
    adminId?: number,
    userId?: string,
    adminName?: string,
    excludePendingVisits: boolean = false,
    gstinFilter: string = '',
    resellerFilter: string = '',
    activeStatusFilter: string = '',
    customerFilter: string = '',
    contactFilter: string = '',
    phoneFilter: string = '',
    emailFilter: string = '',
    areaFilter: string = '',
    minLicFilter: string = '',
    minActiveFilter: string = '',
    minNotOursFilter: string = '',
  ): Promise<{ data: Customer[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    // Inactive customers are usually hidden from OC/NOC lists. The
    // active_status filter (when set) overrides this default — pass
    // 'Inactive' to surface them, 'Active' to lock to active only.
    const conditions: string[] = [
      '(c.ledgergroup = 26 OR c.ledgergroup IS NULL)',
    ];
    const params: any[] = [];
    if (activeStatusFilter === 'Active') {
      conditions.push("(c.active_status = 'Active' OR c.active_status IS NULL)");
    } else if (activeStatusFilter === 'Inactive') {
      conditions.push("c.active_status = 'Inactive'");
    } else {
      conditions.push("(c.active_status = 'Active' OR c.active_status IS NULL)");
    }
    if (gstinFilter) {
      conditions.push('c.gstin LIKE ?');
      params.push(`%${gstinFilter.trim()}%`);
    }
    if (resellerFilter) {
      conditions.push('c.resellerid = ?');
      params.push(Number(resellerFilter));
    }
    // Column-specific filters added so the modal can target every visible
    // column. Substring match on the relevant column; min_* are numeric
    // thresholds against the same Tally subquery aliases.
    if (customerFilter) {
      conditions.push('c.company LIKE ?');
      params.push(`%${customerFilter.trim()}%`);
    }
    if (contactFilter) {
      // Match either the legacy customer.person OR the primary contact_person
      conditions.push(`(
        c.person LIKE ?
        OR EXISTS (
          SELECT 1 FROM customer_contact_details ccd2
          JOIN customer_contact_mapping_data ccmd2 ON ccd2.id = ccmd2.mobile_id AND ccmd2.customer_id = c.id
          WHERE ccd2.contact_person LIKE ? AND ccd2.status = 'Active'
        )
      )`);
      const like = `%${contactFilter.trim()}%`;
      params.push(like, like);
    }
    if (phoneFilter) {
      conditions.push(`(
        c.mobile LIKE ?
        OR EXISTS (
          SELECT 1 FROM customer_contact_details ccd3
          JOIN customer_contact_mapping_data ccmd3 ON ccd3.id = ccmd3.mobile_id AND ccmd3.customer_id = c.id
          WHERE ccd3.mobile_no LIKE ? AND ccd3.status = 'Active'
        )
      )`);
      const like = `%${phoneFilter.trim()}%`;
      params.push(like, like);
    }
    if (emailFilter) {
      conditions.push('c.email LIKE ?');
      params.push(`%${emailFilter.trim()}%`);
    }
    if (areaFilter) {
      conditions.push('c.area LIKE ?');
      params.push(`%${areaFilter.trim()}%`);
    }
    if (minLicFilter && Number(minLicFilter) > 0) {
      conditions.push(`(SELECT COUNT(*) FROM tallydetails td2 WHERE td2.customerid = CAST(c.id AS CHAR)) >= ?`);
      params.push(Number(minLicFilter));
    }
    if (minActiveFilter && Number(minActiveFilter) > 0) {
      conditions.push(`(SELECT COUNT(*) FROM tallydetails td3 WHERE td3.customerid = CAST(c.id AS CHAR) AND td3.active_status = 'Active') >= ?`);
      params.push(Number(minActiveFilter));
    }
    if (minNotOursFilter && Number(minNotOursFilter) > 0) {
      conditions.push(`(SELECT COUNT(*) FROM tallydetails td4 WHERE td4.customerid = CAST(c.id AS CHAR) AND td4.tally_status <> 'Our Tally') >= ?`);
      params.push(Number(minNotOursFilter));
    }

    if (search) {
      conditions.push(`(
        c.company LIKE ? OR
        c.email LIKE ? OR
        c.pincode LIKE ? OR
        c.mobile LIKE ? OR
        EXISTS (
          SELECT 1 FROM customer_contact_details ccd
          JOIN customer_contact_mapping_data ccmd2 ON ccd.id = ccmd2.mobile_id AND ccmd2.customer_id = c.id
          WHERE ccd.contact_person LIKE ? OR ccd.mobile_no LIKE ?
        ) OR
        EXISTS (
          SELECT 1 
          FROM cloud_mappings cm 
          JOIN cloud_servers cs ON cm.server_id = cs.id 
          WHERE cm.customer_id = c.id 
          AND (cs.customer_ip LIKE ? OR cs.server_ip LIKE ? OR cm.serial_no LIKE ?)
        )
      )`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (city) {
      conditions.push(`EXISTS (SELECT 1 FROM pincode pvf WHERE pvf.pincode = c.pincode AND pvf.city LIKE ?)`);
      params.push(`%${city}%`);
    }

    if (pincode) {
      conditions.push(`c.pincode LIKE ?`);
      params.push(`%${pincode}%`);
    }

    if (group) {
      conditions.push(`(u.name LIKE ? OR cu.name LIKE ?)`);
      params.push(`%${group}%`, `%${group}%`);
    }

    if (state) {
      conditions.push(`s.name LIKE ?`);
      params.push(`%${state}%`);
    }

    if (dateFrom) {
      conditions.push(`COALESCE((SELECT MAX(visit_date) FROM cloud_visits WHERE customer_id = c.id AND status = 'Completed'), c.lastvisitdate) >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`COALESCE((SELECT MAX(visit_date) FROM cloud_visits WHERE customer_id = c.id AND status = 'Completed'), c.lastvisitdate) <= ?`);
      params.push(dateTo);
    }

    if (lastVisitPerson) {
      conditions.push(`(
        (SELECT user_name FROM cloud_visits WHERE customer_id = c.id AND status = 'Completed' ORDER BY check_out_time DESC LIMIT 1) LIKE ?
        OR (SELECT name FROM admin WHERE id = CAST(c.lastvisitperson AS UNSIGNED)) LIKE ?
        OR (SELECT name FROM cloud_users WHERE id = c.lastvisitperson) LIKE ?
      )`);
      params.push(`%${lastVisitPerson}%`, `%${lastVisitPerson}%`, `%${lastVisitPerson}%`);
    }

    if (status === 'Active' || status === 'Our Customer') {
      conditions.push(`c.status = 'Active'`);
    } else if (status === 'Others' || status === 'Not Our Customer') {
      conditions.push(`(c.status != 'Active' OR c.status IS NULL)`);
    } else if (status.startsWith('Visit Pending')) {
      const pendingCondition = `(
        EXISTS (SELECT 1 FROM cloud_tdl_tasks t JOIN cloud_tdl_requirements r ON t.req_id = r.id JOIN cloud_tdl_master m ON r.tdl_id = m.id WHERE m.customer_id = c.id AND t.status = 'Pending' AND r.requirement = 'Customer Visit') 
        OR EXISTS (SELECT 1 FROM cloud_visits v WHERE v.customer_id = c.id AND v.status IN ('Pending', 'In Progress', 'Paused'))
      )`;
      if (status === 'Visit Pending - Our Customer') {
        conditions.push(`${pendingCondition} AND c.status = 'Active'`);
      } else if (status === 'Visit Pending - Not Our Customer') {
        conditions.push(`${pendingCondition} AND (c.status != 'Active' OR c.status IS NULL)`);
      } else {
        conditions.push(pendingCondition);
      }
    }

    if (mappedOnly) {
      conditions.push(`EXISTS (SELECT 1 FROM cloud_mappings cm WHERE cm.customer_id = c.id AND cm.status = 'Active')`);
    }

    // Visit Dashboard: hide customers that already have a pending Connect visit
    // (Pending / In Progress / Paused). Keeps the queue focused on "needs visit"
    // customers and prevents double-assignment.
    if (excludePendingVisits) {
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM cloud_visits vex
        WHERE vex.customer_id = c.id
          AND vex.status IN ('Pending', 'In Progress', 'Paused')
      )`);
    }

    if (aging && parseInt(aging) > 0) {
      conditions.push(`c.lastvisitdate <= DATE_SUB(NOW(), INTERVAL ? DAY)`);
      params.push(parseInt(aging));
    }

    if (userRole && userRole.toLowerCase() !== 'admin') {
      // Filter by cloud_group_id using the logged-in user's cloud user ID
      if (userId) {
        conditions.push('c.cloud_group_id = ?');
        params.push(userId);
      } else {
        // No userId found — show nothing to prevent cross-group data leak
        conditions.push('1 = 0');
        console.warn(`[GROUP FILTER] No userId for filtering — blocking all results`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM customer c
      LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
      LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
      LEFT JOIN pincode pv ON c.pincode = pv.pincode
      LEFT JOIN state s ON pv.stateid = s.id
      ${whereClause}
    `;

    const countResult = await this.db.queryOne<{ total: number }>(countQuery, params);


    const data = await this.db.query<any>(`
      SELECT c.*, ANY_VALUE(COALESCE(u.name, cu.name)) as group_name, ANY_VALUE(s.name) as state_name,
      ANY_VALUE(ccd.contact_person) as person,
      ANY_VALUE(COALESCE(ccd.mobile_no, c.mobile)) as mobile,
      ANY_VALUE(COALESCE(cv.user_name, lvu.name, lva.name)) as lastvisitperson_name,
      ANY_VALUE(COALESCE(lcu.name, lca.name)) as lastcallperson_name,
      ANY_VALUE(pv.city) as pincode_city,
      ANY_VALUE(cv.check_out_remark) as lastvisitremark,
      ANY_VALUE(COALESCE(cv.check_out_time, c.lastvisitdate)) as lastvisitdate,
      ANY_VALUE(COALESCE(DATEDIFF(NOW(), COALESCE(cv.check_out_time, c.lastvisitdate)), 999)) as aging_days,
      ANY_VALUE(r.name) as reseller_name,
      -- Tally serial counts via a single pre-aggregated LEFT JOIN below
      -- (much faster than 3× correlated subqueries on an unindexed column).
      ANY_VALUE(tl.total_licenses)    AS total_licenses,
      ANY_VALUE(tl.active_licenses)   AS active_licenses,
      ANY_VALUE(tl.not_ours_licenses) AS not_ours_licenses,
      (SELECT v.scheduled_date FROM cloud_visits v WHERE v.customer_id = c.id AND v.status IN ('Pending', 'In Progress', 'Paused') ORDER BY v.scheduled_date ASC LIMIT 1) as pending_visit_date,
      (SELECT user_name FROM cloud_visits WHERE customer_id = c.id AND status IN ('Pending', 'In Progress', 'Paused') ORDER BY created_at DESC LIMIT 1) as pending_visit_person
      FROM customer c
      LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
      LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
      LEFT JOIN pincode pv ON c.pincode = pv.pincode
      LEFT JOIN state s ON pv.stateid = s.id
      LEFT JOIN reseller r ON c.resellerid = r.id
      LEFT JOIN (
        SELECT customerid,
               COUNT(*) AS total_licenses,
               SUM(CASE WHEN active_status = 'Active' THEN 1 ELSE 0 END) AS active_licenses,
               SUM(CASE WHEN tally_status <> 'Our Tally' THEN 1 ELSE 0 END) AS not_ours_licenses
        FROM tallydetails
        GROUP BY customerid
      ) tl ON tl.customerid = CAST(c.id AS CHAR)
      LEFT JOIN (
        SELECT customer_id, mobile_id,
          ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY CASE WHEN primary_contact = 'Yes' THEN 0 ELSE 1 END, id) as rn
        FROM customer_contact_mapping_data
        WHERE status = 'Active'
      ) prim_ccm ON c.id = prim_ccm.customer_id AND prim_ccm.rn = 1
      LEFT JOIN customer_contact_details ccd ON prim_ccm.mobile_id = ccd.id
      LEFT JOIN (SELECT customer_id, MAX(check_out_time) as max_visit, MAX(id) as last_visit_id FROM cloud_visits WHERE status = 'Completed' GROUP BY customer_id) last_visit ON c.id = last_visit.customer_id
      LEFT JOIN cloud_visits cv ON last_visit.last_visit_id = cv.id
      LEFT JOIN cloud_users lvu ON cv.user_name = lvu.name
      LEFT JOIN admin lva ON cv.user_name = lva.name
      LEFT JOIN (SELECT customer_id, MAX(id) as last_call_id FROM cloud_customer_calls GROUP BY customer_id) last_call ON c.id = last_call.customer_id
      LEFT JOIN cloud_customer_calls lc ON last_call.last_call_id = lc.id
      LEFT JOIN cloud_users lcu ON lc.user_name = lcu.name
      LEFT JOIN admin lca ON lc.user_name = lca.name
      ${whereClause}
      GROUP BY c.id
      ORDER BY ${(() => {
        const order = sortOrder === 'DESC' ? 'DESC' : 'ASC';
        // Whitelist of sortable columns. Each maps to the underlying SQL
        // expression (alias or qualified column). Unknown keys fall back to
        // company name to keep the SQL safe.
        let primary: string;
        switch (sortBy) {
          case 'company':            primary = `c.company ${order}`; break;
          case 'group':              primary = `group_name ${order}`; break;
          case 'reseller':           primary = `reseller_name ${order}`; break;
          case 'person':
          case 'contact':            primary = `person ${order}`; break;
          case 'mobile':
          case 'phone':              primary = `mobile ${order}`; break;
          case 'email':              primary = `c.email ${order}`; break;
          case 'pincode':            primary = `c.pincode ${order}`; break;
          case 'area':               primary = `c.area ${order}`; break;
          case 'state':              primary = `state_name ${order}`; break;
          case 'gstin':              primary = `c.gstin ${order}`; break;
          case 'status':             primary = `c.status ${order}`; break;
          case 'aging_days':         primary = `aging_days ${order}`; break;
          case 'last_visit_date':
          case 'lastvisitdate':      primary = `lastvisitdate ${order}`; break;
          case 'pending_visit_date': primary = `pending_visit_date ${order}`; break;
          default:                   primary = `c.company ${order}`; break;
        }
        // Always tie-break by company then id so pagination is deterministic
        // — without this, ties (especially NULLs) reshuffle between pages and
        // the user perceives "broken / gappy" sort.
        return sortBy === 'company'
          ? `${primary}, c.id ASC`
          : `${primary}, c.company ASC, c.id ASC`;
      })()}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return {
      data: data.map(c => ({
        ...c,
        state_original_id: c.state,
        state: c.state_name || '-',
        city: c.pincode_city || c.city || '',
        area: c.pincode_city || c.area || '-',
        total_licenses: Number(c.total_licenses || 0),
        active_licenses: Number(c.active_licenses || 0)
      })),
      total: countResult?.total || 0,
      page: Number(page),
      limit: Number(limit)
    };
  }


  // Check uniqueness for company, email, gstin
  private async checkUniqueness(field: string, value: string, excludeId?: number): Promise<void> {
    let query = `SELECT id FROM customer WHERE ${field} = ?`;
    const params: any[] = [value];
    if (excludeId) {
      query += ' AND id != ?';
      params.push(excludeId);
    }
    const existing = await this.db.queryOne(query, params);
    if (existing) {
      throw new ConflictException(`${field.charAt(0).toUpperCase() + field.slice(1)} "${value}" already exists`);
    }
  }

  async create(data: Partial<Customer>): Promise<Customer> {
    if (!data.company) throw new BadRequestException('Company name is required');
    if (!data.email) throw new BadRequestException('Email is required');
    // GSTIN is optional

    await this.checkUniqueness('company', data.company);
    if (data.email) await this.checkUniqueness('email', data.email);
    if (data.gstin) await this.checkUniqueness('gstin', data.gstin);

    let stateId = data.state;
    let area = data.area;

    if (data.pincode) {
      const fullPinData: any = await this.db.queryOne('SELECT p.city, p.stateid FROM pincode p WHERE p.pincode = ?', [data.pincode]);
      if (fullPinData) {
        stateId = fullPinData.stateid;
        area = fullPinData.city;
      }
    }

    // Auto-fill group fields from cloud_user if cloud_group_id is provided
    let autoGroup = data.group;
    let autoSubgroupId: string | null = null;
    const cloudGroupId = (data as any).cloud_group_id;
    if (cloudGroupId) {
      const cloudUser = await this.db.queryOne<any>(
        `SELECT old_id, sub_user_id FROM cloud_users WHERE id = ?`,
        [cloudGroupId]
      );
      if (cloudUser) {
        if (cloudUser.old_id) autoGroup = cloudUser.old_id;
        if (cloudUser.sub_user_id) autoSubgroupId = cloudUser.sub_user_id;
      }
    }

    // 1. Reseller Logic: Find or Create
    let resellerId = null;
    if (data.reseller) {
      const existingReseller = await this.db.queryOne('SELECT id FROM reseller WHERE name = ?', [data.reseller]);
      if (existingReseller) {
        resellerId = existingReseller.id;
      } else {
        const resReseller = await this.db.execute(
          'INSERT INTO reseller (name, mobile, email, pan, address, date) VALUES (?, ?, ?, ?, ?, ?)',
          [data.reseller, '', '', '', '', new Date().toISOString().slice(0, 10)]
        );
        resellerId = resReseller.insertId;
      }
    }

    // 2. Insert Customer
    const result = await this.db.execute(`
      INSERT INTO customer (
        company, \`group\`, cloud_group_id, subgroupid, customerid, address1, address2, address3,
        pincode, area, state, city, gstin, email, mobile, person, remarks, status, date,
        designation, whatsapp, tally, btype, grade, resellerid
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)
    `, [
      data.company,
      autoGroup || data.group || 3,
      cloudGroupId || null,
      autoSubgroupId || null,
      data.customerid || null,
      data.address1 || null,
      data.address2 || null,
      data.address3 || null,
      data.pincode || null,
      area || null,
      stateId || null,
      data.city || null,
      data.gstin || null,
      data.email || null,
      null, // mobile stored in customer_contact_details via syncPrimaryContact (customer.mmobile has unique constraint)
      data.person || null,
      data.remarks || null,
      data.status || 'Active',
      data.designation || null,
      data.whatsapp || null,
      data.tally || null,
      data.btype || null,
      data.grade || null,
      resellerId
    ]);

    const newId = result.insertId;

    // 3. Sync Contact Mapping
    if (data.mobile && data.person) {
      await this.syncPrimaryContact(newId, data.person, data.mobile);
    }

    return this.findById(newId);
  }

  // List inactive customers (for the admin-only Inactive Customers page).
  async findInactive(opts: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: 'ASC' | 'DESC' }) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(200, Math.max(1, opts.limit || 50));
    const offset = (page - 1) * limit;
    const search = (opts.search || '').trim();

    const where: string[] = ["c.active_status = 'Inactive'"];
    const params: any[] = [];
    if (search) {
      where.push(`(c.company LIKE ? OR c.email LIKE ? OR c.gstin LIKE ? OR c.mobile LIKE ? OR c.pincode LIKE ?)`);
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    const whereSql = where.join(' AND ');

    const sortByMap: Record<string, string> = {
      company: 'c.company', email: 'c.email', gstin: 'c.gstin', pincode: 'c.pincode',
    };
    const sortBy = sortByMap[opts.sortBy || 'company'] || 'c.company';
    const sortOrder = opts.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM customer c WHERE ${whereSql}`,
      params,
    );
    const data = await this.db.query<any>(
      `SELECT c.id, c.company, c.email, c.gstin, c.mobile, c.person, c.pincode, c.area,
              c.status AS oc_noc_status, c.active_status
       FROM customer c
       WHERE ${whereSql}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { data, total: Number(totalRow?.total || 0), page, limit };
  }

  // Reactivate an inactive customer (admin-only) — flips active_status back to 'Active'.
  async reactivate(id: number): Promise<void> {
    await this.findById(id); // 404 if not found
    await this.db.execute(`UPDATE customer SET active_status = 'Active' WHERE id = ?`, [id]);
  }

  // Paginated, filterable history (calls / visits / service calls) for one customer.
  // Used by the "Last Connect / Last Visit / Service Call" popups in Customer Search.
  async getHistory(
    customerId: number,
    opts: { type: 'call' | 'visit' | 'service'; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const offset = (page - 1) * limit;
    const search = (opts.search || '').trim();
    const dateFrom = opts.dateFrom || '';
    const dateTo = opts.dateTo || '';

    if (opts.type === 'service') {
      const where: string[] = ['sc.customer_id = ?'];
      const params: any[] = [customerId];

      if (search) {
        where.push(`(sc.contact_person LIKE ? OR sc.mobile_no LIKE ? OR sc.remark LIKE ? OR sc.taken_by LIKE ? OR sc.service_type LIKE ?)`);
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
      }
      if (dateFrom) { where.push('DATE(sc.created_at) >= ?'); params.push(dateFrom); }
      if (dateTo)   { where.push('DATE(sc.created_at) <= ?'); params.push(dateTo); }

      const whereSql = where.join(' AND ');
      const totalRow = await this.db.queryOne<{ total: number }>(
        `SELECT COUNT(*) as total FROM service_calls sc WHERE ${whereSql}`,
        params,
      );
      const data = await this.db.query<any>(
        `SELECT sc.*, sm.name as flavor_name
         FROM service_calls sc
         LEFT JOIN singlemaster sm ON sc.flavor = sm.id
         WHERE ${whereSql}
         ORDER BY sc.created_at DESC, sc.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
      return { data, total: Number(totalRow?.total || 0), page, limit };
    }

    // call or visit (visit_type = 'Call' | 'Visit')
    const visitType = opts.type === 'call' ? 'Call' : 'Visit';
    const where: string[] = ['v.customer_id = ?', 'v.visit_type = ?'];
    const params: any[] = [customerId, visitType];

    if (search) {
      where.push(`(v.user_name LIKE ? OR v.check_out_remark LIKE ? OR v.phone_no LIKE ? OR v.status LIKE ?)`);
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (dateFrom) {
      where.push(`DATE(COALESCE(v.scheduled_date, v.check_out_time, v.check_in_time, v.created_at)) >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push(`DATE(COALESCE(v.scheduled_date, v.check_out_time, v.check_in_time, v.created_at)) <= ?`);
      params.push(dateTo);
    }

    const whereSql = where.join(' AND ');
    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM cloud_visits v WHERE ${whereSql}`,
      params,
    );
    const data = await this.db.query<any>(
      `SELECT v.* FROM cloud_visits v
       WHERE ${whereSql}
       ORDER BY COALESCE(v.check_out_time, v.scheduled_date, v.created_at) DESC, v.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { data, total: Number(totalRow?.total || 0), page, limit };
  }

  async update(id: number, data: Partial<Customer>): Promise<Customer> {
    const existing = await this.findById(id);

    if (data.company && data.company !== existing.company) await this.checkUniqueness('company', data.company, id);
    if (data.email && data.email !== existing.email) await this.checkUniqueness('email', data.email, id);
    if (data.gstin && data.gstin !== existing.gstin) await this.checkUniqueness('gstin', data.gstin, id);

    let stateId = data.state;
    let area = data.area;

    if (data.pincode) {
      const fullPinData: any = await this.db.queryOne('SELECT p.city, p.stateid FROM pincode p WHERE p.pincode = ?', [data.pincode]);
      if (fullPinData) {
        stateId = fullPinData.stateid;
        area = fullPinData.city;
      }
    }

    // Auto-fill group fields from cloud_user if cloud_group_id is provided
    const cloudGroupId = (data as any).cloud_group_id;
    let autoGroup = data.group;
    let autoSubgroupId: string | null = null;
    if (cloudGroupId) {
      const cloudUser = await this.db.queryOne<any>(
        `SELECT old_id, sub_user_id FROM cloud_users WHERE id = ?`,
        [cloudGroupId]
      );
      if (cloudUser) {
        if (cloudUser.old_id) autoGroup = cloudUser.old_id;
        if (cloudUser.sub_user_id) autoSubgroupId = cloudUser.sub_user_id;
      }
    }

    const fields: string[] = [];
    const values: any[] = [];

    // Fields mapping
    const map: Record<string, any> = {
      company: data.company,
      'group': autoGroup !== undefined ? autoGroup : data.group,
      cloud_group_id: cloudGroupId || undefined,
      subgroupid: autoSubgroupId || undefined,
      customerid: data.customerid,
      address1: data.address1,
      address2: data.address2,
      address3: data.address3,
      pincode: data.pincode,
      area: area,
      state: stateId,
      city: data.city,
      gstin: data.gstin,
      email: data.email,
      // mobile stored in customer_contact_details via syncPrimaryContact (customer.mmobile has unique constraint)
      person: data.person,
      remarks: data.remarks,
      status: data.status,
      active_status: (data as any).active_status,
      designation: data.designation,
      whatsapp: data.whatsapp,
      tally: data.tally,
      btype: data.btype,
      grade: data.grade,
      resellerid: data.resellerid,
    };

    for (const [key, val] of Object.entries(map)) {
      if (val !== undefined) {
        fields.push(`\`${key}\` = ?`); // wrap key in quotes for reserved words like group
        values.push(val);
      }
    }

    if ((data as any).active_status === 'Inactive') {
      fields.push('deactivated_at = NOW()');
    } else if ((data as any).active_status === 'Active') {
      fields.push('deactivated_at = NULL');
    }

    if (fields.length > 0) {
      values.push(id);
      await this.db.execute(`UPDATE customer SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    // Sync Contact
    if (data.mobile && data.person) {
      await this.syncPrimaryContact(id, data.person, data.mobile);
    }

    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.findById(id);
    await this.db.execute(`DELETE FROM customer WHERE id = ?`, [id]);
  }

  async createContact(customerId: number, data: { contact_person: string; mobile_no: string; primary_contact?: string }): Promise<any> {
    // 1. Check if contact already exists
    let contact = await this.db.queryOne<any>(
      `SELECT id FROM customer_contact_details WHERE mobile_no = ?`,
      [data.mobile_no]
    );

    let contactId: number;

    if (contact) {
      contactId = contact.id;
      await this.db.execute(
        `UPDATE customer_contact_details SET contact_person = ?, status = 'Active' WHERE id = ?`,
        [data.contact_person, contactId]
      );
    } else {
      const result = await this.db.execute(
        `INSERT INTO customer_contact_details (contact_person, mobile_no, status) VALUES (?, ?, 'Active')`,
        [data.contact_person, data.mobile_no]
      );
      contactId = result.insertId;
    }

    // 2. Unset previous primary contacts if current is 'Yes'
    if (data.primary_contact === 'Yes') {
      await this.db.execute(
        `UPDATE customer_contact_mapping_data SET primary_contact = 'No' WHERE customer_id = ? AND primary_contact = 'Yes'`,
        [customerId]
      );
    }

    // 3. Link or update mapping
    const mapping = await this.db.queryOne<any>(
      `SELECT id FROM customer_contact_mapping_data WHERE customer_id = ? AND mobile_id = ?`,
      [customerId, contactId]
    );

    if (mapping) {
      await this.db.execute(
        `UPDATE customer_contact_mapping_data SET primary_contact = ?, status = 'Active' WHERE id = ?`,
        [data.primary_contact || 'No', mapping.id]
      );
    } else {
      await this.db.execute(
        `INSERT INTO customer_contact_mapping_data (customer_id, mobile_id, primary_contact, status) VALUES (?, ?, ?, 'Active')`,
        [customerId, contactId, data.primary_contact || 'No']
      );
    }

    return { id: contactId, ...data };
  }

  async autocomplete(query: string, cloudGroupId?: string | null | 'BLOCK'): Promise<any[]> {
    if (!query || query.trim().length < 2) return [];
    // If group filtering is required but no userId found, block all results
    if (cloudGroupId === 'BLOCK') return [];
    const searchTerm = query.trim();
    const searchWildcard = `%${searchTerm}%`;

    const params: any[] = [searchWildcard];
    let groupFilter = '';
    if (cloudGroupId) {
      groupFilter = 'AND c.cloud_group_id = ?';
      params.push(cloudGroupId);
    }

    return this.db.query(`
      SELECT c.id, c.company, c.cloud_group_id, c.subgroupid, c.\`group\`, c.ledgergroup,
        c.pincode, s.name as state_name, c.billbybill,
        c.resellerid, r.name AS reseller_name
      FROM customer c
      LEFT JOIN pincode pv ON c.pincode = pv.pincode
      LEFT JOIN state s ON pv.stateid = s.id
      LEFT JOIN reseller r ON c.resellerid = r.id
      WHERE c.status IN ('Active', 'Not Our Customer')
        AND c.company LIKE ?
        ${groupFilter}
      ORDER BY c.company
      LIMIT 15
    `, params);
  }

  async searchAllLedgers(query: string, allowedGroupIds: number[] = []): Promise<any[]> {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim();
    const groupFilter = allowedGroupIds.length > 0
      ? `AND c.ledgergroup IN (${allowedGroupIds.map(() => '?').join(',')})`
      : '';
    const params = allowedGroupIds.length > 0
      ? [`%${q}%`, ...allowedGroupIds, q, q]
      : [`%${q}%`, q, q];
    return this.db.query(
      `SELECT c.id, c.company, c.ledgergroup, c.billbybill,
              lg.name AS ledgergroup_name
       FROM customer c
       LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
       WHERE c.company LIKE ? ${groupFilter}
       ORDER BY
         CASE
           WHEN UPPER(c.company) = UPPER(?)                   THEN 0
           WHEN UPPER(c.company) LIKE UPPER(CONCAT(?, '%'))   THEN 1
           ELSE 2
         END,
         c.company
       LIMIT 50`,
      params
    );
  }

  async getForDropdown(): Promise<any[]> {
    return this.db.query(`
      SELECT c.id, c.company, c.customerid, c.group
      FROM customer c
      WHERE c.status IN ('Active', 'Not Our Customer')
      GROUP BY c.id
      ORDER BY c.company
    `);
  }

  async findAllResellers(): Promise<any[]> {
    return this.db.query('SELECT DISTINCT id, name FROM reseller ORDER BY name ASC');
  }


  // Comprehensive search returning all customer-related data, gated by permissions
  async searchDetail(search: string, searchType: string, permissions: any, isAdmin: boolean, cloudGroupId?: string | null): Promise<any> {
    if (!search || !search.trim()) return { customers: [] };
    // If group filtering required but no userId, block
    if (cloudGroupId === 'BLOCK') return { customers: [] };

    // Step 1: Find matching customer IDs
    let customerIds: number[] = [];

    if (searchType === 'id') {
      const id = parseInt(search);
      if (!isNaN(id)) customerIds = [id];
    } else if (searchType === 'company') {
      const rows = await this.db.query<any>(
        `SELECT id FROM customer WHERE company LIKE ? LIMIT 50`,
        [`%${search}%`]
      );
      customerIds = rows.map((r: any) => r.id);
    } else if (searchType === 'person') {
      // Search in customer.person field
      const rows = await this.db.query<any>(
        `SELECT id FROM customer WHERE person LIKE ? LIMIT 50`,
        [`%${search}%`]
      );
      customerIds = rows.map((r: any) => r.id);
      // Also search in customer_contact_details.contact_person (active contacts only)
      const rows2 = await this.db.query<any>(
        `SELECT DISTINCT ccm.customer_id as id
         FROM customer_contact_details ccd
         JOIN customer_contact_mapping_data ccm ON ccd.id = ccm.mobile_id
         WHERE ccd.contact_person LIKE ? AND ccd.status = 'Active' LIMIT 50`,
        [`%${search}%`]
      );
      const ids2 = rows2.map((r: any) => Number(r.id)).filter(Boolean);
      customerIds = [...new Set([...customerIds, ...ids2])];
    } else if (searchType === 'serial') {
      // Search in tallydetails by tallyserial
      const rows = await this.db.query<any>(
        `SELECT DISTINCT CAST(td.customerid AS UNSIGNED) as id
         FROM tallydetails td WHERE td.tallyserial LIKE ? AND td.customerid IS NOT NULL AND td.customerid != 0 LIMIT 10`,
        [`%${search}%`]
      );
      customerIds = rows.map((r: any) => Number(r.id)).filter(Boolean);
      // Also search in clouddetails by cloud_serial
      const rows2 = await this.db.query<any>(
        `SELECT DISTINCT CAST(cd.customerid AS UNSIGNED) as id
         FROM clouddetails cd WHERE cd.cloud_serial LIKE ? AND cd.customerid IS NOT NULL AND cd.customerid != 0 LIMIT 10`,
        [`%${search}%`]
      );
      const ids2 = rows2.map((r: any) => Number(r.id)).filter(Boolean);
      // Also search in cloud_mappings by serial_no
      const rows3 = await this.db.query<any>(
        `SELECT DISTINCT customer_id as id FROM cloud_mappings WHERE serial_no LIKE ? LIMIT 10`,
        [`%${search}%`]
      );
      const ids3 = rows3.map((r: any) => Number(r.id)).filter(Boolean);
      customerIds = [...new Set([...customerIds, ...ids2, ...ids3])];
    } else if (searchType === 'mobile') {
      // Search in customer_contact_details → customer_contact_mapping_data (active only)
      const rows = await this.db.query<any>(
        `SELECT DISTINCT ccm.customer_id as id
         FROM customer_contact_details ccd
         JOIN customer_contact_mapping_data ccm ON ccd.id = ccm.mobile_id
         WHERE ccd.mobile_no LIKE ? AND ccd.status = 'Active' LIMIT 20`,
        [`%${search}%`]
      );
      customerIds = rows.map((r: any) => Number(r.id)).filter(Boolean);
      // Also search directly in customer.mobile
      const rows2 = await this.db.query<any>(
        `SELECT id FROM customer WHERE mobile LIKE ? LIMIT 20`,
        [`%${search}%`]
      );
      const ids2 = rows2.map((r: any) => r.id);
      customerIds = [...new Set([...customerIds, ...ids2])];
    } else if (searchType === 'email') {
      const rows = await this.db.query<any>(
        `SELECT id FROM customer WHERE email LIKE ? LIMIT 50`,
        [`%${search}%`]
      );
      customerIds = rows.map((r: any) => r.id);
      // Also search in customer_contact_details.email if exists
      try {
        const rows2 = await this.db.query<any>(
          `SELECT DISTINCT ccm.customer_id as id
           FROM customer_contact_details ccd
           JOIN customer_contact_mapping_data ccm ON ccd.id = ccm.mobile_id
           WHERE ccd.email LIKE ? AND ccd.status = 'Active' LIMIT 20`,
          [`%${search}%`]
        );
        const ids2 = rows2.map((r: any) => Number(r.id)).filter(Boolean);
        customerIds = [...new Set([...customerIds, ...ids2])];
      } catch {
        // email column may not exist in contact details - ignore
      }
    }

    if (customerIds.length === 0) return { customers: [] };

    // Filter by group if required
    if (cloudGroupId) {
      const placeholders = customerIds.map(() => '?').join(',');
      const filtered = await this.db.query<any>(
        `SELECT id FROM customer WHERE id IN (${placeholders}) AND cloud_group_id = ?`,
        [...customerIds, cloudGroupId]
      );
      customerIds = filtered.map((r: any) => r.id);
      if (customerIds.length === 0) return { customers: [] };
    }

    // Expand to include all mapped/linked companies
    const expandedIds = new Set<number>(customerIds);
    for (const cid of customerIds) {
      // Get this customer's mappingid
      const cust = await this.db.queryOne<any>('SELECT mappingid FROM customer WHERE id = ?', [cid]);
      if (cust) {
        const mid = cust.mappingid;
        // Case 1: This customer has a non-zero mappingid → find siblings
        if (mid && mid !== '0' && mid !== '') {
          const siblings = await this.db.query<any>(
            'SELECT id FROM customer WHERE mappingid = ? OR id = CAST(? AS UNSIGNED)',
            [mid, mid]
          );
          siblings.forEach((s: any) => expandedIds.add(s.id));
        }
        // Case 2: Other customers have mappingid = this customer's id
        const children = await this.db.query<any>(
          'SELECT id FROM customer WHERE mappingid = CAST(? AS CHAR)',
          [cid]
        );
        children.forEach((c: any) => expandedIds.add(c.id));
      }
    }
    customerIds = [...expandedIds];

    const results: any[] = [];

    for (const customerId of customerIds) {
      const entry: any = { id: customerId };

      // Customer Details
      const canViewCustomer = isAdmin || permissions?.customers_our?.view || permissions?.customers_not_our?.view || permissions?.customer_search?.view;
      if (canViewCustomer) {
        try {
          const customer = await this.db.queryOne<any>(`
            SELECT c.*, COALESCE(u.name, cu.name) as group_name,
            ps.name as state_name,
            pv.city as pincode_city,
            ccd.contact_person as primary_person,
            ccd.mobile_no as primary_mobile,
            r.name AS reseller_name
            FROM customer c
            LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
            LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
            LEFT JOIN pincode pv ON c.pincode = pv.pincode
            LEFT JOIN state ps ON pv.stateid = ps.id
            LEFT JOIN reseller r ON c.resellerid = r.id
            LEFT JOIN (
              SELECT ccm.customer_id, ccm.mobile_id,
                ROW_NUMBER() OVER (PARTITION BY ccm.customer_id ORDER BY CASE WHEN ccm.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccm.id ASC) as rn
              FROM customer_contact_mapping_data ccm
              WHERE ccm.status = 'Active'
            ) prim ON prim.customer_id = c.id AND prim.rn = 1
            LEFT JOIN customer_contact_details ccd ON ccd.id = prim.mobile_id AND ccd.status = 'Active'
            WHERE c.id = ?
          `, [customerId]);
          entry.details = customer ? {
            ...customer,
            state: customer.state_name,
            city: customer.pincode_city || customer.city || customer.area,
            person: customer.primary_person || customer.person,
            mobile: customer.primary_mobile || customer.mobile,
          } : null;

          // Mapped Companies: find all customers sharing the same mappingid group
          if (customer) {
            const trueMappingId = customer.mappingid && customer.mappingid !== 0 && customer.mappingid !== '0' ? customer.mappingid : customer.id;

            const mappedCompanies = await this.db.query<any>(`
              SELECT c.id, c.company, COALESCE(u.name, cu.name) as group_name, c.resellerid, c.status, c.btype,
                c.email, c.gstin, c.pincode, c.mappingid,
                pv.city as city,
                ps.name as state,
                CASE WHEN c.id = CAST(? AS UNSIGNED) THEN 'Primary' ELSE 'Mapped' END as mapping_status
              FROM customer c
              LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
              LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
              LEFT JOIN pincode pv ON c.pincode = pv.pincode
              LEFT JOIN state ps ON pv.stateid = ps.id
              WHERE (c.mappingid = ? OR c.id = CAST(? AS UNSIGNED))
              AND c.id != ?
              ORDER BY c.company
            `, [trueMappingId, trueMappingId, trueMappingId, customerId]);

            const seen = new Set<number>();
            entry.mappedCompanies = mappedCompanies.filter(m => {
              if (seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
          }
        } catch (e: any) { console.error('searchDetail customer details error:', e.message); entry.details = null; entry.mappedCompanies = []; }
      }

      // Build list of all IDs in this customer's mapped group (for aggregated queries)
      const allGroupIds: number[] = [customerId];
      if (entry.mappedCompanies && entry.mappedCompanies.length > 0) {
        entry.mappedCompanies.forEach((mc: any) => allGroupIds.push(mc.id));
      }
      const placeholders = allGroupIds.map(() => '?').join(',');

      // Customer Contacts (across all mapped companies)
      if (canViewCustomer) {
        try {
          entry.contacts = await this.db.query<any>(`
            SELECT ccd.id, ccd.contact_person, ccd.mobile_no, ccm.primary_contact, ccm.status,
              c.company as customer_name, ccm.customer_id
            FROM customer_contact_mapping_data ccm
            JOIN customer_contact_details ccd ON ccm.mobile_id = ccd.id
            LEFT JOIN customer c ON ccm.customer_id = c.id
            WHERE ccm.customer_id IN (${placeholders})
            ORDER BY ccm.primary_contact DESC, ccd.id ASC
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail contacts error:', e.message); entry.contacts = []; }
      }

      // Tally Details (across all mapped companies)
      const canViewMappings = isAdmin || permissions?.mappings?.view || permissions?.customer_search?.view;
      if (canViewMappings) {
        try {
          entry.tallyDetails = await this.db.query<any>(`
            SELECT td.id, td.tallyserial, td.tallyexpirydate as expiry_date,
              td.active_status, td.tally_status, td.tallyflavor, sm.name as flavor_name, td.tallyrelease,
              td.reneval as renewal, td.mau, td.qau, td.remark,
              c.company as customer_name
            FROM tallydetails td
            LEFT JOIN customer c ON CAST(td.customerid AS UNSIGNED) = c.id
            LEFT JOIN singlemaster sm ON td.tallyflavor = sm.id
            WHERE CAST(td.customerid AS UNSIGNED) IN (${placeholders})
            ORDER BY td.id DESC
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail tallyDetails error:', e.message); entry.tallyDetails = []; }
      }

      // Cloud Details (across all mapped companies)
      if (canViewMappings) {
        try {
          entry.cloudDetails = await this.db.query<any>(`
            SELECT cd.id, cd.cloud_serial, cd.cloud_act as activation_date,
              cd.cloud_expiry as expiry_date, cd.cloud_users as no_of_users,
              cd.cloud_rate as rate, cd.cloud_type, cd.cloud_period as billing_cycle,
              cd.active_status, cd.cloud_username, cd.cloud_password,
              c.company as customer_name
            FROM clouddetails cd
            LEFT JOIN customer c ON CAST(cd.customerid AS UNSIGNED) = c.id
            WHERE CAST(cd.customerid AS UNSIGNED) IN (${placeholders})
            ORDER BY cd.cloud_expiry DESC
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail cloudDetails error:', e.message); entry.cloudDetails = []; }
      }

      // Cloud Mappings / server details (across all mapped companies)
      if (canViewMappings) {
        try {
          const rawMappings = await this.db.query<any>(`
            SELECT cm.id, cm.server_id, cm.serial_no, cm.billed_users,
              cm.purchase_users, cm.status, cm.billing_cycle, cm.billing_mode,
              cm.billing_rate, cm.purchase_rate, cm.expiry_date, cm.mapped_at,
              cs.server_ip, cs.customer_ip, cs.company as server_company, cs.port,
              cs.admin_username, cs.admin_password_enc,
              c.company as customer_name
            FROM cloud_mappings cm
            LEFT JOIN cloud_servers cs ON cm.server_id = cs.id
            LEFT JOIN customer c ON cm.customer_id = c.id
            WHERE cm.customer_id IN (${placeholders})
            ORDER BY cm.expiry_date DESC
          `, allGroupIds);

          const { decryptPassword } = await import('../utils/crypto.util');
          entry.cloudMappings = rawMappings.map(row => {
            let decryptedPass = null;
            if (row.admin_password_enc) {
              try { decryptedPass = decryptPassword(row.admin_password_enc); } catch {}
            }
            return { ...row, admin_password: decryptedPass, admin_password_enc: undefined };
          });
        } catch (e: any) { console.error('searchDetail cloudMappings error:', e.message); entry.cloudMappings = []; }
      }

      // Customer Activities (Sales/Purchase)
      const canViewActivities = isAdmin || permissions?.activities?.view || permissions?.customer_search?.view;
      if (canViewActivities) {
        try {
          entry.activities = await this.db.query<any>(`
            SELECT a.*, c.company as customer_name
            FROM cloud_activities a
            LEFT JOIN customer c ON a.customer_id = c.id
            WHERE a.customer_id IN (${placeholders})
            ORDER BY a.activity_date DESC, a.id DESC
            LIMIT 10
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail activities error:', e.message); entry.activities = []; }
      }

      // Customer Visits
      const canViewVisits = isAdmin || permissions?.visits_our?.view || permissions?.visits_not_our?.view || permissions?.customer_search?.view;
      if (canViewVisits) {
        try {
          entry.visits = await this.db.query<any>(`
            SELECT v.*, c.company as customer_name
            FROM cloud_visits v
            LEFT JOIN customer c ON v.customer_id = c.id
            WHERE v.customer_id IN (${placeholders})
            ORDER BY v.check_out_time DESC, v.id DESC
            LIMIT 10
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail visits error:', e.message); entry.visits = []; }
      }

      // Service Calls
      const canViewServiceCalls = isAdmin || permissions?.service_calls?.view || permissions?.customer_search?.view;
      if (canViewServiceCalls) {
        try {
          entry.serviceCalls = await this.db.query<any>(`
            SELECT sc.*, c.company as customer_name, sm.name as flavor_name
            FROM service_calls sc
            LEFT JOIN customer c ON sc.customer_id = c.id
            LEFT JOIN singlemaster sm ON sc.flavor = sm.id
            WHERE sc.customer_id IN (${placeholders})
            ORDER BY sc.created_at DESC, sc.id DESC
            LIMIT 10
          `, allGroupIds);
        } catch (e: any) { console.error('searchDetail serviceCalls error:', e.message); entry.serviceCalls = []; }
      }

      results.push(entry);
    }

    return { customers: results };
  }

  // Private Helper to Sync Contact to new tables
  private async syncPrimaryContact(customerId: number, person: string, mobile: string) {
    // Clean mobile (keep logic simple)
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    if (cleanMobile.length < 10) return;

    // Check if Contact exists
    let mobileId: number;
    const existing = await this.db.queryOne('SELECT id FROM customer_contact_details WHERE mobile_no = ?', [cleanMobile]);

    if (existing) {
      mobileId = existing.id;
      // We could update the person name here if improved, but let's keep it stable for now
    } else {
      const res = await this.db.execute('INSERT INTO customer_contact_details (contact_person, mobile_no, status, created_by, created_at) VALUES (?, ?, ?, ?, NOW())', [person, cleanMobile, 'Active', 1]);
      mobileId = res.insertId;
    }

    // Check Mapping
    const mapping = await this.db.queryOne('SELECT id FROM customer_contact_mapping_data WHERE customer_id = ? AND mobile_id = ?', [customerId, mobileId]);

    if (!mapping) {
      // Reset other primaries for this customer
      await this.db.execute("UPDATE customer_contact_mapping_data SET primary_contact = 'No' WHERE customer_id = ?", [customerId]);
      // Insert new primary
      await this.db.execute('INSERT INTO customer_contact_mapping_data (customer_id, mobile_id, primary_contact, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [customerId, mobileId, 'Yes', 'Active', 1]);
    } else {
      // Ensure it is Primary
      await this.db.execute("UPDATE customer_contact_mapping_data SET primary_contact = 'No' WHERE customer_id = ?", [customerId]);
    }
  }

  async updateContactMapping(customerId: number, contactId: number, data: { status?: string; primary_contact?: string; contact_person?: string }): Promise<any> {
    if (data.contact_person) {
      await this.db.execute(
        `UPDATE customer_contact_details SET contact_person = ? WHERE id = ?`,
        [data.contact_person, contactId]
      );
    }

    // If making inactive → force primary_contact = 'No'
    if (data.status === 'Inactive') {
      data.primary_contact = 'No';
    }

    if (data.primary_contact === 'Yes') {
      // Unset all other primaries for this customer
      await this.db.execute(
        `UPDATE customer_contact_mapping_data SET primary_contact = 'No' WHERE customer_id = ? AND primary_contact = 'Yes'`,
        [customerId]
      );
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (data.status) { updates.push('status = ?'); params.push(data.status); }
    if (data.primary_contact) { updates.push('primary_contact = ?'); params.push(data.primary_contact); }

    if (updates.length > 0) {
      params.push(customerId, contactId);
      await this.db.execute(
        `UPDATE customer_contact_mapping_data SET ${updates.join(', ')} WHERE customer_id = ? AND mobile_id = ?`,
        params
      );
    }

    // If this contact was primary and is now inactive, auto-promote next active contact
    if (data.status === 'Inactive') {
      const nextActive = await this.db.queryOne<any>(
        `SELECT mobile_id FROM customer_contact_mapping_data WHERE customer_id = ? AND status = 'Active' AND primary_contact = 'No' ORDER BY id ASC LIMIT 1`,
        [customerId]
      );
      if (nextActive) {
        await this.db.execute(
          `UPDATE customer_contact_mapping_data SET primary_contact = 'Yes' WHERE customer_id = ? AND mobile_id = ?`,
          [customerId, nextActive.mobile_id]
        );
      }
    }

    return { success: true };
  }

  async mapCompany(customerId: number, targetId: number): Promise<any> {
    const customer = await this.findById(customerId) as any;
    const mappingId = customer.mappingid || customerId; 
    await this.db.execute(
      `UPDATE customer SET mappingid = ? WHERE id = ?`,
      [mappingId, targetId]
    );
    return { success: true };
  }

  async findById(id: number): Promise<Customer> {
    const customer = await this.db.queryOne<any>(`
      SELECT c.*, COALESCE(u.name, cu.name) as group_name,
      s.name as state_name,
      COALESCE(NULLIF(c.area, ''), NULLIF(c.city, ''), NULLIF(pv.city, ''), '-') as area,
      (SELECT ccd2.contact_person FROM customer_contact_mapping_data ccmd2
       JOIN customer_contact_details ccd2 ON ccmd2.mobile_id = ccd2.id
       WHERE ccmd2.customer_id = c.id AND ccmd2.status = 'Active'
       ORDER BY CASE WHEN ccmd2.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccmd2.id LIMIT 1) as person,
      COALESCE(
        (SELECT ccd2.mobile_no FROM customer_contact_mapping_data ccmd2
         JOIN customer_contact_details ccd2 ON ccmd2.mobile_id = ccd2.id
         WHERE ccmd2.customer_id = c.id AND ccmd2.status = 'Active'
         ORDER BY CASE WHEN ccmd2.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccmd2.id LIMIT 1),
        c.mobile) as mobile
      FROM customer c
      LEFT JOIN admin u ON c.group = CAST(u.id AS CHAR)
      LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
      LEFT JOIN pincode pv ON c.pincode = pv.pincode
      LEFT JOIN state s ON pv.stateid = s.id
      WHERE c.id = ?
    `, [id]);

    if (!customer) throw new NotFoundException('Customer not found');

    return {
      ...customer,
      state_original_id: customer.state,
      state: customer.state_name || customer.state,
      total_licenses: Number(customer.total_licenses || 0),
      active_licenses: Number(customer.active_licenses || 0)
    };
  }

  // ── User Mapping Methods ──

  /**
   * Get customers by legacy admin group id with pagination
   */
  async findByAdminGroup(adminId: number, page: number = 1, limit: number = 50, search: string = '') {
    const offset = (page - 1) * limit;
    const conditions: string[] = ['c.`group` = ?'];
    const params: any[] = [adminId];

    if (search) {
      conditions.push('(c.company LIKE ? OR c.mobile LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      this.db.query<any>(`
        SELECT c.id, c.company, c.mobile, c.email, c.status,
               c.\`group\`, c.cloud_group_id, c.subgroupid,
               a.name as admin_name,
               cu1.name as cloud_user_name,
               cu2.name as sub_user_name,
               (SELECT ccd2.contact_person FROM customer_contact_mapping_data ccmd2
                JOIN customer_contact_details ccd2 ON ccmd2.mobile_id = ccd2.id
                WHERE ccmd2.customer_id = c.id AND ccmd2.status = 'Active'
                ORDER BY CASE WHEN ccmd2.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccmd2.id LIMIT 1) as person,
               (SELECT ccd2.mobile_no FROM customer_contact_mapping_data ccmd2
                JOIN customer_contact_details ccd2 ON ccmd2.mobile_id = ccd2.id
                WHERE ccmd2.customer_id = c.id AND ccmd2.status = 'Active'
                ORDER BY CASE WHEN ccmd2.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccmd2.id LIMIT 1) as contact_mobile
        FROM customer c
        LEFT JOIN admin a ON a.id = c.\`group\`
        LEFT JOIN cloud_users cu1 ON cu1.id = c.cloud_group_id
        LEFT JOIN cloud_users cu2 ON cu2.id = c.subgroupid
        WHERE ${where}
        ORDER BY c.company ASC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]),
      this.db.queryOne<{ total: number }>(`
        SELECT COUNT(*) as total FROM customer c WHERE ${where}
      `, params),
    ]);

    return {
      data: rows,
      total: countResult?.total || 0,
      page,
      limit,
    };
  }

  /**
   * Map customers to cloud users (set cloud_group_id and/or subgroupid)
   */
  async mapCloudUser(customerIds: number[], cloudGroupId: string | null, subgroupId: string | null) {
    if (!customerIds.length) return { updated: 0 };

    const setClauses: string[] = [];
    const params: any[] = [];

    if (cloudGroupId !== undefined && cloudGroupId !== null) {
      setClauses.push('cloud_group_id = ?');
      params.push(cloudGroupId);
    }
    if (subgroupId !== undefined && subgroupId !== null) {
      setClauses.push('subgroupid = ?');
      params.push(subgroupId);
    }

    if (!setClauses.length) return { updated: 0 };

    const placeholders = customerIds.map(() => '?').join(',');
    params.push(...customerIds);

    const result = await this.db.query<any>(
      `UPDATE customer SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`,
      params
    );

    return { updated: customerIds.length };
  }

}
