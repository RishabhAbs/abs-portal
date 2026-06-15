import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class GroupChangeService implements OnModuleInit {
  constructor(private db: DbService) {}

  async onModuleInit() {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS customer_group_change_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NOT NULL,
          customer_name VARCHAR(255),
          from_user_id VARCHAR(20),
          from_user_name VARCHAR(100),
          from_sub_user_id VARCHAR(20),
          from_sub_user_name VARCHAR(100),
          to_user_id VARCHAR(20),
          to_user_name VARCHAR(100),
          to_sub_user_id VARCHAR(20),
          to_sub_user_name VARCHAR(100),
          changed_by VARCHAR(100),
          changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_customer_id (customer_id),
          INDEX idx_changed_at (changed_at)
        )
      `);
      // Reseller change log — separate from group log so each table stays
      // narrow and unambiguous. The history endpoint UNIONs them with a
      // 'change_type' discriminator so the UI shows both in one feed.
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS customer_reseller_change_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NOT NULL,
          customer_name VARCHAR(255),
          from_reseller_id INT,
          from_reseller_name VARCHAR(100),
          to_reseller_id INT,
          to_reseller_name VARCHAR(100),
          changed_by VARCHAR(100),
          changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_customer_id (customer_id),
          INDEX idx_changed_at (changed_at)
        )
      `);
    } catch (e) {
      console.error('GroupChangeService: Table init error:', e.message);
    }
  }

  /**
   * Get all cloud users with their old_id and sub_user info
   */
  async getUsers(): Promise<any[]> {
    try {
      return await this.db.query<any>(`
        SELECT cu.id, cu.name, cu.old_id, cu.sub_user_id
        FROM cloud_users cu
        WHERE cu.status = 'active'
        ORDER BY cu.name ASC
      `);
    } catch (e) {
      console.error('GroupChangeService.getUsers error:', e.message);
      return [];
    }
  }

  /**
   * Get customers assigned to a specific cloud user
   */
  async getCustomersByUser(userId: string): Promise<any[]> {
    return this.db.query<any>(`
      SELECT c.id, c.company, c.cloud_group_id, c.subgroupid, c.\`group\`,
             cu.name as handler_name,
             cu2.name as sub_user_name
      FROM customer c
      LEFT JOIN cloud_users cu ON cu.id = c.cloud_group_id
      LEFT JOIN cloud_users cu2 ON cu2.id = c.subgroupid
      WHERE c.cloud_group_id = ?
      ORDER BY c.company ASC
    `, [userId]);
  }

  /**
   * Transfer selected customers from one user to another
   */
  async transferCustomers(
    customerIds: number[],
    toUserId: string,
    changedBy: string
  ): Promise<{ transferred: number }> {
    if (!customerIds.length) throw new BadRequestException('No customers selected');
    if (!toUserId) throw new BadRequestException('Target user is required');

    // Get target user details
    const toUser = await this.db.queryOne<any>(
      `SELECT cu.id, cu.name, cu.old_id, cu.sub_user_id, cu2.name as sub_user_name
       FROM cloud_users cu
       LEFT JOIN cloud_users cu2 ON cu2.id = cu.sub_user_id
       WHERE cu.id = ?`,
      [toUserId]
    );
    if (!toUser) throw new BadRequestException('Target user not found');

    const placeholders = customerIds.map(() => '?').join(',');

    // Get current state of these customers for logging
    const customers = await this.db.query<any>(`
      SELECT c.id, c.company, c.cloud_group_id, c.subgroupid, c.\`group\`,
             cu.name as from_user_name,
             cu2.name as from_sub_user_name
      FROM customer c
      LEFT JOIN cloud_users cu ON cu.id = c.cloud_group_id
      LEFT JOIN cloud_users cu2 ON cu2.id = c.subgroupid
      WHERE c.id IN (${placeholders})
    `, customerIds);

    // Log each change
    for (const cust of customers) {
      await this.db.execute(`
        INSERT INTO customer_group_change_log
          (customer_id, customer_name, from_user_id, from_user_name, from_sub_user_id, from_sub_user_name,
           to_user_id, to_user_name, to_sub_user_id, to_sub_user_name, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        cust.id,
        cust.company,
        cust.cloud_group_id,
        cust.from_user_name,
        cust.subgroupid,
        cust.from_sub_user_name,
        toUser.id,
        toUser.name,
        toUser.sub_user_id || null,
        toUser.sub_user_name || null,
        changedBy
      ]);
    }

    // Update customers: set new cloud_group_id, subgroupid, and group (old admin id)
    await this.db.execute(`
      UPDATE customer
      SET cloud_group_id = ?,
          subgroupid = ?,
          \`group\` = ?
      WHERE id IN (${placeholders})
    `, [toUser.id, toUser.sub_user_id || null, toUser.old_id || null, ...customerIds]);

    return { transferred: customers.length };
  }

  /** List all resellers — used by the New Reseller dropdown. */
  async getResellers(): Promise<any[]> {
    try {
      return await this.db.query<any>(`SELECT id, name FROM reseller ORDER BY name ASC`);
    } catch (e) {
      console.error('GroupChangeService.getResellers error:', e.message);
      return [];
    }
  }

  /** Change reseller for a list of customers. Logs each change to
   *  customer_reseller_change_log so history surfaces both group and
   *  reseller changes in one feed. */
  async transferReseller(
    customerIds: number[],
    toResellerId: number | null,
    changedBy: string,
  ): Promise<{ transferred: number }> {
    if (!customerIds.length) throw new BadRequestException('No customers selected');

    let toReseller: any = null;
    if (toResellerId !== null && toResellerId !== undefined) {
      toReseller = await this.db.queryOne<any>(
        `SELECT id, name FROM reseller WHERE id = ?`, [toResellerId],
      );
      if (!toReseller) throw new BadRequestException('Target reseller not found');
    }

    const placeholders = customerIds.map(() => '?').join(',');
    const customers = await this.db.query<any>(`
      SELECT c.id, c.company, c.resellerid, r.name AS from_reseller_name
      FROM customer c
      LEFT JOIN reseller r ON c.resellerid = r.id
      WHERE c.id IN (${placeholders})
    `, customerIds);

    for (const cust of customers) {
      await this.db.execute(`
        INSERT INTO customer_reseller_change_log
          (customer_id, customer_name, from_reseller_id, from_reseller_name,
           to_reseller_id, to_reseller_name, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        cust.id,
        cust.company,
        cust.resellerid || null,
        cust.from_reseller_name || null,
        toReseller?.id ?? null,
        toReseller?.name ?? null,
        changedBy,
      ]);
    }

    await this.db.execute(`
      UPDATE customer SET resellerid = ? WHERE id IN (${placeholders})
    `, [toReseller?.id ?? null, ...customerIds]);

    return { transferred: customers.length };
  }

  /**
   * Get change history with pagination — unified feed of group + reseller
   * changes, each tagged with a `change_type` discriminator. The UI uses
   * this to render either "old/new group" or "old/new reseller" per row.
   */
  async getHistory(page: number = 1, limit: number = 50, search: string = ''): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const like = `%${search}%`;
    const useSearch = !!search;

    const groupWhere = useSearch
      ? `WHERE (g.customer_name LIKE ? OR g.from_user_name LIKE ? OR g.to_user_name LIKE ?)`
      : '';
    const resellerWhere = useSearch
      ? `WHERE (r.customer_name LIKE ? OR r.from_reseller_name LIKE ? OR r.to_reseller_name LIKE ?)`
      : '';

    const groupParams = useSearch ? [like, like, like] : [];
    const resellerParams = useSearch ? [like, like, like] : [];

    // UNION ALL with normalized columns. NULLs fill the type-irrelevant fields
    // so the UI can branch on change_type without separate queries.
    const dataSql = `
      SELECT * FROM (
        SELECT 'group' AS change_type,
               g.id, g.customer_id, g.customer_name,
               g.from_user_name AS from_label, g.to_user_name AS to_label,
               g.changed_by, g.changed_at
        FROM customer_group_change_log g
        ${groupWhere}
        UNION ALL
        SELECT 'reseller' AS change_type,
               r.id, r.customer_id, r.customer_name,
               r.from_reseller_name AS from_label, r.to_reseller_name AS to_label,
               r.changed_by, r.changed_at
        FROM customer_reseller_change_log r
        ${resellerWhere}
      ) AS combined
      ORDER BY changed_at DESC
      LIMIT ? OFFSET ?
    `;
    const data = await this.db.query<any>(dataSql, [...groupParams, ...resellerParams, limit, offset]);

    const countSql = `
      SELECT
        (SELECT COUNT(*) FROM customer_group_change_log g ${groupWhere}) +
        (SELECT COUNT(*) FROM customer_reseller_change_log r ${resellerWhere}) AS total
    `;
    const countResult = await this.db.queryOne<{ total: number }>(countSql, [...groupParams, ...resellerParams]);

    return { data, total: countResult?.total || 0 };
  }
}
