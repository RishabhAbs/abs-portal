import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class DashboardService {
  constructor(private db: DbService) { }

  async getStats() {
    const [
      serverStats,
      customerStats,
      mappingStats,
      unmappedCount,
      userStats,
      revenueStats,
      recentActivities
    ] = await Promise.all([
      // Server stats
      this.db.queryOne<any>(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive,
          SUM(CASE WHEN status = 'Maintenance' THEN 1 ELSE 0 END) as maintenance
        FROM cloud_servers
      `),

      // Customer stats
      this.db.queryOne<any>(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive,
          SUM(CASE WHEN status = 'Suspended' THEN 1 ELSE 0 END) as suspended
        FROM customer
      `),

      // Mapping stats
      this.db.queryOne<any>(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active
        FROM cloud_mappings
      `),

      // Unmapped count
      this.db.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM customer c
        LEFT JOIN cloud_mappings m ON c.id = m.customer_id AND m.status = 'Active'
        WHERE m.id IS NULL AND c.status = 'Active'
      `),

      // User stats (updated for new schema)
      this.db.queryOne<any>(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
          SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin,
          SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user
        FROM cloud_users
      `),

      // Activity/Revenue stats
      this.db.queryOne<any>(`
        SELECT
          COALESCE(SUM(CASE WHEN bill_type = 'Tax Invoice' THEN bill_amount ELSE 0 END), 0) as totalRevenue,
          COUNT(*) as totalActivities,
          COALESCE(SUM(CASE WHEN bill_type = 'Tax Invoice' THEN bill_amount ELSE 0 END), 0) as taxInvoice,
          COALESCE(SUM(CASE WHEN bill_type = 'Credit Note' THEN bill_amount ELSE 0 END), 0) as creditNote,
          COALESCE(SUM(CASE WHEN bill_type = 'Tax Invoice' AND DATE_FORMAT(activity_date,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m') THEN bill_amount ELSE 0 END), 0) as currentMonth
        FROM cloud_activities
        WHERE record_nature = 'Sales' OR record_nature IS NULL
      `),

      // Recent activities
      this.db.query(`
        SELECT id, customer_name, activity_type, bill_type, activity_date, bill_amount
        FROM cloud_activities
        ORDER BY activity_date DESC
        LIMIT 5
      `)
    ]);

    return {
      servers: {
        total: Number(serverStats?.total || 0),
        active: Number(serverStats?.active || 0),
        inactive: Number(serverStats?.inactive || 0),
        maintenance: Number(serverStats?.maintenance || 0),
      },
      customers: {
        total: Number(customerStats?.total || 0),
        active: Number(customerStats?.active || 0),
        inactive: Number(customerStats?.inactive || 0),
        suspended: Number(customerStats?.suspended || 0),
      },
      mappings: {
        total: Number(mappingStats?.total || 0),
        active: Number(mappingStats?.active || 0),
        unmapped: Number(unmappedCount?.count || 0),
      },
      users: {
        total: Number(userStats?.total || 0),
        active: Number(userStats?.active || 0),
        inactive: Number(userStats?.inactive || 0),
        byRole: {
          admin: Number(userStats?.admin || 0),
          user: Number(userStats?.user || 0),
        },
      },
      revenue: {
        totalRevenue: Number(revenueStats?.totalRevenue || 0),
        totalActivities: Number(revenueStats?.totalActivities || 0),
        currentMonth: Number(revenueStats?.currentMonth || 0),
        byType: {
          taxInvoice: Number(revenueStats?.taxInvoice || 0),
          creditNote: Number(revenueStats?.creditNote || 0),
        },
      },
      recentActivities,
    };
  }

  /** Operations Snapshot — dashboard widget feed.
   *
   *  Counts every active tallydetails licence by:
   *    - tally_status   → 'Our Tally' rolls up under "our"; everything else
   *                       (Gold/Silver/Auditor of competing brands or NULL)
   *                       rolls up under "other".
   *    - tallyflavor    → singlemaster.name in {Gold, Silver, Auditor}.
   *                       Anything else falls into the "auditor" bucket so
   *                       the grand total still ties up.
   *    - expiry bucket  →
   *        - old        : expiry < first day of current month
   *        - this_month : expiry between start and end of current month
   *        - future     : expiry > end of current month
   *
   *  Customer-movement section counts company rows that joined or left in
   *  the last 30 days (using customer.date for joins, active_status flips
   *  for "left"). "OnBoard from Other" counts customers whose newest
   *  tallydetails row flipped to 'Our Tally' within the window.
   *
   *  Single round-trip — all counts are derived from one expiry query +
   *  three movement queries to keep the dashboard snappy.
   */
  async getOperationsSnapshot() {
    // Bucket each licence into (segment, grade, expiry-bucket). The CASE
    // ladder mirrors the PHP report so labels match what users expect:
    //   "Our Customer"  ↔ tally_status = 'Our Tally'
    //   "Other Customer" ↔ everything else
    const expiryRows = await this.db.query<any>(`
      SELECT
        CASE WHEN td.tally_status = 'Our Tally' THEN 'our' ELSE 'other' END AS segment,
        CASE
          WHEN UPPER(sm.name) = 'GOLD'    THEN 'gold'
          WHEN UPPER(sm.name) = 'SILVER'  THEN 'silver'
          WHEN UPPER(sm.name) = 'AUDITOR' THEN 'auditor'
          ELSE 'auditor'
        END AS grade,
        CASE
          WHEN td.tallyexpirydate IS NULL                                 THEN 'unknown'
          WHEN td.tallyexpirydate < DATE_FORMAT(CURDATE(), '%Y-%m-01')    THEN 'old'
          WHEN td.tallyexpirydate <= LAST_DAY(CURDATE())                  THEN 'this_month'
          ELSE 'future'
        END AS bucket,
        COUNT(*) AS cnt
      FROM tallydetails td
      LEFT JOIN singlemaster sm ON td.tallyflavor = CAST(sm.id AS CHAR) AND sm.type = 'TallyFlavor'
      WHERE td.active_status = 'Active' OR td.active_status IS NULL
      GROUP BY segment, grade, bucket
    `).catch(() => [] as any[]);

    type Grade = 'silver' | 'gold' | 'auditor';
    const blankGrade = (): Record<Grade, number> => ({ silver: 0, gold: 0, auditor: 0 });
    const blankBucket = () => ({ our: blankGrade(), other: blankGrade() });
    const expiry = {
      old:        blankBucket(),
      this_month: blankBucket(),
      future:     blankBucket(),
    } as Record<'old' | 'this_month' | 'future', { our: Record<Grade, number>; other: Record<Grade, number> }>;
    for (const r of expiryRows) {
      const seg: 'our' | 'other' = r.segment === 'our' ? 'our' : 'other';
      const grade = (['silver', 'gold', 'auditor'].includes(r.grade) ? r.grade : 'auditor') as Grade;
      const bucket = r.bucket as 'old' | 'this_month' | 'future' | 'unknown';
      if (bucket === 'unknown') continue; // unknown expiry doesn't fit any column
      expiry[bucket][seg][grade] += Number(r.cnt) || 0;
    }
    const sumGrade = (g: Record<Grade, number>) => g.silver + g.gold + g.auditor;

    const gradeCase = `
      CASE
        WHEN UPPER(sm.name) = 'GOLD'    THEN 'gold'
        WHEN UPPER(sm.name) = 'SILVER'  THEN 'silver'
        WHEN UPPER(sm.name) = 'AUDITOR' THEN 'auditor'
        ELSE 'auditor'
      END AS grade`;
    const smJoin = `LEFT JOIN singlemaster sm ON td.tallyflavor = CAST(sm.id AS CHAR) AND sm.type = 'TallyFlavor'`;

    const [onboardNew, onboardFromOther, leftRows] = await Promise.all([
      // New: serials whose add_date is within 30 days.
      this.db.query<any>(`
        SELECT ${gradeCase}, COUNT(DISTINCT td.id) AS cnt
        FROM tallydetails td
        ${smJoin}
        WHERE td.tally_status = 'Our Tally'
          AND (td.active_status = 'Active' OR td.active_status IS NULL)
          AND td.add_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY grade
      `).catch(() => [] as any[]),

      // From Other: serials that became active (active_date) within 30 days
      // and active_date is after add_date (genuine conversion, not a new add).
      this.db.query<any>(`
        SELECT ${gradeCase}, COUNT(DISTINCT td.id) AS cnt
        FROM tallydetails td
        ${smJoin}
        WHERE td.tally_status = 'Our Tally'
          AND td.active_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND (td.add_date IS NULL OR td.active_date > td.add_date)
        GROUP BY grade
      `).catch(() => [] as any[]),

      // Left: serials where left_date was stamped within 30 days.
      // Stamped by Tally API sync when serial_status=0 (no longer tagged to ABS).
      this.db.query<any>(`
        SELECT ${gradeCase}, COUNT(DISTINCT td.id) AS cnt
        FROM tallydetails td
        ${smJoin}
        WHERE td.left_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY grade
      `).catch(() => [] as any[]),
    ]);

    const tallyToGrade = (rows: any[]): Record<Grade, number> => {
      const out = blankGrade();
      for (const r of rows) {
        const g = (['silver', 'gold', 'auditor'].includes(r.grade) ? r.grade : 'auditor') as Grade;
        out[g] += Number(r.cnt) || 0;
      }
      return out;
    };

    return {
      expiry: {
        old: {
          our:   { ...expiry.old.our,   total: sumGrade(expiry.old.our)   },
          other: { ...expiry.old.other, total: sumGrade(expiry.old.other) },
        },
        this_month: {
          our:   { ...expiry.this_month.our,   total: sumGrade(expiry.this_month.our)   },
          other: { ...expiry.this_month.other, total: sumGrade(expiry.this_month.other) },
        },
        future: {
          our:   { ...expiry.future.our,   total: sumGrade(expiry.future.our)   },
          other: { ...expiry.future.other, total: sumGrade(expiry.future.other) },
        },
      },
      movement: {
        onboard_new:        { ...tallyToGrade(onboardNew),       total: sumGrade(tallyToGrade(onboardNew)) },
        onboard_from_other: { ...tallyToGrade(onboardFromOther), total: sumGrade(tallyToGrade(onboardFromOther)) },
        left:               { ...tallyToGrade(leftRows),         total: sumGrade(tallyToGrade(leftRows)) },
      },
    };
  }

  async getRecentServers(limit = 5) {
    return this.db.query(`SELECT * FROM cloud_servers ORDER BY created_at DESC LIMIT ?`, [limit]);
  }

  async getRecentCustomers(limit = 5) {
    return this.db.query(`SELECT * FROM customer ORDER BY date DESC LIMIT ?`, [limit]);
  }

  async getRevenueByMonth() {
    return this.db.query(`
      SELECT
        DATE_FORMAT(activity_date, '%Y-%m') as month,
        SUM(bill_amount) as revenue,
        COUNT(*) as activities
      FROM cloud_activities
      WHERE activity_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(activity_date, '%Y-%m')
      ORDER BY month DESC
    `);
  }

  async getPendingByUser(): Promise<any[]> {
    const [users, serviceRows, taskRows, leadRows, reqRows] = await Promise.all([
      this.db.query<any>(`SELECT name FROM cloud_users WHERE status = 'active' ORDER BY name`),
      this.db.query<any>(`
        SELECT COALESCE(taken_by, 'Unalloted') as user_name, COUNT(*) as cnt
        FROM service_calls
        WHERE entry_type = 'Service' AND status IN ('Open', 'In Progress')
        GROUP BY COALESCE(taken_by, 'Unalloted')
      `),
      this.db.query<any>(`
        SELECT user_name, COUNT(*) as cnt FROM (
          SELECT COALESCE(assigned_to, 'Unalloted') as user_name FROM lead_notes
          WHERE status = 'Pending'
          UNION ALL
          SELECT COALESCE(user_name, 'Unalloted') as user_name FROM cloud_tdl_tasks
          WHERE status IN ('Pending', 'In Progress')
        ) t GROUP BY user_name
      `),
      this.db.query<any>(`
        SELECT COALESCE(taken_by, 'Unalloted') as user_name, COUNT(*) as cnt
        FROM service_calls
        WHERE entry_type = 'Lead' AND status IN ('Open', 'In Progress')
        GROUP BY COALESCE(taken_by, 'Unalloted')
      `),
      // All pending requirements with service_type for permission matching
      this.db.query<any>(`
        SELECT lr.id, COALESCE(sc.service_type, '') as service_type
        FROM lead_requirements lr
        LEFT JOIN service_calls sc ON lr.service_call_id = sc.id
        WHERE lr.status IN ('Pending', 'In Progress')
      `),
    ]);

    const toMap = (rows: any[]) => Object.fromEntries(rows.map((r: any) => [r.user_name, Number(r.cnt)]));
    const sMap = toMap(serviceRows);
    const tMap = toMap(taskRows);
    const lMap = toMap(leadRows);

    // Match requirement service_type to my_requirements permission keys
    const reqTypeOf = (svcType: string): string => {
      const t = (svcType || '').toLowerCase();
      if (t.includes('tdl')) return 'tdl';
      if (t.includes('cloud')) return 'cloud';
      if (t.includes('tally')) return 'tally';
      if (t.includes('app') || t.includes('web')) return 'webapp';
      return 'tdl'; // default bucket
    };

    const pendingReqs = reqRows as any[];

    const usersWithPerms = await this.db.query<any>(
      `SELECT name, permissions FROM cloud_users WHERE status = 'active' ORDER BY name`
    );

    const result: any[] = [];
    for (const u of usersWithPerms) {
      let myReqPerms: any = {};
      try { myReqPerms = JSON.parse(u.permissions)?.my_requirements || {}; } catch {}

      const reqCount = pendingReqs.filter(r => {
        const key = reqTypeOf(r.service_type);
        return myReqPerms[key] === true;
      }).length;

      const svc = sMap[u.name] || 0;
      const task = tMap[u.name] || 0;
      const lead = lMap[u.name] || 0;
      if (svc + task + lead + reqCount > 0) {
        result.push({ user_name: u.name, service: svc, task, lead, requirement: reqCount, left_customer: 0 });
      }
    }
    return result;
  }

  async getMyPending(userName: string, permissionsJson: string): Promise<any> {
    const reqTypeOf = (svcType: string): string => {
      const t = (svcType || '').toLowerCase();
      if (t.includes('tdl')) return 'tdl';
      if (t.includes('cloud')) return 'cloud';
      if (t.includes('tally')) return 'tally';
      if (t.includes('app') || t.includes('web')) return 'webapp';
      return 'tdl';
    };

    const [svcRow, taskRow, leadRow, reqRows] = await Promise.all([
      this.db.queryOne<any>(
        `SELECT COUNT(*) as cnt FROM service_calls WHERE entry_type = 'Service' AND status IN ('Open', 'In Progress') AND COALESCE(taken_by, 'Unalloted') = ?`,
        [userName]
      ),
      this.db.queryOne<any>(
        `SELECT COUNT(*) as cnt FROM (
          SELECT id FROM lead_notes WHERE status = 'Pending' AND COALESCE(assigned_to, 'Unalloted') = ?
          UNION ALL
          SELECT id FROM cloud_tdl_tasks WHERE status IN ('Pending', 'In Progress') AND COALESCE(user_name, 'Unalloted') = ?
        ) t`,
        [userName, userName]
      ),
      this.db.queryOne<any>(
        `SELECT COUNT(*) as cnt FROM service_calls WHERE entry_type = 'Lead' AND status IN ('Open', 'In Progress') AND COALESCE(taken_by, 'Unalloted') = ?`,
        [userName]
      ),
      this.db.query<any>(
        `SELECT lr.id, COALESCE(sc.service_type, '') as service_type FROM lead_requirements lr LEFT JOIN service_calls sc ON lr.service_call_id = sc.id WHERE lr.status IN ('Pending', 'In Progress')`
      ),
    ]);

    let myReqPerms: any = {};
    try { myReqPerms = JSON.parse(permissionsJson)?.my_requirements || {}; } catch {}
    const reqCount = (reqRows as any[]).filter(r => myReqPerms[reqTypeOf(r.service_type)] === true).length;

    return {
      user_name: userName,
      service: Number(svcRow?.cnt || 0),
      task: Number(taskRow?.cnt || 0),
      lead: Number(leadRow?.cnt || 0),
      requirement: reqCount,
      left_customer: 0,
    };
  }

  async getPendingDetail(type: string, user: string): Promise<any> {
    let rows: any[] = [];

    if (type === 'service') {
      rows = await this.db.query<any>(`
        SELECT sc.id, COALESCE(c.company, sc.contact_person, sc.mobile_no) as customer_name,
               sc.service_type, sc.remark, sc.status, sc.created_at, sc.taken_by, sc.created_by, sc.mobile_no
        FROM service_calls sc
        LEFT JOIN customer c ON c.id = sc.customer_id
        WHERE sc.entry_type = 'Service' AND sc.status IN ('Open', 'In Progress')
          AND COALESCE(sc.taken_by, 'Unalloted') = ?
        ORDER BY sc.created_at DESC
      `, [user]);
    } else if (type === 'task') {
      rows = await this.db.query<any>(`
        SELECT id, customer_name, service_type, content, status, created_at, deadline FROM (
          SELECT ln.id, COALESCE(c.company, sc.contact_person, '') as customer_name,
                 sc.service_type, ln.content, ln.status, ln.created_at, ln.deadline
          FROM lead_notes ln
          LEFT JOIN service_calls sc ON ln.service_call_id = sc.id
          LEFT JOIN customer c ON c.id = sc.customer_id
          WHERE ln.status = 'Pending' AND COALESCE(ln.assigned_to, 'Unalloted') = ?
          UNION ALL
          SELECT t.id, COALESCE(c.company, m.person_name, '') as customer_name,
                 t.task_type as service_type, t.remark as content, t.status, t.allotment_date as created_at, t.deadline
          FROM cloud_tdl_tasks t
          LEFT JOIN cloud_tdl_master m ON t.tdl_id = m.id
          LEFT JOIN customer c ON c.id = m.customer_id
          WHERE t.status IN ('Pending', 'In Progress') AND COALESCE(t.user_name, 'Unalloted') = ?
        ) combined
        ORDER BY created_at DESC
      `, [user, user]);
    } else if (type === 'lead') {
      rows = await this.db.query<any>(`
        SELECT sc.id, COALESCE(c.company, sc.contact_person, sc.mobile_no) as customer_name,
               sc.service_type, sc.remark, sc.status, sc.lead_type, sc.created_at, sc.taken_by, sc.created_by
        FROM service_calls sc
        LEFT JOIN customer c ON c.id = sc.customer_id
        WHERE sc.entry_type = 'Lead' AND sc.status IN ('Open', 'In Progress')
          AND COALESCE(sc.taken_by, 'Unalloted') = ?
        ORDER BY sc.created_at DESC
      `, [user]);
    } else if (type === 'requirement') {
      // Get user's my_requirements permissions to filter by service_type
      const userRow = await this.db.queryOne<any>(
        `SELECT permissions FROM cloud_users WHERE name = ? AND status = 'active'`, [user]
      );
      let myReqPerms: any = {};
      try { myReqPerms = JSON.parse(userRow?.permissions || '{}')?.my_requirements || {}; } catch {}

      const allowedTypes: string[] = [];
      if (myReqPerms.tdl)    allowedTypes.push("sc.service_type LIKE '%TDL%'");
      if (myReqPerms.cloud)  allowedTypes.push("sc.service_type LIKE '%Cloud%'");
      if (myReqPerms.tally)  allowedTypes.push("sc.service_type LIKE '%Tally%'");
      if (myReqPerms.webapp) allowedTypes.push("(sc.service_type LIKE '%App%' OR sc.service_type LIKE '%Web%')");

      const typeFilter = allowedTypes.length > 0 ? `AND (${allowedTypes.join(' OR ')})` : `AND 1=0`;

      rows = await this.db.query<any>(`
        SELECT lr.id, lr.description as customer_name, lr.status, lr.dev_status, lr.testing_status,
               lr.priority, lr.deadline, lr.assigned_to, lr.created_at, sc.service_type,
               COALESCE(c.company, sc.contact_person) as company
        FROM lead_requirements lr
        LEFT JOIN service_calls sc ON lr.service_call_id = sc.id
        LEFT JOIN customer c ON c.id = sc.customer_id
        WHERE lr.status IN ('Pending', 'In Progress') ${typeFilter}
        ORDER BY lr.deadline ASC, lr.created_at DESC
      `);
    }

    const toDateStr = (v: any): string => {
      if (!v) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).replace('T', ' ').slice(0, 10);
    };

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

    const result: any = { today: [], yesterday: [], older: [] };
    for (const row of rows) {
      const d = toDateStr(row.created_at);
      if (d === today) result.today.push(row);
      else if (d === yesterday) result.yesterday.push(row);
      else result.older.push(row);
    }
    return result;
  }

  async getMyPerformance(userName: string, fy: string) {
    const now = new Date();
    const month = now.getMonth(); // 0-indexed calendar month
    const year = now.getFullYear();
    const today = now.toISOString().split('T')[0];

    // FY string (e.g. "2026-27")
    const fyYear = month >= 3 ? year : year - 1;
    const fyStr = fy || `${fyYear}-${String(fyYear + 1).slice(2)}`;
    const fyStart = `${fyYear}-04-01`;

    // MTD
    const mtdStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    // QTD
    const qtdCalendarStart =
      month >= 3 && month <= 5 ? 3
      : month >= 6 && month <= 8 ? 6
      : month >= 9 && month <= 11 ? 9
      : 0;
    const qtdStart = `${year}-${String(qtdCalendarStart + 1).padStart(2, '0')}-01`;

    // Month-name mapping (FY starts April)
    const MONTHS_CAL = ['April','May','June','July','August','September','October','November','December','January','February','March'];
    const fyMonthIndex = month >= 3 ? month - 3 : month + 9;
    const currentMonthName = MONTHS_CAL[fyMonthIndex];
    const qStart = Math.floor(fyMonthIndex / 3) * 3;
    const qtdMonths = MONTHS_CAL.slice(qStart, fyMonthIndex + 1);

    const n = (v: any) => Number(v || 0);
    const fields = ['new_target','tss','cloud','tdl','app','visit','call'];
    const TYPE_COLS = ['new_target_type','tss_type','cloud_type','tdl_type','app_type','visit_type','call_type'];

    // Plans: sum from user_targets for MTD/QTD/FY
    const planCols = fields.map(f => `COALESCE(SUM(\`${f}\`),0) AS \`${f}\``).join(', ');

    // Classify by item_categories.name only — the team is still tagging items,
    // so we intentionally don't fall back to item_name or broaden keywords.
    // Uncategorized items are excluded so the dashboard shows the real tagged coverage.
    const matchCat = (categoryName: string): string | null => {
      const g = (categoryName || '').toLowerCase();
      if (g.includes('new'))                      return 'new_target';
      if (g.includes('tss'))                      return 'tss';
      if (g.includes('cloud'))                    return 'cloud';
      if (g.includes('tdl'))                      return 'tdl';
      if (g.includes('app') || g.includes('web')) return 'app';
      return null;
    };

    // Aggregate qty + amount per item_category for sales vouchers by this user in a date range.
    // vch_details.created_by may hold either the cloud_users.id (e.g. "USR003") or the
    // display name (legacy rows). Resolve the name to an id once so we match both forms.
    const userRow = await this.db.queryOne<any>(
      `SELECT id FROM cloud_users WHERE name = ? LIMIT 1`,
      [userName],
    ).catch(() => null);
    const userId = userRow?.id || null;

    const achievedByGroup = async (startDate: string, endDate: string) => {
      const rows = await this.db.query<any>(
        // Sales vouchers store inventory qty & amount as NEGATIVE (stock-out sign convention),
        // so wrap SUMs in ABS() to surface the positive achievement number.
        `SELECT ic.name AS category_name,
                ABS(COALESCE(SUM(ie.qty),    0)) AS total_qty,
                ABS(COALESCE(SUM(ie.amount), 0)) AS total_amount
           FROM vch_details v
           JOIN vchtype vt            ON v.vch_type_id = vt.id
           LEFT JOIN vchtype p        ON vt.parent_id  = p.id AND vt.parent_id != vt.id
           JOIN ledger_entries le     ON le.vch_id     = v.id
           JOIN inventory_entries ie  ON ie.led_id     = le.id
           JOIN items i               ON ie.item_id    = i.id
           JOIN item_categories ic    ON ic.id         = i.category_id
          WHERE COALESCE(p.name, vt.name) = 'Sales'
            AND (v.created_by = ? OR v.created_by = ?)
            AND v.vch_date BETWEEN ? AND ?
          GROUP BY ic.id, ic.name`,
        [userName, userId, startDate, endDate],
      ).catch(() => [] as any[]);

      // Fold rows → per-category {qty, amount}; uncategorized items are excluded by the INNER JOIN above
      const bucket: Record<string, { qty: number; amount: number }> = {};
      for (const f of fields) bucket[f] = { qty: 0, amount: 0 };
      for (const r of rows) {
        const cat = matchCat(r.category_name);
        if (!cat) continue;
        bucket[cat].qty    += Number(r.total_qty || 0);
        bucket[cat].amount += Number(r.total_amount || 0);
      }
      return bucket;
    };

    const [mtdPlan, qtdPlan, fyPlan, unitRow, mtdAch, qtdAch, fyAch] = await Promise.all([
      this.db.queryOne<any>(
        `SELECT ${planCols} FROM user_targets WHERE user_name=? AND fy=? AND month=?`,
        [userName, fyStr, currentMonthName],
      ),
      this.db.queryOne<any>(
        `SELECT ${planCols} FROM user_targets WHERE user_name=? AND fy=? AND month IN (${qtdMonths.map(() => '?').join(',')})`,
        [userName, fyStr, ...qtdMonths],
      ),
      this.db.queryOne<any>(
        `SELECT ${planCols} FROM user_targets WHERE user_name=? AND fy=?`,
        [userName, fyStr],
      ),
      this.db.queryOne<any>(
        `SELECT ${TYPE_COLS.map(c => `\`${c}\``).join(', ')} FROM user_targets WHERE user_name=? AND fy=? LIMIT 1`,
        [userName, fyStr],
      ),
      achievedByGroup(mtdStart, today),
      achievedByGroup(qtdStart, today),
      achievedByGroup(fyStart,  today),
    ]);

    // Pick qty vs amount based on this user's per-category unit_type (default 'qty')
    const pick = (bucket: Record<string, { qty: number; amount: number }>, field: string) => {
      const unit = unitRow?.[`${field}_type`] || 'qty';
      return unit === 'amount' ? bucket[field].amount : bucket[field].qty;
    };

    const metric = (field: string) => ({
      today: 0, // achievement is date-ranged from vch_date; caller doesn't use this tile
      mtd: { actual: pick(mtdAch, field), plan: n(mtdPlan?.[field]) },
      qtd: { actual: pick(qtdAch, field), plan: n(qtdPlan?.[field]) },
      fy:  { actual: pick(fyAch,  field), plan: n(fyPlan?.[field])  },
    });

    return {
      activation_today: 0,
      metrics: {
        new_target: metric('new_target'),
        tss:        metric('tss'),
        cloud:      metric('cloud'),
        tdl:        metric('tdl'),
        app:        metric('app'),
        visit:      metric('visit'),
        call:       metric('call'),
      },
    };
  }

  // Admin rollup across all active users. Reuses the same voucher-actuals SQL as
  // getMyPerformance but groups by v.created_by so we make 4 DB round-trips
  // (MTD, QTD, FY, prev-month-same-range) instead of one per user.
  async getAdminPerformance(fy: string) {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const today = now.toISOString().split('T')[0];
    const dayOfMonth = now.getDate();

    const fyYear = month >= 3 ? year : year - 1;
    const fyStr = fy || `${fyYear}-${String(fyYear + 1).slice(2)}`;
    const fyStart = `${fyYear}-04-01`;
    const mtdStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    // Previous calendar month, same day-of-month range (e.g. Apr 1-22 vs Mar 1-22)
    const prevMonthDate = new Date(year, month - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth();
    const prevMtdStart = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    const prevDaysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
    const prevCapDay = Math.min(dayOfMonth, prevDaysInMonth);
    const prevMtdEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(prevCapDay).padStart(2, '0')}`;

    const qtdCalendarStart =
      month >= 3 && month <= 5 ? 3
      : month >= 6 && month <= 8 ? 6
      : month >= 9 && month <= 11 ? 9
      : 0;
    const qtdStart = `${year}-${String(qtdCalendarStart + 1).padStart(2, '0')}-01`;

    const MONTHS_CAL = ['April','May','June','July','August','September','October','November','December','January','February','March'];
    const fyMonthIndex = month >= 3 ? month - 3 : month + 9;
    const currentMonthName = MONTHS_CAL[fyMonthIndex];
    const qStart = Math.floor(fyMonthIndex / 3) * 3;
    const qtdMonths = MONTHS_CAL.slice(qStart, fyMonthIndex + 1);

    const fields = ['new_target','tss','cloud','tdl','app','visit','call'] as const;
    const CATEGORY_LABELS: Record<string, string> = {
      new_target: 'NEW', tss: 'TSS', cloud: 'CLOUD', tdl: 'TDL',
      app: 'WEB/APP', visit: 'VISIT', call: 'CALL',
    };
    type Cat = typeof fields[number];

    const matchCat = (categoryName: string): Cat | null => {
      const g = (categoryName || '').toLowerCase();
      if (g.includes('new'))                      return 'new_target';
      if (g.includes('tss'))                      return 'tss';
      if (g.includes('cloud'))                    return 'cloud';
      if (g.includes('tdl'))                      return 'tdl';
      if (g.includes('app') || g.includes('web')) return 'app';
      return null;
    };

    // Run the voucher query once for a date range, grouped by (created_by, item_category).
    // Returns nested map: user -> cat -> {qty, amount}.
    const achievedAllUsers = async (startDate: string, endDate: string) => {
      // vch_details.created_by may be either cloud_users.id (e.g. "USR003") or the
      // display name (legacy). LEFT JOIN + COALESCE so the map is always keyed by
      // the display name, matching user_targets.user_name and cloud_users.name.
      const rows = await this.db.query<any>(
        `SELECT COALESCE(cu.name, v.created_by) AS user_name,
                ic.name                          AS category_name,
                ABS(COALESCE(SUM(ie.qty),    0)) AS total_qty,
                ABS(COALESCE(SUM(ie.amount), 0)) AS total_amount
           FROM vch_details v
           JOIN vchtype vt            ON v.vch_type_id = vt.id
           LEFT JOIN vchtype p        ON vt.parent_id  = p.id AND vt.parent_id != vt.id
           LEFT JOIN cloud_users cu   ON cu.id         = v.created_by
           JOIN ledger_entries le     ON le.vch_id     = v.id
           JOIN inventory_entries ie  ON ie.led_id     = le.id
           JOIN items i               ON ie.item_id    = i.id
           JOIN item_categories ic    ON ic.id         = i.category_id
          WHERE COALESCE(p.name, vt.name) = 'Sales'
            AND v.vch_date BETWEEN ? AND ?
            AND v.created_by IS NOT NULL
          GROUP BY COALESCE(cu.name, v.created_by), ic.id, ic.name`,
        [startDate, endDate],
      ).catch(() => [] as any[]);

      const byUser: Record<string, Record<Cat, { qty: number; amount: number }>> = {};
      for (const r of rows) {
        const cat = matchCat(r.category_name);
        if (!cat) continue;
        const u = r.user_name;
        if (!byUser[u]) {
          byUser[u] = {} as any;
          for (const f of fields) byUser[u][f] = { qty: 0, amount: 0 };
        }
        byUser[u][cat].qty    += Number(r.total_qty || 0);
        byUser[u][cat].amount += Number(r.total_amount || 0);
      }
      return byUser;
    };

    // Build backtick-escaped SELECT list once. `call` is a MySQL reserved
    // word; parsing fails without backticks. All field names are quoted for
    // consistency.
    const planSelectCols = fields.map(f => `\`${f}\``).join(', ');
    const typeSelectCols = fields.map(f => `\`${f}_type\``).join(', ');

    const [usersList, planRows, unitRows, mtdAch, qtdAch, fyAch, prevMtdAch] = await Promise.all([
      this.db.query<any>(`SELECT name FROM cloud_users WHERE status = 'active' ORDER BY name`)
        .catch(() => [] as any[]),
      // All plan rows for this FY. Sum client-side by user / period.
      this.db.query<any>(
        `SELECT user_name, month, ${planSelectCols}
           FROM user_targets WHERE fy = ?`,
        [fyStr],
      ).catch(() => [] as any[]),
      // Per-user unit types. Dedupe in JS (ONLY_FULL_GROUP_BY mode rejects
      // bare GROUP BY on non-aggregated columns).
      this.db.query<any>(
        `SELECT user_name, ${typeSelectCols}
           FROM user_targets WHERE fy = ?`,
        [fyStr],
      ).catch(() => [] as any[]),
      achievedAllUsers(mtdStart, today),
      achievedAllUsers(qtdStart, today),
      achievedAllUsers(fyStart,  today),
      achievedAllUsers(prevMtdStart, prevMtdEnd),
    ]);

    // Per-user plan totals for MTD / QTD / FY
    const emptyCats = (): Record<Cat, number> => {
      const o: any = {}; for (const f of fields) o[f] = 0; return o;
    };
    const planByUser: Record<string, { mtd: Record<Cat, number>; qtd: Record<Cat, number>; fy: Record<Cat, number> }> = {};
    for (const row of planRows) {
      const u = row.user_name;
      if (!planByUser[u]) planByUser[u] = { mtd: emptyCats(), qtd: emptyCats(), fy: emptyCats() };
      for (const f of fields) {
        const v = Number(row[f] || 0);
        planByUser[u].fy[f] += v;
        if (qtdMonths.includes(row.month)) planByUser[u].qtd[f] += v;
        if (row.month === currentMonthName) planByUser[u].mtd[f] += v;
      }
    }

    // Per-user unit types
    const unitByUser: Record<string, Record<Cat, 'qty' | 'amount'>> = {};
    for (const r of unitRows) {
      const m: any = {};
      for (const f of fields) m[f] = r[`${f}_type`] === 'amount' ? 'amount' : 'qty';
      unitByUser[r.user_name] = m;
    }

    const pick = (user: string, cat: Cat, bucket?: { qty: number; amount: number }) => {
      if (!bucket) return 0;
      const unit = unitByUser[user]?.[cat] || 'qty';
      return unit === 'amount' ? bucket.amount : bucket.qty;
    };

    // Build per-user records
    const users = usersList.map((u: any) => {
      const userName = u.name;
      const periodActual = (ach: typeof mtdAch): Record<Cat, number> => {
        const out: any = {};
        for (const f of fields) out[f] = pick(userName, f, ach[userName]?.[f]);
        return out;
      };
      const mtdA = periodActual(mtdAch);
      const qtdA = periodActual(qtdAch);
      const fyA  = periodActual(fyAch);
      const prevMtdA = periodActual(prevMtdAch);

      const plan = planByUser[userName] || { mtd: emptyCats(), qtd: emptyCats(), fy: emptyCats() };

      // Per-category breakdown
      const breakdown: Record<string, any> = {};
      for (const f of fields) {
        breakdown[f] = {
          mtd: { actual: mtdA[f], plan: plan.mtd[f] },
          qtd: { actual: qtdA[f], plan: plan.qtd[f] },
          fy:  { actual: fyA[f],  plan: plan.fy[f]  },
          unit: unitByUser[userName]?.[f] || 'qty',
          prev_mtd_actual: prevMtdA[f],
        };
      }

      // Overall % per period = mean of per-category achievement % where plan > 0
      const overall = (period: 'mtd' | 'qtd' | 'fy') => {
        const actuals = period === 'mtd' ? mtdA : period === 'qtd' ? qtdA : fyA;
        const plans = plan[period];
        const pcts: number[] = [];
        for (const f of fields) {
          if (plans[f] > 0) pcts.push((actuals[f] / plans[f]) * 100);
        }
        if (pcts.length === 0) return null;
        return pcts.reduce((a, b) => a + b, 0) / pcts.length;
      };

      const hasAnyPlan = fields.some(f => plan.mtd[f] > 0 || plan.qtd[f] > 0 || plan.fy[f] > 0);
      const hasAnyActual = fields.some(f => mtdA[f] > 0 || qtdA[f] > 0 || fyA[f] > 0);

      return {
        user_name: userName,
        has_plan: hasAnyPlan,
        has_activity: hasAnyActual,
        mtd_pct: overall('mtd'),
        qtd_pct: overall('qtd'),
        fy_pct:  overall('fy'),
        breakdown,
      };
    });

    // Sum actuals for a category across every creator found in the achievement
    // map — including vouchers whose `created_by` does not match any cloud_user.
    // The per-user cards above already handle the matched subset; this rollup
    // must not silently drop orphaned-creator vouchers or the company totals
    // read as 0 when name-matching is off (e.g. Tally sync using a username
    // that doesn't exist in cloud_users).
    const rollupActual = (ach: typeof mtdAch, cat: Cat): number => {
      let total = 0;
      for (const userName of Object.keys(ach)) {
        const bucket = ach[userName]?.[cat];
        if (!bucket) continue;
        const unit = unitByUser[userName]?.[cat] || 'qty';
        total += unit === 'amount' ? bucket.amount : bucket.qty;
      }
      return total;
    };

    // Category rollup — average of per-user %s for each category
    const categories = fields.map(f => {
      const build = (period: 'mtd' | 'qtd' | 'fy') => {
        const ach = period === 'mtd' ? mtdAch : period === 'qtd' ? qtdAch : fyAch;
        const pcts: number[] = [];
        let totalPlan = 0;
        for (const u of users) {
          const cell = u.breakdown[f][period];
          totalPlan += cell.plan;
          if (cell.plan > 0) pcts.push((cell.actual / cell.plan) * 100);
        }
        return {
          avg_pct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
          users_with_plan: pcts.length,
          total_actual: rollupActual(ach, f),
          total_plan: totalPlan,
        };
      };

      // Growth: sum of actuals across ALL creators, current MTD vs prev MTD same range
      const currActual = rollupActual(mtdAch, f);
      const prevActual = rollupActual(prevMtdAch, f);
      const growth_pct = prevActual > 0 ? ((currActual - prevActual) / prevActual) * 100 : null;

      return {
        key: f,
        label: CATEGORY_LABELS[f],
        mtd: build('mtd'),
        qtd: build('qtd'),
        fy:  build('fy'),
        growth_pct,
        curr_mtd_total: currActual,
        prev_mtd_total: prevActual,
      };
    });

    // Company pulse — mean of user overall %s
    const avgOf = (arr: (number | null)[]) => {
      const xs = arr.filter((v): v is number => typeof v === 'number');
      if (xs.length === 0) return null;
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };

    const company = {
      mtd: { avg_pct: avgOf(users.map(u => u.mtd_pct)), users_tracked: users.filter(u => u.mtd_pct !== null).length },
      qtd: { avg_pct: avgOf(users.map(u => u.qtd_pct)), users_tracked: users.filter(u => u.qtd_pct !== null).length },
      fy:  { avg_pct: avgOf(users.map(u => u.fy_pct)),  users_tracked: users.filter(u => u.fy_pct  !== null).length },
      total_users: users.length,
    };

    // Strip prev_mtd_actual from user breakdown before returning (internal use)
    const userPayload = users.map(u => {
      const clean: Record<string, any> = {};
      for (const f of fields) {
        const b = u.breakdown[f];
        clean[f] = { mtd: b.mtd, qtd: b.qtd, fy: b.fy, unit: b.unit };
      }
      return { ...u, breakdown: clean };
    });

    return { fy: fyStr, company, categories, users: userPayload };
  }
}
