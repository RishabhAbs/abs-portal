import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import * as bcrypt from 'bcryptjs';

export interface UserPermissions {
  servers: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; bulk_renewal: boolean };
  customers_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  customers_not_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  customer_search: { view: boolean; copy: boolean; edit: boolean; view_all_groups: boolean };
  mappings: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; bulk_renewal: boolean };
  users: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  tasks: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; view_history: boolean };
  visits_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; force_checkin: boolean; pause: boolean };
  visits_not_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; force_checkin: boolean; pause: boolean };
  pincodes: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  activities: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  tdl: { view: boolean; create: boolean; edit: boolean; delete: boolean; add_requirement: boolean; delete_requirement: boolean; add_task: boolean };
  // `view_updates` gates the per-service-call notes / remarks / status-change
  // history. Without it, even users with `view` only see the row, not the
  // update trail. (Original ask: only certain users should see service updates.)
  service_calls: { view: boolean; create: boolean; take: boolean; close: boolean; transfer: boolean; cancel: boolean; view_all: boolean; view_updates: boolean };
  leads: { view: boolean; create: boolean; take: boolean; close: boolean; transfer: boolean; cancel: boolean; view_all: boolean };
  service_followup: { view: boolean; confirm: boolean; reopen: boolean };
  expiry_renew_our: { view: boolean; copy: boolean; view_all_groups: boolean };
  expiry_renew_not_our: { view: boolean; copy: boolean; view_all_groups: boolean };
  call_report: { view: boolean };
  my_requirements: { cloud: boolean; tally: boolean; tdl: boolean; webapp: boolean };
  // Masters — items + groups + categories + flavours all gate on `items`
  items: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  ledger_groups: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  other_ledgers: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  vch_types: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  targets: { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean };
  // Reseller master (CRM > Masters > Reseller). `edit` also gates the
  // reseller field on the customer create/edit form — only users with
  // resellers.edit can set or change a customer's reseller.
  resellers: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  // Group / Reseller Change page. `edit_group` lets the user reassign a
  // customer's handler (cloud user); `edit_reseller` lets them reassign
  // a customer's reseller. Either action requires `view` to open the page.
  group_change: { view: boolean; edit_group: boolean; edit_reseller: boolean };
  // Voucher entry / edit (Vouchers page). Separate from `activities` so an
  // accountant can be allowed to enter sales receipts without getting full
  // module-admin powers.
  // `check` lets the user mark a voucher as Checked. Once checked, only an
  // admin can edit/delete it (even users with vouchers.edit lose write access).
  vouchers: { view: boolean; create: boolean; edit: boolean; delete: boolean; check: boolean; allowed_vch_parent_ids: number[]; allowed_ledger_group_ids: number[] };
  // Each financial report carries its own CRUD permission so admins can
  // grant view-only on one report and full edit/delete on another. `edit`
  // and `update` overlap conceptually (one opens the form, the other saves
  // — split here so an admin could allow opening for review but block
  // saving changes if desired).
  reports_outstanding:      { view: boolean };
  reports_ledger:           { view: boolean };
  reports_daybook:          { view: boolean };
  reports_sales_register:   { view: boolean };
  reports_group_summary:    { view: boolean };
  reports_stock_summary:    { view: boolean };
  reports_user_outstanding: { view: boolean };
  // Bill Report + Payment Report (Billing module). Their own permission so an
  // admin can grant these two reports without the broader `activities` perm.
  reports_bill_payment: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  server_monitor: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  // Group Transfer (bulk ledger-group / reseller reassignment). Distinct from
  // `group_change` so it can be granted independently.
  group_transfer: { view: boolean; create: boolean; edit: boolean; delete: boolean };
}

// Column-level permissions: per-page visibility and copy control
export interface PageColumnPermission {
  visible: string[];   // columns the user can see
  copyable: string[];  // columns the user can copy (subset of visible)
}

export interface ColumnPermissions {
  servers: PageColumnPermission;
  customer_search: PageColumnPermission;
  customer_search_contacts: PageColumnPermission;
  customer_search_mapped: PageColumnPermission;
  customer_search_tally: PageColumnPermission;
  customer_search_cloud: PageColumnPermission;
  mappings: PageColumnPermission;
  activities: PageColumnPermission;
  tasks_active: PageColumnPermission;
  tasks_completed: PageColumnPermission;
  pending_visits: PageColumnPermission;
  service_calls: PageColumnPermission;
  users: PageColumnPermission;
  customization: PageColumnPermission;
}

