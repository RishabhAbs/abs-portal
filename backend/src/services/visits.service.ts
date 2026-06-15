import { Injectable, OnModuleInit, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface Visit {
    id: number;
    customer_id: number;
    user_name: string;
    assigned_by: string;
    visit_type: 'Visit' | 'Call' | 'External' | 'Self';
    status: 'Pending' | 'Completed' | 'Paused' | 'Cancelled';
    scheduled_date: string; // YYYY-MM-DD
    created_at: string;

    // Check-in/out
    check_in_time?: string;
    check_in_lat?: string;
    check_in_lng?: string;
    check_in_accuracy?: string; // client-reported GPS accuracy in metres; used for geofence tolerance
    check_out_time?: string;
    check_out_lat?: string;
    check_out_lng?: string;
    check_out_accuracy?: string;
    check_out_remark?: string;

    // Joined Fields
    customer_name?: string;
    person_name?: string;
    phone_no?: string;
    customer_lat?: string;
    customer_lng?: string;
    address1?: string;
    city?: string;
}

@Injectable()
export class VisitsService implements OnModuleInit {
    constructor(private db: DbService) { }

    async onModuleInit() {
        // Create cloud_visits table
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS cloud_visits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                user_name VARCHAR(100),
                assigned_by VARCHAR(100),
                visit_type ENUM('Visit', 'Call') NOT NULL,
                status ENUM('Pending', 'Completed', 'Paused', 'Cancelled', 'In Progress') DEFAULT 'Pending',
                scheduled_date DATE,
                
                check_in_time DATETIME,
                check_in_lat VARCHAR(50),
                check_in_lng VARCHAR(50),
                
                check_out_time DATETIME,
                check_out_lat VARCHAR(50),
                check_out_lng VARCHAR(50),
                check_out_remark TEXT,
                phone_no VARCHAR(50),
                
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Migration: Ensure 'In Progress' is allowed in status enum (for existing tables)
        try {
            await this.db.execute(`
                ALTER TABLE cloud_visits 
                MODIFY COLUMN status ENUM('Pending', 'Completed', 'Paused', 'Cancelled', 'In Progress') DEFAULT 'Pending'
             `);
        } catch (e) {
            // Ignore error if already updated or other minor schema issues, 
            // but ideally we should only run if needed. 
            // MODIFY is usually safe though.
            console.log('Schema update note:', e);
        }

        // Migration: Add Tracking Columns (Handle MySQL < 8.0 / MariaDB without IF NOT EXISTS support)
        const trackingColumns = [
            { name: 'e_invoice', def: 'VARCHAR(50)' },
            { name: 'business_type', def: 'VARCHAR(50)' },
            { name: 'accounts_person_type', def: 'VARCHAR(50)' },
            { name: 'it_person', def: 'VARCHAR(100)' },
            { name: 'ca_name', def: 'VARCHAR(100)' },
            { name: 'business_description', def: 'TEXT' },
            { name: 'e_way_bill', def: 'VARCHAR(50)' },
            { name: 'connected_banking', def: 'VARCHAR(50)' },
            { name: 'whatsapp_enabled', def: 'VARCHAR(50)' },
            { name: 'customisation', def: 'VARCHAR(50)' },
            { name: 'tally_slow', def: 'VARCHAR(50)' },
            { name: 'loyalty', def: 'VARCHAR(50)' },
            { name: 'conversion_probability', def: 'VARCHAR(50)' },
            { name: 'check_out_response', def: 'VARCHAR(100)' },
            { name: 'customer_behaviour', def: 'TEXT' },
            { name: 'force_checkin_allowed', def: 'BOOLEAN DEFAULT FALSE' },
            { name: 'phone_no', def: 'VARCHAR(50)' }
        ];

        try {
            // Ensure visit_type ENUM includes External + Self (newer task tabs)
            await this.db.execute(
                `ALTER TABLE cloud_visits MODIFY COLUMN visit_type ENUM('Visit','Call','External','Self') NOT NULL`
            ).catch(() => { /* already updated */ });
            // External/Self tasks have no customer — make customer_id nullable
            await this.db.execute(
                `ALTER TABLE cloud_visits MODIFY COLUMN customer_id INT NULL`
            ).catch(() => { /* already updated */ });

            // Check existing columns
            const existingCols = await this.db.query<any>(`DESCRIBE cloud_visits`);
            const existingColNames = existingCols.map((c: any) => c.Field.toLowerCase());
            
            for (const col of trackingColumns) {
                if (!existingColNames.includes(col.name.toLowerCase())) {
                    try {
                        await this.db.execute(`ALTER TABLE cloud_visits ADD COLUMN ${col.name} ${col.def}`);
                        console.log(`Added column ${col.name} to cloud_visits`);
                    } catch (e: any) {
                        // Ignore duplicate column errors
                        if (!e.message?.includes('Duplicate column')) {
                            console.log(`Column migration warning for ${col.name}:`, e.message);
                        }
                    }
                }
            }
        } catch (e) {
            console.log('Column migration note:', e);
        }
    }

    async create(data: {
        customer_id?: number | null,
        user_name: string,
        assigned_by: string,
        visit_type: 'Visit' | 'Call' | 'External' | 'Self',
        scheduled_date?: string,
        remark?: string
    }) {
        // Customer-bound visits ('Visit'/'Call') need a customer; External/Self don't.
        const customerId = (data.visit_type === 'External' || data.visit_type === 'Self')
            ? null
            : (data.customer_id ?? null);
        // Self tasks are creator-only — force assignee to creator regardless of input.
        const userName = data.visit_type === 'Self' ? data.assigned_by : data.user_name;
        const scheduledDate = data.scheduled_date || new Date().toISOString().slice(0, 10);

        const sql = `
            INSERT INTO cloud_visits (customer_id, user_name, assigned_by, visit_type, scheduled_date, status, check_out_remark)
            VALUES (?, ?, ?, ?, ?, 'In Progress', ?)
        `;
        const result = await this.db.execute(sql, [
            customerId,
            userName,
            data.assigned_by,
            data.visit_type,
            scheduledDate,
            data.remark || null
        ]);
        return { id: result.insertId, ...data, customer_id: customerId, user_name: userName, scheduled_date: scheduledDate };
    }

    async findAllPending(userName: string) {
        // Smart Fuzzy Match: surface a visit if the user is either the assignee
        // (v.user_name) OR the creator (v.assigned_by). Without the creator
        // branch, a user who creates a task and assigns it to someone else
        // would never see it in their own task list.
        const sql = `
            SELECT
                v.*,
                c.company as customer_name,
                c.person as person_name,
                COALESCE(NULLIF(c.mobile, ''), (
                    SELECT ccd.mobile_no
                    FROM customer_contact_mapping_data ccm
                    LEFT JOIN customer_contact_details ccd ON ccd.id = ccm.mobile_id AND ccd.status = 'Active'
                    WHERE ccm.customer_id = c.id AND ccm.status = 'Active' AND ccm.primary_contact = 'Yes'
                    LIMIT 1
                ), '') as phone_no,
                c.status as customer_status,
                c.lattitude as customer_lat,
                c.longitude as customer_lng,
                c.address1, pv.city as city, c.pincode,
                v.force_checkin_allowed
            FROM cloud_visits v
            LEFT JOIN customer c ON v.customer_id = c.id
            LEFT JOIN pincode pv ON c.pincode = pv.pincode
            WHERE v.status IN ('Pending', 'Paused', 'In Progress')
              AND (
                  ? = '' OR ? = 'all'
                  OR v.user_name = ?
                  OR LOWER(v.user_name) = LOWER(?)
                  OR LOWER(REPLACE(v.user_name, ' ', '')) LIKE CONCAT('%', LOWER(REPLACE(?, ' ', '')), '%')
                  OR v.assigned_by = ?
                  OR LOWER(v.assigned_by) = LOWER(?)
                  OR LOWER(REPLACE(v.assigned_by, ' ', '')) LIKE CONCAT('%', LOWER(REPLACE(?, ' ', '')), '%')
              )
            ORDER BY v.created_at ASC, v.id ASC
        `;
        try {
            return await this.db.query<Visit>(sql, [userName, userName, userName, userName, userName, userName, userName, userName]);
        } catch (e: any) {
            throw e;
        }
    }

    async findAll(page: number, limit: number, filters: any = {}) {
        const offset = (page - 1) * limit;
        const params: any[] = [];
        let where = " WHERE 1=1 ";

        if (filters.status && filters.status !== 'all') {
            where += " AND v.status = ? ";
            params.push(filters.status);
        }
        if (filters.user_name && filters.user_name !== 'all') {
            where += " AND v.user_name LIKE ? ";
            params.push(`%${filters.user_name}%`);
        }
        if (filters.search) {
            where += " AND (c.company LIKE ? OR v.user_name LIKE ? OR v.status LIKE ?) ";
            params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
        }
        if (filters.date_from) {
        where += " AND v.scheduled_date >= ? ";
        params.push(`${filters.date_from} 00:00:00`);
    }
    if (filters.date_to) {
        where += " AND v.scheduled_date <= ? ";
        params.push(`${filters.date_to} 23:59:59`);
    }

        if (filters.permission_check) {
            const { canSeeOur, canSeeOthers } = filters.permission_check;
            if (canSeeOur && !canSeeOthers) {
                where += " AND c.status = 'Active' ";
            } else if (!canSeeOur && canSeeOthers) {
                where += " AND (c.status != 'Active' OR c.status IS NULL) ";
            }
        }

        // Only show completed generally, or allow filtering
        // If specific status requested, fine. If not, maybe we default to all?
        // User asked for "Completed Visits" tab, so frontend will pass filters.status='Completed'

        const sql = `
            SELECT 
                v.*,
                c.company as customer_name, 
                c.person as person_name, 
                COALESCE(NULLIF(c.mobile, ''), ccd.mobile_no, '') as phone_no,
                c.status as customer_status
            FROM cloud_visits v
            LEFT JOIN customer c ON v.customer_id = c.id
            LEFT JOIN customer_contact_mapping_data ccm ON ccm.customer_id = c.id AND ccm.status = 'Active' AND ccm.primary_contact = 'Yes'
            LEFT JOIN customer_contact_details ccd ON ccd.id = ccm.mobile_id AND ccd.status = 'Active'
            ${where}
            ORDER BY v.scheduled_date DESC, v.id DESC
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const countSql = `
            SELECT COUNT(*) as total 
            FROM cloud_visits v
            LEFT JOIN customer c ON v.customer_id = c.id
            ${where}
        `;

        try {
            const [data, totalRes] = await Promise.all([
                this.db.queryStandard<Visit>(sql, params),
                this.db.queryOne<{ total: number }>(countSql, params.slice(0, -2)) // Exclude limit/offset
            ]);
            return {
                data,
                total: totalRes?.total || 0,
                page,
                limit
            };
        } catch (e: any) {
            throw e;
        }
    }

    async updateStatus(id: number, status: 'Paused' | 'Pending' | 'In Progress', user: any) {
        const visit = await this.db.queryOne<any>(`
            SELECT v.*, c.status as customer_status 
            FROM cloud_visits v 
            LEFT JOIN customer c ON v.customer_id = c.id 
            WHERE v.id = ?
        `, [id]);
        if (!visit) throw new NotFoundException('Visit not found');

        const isAdmin = user.role?.toLowerCase() === 'admin';
        const userEmail = user.email?.toLowerCase();
        const userName = user.name?.toLowerCase();
        
        const visitAssignee = visit.user_name?.toLowerCase();
        const visitCreator = visit.assigned_by?.toLowerCase();

        const isAssignee = (visitAssignee && (visitAssignee === userEmail || visitAssignee === userName));
        const isCreator = (visitCreator && (visitCreator === userEmail || visitCreator === userName));

        if (!isAdmin && !isAssignee) {
             const isOur = visit.customer_status === 'Active';
             const permModule = isOur ? 'visits_our' : 'visits_not_our';
             
             const hasModuleEdit = user.permissions?.[permModule]?.edit;
             const hasTasksCheckin = user.permissions?.tasks?.checkin;
             
             if (!hasModuleEdit && !hasTasksCheckin) {
                 throw new ForbiddenException('No permission to update status');
             }
             if (!hasTasksCheckin && !isCreator) {
                 throw new ForbiddenException('You are not authorized to update this visit');
             }
        }

        await this.db.execute(`UPDATE cloud_visits SET status = ? WHERE id = ?`, [status, id]);
        return { success: true };
    }

    async complete(id: number, data: { lat: string, lng: string, remark: string }, user: any) {
        // Check permissions first
        const preVisit = await this.db.queryOne<any>(`
            SELECT v.*, c.status as customer_status 
            FROM cloud_visits v 
            LEFT JOIN customer c ON v.customer_id = c.id 
            WHERE v.id = ?
        `, [id]);
        if (!preVisit) throw new NotFoundException('Visit not found');

        const isAdmin = user.role?.toLowerCase() === 'admin';
        const userEmail = user.email?.toLowerCase();
        const userName = user.name?.toLowerCase();
        
        const visitAssignee = preVisit.user_name?.toLowerCase();
        const visitCreator = preVisit.assigned_by?.toLowerCase();

        const isAssignee = (visitAssignee && (visitAssignee === userEmail || visitAssignee === userName));
        const isCreator = (visitCreator && (visitCreator === userEmail || visitCreator === userName));

        if (!isAdmin && !isAssignee) {
             const isOur = preVisit.customer_status === 'Active';
             const permModule = isOur ? 'visits_our' : 'visits_not_our';
             
             const hasModuleEdit = user.permissions?.[permModule]?.edit;
             const hasTasksCheckin = user.permissions?.tasks?.checkin;

             if (!hasModuleEdit && !hasTasksCheckin) {
                 throw new ForbiddenException('No permission to complete visit');
             }
             if (!hasTasksCheckin && !isCreator) {
                 throw new ForbiddenException('You are not authorized to complete this visit');
             }
        }

        // Use Indian timezone (UTC+5:30) for check_out_time
        await this.db.withTransaction(async (conn) => {
            // 1. Update Visit Status
            await this.db.execute(`
                UPDATE cloud_visits 
                SET status = 'Completed', 
                    check_out_time = CONVERT_TZ(NOW(), @@session.time_zone, '+05:30'),
                    check_out_lat = ?,
                    check_out_lng = ?,
                    check_out_remark = ?
                WHERE id = ?
            `, [data.lat, data.lng, data.remark, id], conn);

            // 2. Fetch Visit Details (already have preVisit, but safe to fetch inside transaction if strict, but preVisit is enough for logic)
            // Original code fetched it again. I'll stick to original logic but re-use preVisit data if needed or just let it query.
            const visit = await this.db.queryOne<any>(`SELECT customer_id, user_name FROM cloud_visits WHERE id = ?`, [id], conn);

            if (visit) {
                 // 3. Update Customer's Last Visit Info
                await this.db.execute(`
                    UPDATE customer 
                    SET lastvisitdate = CURRENT_DATE(), 
                        lastvisitperson = ?, 
                        lastvisitremark = ?
                    WHERE id = ?
                `, [visit.user_name, data.remark, visit.customer_id], conn);
            }
        });

        return { success: true };
    }

    async delete(id: number, user: any) {
        const visit = await this.db.queryOne<any>(`
            SELECT v.*, c.status as customer_status 
            FROM cloud_visits v 
            LEFT JOIN customer c ON v.customer_id = c.id 
            WHERE v.id = ?
        `, [id]);
        if (!visit) throw new NotFoundException('Visit not found');

        const isAdmin = user.role === 'admin';
        const isCreator = visit.assigned_by === user.email || visit.assigned_by === user.name;

        if (!isAdmin) {
            // Check Module Permission
            const isOur = visit.customer_status === 'Active';
            const permModule = isOur ? 'visits_our' : 'visits_not_our';
            if (!user.permissions?.[permModule]?.delete) {
                throw new ForbiddenException('No permission to delete visits for this customer type');
            }

            if (!isCreator) {
                throw new ForbiddenException('You are not authorized to delete this visit');
            }
        }

        await this.db.execute(`DELETE FROM cloud_visits WHERE id = ?`, [id]);
        return { success: true };
    }

    async update(data: any, user: any) {
        const visit = await this.db.queryOne<any>(`
            SELECT v.*, c.status as customer_status 
            FROM cloud_visits v 
            LEFT JOIN customer c ON v.customer_id = c.id 
            WHERE v.id = ?
        `, [data.id]);
        if (!visit) throw new NotFoundException('Visit not found');

        const isAdmin = user.role?.toLowerCase() === 'admin';
        const userEmail = user.email?.toLowerCase();
        const userName = user.name?.toLowerCase();
        
        const visitAssignee = visit.user_name?.toLowerCase();
        const visitCreator = visit.assigned_by?.toLowerCase();

        const isAssignee = (visitAssignee && (visitAssignee === userEmail || visitAssignee === userName));
        const isCreator = (visitCreator && (visitCreator === userEmail || visitCreator === userName));

        if (!isAdmin && !isAssignee) {
            const isOur = visit.customer_status === 'Active';
            const permModule = isOur ? 'visits_our' : 'visits_not_our';
            
            const hasModuleEdit = user.permissions?.[permModule]?.edit;
            const hasTasksEdit = user.permissions?.tasks?.edit;
            const hasTasksCheckin = user.permissions?.tasks?.checkin;

            if (!hasModuleEdit && !hasTasksEdit && !hasTasksCheckin) {
                throw new ForbiddenException('No permission to edit visits for this customer type');
            }

            // Must be creator if not assignee and not admin and no general task edit perm
            if (!isCreator && !hasTasksEdit && !hasTasksCheckin) {
                throw new ForbiddenException('You are not authorized to edit this visit');
            }
        }

        // ── Geofence: require check-in / check-out within 200 m of the customer's
        //   saved location. Bypassed when `force_checkin_allowed` is set on the
        //   visit, in which case the customer's coords are updated to the current
        //   position (first-time and force paths both seed the customer record).
        //   Client-reported GPS accuracy (check_in_accuracy / check_out_accuracy)
        //   is subtracted from the distance to avoid false rejections when the
        //   reading is noisy. Only physical Visits are geofenced — Calls,
        //   External tasks, and Self reminders have no on-site requirement.
        const needsGeofence = visit.visit_type === 'Visit';
        if (needsGeofence && (data.check_in_lat || data.check_out_lat)) {
            const currentLat = Number(data.check_in_lat || data.check_out_lat);
            const currentLng = Number(data.check_in_lng || data.check_out_lng);
            const currentAcc = Number(data.check_in_accuracy || data.check_out_accuracy || 0);

            const customer = await this.db.queryOne<any>(
                `SELECT lattitude, longitude FROM customer WHERE id = ?`,
                [visit.customer_id],
            );
            const visitData = await this.db.queryOne<any>(
                `SELECT force_checkin_allowed FROM cloud_visits WHERE id = ?`,
                [data.id],
            );

            if (visitData?.force_checkin_allowed) {
                // Force mode: accept the position and re-anchor the customer there.
                await this.db.execute(
                    `UPDATE customer SET lattitude = ?, longitude = ? WHERE id = ?`,
                    [currentLat, currentLng, visit.customer_id],
                );
            } else if (customer && customer.lattitude && customer.longitude) {
                const custLat = Number(customer.lattitude);
                const custLng = Number(customer.longitude);
                const dist = this.calculateDistance(custLat, custLng, currentLat, currentLng);
                const effective = Math.max(0, dist - currentAcc);
                if (effective > 200) {
                    const accNote = currentAcc > 0 ? ` (GPS ±${Math.round(currentAcc)}m)` : '';
                    throw new ForbiddenException(
                        `You are ${Math.round(dist)}m away from customer location${accNote}. Please reach the customer to proceed.`,
                    );
                }
            } else {
                // First visit for this customer — seed the saved coordinates.
                await this.db.execute(
                    `UPDATE customer SET lattitude = ?, longitude = ? WHERE id = ?`,
                    [currentLat, currentLng, visit.customer_id],
                );
            }
        }

        const updates: string[] = [];
        const params: any[] = [];
        
        // ... (rest of the update logic)
        
        if (data.scheduled_date) { updates.push('scheduled_date = ?'); params.push(data.scheduled_date); }
        if (data.user_name) { updates.push('user_name = ?'); params.push(data.user_name); }
        if (data.visit_type) { updates.push('visit_type = ?'); params.push(data.visit_type); }
        if (data.status) { updates.push('status = ?'); params.push(data.status); }

        // Check-in fields
        if (data.check_in_time) { updates.push('check_in_time = ?'); params.push(data.check_in_time); } 
        if (data.check_in_lat) { updates.push('check_in_lat = ?'); params.push(data.check_in_lat); }
        if (data.check_in_lng) { updates.push('check_in_lng = ?'); params.push(data.check_in_lng); }

        // Check-out fields
        if (data.check_out_time) { updates.push('check_out_time = ?'); params.push(data.check_out_time); }
        if (data.check_out_lat) { updates.push('check_out_lat = ?'); params.push(data.check_out_lat); }
        if (data.check_out_lng) { updates.push('check_out_lng = ?'); params.push(data.check_out_lng); }
        if (data.remark) { updates.push('check_out_remark = ?'); params.push(data.remark); }

        // Tracking Fields
        const trackingFields = [
            'e_invoice', 'business_type', 'accounts_person_type', 'it_person', 'ca_name',
            'business_description', 'e_way_bill', 'connected_banking', 'whatsapp_enabled',
            'customisation', 'tally_slow', 'loyalty', 'conversion_probability',
            'check_out_response', 'customer_behaviour'
        ];

        for (const field of trackingFields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                params.push(data[field]);
            }
        }


        if (updates.length > 0) {
            params.push(data.id);
            await this.db.execute(`UPDATE cloud_visits SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        return { success: true };
    }

    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    async toggleForceCheckin(id: number, allowed: boolean, user: any) {
        if (user.role !== 'admin') {
            throw new ForbiddenException('Only admin can toggle force check-in');
        }
        await this.db.execute(`UPDATE cloud_visits SET force_checkin_allowed = ? WHERE id = ?`, [allowed, id]);
        return { success: true };
    }
}
