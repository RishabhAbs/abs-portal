import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLog {
    id: string;
    user_id: string;
    user_name: string;
    action: 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'LOGIN' | 'LOGOUT';
    resource: string;
    resource_id?: string;
    details?: string;
    ip_address?: string;
    user_agent?: string;
    created_at: string;
}

@Injectable()
export class AuditService implements OnModuleInit {
    constructor(private db: DbService) { }

    async onModuleInit() {
        await this.ensureTableExists();
    }

    private async ensureTableExists() {
        await this.db.execute(`
      CREATE TABLE IF NOT EXISTS cloud_audit_logs (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(50),
        user_name VARCHAR(100),
        action VARCHAR(20) NOT NULL,
        resource VARCHAR(100) NOT NULL,
        resource_id VARCHAR(100),
        details TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_resource (resource),
        INDEX idx_created_at (created_at)
      )
    `);
    }

    /**
     * Log an audit event
     */
    async log(data: {
        user_id?: string;
        user_name?: string;
        action: AuditLog['action'];
        resource: string;
        resource_id?: string;
        details?: string;
        ip_address?: string;
        user_agent?: string;
    }): Promise<void> {
        const id = uuidv4();

        await this.db.execute(`
      INSERT INTO cloud_audit_logs (id, user_id, user_name, action, resource, resource_id, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            id,
            data.user_id || 'system',
            data.user_name || 'System',
            data.action,
            data.resource,
            data.resource_id || null,
            data.details || null,
            data.ip_address || null,
            data.user_agent || null
        ]);
    }

    /**
     * Get audit logs with filtering
     */
    async findAll(filters?: {
        user_id?: string;
        action?: string;
        resource?: string;
        start_date?: string;
        end_date?: string;
    }, page: number = 1, limit: number = 50): Promise<{ data: AuditLog[]; total: number }> {
        let query = `SELECT * FROM cloud_audit_logs WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) as total FROM cloud_audit_logs WHERE 1=1`;
        const params: any[] = [];

        if (filters?.user_id) {
            query += ` AND user_id = ?`;
            countQuery += ` AND user_id = ?`;
            params.push(filters.user_id);
        }

        if (filters?.action) {
            query += ` AND action = ?`;
            countQuery += ` AND action = ?`;
            params.push(filters.action);
        }

        if (filters?.resource) {
            query += ` AND resource LIKE ?`;
            countQuery += ` AND resource LIKE ?`;
            params.push(`%${filters.resource}%`);
        }

        if (filters?.start_date) {
            query += ` AND created_at >= ?`;
            countQuery += ` AND created_at >= ?`;
            params.push(filters.start_date);
        }

        if (filters?.end_date) {
            query += ` AND created_at <= ?`;
            countQuery += ` AND created_at <= ?`;
            params.push(filters.end_date);
        }

        const countResult = await this.db.queryOne<{ total: number }>(countQuery, params);

        const offset = (page - 1) * limit;
        query += ` ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

        const data = await this.db.query<AuditLog>(query, params);

        return {
            data,
            total: countResult?.total || 0
        };
    }

    /**
     * Get recent activity for a specific user
     */
    async getRecentActivity(userId: string, limit: number = 10): Promise<AuditLog[]> {
        return this.db.query<AuditLog>(`
      SELECT * FROM cloud_audit_logs 
      WHERE user_id = ?
      ORDER BY created_at DESC 
      LIMIT ${Number(limit)}
    `, [userId]);
    }
}
