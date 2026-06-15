import { Injectable, NotFoundException, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

// Interface matching EXISTING database schema
export interface TdlMaster {
    id: string;
    customer_id?: number;
    customer_name?: string;       // Customer Name (from customer table when mapped)
    person_name?: string;         // Person Name (contact person)
    phone_no?: string;            // Mobile Number
    request_type?: string;
    priority?: 'Low' | 'Medium' | 'High' | 'Urgent';
    status: 'Pending' | 'In Progress' | 'Completed' | 'Cancelled' | 'Quotation' | 'Implementation' | 'Advance Pending' | 'Expired';
    description?: string;         // Remark
    handled_by?: string;          // Handled By
    api_token?: string;
    total_amount?: number;
    tally_serial_no?: string;
    amc_required?: boolean;
    project_name?: string;
    expiry_date?: string;
    created_at: string;
    updated_at: string;
    requirements?: TdlRequirement[];
}

export interface TdlRequirement {
    id: number;
    tdl_id: string;
    requirement: string;
    amount: number;
    attachment?: string;
}

@Injectable()
export class TdlService implements OnModuleInit {
    constructor(private db: DbService) { }

    private getISTDate(): string {
        return new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date()).split('/').reverse().join('-');
    }

    private checkExpiry(master: TdlMaster): TdlMaster {
        if (master.expiry_date) {
            const expiry = new Date(master.expiry_date);
            const today = new Date();
            expiry.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);

            if (today >= expiry && master.status !== 'Cancelled') {
                master.status = 'Expired';
            }
        }
        return master;
    }

    async onModuleInit() {
        try {
            // 1. Ensure Master Table exists first
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tdl_master (
                    id VARCHAR(50) PRIMARY KEY,
                    customer_id INT,
                    customer_name VARCHAR(255),
                    person_name VARCHAR(255),
                    phone_no VARCHAR(50),
                    request_type VARCHAR(100),
                    priority ENUM('Low','Medium','High','Urgent') DEFAULT 'Medium',
                    status ENUM('Pending','In Progress','Completed','Cancelled','Quotation','Implementation','Advance Pending','Expired') DEFAULT 'Pending',
                    description TEXT,
                    handled_by VARCHAR(100),
                    api_token VARCHAR(255),
                    total_amount DECIMAL(10,2) DEFAULT 0,
                    tally_serial_no VARCHAR(100),
                    amc_required TINYINT(1) DEFAULT 0,
                    project_name VARCHAR(255),
                    expiry_date DATE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            const columns = await this.db.query<any>(`DESCRIBE cloud_tdl_master`);
            const columnNames = columns.map((c: any) => c.Field);

            if (!columnNames.includes('phone_no')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN phone_no VARCHAR(50)`);
            if (!columnNames.includes('person_name')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN person_name VARCHAR(255)`);
            if (!columnNames.includes('customer_name')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN customer_name VARCHAR(255)`);
            if (!columnNames.includes('customer_id')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN customer_id INT`);
            if (!columnNames.includes('project_name')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN project_name VARCHAR(255)`);
            if (!columnNames.includes('request_type')) await this.db.execute(`ALTER TABLE cloud_tdl_master ADD COLUMN request_type VARCHAR(100)`);

            // 2. Ensure Requirements Table & New Columns
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tdl_requirements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tdl_id VARCHAR(50) NOT NULL,
                    requirement TEXT NOT NULL,
                    amount DECIMAL(10, 2) DEFAULT 0,
                    attachment VARCHAR(255),
                    development_days INT DEFAULT 0,
                    dev_status VARCHAR(50) DEFAULT 'Pending',
                    dev_allotment_date DATE,
                    req_status VARCHAR(50) DEFAULT 'Pending'
                )
            `);

            // Check for new columns in requirements
            const reqCols = await this.db.query<any>(`DESCRIBE cloud_tdl_requirements`);
            const reqColNames = reqCols.map((c: any) => c.Field);
            if (!reqColNames.includes('development_days')) await this.db.execute(`ALTER TABLE cloud_tdl_requirements ADD COLUMN development_days INT DEFAULT 0`);
            if (!reqColNames.includes('dev_status')) await this.db.execute(`ALTER TABLE cloud_tdl_requirements ADD COLUMN dev_status VARCHAR(50) DEFAULT 'Pending'`);
            if (!reqColNames.includes('dev_allotment_date')) await this.db.execute(`ALTER TABLE cloud_tdl_requirements ADD COLUMN dev_allotment_date DATE`);
            if (!reqColNames.includes('req_status')) await this.db.execute(`ALTER TABLE cloud_tdl_requirements ADD COLUMN req_status VARCHAR(50) DEFAULT 'Pending'`);

            // 3. Create Tasks Table (Level 3 Hierarchy)
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tdl_tasks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    req_id INT NOT NULL,
                    user_name VARCHAR(100),
                    task_type ENUM('Development', 'Implementation', 'Connect') NOT NULL DEFAULT 'Development',
                    allotment_date DATE,
                    deadline DATE,
                    completion_date DATE,
                    check_in_date DATE,
                    check_in_time VARCHAR(20),
                    check_in_lat VARCHAR(50),
                    check_in_lng VARCHAR(50),
                    check_out_time VARCHAR(20),
                    check_out_lat VARCHAR(50),
                    check_out_lng VARCHAR(50),
                    status ENUM('Pending', 'Completed', 'In Progress') DEFAULT 'Pending',
                    remark TEXT,
                    assigned_by VARCHAR(100)
                )
            `);

            // 4. Create History Table
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tdl_task_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    task_id INT NOT NULL,
                    changed_by VARCHAR(100),
                    change_type VARCHAR(50),
                    old_value TEXT,
                    new_value TEXT,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 5. Check Columns for Tasks (Migrations)
            const taskCols = await this.db.query<any>(`DESCRIBE cloud_tdl_tasks`);
            const taskColNames = taskCols.map((c: any) => c.Field);
            if (!taskColNames.includes('deadline')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN deadline DATE`);
            if (!taskColNames.includes('assigned_by')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN assigned_by VARCHAR(100)`);
            if (!taskColNames.includes('tdl_id')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN tdl_id VARCHAR(50)`);

            // Make req_id nullable for Master-level tasks
            const reqIdCol = taskCols.find((c: any) => c.Field === 'req_id');
            if (reqIdCol && reqIdCol.Null === 'NO') {
                await this.db.execute(`ALTER TABLE cloud_tdl_tasks MODIFY COLUMN req_id INT NULL`);
            }

            // New Tracking Columns
            if (!taskColNames.includes('check_in_date')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_in_date DATE`);
            if (!taskColNames.includes('check_in_time')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_in_time VARCHAR(20)`);
            if (!taskColNames.includes('check_in_lat')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_in_lat VARCHAR(50)`);
            if (!taskColNames.includes('check_in_lng')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_in_lng VARCHAR(50)`);
            if (!taskColNames.includes('check_out_time')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_out_time VARCHAR(20)`);
            if (!taskColNames.includes('check_out_lat')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_out_lat VARCHAR(50)`);
            if (!taskColNames.includes('check_out_lng')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_out_lng VARCHAR(50)`);
            if (!taskColNames.includes('check_out_response')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN check_out_response VARCHAR(100)`);
            if (!taskColNames.includes('loyalty')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN loyalty VARCHAR(50)`);
            if (!taskColNames.includes('conversion_probability')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN conversion_probability VARCHAR(50)`);
            if (!taskColNames.includes('customer_behaviour')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN customer_behaviour TEXT`);

            // Per-visit tracking fields
            if (!taskColNames.includes('e_invoice')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN e_invoice VARCHAR(20)`);
            if (!taskColNames.includes('business_type')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN business_type VARCHAR(100)`);
            if (!taskColNames.includes('accounts_person_type')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN accounts_person_type VARCHAR(100)`);
            if (!taskColNames.includes('it_person')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN it_person VARCHAR(255)`);
            if (!taskColNames.includes('ca_name')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN ca_name VARCHAR(255)`);
            if (!taskColNames.includes('business_description')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN business_description TEXT`);
            if (!taskColNames.includes('e_way_bill')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN e_way_bill VARCHAR(20)`);
            if (!taskColNames.includes('connected_banking')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN connected_banking VARCHAR(20)`);
            if (!taskColNames.includes('whatsapp_enabled')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN whatsapp_enabled VARCHAR(20)`);
            if (!taskColNames.includes('customisation')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN customisation VARCHAR(20)`);
            if (!taskColNames.includes('tally_slow')) await this.db.execute(`ALTER TABLE cloud_tdl_tasks ADD COLUMN tally_slow VARCHAR(20)`);

            // 6. UPDATE ENUM for task_type to include 'Connect'
            // This ensures existing tables get the new Enum value
            await this.db.execute(`ALTER TABLE cloud_tdl_tasks MODIFY COLUMN task_type ENUM('Development', 'Implementation', 'Connect') NOT NULL DEFAULT 'Development'`);

            // 7. Ensure Customer Table Tracking Columns are VARCHAR to support Cloud Users (USR...)
            const custCols = await this.db.query<any>(`DESCRIBE customer`);

            // Fix invalid dates to prevent ALTER table errors
            try {
                const dateCol = custCols.find((c: any) => c.Field === 'date');
                if (dateCol) {
                    // console.log('Cleaning up invalid dates in customer table...');
                    const targetVal = dateCol.Null === 'YES' ? 'NULL' : "'1970-01-01'";
                    // allow invalid dates for a moment to fix them
                    await this.db.execute(`SET sql_mode = ''`);
                    await this.db.execute(`UPDATE customer SET \`date\` = ${targetVal} WHERE CAST(\`date\` AS CHAR) = '0000-00-00'`);
                    // reset sql_mode (optional, but good practice if we knew the original, but for now just leaving it permissive or letting next connection reset it)
                    await this.db.execute(`SET sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'`);
                }
            } catch (e) {
                console.log('Date cleanup warning:', e.message);
            }

            const lvpCol = custCols.find((c: any) => c.Field === 'lastvisitperson');
            if (lvpCol && !lvpCol.Type.includes('varchar')) {
                await this.db.execute(`ALTER TABLE customer MODIFY COLUMN lastvisitperson VARCHAR(50)`);
                await this.db.execute(`ALTER TABLE customer MODIFY COLUMN lastcallperson VARCHAR(50)`);
            }

            // Ensure Customer Tracking Columns Exist
            const custColNames = custCols.map((c: any) => c.Field);
            if (!custColNames.includes('e_invoice')) await this.db.execute(`ALTER TABLE customer ADD COLUMN e_invoice VARCHAR(20)`);
            if (!custColNames.includes('business_type')) await this.db.execute(`ALTER TABLE customer ADD COLUMN business_type VARCHAR(100)`);
            if (!custColNames.includes('accounts_person_type')) await this.db.execute(`ALTER TABLE customer ADD COLUMN accounts_person_type VARCHAR(100)`);
            if (!custColNames.includes('it_person')) await this.db.execute(`ALTER TABLE customer ADD COLUMN it_person VARCHAR(255)`);
            if (!custColNames.includes('ca_name')) await this.db.execute(`ALTER TABLE customer ADD COLUMN ca_name VARCHAR(255)`);
            if (!custColNames.includes('business_description')) await this.db.execute(`ALTER TABLE customer ADD COLUMN business_description TEXT`);
            if (!custColNames.includes('e_way_bill')) await this.db.execute(`ALTER TABLE customer ADD COLUMN e_way_bill VARCHAR(20)`);
            if (!custColNames.includes('connected_banking')) await this.db.execute(`ALTER TABLE customer ADD COLUMN connected_banking VARCHAR(20)`);
            if (!custColNames.includes('whatsapp_enabled')) await this.db.execute(`ALTER TABLE customer ADD COLUMN whatsapp_enabled VARCHAR(20)`);
            if (!custColNames.includes('customisation')) await this.db.execute(`ALTER TABLE customer ADD COLUMN customisation VARCHAR(20)`);
            if (!custColNames.includes('tally_slow')) await this.db.execute(`ALTER TABLE customer ADD COLUMN tally_slow VARCHAR(20)`);
            if (!custColNames.includes('loyalty')) await this.db.execute(`ALTER TABLE customer ADD COLUMN loyalty VARCHAR(50)`);
            if (!custColNames.includes('conversion_probability')) await this.db.execute(`ALTER TABLE customer ADD COLUMN conversion_probability VARCHAR(50)`);
            if (!custColNames.includes('customer_behaviour')) await this.db.execute(`ALTER TABLE customer ADD COLUMN customer_behaviour TEXT`);

            // Fix invalid dates in TDL tables to prevent SELECT crashes
            try {
                await this.db.execute(`SET sql_mode = ''`);
                // cloud_tdl_requirements
                await this.db.execute(`UPDATE cloud_tdl_requirements SET dev_allotment_date = NULL WHERE CAST(dev_allotment_date AS CHAR) = '0000-00-00'`);

                // cloud_tdl_tasks
                await this.db.execute(`UPDATE cloud_tdl_tasks SET allotment_date = NULL WHERE CAST(allotment_date AS CHAR) = '0000-00-00'`);
                await this.db.execute(`UPDATE cloud_tdl_tasks SET deadline = NULL WHERE CAST(deadline AS CHAR) = '0000-00-00'`);
                await this.db.execute(`UPDATE cloud_tdl_tasks SET completion_date = NULL WHERE CAST(completion_date AS CHAR) = '0000-00-00'`);
                await this.db.execute(`UPDATE cloud_tdl_tasks SET check_in_date = NULL WHERE CAST(check_in_date AS CHAR) = '0000-00-00'`);

                await this.db.execute(`SET sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'`);
            } catch (e) {
                console.log('TDL Date cleanup warning:', e.message);
            }

            // Ensure task_updates table for remark/update timeline
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tdl_task_updates (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    task_id INT NOT NULL,
                    update_type ENUM('Remark','StatusChange','Assignment','Created') NOT NULL,
                    content TEXT NULL,
                    old_value VARCHAR(255) NULL,
                    new_value VARCHAR(255) NULL,
                    created_by VARCHAR(100) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_taskid (task_id)
                )
            `);

        } catch (error) {
            console.error('TdlService: Schema upgrade error:', error);
        }
    }

    async findAll(allowedTypes: string[] | null = null, filterByUser: string | null = null): Promise<any[]> {
        // allowedTypes = null → no type filter
        // allowedTypes = []   → no permissions, sees nothing
        // allowedTypes = ['cloud','tally'] → sees only those request_types
        // filterByUser = 'John' → keep only masters that have tasks assigned to John
        let typeFilter = '';
        if (allowedTypes !== null) {
            if (allowedTypes.length === 0) return [];
            const placeholders = allowedTypes.map(() => '?').join(',');
            typeFilter = `AND (m.request_type IN (${placeholders}) OR m.request_type IS NULL OR m.request_type = '')`;
        }

        // 1. Fetch All Masters
        const masters = await this.db.query<any>(`
            SELECT m.*, c.status as customer_status
            FROM cloud_tdl_master m
            LEFT JOIN customer c ON m.customer_id = c.id
            WHERE 1=1 ${typeFilter}
            ORDER BY m.created_at DESC
        `, allowedTypes || []);

        if (masters.length === 0) return [];

        // 2. Extract IDs for Batch Query
        const masterIds = masters.map(m => `'${m.id}'`).join(',');
        
        // 3. Batch Fetch Requirements
        const allRequirements = await this.db.query<any>(`
            SELECT * FROM cloud_tdl_requirements 
            WHERE tdl_id IN (${masterIds})
        `);

        // 4. Batch Fetch Tasks (Linked to Req OR Master)
        // Need Req IDs for the Task Query
        const reqIds = allRequirements.map(r => r.id);
        
        let allTasks: any[] = [];
        const taskConditions: string[] = [];

        if (reqIds.length > 0) {
            taskConditions.push(`req_id IN (${reqIds.join(',')})`);
        }
        if (masterIds.length > 0) {
            taskConditions.push(`tdl_id IN (${masterIds})`);
        }

        if (taskConditions.length > 0) {
            allTasks = await this.db.query<any>(`
                SELECT * FROM cloud_tdl_tasks 
                WHERE ${taskConditions.join(' OR ')}
            `);
        }

        // 5. Group by Master ID in Memory to avoid N+1
        const reqMap = new Map<string, any[]>();
        allRequirements.forEach(r => {
            if (!reqMap.has(r.tdl_id)) reqMap.set(r.tdl_id, []);
            reqMap.get(r.tdl_id)?.push(r);
        });

        // Group Tasks by ReqID and TdlID for fast lookup
        const tasksByReq = new Map<number, any[]>();
        const tasksByTdl = new Map<string, any[]>();

        allTasks.forEach(t => {
            if (t.req_id) {
                if (!tasksByReq.has(t.req_id)) tasksByReq.set(t.req_id, []);
                tasksByReq.get(t.req_id)?.push(t);
            }
            if (t.tdl_id) {
                if (!tasksByTdl.has(t.tdl_id)) tasksByTdl.set(t.tdl_id, []);
                tasksByTdl.get(t.tdl_id)?.push(t);
            }
        });

        // 6. Assemble Data
        for (const m of masters) {
            const mRequirements = reqMap.get(m.id) || [];
            
            // Gather all related tasks for this master
            let mTasks: any[] = [];
            
            // Add tasks from requirements
            mRequirements.forEach(r => {
                const rTasks = tasksByReq.get(r.id);
                if (rTasks) mTasks.push(...rTasks);
            });

            // Add tasks directly linked to master
            const directTasks = tasksByTdl.get(m.id);
            if (directTasks) mTasks.push(...directTasks);

            // Deduplicate tasks just in case (though logic separates them by req_id vs tdl_id usually)
            // But relying on ID uniqueness is safer if a task somehow has both (shouldn't happen often)
            // mTasks = Array.from(new Map(mTasks.map(t => [t.id, t])).values());

            m.requirements = this.calculateProgress(mRequirements, mTasks);
            m.implementation_tasks = directTasks || []; // Only master-linked ones for this field? verify original logic
            
            // Original Logic:
            // mTasks = query(tdl_id = m.id)
            // tasks = [...reqTasks, ...mTasks]
            // m.implementation_tasks = mTasks; 
            // So implementation_tasks are JUST the direct ones.
            
            this.checkExpiry(m);
        }

        // If filtering by user: keep masters that have at least one task where
        // the user is either the assignee (user_name) or the creator (assigned_by).
        // Creator visibility is required so the person who created/handed-off a
        // task can still see and track it from their own task list.
        if (filterByUser) {
            return masters.filter(m => {
                const allTasks = [
                    ...(m.implementation_tasks || []),
                    ...(m.requirements || []).flatMap((r: any) => r.tasks || []),
                ];
                return allTasks.some((t: any) => t.user_name === filterByUser || t.assigned_by === filterByUser);
            });
        }

        return masters;
    }

    // Critical Logic: Calculate Stats dynamically
    private calculateProgress(requirements: any[], tasks: any[]) {
        return requirements.map(req => {
            const reqTasks = tasks.filter(t => t.req_id === req.id);

            const devTasks = reqTasks.filter(t => t.task_type === 'Development');
            // Implementation tasks are now master-level mainly, but keep logic if old ones exist
            const impTasks = reqTasks.filter(t => t.task_type === 'Implementation');

            const completedDev = devTasks.filter(t => t.status === 'Completed').length;
            const completedImp = impTasks.filter(t => t.status === 'Completed').length;

            const devPercent = devTasks.length > 0 ? Math.round((completedDev / devTasks.length) * 100) : 0;
            const impPercent = impTasks.length > 0 ? Math.round((completedImp / impTasks.length) * 100) : 0;

            // Overdue Logic
            let overdueDays = 0;
            if (req.dev_allotment_date && req.development_days > 0) {
                const start = new Date(req.dev_allotment_date);
                const due = new Date(start);
                due.setDate(start.getDate() + req.development_days);

                // If Completed, use Actual Completion Date
                if (req.req_status === 'Completed') {
                    const completedDates = reqTasks
                        .filter(t => t.status === 'Completed' && t.completion_date)
                        .map(t => new Date(t.completion_date).getTime());

                    if (completedDates.length > 0) {
                        const lastCompletion = Math.max(...completedDates);
                        if (lastCompletion > due.getTime()) {
                            const diffTime = Math.abs(lastCompletion - due.getTime());
                            overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        }
                    }
                } else {
                    const today = new Date();
                    if (today > due && req.req_status !== 'Cancelled') {
                        const diffTime = Math.abs(today.getTime() - due.getTime());
                        overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    }
                }
            }

            return {
                ...req,
                tasks: reqTasks,
                stats: {
                    no_of_dev_tasks: devTasks.length,
                    no_of_imp_tasks: impTasks.length,
                    development_percent: devPercent,
                    implementation_percent: impPercent,
                    overdue_days: overdueDays
                }
            };
        });
    }

    async findOne(id: string): Promise<any> {
        const master = await this.db.queryOne<any>(`SELECT * FROM cloud_tdl_master WHERE id = ?`, [id]);
        if (!master) throw new NotFoundException(`TDL Request ${id} not found`);

        const requirements = await this.db.query<any>(`SELECT * FROM cloud_tdl_requirements WHERE tdl_id = ?`, [id]);

        let reqIds = requirements.map(r => r.id);
        let tasks: any[] = [];

        if (reqIds.length > 0) {
            const rTasks = await this.db.query<any>(`SELECT * FROM cloud_tdl_tasks WHERE req_id IN (${reqIds.join(',')})`);
            tasks = [...tasks, ...rTasks];
        }

        // Fetch Master Tasks
        const mTasks = await this.db.query<any>(`SELECT * FROM cloud_tdl_tasks WHERE tdl_id = ?`, [id]);
        tasks = [...tasks, ...mTasks];

        master.requirements = this.calculateProgress(requirements, tasks);
        master.implementation_tasks = mTasks;

        return this.checkExpiry(master);
    }

    async findByToken(token: string): Promise<any> {
        const master = await this.db.queryOne<any>(`SELECT * FROM cloud_tdl_master WHERE api_token = ?`, [token]);
        if (!master) throw new NotFoundException(`No TDL Request found for this token`);

        const requirements = await this.db.query<any>(`SELECT * FROM cloud_tdl_requirements WHERE tdl_id = ?`, [master.id]);
        const reqIds = requirements.map(r => r.id);
        let tasks: any[] = [];
        if (reqIds.length > 0) {
            const rTasks = await this.db.query<any>(`SELECT * FROM cloud_tdl_tasks WHERE req_id IN (${reqIds.join(',')})`);
            tasks = [...tasks, ...rTasks];
        }

        const mTasks = await this.db.query<any>(`SELECT * FROM cloud_tdl_tasks WHERE tdl_id = ?`, [master.id]);
        tasks = [...tasks, ...mTasks];

        master.requirements = this.calculateProgress(requirements, tasks);
        return this.checkExpiry(master);
    }

    async create(data: any): Promise<any> {
        const lastRequest = await this.db.queryOne<{ id: string }>(`SELECT id FROM cloud_tdl_master WHERE id LIKE 'TDL%' ORDER BY id DESC LIMIT 1`);
        let nextNum = 1;
        if (lastRequest && lastRequest.id.startsWith('TDL')) {
            const numPart = lastRequest.id.substring(3);
            if (!isNaN(parseInt(numPart))) nextNum = parseInt(numPart) + 1;
        }
        const id = `TDL${String(nextNum).padStart(3, '0')}`;
        const apiToken = require('crypto').randomBytes(16).toString('hex');

        await this.db.execute(`
            INSERT INTO cloud_tdl_master (id, person_name, phone_no, description, handled_by, status, api_token, created_at)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?, NOW())
        `, [id, data.person_name || '', data.phone_no || '', data.description || '', data.handled_by || null, apiToken]);

        return this.findOne(id);
    }

    async update(id: string, data: Partial<any> & { requirements?: any[] }): Promise<any> {
        const updates: string[] = [];
        const values: any[] = [];

        // Dynamic Update for Master (Removed AMC fields)
        const fields = [
            'person_name', 'customer_name', 'phone_no', 'description', 'handled_by', 'status',
            'customer_id', 'total_amount'
        ];

        for (const field of fields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(data[field] || null);
            }
        }

        if (updates.length > 0) {
            values.push(id);
            await this.db.execute(`UPDATE cloud_tdl_master SET ${updates.join(', ')} WHERE id = ?`, values);
        }

        // Requirements Logic
        if (data.requirements) {
            for (const req of data.requirements) {
                if (req.id) {
                    // Update Existing
                    await this.db.execute(`
                        UPDATE cloud_tdl_requirements 
                        SET requirement = ?, amount = ?, attachment = ?, development_days = ?, dev_allotment_date = ?, req_status = ?
                        WHERE id = ? AND tdl_id = ?
                    `, [
                        req.requirement, req.amount || 0, req.attachment || null,
                        req.development_days || 0, req.dev_allotment_date || null, req.req_status || 'Pending',
                        req.id, id
                    ]);
                } else if (req.requirement) {
                    // Insert New
                    await this.db.execute(`
                        INSERT INTO cloud_tdl_requirements (tdl_id, requirement, amount, attachment, development_days, dev_status, req_status)
                        VALUES (?, ?, ?, ?, ?, 'Pending', 'Pending')
                    `, [id, req.requirement, req.amount || 0, req.attachment || null, req.development_days || 0]);
                }
            }
        }

        return this.findOne(id);
    }

    // Helper to log history
    async logHistory(taskId: number, changedBy: string, type: string, oldVal: string, newVal: string, desc: string) {
        try {
            await this.db.execute(`
                INSERT INTO cloud_tdl_task_history (task_id, changed_by, change_type, old_value, new_value, description, created_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW())
            `, [taskId, changedBy, type, oldVal, newVal, desc]);
        } catch (e) {
            console.error('Failed to log history', e);
        }
    }

    async getTaskHistory(taskId: number) {
        return this.db.query(`SELECT * FROM cloud_tdl_task_history WHERE task_id = ? ORDER BY created_at DESC`, [taskId]);
    }

    // Refactored manageTasks to support TDL-ID linked tasks
    async manageTasks(parentId: number | string, tasks: any[], changedBy: string = 'System') {
        console.log('--- manageTasks CALLED ---');
        console.log('ParentID:', parentId, tasks?.length);

        // Determine if parentId is ReqID (number) or TdlID (string) - Assuming TDL ID format "TDL..."
        let reqId: number | null = null;
        let tdlId: string | null = null;

        if (typeof parentId === 'string' && parentId.startsWith('TDL')) {
            tdlId = parentId;
        } else if (typeof parentId === 'number' || !isNaN(Number(parentId))) {
            reqId = Number(parentId);
        } else {
            // Fallback: If it's a string but NOT starting with TDL, assume it's a TDL ID anyway if logic allows, OR check if numeric string
            if (!isNaN(Number(parentId))) {
                reqId = Number(parentId);
            } else {
                tdlId = parentId as string;
            }
        }

        for (const task of tasks) {
            // Robust ID Extraction
            let taskId = task.id;
            if (taskId === undefined || taskId === null) taskId = (task as any).Id;
            if (taskId === undefined || taskId === null) taskId = (task as any).ID;

            // ... (Sanitize fields - same as before)
            const rawUserName = task.user_name;
            const rawTaskType = task.task_type;
            const rawAllotmentDate = task.allotment_date;
            const rawDeadline = task.deadline;
            const rawCompletionDate = task.completion_date;
            const rawStatus = task.status;
            const rawRemark = task.remark;
            const rawAssignedBy = task.assigned_by;

            const rawCheckInDate = task.check_in_date;
            const rawCheckInTime = task.check_in_time;
            const rawCheckInLat = task.check_in_lat;
            const rawCheckInLng = task.check_in_lng;
            const rawCheckOutTime = task.check_out_time;
            const rawCheckOutLat = task.check_out_lat;
            const rawCheckOutLng = task.check_out_lng;
            const rawCheckOutResponse = task.check_out_response;

            // Tracking fields
            const trackingFields = {
                e_invoice: task.e_invoice,
                business_type: task.business_type,
                accounts_person_type: task.accounts_person_type,
                account_contact_id: task.account_contact_id,
                it_person: task.it_person,
                it_person_id: task.it_person_id,
                ca_name: task.ca_name,
                ca_id: task.ca_id,
                business_description: task.business_description,
                e_way_bill: task.e_way_bill,
                connected_banking: task.connected_banking,
                whatsapp_enabled: task.whatsapp_enabled,
                customisation: task.customisation,
                tally_slow: task.tally_slow,
                customer_behaviour: task.customer_behaviour,
                loyalty: task.loyalty,
                conversion_probability: task.conversion_probability
            };

            if (taskId) {
                // ... (Update Logic remains similar)
                const [prev] = await this.db.query<any>(`SELECT * FROM cloud_tdl_tasks WHERE id = ?`, [taskId]);

                // MERGE LOGIC
                const val = (newVal: any, oldVal: any) => newVal !== undefined ? newVal : oldVal;

                let autoStatus = rawStatus;
                let autoCompletionDate = rawCompletionDate;

                if (rawCheckOutTime && !prev?.check_out_time) {
                    autoStatus = 'Completed';
                    autoCompletionDate = this.getISTDate();
                }

                const finalUserName = val(rawUserName, prev?.user_name);
                const finalTaskType = val(rawTaskType, prev?.task_type);
                const finalAllotmentDate = val(rawAllotmentDate, prev?.allotment_date);
                const finalDeadline = val(rawDeadline, prev?.deadline);
                const finalCompletionDate = val(autoCompletionDate, prev?.completion_date);
                const finalStatus = val(autoStatus, prev?.status);
                const finalRemark = val(rawRemark, prev?.remark);
                const finalAssignedBy = val(rawAssignedBy, prev?.assigned_by);

                // ... (CheckIn/Out fields)
                const finalCheckInDate = val(rawCheckInDate, prev?.check_in_date);
                const finalCheckInTime = val(rawCheckInTime, prev?.check_in_time);
                const finalCheckInLat = val(rawCheckInLat, prev?.check_in_lat);
                const finalCheckInLng = val(rawCheckInLng, prev?.check_in_lng);

                const finalCheckOutTime = val(rawCheckOutTime, prev?.check_out_time);
                const finalCheckOutLat = val(rawCheckOutLat, prev?.check_out_lat);
                const finalCheckOutLng = val(rawCheckOutLng, prev?.check_out_lng);
                const finalCheckOutResponse = val(rawCheckOutResponse, prev?.check_out_response);

                // Merge tracking fields
                const finalTrackingFields = {
                    e_invoice: val(trackingFields.e_invoice, prev?.e_invoice),
                    business_type: val(trackingFields.business_type, prev?.business_type),
                    accounts_person_type: val(trackingFields.accounts_person_type, prev?.accounts_person_type),
                    it_person: val(trackingFields.it_person, prev?.it_person),
                    ca_name: val(trackingFields.ca_name, prev?.ca_name),
                    business_description: val(trackingFields.business_description, prev?.business_description),
                    e_way_bill: val(trackingFields.e_way_bill, prev?.e_way_bill),
                    connected_banking: val(trackingFields.connected_banking, prev?.connected_banking),
                    whatsapp_enabled: val(trackingFields.whatsapp_enabled, prev?.whatsapp_enabled),
                    customisation: val(trackingFields.customisation, prev?.customisation),
                    tally_slow: val(trackingFields.tally_slow, prev?.tally_slow),
                    customer_behaviour: val(trackingFields.customer_behaviour, prev?.customer_behaviour),
                    loyalty: val(trackingFields.loyalty, prev?.loyalty),
                    conversion_probability: val(trackingFields.conversion_probability, prev?.conversion_probability)
                };

                if (prev) {
                    if (prev.status !== finalStatus) {
                        await this.logHistory(taskId, changedBy, 'STATUS', prev.status, finalStatus, `Status changed from ${prev.status} to ${finalStatus}`);
                    }
                    if (prev.user_name !== finalUserName) {
                        await this.logHistory(taskId, changedBy, 'ASSIGNMENT', prev.user_name, finalUserName, `Reallocated from ${prev.user_name || 'Unassigned'} to ${finalUserName || 'Unassigned'}`);
                    }
                }

                await this.db.execute(`
                    UPDATE cloud_tdl_tasks 
                    SET user_name = ?, task_type = ?, allotment_date = ?, deadline = ?, completion_date = ?, status = ?, remark = ?, assigned_by = ?,
                        check_in_date = ?, check_in_time = ?, check_in_lat = ?, check_in_lng = ?,
                        check_out_time = ?, check_out_lat = ?, check_out_lng = ?, check_out_response = ?,
                        e_invoice = ?, business_type = ?, accounts_person_type = ?, it_person = ?, ca_name = ?,
                        business_description = ?, e_way_bill = ?, connected_banking = ?, whatsapp_enabled = ?,
                        customisation = ?, tally_slow = ?, customer_behaviour = ?, loyalty = ?, conversion_probability = ?
                    WHERE id = ?
                `, [finalUserName, finalTaskType, finalAllotmentDate, finalDeadline, finalCompletionDate, finalStatus, finalRemark, finalAssignedBy,
                    finalCheckInDate, finalCheckInTime, finalCheckInLat, finalCheckInLng,
                    finalCheckOutTime, finalCheckOutLat, finalCheckOutLng, finalCheckOutResponse,
                    finalTrackingFields.e_invoice, finalTrackingFields.business_type, finalTrackingFields.accounts_person_type,
                    finalTrackingFields.it_person, finalTrackingFields.ca_name, finalTrackingFields.business_description,
                    finalTrackingFields.e_way_bill, finalTrackingFields.connected_banking, finalTrackingFields.whatsapp_enabled,
                    finalTrackingFields.customisation, finalTrackingFields.tally_slow, finalTrackingFields.customer_behaviour,
                    finalTrackingFields.loyalty, finalTrackingFields.conversion_probability,
                    taskId]);

                // Update Customer Tracking Logic (Only for Connect Tasks usually, which have req_id)
                // If it's an implementation task, we might not have a req_id.
                // Logic: Connect tasks are created via createConnect so they have req_id. 
                // We should check if req_id exists before querying requirements.
                if (rawCheckOutTime && !prev?.check_out_time && prev?.req_id) {
                    // ... (Customer update logic same as before, only runs if req_id exists)
                    const reqInfo = await this.db.queryOne<any>(`SELECT r.tdl_id, r.requirement FROM cloud_tdl_requirements r WHERE r.id = ?`, [prev.req_id]);
                    if (reqInfo) {
                        const masterInfo = await this.db.queryOne<any>(`SELECT customer_id FROM cloud_tdl_master WHERE id = ?`, [reqInfo.tdl_id]);
                        // ... (Rest of update logic)
                        const customerId = masterInfo?.customer_id;
                        if (customerId) {
                            // Lookup ID (Use Cloud Users only, as per transition)
                            let personId = null;
                            const userResult = await this.db.queryOne<{ id: string }>(`SELECT id FROM cloud_users WHERE name = ?`, [finalUserName]);
                            if (userResult) personId = userResult.id;


                            const adminId = personId; // Keep variable name for compatibility below, though it can now be string
                            const completionDate = this.getISTDate();

                            // Update Tracking Fields on Customer table
                            const cUpdates: string[] = [];
                            const cParams: any[] = [];

                            for (const [key, fieldVal] of Object.entries(trackingFields)) {
                                if (fieldVal !== undefined) {
                                    cUpdates.push(`${key} = ?`);
                                    cParams.push(fieldVal || null);
                                }
                            }

                            const isVisit = reqInfo.requirement?.toLowerCase().includes('visit');

                            if (isVisit) {
                                await this.db.execute(
                                    `UPDATE customer SET 
                                        lastvisitid = ?, lastvisitperson = ?, lastvisitdate = ?, lastvisitremark = ?
                                        ${cUpdates.length > 0 ? ', ' + cUpdates.join(', ') : ''}
                                    WHERE id = ?`,
                                    [taskId, adminId, completionDate, finalRemark, ...cParams, customerId]
                                );
                            } else {
                                await this.db.execute(
                                    `UPDATE customer SET 
                                        lastcallid = ?, lastcallperson = ?, lastcalldate = ?, lastcallremark = ?, lastcallstatus = 'Completed'
                                        ${cUpdates.length > 0 ? ', ' + cUpdates.join(', ') : ''}
                                    WHERE id = ?`,
                                    [taskId, adminId, completionDate, finalRemark, ...cParams, customerId]
                                );
                            }
                        }
                    }
                }
            } else {

                // 1. Check for Active Task Constraint
                // If reqId is present, check against requirement. If tdlId present, check against Master?
                // User requirement: "implement task will be defined against the whole customization... development type task against requirement"
                // Assuming we still want to limit active tasks per parent?

                let activeTasks: any[] = [];
                if (reqId) {
                    activeTasks = await this.db.query<any>(`SELECT id FROM cloud_tdl_tasks WHERE req_id = ? AND status != 'Completed'`, [reqId]);
                } else if (tdlId) {
                    activeTasks = await this.db.query<any>(`SELECT id FROM cloud_tdl_tasks WHERE tdl_id = ? AND status != 'Completed'`, [tdlId]);
                }

                if (activeTasks.length > 0) {
                    throw new Error('Cannot create new task: A previous task is still active (not Completed).');
                }

                // 2. Force Assigned By to be the Creator
                const creator = changedBy;

                // 3. Default Allotment Date to Today
                const autoAllotmentDate = rawAllotmentDate || this.getISTDate();

                const res = await this.db.execute(`
                    INSERT INTO cloud_tdl_tasks 
                    (req_id, tdl_id, user_name, task_type, allotment_date, deadline, completion_date, status, remark, assigned_by,
                     check_in_date, check_in_time, check_in_lat, check_in_lng, check_out_time, check_out_lat, check_out_lng, check_out_response)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [reqId || null, tdlId || null, rawUserName ?? null, rawTaskType ?? 'Development', autoAllotmentDate, rawDeadline ?? null, rawCompletionDate ?? null, rawStatus ?? 'In Progress', rawRemark ?? '', creator,
                rawCheckInDate ?? null, rawCheckInTime ?? null, rawCheckInLat ?? null, rawCheckInLng ?? null, rawCheckOutTime ?? null, rawCheckOutLat ?? null, rawCheckOutLng ?? null, rawCheckOutResponse ?? null]);

                const newId = (res as any).insertId;
                if (newId) {
                    await this.logHistory(newId, changedBy, 'CREATED', '', '', `Task created by ${creator} (Entry by ${changedBy})`);
                }
            }
        }

        // 3. Update Requirement Status Sync (Only if reqId exists)
        if (reqId) {
            const allReqTasks = await this.db.query<any>(`SELECT status FROM cloud_tdl_tasks WHERE req_id = ?`, [reqId]);
            let newReqStatus = 'Pending';
            if (allReqTasks.length > 0) {
                const allCompleted = allReqTasks.every(t => t.status === 'Completed');
                newReqStatus = allCompleted ? 'Completed' : 'Pending';
            }
            await this.db.execute(`UPDATE cloud_tdl_requirements SET req_status = ? WHERE id = ?`, [newReqStatus, reqId]);
        }

        return { success: true };
    }

    async delete(id: string): Promise<{ success: boolean }> {
        const reqs = await this.db.query<{ id: number }>(`SELECT id FROM cloud_tdl_requirements WHERE tdl_id = ?`, [id]);
        if (reqs.length > 0) {
            for (const r of reqs) {
                await this.deleteRequirement(r.id);
            }
        }
        await this.db.execute(`DELETE FROM cloud_tdl_master WHERE id = ?`, [id]);
        return { success: true };
    }

    async deleteRequirement(reqId: number): Promise<void> {
        const tasks = await this.db.query<any>(`SELECT id FROM cloud_tdl_tasks WHERE req_id = ?`, [reqId]);
        const taskIds = tasks.map(t => t.id);

        if (taskIds.length > 0) {
            await this.db.execute(`DELETE FROM cloud_tdl_task_history WHERE task_id IN (${taskIds.join(',')})`);
            await this.db.execute(`DELETE FROM cloud_tdl_tasks WHERE req_id = ?`, [reqId]);
        }
        await this.db.execute(`DELETE FROM cloud_tdl_requirements WHERE id = ?`, [reqId]);
    }

    async deleteTask(taskId: number, user?: any): Promise<void> {
        const task = await this.db.queryOne<any>(`SELECT * FROM cloud_tdl_tasks WHERE id = ?`, [taskId]);
        if (!task) return;

        if (user) {
            const isAdmin = user.role?.toLowerCase() === 'admin';
            const userEmail = user.email?.toLowerCase();
            const userName = user.name?.toLowerCase();
            
            const taskCreator = task.assigned_by?.toLowerCase();

            const isCreator = (taskCreator && (taskCreator === userEmail || taskCreator === userName));

            if (!isAdmin && !isCreator) {
                throw new ForbiddenException('You are not authorized to delete this task');
            }
        }

        await this.db.execute(`DELETE FROM cloud_tdl_task_history WHERE task_id = ?`, [taskId]);
        await this.db.execute(`DELETE FROM cloud_tdl_tasks WHERE id = ?`, [taskId]);
    }
    async createConnect(data: {
        customer_id: number;
        customer_name: string;
        person_name: string;
        phone_no: string;
        type: 'Call' | 'Visit';
        assign_to: string;
        deadline: string;
        remark: string;
        created_by: string;
        check_in_date?: string;
        check_in_time?: string;
        check_in_lat?: string;
        check_in_lng?: string;
        e_invoice?: string;
        business_type?: string;
        loyalty?: string;
        conversion_probability?: string;
    }) {
        const { customer_id, customer_name, person_name, phone_no, type, assign_to, deadline, remark, created_by,
            check_in_date, check_in_time, check_in_lat, check_in_lng,
            e_invoice, business_type, loyalty, conversion_probability
        } = data;

        // 1. Create TDL Master
        const tdlId = `TDL-${Date.now()}`;
        await this.db.execute(
            `INSERT INTO cloud_tdl_master 
            (id, customer_id, customer_name, person_name, phone_no, request_type, status, handled_by, description, project_name, created_at) 
            VALUES (?, ?, ?, ?, ?, 'Connect', 'In Progress', ?, ?, 'Connect Activity', NOW())`,
            [tdlId, customer_id, customer_name, person_name, phone_no, assign_to, remark]
        );

        // 2. Create Requirement (The Activity Type)
        const reqRes: any = await this.db.execute(
            `INSERT INTO cloud_tdl_requirements (tdl_id, requirement, amount, req_status, dev_status) VALUES (?, ?, 0, 'In Progress', 'Pending')`,
            [tdlId, `Customer ${type}`]
        );
        const reqId = reqRes.insertId;

        const taskRes: any = await this.db.execute(
            `INSERT INTO cloud_tdl_tasks 
            (req_id, user_name, task_type, status, remark, assigned_by, deadline, allotment_date,
             check_in_date, check_in_time, check_in_lat, check_in_lng) 
            VALUES (?, ?, 'Connect', 'In Progress', ?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
            [reqId, assign_to, remark, created_by, deadline,
                check_in_date || null, check_in_time || null, check_in_lat || null, check_in_lng || null
            ]
        );
        const taskId = taskRes.insertId;

        return { success: true, tdlId, reqId, taskId };
    }
    async getPendingConnectTasks(userName: string = '') {
        // console.log("getPendingConnectTasks CALLED for:", userName);
        let sql = `
            SELECT 
                t.*,
                m.customer_name, m.person_name, COALESCE(NULLIF(m.phone_no, ''), NULLIF(c.mobile, ''), ccd.mobile_no) as phone_no,
                c.lattitude as customer_lat, c.longitude as customer_lng,
                c.address1, c.address2, pv.city as city, c.pincode,
                c.status as customer_status,
                CASE WHEN r.requirement LIKE '%Call%' THEN 'Call' ELSE 'Visit' END as visit_type
            FROM cloud_tdl_tasks t
            LEFT JOIN cloud_tdl_requirements r ON t.req_id = r.id
            LEFT JOIN cloud_tdl_master m ON r.tdl_id = m.id
            LEFT JOIN customer c ON m.customer_id = c.id
            LEFT JOIN pincode pv ON c.pincode = pv.pincode
            LEFT JOIN customer_contact_mapping_data ccm ON ccm.customer_id = c.id AND ccm.status = 'Active' AND ccm.primary_contact = 'Yes'
            LEFT JOIN customer_contact_details ccd ON ccd.id = ccm.mobile_id AND ccd.status = 'Active'
            WHERE t.task_type = 'Connect'
              AND t.status IN ('Pending', 'In Progress', 'Paused')
        `;

        if (userName) {
            sql += ` AND (
                  t.user_name = ? 
                  OR LOWER(t.user_name) = LOWER(?)
                  OR LOWER(REPLACE(t.user_name, ' ', '')) LIKE CONCAT('%', LOWER(REPLACE(?, ' ', '')), '%')
              )`;
        }

        // Wait, m.customer_id is in master.
        const tasks = await this.db.query<any>(sql, userName ? [userName, userName, userName] : []);
        return tasks;
    }

    async getCompletedConnectTasks(page: number, limit: number, filters: any = {}) {
        const offset = (page - 1) * limit;
        const params: any[] = [];
        let where = " WHERE t.task_type = 'Connect' AND t.status = 'Completed' ";

        if (filters.user_name && filters.user_name !== 'all') {
            where += " AND t.user_name LIKE ? ";
            params.push(`%${filters.user_name}%`);
        }
        if (filters.search) {
            where += " AND (m.customer_name LIKE ? OR t.user_name LIKE ?) ";
            params.push(`%${filters.search}%`, `%${filters.search}%`);
        }
        if (filters.date_from) {
            where += " AND DATE(t.completion_date) >= ? ";
            params.push(filters.date_from);
        }
        if (filters.date_to) {
            where += " AND DATE(t.completion_date) <= ? ";
            params.push(filters.date_to);
        }

        const sql = `
            SELECT 
                t.id,
                t.req_id,
                t.user_name,
                CASE WHEN r.requirement LIKE '%Call%' THEN 'Call' ELSE 'Visit' END as visit_type,
                t.status,
                t.check_in_date as scheduled_date,
                t.check_in_time,
                t.check_in_lat,
                t.check_in_lng,
                t.check_out_time,
                t.check_out_lat,
                t.check_out_lng,
                t.remark as check_out_remark,
                t.completion_date,
                t.e_invoice,
                t.business_type,
                t.accounts_person_type,
                t.it_person,
                t.ca_name,
                t.business_description,
                t.e_way_bill,
                t.connected_banking,
                t.whatsapp_enabled,
                t.customisation,
                t.tally_slow,
                t.loyalty,
                t.conversion_probability,
                t.check_out_response,
                t.customer_behaviour,
                m.customer_name,
                m.person_name,
                COALESCE(NULLIF(m.phone_no, ''), NULLIF(c.mobile, ''), ccd.mobile_no) as phone_no,
                c.status as customer_status
            FROM cloud_tdl_tasks t
            LEFT JOIN cloud_tdl_requirements r ON t.req_id = r.id
            LEFT JOIN cloud_tdl_master m ON r.tdl_id = m.id
            LEFT JOIN customer c ON m.customer_id = c.id
            LEFT JOIN customer_contact_mapping_data ccm ON ccm.customer_id = c.id AND ccm.status = 'Active' AND ccm.primary_contact = 'Yes'
            LEFT JOIN customer_contact_details ccd ON ccd.id = ccm.mobile_id AND ccd.status = 'Active'
            ${where}
            ORDER BY t.completion_date DESC, t.id DESC
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const countSql = `
            SELECT COUNT(*) as total 
            FROM cloud_tdl_tasks t
            LEFT JOIN cloud_tdl_requirements r ON t.req_id = r.id
            LEFT JOIN cloud_tdl_master m ON r.tdl_id = m.id
            ${where}
        `;

        const [data, totalRes] = await Promise.all([
            this.db.queryStandard<any>(sql, params),
            this.db.queryOne<{ total: number }>(countSql, params.slice(0, -2))
        ]);

        return {
            data,
            total: totalRes?.total || 0,
            page,
            limit
        };
    }

    // ── Standalone Task Creation (from floating + button) ──

    async createStandaloneTask(data: {
        customer_id?: number;
        customer_name?: string;
        person_name?: string;
        phone_no?: string;
        task_category: 'customer' | 'external';
        visit_type?: 'Call' | 'Visit';
        date: string;
        remark: string;
        assign_to?: string;
        created_by: string;
    }) {
        const { customer_id, customer_name, person_name, phone_no, task_category, visit_type, date, remark, assign_to, created_by } = data;
        const assignee = assign_to || created_by;

        // Create TDL Master
        const tdlId = `TDL-${Date.now()}`;
        const description = task_category === 'customer'
            ? `${visit_type} - ${customer_name || 'Customer'}`
            : `External Task`;

        await this.db.execute(
            `INSERT INTO cloud_tdl_master
            (id, customer_id, customer_name, person_name, phone_no, request_type, status, handled_by, description, project_name, created_at)
            VALUES (?, ?, ?, ?, ?, 'Connect', 'In Progress', ?, ?, ?, NOW())`,
            [tdlId, customer_id || null, customer_name || null, person_name || null, phone_no || null, assignee, remark, task_category === 'customer' ? 'Customer Task' : 'External Task']
        );

        // Create Requirement
        const reqLabel = task_category === 'customer' ? `Customer ${visit_type || 'Task'}` : 'External Task';
        const reqRes: any = await this.db.execute(
            `INSERT INTO cloud_tdl_requirements (tdl_id, requirement, amount, req_status, dev_status) VALUES (?, ?, 0, 'In Progress', 'Pending')`,
            [tdlId, reqLabel]
        );
        const reqId = reqRes.insertId;

        // Create Task (no check-in/checkout)
        const taskRes: any = await this.db.execute(
            `INSERT INTO cloud_tdl_tasks
            (req_id, user_name, task_type, status, remark, assigned_by, deadline, allotment_date)
            VALUES (?, ?, 'Connect', 'Pending', ?, ?, ?, CURDATE())`,
            [reqId, assignee, remark, created_by, date || null]
        );
        const taskId = taskRes.insertId;

        // Log creation in task history
        await this.db.execute(
            `INSERT INTO cloud_tdl_task_history (task_id, changed_by, change_type, new_value, description, created_at)
             VALUES (?, ?, 'Created', ?, ?, NOW())`,
            [taskId, created_by, 'Pending', `Task created: ${description}`]
        );

        return { success: true, tdlId, reqId, taskId };
    }

    // ── Task Update (remark + status like lead requirement updates) ──

    async onModuleInitTaskUpdates() {
        // Ensure task_updates table exists (called from onModuleInit)
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS cloud_tdl_task_updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_id INT NOT NULL,
                update_type ENUM('Remark','StatusChange','Assignment','Created') NOT NULL,
                content TEXT NULL,
                old_value VARCHAR(255) NULL,
                new_value VARCHAR(255) NULL,
                created_by VARCHAR(100) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_taskid (task_id)
            )
        `);
    }

    async addTaskUpdate(taskId: number, data: { remark?: string; status?: string; next_date?: string }, updatedBy: string) {
        // Get existing task
        const tasks = await this.db.query<any>('SELECT * FROM cloud_tdl_tasks WHERE id = ?', [taskId]);
        if (!tasks.length) return { success: false, message: 'Task not found' };

        const task = tasks[0];

        // Update status if changed
        if (data.status && data.status !== task.status) {
            await this.db.execute('UPDATE cloud_tdl_tasks SET status = ? WHERE id = ?', [data.status, taskId]);
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_updates (task_id, update_type, old_value, new_value, created_by)
                 VALUES (?, 'StatusChange', ?, ?, ?)`,
                [taskId, task.status, data.status, updatedBy],
            );

            // Also log in existing task_history
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_history (task_id, changed_by, change_type, old_value, new_value, description, created_at)
                 VALUES (?, ?, 'StatusChange', ?, ?, ?, NOW())`,
                [taskId, updatedBy, task.status, data.status, `Status: ${task.status} → ${data.status}`]
            );

            // If marking completed, set completion date
            if (data.status === 'Completed') {
                await this.db.execute('UPDATE cloud_tdl_tasks SET completion_date = CURDATE() WHERE id = ?', [taskId]);
            }
        }

        // Shift to a new date
        if (data.next_date) {
            const oldDate = task.allotment_date ? String(task.allotment_date).split('T')[0] : '';
            await this.db.execute('UPDATE cloud_tdl_tasks SET allotment_date = ? WHERE id = ?', [data.next_date, taskId]);
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_updates (task_id, update_type, content, old_value, new_value, created_by)
                 VALUES (?, 'DateChange', ?, ?, ?, ?)`,
                [taskId, `Shifted: ${oldDate || '—'} → ${data.next_date}`, oldDate, data.next_date, updatedBy],
            );
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_history (task_id, changed_by, change_type, old_value, new_value, description, created_at)
                 VALUES (?, ?, 'DateChange', ?, ?, ?, NOW())`,
                [taskId, updatedBy, oldDate, data.next_date, `Shifted: ${oldDate || '—'} → ${data.next_date}`]
            );
        }

        // Add remark
        if (data.remark) {
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_updates (task_id, update_type, content, created_by)
                 VALUES (?, 'Remark', ?, ?)`,
                [taskId, data.remark, updatedBy],
            );

            // Also update task remark
            await this.db.execute('UPDATE cloud_tdl_tasks SET remark = ? WHERE id = ?', [data.remark, taskId]);

            // Log in existing task_history
            await this.db.execute(
                `INSERT INTO cloud_tdl_task_history (task_id, changed_by, change_type, new_value, description, created_at)
                 VALUES (?, ?, 'Remark', ?, ?, NOW())`,
                [taskId, updatedBy, data.remark, `Remark: ${data.remark.substring(0, 80)}`]
            );
        }

        return { success: true, message: 'Task updated' };
    }

    async getTaskUpdates(taskId: number) {
        const data = await this.db.query<any>(
            `SELECT * FROM cloud_tdl_task_updates WHERE task_id = ? ORDER BY created_at DESC`,
            [taskId],
        );
        return { success: true, data };
    }
}
