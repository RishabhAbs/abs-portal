import { Injectable, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

const SEED_DATA = [
  { name: 'Contra',        deemed_positive: null },
  { name: 'Credit Note',   deemed_positive: 'NO' },
  { name: 'Debit Note',    deemed_positive: 'YES' },
  { name: 'Journal',       deemed_positive: null },
  { name: 'Payment',       deemed_positive: null },
  { name: 'Purchase',      deemed_positive: 'NO' },
  { name: 'Receipt',       deemed_positive: null },
  { name: 'Sales',         deemed_positive: 'YES' },
  { name: 'Stock Journal', deemed_positive: null },
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

        // Add is_system column if missing
        const [colCheck] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vchtype' AND COLUMN_NAME = 'is_system'`
        );
        if ((colCheck?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0`);
        }

        // Add numbering_mode + vch_width (legacy flat columns kept for migration path)
        const [numCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vchtype' AND COLUMN_NAME = 'numbering_mode'`
        );
        if ((numCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN numbering_mode ENUM('manual','automatic') NOT NULL DEFAULT 'manual'`);
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN vch_prefix VARCHAR(50) DEFAULT NULL`);
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN vch_suffix VARCHAR(50) DEFAULT NULL`);
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN vch_start_no INT NOT NULL DEFAULT 1`);
            await this.db.execute(`ALTER TABLE vchtype ADD COLUMN vch_width INT NOT NULL DEFAULT 3`);
        }

        // Date-effective period tables
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vchtype_numbering_period (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                vchtype_id     INT NOT NULL,
                applicable_from DATE NOT NULL,
                start_no       INT NOT NULL DEFAULT 1,
                period_type    ENUM('yearly','manual') NOT NULL DEFAULT 'yearly',
                INDEX idx_vt (vchtype_id, applicable_from)
            )
        `);
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vchtype_prefix_period (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                vchtype_id     INT NOT NULL,
                applicable_from DATE NOT NULL,
                particulars    VARCHAR(100) NOT NULL DEFAULT '',
                INDEX idx_vt (vchtype_id, applicable_from)
            )
        `);
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vchtype_suffix_period (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                vchtype_id     INT NOT NULL,
                applicable_from DATE NOT NULL,
                particulars    VARCHAR(100) NOT NULL DEFAULT '',
                INDEX idx_vt (vchtype_id, applicable_from)
            )
        `);

        // Seed
        const [row] = await this.db.query<any>('SELECT COUNT(*) as cnt FROM vchtype');
        if ((row?.cnt ?? 0) === 0) {
            for (const item of SEED_DATA) {
                await this.db.execute(
                    'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, NULL, ?, 1)',
                    [item.name, item.deemed_positive],
                );
            }
            await this.db.execute('UPDATE vchtype SET parent_id = id WHERE parent_id IS NULL');
        } else {
            await this.db.execute(
                `UPDATE vchtype SET is_system = 1 WHERE name IN (${SEED_DATA.map(() => '?').join(',')})`,
                SEED_DATA.map(s => s.name),
            );
            for (const item of SEED_DATA) {
                const existing = await this.db.queryOne<any>('SELECT id FROM vchtype WHERE name = ?', [item.name]);
                if (!existing) {
                    const res = await this.db.execute(
                        'INSERT INTO vchtype (name, parent_id, deemed_positive, is_system) VALUES (?, NULL, ?, 1)',
                        [item.name, item.deemed_positive],
                    );
                    await this.db.execute('UPDATE vchtype SET parent_id = ? WHERE id = ?', [res.insertId, res.insertId]);
                }
            }
        }
    }

    async findAll() {
        const types = await this.db.query<any>(`
            SELECT v.id, v.name, v.parent_id, v.deemed_positive, v.is_system,
                   v.numbering_mode, v.vch_width,
                   p.name AS parent_name
            FROM vchtype v
            LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
            ORDER BY v.name ASC
        `);
        // Attach period rows for each type
        for (const t of types) {
            t.numbering_periods = await this.db.query<any>(
                `SELECT id, applicable_from, start_no, period_type FROM vchtype_numbering_period WHERE vchtype_id = ? ORDER BY applicable_from ASC`, [t.id]
            );
            t.prefix_periods = await this.db.query<any>(
                `SELECT id, applicable_from, particulars FROM vchtype_prefix_period WHERE vchtype_id = ? ORDER BY applicable_from ASC`, [t.id]
            );
            t.suffix_periods = await this.db.query<any>(
                `SELECT id, applicable_from, particulars FROM vchtype_suffix_period WHERE vchtype_id = ? ORDER BY applicable_from ASC`, [t.id]
            );
        }
        return types;
    }

    async create(data: {
        name: string;
        parent_id?: number | null;
        deemed_positive?: 'YES' | 'NO' | null;
        numbering_mode?: 'manual' | 'automatic';
        vch_width?: number;
        numbering_periods?: { applicable_from: string; start_no: number; period_type: string }[];
        prefix_periods?: { applicable_from: string; particulars: string }[];
        suffix_periods?: { applicable_from: string; particulars: string }[];
    }) {
        const result = await this.db.execute(
            `INSERT INTO vchtype (name, parent_id, deemed_positive, is_system, numbering_mode, vch_width)
             VALUES (?, ?, ?, 0, ?, ?)`,
            [data.name, data.parent_id || null, data.deemed_positive || null,
             data.numbering_mode || 'manual', data.vch_width ?? 3],
        );
        const id = result.insertId;
        await this._savePeriods(id, data);
        return { id, ...data };
    }

    async update(id: number, data: {
        name?: string;
        parent_id?: number | null;
        deemed_positive?: 'YES' | 'NO' | null;
        numbering_mode?: 'manual' | 'automatic';
        vch_width?: number;
        numbering_periods?: { applicable_from: string; start_no: number; period_type: string }[];
        prefix_periods?: { applicable_from: string; particulars: string }[];
        suffix_periods?: { applicable_from: string; particulars: string }[];
    }) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);

        const fields: string[] = [];
        const params: any[] = [];
        if (existing?.is_system) {
            // System types: only numbering fields
            if (data.numbering_mode !== undefined) { fields.push('numbering_mode = ?'); params.push(data.numbering_mode); }
            if (data.vch_width !== undefined)      { fields.push('vch_width = ?');      params.push(data.vch_width); }
        } else {
            if (data.name !== undefined)             { fields.push('name = ?');             params.push(data.name); }
            if (data.parent_id !== undefined)        { fields.push('parent_id = ?');        params.push(data.parent_id || null); }
            if (data.deemed_positive !== undefined)  { fields.push('deemed_positive = ?');  params.push(data.deemed_positive || null); }
            if (data.numbering_mode !== undefined)   { fields.push('numbering_mode = ?');   params.push(data.numbering_mode); }
            if (data.vch_width !== undefined)        { fields.push('vch_width = ?');        params.push(data.vch_width); }
        }
        if (fields.length) {
            params.push(id);
            await this.db.execute(`UPDATE vchtype SET ${fields.join(', ')} WHERE id = ?`, params);
        }
        await this._savePeriods(id, data);
    }

    private async _savePeriods(id: number, data: {
        numbering_periods?: { applicable_from: string; start_no: number; period_type: string }[];
        prefix_periods?: { applicable_from: string; particulars: string }[];
        suffix_periods?: { applicable_from: string; particulars: string }[];
    }) {
        if (data.numbering_periods !== undefined) {
            await this.db.execute(`DELETE FROM vchtype_numbering_period WHERE vchtype_id = ?`, [id]);
            for (const p of data.numbering_periods) {
                await this.db.execute(
                    `INSERT INTO vchtype_numbering_period (vchtype_id, applicable_from, start_no, period_type) VALUES (?, ?, ?, ?)`,
                    [id, p.applicable_from, p.start_no ?? 1, p.period_type || 'yearly']
                );
            }
        }
        if (data.prefix_periods !== undefined) {
            await this.db.execute(`DELETE FROM vchtype_prefix_period WHERE vchtype_id = ?`, [id]);
            for (const p of data.prefix_periods) {
                await this.db.execute(
                    `INSERT INTO vchtype_prefix_period (vchtype_id, applicable_from, particulars) VALUES (?, ?, ?)`,
                    [id, p.applicable_from, p.particulars || '']
                );
            }
        }
        if (data.suffix_periods !== undefined) {
            await this.db.execute(`DELETE FROM vchtype_suffix_period WHERE vchtype_id = ?`, [id]);
            for (const p of data.suffix_periods) {
                await this.db.execute(
                    `INSERT INTO vchtype_suffix_period (vchtype_id, applicable_from, particulars) VALUES (?, ?, ?)`,
                    [id, p.applicable_from, p.particulars || '']
                );
            }
        }
    }

    async delete(id: number) {
        const existing = await this.db.queryOne<any>('SELECT is_system FROM vchtype WHERE id = ?', [id]);
        if (existing?.is_system) throw new ForbiddenException('System voucher types cannot be deleted');
        await this.db.execute('DELETE FROM vchtype_numbering_period WHERE vchtype_id = ?', [id]);
        await this.db.execute('DELETE FROM vchtype_prefix_period WHERE vchtype_id = ?', [id]);
        await this.db.execute('DELETE FROM vchtype_suffix_period WHERE vchtype_id = ?', [id]);
        await this.db.execute('DELETE FROM vchtype WHERE id = ?', [id]);
    }

    /** Resolve effective prefix/suffix/start_no for a given date */
    async getEffectiveNumbering(vchtypeId: number, forDate: string): Promise<{
        numbering_mode: string; vch_width: number;
        prefix: string; suffix: string; start_no: number; period_type: string;
    }> {
        const vt = await this.db.queryOne<any>(
            `SELECT numbering_mode, vch_width FROM vchtype WHERE id = ?`, [vchtypeId]
        );
        if (!vt) return { numbering_mode: 'manual', vch_width: 3, prefix: '', suffix: '', start_no: 1, period_type: 'yearly' };

        const np = await this.db.queryOne<any>(
            `SELECT start_no, period_type FROM vchtype_numbering_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchtypeId, forDate]
        );
        const pp = await this.db.queryOne<any>(
            `SELECT particulars FROM vchtype_prefix_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchtypeId, forDate]
        );
        const sp = await this.db.queryOne<any>(
            `SELECT particulars FROM vchtype_suffix_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchtypeId, forDate]
        );

        return {
            numbering_mode: vt.numbering_mode,
            vch_width:      vt.vch_width ?? 3,
            prefix:         pp?.particulars ?? '',
            suffix:         sp?.particulars ?? '',
            start_no:       np?.start_no ?? 1,
            period_type:    np?.period_type ?? 'yearly',
        };
    }
}
