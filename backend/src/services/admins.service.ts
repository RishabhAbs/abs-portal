import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface Admin {
    id: string;
    name: string;
    email?: string;
    role?: string;
    status?: string;
}

@Injectable()
export class AdminsService {
    constructor(private db: DbService) { }

    /**
     * Fetch all users from the 'cloud_users' table for group selection (Handled By/Assignee)
     */
    async findAll(search?: string): Promise<Admin[]> {
        let sql = `
            SELECT id, name, active as status
            FROM admin
            WHERE active = 'YES'
        `;
        const params: any[] = [];

        if (search) {
            sql += ` AND name LIKE ?`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY name ASC LIMIT 100`; // Increased limit since admin table is large

        return this.db.query<Admin>(sql, params);
    }

    /**
     * Fetch a single user by ID from 'admin'
     */
    async findById(id: string): Promise<Admin | null> {
        const admin = await this.db.queryOne<Admin>(`
      SELECT id, name, username as email, 'admin' as role, active as status
      FROM admin
      WHERE id = ?
    `, [id]);
        return admin;
    }

    /**
     * Fetch all legacy admin users with customer count for mapping page
     */
    async findAllLegacy(): Promise<any[]> {
        return this.db.query<any>(`
            SELECT a.id, a.name, a.active as status,
                   COUNT(c.id) as customer_count
            FROM admin a
            LEFT JOIN customer c ON c.\`group\` = a.id
            GROUP BY a.id, a.name, a.active
            HAVING customer_count > 0
            ORDER BY a.name ASC
        `);
    }
}