// All available columns per page
export const ALL_PAGE_COLUMNS: Record<keyof ColumnPermissions, string[]> = {
  servers: ['company', 'sof_id', 'server_ip', 'customer_ip', 'port', 'admin', 'password', 'mapped', 'bu', 'pu', 'rate', 'expiry', 'created'],
  customer_search: ['company', 'person', 'mobile', 'email', 'status', 'city'],
  customer_search_contacts: ['person', 'phone', 'primary', 'status', 'company'],
  customer_search_mapped: ['company', 'group', 'status', 'type', 'email', 'gstin', 'pincode', 'city', 'state'],
  customer_search_tally: ['tally_serial', 'expiry', 'active', 'status', 'flavor', 'release', 'renewal', 'mau', 'qau', 'remark'],
  customer_search_cloud: ['server_ip', 'customer_ip', 'serial', 'users', 'status', 'cycle', 'rate', 'expiry', 'credentials'],
  mappings: ['company', 'customer_ip', 'email', 'activation', 'serial_no', 'bu', 'expiry', 'cycle', 'rate'],
  activities: ['customer', 'server_ip', 'sof_no', 'date', 'type', 'bill_type', 'cycle', 'mode', 'start', 'expiry', 'users', 'rate', 'amount', 'voucher_no'],
  tasks_active: ['customer', 'type', 'staff', 'added', 'in_time', 'out_time', 'remark'],
  tasks_completed: ['checkout_date', 'customer', 'staff', 'type', 'in_time', 'out_time', 'remark', 'response', 'loyalty', 'biz_type', 'einvoice', 'acct_person', 'it_person', 'ca_name', 'eway_bill', 'banking', 'whatsapp', 'custom', 'tally_slow'],
  pending_visits: ['customer', 'staff', 'added', 'in_time', 'out_time', 'remark'],
  service_calls: ['sr', 'company', 'created_by', 'mobile', 'sn', 'type', 'add_by', 'handle_by', 'next_date', 'status', 'complete_by', 'remark'],
  users: ['name', 'role', 'two_fa', 'status'],
  customization: ['customer_name', 'person_name', 'phone', 'handled_by', 'status', 'amount', 'submission_date', 'overdue_days'],
};

// Default column permissions: all visible, NO copy for regular users
const defaultColumnPermissions: ColumnPermissions = Object.fromEntries(
  Object.entries(ALL_PAGE_COLUMNS).map(([page, cols]) => [page, { visible: [...cols], copyable: [] }])
) as unknown as ColumnPermissions;

// Admin column permissions: all visible + all copyable
const adminColumnPermissions: ColumnPermissions = Object.fromEntries(
  Object.entries(ALL_PAGE_COLUMNS).map(([page, cols]) => [page, { visible: [...cols], copyable: [...cols] }])
) as unknown as ColumnPermissions;

// Merge stored column permissions with defaults (backward-compatible)
function mergeColumnDefaults(stored: any, isAdmin: boolean): ColumnPermissions {
  const base = isAdmin ? adminColumnPermissions : defaultColumnPermissions;
  if (!stored || typeof stored !== 'object') return { ...base };
  const result: any = {};
  for (const page of Object.keys(ALL_PAGE_COLUMNS)) {
    if (stored[page] && typeof stored[page] === 'object') {
      result[page] = {
        visible: Array.isArray(stored[page].visible) ? stored[page].visible : (base as any)[page].visible,
        copyable: Array.isArray(stored[page].copyable) ? stored[page].copyable : (base as any)[page].copyable,
      };
    } else {
      result[page] = { ...(base as any)[page] };
    }
  }
  return result as ColumnPermissions;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash?: string;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  permissions: UserPermissions;
  column_permissions: ColumnPermissions;
  created_at: string;
  updated_at: string;
  two_fa_secret?: string;
  is_two_fa_enabled: boolean;
  last_location?: { lat: number, lng: number };
  last_location_at?: string;
  tag?: 'Inside' | 'Outside';
}

