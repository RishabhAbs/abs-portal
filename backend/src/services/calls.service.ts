import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface CustomerCall {
    id: number;
    customer_id: number;
    customer_name: string;
    phone_no: string;
    user_name: string;
    assigned_by: string;
    call_date: string;
    call_time: string;
    call_status: 'Picked Up' | 'Busy' | 'Not Reachable' | 'No Answer' | 'Switched Off' | 'Wrong Number';
    call_duration: number | null;
    call_notes: string;
    call_responses: any;
    created_at: string;
}

@Injectable()
export class CallsService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS cloud_customer_calls (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                customer_name VARCHAR(255),
                phone_no VARCHAR(50),
                user_name VARCHAR(100) NOT NULL,
                assigned_by VARCHAR(100),
                call_date DATE NOT NULL,
                call_time TIME,
                call_status ENUM('Picked Up','Busy','Not Reachable','No Answer','Switched Off','Wrong Number') NOT NULL,
                call_duration INT DEFAULT NULL,
                call_notes TEXT,
                call_responses JSON DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_customer (customer_id),
                INDEX idx_user (user_name),
                INDEX idx_date (call_date),
                INDEX idx_status (call_status)
            )
        `);
    }

    async create(data: {
        customer_id: number;
        customer_name?: string;
        phone_no?: string;
        user_name: string;
        assigned_by: string;
        call_status: string;
        call_notes?: string;
        call_responses?: any;
    }) {
        const sql = `
            INSERT INTO cloud_customer_calls
            (customer_id, customer_name, phone_no, user_name, assigned_by, call_date, call_time, call_status, call_notes, call_responses)
            VALUES (?, ?, ?, ?, ?, CURDATE(), CURTIME(), ?, ?, ?)
        `;
        const result = await this.db.execute(sql, [
            data.customer_id,
            data.customer_name || null,
            data.phone_no || null,
            data.user_name,
            data.assigned_by,
            data.call_status,
            data.call_notes || null,
            data.call_responses ? JSON.stringify(data.call_responses) : null,
        ]);

        // Update customer's last visit date so they sort to the bottom of the visit dashboard
        if (data.customer_id) {
            await this.db.execute(
                `UPDATE customer SET lastvisitdate = NOW(), lastvisitperson = ? WHERE id = ?`,
                [data.user_name || null, data.customer_id]
            );
        }

        return { id: result.insertId, ...data };
    }

    async findAll(
        page: number = 1,
        limit: number = 20,
        filters?: {
            status?: string;
            search?: string;
            user_name?: string;
            date_from?: string;
            date_to?: string;
        },
        currentUser?: string,
        isAdmin: boolean = false,
        adminId?: number,
        sortBy: string = 'call_date',
        sortOrder: 'ASC' | 'DESC' = 'DESC',
        adminName?: string,
    ) {
        const conditions: string[] = [];
        const params: any[] = [];

        if (filters?.status) {
            conditions.push('c.call_status = ?');
            params.push(filters.status);
        }
        if (filters?.search) {
            conditions.push('(c.customer_name LIKE ? OR c.phone_no LIKE ?)');
            const s = `%${filters.search}%`;
            params.push(s, s);
        }
        if (filters?.user_name) {
            conditions.push('c.user_name = ?');
            params.push(filters.user_name);
        }
        if (filters?.date_from) {
            conditions.push('c.call_date >= ?');
            params.push(filters.date_from);
        }
        if (filters?.date_to) {
            conditions.push('c.call_date <= ?');
            params.push(filters.date_to);
        }

        // Security: Non-admin users only see their own calls or calls for their group customers
        if (!isAdmin) {
            const securityConditions: string[] = [];
            securityConditions.push('(c.user_name = ? OR c.assigned_by = ?)');
            params.push(currentUser, currentUser);

            if (adminId) {
                securityConditions.push(`EXISTS (SELECT 1 FROM customer cust WHERE cust.id = c.customer_id AND cust.cloud_group_id = ?)`);
                params.push(adminId.toString());
            }
            
            conditions.push(`(${securityConditions.join(' OR ')})`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const countResult = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM cloud_customer_calls c ${where}`,
            params,
        );
        const total = countResult[0]?.total || 0;

        const offset = (page - 1) * limit;
        const data = await this.db.query<any>(
            `SELECT c.* FROM cloud_customer_calls c ${where} 
             ORDER BY ${(() => {
                const order = sortOrder === 'DESC' ? 'DESC' : 'ASC';
                switch (sortBy) {
                    case 'customer_name': return `c.customer_name ${order}`;
                    case 'call_date': return `c.call_date ${order}, c.call_time ${order}`;
                    case 'call_status': return `c.call_status ${order}`;
                    case 'user_name': return `c.user_name ${order}`;
                    default: return `c.call_date ${order}, c.call_time ${order}`;
                }
             })()} 
             LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        return { data, total, page, limit };
    }

    async findById(id: number) {
        const rows = await this.db.query<any>(
            'SELECT * FROM cloud_customer_calls WHERE id = ?',
            [id],
        );
        return rows[0] || null;
    }
}
