import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface Pincode {
    id: number;
    pincode: string;
    city: string;
    stateid: number;
    state?: string; // from join
}

@Injectable()
export class PincodeService {
    constructor(private db: DbService) { }

    async findAll(page: number = 1, limit: number = 50, search: string = ''): Promise<{ data: Pincode[]; total: number; page: number; limit: number }> {
        const offset = (page - 1) * limit;
        let where = '';
        const params: any[] = [];

        if (search) {
            where = 'WHERE p.pincode LIKE ? OR p.city LIKE ? OR s.name LIKE ?';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const countResult = await this.db.queryOne<{ total: number }>(`
            SELECT COUNT(*) as total 
            FROM pincode p 
            LEFT JOIN state s ON p.stateid = s.id 
            ${where}
        `, params);

        const data = await this.db.query<Pincode>(`
            SELECT p.*, s.name as state 
            FROM pincode p
            LEFT JOIN state s ON p.stateid = s.id
            ${where}
            ORDER BY p.pincode
            LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `, params);

        return {
            data,
            total: countResult?.total || 0,
            page: Number(page),
            limit: Number(limit)
        };
    }

    async findByPincode(code: string): Promise<{ city: string; state: string } | null> {
        const result = await this.db.queryOne<Pincode>(
            'SELECT p.city, s.name as state FROM pincode p LEFT JOIN state s ON p.stateid = s.id WHERE p.pincode = ? LIMIT 1',
            [code]
        );
        return result ? { city: result.city, state: result.state || '' } : null;
    }

    async create(data: Partial<Pincode>): Promise<Pincode> {
        const result = await this.db.execute(
            'INSERT INTO pincode (pincode, city, stateid) VALUES (?, ?, ?)',
            [data.pincode, data.city, data.stateid]
        );
        return { id: result.insertId, ...data } as Pincode;
    }

    async update(id: number, data: Partial<Pincode>): Promise<Pincode> {
        await this.db.execute(
            'UPDATE pincode SET pincode = ?, city = ?, stateid = ? WHERE id = ?',
            [data.pincode, data.city, data.stateid, id]
        );
        return { id, ...data } as Pincode;
    }

    async delete(id: number): Promise<void> {
        await this.db.execute('DELETE FROM pincode WHERE id = ?', [id]);
    }
}
