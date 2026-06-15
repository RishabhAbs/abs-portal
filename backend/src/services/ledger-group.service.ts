import { Injectable, OnModuleInit } from '@nestjs/common';
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
        await this.db.execute('DELETE FROM ledgergroup WHERE id = ?', [id]);
    }
}
