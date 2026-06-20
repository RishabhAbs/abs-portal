import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class ItemsService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                tally_flavour_id INT DEFAULT NULL,
                batch ENUM('Yes','No') DEFAULT 'No',
                gst DECIMAL(5,2) DEFAULT 0,
                hsn VARCHAR(50) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name (item_name)
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS item_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Add parent_id to existing item_groups table
        await this.db.execute(`ALTER TABLE item_groups ADD COLUMN parent_id INT DEFAULT NULL`).catch(() => {});

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS item_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_id INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Add category_id to items
        await this.db.execute(`ALTER TABLE items ADD COLUMN category_id INT DEFAULT NULL`).catch(() => {});

        // Add tally_flavour_id column if missing (migration from old VARCHAR column)
        const [newCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'tally_flavour_id'`
        );
        if ((newCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE items ADD COLUMN tally_flavour_id INT DEFAULT NULL`);
        }

        // Drop old tally_flavour VARCHAR column if it still exists
        const [oldCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'tally_flavour'`
        );
        if ((oldCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE items DROP COLUMN tally_flavour`).catch(() => {});
        }

        // Feature 1: item_group_id column
        await this.db.execute(`ALTER TABLE items ADD COLUMN item_group_id INT NULL`).catch(() => {});

        // Feature: target_unit on item_categories (qty / amount)
        await this.db.execute(
            `ALTER TABLE item_categories ADD COLUMN target_unit ENUM('qty','amount') NOT NULL DEFAULT 'qty'`
        ).catch(() => {});

        // Feature 3: opening balance columns
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_qty DECIMAL(10,3) DEFAULT 0`).catch(() => {});
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_rate DECIMAL(10,2) DEFAULT 0`).catch(() => {});
        await this.db.execute(`ALTER TABLE items ADD COLUMN opening_value DECIMAL(15,2) DEFAULT 0`).catch(() => {});

        // Ensure nullable columns for opening entries (vch_id IS NULL = opening entry)
        await this.db.execute(`ALTER TABLE inventory_entries MODIFY COLUMN led_id INT NULL`).catch(() => {});
        await this.db.execute(`ALTER TABLE batch MODIFY COLUMN vch_id INT NULL`).catch(() => {});
    }

    async getFlavours() {
        return this.db.query<{ id: number; name: string }>(
            `SELECT id, name FROM singlemaster WHERE type = 'TallyFlavor' ORDER BY name ASC`
        );
    }

    // ── Item Groups ──
    async getGroups(): Promise<any[]> {
        return this.db.query<any>(
            `SELECT g.id, g.name, g.parent_id, p.name AS parent_name
             FROM item_groups g
             LEFT JOIN item_groups p ON p.id = g.parent_id
             ORDER BY g.name`
        );
    }

    async createGroup(name: string, parentId?: number | null): Promise<any> {
        const result = await this.db.execute(
            'INSERT INTO item_groups (name, parent_id) VALUES (?, ?)',
            [name, parentId || null]
        );
        return { id: result.insertId, name, parent_id: parentId || null };
    }

    async updateGroup(id: number, name: string, parentId?: number | null): Promise<void> {
        await this.db.execute(
            'UPDATE item_groups SET name=?, parent_id=?, updated_at=NOW() WHERE id=?',
            [name, parentId || null, id]
        );
    }

    async deleteGroup(id: number): Promise<void> {
        await this.db.execute('DELETE FROM item_groups WHERE id=?', [id]);
    }

    // ── Item Categories ──
    async getCategories(): Promise<any[]> {
        return this.db.query<any>(
            `SELECT c.id, c.name, c.parent_id, c.target_unit, p.name AS parent_name
             FROM item_categories c
             LEFT JOIN item_categories p ON p.id = c.parent_id
             ORDER BY c.name`
        );
    }

    async createCategory(name: string, parentId?: number | null, targetUnit?: string): Promise<any> {
        const unit = targetUnit === 'amount' ? 'amount' : 'qty';
        const result = await this.db.execute(
            'INSERT INTO item_categories (name, parent_id, target_unit) VALUES (?, ?, ?)',
            [name, parentId || null, unit]
        );
        return { id: result.insertId, name, parent_id: parentId || null, target_unit: unit };
    }

    async updateCategory(id: number, name: string, parentId?: number | null, targetUnit?: string): Promise<void> {
        const unit = targetUnit === 'amount' ? 'amount' : 'qty';
        await this.db.execute(
            'UPDATE item_categories SET name=?, parent_id=?, target_unit=?, updated_at=NOW() WHERE id=?',
            [name, parentId || null, unit, id]
        );
    }

    async deleteCategory(id: number): Promise<void> {
        await this.db.execute('DELETE FROM item_categories WHERE id=?', [id]);
    }

    async create(data: {
        item_name: string;
        tally_flavour_id?: number | null;
        batch?: string;
        gst?: number;
        hsn?: string;
        item_group_id?: number | null;
        category_id?: number | null;
        opening_qty?: number;
        opening_rate?: number;
        opening_value?: number;
    }) {
        const result = await this.db.execute(
            `INSERT INTO items (item_name, tally_flavour_id, batch, gst, hsn, item_group_id, category_id, opening_qty, opening_rate, opening_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.item_name,
                data.tally_flavour_id || null,
                data.batch || 'No',
                data.gst || 0,
                data.hsn || null,
                data.item_group_id || null,
                data.category_id || null,
                data.opening_qty || 0,
                data.opening_rate || 0,
                data.opening_value || 0,
            ],
        );
        return { id: result.insertId, ...data };
    }

    async findAll() {
        return this.db.query<any>(
            `SELECT i.*, sm.name AS flavour_name, ig.name AS group_name, ic.name AS category_name
             FROM items i
             LEFT JOIN singlemaster sm ON i.tally_flavour_id = sm.id
             LEFT JOIN item_groups ig ON ig.id = i.item_group_id
             LEFT JOIN item_categories ic ON ic.id = i.category_id
             ORDER BY i.item_name ASC`
        );
    }

    async update(id: number, data: {
        item_name?: string;
        tally_flavour_id?: number | null;
        batch?: string;
        gst?: number;
        hsn?: string;
        item_group_id?: number | null;
        category_id?: number | null;
        opening_qty?: number;
        opening_rate?: number;
        opening_value?: number;
    }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.item_name !== undefined)        { fields.push('item_name = ?');        params.push(data.item_name); }
        if (data.tally_flavour_id !== undefined) { fields.push('tally_flavour_id = ?'); params.push(data.tally_flavour_id || null); }
        if (data.batch !== undefined)            { fields.push('batch = ?');            params.push(data.batch); }
        if (data.gst !== undefined)              { fields.push('gst = ?');              params.push(data.gst); }
        if (data.hsn !== undefined)              { fields.push('hsn = ?');              params.push(data.hsn); }
        if (data.item_group_id !== undefined)    { fields.push('item_group_id = ?');    params.push(data.item_group_id || null); }
        if (data.category_id !== undefined)      { fields.push('category_id = ?');      params.push(data.category_id || null); }
        if (data.opening_qty !== undefined)      { fields.push('opening_qty = ?');      params.push(data.opening_qty); }
        if (data.opening_rate !== undefined)     { fields.push('opening_rate = ?');     params.push(data.opening_rate); }
        if (data.opening_value !== undefined)    { fields.push('opening_value = ?');    params.push(data.opening_value); }
        if (fields.length === 0) return;
        params.push(id);
        await this.db.execute(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        await this.db.execute('DELETE FROM items WHERE id = ?', [id]);
    }

    // ── Opening Entries (vch_id IS NULL = opening, no voucher) ──
    async getOpeningBatches(itemId: number): Promise<any[]> {
        return this.db.query<any>(
            `SELECT b.* FROM batch b
             JOIN inventory_entries ie ON b.inventory_id = ie.id
             WHERE ie.item_id = ? AND b.vch_id IS NULL
             ORDER BY b.id`,
            [itemId]
        );
    }

    async saveOpeningBatches(itemId: number, batches: { batch_name: string; qty: number; rate: number; amount: number }[]): Promise<void> {
        // Remove existing opening entries (vch_id IS NULL) for this item
        await this.db.execute(
            `DELETE b FROM batch b
             JOIN inventory_entries ie ON b.inventory_id = ie.id
             WHERE ie.item_id = ? AND b.vch_id IS NULL`,
            [itemId]
        );
        await this.db.execute(
            `DELETE FROM inventory_entries WHERE item_id = ? AND led_id IS NULL`,
            [itemId]
        );

        if (!batches.length) return;

        const totalQty = batches.reduce((s, b) => s + b.qty, 0);
        const totalAmt = batches.reduce((s, b) => s + b.amount, 0);
        const avgRate  = totalQty > 0 ? totalAmt / totalQty : 0;

        const invResult = await this.db.execute(
            `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount) VALUES (NULL, ?, ?, ?, ?)`,
            [itemId, totalQty, avgRate, totalAmt]
        );
        const invId = invResult.insertId;

        for (const b of batches) {
            await this.db.execute(
                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
                [invId, itemId, b.batch_name || null, b.qty, b.rate, b.amount]
            );
        }
    }
}
