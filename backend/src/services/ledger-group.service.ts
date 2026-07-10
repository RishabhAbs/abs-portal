import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { DbService } from '../database/db.service';

@Injectable()
export class LedgerGroupService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS ledgergroup (
                id        INT AUTO_INCREMENT PRIMARY KEY,
                name      VARCHAR(255) NOT NULL,
                parent_id INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_name (name),
                INDEX idx_parent (parent_id)
            )
        `);
    }

    async findAll() {
        return this.db.query<any>(`
            SELECT lg.id, lg.name, lg.parent_id,
                   p.name AS parent_name
            FROM ledgergroup lg
            LEFT JOIN ledgergroup p ON lg.parent_id = p.id
            ORDER BY lg.name ASC
        `);
    }

    async create(data: { name: string; parent_id?: number | null }) {
        const result = await this.db.execute(
            'INSERT INTO ledgergroup (name, parent_id) VALUES (?, ?)',
            [data.name, data.parent_id || null],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { name?: string; parent_id?: number | null }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.name !== undefined)      { fields.push('name = ?');      params.push(data.name); }
        if (data.parent_id !== undefined) { fields.push('parent_id = ?'); params.push(data.parent_id || null); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE ledgergroup SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        const ledgers = await this.db.queryOne<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt FROM customer WHERE ledgergroup = ?`, [id],
        ).catch(() => ({ cnt: 0 }));
        const kids = await this.db.queryOne<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt FROM ledgergroup WHERE parent_id = ? AND id <> ?`, [id, id],
        ).catch(() => ({ cnt: 0 }));
        const users = await this.db.queryOne<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt FROM cloud_users WHERE ledger_group_id = ?`, [id],
        ).catch(() => ({ cnt: 0 }));
        if ((ledgers?.cnt ?? 0) > 0) {
            throw new BadRequestException(`Cannot delete: ${ledgers!.cnt} ledger(s) are filed under this group. Move them first.`);
        }
        if ((kids?.cnt ?? 0) > 0) {
            throw new BadRequestException(`Cannot delete: this group has ${kids!.cnt} sub-group(s). Remove them first.`);
        }
        if ((users?.cnt ?? 0) > 0) {
            throw new BadRequestException(`Cannot delete: ${users!.cnt} user(s) are scoped to this ledger group. Reassign them first.`);
        }
        await this.db.execute('DELETE FROM ledgergroup WHERE id = ?', [id]);
    }
}
