import { Injectable, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

const SEED_DATA = [
  { name: 'Contra',      deemed_positive: null },
  { name: 'Credit Note', deemed_positive: 'NO' },
  { name: 'Debit Note',  deemed_positive: 'YES' },
  { name: 'Journal',     deemed_positive: null },
  { name: 'Payment',     deemed_positive: null },
  { name: 'Purchase',    deemed_positive: 'NO' },
  { name: 'Receipt',     deemed_positive: null },
  { name: 'Sales',       deemed_positive: 'YES' },
];

@Injectable()
export class VchTypeService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vchtype (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                name            VARCHAR(255) NOT NULL,
                parent_id       INT NULL,
                deemed_positive ENUM('YES','NO') NULL DEFAULT NULL,
                is_system       TINYINT(1) NOT NULL DEFAULT 0,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name   (name),
                INDEX idx_parent (parent_id)
            )
        `);

        // Add is_system column if it doesn't exist (for existing installs)
        const [colCheck] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vchtype' AND COLUMN_NAME = 'is_system'`
        );
        if ((colCheck?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0`);
        }

        // Seed only if table is empty
        const [row] = await this.db.query<any>('SELECT COUNT(*) as cnt FROM vchtype');
        if ((row?.cnt ?? 0) === 0) {
            for (const item of SEED_DATA) {
                await this.db.execute(
                    'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, NULL, ?, 1)',
                    [item.name, item.deemed_positive],
                );
            }
            // Set parent_id = self for root types (matches Tally convention)
            await this.db.execute('UPDATE vchtype SET parent_id = id WHERE parent_id IS NULL');
        } else {
            // Ensure existing seed rows are marked as system
            await this.db.execute(
                `UPDATE vchtype SET is_system = 1 WHERE name IN (${SEED_DATA.map(() => '?').join(',')})`,
                SEED_DATA.map(s => s.name),
            );
        }
    }

    async findAll() {
        return this.db.query<any>(`
            SELECT v.id, v.name, v.parent_id, v.deemed_positive, v.is_system,
                   p.name AS parent_name
            FROM vchtype v
            LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
            ORDER BY v.name ASC
        `);
    }

    async create(data: { name: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const result = await this.db.execute(
            'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, ?, ?, 0)',
            [data.name, data.parent_id || null, data.deemed_positive || null],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { name?: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);
        if (existing?.is_system) throw new ForbiddenException('System voucher types cannot be edited');

        const fields: string[] = [];
        const params: any[] = [];
        if (data.name !== undefined)            { fields.push('name = ?');            params.push(data.name); }
        if (data.parent_id !== undefined)       { fields.push('parent_id = ?');       params.push(data.parent_id || null); }
        if (data.deemed_positive !== undefined) { fields.push('deemed_positive = ?'); params.push(data.deemed_positive || null); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE vchtype SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);
        if (existing?.is_system) throw new ForbiddenException('System voucher types cannot be deleted');
        await this.db.execute('DELETE FROM vchtype WHERE id = ?', [id]);
    }
}
