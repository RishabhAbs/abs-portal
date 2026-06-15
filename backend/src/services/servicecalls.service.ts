import { Injectable, OnModuleInit, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { NotificationService } from './notification.service';

export interface ServiceCall {
  id: number;
  mobile_no: string;
  contact_person: string | null;
  service_type: string | null;
  remark: string | null;
  serial_number: string | null;
  expire_date: string | null;
  flavor: string | null;
  status: 'Open' | 'In Progress' | 'Closed' | 'Confirmed' | 'Cancelled';
  customer_id: number | null;
  taken_by: string | null;
  taken_at: string | null;
  resolution_note: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  entry_type: 'Service' | 'Lead';
  lead_type: string | null;
}

@Injectable()
export class ServiceCallsService implements OnModuleInit {
  private readonly logger = new Logger(ServiceCallsService.name);

  constructor(
    private db: DbService,
    private notificationService: NotificationService,
  ) {}

  async onModuleInit() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS service_calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mobile_no VARCHAR(15) NOT NULL,
        contact_person VARCHAR(100) NULL,
        service_type VARCHAR(50) NULL,
        remark TEXT,
        serial_number VARCHAR(100) NULL,
        expire_date DATE NULL,
        flavor VARCHAR(50) NULL,
        status ENUM('Open', 'In Progress', 'Closed', 'Confirmed', 'Cancelled') DEFAULT 'Open',
        customer_id INT NULL,
        taken_by VARCHAR(100) NULL,
        taken_at DATETIME NULL,
        resolution_note TEXT NULL,
        closed_at DATETIME NULL,
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add columns if table already exists
    const newCols = [
      { name: 'contact_person',  def: 'VARCHAR(100) NULL AFTER mobile_no' },
      { name: 'service_type',    def: 'VARCHAR(50) NULL AFTER contact_person' },
      { name: 'serial_number',   def: 'VARCHAR(100) NULL AFTER remark' },
      { name: 'expire_date',     def: 'DATE NULL AFTER serial_number' },
      { name: 'flavor',          def: 'VARCHAR(50) NULL AFTER expire_date' },
      { name: 'transferred_by',  def: 'VARCHAR(255) NULL AFTER taken_at' },
      { name: 'transferred_at',  def: 'DATETIME NULL AFTER transferred_by' },
      { name: 'confirmed_by',    def: 'VARCHAR(100) NULL AFTER closed_at' },
      { name: 'confirmed_at',    def: 'DATETIME NULL AFTER confirmed_by' },
      { name: 'satisfaction_rating', def: 'TINYINT NULL AFTER confirmed_at' },
      { name: 'reopened_by',     def: 'VARCHAR(100) NULL AFTER confirmed_at' },
      { name: 'reopened_at',     def: 'DATETIME NULL AFTER reopened_by' },
      { name: 'entry_type',     def: "VARCHAR(20) NOT NULL DEFAULT 'Service' AFTER updated_at" },
      { name: 'lead_type',      def: 'VARCHAR(50) NULL AFTER entry_type' },
      // Developer who will technically handle this lead/service. Nullable — filled
      // from the dev-picker in the Lead Joint / Close modal (filtered by the dev's
      // my_requirements permission matching lead_type).
      { name: 'assigned_developer', def: 'VARCHAR(100) NULL AFTER lead_type' },
      // ── Lead → Voucher linkage ──
      // voucher_id: the bill that closed this lead (null while lead is open or cancelled).
      // closed_via: how the lead reached Closed state — Billing (voucher created) or Cancelled.
      // Manual close (without billing) is no longer permitted; closeService now requires
      // a voucher_id, ensuring the only paths to Closed are voucher save or cancel.
      { name: 'voucher_id', def: 'INT NULL AFTER assigned_developer' },
      { name: 'closed_via', def: "ENUM('Billing','Cancelled') NULL AFTER voucher_id" },
      // Website-submitted entries are tagged source='website' for badge display
      { name: 'source', def: "VARCHAR(20) NULL AFTER closed_via" },
      // Extra fields captured from the website contact form
      { name: 'company_name', def: 'VARCHAR(255) NULL AFTER source' },
      { name: 'email', def: 'VARCHAR(255) NULL AFTER company_name' },
    ];
    for (const col of newCols) {
      try {
        await this.db.execute(`ALTER TABLE service_calls ADD COLUMN ${col.name} ${col.def}`);
      } catch (e) { /* column already exists */ }
    }

    // Update status enum if necessary (MySQL specific for EXISTING tables)
    try {
      await this.db.execute(`ALTER TABLE service_calls MODIFY COLUMN status ENUM('Open', 'In Progress', 'Closed', 'Confirmed', 'Cancelled') DEFAULT 'Open'`);
    } catch (e) { /* fails if already updated or specific DB restrict */ }

    // Index on voucher_id for fast reverse lookup (find the lead a voucher closed).
    try {
      await this.db.execute(`ALTER TABLE service_calls ADD INDEX idx_voucher_id (voucher_id)`);
    } catch (e) { /* index already exists */ }

    // Lead notes/history table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lead_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_call_id INT NOT NULL,
        note_type VARCHAR(20) NOT NULL DEFAULT 'Remark',
        content TEXT NOT NULL,
        assigned_to VARCHAR(100) NULL,
        status ENUM('Pending','In Progress','Completed') DEFAULT 'Pending',
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_service_call_id (service_call_id),
        INDEX idx_assigned_to (assigned_to)
      )
    `);

    // Add assigned_to and status columns if missing (existing table migration)
    try {
      await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN assigned_to VARCHAR(100) NULL AFTER content`);
    } catch (e) { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN status ENUM('Pending','In Progress','Completed') DEFAULT 'Pending' AFTER assigned_to`);
    } catch (e) { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE lead_notes ADD INDEX idx_assigned_to (assigned_to)`);
    } catch (e) { /* index already exists */ }
    try {
      // stage: lead pipeline phase captured per Update note
      await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN stage VARCHAR(50) NULL AFTER next_update_date`);
    } catch (e) { /* column already exists */ }
  }

  async findAll(status?: string, taken_by?: string, search?: string, startDate?: string, endDate?: string, staff?: string, limitAll?: boolean, entryType?: string): Promise<{ data: any[]; total: number }> {
    let where = 'WHERE sc.status IS NOT NULL';
    const params: any[] = [];

    // Filter by entry_type (Service or Lead)
    if (entryType && (entryType === 'Service' || entryType === 'Lead')) {
      where += " AND sc.entry_type = ?";
      params.push(entryType);
    } else {
      where += " AND (sc.entry_type = 'Service' OR sc.entry_type IS NULL)";
    }

    if (staff && status !== 'Open') {
      where += " AND sc.taken_by = ?";
      params.push(staff);
    }

    if (status === 'Open') {
      // Everyone can see all open service calls
      where += " AND sc.status = 'Open'";
    } else if (status === 'In Progress') {
      where += " AND sc.status = 'In Progress'";
      // Normal users can only see their own in-progress calls
      if (limitAll && taken_by) {
        where += " AND (sc.created_by = ? OR sc.taken_by = ?)";
        params.push(taken_by, taken_by);
      }
    } else if (status === 'pending') {
      // My Pending: taken by this user and not closed
      where += " AND sc.status = 'In Progress' AND sc.taken_by = ?";
      params.push(taken_by);
    } else if (status === 'my_completed') {
      // My Completed: closed/confirmed calls created by or handled by this user
      where += " AND sc.status IN ('Closed', 'Confirmed') AND (sc.created_by = ? OR sc.taken_by = ?)";
      params.push(taken_by, taken_by);
    } else if (status === 'Closed') {
      where += " AND sc.status IN ('Closed', 'Confirmed')";
      // Normal users can only see their own closed calls
      if (limitAll && taken_by) {
        where += " AND (sc.created_by = ? OR sc.taken_by = ?)";
        params.push(taken_by, taken_by);
      }
    } else if (status === 'Cancelled') {
      where += " AND sc.status = 'Cancelled'";
      // Normal users can only see their own cancelled calls
      if (limitAll && taken_by) {
        where += " AND (sc.created_by = ? OR sc.taken_by = ?)";
        params.push(taken_by, taken_by);
      }
    } else if (status === 'my_cancelled') {
      where += " AND sc.status = 'Cancelled'";
      if (taken_by) {
        where += " AND (sc.created_by = ? OR sc.taken_by = ?)";
        params.push(taken_by, taken_by);
      }
    } else {
      // 'all' = no status filter, but apply user filter for normal users
      if (limitAll && taken_by) {
        where += " AND (sc.status = 'Open' OR sc.created_by = ? OR sc.taken_by = ?)";
        params.push(taken_by, taken_by);
      }
    }

    if (search) {
      where += ` AND (
        sc.mobile_no LIKE ? OR 
        sc.contact_person LIKE ? OR 
        sc.serial_number LIKE ? OR 
        c.company LIKE ?
      )`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    
    if (startDate) {
      where += " AND sc.created_at >= ?";
      params.push(startDate + " 00:00:00");
    }
    if (endDate) {
      where += " AND sc.created_at <= ?";
      params.push(endDate + " 23:59:59");
    }

    const customerJoin = 'LEFT JOIN customer c ON sc.customer_id = c.id';
    const countSql = `SELECT COUNT(*) as total FROM service_calls sc ${customerJoin} ${where}`;
    const countResult = await this.db.queryOne<{ total: number }>(countSql, params);

    // Latest Update note per lead: pulls the most recent lead_notes row of type
    // 'Update' for each service_call. Lead rows show remark/date/stage from this;
    // non-Lead rows just get NULLs (cheap).
    const sql = `
      SELECT sc.*, c.company as customer_name, sm.name as flavor_name, COALESCE(sc.entry_type, 'Service') as entry_type,
             latest.content AS latest_update_remark,
             latest.created_at AS latest_update_at,
             latest.next_update_date AS latest_update_next_date,
             latest.stage AS latest_update_stage,
             latest.created_by AS latest_update_by
      FROM service_calls sc
      ${customerJoin}
      LEFT JOIN singlemaster sm ON sc.flavor = sm.id
      LEFT JOIN (
        SELECT t.service_call_id, t.content, t.created_at, t.next_update_date, t.stage, t.created_by
        FROM (
          SELECT ln.service_call_id, ln.content, ln.created_at, ln.next_update_date, ln.created_by, ln.stage,
                 ROW_NUMBER() OVER (PARTITION BY ln.service_call_id ORDER BY ln.created_at DESC, ln.id DESC) AS rn
          FROM lead_notes ln
          WHERE ln.note_type = 'Update'
        ) t WHERE t.rn = 1
      ) latest ON latest.service_call_id = sc.id
      ${where}
      ORDER BY
        CASE sc.status
          WHEN 'Open' THEN 1
          WHEN 'In Progress' THEN 2
          WHEN 'Closed' THEN 3
          WHEN 'Confirmed' THEN 4
          WHEN 'Cancelled' THEN 5
        END,
        ${status === 'Closed' ? 'sc.closed_at DESC' : 'sc.created_at DESC'}
    `;
    const data = await this.db.query(sql, params);

    return { data, total: countResult?.total || 0 };
  }

  async getStats(startDate?: string, endDate?: string, staff?: string, userName?: string, limitAll?: boolean, entryType?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];

    // Filter by entry_type (Service or Lead)
    if (entryType && (entryType === 'Service' || entryType === 'Lead')) {
      where += " AND entry_type = ?";
      params.push(entryType);
    } else {
      where += " AND (entry_type = 'Service' OR entry_type IS NULL)";
    }

    if (staff) {
      // For general stats, we search for what this person has taken
      // HOWEVER, the 'open' count (unalloted) should NEVER be filtered by staff
      // so it remains total pool. We'll handle this in the SUM logic below.
      where += " AND (taken_by = ? OR status = 'Open')";
      params.push(staff);
    }

    if (startDate) {
      where += " AND created_at >= ?";
      params.push(startDate + " 00:00:00");
    }
    if (endDate) {
      where += " AND created_at <= ?";
      params.push(endDate + " 23:59:59");
    }

    const sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status IN ('Closed', 'Confirmed') THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM service_calls
      ${where}
    `;
    const stats = await this.db.queryOne<any>(sql, params);

    // User-specific counts for "My Pending" and "My Completed" tabs
    let myPending = 0;
    let myCompleted = 0;
    let myCancelled = 0;
    if (userName) {
      const userWhere = where + " AND (created_by = ? OR taken_by = ?)";
      const userParams = [...params, userName, userName];
      const userSql = `
        SELECT
          SUM(CASE WHEN status = 'In Progress' AND taken_by = ? THEN 1 ELSE 0 END) as my_pending,
          SUM(CASE WHEN status IN ('Closed', 'Confirmed') THEN 1 ELSE 0 END) as my_completed,
          SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as my_cancelled
        FROM service_calls
        ${userWhere}
      `;
      const userStats = await this.db.queryOne<any>(userSql, [userName, ...userParams]);
      myPending = Number(userStats?.my_pending || 0);
      myCompleted = Number(userStats?.my_completed || 0);
      myCancelled = Number(userStats?.my_cancelled || 0);
    }

    return {
      total: Number(stats?.total || 0),
      open: Number(stats?.open || 0),
      pending: Number(stats?.pending || 0),
      closed: Number(stats?.closed || 0),
      cancelled: Number(stats?.cancelled || 0),
      my_pending: myPending,
      my_completed: myCompleted,
      my_cancelled: myCancelled,
    };
  }

  async getFlavors(): Promise<{ id: number; name: string }[]> {
    return this.db.query(
      "SELECT id, name FROM singlemaster WHERE name IN ('Gold', 'Silver', 'Auditor') AND type = 'TallyFlavor' ORDER BY name"
    );
  }

  async lookupContact(mobile: string) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    const contact = await this.db.queryOne<{ id: number; contact_person: string; mobile_no: string }>(
      'SELECT id, contact_person, mobile_no FROM customer_contact_details WHERE mobile_no = ?',
      [cleanMobile]
    );
    return { success: true, found: !!contact, contact: contact || null };
  }

  async create(
    mobile_no: string,
    data: {
      service_type?: string | null;
      remark?: string | null;
      contact_person?: string | null;
      customer_id?: number | null;
      serial_number?: string | null;
      expire_date?: string | null;
      flavor?: string | null;
      assign_to?: string | null;
      entry_type?: string | null;
      lead_type?: string | null;
      source?: string | null;
      company_name?: string | null;
      email?: string | null;
    },
    created_by: string
  ) {
    const cleanMobile = mobile_no.replace(/[^0-9]/g, '').slice(-10);
    if (cleanMobile.length < 10) {
      throw new BadRequestException('Invalid mobile number. Must be at least 10 digits.');
    }

    const fields = ['mobile_no', 'service_type', 'remark', 'contact_person', 'customer_id', 'serial_number', 'expire_date', 'flavor', 'status', 'created_by', 'entry_type', 'lead_type'];
    const statusVal = data.assign_to ? 'In Progress' : 'Open';
    const values: any[] = [
      cleanMobile,
      data.service_type || null,
      data.remark || null,
      data.contact_person || null,
      data.customer_id || null,
      data.serial_number || null,
      data.expire_date || null,
      data.flavor || null,
      statusVal,
      created_by,
      data.entry_type || 'Service',
      data.lead_type || null,
    ];

    if (data.source) { fields.push('source'); values.push(data.source); }
    if (data.company_name) { fields.push('company_name'); values.push(data.company_name); }
    if (data.email) { fields.push('email'); values.push(data.email); }

    if (data.assign_to) {
      fields.push('taken_by', 'taken_at');
      values.push(data.assign_to, new Date().toISOString().slice(0, 19).replace('T', ' '));
    }

    const placeholders = fields.map(() => '?').join(', ');
    const result = await this.db.execute(
      `INSERT INTO service_calls (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    const typeLabel = data.entry_type === 'Lead' ? 'Lead' : 'Service call';
    const msg = data.assign_to ? `${typeLabel} created and assigned to ${data.assign_to}` : `${typeLabel} created`;
    const notifUrl = data.entry_type === 'Lead' ? '/lead/pending' : '/service/pending';

    // Push notifications (fire-and-forget, don't block response)
    try {
      if (data.assign_to) {
        // Assigned to specific user → notify them
        this.notificationService.sendToUser(data.assign_to, {
          title: `New ${typeLabel} Assigned`,
          body: `${data.contact_person || cleanMobile} - ${data.service_type || 'Service'}`,
          url: notifUrl,
          tag: `service-${result.insertId}`,
        }).catch(e => this.logger.error('Push notify assign failed: ' + e.message));
      } else {
        // Unalloted → notify all active subscribed users
        this.notificationService.sendToAll({
          title: `New ${typeLabel} - Unalloted`,
          body: `${data.contact_person || cleanMobile} - ${data.service_type || 'Service'}`,
          url: notifUrl,
          tag: `service-${result.insertId}`,
        }).catch(e => this.logger.error('Push notify unalloted failed: ' + e.message));
      }
    } catch (e: any) {
      this.logger.error('Push notification error: ' + e.message);
    }

    return { success: true, data: { id: result.insertId }, message: msg };
  }

  async takeService(id: number, taken_by: string) {
    const serviceCall = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!serviceCall) throw new NotFoundException('Service call not found');
    if (serviceCall.status !== 'Open') throw new BadRequestException('Service call is not in Open status');

    await this.db.execute(
      "UPDATE service_calls SET taken_by = ?, taken_at = NOW(), status = 'In Progress' WHERE id = ?",
      [taken_by, id]
    );

    // Notify the user who took it
    const takeUrl = serviceCall.entry_type === 'Lead' ? '/lead/pending' : '/service/pending';
    const takeLabel = serviceCall.entry_type === 'Lead' ? 'Lead' : 'Service Call';
    this.notificationService.sendToUser(taken_by, {
      title: `${takeLabel} Taken`,
      body: `You took ${takeLabel.toLowerCase()} #${id} - ${serviceCall.contact_person || serviceCall.mobile_no}`,
      url: takeUrl,
      tag: `service-${id}`,
    }).catch(e => this.logger.error('Push notify take failed: ' + e.message));

    return { success: true, message: 'Service taken successfully' };
  }

  async transferService(id: number, transfer_to: string, transferred_by: string) {
    const serviceCall = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!serviceCall) throw new NotFoundException('Service call not found');
    if (serviceCall.status === 'Closed') throw new BadRequestException('Service call is already closed');

    await this.db.execute(
      "UPDATE service_calls SET taken_by = ?, taken_at = NOW(), transferred_by = ?, transferred_at = NOW(), status = 'In Progress', updated_at = NOW() WHERE id = ?",
      [transfer_to, transferred_by, id]
    );

    // Notify the user it was transferred to
    const xferUrl = serviceCall.entry_type === 'Lead' ? '/lead/pending' : '/service/pending';
    const xferLabel = serviceCall.entry_type === 'Lead' ? 'Lead' : 'Service Call';
    this.notificationService.sendToUser(transfer_to, {
      title: `${xferLabel} Transferred to You`,
      body: `${serviceCall.contact_person || serviceCall.mobile_no} - transferred by ${transferred_by}`,
      url: xferUrl,
      tag: `service-${id}`,
    }).catch(e => this.logger.error('Push notify transfer failed: ' + e.message));

    return { success: true, message: `Service successfully transferred to ${transfer_to} by ${transferred_by}` };
  }

  async cancelService(id: number, cancelled_by: string) {
    const serviceCall = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!serviceCall) throw new NotFoundException('Service call not found');
    if (serviceCall.status === 'Closed') throw new BadRequestException('Cannot cancel a closed service call');

    await this.db.execute(
      "UPDATE service_calls SET status = 'Cancelled', updated_at = NOW() WHERE id = ?",
      [id]
    );

    return { success: true, message: 'Service call cancelled successfully' };
  }

  async closeService(
    id: number,
    data: {
      customer_id?: number;
      contact_person?: string;
      serial_number?: string;
      service_type?: string;
      remark?: string;
      expire_date?: string;
      flavor?: string;
      resolution_note?: string;
      assigned_developer?: string;
    }
  ) {
    const serviceCall = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!serviceCall) throw new NotFoundException('Service call not found');
    if (serviceCall.status === 'Closed') throw new BadRequestException('Service call is already closed');

    // Lead lifecycle policy: a Lead can only reach Closed via voucher creation
    // (vouchers.service.create → linkLeadAndAutoClose) or Cancel. Manual close
    // through this endpoint is blocked for leads to enforce the billing path.
    // Service entries (entry_type = 'Service') keep the legacy direct close.
    if ((serviceCall as any).entry_type === 'Lead') {
      throw new BadRequestException('Leads must be completed by creating a voucher (Bill & Close) or cancelled — direct close is not permitted.');
    }

    await this.db.execute(
      `UPDATE service_calls SET
        status = 'Closed',
        customer_id = ?,
        contact_person = ?,
        serial_number = ?,
        service_type = ?,
        remark = ?,
        expire_date = ?,
        flavor = ?,
        assigned_developer = ?,
        closed_at = NOW()
      WHERE id = ?`,
      [
        data.customer_id || serviceCall.customer_id || null,
        data.contact_person || serviceCall.contact_person || null,
        data.serial_number || serviceCall.serial_number || null,
        data.service_type || serviceCall.service_type || null,
        data.remark || serviceCall.remark || null,
        data.expire_date || serviceCall.expire_date || null,
        data.flavor || serviceCall.flavor || null,
        data.assigned_developer ?? (serviceCall as any).assigned_developer ?? null,
        id
      ]
    );

    // Map contact to customer if both provided
    if (data.customer_id && serviceCall.mobile_no) {
      const cleanMobile = serviceCall.mobile_no.replace(/[^0-9]/g, '').slice(-10);

      await this.db.withTransaction(async (conn) => {
        let mobileId: number;
        const existing = await this.db.queryOne<{ id: number }>(
          'SELECT id FROM customer_contact_details WHERE mobile_no = ?',
          [cleanMobile],
          conn
        );

        if (existing) {
          mobileId = existing.id;
          // Update person name if provided
          if (data.contact_person) {
            await this.db.execute(
              'UPDATE customer_contact_details SET contact_person = ? WHERE id = ?',
              [data.contact_person, mobileId],
              conn
            );
          }
        } else {
          const personName = data.contact_person || 'Service Call Contact';
          const res = await this.db.execute(
            'INSERT INTO customer_contact_details (contact_person, mobile_no, status, created_by, created_at) VALUES (?, ?, ?, ?, NOW())',
            [personName, cleanMobile, 'Active', 1],
            conn
          );
          mobileId = res.insertId;
        }

        const mapping = await this.db.queryOne<{ id: number }>(
          'SELECT id FROM customer_contact_mapping_data WHERE customer_id = ? AND mobile_id = ?',
          [data.customer_id, mobileId],
          conn
        );

        if (!mapping) {
          await this.db.execute(
            'INSERT INTO customer_contact_mapping_data (customer_id, mobile_id, primary_contact, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [data.customer_id, mobileId, 'No', 'Active', 1],
            conn
          );
        }
      });
    }

    return { success: true, message: 'Service call closed' };
  }

  async joinLead(
    id: number,
    data: {
      customer_id?: number;
      contact_person?: string;
      serial_number?: string;
      service_type?: string;
      remark?: string;
      expire_date?: string;
      flavor?: string;
      assigned_developer?: string;
    }
  ) {
    const sc = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!sc) throw new NotFoundException('Lead not found');
    if (sc.status === 'Closed' || sc.status === 'Cancelled') throw new BadRequestException('Cannot join a closed or cancelled lead');

    await this.db.execute(
      `UPDATE service_calls SET
        customer_id = ?,
        contact_person = ?,
        serial_number = ?,
        service_type = ?,
        remark = ?,
        expire_date = ?,
        flavor = ?,
        assigned_developer = ?
      WHERE id = ?`,
      [
        data.customer_id || sc.customer_id || null,
        data.contact_person || sc.contact_person || null,
        data.serial_number || sc.serial_number || null,
        data.service_type || sc.service_type || null,
        data.remark || sc.remark || null,
        data.expire_date || sc.expire_date || null,
        data.flavor || sc.flavor || null,
        data.assigned_developer ?? (sc as any).assigned_developer ?? null,
        id
      ]
    );

    // Map contact to customer if both provided
    if (data.customer_id && sc.mobile_no) {
      const cleanMobile = sc.mobile_no.replace(/[^0-9]/g, '').slice(-10);
      await this.db.withTransaction(async (conn) => {
        let mobileId: number;
        const existing = await this.db.queryOne<{ id: number }>(
          'SELECT id FROM customer_contact_details WHERE mobile_no = ?',
          [cleanMobile], conn
        );
        if (existing) {
          mobileId = existing.id;
          if (data.contact_person) {
            await this.db.execute('UPDATE customer_contact_details SET contact_person = ? WHERE id = ?', [data.contact_person, mobileId], conn);
          }
        } else {
          const res = await this.db.execute(
            'INSERT INTO customer_contact_details (contact_person, mobile_no, status, created_by, created_at) VALUES (?, ?, ?, ?, NOW())',
            [data.contact_person || 'Lead Contact', cleanMobile, 'Active', 1], conn
          );
          mobileId = res.insertId;
        }
        const mapping = await this.db.queryOne<{ id: number }>(
          'SELECT id FROM customer_contact_mapping_data WHERE customer_id = ? AND mobile_id = ?',
          [data.customer_id, mobileId], conn
        );
        if (!mapping) {
          await this.db.execute(
            'INSERT INTO customer_contact_mapping_data (customer_id, mobile_id, primary_contact, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [data.customer_id, mobileId, 'No', 'Active', 1], conn
          );
        }
      });
    }

    return { success: true, message: 'Lead joined successfully' };
  }

  async confirmService(id: number, userName: string, satisfactionRating?: number) {
    const sc = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!sc) throw new NotFoundException('Service call not found');
    if (sc.status !== 'Closed') throw new BadRequestException('Only closed service calls can be confirmed');

    await this.db.execute(
      "UPDATE service_calls SET status = 'Confirmed', confirmed_by = ?, confirmed_at = NOW(), satisfaction_rating = ?, updated_at = NOW() WHERE id = ?",
      [userName, satisfactionRating || null, id]
    );
    return { success: true, message: 'Service call confirmed' };
  }

  async reopenService(id: number, userName: string, assignTo?: string) {
    const sc = await this.db.queryOne<ServiceCall>('SELECT * FROM service_calls WHERE id = ?', [id]);
    if (!sc) throw new NotFoundException('Service call not found');
    if (sc.status !== 'Closed') throw new BadRequestException('Only closed service calls can be reopened');

    if (assignTo) {
      // Reopen and assign to a specific user → status = 'In Progress'
      await this.db.execute(
        "UPDATE service_calls SET status = 'In Progress', taken_by = ?, taken_at = NOW(), reopened_by = ?, reopened_at = NOW(), closed_at = NULL, updated_at = NOW() WHERE id = ?",
        [assignTo, userName, id]
      );
      return { success: true, message: `Service call reopened and assigned to ${assignTo}` };
    } else {
      // Reopen without assignment → status = 'Open' so anyone can take it
      await this.db.execute(
        "UPDATE service_calls SET status = 'Open', taken_by = NULL, taken_at = NULL, reopened_by = ?, reopened_at = NOW(), closed_at = NULL, updated_at = NOW() WHERE id = ?",
        [userName, id]
      );
      return { success: true, message: 'Service call reopened as open' };
    }
  }

  async getUserWiseReport(startDate?: string, endDate?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (startDate) {
      where += " AND created_at >= ?";
      params.push(startDate + " 00:00:00");
    }
    if (endDate) {
      where += " AND created_at <= ?";
      params.push(endDate + " 23:59:59");
    }

    const sql = `
      SELECT 
        COALESCE(taken_by, 'Unassigned') as user_name,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status IN ('Closed', 'Confirmed') THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM service_calls
      ${where}
      GROUP BY COALESCE(taken_by, 'Unassigned')
      ORDER BY closed DESC, total DESC
    `;
    return this.db.query(sql, params);
  }

  async getDelayReport(startDate?: string, endDate?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (startDate) {
      where += " AND sc.created_at >= ?";
      params.push(startDate + " 00:00:00");
    }
    if (endDate) {
      where += " AND sc.created_at <= ?";
      params.push(endDate + " 23:59:59");
    }

    const sql = `
      SELECT 
        sc.id,
        sc.mobile_no,
        sc.contact_person,
        c.company as customer_name,
        sc.taken_by,
        sc.status,
        sc.created_at,
        sc.taken_at,
        sc.closed_at,
        TIMESTAMPDIFF(MINUTE, sc.created_at, IFNULL(sc.taken_at, NOW())) as response_delay_mins,
        CASE 
          WHEN sc.taken_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, sc.taken_at, IFNULL(sc.closed_at, NOW()))
          ELSE NULL
        END as resolution_delay_mins
      FROM service_calls sc
      LEFT JOIN customer c ON sc.customer_id = c.id
      ${where}
      ORDER BY sc.created_at DESC
    `;
    return this.db.query(sql, params);
  }

  async lookupTallySerial(serial: string) {
    const sql = `
      SELECT
        td.customerid as customer_id,
        c.company as customer_name,
        td.tallyflavor as flavor,
        sm.name as flavor_name,
        td.tallyexpirydate as expire_date
      FROM tallydetails td
      LEFT JOIN customer c ON td.customerid = c.id
      LEFT JOIN singlemaster sm ON td.tallyflavor = CAST(sm.id AS CHAR)
      WHERE td.tallyserial = ?
      LIMIT 1
    `;
    const result = await this.db.queryOne<any>(sql, [serial]);
    if (!result) {
      throw new NotFoundException('Tally serial not found');
    }
    return { success: true, data: result };
  }

  async getNotes(serviceCallId: number) {
    const rows = await this.db.query<any[]>(
      `SELECT id, service_call_id, note_type, content, assigned_to, status,
              dev_completed_at, dev_completed_by, deadline, next_update_date, stage,
              created_by, created_at
       FROM lead_notes WHERE service_call_id = ? ORDER BY created_at DESC`,
      [serviceCallId],
    );
    return { success: true, data: rows };
  }

  async addNote(serviceCallId: number, noteType: string, content: string, createdBy: string, assignedTo?: string, deadline?: string, nextUpdateDate?: string, stage?: string) {
    if (!content?.trim()) throw new BadRequestException('Content is required');
    if (!['Remark', 'Requirement', 'Correction', 'Update'].includes(noteType)) throw new BadRequestException('Invalid note type');

    // Stage only applies to Update notes; defaults to 'Pending' if not provided
    const effectiveStage = noteType === 'Update' ? (stage || 'Pending') : null;

    await this.db.execute(
      `INSERT INTO lead_notes (service_call_id, note_type, content, assigned_to, deadline, next_update_date, stage, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [serviceCallId, noteType, content.trim(), assignedTo || null, deadline || null, nextUpdateDate || null, effectiveStage, createdBy],
    );
    return { success: true, message: 'Note added successfully' };
  }

  async getMyCorrections(leadTypes: string[]) {
    if (!leadTypes.length) return { success: true, data: [] };
    const placeholders = leadTypes.map(() => '?').join(',');
    const rows = await this.db.query<any[]>(
      `SELECT ln.id, ln.service_call_id, ln.content, ln.assigned_to, ln.status, ln.deadline, ln.created_by, ln.created_at,
              ln.dev_completed_at, ln.dev_completed_by,
              sc.taken_by as handler_name,
              c.company as customer_name, sc.mobile_no, sc.service_type, sc.lead_type
       FROM lead_notes ln
       JOIN service_calls sc ON sc.id = ln.service_call_id
       LEFT JOIN customer c ON sc.customer_id = c.id
       WHERE sc.lead_type IN (${placeholders}) AND ln.note_type = 'Correction' AND ln.status != 'Completed'
       ORDER BY ln.created_at DESC`,
      leadTypes,
    );
    return { success: true, data: rows };
  }

  async updateNoteStatus(noteId: number, status: string, updatedBy: string, updatedByIsAdmin: boolean = false) {
    if (!['Pending', 'In Progress', 'Completed'].includes(status)) throw new BadRequestException('Invalid status');

    // Two-stage rule: if the assigned developer is marking a correction Completed,
    // record dev_completed_* but keep status at 'In Progress' until the handler
    // finalizes. Ping the handler.
    if (status === 'Completed') {
      const note = await this.db.queryOne<any>('SELECT * FROM lead_notes WHERE id = ?', [noteId]);
      if (!note) throw new BadRequestException('Note not found');
      const sc = await this.db.queryOne<any>('SELECT taken_by, mobile_no, customer_id FROM service_calls WHERE id = ?', [note.service_call_id]);
      const handler = sc?.taken_by || null;
      const callerIsDev = updatedBy === note.assigned_to;
      const callerIsHandler = !!handler && updatedBy === handler;
      const alreadyDevCompleted = !!note.dev_completed_at;
      const isDevStage = callerIsDev && !alreadyDevCompleted && !callerIsHandler && !updatedByIsAdmin;

      if (isDevStage) {
        await this.db.execute(
          `UPDATE lead_notes SET dev_completed_at = NOW(), dev_completed_by = ?,
             status = CASE WHEN status = 'Pending' THEN 'In Progress' ELSE status END
           WHERE id = ?`,
          [updatedBy, noteId],
        );
        if (handler) {
          try {
            const cust = sc?.customer_id
              ? await this.db.queryOne<any>('SELECT company FROM customer WHERE id = ?', [sc.customer_id])
              : null;
            const leadName = cust?.company || sc?.mobile_no || 'Lead';
            await this.notificationService.sendToUser(handler, {
              title: 'Dev Completed Correction',
              body: `${leadName}: ${String(note.content || '').substring(0, 80)} — please finalize`,
              url: `/lead/${note.service_call_id}`,
            });
          } catch (e) { this.logger.warn('Failed to notify handler of dev correction completion', e); }
        }
        return { success: true, message: 'Marked dev-complete. Awaiting handler finalize.', stage: 'dev' };
      }

      // Finalize
      await this.db.execute(
        `UPDATE lead_notes SET status = 'Completed',
           dev_completed_at = COALESCE(dev_completed_at, NOW()),
           dev_completed_by = COALESCE(dev_completed_by, ?)
         WHERE id = ?`,
        [updatedBy, noteId],
      );
      return { success: true, message: 'Status updated successfully', stage: 'final' };
    }

    await this.db.execute(
      `UPDATE lead_notes SET status = ? WHERE id = ?`,
      [status, noteId],
    );
    return { success: true, message: 'Status updated successfully' };
  }
}