// Default permissions
const defaultUserPermissions: UserPermissions = {
  servers: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
  customers_our: { view: true, create: false, edit: false, delete: false, export: false },
  customers_not_our: { view: true, create: false, edit: false, delete: false, export: false },
  customer_search: { view: true, copy: false, edit: false, view_all_groups: false },
  mappings: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
  users: { view: false, create: false, edit: false, delete: false },
  tasks: { view: true, create: false, edit: false, delete: false, checkin: false, view_history: false },
  visits_our: { view: true, create: false, edit: false, delete: false, checkin: false, force_checkin: false, pause: false },
  visits_not_our: { view: true, create: false, edit: false, delete: false, checkin: false, force_checkin: false, pause: false },
  pincodes: { view: false, create: false, edit: false, delete: false },
  activities: { view: true, create: false, edit: false, delete: false, export: false },
  tdl: { view: false, create: false, edit: false, delete: false, add_requirement: false, delete_requirement: false, add_task: false },
  service_calls: { view: false, create: false, take: false, close: false, transfer: false, cancel: false, view_all: false, view_updates: false },
  leads: { view: false, create: false, take: false, close: false, transfer: false, cancel: false, view_all: false },
  service_followup: { view: false, confirm: false, reopen: false },
  expiry_renew_our: { view: true, copy: false, view_all_groups: false },
  expiry_renew_not_our: { view: true, copy: false, view_all_groups: false },
  call_report: { view: false },
  my_requirements: { cloud: false, tally: false, tdl: false, webapp: false },
  items: { view: false, create: false, edit: false, delete: false },
  ledger_groups: { view: false, create: false, edit: false, delete: false },
  other_ledgers: { view: false, create: false, edit: false, delete: false },
  vch_types: { view: false, create: false, edit: false, delete: false },
  targets: { view: false, create: false, edit: false, delete: false, approve: false },
  resellers: { view: false, create: false, edit: false, delete: false },
  group_change: { view: false, edit_group: false, edit_reseller: false },
  vouchers: { view: false, create: false, edit: false, delete: false, check: false, allowed_vch_parent_ids: [], allowed_ledger_group_ids: [] },
  reports_outstanding:      { view: false },
  reports_ledger:           { view: false },
  reports_daybook:          { view: false },
  reports_sales_register:   { view: false },
  reports_group_summary:    { view: false },
  reports_stock_summary:    { view: false },
  reports_user_outstanding: { view: false },
  reports_bill_payment: { view: false, create: false, edit: false, delete: false },
  server_monitor: { view: false, create: false, edit: false, delete: false },
  group_transfer: { view: false, create: false, edit: false, delete: false },
};

const adminPermissions: UserPermissions = {
  servers: { view: true, create: true, edit: true, delete: true, export: true, bulk_renewal: true },
  customers_our: { view: true, create: true, edit: true, delete: true, export: true },
  customers_not_our: { view: true, create: true, edit: true, delete: true, export: true },
  customer_search: { view: true, copy: true, edit: true, view_all_groups: true },
  mappings: { view: true, create: true, edit: true, delete: true, export: true, bulk_renewal: true },
  users: { view: true, create: true, edit: true, delete: true },
  tasks: { view: true, create: true, edit: true, delete: true, checkin: true, view_history: true },
  visits_our: { view: true, create: true, edit: true, delete: true, checkin: true, force_checkin: true, pause: true },
  visits_not_our: { view: true, create: true, edit: true, delete: true, checkin: true, force_checkin: true, pause: true },
  pincodes: { view: true, create: true, edit: true, delete: true },
  activities: { view: true, create: true, edit: true, delete: true, export: true },
  tdl: { view: true, create: true, edit: true, delete: true, add_requirement: true, delete_requirement: true, add_task: true },
  service_calls: { view: true, create: true, take: true, close: true, transfer: true, cancel: true, view_all: true, view_updates: true },
  leads: { view: true, create: true, take: true, close: true, transfer: true, cancel: true, view_all: true },
  service_followup: { view: true, confirm: true, reopen: true },
  expiry_renew_our: { view: true, copy: true, view_all_groups: true },
  expiry_renew_not_our: { view: true, copy: true, view_all_groups: true },
  call_report: { view: true },
  my_requirements: { cloud: true, tally: true, tdl: true, webapp: true },
  items: { view: true, create: true, edit: true, delete: true },
  ledger_groups: { view: true, create: true, edit: true, delete: true },
  other_ledgers: { view: true, create: true, edit: true, delete: true },
  vch_types: { view: true, create: true, edit: true, delete: true },
  targets: { view: true, create: true, edit: true, delete: true, approve: true },
  resellers: { view: true, create: true, edit: true, delete: true },
  group_change: { view: true, edit_group: true, edit_reseller: true },
  vouchers: { view: true, create: true, edit: true, delete: true, check: true, allowed_vch_parent_ids: [], allowed_ledger_group_ids: [] },
  reports_outstanding:      { view: true },
  reports_ledger:           { view: true },
  reports_daybook:          { view: true },
  reports_sales_register:   { view: true },
  reports_group_summary:    { view: true },
  reports_stock_summary:    { view: true },
  reports_user_outstanding: { view: true },
  reports_bill_payment: { view: true, create: true, edit: true, delete: true },
  server_monitor: { view: true, create: true, edit: true, delete: true },
  group_transfer: { view: true, create: true, edit: true, delete: true },
};

