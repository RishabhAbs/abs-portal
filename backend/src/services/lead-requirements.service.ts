import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { NotificationService } from './notification.service';

@Injectable()
export class LeadRequirementsService implements OnModuleInit {
  private readonly logger = new Logger(LeadRequirementsService.name);

  constructor(
    private db: DbService,
    private notificationService: NotificationService,
  ) {}

  async onModuleInit() {
    // Requirements table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lead_requirements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_call_id INT NOT NULL,
        description TEXT NOT NULL,
        assigned_to VARCHAR(100) NULL,
        status ENUM('Pending','In Progress','Completed','Transferred','Cancelled') DEFAULT 'Pending',
        priority ENUM('Low','Medium','High','Urgent') DEFAULT 'Medium',
        deadline DATE NULL,
        completed_at DATETIME NULL,
        completed_by VARCHAR(100) NULL,
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_scid (service_call_id),
        INDEX idx_assigned (assigned_to),
        INDEX idx_status (status)
      )
    `);

    // Requirement updates / activity timeline
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lead_requirement_updates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        requirement_id INT NOT NULL,
        update_type ENUM('Remark','StatusChange','Assignment','Transfer','FollowUp','Completion','Created') NOT NULL,
        content TEXT NULL,
        old_value VARCHAR(255) NULL,
        new_value VARCHAR(255) NULL,
        next_followup_date DATE NULL,
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_reqid (requirement_id)
      )
    `);

    // Lead-level follow-ups
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS lead_followups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_call_id INT NOT NULL,
        content TEXT NOT NULL,
        followup_date DATE NULL,
        status ENUM('Pending','Done') DEFAULT 'Pending',
        completed_at DATETIME NULL,
        created_by VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_scid (service_call_id)
      )
    `);

    // Add amount column to lead_requirements if missing
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN amount DECIMAL(12,2) NULL AFTER description`); } catch (e) {}
    // Add dev_status and testing_status columns
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN dev_status VARCHAR(50) DEFAULT 'Pending' AFTER status`); } catch (e) {}
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN testing_status VARCHAR(50) DEFAULT 'Pending' AFTER dev_status`); } catch (e) {}
    // Two-stage completion: dev marks done → handler finalizes.
    // dev_completed_* is set when the assigned developer marks a requirement
    // complete; status stays 'In Progress' until the handler finalizes, at which
    // point completed_at/by get set and status moves to 'Completed'.
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN dev_completed_at DATETIME NULL AFTER completed_by`); } catch (e) {}
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN dev_completed_by VARCHAR(100) NULL AFTER dev_completed_at`); } catch (e) {}
    // Lead pipeline stage: where the requirement is in the sales/delivery flow
    try { await this.db.execute(`ALTER TABLE lead_requirements ADD COLUMN stage VARCHAR(50) DEFAULT 'Pending' AFTER status`); } catch (e) {}
    try { await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN dev_completed_at DATETIME NULL AFTER status`); } catch (e) {}
    try { await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN dev_completed_by VARCHAR(100) NULL AFTER dev_completed_at`); } catch (e) {}
    // Add deadline and next_update_date to lead_notes if missing
    try { await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN deadline DATE NULL AFTER status`); } catch (e) {}
    try { await this.db.execute(`ALTER TABLE lead_notes ADD COLUMN next_update_date DATE NULL AFTER deadline`); } catch (e) {}

    this.logger.log('lead_requirements, lead_requirement_updates, lead_followups tables ready');
  }

  // ── Lead Detail (aggregated) ──

  async getLeadDetail(id: number) {
    const leads = await this.db.query<any>(
      `SELECT sc.*, c.company as customer_name
       FROM service_calls sc
       LEFT JOIN customer c ON sc.customer_id = c.id
       WHERE sc.id = ?`,
      [id],
    );
    if (!leads.length) return { success: false, message: 'Lead not found' };

    const lead = leads[0];

    const requirements = await this.db.query<any>(
      `SELECT lr.*,
        (SELECT COUNT(*) FROM lead_requirement_updates WHERE requirement_id = lr.id) as update_count,
        (SELECT content FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark,
        (SELECT created_by FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_by,
        (SELECT created_at FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_at
       FROM lead_requirements lr
       WHERE lr.service_call_id = ?
       ORDER BY lr.created_at DESC`,
      [id],
    );

    const followups = await this.db.query<any>(
      `SELECT * FROM lead_followups WHERE service_call_id = ? ORDER BY created_at DESC`,
      [id],
    );

    const stats = {
      total_requirements: requirements.length,
      pending: requirements.filter(r => r.status === 'Pending' || r.status === 'In Progress' || r.status === 'Transferred').length,
      completed: requirements.filter(r => r.status === 'Completed').length,
      overdue: requirements.filter(r => r.deadline && new Date(r.deadline) < new Date() && r.status !== 'Completed' && r.status !== 'Cancelled').length,
      pending_followups: followups.filter(f => f.status === 'Pending').length,
    };

    return { success: true, data: { lead, requirements, followups, stats } };
  }

  // ── Requirements CRUD ──

  async getRequirements(serviceCallId: number, status?: string) {
    let sql = `
      SELECT lr.*,
        (SELECT COUNT(*) FROM lead_requirement_updates WHERE requirement_id = lr.id) as update_count,
        (SELECT content FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark,
        (SELECT created_by FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_by,
        (SELECT created_at FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_at
      FROM lead_requirements lr
      WHERE lr.service_call_id = ?
    `;
    const params: any[] = [serviceCallId];

    if (status === 'completed') {
      sql += ` AND lr.status = 'Completed'`;
    } else if (status === 'active') {
      sql += ` AND lr.status NOT IN ('Completed', 'Cancelled')`;
    }

    sql += ` ORDER BY lr.created_at DESC`;
    const data = await this.db.query<any>(sql, params);
    return { success: true, data };
  }

  async addRequirement(
    serviceCallId: number,
    data: { description: string; assigned_to?: string; priority?: string; deadline?: string; amount?: number },
    createdBy: string,
  ) {
    await this.db.execute(
      `INSERT INTO lead_requirements (service_call_id, description, amount, assigned_to, priority, deadline, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [serviceCallId, data.description, data.amount || null, data.assigned_to || null, data.priority || 'Medium', data.deadline || null, createdBy],
    );

    // Get inserted ID
    const rows = await this.db.query<any>('SELECT LAST_INSERT_ID() as id');
    const reqId = rows[0].id;

    // Log creation
    await this.db.execute(
      `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, created_by)
       VALUES (?, 'Created', ?, ?)`,
      [reqId, `Created with priority ${data.priority || 'Medium'}${data.deadline ? ', deadline ' + data.deadline : ''}`, createdBy],
    );

    // Log assignment if assigned
    if (data.assigned_to) {
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, new_value, created_by)
         VALUES (?, 'Assignment', ?, ?, ?)`,
        [reqId, `Assigned to ${data.assigned_to}`, data.assigned_to, createdBy],
      );

      // Notify assigned user
      try {
        const leads = await this.db.query<any>('SELECT sc.mobile_no, sc.contact_person, c.company as customer_name FROM service_calls sc LEFT JOIN customer c ON sc.customer_id = c.id WHERE sc.id = ?', [serviceCallId]);
        const leadName = leads[0]?.customer_name || leads[0]?.mobile_no || 'Unknown';
        await this.notificationService.sendToUser(data.assigned_to, {
          title: 'New Requirement Assigned',
          body: `${leadName}: ${data.description.substring(0, 80)}`,
          url: `/lead/${serviceCallId}`,
        });
      } catch (e) {
        this.logger.warn('Failed to send assignment notification', e);
      }
    }

    return { success: true, message: 'Requirement added', id: reqId };
  }

  async updateRequirement(
    reqId: number,
    data: { status?: string; stage?: string; remark?: string; next_followup_date?: string },
    updatedBy: string,
  ) {
    const existing = await this.db.query<any>('SELECT * FROM lead_requirements WHERE id = ?', [reqId]);
    if (!existing.length) return { success: false, message: 'Requirement not found' };

    const req = existing[0];

    // Update status if changed
    if (data.status && data.status !== req.status) {
      await this.db.execute('UPDATE lead_requirements SET status = ? WHERE id = ?', [data.status, reqId]);
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, old_value, new_value, created_by)
         VALUES (?, 'StatusChange', ?, ?, ?)`,
        [reqId, req.status, data.status, updatedBy],
      );
    }

    // Update stage (lead pipeline phase) if changed
    if (data.stage && data.stage !== (req.stage || 'Pending')) {
      await this.db.execute('UPDATE lead_requirements SET stage = ? WHERE id = ?', [data.stage, reqId]);
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, old_value, new_value, content, created_by)
         VALUES (?, 'StatusChange', ?, ?, ?, ?)`,
        [reqId, req.stage || 'Pending', data.stage, `Stage: ${req.stage || 'Pending'} → ${data.stage}`, updatedBy],
      );
    }

    // Add remark
    if (data.remark) {
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, next_followup_date, created_by)
         VALUES (?, 'Remark', ?, ?, ?)`,
        [reqId, data.remark, data.next_followup_date || null, updatedBy],
      );
    }

    // Add follow-up date log
    if (data.next_followup_date && !data.remark) {
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, next_followup_date, created_by)
         VALUES (?, 'FollowUp', ?, ?, ?)`,
        [reqId, `Next follow-up set for ${data.next_followup_date}`, data.next_followup_date, updatedBy],
      );
    }

    return { success: true, message: 'Requirement updated' };
  }

  async completeRequirement(
    reqId: number,
    data: { remark?: string; action: 'stop' | 'transfer' | 'direct_transfer'; transfer_to?: string },
    completedBy: string,
    completedByIsAdmin: boolean = false,
  ) {
    const existing = await this.db.query<any>('SELECT * FROM lead_requirements WHERE id = ?', [reqId]);
    if (!existing.length) return { success: false, message: 'Requirement not found' };

    const req = existing[0];

    if (data.action === 'stop') {
      // Determine stage: dev marking complete (stage 1) vs handler finalizing (stage 2).
      // Handler = service_calls.taken_by (the salesperson who took the lead).
      // Finalize if: (a) caller is admin, (b) caller is the handler, or
      // (c) dev stage already happened and caller != dev (handler confirming).
      const handlerRow = await this.db.queryOne<any>(
        'SELECT taken_by FROM service_calls WHERE id = ?',
        [req.service_call_id],
      );
      const handler = handlerRow?.taken_by || null;
      const callerIsDev = completedBy === req.assigned_to;
      const callerIsHandler = !!handler && completedBy === handler;
      const alreadyDevCompleted = !!req.dev_completed_at;

      // Dev stage: caller is the assigned developer, dev stage not yet recorded,
      // caller is not also the handler, and not admin.
      const isDevStage = callerIsDev && !alreadyDevCompleted && !callerIsHandler && !completedByIsAdmin;

      if (isDevStage) {
        await this.db.execute(
          `UPDATE lead_requirements SET dev_completed_at = NOW(), dev_completed_by = ? WHERE id = ?`,
          [completedBy, reqId],
        );
        await this.db.execute(
          `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, created_by)
           VALUES (?, 'Completion', ?, ?)`,
          [reqId, data.remark || `Dev completed by ${completedBy} — awaiting handler finalize`, completedBy],
        );

        // Notify handler that finalize is required
        if (handler) {
          try {
            const leads = await this.db.query<any>(
              `SELECT sc.mobile_no, c.company as customer_name FROM service_calls sc
               LEFT JOIN customer c ON sc.customer_id = c.id WHERE sc.id = ?`,
              [req.service_call_id],
            );
            const leadName = leads[0]?.customer_name || leads[0]?.mobile_no || 'Lead';
            await this.notificationService.sendToUser(handler, {
              title: 'Dev Completed Requirement',
              body: `${leadName}: ${req.description.substring(0, 80)} — please finalize`,
              url: `/lead/${req.service_call_id}`,
            });
          } catch (e) { this.logger.warn('Failed to notify handler of dev completion', e); }
        }

        return { success: true, message: 'Marked dev-complete. Awaiting handler finalize.', stage: 'dev' };
      }

      // Finalize stage (handler/admin, or dev=handler): full complete
      await this.db.execute(
        `UPDATE lead_requirements SET status = 'Completed', completed_at = NOW(), completed_by = ?,
           dev_completed_at = COALESCE(dev_completed_at, NOW()),
           dev_completed_by = COALESCE(dev_completed_by, ?)
         WHERE id = ?`,
        [completedBy, completedBy, reqId],
      );
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, created_by)
         VALUES (?, 'Completion', ?, ?)`,
        [reqId, data.remark || `Finalized by ${completedBy}`, completedBy],
      );
    } else if (data.action === 'transfer' || data.action === 'direct_transfer') {
      if (!data.transfer_to) return { success: false, message: 'transfer_to is required' };

      const oldAssignee = req.assigned_to;

      // Update assignment
      await this.db.execute(
        `UPDATE lead_requirements SET assigned_to = ?, status = 'Pending' WHERE id = ?`,
        [data.transfer_to, reqId],
      );

      // Log transfer
      const transferType = data.action === 'direct_transfer' ? 'Direct transfer' : 'Completed & transferred';
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, old_value, new_value, created_by)
         VALUES (?, 'Transfer', ?, ?, ?, ?)`,
        [reqId, data.remark || `${transferType}: ${oldAssignee} → ${data.transfer_to}`, oldAssignee, data.transfer_to, completedBy],
      );

      // Notify new assignee
      try {
        const leads = await this.db.query<any>(
          `SELECT sc.mobile_no, sc.contact_person, c.company as customer_name FROM lead_requirements lr
           JOIN service_calls sc ON lr.service_call_id = sc.id LEFT JOIN customer c ON sc.customer_id = c.id WHERE lr.id = ?`,
          [reqId],
        );
        const leadName = leads[0]?.customer_name || leads[0]?.mobile_no || 'Unknown';
        await this.notificationService.sendToUser(data.transfer_to, {
          title: 'Requirement Transferred to You',
          body: `${leadName}: ${req.description.substring(0, 80)}`,
          url: `/lead/${req.service_call_id}`,
        });
      } catch (e) {
        this.logger.warn('Failed to send transfer notification', e);
      }
    }

    return { success: true, message: 'Requirement completed' };
  }

  async transferRequirement(
    reqId: number,
    data: { transfer_to: string; remark?: string },
    transferredBy: string,
  ) {
    const existing = await this.db.query<any>('SELECT * FROM lead_requirements WHERE id = ?', [reqId]);
    if (!existing.length) return { success: false, message: 'Requirement not found' };

    const req = existing[0];
    const oldAssignee = req.assigned_to;

    await this.db.execute(
      `UPDATE lead_requirements SET assigned_to = ? WHERE id = ?`,
      [data.transfer_to, reqId],
    );

    await this.db.execute(
      `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, old_value, new_value, created_by)
       VALUES (?, 'Transfer', ?, ?, ?, ?)`,
      [reqId, data.remark || `Transferred: ${oldAssignee} → ${data.transfer_to}`, oldAssignee, data.transfer_to, transferredBy],
    );

    // Notify new assignee
    try {
      const leads = await this.db.query<any>(
        `SELECT sc.mobile_no, sc.contact_person, c.company as customer_name FROM lead_requirements lr
         JOIN service_calls sc ON lr.service_call_id = sc.id LEFT JOIN customer c ON sc.customer_id = c.id WHERE lr.id = ?`,
        [reqId],
      );
      const leadName = leads[0]?.customer_name || leads[0]?.mobile_no || 'Unknown';
      await this.notificationService.sendToUser(data.transfer_to, {
        title: 'Requirement Transferred to You',
        body: `${leadName}: ${req.description.substring(0, 80)}`,
        url: `/lead/${req.service_call_id}`,
      });
    } catch (e) {
      this.logger.warn('Failed to send transfer notification', e);
    }

    return { success: true, message: 'Requirement transferred' };
  }

  async getRequirementUpdates(reqId: number) {
    const data = await this.db.query<any>(
      `SELECT * FROM lead_requirement_updates WHERE requirement_id = ? ORDER BY created_at DESC`,
      [reqId],
    );
    return { success: true, data };
  }

  // ── Follow-ups ──

  async getFollowups(serviceCallId: number) {
    const data = await this.db.query<any>(
      `SELECT * FROM lead_followups WHERE service_call_id = ? ORDER BY created_at DESC`,
      [serviceCallId],
    );
    return { success: true, data };
  }

  async addFollowup(
    serviceCallId: number,
    data: { content: string; followup_date?: string },
    createdBy: string,
  ) {
    await this.db.execute(
      `INSERT INTO lead_followups (service_call_id, content, followup_date, created_by) VALUES (?, ?, ?, ?)`,
      [serviceCallId, data.content, data.followup_date || null, createdBy],
    );
    return { success: true, message: 'Follow-up added' };
  }

  async markFollowupDone(followupId: number) {
    await this.db.execute(
      `UPDATE lead_followups SET status = 'Done', completed_at = NOW() WHERE id = ?`,
      [followupId],
    );
    return { success: true, message: 'Follow-up marked as done' };
  }

  // ── My Requirements (cross-project) ──

  async getMyRequirements(leadTypes: string[]) {
    if (!leadTypes.length) return { success: true, data: [] };
    const placeholders = leadTypes.map(() => '?').join(',');
    const data = await this.db.query<any>(
      `SELECT lr.*, sc.mobile_no, sc.lead_type, sc.contact_person, sc.taken_by as handler_name,
        c.company as customer_name,
        (SELECT content FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark,
        (SELECT created_at FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_at
       FROM lead_requirements lr
       JOIN service_calls sc ON lr.service_call_id = sc.id
       LEFT JOIN customer c ON sc.customer_id = c.id
       WHERE sc.lead_type IN (${placeholders}) AND lr.status NOT IN ('Completed', 'Cancelled')
       ORDER BY
         CASE WHEN lr.deadline IS NOT NULL AND lr.deadline < CURDATE() THEN 0
              WHEN lr.deadline IS NOT NULL AND lr.deadline = CURDATE() THEN 1
              ELSE 2 END,
         lr.deadline ASC, lr.created_at DESC`,
      leadTypes,
    );
    return { success: true, data };
  }

  // ── Update requirement status (inline from My Requirements) ──

  async updateRequirementStatus(reqId: number, status: string, updatedBy: string, updatedByIsAdmin: boolean = false) {
    const existing = await this.db.query<any>('SELECT * FROM lead_requirements WHERE id = ?', [reqId]);
    if (!existing.length) return { success: false, message: 'Requirement not found' };

    const req = existing[0];
    const oldStatus = req.status;

    // Two-stage rule: when a dev tries to set status='Completed' from the quick-mark,
    // route it through the dev-stage path (records dev_completed_*, keeps status='In Progress',
    // pings the handler). Everything else passes through as a plain status update.
    if (status === 'Completed') {
      const handlerRow = await this.db.queryOne<any>(
        'SELECT taken_by FROM service_calls WHERE id = ?',
        [req.service_call_id],
      );
      const handler = handlerRow?.taken_by || null;
      const callerIsDev = updatedBy === req.assigned_to;
      const callerIsHandler = !!handler && updatedBy === handler;
      const alreadyDevCompleted = !!req.dev_completed_at;
      const isDevStage = callerIsDev && !alreadyDevCompleted && !callerIsHandler && !updatedByIsAdmin;

      if (isDevStage) {
        await this.db.execute(
          `UPDATE lead_requirements SET dev_completed_at = NOW(), dev_completed_by = ?,
             status = CASE WHEN status IN ('Pending') THEN 'In Progress' ELSE status END
           WHERE id = ?`,
          [updatedBy, reqId],
        );
        await this.db.execute(
          `INSERT INTO lead_requirement_updates (requirement_id, update_type, content, created_by)
           VALUES (?, 'Completion', ?, ?)`,
          [reqId, `Dev completed by ${updatedBy} — awaiting handler finalize`, updatedBy],
        );
        if (handler) {
          try {
            const leads = await this.db.query<any>(
              `SELECT sc.mobile_no, c.company as customer_name FROM service_calls sc
               LEFT JOIN customer c ON sc.customer_id = c.id WHERE sc.id = ?`,
              [req.service_call_id],
            );
            const leadName = leads[0]?.customer_name || leads[0]?.mobile_no || 'Lead';
            await this.notificationService.sendToUser(handler, {
              title: 'Dev Completed Requirement',
              body: `${leadName}: ${req.description.substring(0, 80)} — please finalize`,
              url: `/lead/${req.service_call_id}`,
            });
          } catch (e) { this.logger.warn('Failed to notify handler of dev completion', e); }
        }
        return { success: true, message: 'Marked dev-complete. Awaiting handler finalize.', stage: 'dev' };
      }

      // Finalize by handler/admin
      await this.db.execute(
        `UPDATE lead_requirements SET status = 'Completed', completed_at = NOW(), completed_by = ?,
           dev_completed_at = COALESCE(dev_completed_at, NOW()),
           dev_completed_by = COALESCE(dev_completed_by, ?)
         WHERE id = ?`,
        [updatedBy, updatedBy, reqId],
      );
      await this.db.execute(
        `INSERT INTO lead_requirement_updates (requirement_id, update_type, old_value, new_value, created_by)
         VALUES (?, 'StatusChange', ?, ?, ?)`,
        [reqId, oldStatus, status, updatedBy],
      );
      return { success: true, message: 'Status updated', stage: 'final' };
    }

    // Non-Completed status change — passthrough
    await this.db.execute('UPDATE lead_requirements SET status = ? WHERE id = ?', [status, reqId]);
    await this.db.execute(
      `INSERT INTO lead_requirement_updates (requirement_id, update_type, old_value, new_value, created_by)
       VALUES (?, 'StatusChange', ?, ?, ?)`,
      [reqId, oldStatus, status, updatedBy],
    );
    return { success: true, message: 'Status updated' };
  }

  // ── Requirements Report (Global) ──

  async getRequirementsReport(filters: {
    search?: string; staff?: string; status?: string; priority?: string;
    startDate?: string; endDate?: string; page?: number; limit?: number;
    sortBy?: string; sortOrder?: string;
  }) {
    const page = parseInt(String(filters.page)) || 1;
    const limit = parseInt(String(filters.limit)) || 25;
    const offset = (page - 1) * limit;
    const params: any[] = [];
    let where = ' WHERE 1=1 ';

    if (filters.search) {
      where += ` AND (lr.description LIKE ? OR c.company LIKE ? OR sc.contact_person LIKE ? OR sc.mobile_no LIKE ?)`;
      const s = `%${filters.search}%`;
      params.push(s, s, s, s);
    }
    if (filters.staff) {
      where += ` AND lr.assigned_to = ?`;
      params.push(filters.staff);
    }
    if (filters.status) {
      where += ` AND lr.status = ?`;
      params.push(filters.status);
    }
    if (filters.priority) {
      where += ` AND lr.priority = ?`;
      params.push(filters.priority);
    }
    if (filters.startDate) {
      where += ` AND DATE(lr.created_at) >= ?`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where += ` AND DATE(lr.created_at) <= ?`;
      params.push(filters.endDate);
    }

    const sortDir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const allowedSort: Record<string, string> = {
      created_at: 'lr.created_at', deadline: 'lr.deadline', priority: 'lr.priority',
      status: 'lr.status', assigned_to: 'lr.assigned_to', customer_name: 'c.company',
    };
    const orderCol = allowedSort[filters.sortBy || ''] || 'lr.created_at';

    // Count
    const countRows = await this.db.query<any>(
      `SELECT COUNT(*) as total FROM lead_requirements lr
       JOIN service_calls sc ON lr.service_call_id = sc.id
       LEFT JOIN customer c ON sc.customer_id = c.id ${where}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    // Data
    const data = await this.db.query<any>(
      `SELECT lr.*, sc.mobile_no, sc.lead_type, sc.contact_person, sc.id as lead_id,
        c.company as customer_name,
        (SELECT COUNT(*) FROM lead_requirement_updates WHERE requirement_id = lr.id) as update_count,
        (SELECT content FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark,
        (SELECT created_by FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_by,
        (SELECT created_at FROM lead_requirement_updates WHERE requirement_id = lr.id ORDER BY created_at DESC LIMIT 1) as latest_remark_at
       FROM lead_requirements lr
       JOIN service_calls sc ON lr.service_call_id = sc.id
       LEFT JOIN customer c ON sc.customer_id = c.id
       ${where}
       ORDER BY ${orderCol} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { success: true, data, total, page, limit };
  }

  // ── Correction Report (Changes / Amendments audit trail) ──

  async getCorrectionReport(filters: {
    search?: string; staff?: string; updateType?: string;
    startDate?: string; endDate?: string; page?: number; limit?: number;
  }) {
    const page = parseInt(String(filters.page)) || 1;
    const limit = parseInt(String(filters.limit)) || 25;
    const offset = (page - 1) * limit;
    const params: any[] = [];
    let where = ' WHERE 1=1 ';

    if (filters.search) {
      where += ` AND (lru.content LIKE ? OR c.company LIKE ? OR lr.description LIKE ? OR lru.created_by LIKE ?)`;
      const s = `%${filters.search}%`;
      params.push(s, s, s, s);
    }
    if (filters.staff) {
      where += ` AND lru.created_by = ?`;
      params.push(filters.staff);
    }
    if (filters.updateType) {
      where += ` AND lru.update_type = ?`;
      params.push(filters.updateType);
    }
    if (filters.startDate) {
      where += ` AND DATE(lru.created_at) >= ?`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where += ` AND DATE(lru.created_at) <= ?`;
      params.push(filters.endDate);
    }

    const countRows = await this.db.query<any>(
      `SELECT COUNT(*) as total FROM lead_requirement_updates lru
       JOIN lead_requirements lr ON lru.requirement_id = lr.id
       JOIN service_calls sc ON lr.service_call_id = sc.id
       LEFT JOIN customer c ON sc.customer_id = c.id ${where}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    const data = await this.db.query<any>(
      `SELECT lru.*, lr.description as requirement_description, lr.assigned_to, lr.status as requirement_status,
        sc.mobile_no, sc.lead_type, sc.contact_person, sc.id as lead_id,
        c.company as customer_name
       FROM lead_requirement_updates lru
       JOIN lead_requirements lr ON lru.requirement_id = lr.id
       JOIN service_calls sc ON lr.service_call_id = sc.id
       LEFT JOIN customer c ON sc.customer_id = c.id
       ${where}
       ORDER BY lru.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { success: true, data, total, page, limit };
  }
}
