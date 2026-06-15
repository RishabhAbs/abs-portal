import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

const MONTHS = ['April','May','June','July','August','September','October','November','December','January','February','March'];
const TYPES = ['new_target','tss','cloud','tdl','app','visit','call'];
const TYPE_COLS = ['new_target_type','tss_type','cloud_type','tdl_type','app_type','visit_type','call_type'];

@Injectable()
export class TargetsService implements OnModuleInit {
  constructor(private db: DbService) {}

  async onModuleInit() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS user_targets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(100) NOT NULL,
        fy VARCHAR(10) NOT NULL,
        month VARCHAR(20) NOT NULL,
        new_target INT DEFAULT 0,
        tss INT DEFAULT 0,
        cloud INT DEFAULT 0,
        tdl INT DEFAULT 0,
        app INT DEFAULT 0,
        visit INT DEFAULT 0,
        \`call\` INT DEFAULT 0,
        new_target_type ENUM('qty','amount') DEFAULT 'qty',
        tss_type ENUM('qty','amount') DEFAULT 'qty',
        cloud_type ENUM('qty','amount') DEFAULT 'qty',
        tdl_type ENUM('qty','amount') DEFAULT 'qty',
        app_type ENUM('qty','amount') DEFAULT 'qty',
        visit_type ENUM('qty','amount') DEFAULT 'qty',
        call_type ENUM('qty','amount') DEFAULT 'qty',
        status ENUM('Draft','Pending','Approved') DEFAULT 'Draft',
        created_by VARCHAR(100) DEFAULT NULL,
        admin_note VARCHAR(500) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_target (user_name, fy, month)
      )
    `).catch(() => {});

    // Per-category unit type columns (replaces target_unit_types table)
    for (const col of TYPE_COLS) {
      await this.db.execute(
        `ALTER TABLE user_targets ADD COLUMN \`${col}\` ENUM('qty','amount') DEFAULT 'qty'`
      ).catch(() => {}); // ignore if column already exists
    }

    // One-time data migration from target_unit_types → user_targets.*_type (if old table exists)
    await this.migrateUnitTypesIntoTargets().catch(() => {});
  }

  // Copy any rows from the legacy target_unit_types table into the new per-category columns.
  // Safe to run every boot: it only writes when a row already exists for (user, fy, month).
  private async migrateUnitTypesIntoTargets(): Promise<void> {
    const exists = await this.db.queryOne<any>(
      `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'target_unit_types'`
    ).catch(() => null);
    if (!exists || !Number(exists?.c)) return;

    const legacy = await this.db.query<any>(
      `SELECT user_name, fy, type_name, unit_type FROM target_unit_types`
    ).catch(() => [] as any[]);

    for (const r of legacy) {
      if (!TYPES.includes(r.type_name)) continue;
      const col = `${r.type_name}_type`;
      await this.db.execute(
        `UPDATE user_targets SET \`${col}\` = ? WHERE user_name = ? AND fy = ?`,
        [r.unit_type, r.user_name, r.fy]
      ).catch(() => {});
    }
  }

  // Get current FY string e.g. "2026-27"
  static currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String(year + 1).slice(2)}`;
  }

  // ── Get unit types for a user+FY (reads from any existing row; types are uniform across months) ──
  async getUnitTypes(fy: string, userName: string): Promise<Record<string, string>> {
    const fyVal = fy || TargetsService.currentFY();
    const row = await this.db.queryOne<any>(
      `SELECT ${TYPE_COLS.map(c => `\`${c}\``).join(', ')}
       FROM user_targets WHERE user_name = ? AND fy = ? LIMIT 1`,
      [userName, fyVal]
    );
    const result: Record<string, string> = {};
    if (row) {
      for (const t of TYPES) result[t] = row[`${t}_type`] || 'qty';
    }
    return result;
  }

  // ── Save unit types for a user+FY across ALL month rows ──
  async saveUnitTypes(userName: string, fy: string, types: Record<string, string>): Promise<void> {
    const fyVal = fy || TargetsService.currentFY();
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [typeName, unitType] of Object.entries(types)) {
      if (!TYPES.includes(typeName)) continue;
      if (unitType !== 'qty' && unitType !== 'amount') continue;
      sets.push(`\`${typeName}_type\` = ?`);
      vals.push(unitType);
    }
    if (!sets.length) return;
    vals.push(userName, fyVal);
    await this.db.execute(
      `UPDATE user_targets SET ${sets.join(', ')}, updated_at = NOW() WHERE user_name = ? AND fy = ?`,
      vals,
    );
  }

  // ── Get all targets for a user (or all users for admin) ──
  async getTargets(fy: string, userName?: string): Promise<any[]> {
    const fyVal = fy || TargetsService.currentFY();
    if (userName) {
      return this.db.query<any>(
        `SELECT * FROM user_targets WHERE user_name = ? AND fy = ? ORDER BY FIELD(month,${MONTHS.map(() => '?').join(',')})`,
        [userName, fyVal, ...MONTHS]
      );
    }
    return this.db.query<any>(
      `SELECT * FROM user_targets WHERE fy = ? ORDER BY user_name, FIELD(month,${MONTHS.map(() => '?').join(',')})`,
      [fyVal, ...MONTHS]
    );
  }

  // ── User saves/updates their own target (goes to Pending) ──
  // Only TARGETS are saved here; achieved values are admin-managed via adminUpdate.
  async upsertTarget(userName: string, fy: string, month: string, data: any, createdBy: string): Promise<void> {
    const fyVal = fy || TargetsService.currentFY();
    await this.db.execute(
      `INSERT INTO user_targets (user_name, fy, month, new_target, tss, cloud, tdl, app, visit, \`call\`, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
       ON DUPLICATE KEY UPDATE
         new_target = VALUES(new_target), tss = VALUES(tss), cloud = VALUES(cloud),
         tdl = VALUES(tdl), app = VALUES(app), visit = VALUES(visit), \`call\` = VALUES(\`call\`),
         status = IF(status = 'Approved', 'Approved', 'Pending'),
         created_by = VALUES(created_by), updated_at = NOW()`,
      [
        userName, fyVal, month,
        data.new_target || 0, data.tss || 0, data.cloud || 0,
        data.tdl || 0, data.app || 0, data.visit || 0, data.call || 0,
        createdBy
      ]
    );
  }

  // ── Save full grid at once (all months for a user in one call) ──
  async saveGrid(userName: string, fy: string, rows: { month: string; [key: string]: any }[], createdBy: string): Promise<void> {
    for (const row of rows) {
      await this.upsertTarget(userName, fy, row.month, row, createdBy);
    }
  }

  // ── Admin: approve / edit a single row ──
  async adminUpdate(id: number, data: any): Promise<void> {
    const sets: string[] = [];
    const vals: any[] = [];
    const fields = ['new_target','tss','cloud','tdl','app','visit','call','status','admin_note'];
    for (const f of fields) {
      if (data[f] !== undefined) {
        sets.push(`\`${f}\` = ?`);
        vals.push(data[f]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    await this.db.execute(`UPDATE user_targets SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals);
  }

  // ── Admin: approve all pending for a user+FY ──
  async approveAll(userName: string, fy: string): Promise<void> {
    await this.db.execute(
      `UPDATE user_targets SET status = 'Approved', updated_at = NOW() WHERE user_name = ? AND fy = ? AND status = 'Pending'`,
      [userName, fy]
    );
  }

  // ── Admin: create target for any user directly (Approved) ──
  async adminCreate(userName: string, fy: string, rows: { month: string; [key: string]: any }[], adminName: string): Promise<void> {
    for (const row of rows) {
      await this.db.execute(
        `INSERT INTO user_targets (user_name, fy, month, new_target, tss, cloud, tdl, app, visit, \`call\`, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved', ?)
         ON DUPLICATE KEY UPDATE
           new_target = VALUES(new_target), tss = VALUES(tss), cloud = VALUES(cloud),
           tdl = VALUES(tdl), app = VALUES(app), visit = VALUES(visit), \`call\` = VALUES(\`call\`),
           status = 'Approved', created_by = VALUES(created_by), updated_at = NOW()`,
        [userName, fy, row.month,
         row.new_target || 0, row.tss || 0, row.cloud || 0,
         row.tdl || 0, row.app || 0, row.visit || 0, row.call || 0, adminName]
      );
    }
  }

  // ── Delete a row ──
  async delete(id: number): Promise<void> {
    await this.db.execute(`DELETE FROM user_targets WHERE id = ?`, [id]);
  }

  // ── Summary: all users pending count (for admin dashboard) ──
  async getPendingCount(): Promise<number> {
    const row = await this.db.queryOne<any>(`SELECT COUNT(*) as cnt FROM user_targets WHERE status = 'Pending'`);
    return row?.cnt || 0;
  }
}