// Merge stored permissions with defaults so new keys (e.g. service_calls) are always present
function mergeWithDefaults(stored: any): UserPermissions {
  const result: any = { ...defaultUserPermissions };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(defaultUserPermissions)) {
      if (stored[key] && typeof stored[key] === 'object') {
        // Use the stored value for each action; fill in missing actions from defaults
        result[key] = { ...(defaultUserPermissions as any)[key], ...stored[key] };
      }
      // If stored[key] doesn't exist, keep the defaultUserPermissions value
    }
  }
  return result as UserPermissions;
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(private db: DbService) { }

  async onModuleInit() {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS cloud_users (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('admin', 'user') DEFAULT 'user',
          status ENUM('active', 'inactive') DEFAULT 'active',
          permissions TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          two_fa_secret VARCHAR(255),
          is_two_fa_enabled BOOLEAN DEFAULT FALSE
        )
      `);

      // Check for missing columns
      const cols = await this.db.query<any>(`DESCRIBE cloud_users`);
      const colNames = cols.map((c: any) => c.Field);

      if (!colNames.includes('two_fa_secret')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN two_fa_secret VARCHAR(255)`);
      if (!colNames.includes('is_two_fa_enabled')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN is_two_fa_enabled BOOLEAN DEFAULT FALSE`);
      if (!colNames.includes('permissions')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN permissions TEXT`);
      if (!colNames.includes('tag')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN tag ENUM('Inside', 'Outside') DEFAULT 'Inside'`);
      if (!colNames.includes('last_location')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN last_location JSON DEFAULT NULL`);
      if (!colNames.includes('last_location_at')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN last_location_at TIMESTAMP DEFAULT NULL`);
      if (!colNames.includes('column_permissions')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN column_permissions TEXT`);
      if (!colNames.includes('old_id')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN old_id INT DEFAULT NULL`);
      if (!colNames.includes('sub_user_id')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN sub_user_id VARCHAR(20) DEFAULT NULL`);
      // Per-user opt-in for target allotment. When 0, the user is hidden from the
      // Target Setup list, the admin's Targets filter dropdown, and the user's own
      // dashboard Targets section. Default 1 to preserve current behavior.
      if (!colNames.includes('allot_target')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN allot_target TINYINT(1) DEFAULT 1`);
      // Optional ledger-group scope: when set (non-admin), ledger pickers only
      // show ledgers filed under this group (or its child groups). NULL = all.
      if (!colNames.includes('ledger_group_id')) await this.db.execute(`ALTER TABLE cloud_users ADD COLUMN ledger_group_id INT DEFAULT NULL`);

      // Also ensure customer table has cloud_group_id and subgroupid columns
      // (needed by user save bulk-update logic)
      const custCols = await this.db.query<any>(`DESCRIBE customer`);
      const custColNames = custCols.map((c: any) => c.Field);
      if (!custColNames.includes('cloud_group_id')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN cloud_group_id VARCHAR(20) DEFAULT NULL`);
        await this.db.execute(`ALTER TABLE customer ADD INDEX idx_cloud_group_id (cloud_group_id)`).catch(() => {});
      }
      if (!custColNames.includes('subgroupid')) {
        await this.db.execute(`ALTER TABLE customer ADD COLUMN subgroupid VARCHAR(20) DEFAULT NULL`);
        await this.db.execute(`ALTER TABLE customer ADD INDEX idx_subgroupid (subgroupid)`).catch(() => {});
      }

    } catch (error) {
    }
  }

  async findAll(): Promise<User[]> {
    const users = await this.db.query<any>(`
      SELECT cu.id, cu.name, cu.email, cu.role, cu.status, cu.permissions, cu.column_permissions, cu.created_at, cu.updated_at, cu.is_two_fa_enabled, cu.tag,
             cu.old_id, cu.sub_user_id, cu.allot_target, cu.ledger_group_id,
             a1.name as old_name, cu2.name as sub_user_name, lgrp.name as ledger_group_name
      FROM cloud_users cu
      LEFT JOIN admin a1 ON a1.id = cu.old_id
      LEFT JOIN cloud_users cu2 ON cu2.id = cu.sub_user_id
      LEFT JOIN ledgergroup lgrp ON lgrp.id = cu.ledger_group_id
      ORDER BY cu.created_at DESC
    `);

    return users.map(user => ({
      ...user,
      permissions: mergeWithDefaults(typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions),
      column_permissions: mergeColumnDefaults(
        typeof user.column_permissions === 'string' ? JSON.parse(user.column_permissions) : user.column_permissions,
        user.role === 'admin'
      ),
      is_two_fa_enabled: !!user.is_two_fa_enabled
    }));
  }

  async getBasicUsers(): Promise<Array<{ id: string; name: string; email: string; role: string; status: string; permissions: { my_requirements: { cloud: boolean; tally: boolean; tdl: boolean; webapp: boolean }; leads: { view: boolean; create: boolean; take: boolean; close: boolean; transfer: boolean; cancel: boolean; view_all: boolean } } }>> {
    // Return only the minimal permission subset the frontend dropdowns need:
    //   - my_requirements: developer filtering by lead_type
    //   - leads:           eligible lead-owner filtering (view/create/take/...)
    // Full permissions would require `users.view`, which regular users don't
    // hold — that gap blocks non-admins from seeing populated assignee dropdowns.
    const users = await this.db.query<any>(`
      SELECT id, name, email, role, status, permissions, allot_target
      FROM cloud_users
      WHERE status = 'active'
      ORDER BY name ASC
    `);
    return users.map((u: any) => {
      let myReq: any = { cloud: false, tally: false, tdl: false, webapp: false };
      let leadsPerm: any = { view: false, create: false, take: false, close: false, transfer: false, cancel: false, view_all: false };
      try {
        const p = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions;
        if (p?.my_requirements) myReq = { ...myReq, ...p.my_requirements };
        if (p?.leads) leadsPerm = { ...leadsPerm, ...p.leads };
      } catch { /* ignore parse errors */ }
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        allot_target: !!u.allot_target,
        permissions: { my_requirements: myReq, leads: leadsPerm },
      };
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.db.queryOne<any>(`
      SELECT id, name, email, role, status, permissions, column_permissions, created_at, updated_at, is_two_fa_enabled, tag
      FROM cloud_users WHERE id = ?
    `, [id]);

    if (!user) throw new NotFoundException(`User ${id} not found`);

    return {
      ...user,
      permissions: mergeWithDefaults(typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions),
      column_permissions: mergeColumnDefaults(
        typeof user.column_permissions === 'string' ? JSON.parse(user.column_permissions) : user.column_permissions,
        user.role === 'admin'
      ),
      is_two_fa_enabled: !!user.is_two_fa_enabled
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.db.queryOne<any>(`SELECT * FROM cloud_users WHERE email = ?`, [email]);
    if (!user) return null;

    return {
      ...user,
      permissions: mergeWithDefaults(typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions),
      column_permissions: mergeColumnDefaults(
        typeof user.column_permissions === 'string' ? JSON.parse(user.column_permissions) : user.column_permissions,
        user.role === 'admin'
      ),
      is_two_fa_enabled: !!user.is_two_fa_enabled
    };
  }

  async create(data: Partial<User> & { password: string }): Promise<User> {
    // Check if email exists
    const existing = await this.findByEmail(data.email!);
    if (existing) throw new ConflictException('Email already exists');

    // Generate ID
    const lastUser = await this.db.queryOne<{ id: string }>(`
      SELECT id FROM cloud_users ORDER BY id DESC LIMIT 1
    `);
    const nextNum = lastUser ? parseInt(lastUser.id.replace('USR', '')) + 1 : 1;
    const id = `USR${String(nextNum).padStart(3, '0')}`;

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 12);

    // Set permissions: Use provided permissions OR fallback to role defaults
    const permissions = data.permissions
      ? data.permissions
      : (data.role === 'admin' ? adminPermissions : defaultUserPermissions);

    const columnPerms = (data as any).column_permissions
      ? (data as any).column_permissions
      : (data.role === 'admin' ? adminColumnPermissions : defaultColumnPermissions);

    await this.db.execute(`
      INSERT INTO cloud_users (id, name, email, password_hash, role, status, tag, permissions, column_permissions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      id,
      data.name,
      data.email,
      hashedPassword,
      data.role || 'user',
      data.status || 'active',
      data.tag || 'Inside',
      JSON.stringify(permissions),
      JSON.stringify(columnPerms)
    ]);

    // Group / sub-user / ledger-group assignments come through the same
    // create form — apply them via update() so both paths share one code path.
    const extras: any = {};
    if ((data as any).old_id !== undefined)          extras.old_id = (data as any).old_id;
    if ((data as any).sub_user_id !== undefined)     extras.sub_user_id = (data as any).sub_user_id;
    if ((data as any).ledger_group_id !== undefined) extras.ledger_group_id = (data as any).ledger_group_id;
    if (Object.keys(extras).length) await this.update(id, extras);

    return this.findById(id);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    await this.findById(id); // Check exists

    const fields: string[] = [];
    const values: any[] = [];

    if (data.name) { fields.push('name = ?'); values.push(data.name); }
    if (data.email) { fields.push('email = ?'); values.push(data.email); }
    if (data.role) { fields.push('role = ?'); values.push(data.role); }
    if (data.status) { fields.push('status = ?'); values.push(data.status); }
    if (data.tag) { fields.push('tag = ?'); values.push(data.tag); }
    if (data.permissions) { fields.push('permissions = ?'); values.push(JSON.stringify(data.permissions)); }
    if ((data as any).column_permissions) { fields.push('column_permissions = ?'); values.push(JSON.stringify((data as any).column_permissions)); }

    // Handle admin group mapping (old_id = old admin table ID)
    const adminGroupId = (data as any).old_id;
    if (adminGroupId !== undefined) {
      fields.push('old_id = ?');
      values.push(adminGroupId || null);
    }
    // sub_user_id = cloud_users.id (e.g., USR001) — the sub user
    const subUserId = (data as any).sub_user_id;
    if (subUserId !== undefined) {
      fields.push('sub_user_id = ?');
      values.push(subUserId || null);
    }
    // allot_target — per-user toggle for whether targets apply to them
    const allotTarget = (data as any).allot_target;
    if (allotTarget !== undefined) {
      fields.push('allot_target = ?');
      values.push(allotTarget ? 1 : 0);
    }
    // ledger_group_id — ledger visibility for this user:
    //   NULL = not assigned → sees NO ledgers in ledger reports/pickers
    //   0    = "All Ledgers" sentinel → unrestricted
    //   >0   = only that group and its child groups
    const ledgerGroupId = (data as any).ledger_group_id;
    if (ledgerGroupId !== undefined) {
      fields.push('ledger_group_id = ?');
      const n = Number(ledgerGroupId);
      values.push(ledgerGroupId === null || ledgerGroupId === '' || !Number.isFinite(n) ? null : n);
    }

    if (fields.length > 0) {
      values.push(id);
      await this.db.execute(`UPDATE cloud_users SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    // When old_id is set, bulk-update all customers in that old admin group:
    // - Set cloud_group_id = this cloud user (primary)
    // - Set subgroupid = selected sub user (if any)
    if (adminGroupId !== undefined && adminGroupId) {
      await this.db.execute(
        `UPDATE customer SET cloud_group_id = ? WHERE \`group\` = ?`,
        [id, adminGroupId]
      );
      // Also set the sub user on same customers
      if (subUserId) {
        await this.db.execute(
          `UPDATE customer SET subgroupid = ? WHERE \`group\` = ?`,
          [subUserId, adminGroupId]
        );
      }
    }

    return this.findById(id);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    await this.findById(id);
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.db.execute(`UPDATE cloud_users SET password_hash = ? WHERE id = ?`, [hashedPassword, id]);
  }

  async updatePermissions(id: string, permissions: UserPermissions): Promise<User> {
    await this.findById(id);
    await this.db.execute(`UPDATE cloud_users SET permissions = ? WHERE id = ?`, [JSON.stringify(permissions), id]);
    return this.findById(id);
  }

  async updateColumnPermissions(id: string, columnPermissions: ColumnPermissions): Promise<User> {
    await this.findById(id);
    await this.db.execute(`UPDATE cloud_users SET column_permissions = ? WHERE id = ?`, [JSON.stringify(columnPermissions), id]);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.db.execute(`DELETE FROM cloud_users WHERE id = ?`, [id]);
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.db.queryOne<any>(`SELECT * FROM cloud_users WHERE email = ?`, [email]);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return null;

    return {
      ...user,
      permissions: mergeWithDefaults(typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions),
      column_permissions: mergeColumnDefaults(
        typeof user.column_permissions === 'string' ? JSON.parse(user.column_permissions) : user.column_permissions,
        user.role === 'admin'
      ),
      password_hash: undefined,
      is_two_fa_enabled: !!user.is_two_fa_enabled
    };
  }

  async resetTwoFactor(id: string): Promise<void> {
    await this.findById(id); // Check if user exists
    await this.db.execute(`UPDATE cloud_users SET two_fa_secret = NULL, is_two_fa_enabled = FALSE WHERE id = ?`, [id]);
  }

  async setTwoFactorSecret(id: string, secret: string): Promise<void> {
    await this.db.execute(`UPDATE cloud_users SET two_fa_secret = ? WHERE id = ?`, [secret, id]);
  }

  async enableTwoFactor(id: string): Promise<void> {
    await this.db.execute(`UPDATE cloud_users SET is_two_fa_enabled = TRUE WHERE id = ?`, [id]);
  }

  async disableTwoFactor(id: string): Promise<void> {
    await this.db.execute(`UPDATE cloud_users SET is_two_fa_enabled = FALSE, two_fa_secret = NULL WHERE id = ?`, [id]);
  }

  async getTwoFactorSecret(id: string): Promise<string | null> {
    const user = await this.db.queryOne<{ two_fa_secret: string }>(`SELECT two_fa_secret FROM cloud_users WHERE id = ?`, [id]);
    return user ? user.two_fa_secret : null;
  }

  async updateLocation(id: string, lat: number, lng: number): Promise<void> {
    // Validate: reject impossible GPS jumps (> 50km from last known position)
    const user = await this.db.queryOne<any>(`SELECT last_location FROM cloud_users WHERE id = ?`, [id]);
    if (user?.last_location) {
      try {
        const prev = typeof user.last_location === 'string' ? JSON.parse(user.last_location) : user.last_location;
        if (prev?.lat && prev?.lng) {
          const R = 6371; // Earth radius in km
          const toRad = (v: number) => (v * Math.PI) / 180;
          const dLat = toRad(lat - prev.lat);
          const dLon = toRad(lng - prev.lng);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(prev.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
          const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (distKm > 50) {
            // Impossible jump (> 50km in ~2min interval) — discard bad GPS data
            return;
          }
        }
      } catch (_) { /* proceed if parsing fails */ }
    }

    const location = JSON.stringify({ lat, lng });
    
    // 1. Update current location (for real-time view)
    await this.db.execute(
      `UPDATE cloud_users SET last_location = ?, last_location_at = NOW() WHERE id = ?`,
      [location, id]
    );

    // 2. Insert into history tracking (for 30-day path)
    await this.db.execute(
      `INSERT INTO user_location_history (user_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, NOW())`,
      [id, lat, lng]
    );

    // 3. Cleanup old history (1% probability to save resources)
    if (Math.random() < 0.01) {
       await this.db.execute(`DELETE FROM user_location_history WHERE recorded_at < NOW() - INTERVAL 30 DAY`);
    }
  }

  async getNetworkStats(): Promise<any[]> {
    const users = await this.db.query<any>(`
      SELECT id, name, email, role, status, last_location, last_location_at 
      FROM cloud_users 
      WHERE last_location IS NOT NULL
      ORDER BY last_location_at DESC
    `);
    
    return users.map(u => ({
      ...u,
      last_location: typeof u.last_location === 'string' ? JSON.parse(u.last_location) : u.last_location
    }));
  }

  async getLocationHistory(userId: string, date: string): Promise<any[]> {
    const startOfDay = `${date} 00:00:00`;
    const endOfDay = `${date} 23:59:59`;
    
    return this.db.query<any>(`
      SELECT latitude, longitude, recorded_at 
      FROM user_location_history 
      WHERE user_id = ? AND recorded_at BETWEEN ? AND ?
      ORDER BY recorded_at DESC
    `, [userId, startOfDay, endOfDay]);
  }
}
