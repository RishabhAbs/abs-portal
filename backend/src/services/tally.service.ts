import { Injectable, OnModuleInit, Logger, ForbiddenException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '../database/db.service';

@Injectable()
export class TallyService implements OnModuleInit {
    private readonly logger = new Logger(TallyService.name);
    private isSyncing = false;

    constructor(private db: DbService) { }

    async onModuleInit() {
        try {
            // Ensure Tally Renewal History Table
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_tally_renewal_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tally_serial VARCHAR(50) NOT NULL,
                    entry_type VARCHAR(20),
                    start_time DATETIME,
                    end_time DATETIME,
                    next_follow_date DATE,
                    status VARCHAR(50),
                    remarks TEXT,
                    created_by VARCHAR(100),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Add new columns to tallydetails if they don't exist for quick lookup
            const columns = await this.db.query<any>(`DESCRIBE tallydetails`);
            const colNames = columns.map((c: any) => c.Field);
            
            if (!colNames.includes('next_follow_date')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN next_follow_date DATE`);
            if (!colNames.includes('expiry_remarks')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN expiry_remarks TEXT`);
            if (!colNames.includes('last_call_type')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN last_call_type VARCHAR(20)`);
            if (!colNames.includes('last_call_at')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN last_call_at DATETIME`);
            if (!colNames.includes('created_at')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
            if (!colNames.includes('updated_at')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
            if (!colNames.includes('became_our_tally_at')) await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN became_our_tally_at DATETIME DEFAULT NULL`);

            // Tally API Sync Columns
            const syncCols = ['tally_api_checked_at', 'tally_api_flavor', 'tally_api_edition', 'tally_api_org', 'tally_api_email', 'tally_api_mobile', 'tally_api_activation'];
            for (const col of syncCols) {
                if (!colNames.includes(col)) {
                    const type = col === 'tally_api_checked_at' ? 'DATETIME' : 'VARCHAR(255)';
                    await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN ${col} ${type}`);
                }
            }

            // Cloud Serial Update Record Table — audit log of Tally API change detection
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS cloud_serial_update_record (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tally_serial_id INT NOT NULL,
                    tally_serial VARCHAR(50),
                    changes JSON NOT NULL,
                    source VARCHAR(50) DEFAULT 'tally_api',
                    changed_by VARCHAR(100) DEFAULT 'system',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_serial_id (tally_serial_id),
                    INDEX idx_serial (tally_serial)
                )
            `);

            // Billed marker on tallydetails — set ONLY by the quick-invoice
            // flow (markTallyBilled), never via the manual status dropdown.
            const billedColCheck = await this.db.query<any>(
                `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tallydetails' AND COLUMN_NAME = 'billed_voucher_id'`
            ).catch(() => []);
            if ((billedColCheck[0]?.cnt ?? 0) === 0) {
                await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN billed_voucher_id INT DEFAULT NULL`).catch(() => {});
                await this.db.execute(`ALTER TABLE tallydetails ADD COLUMN billed_at DATETIME DEFAULT NULL`).catch(() => {});
                await this.db.execute(`ALTER TABLE tallydetails ADD INDEX idx_billed_voucher (billed_voucher_id)`).catch(() => {});
            }

            // Add tally_synced_at to vch_details, items and customer for
            // poll-and-acknowledge sync with Tally (vouchers + masters).
            for (const table of ['vch_details', 'items', 'customer']) {
                const colCheck = await this.db.query<any>(
                    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'tally_synced_at'`,
                    [table],
                ).catch(() => []);
                if ((colCheck[0]?.cnt ?? 0) === 0) {
                    await this.db.execute(`ALTER TABLE ${table} ADD COLUMN tally_synced_at DATETIME DEFAULT NULL`).catch(() => {});
                    await this.db.execute(`ALTER TABLE ${table} ADD INDEX idx_tally_sync (tally_synced_at)`).catch(() => {});
                }
            }

        } catch (error) {
            console.error('TallyService Init Error:', error.message);
        }
    }

    // Run daily at 01:15 AM Asia/Kolkata time
    @Cron('15 1 * * *', { timeZone: 'Asia/Kolkata' })
    async syncTallySerialsWithApi() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        this.logger.log('Starting Tally Serial Sync Job...');

        try {
            // Get up to 100 unchecked serials (using tally_api_checked_at IS NULL)
            // Or ones that haven't been checked in the last month. The user said "search only for once"
            const unchecked = await this.db.queryStandard(`
                SELECT id, tallyserial, tally_status
                FROM tallydetails
                WHERE tallyserial IS NOT NULL AND tallyserial != ''
                  AND tally_api_checked_at IS NULL
                LIMIT 50
            `);

            if (!unchecked.length) {
                this.logger.log('No unchecked Tally serials found to sync.');
                this.isSyncing = false;
                return;
            }

            this.logger.log(`Found ${unchecked.length} serials to check with Tally API...`);

            const apikey = '9e16a5f3-3f30-4277-8279-a1da597410cb';

            for (const row of unchecked) {
                try {
                    const url = `https://tallysolutions.com/api/v1/serialexpiry?apikey=${apikey}&slnum=${row.tallyserial}`;
                    const res = await fetch(url);
                    
                    if (!res.ok) {
                        this.logger.error(`Failed to fetch API for ${row.tallyserial}: ${res.statusText}`);
                        // Mark as checked to prevent infinite failure loops
                        await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [row.id]);
                        continue;
                    }

                    const json = await res.json();
                    
                    if (json.status_code === 'T200') {
                        if (json.expiry_details?.serial_status === 0) {
                            // "This Serial Number is not tagged to you !"
                            this.logger.log(`Serial ${row.tallyserial} is not tagged to us. Setting customer status to 'Not Our Customer'.`);

                            // Update customer table via joining tallydetails
                            await this.db.execute(`
                                UPDATE customer c
                                JOIN tallydetails td ON c.id = td.customerid
                                SET c.status = 'Not Our Customer'
                                WHERE td.id = ?
                            `, [row.id]);

                            // Stamp left_date = NOW() only if serial was previously 'Our Tally'
                            // (fresh departure). Already-known departures keep their historical left_date.
                            if (row.tally_status === 'Our Tally') {
                                await this.db.execute(`
                                    UPDATE tallydetails SET tally_api_checked_at = NOW(), left_date = NOW()
                                    WHERE id = ?
                                `, [row.id]);
                                this.logger.log(`Serial ${row.tallyserial} departed — left_date stamped.`);
                            } else {
                                await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [row.id]);
                            }
                        } else if (json.expiry_details?.serial_status === 1 && typeof json.expiry_details.serial_data === 'object') {
                            const data = json.expiry_details.serial_data;
                            
                            // Parse datestrings if needed (e.g. 31-03-2026 -> 2026-03-31)
                            let parsedExpiry = null;
                            if (data.expiry) {
                                const parts = data.expiry.split('-');
                                if (parts.length === 3) parsedExpiry = `${parts[2]}-${parts[1]}-${parts[0]}`;
                            }

                            // update multiple fields
                            await this.db.execute(`
                                UPDATE tallydetails SET 
                                    tally_api_checked_at = NOW(),
                                    tally_api_flavor = ?,
                                    tally_api_edition = ?,
                                    tally_api_org = ?,
                                    tally_api_email = ?,
                                    tally_api_mobile = ?,
                                    tally_api_activation = ?
                                    ${parsedExpiry ? ', tallyexpirydate = ?' : ''}
                                WHERE id = ?
                            `, [
                                data.flavour || null,
                                data.edition || null,
                                data.org_name || null,
                                data.contact_email || null,
                                data.contact_mobile || null,
                                data.activation_date || null,
                                ...(parsedExpiry ? [parsedExpiry] : []),
                                row.id
                            ]);
                            this.logger.log(`Successfully synced serial ${row.tallyserial}`);
                        } else {
                            // Status is something else, but we got a response.
                            await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [row.id]);
                        }
                    } else {
                        // Mark checked even if not found
                        await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [row.id]);
                    }
                } catch (e: any) {
                    this.logger.error(`Error syncing serial ${row.tallyserial}: ${e.message}`);
                }
                
                // Sleep slightly to respect rate limits
                await new Promise(r => setTimeout(r, 1000));
            }

            this.logger.log('Finished Tally Serial Sync batch.');
        } catch (e: any) {
            this.logger.error('Sync Job failed: ' + e.message);
        } finally {
            this.isSyncing = false;
        }
    }

    async getExpiryReport({ customer_type, expiry_status, search, page = 1, limit = 50, date_from, date_to, user }: { 
        customer_type?: 'our' | 'not_our', 
        expiry_status?: string, 
        search?: string, 
        page?: number, 
        limit?: number, 
        date_from?: string, 
        date_to?: string,
        user?: any
    }) {
        const offset = (page - 1) * limit;

        // Base where clause (shared by counts and data)
        let baseWhere = "WHERE td.active_status = 'Active'";
        const baseParams: any[] = [];

        // Group Filtering Logic
        if (user && user.role?.toLowerCase() !== 'admin') {
            const permKey = customer_type === 'our' ? 'expiry_renew_our' : 'expiry_renew_not_our';
            const userPerms = user.permissions?.[permKey];
            
            if (userPerms && !userPerms.view_all_groups) {
                // User can only see their own group.
                // We join admin and cloud_users directly to account for mismatched IDs.
                // It matches if EITHER the admin's name OR the cloud_user's name starts with the logged-in user, or vice versa (e.g. "Kalu" vs "Kalu Ram").
                baseWhere += " AND (a.name LIKE CONCAT(?, '%') OR ? LIKE CONCAT(a.name, '%') OR cu.name LIKE CONCAT(?, '%') OR ? LIKE CONCAT(cu.name, '%'))";
                baseParams.push(user.name, user.name, user.name, user.name);
            }
        }

        if (customer_type) {
            baseWhere += " AND td.tally_status = ?";
            baseParams.push(customer_type === 'our' ? 'Our Tally' : 'Not Our Tally');
        }


        if (search) {
            baseWhere += ' AND (td.tallyserial LIKE ? OR c.company LIKE ? OR c.mobile LIKE ? OR a.name LIKE ? OR cu.name LIKE ?)';
            const s = `%${search}%`;
            baseParams.push(s, s, s, s, s);
        }

        if (date_from) {
            // Use DATE() to handle datetime fields
            baseWhere += ' AND DATE(td.tallyexpirydate) >= ?';
            baseParams.push(date_from);
        }

        if (date_to) {
            baseWhere += ' AND DATE(td.tallyexpirydate) <= ?';
            baseParams.push(date_to);
        }

        // Status-specific where clause. 'Billed' is NOT a singlemaster
        // status — it's the auto-set marker stamped when a voucher is
        // created from this report (billed_voucher_id), so it filters on
        // that column instead of esm.name.
        let statusWhere = '';
        const statusParams: any[] = [];
        if (expiry_status === 'Billed') {
            statusWhere = ' AND td.billed_voucher_id IS NOT NULL';
        } else if (expiry_status && expiry_status !== 'All') {
            statusWhere = ' AND esm.name = ?';
            statusParams.push(expiry_status);
        }

        const countQuery = `
            SELECT COUNT(*) as total
            FROM tallydetails td
            JOIN customer c ON td.customerid = c.id
            LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
            LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR)
            LEFT JOIN singlemaster esm ON td.expiry_status = CAST(esm.id AS CHAR) AND esm.type = 'ExpiryStatus'
            ${baseWhere} ${statusWhere}
        `;

        const totalResult = await this.db.queryOne<{ total: number }>(countQuery, [...baseParams, ...statusParams]);

        const allCountQuery = `
            SELECT COUNT(*) as total
            FROM tallydetails td
            JOIN customer c ON td.customerid = c.id
            LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
            LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR)
            ${baseWhere}
        `;
        const allCountResult = await this.db.queryOne<{ total: number }>(allCountQuery, baseParams);

        const dataQuery = `
            SELECT 
                td.*,
                c.company as company_name,
                (
                    SELECT ccd.mobile_no 
                    FROM customer_contact_mapping_data ccm 
                    JOIN customer_contact_details ccd ON ccm.mobile_id = ccd.id 
                    WHERE ccm.customer_id = td.customerid AND ccd.status = 'Active' 
                    ORDER BY CASE WHEN ccm.primary_contact = 'Yes' THEN 1 ELSE 2 END, ccd.id ASC LIMIT 1
                ) AS customer_mobile,
                (
                    SELECT ccd.contact_person 
                    FROM customer_contact_mapping_data ccm 
                    JOIN customer_contact_details ccd ON ccm.mobile_id = ccd.id 
                    WHERE ccm.customer_id = td.customerid AND ccd.status = 'Active' 
                    ORDER BY CASE WHEN ccm.primary_contact = 'Yes' THEN 1 ELSE 2 END, ccd.id ASC LIMIT 1
                ) AS customer_person,
                c.status as customer_type,
                sm.name as flavor_name,
                esm.name as expiry_status_name,
                COALESCE(cu.name, a.name) as staff_name,
                r.name as reseller_name,
                vb.vch_no as billed_vch_no
            FROM tallydetails td
            JOIN customer c ON td.customerid = c.id
            LEFT JOIN singlemaster sm ON td.tallyflavor = CAST(sm.id AS CHAR)
            LEFT JOIN singlemaster esm ON td.expiry_status = CAST(esm.id AS CHAR) AND esm.type = 'ExpiryStatus'
            LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
            LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR)
            LEFT JOIN reseller r ON c.resellerid = r.id
            LEFT JOIN vch_details vb ON vb.id = td.billed_voucher_id
            ${baseWhere} ${statusWhere}
            ORDER BY td.tallyexpirydate ASC
            LIMIT ? OFFSET ?
        `;

        const data = await this.db.queryStandard(dataQuery, [...baseParams, ...statusParams, Number(limit), Number(offset)]);

        // Get status counts based on baseWhere (includes search and dates)
        const statusCountsQuery = `
            SELECT esm.name as status_name, COUNT(*) as count
            FROM tallydetails td
            JOIN customer c ON td.customerid = c.id
            LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
            LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR)
            LEFT JOIN singlemaster esm ON td.expiry_status = CAST(esm.id AS CHAR) AND esm.type = 'ExpiryStatus'
            ${baseWhere}
            GROUP BY esm.name
        `;
        const statusCounts = await this.db.query(statusCountsQuery, baseParams);

        // Billed count (independent of the manual-status buckets above)
        const billedCountRow = await this.db.queryOne<{ total: number }>(
            `SELECT COUNT(*) as total
             FROM tallydetails td
             JOIN customer c ON td.customerid = c.id
             LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
             LEFT JOIN admin a ON c.group = CAST(a.id AS CHAR)
             ${baseWhere} AND td.billed_voucher_id IS NOT NULL`,
            baseParams,
        ).catch(() => null);

        return {
            data: data.map(row => ({
                ...row,
                expiry_status: row.expiry_status_name || (row.expiry_status === '0' || !row.expiry_status ? 'Pending' : row.expiry_status)
            })),
            total: totalResult?.total || 0,
            allCount: allCountResult?.total || 0,
            statusCounts: {
                ...statusCounts.reduce((acc, curr) => {
                    acc[curr.status_name || 'Pending'] = curr.count;
                    return acc;
                }, {}),
                Billed: Number(billedCountRow?.total) || 0,
            },
            page,
            limit
        };
    }

    /** Stamp a tallydetails row as billed — the ONLY way a serial becomes
     *  "Billed" in the expiry report. Called by the quick-invoice flow right
     *  after the voucher saves; the manual renewal-call status dropdown has
     *  no Billed option, and updateExpiryCall never touches these columns.
     *  Verifies the voucher actually exists so the marker can't be forged
     *  with an arbitrary id. */
    async markTallyBilled(tallyserial: string, voucherId: number) {
        if (!tallyserial || !voucherId) {
            return { success: false, message: 'tallyserial and voucher_id are required' };
        }
        const voucher = await this.db.queryOne<any>(
            `SELECT id, vch_no FROM vch_details WHERE id = ?`,
            [voucherId],
        );
        if (!voucher) return { success: false, message: `Voucher ${voucherId} not found` };
        const result = await this.db.execute(
            `UPDATE tallydetails SET billed_voucher_id = ?, billed_at = NOW() WHERE tallyserial = ?`,
            [voucherId, tallyserial],
        );
        return { success: true, updated: result.affectedRows ?? 0, vch_no: voucher.vch_no || null };
    }


    async updateExpiryCall(data: {
        serial: string;
        entry_type: string;
        start_time: string;
        end_time: string;
        next_follow_date: string;
        expiry_status: string;
        remarks: string;
        user_name: string;
    }) {
        // Find expiry status ID from name
        const statusMaster = await this.db.queryOne<{ id: number }>(
            "SELECT id FROM singlemaster WHERE name = ? AND type = 'ExpiryStatus'", 
            [data.expiry_status]
        );
        const statusId = statusMaster?.id || data.expiry_status;

        // Update current state in tallydetails
        await this.db.execute(`
            UPDATE tallydetails 
            SET expiry_status = ?, next_follow_date = ?, expiry_remarks = ?, 
                last_call_type = ?, last_call_at = NOW()
            WHERE tallyserial = ?
        `, [
            statusId, data.next_follow_date || null, data.remarks, data.entry_type, data.serial
        ]);

        return { success: true };
    }

    // ── Manual sync of a single serial against the Tally API (on-demand) ──
    // Detects field-level changes vs current DB row, applies updates, and logs the
    // diff to cloud_serial_update_record so admins can audit what Tally changed.
    async syncSerialNow(serial: string, changedBy: string = 'system'): Promise<{ success: boolean; data?: any; message?: string; changes?: any }> {
        if (!serial || !serial.trim()) return { success: false, message: 'Serial required' };
        const apikey = '9e16a5f3-3f30-4277-8279-a1da597410cb';
        const url = `https://tallysolutions.com/api/v1/serialexpiry?apikey=${apikey}&slnum=${serial}`;

        const existing = await this.db.queryOne<any>(
            `SELECT * FROM tallydetails WHERE tallyserial = ? LIMIT 1`,
            [serial]
        );
        if (!existing) return { success: false, message: 'Serial not found in tallydetails' };

        try {
            const res = await fetch(url);
            if (!res.ok) return { success: false, message: `Tally API error: ${res.status}` };
            const json = await res.json();

            if (json.status_code !== 'T200') return { success: false, message: 'Tally API returned non-T200' };

            // Serial not tagged to us → mark customer Not Our
            if (json.expiry_details?.serial_status === 0) {
                await this.db.execute(
                    `UPDATE customer c JOIN tallydetails td ON c.id = td.customerid SET c.status = 'Not Our Customer' WHERE td.id = ?`,
                    [existing.id]
                );
                await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [existing.id]);
                await this.recordSerialUpdate(existing.id, serial, [
                    { field: 'customer_status', old: null, new: 'Not Our Customer', note: 'Serial no longer tagged to us' }
                ], changedBy);
                return { success: true, data: { tagged: false }, message: 'Serial not tagged to us — customer marked Not Our' };
            }

            // Tagged → compute diff and update only what changed
            if (json.expiry_details?.serial_status === 1 && typeof json.expiry_details.serial_data === 'object') {
                const d = json.expiry_details.serial_data;
                let parsedExpiry: string | null = null;
                if (d.expiry) {
                    const parts = String(d.expiry).split('-');
                    if (parts.length === 3) parsedExpiry = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }

                // Compare API values vs DB values; collect changes
                const fieldMap: Array<{ db: string; api: any; label: string }> = [
                    { db: 'tally_api_flavor',     api: d.flavour || null,         label: 'Flavor' },
                    { db: 'tally_api_edition',    api: d.edition || null,         label: 'Edition' },
                    { db: 'tally_api_org',        api: d.org_name || null,        label: 'Organization' },
                    { db: 'tally_api_email',      api: d.contact_email || null,   label: 'Email' },
                    { db: 'tally_api_mobile',     api: d.contact_mobile || null,  label: 'Mobile' },
                    { db: 'tally_api_activation', api: d.activation_date || null, label: 'Activation Date' },
                ];
                if (parsedExpiry) fieldMap.push({ db: 'tallyexpirydate', api: parsedExpiry, label: 'Expiry Date' });

                const changes: Array<{ field: string; old: any; new: any }> = [];
                const fmtDate = (v: any): string | null => {
                    if (!v) return null;
                    if (v instanceof Date) return v.toISOString().slice(0, 10);
                    return String(v).slice(0, 10);
                };
                for (const f of fieldMap) {
                    const oldRaw = existing[f.db];
                    // Normalize date columns for comparison
                    const oldVal = (f.db === 'tallyexpirydate' || f.db === 'tally_api_activation')
                        ? fmtDate(oldRaw) : (oldRaw == null ? null : String(oldRaw));
                    const newVal = f.api == null ? null : String(f.api);
                    if (oldVal !== newVal) {
                        changes.push({ field: f.label, old: oldVal, new: newVal });
                    }
                }

                // Always stamp checked_at; only update fields if there are real changes
                if (changes.length === 0) {
                    await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [existing.id]);
                    return { success: true, data: { tagged: true, ...d, expiry: parsedExpiry }, message: 'No changes — already up to date', changes: [] };
                }

                await this.db.execute(
                    `UPDATE tallydetails SET
                        tally_api_checked_at = NOW(),
                        tally_api_flavor = ?, tally_api_edition = ?, tally_api_org = ?,
                        tally_api_email = ?, tally_api_mobile = ?, tally_api_activation = ?
                        ${parsedExpiry ? ', tallyexpirydate = ?' : ''}
                     WHERE id = ?`,
                    [
                        d.flavour || null, d.edition || null, d.org_name || null,
                        d.contact_email || null, d.contact_mobile || null, d.activation_date || null,
                        ...(parsedExpiry ? [parsedExpiry] : []),
                        existing.id,
                    ]
                );

                await this.recordSerialUpdate(existing.id, serial, changes, changedBy);
                return { success: true, data: { tagged: true, ...d, expiry: parsedExpiry }, message: `${changes.length} field(s) updated`, changes };
            }

            await this.db.execute(`UPDATE tallydetails SET tally_api_checked_at = NOW() WHERE id = ?`, [existing.id]);
            return { success: true, data: { tagged: false }, message: 'No serial data returned' };
        } catch (e: any) {
            return { success: false, message: `Sync failed: ${e.message}` };
        }
    }

    private async recordSerialUpdate(serialId: number, serial: string, changes: any[], changedBy: string) {
        if (!changes || changes.length === 0) return;
        await this.db.execute(
            `INSERT INTO cloud_serial_update_record (tally_serial_id, tally_serial, changes, source, changed_by)
             VALUES (?, ?, ?, 'tally_api', ?)`,
            [serialId, serial, JSON.stringify(changes), changedBy]
        );
    }

    async getSerialUpdateHistory(serial: string, limit: number = 50) {
        return this.db.query(
            `SELECT id, tally_serial_id, tally_serial, changes, source, changed_by, created_at
             FROM cloud_serial_update_record
             WHERE tally_serial = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [serial, limit]
        );
    }

    /** Single API Tally calls to pull all unsynced vouchers (poll-and-acknowledge pattern).
     *  Returns vouchers where tally_synced_at IS NULL.
     *  After Tally imports them, it calls acknowledgeTallySync() with their IDs,
     *  which stamps tally_synced_at so they are excluded from future fetches. */
    async getTallyVouchers(opts: {
        dateFrom?: string;
        dateTo?: string;
        vchType?: string;
        page?: number;
        limit?: number;
        includeAll?: boolean;
    }) {
        const where: string[] = [];
        const params: any[] = [];
        if (!opts.includeAll) { where.push('v.tally_synced_at IS NULL'); }
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        if (opts.vchType)  { where.push("COALESCE(p.name, vt.name) = ?"); params.push(opts.vchType); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const page = opts.page || 1;
        const limit = Math.min(opts.limit || 100, 500);
        const offset = (page - 1) * limit;

        const [countRow] = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM vch_details v
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${whereSql}`,
            params,
        );

        const vouchers = await this.db.query<any>(
            `SELECT v.id, v.vch_no, v.vch_date, v.amount, v.remark,
                    v.created_by, v.created_at, v.tally_synced_at,
                    c.company AS party_name, c.gstin AS party_gstin,
                    c.address1, c.address2, c.city, c.pincode, s.name AS state_name,
                    COALESCE(p.name, vt.name) AS vch_type,
                    vt.name AS vch_subtype
             FROM vch_details v
             LEFT JOIN customer c  ON v.party_ledger_id = c.id
             LEFT JOIN pincode pv  ON c.pincode = pv.pincode
             LEFT JOIN state s     ON pv.stateid = s.id
             LEFT JOIN vchtype vt  ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p   ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${whereSql}
             ORDER BY v.vch_date ASC, v.id ASC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        if (vouchers.length === 0) {
            return { total: Number(countRow?.total) || 0, page, limit, vouchers: [] };
        }

        const vchIds = vouchers.map((v: any) => v.id);
        const ph = vchIds.map(() => '?').join(',');

        // ledger_entries.amount sign: positive = Dr, negative = Cr (Tally convention)
        const ledgerEntries = await this.db.query<any>(
            `SELECT le.id, le.vch_id, le.ledger_id, le.amount, c.company AS ledger_name, lg.name AS ledger_group
             FROM ledger_entries le
             LEFT JOIN customer c ON le.ledger_id = c.id
             LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
             WHERE le.vch_id IN (${ph})
             ORDER BY le.vch_id, le.id`,
            vchIds,
        );
        const invEntries = await this.db.query<any>(
            `SELECT ie.id, le.vch_id, ie.led_id, ie.qty, ie.rate, ie.amount,
                    i.item_name, i.hsn, ig.name AS item_group,
                    COALESCE(i.gst, ie.gst_rate, 0) AS gst_rate
             FROM inventory_entries ie
             INNER JOIN ledger_entries le ON ie.led_id = le.id
             INNER JOIN items i           ON ie.item_id = i.id
             LEFT JOIN item_groups ig     ON i.item_group_id = ig.id
             WHERE le.vch_id IN (${ph})
             ORDER BY le.vch_id, ie.id`,
            vchIds,
        );
        const invIds = invEntries.map((ie: any) => ie.id);

        const batchRows = invIds.length === 0 ? [] : await this.db.query<any>(
            `SELECT inventory_id, batch_name, qty, rate, amount
             FROM batch WHERE inventory_id IN (${invIds.map(() => '?').join(',')})
             ORDER BY inventory_id, id`,
            invIds,
        );

        const billAllocs = await this.db.query<any>(
            `SELECT ba.vchid, ba.ledentry_id, ba.ledger, ba.billname, ba.amount
             FROM bill_allocation ba WHERE ba.vchid IN (${ph}) ORDER BY ba.vchid, ba.id`,
            vchIds,
        );

        const batchByInv = new Map<number, any[]>();
        for (const b of batchRows) {
            const arr = batchByInv.get(b.inventory_id) || [];
            arr.push({
                batch_name: b.batch_name || null,
                qty:        +Number(b.qty).toFixed(3),
                rate:       +Number(b.rate).toFixed(2),
                amount:     +Number(b.amount).toFixed(2),
            });
            batchByInv.set(b.inventory_id, arr);
        }

        const invByLed = new Map<number, any[]>();
        for (const ie of invEntries) {
            const arr = invByLed.get(ie.led_id) || [];
            arr.push({
                item_name:  ie.item_name,
                item_group: ie.item_group || null,
                hsn:        ie.hsn || null,
                qty:        +Number(ie.qty).toFixed(3),
                rate:       +Number(ie.rate).toFixed(2),
                amount:     +Number(ie.amount).toFixed(2),
                gst_rate:   +Number(ie.gst_rate || 0).toFixed(2),
                batches:    batchByInv.get(ie.id) || [],
            });
            invByLed.set(ie.led_id, arr);
        }

        // Group bill allocations by ledentry_id (primary key link to ledger_entries.id).
        // Also build a fallback map by (vchid, ledger) for rows where ledentry_id is NULL
        // (older vouchers created before per-row bill allocation was introduced).
        const billByLedEntry = new Map<number, any[]>();
        const billByVchLedger = new Map<string, any[]>();
        for (const ba of billAllocs) {
            const amt = Number(ba.amount);
            const entry = {
                billname:  ba.billname || null,
                amount:    +Math.abs(amt).toFixed(2),
                direction: amt >= 0 ? 'Dr' : 'Cr',
            };
            if (ba.ledentry_id) {
                const arr = billByLedEntry.get(ba.ledentry_id) || [];
                arr.push(entry);
                billByLedEntry.set(ba.ledentry_id, arr);
            } else if (ba.ledger) {
                const key = `${ba.vchid}:${ba.ledger}`;
                const arr = billByVchLedger.get(key) || [];
                arr.push(entry);
                billByVchLedger.set(key, arr);
            }
        }

        const ledByVch = new Map<number, any[]>();
        for (const le of ledgerEntries) {
            const arr = ledByVch.get(le.vch_id) || [];
            const amt = Number(le.amount);
            // Resolve bill allocations: prefer ledentry_id match, fall back to vchid+ledger_id
            const bills = billByLedEntry.get(le.id)
                || billByVchLedger.get(`${le.vch_id}:${le.ledger_id}`)
                || [];
            arr.push({
                ledger_name:      le.ledger_name || null,
                ledger_group:     le.ledger_group || null,
                amount:           +Math.abs(amt).toFixed(2),
                direction:        amt >= 0 ? 'Dr' : 'Cr',
                inventory:        invByLed.get(le.id) || [],
                bill_allocations: bills,
            });
            ledByVch.set(le.vch_id, arr);
        }

        const result = vouchers.map((v: any) => ({
            id:               v.id,
            vch_no:           v.vch_no || null,
            vch_date:         v.vch_date,
            vch_type:         v.vch_type || null,
            vch_subtype:      v.vch_subtype || null,
            party_name:       v.party_name || null,
            party_gstin:      v.party_gstin || null,
            party_address: {
                address1: v.address1 || null,
                address2: v.address2 || null,
                city:     v.city || null,
                state:    v.state_name || null,
                pincode:  v.pincode || null,
            },
            amount:           +Number(v.amount).toFixed(2),
            remark:           v.remark || null,
            created_at:       v.created_at,
            tally_synced_at:  v.tally_synced_at || null,
            ledger_entries:   ledByVch.get(v.id) || [],
        }));

        return { total: Number(countRow?.total) || 0, page, limit, vouchers: result };
    }

    /** Tally calls this after successfully importing a batch of vouchers.
     *  Stamps tally_synced_at on the given IDs so they are excluded from
     *  future getTallyVouchers() fetches (poll-and-acknowledge pattern).
     *  Only vouchers that are not yet synced are stamped (idempotent). */
    async acknowledgeTallySync(ids: number[]): Promise<{ acknowledged: number }> {
        if (!ids || ids.length === 0) return { acknowledged: 0 };
        const ph = ids.map(() => '?').join(',');
        const result = await this.db.execute(
            `UPDATE vch_details SET tally_synced_at = NOW() WHERE id IN (${ph}) AND tally_synced_at IS NULL`,
            ids,
        );
        return { acknowledged: result.affectedRows ?? 0 };
    }

    /** Stock item masters for Tally (poll-and-acknowledge, same pattern as
     *  vouchers). Tally needs these BEFORE importing vouchers so every
     *  <STOCKITEM> referenced by an inventory line already exists. */
    async getTallyItems(opts: { page?: number; limit?: number; includeAll?: boolean; search?: string }) {
        const where: string[] = [];
        const whereParams: any[] = [];
        if (!opts.includeAll) where.push('i.tally_synced_at IS NULL');
        if (opts.search) { where.push('i.item_name LIKE ?'); whereParams.push(`%${opts.search}%`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const page = opts.page || 1;
        const limit = Math.min(opts.limit || 100, 500);
        const offset = (page - 1) * limit;

        const [countRow] = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM items i ${whereSql}`,
            whereParams,
        );

        const rows = await this.db.query<any>(
            `SELECT i.id, i.item_name, i.batch, i.gst, i.hsn,
                    i.opening_qty, i.opening_rate, i.opening_value,
                    i.created_at, i.updated_at, i.tally_synced_at,
                    ig.name AS item_group, ic.name AS category, sm.name AS tally_flavour
             FROM items i
             LEFT JOIN item_groups ig     ON i.item_group_id = ig.id
             LEFT JOIN item_categories ic ON i.category_id   = ic.id
             LEFT JOIN singlemaster sm    ON i.tally_flavour_id = sm.id
             ${whereSql}
             ORDER BY i.id ASC
             LIMIT ? OFFSET ?`,
            [...whereParams, limit, offset],
        );

        const items = rows.map((r: any) => ({
            id:              r.id,
            item_name:       r.item_name,
            item_group:      r.item_group || null,
            category:        r.category || null,
            tally_flavour:   r.tally_flavour || null,
            batch_tracked:   r.batch === 'Yes',
            gst_rate:        +Number(r.gst || 0).toFixed(2),
            hsn:             r.hsn || null,
            opening_qty:     +Number(r.opening_qty || 0).toFixed(3),
            opening_rate:    +Number(r.opening_rate || 0).toFixed(2),
            opening_value:   +Number(r.opening_value || 0).toFixed(2),
            created_at:      r.created_at,
            updated_at:      r.updated_at,
            tally_synced_at: r.tally_synced_at || null,
        }));

        return { total: Number(countRow?.total) || 0, page, limit, items };
    }

    async acknowledgeTallyItems(ids: number[]): Promise<{ acknowledged: number }> {
        if (!ids || ids.length === 0) return { acknowledged: 0 };
        const ph = ids.map(() => '?').join(',');
        const result = await this.db.execute(
            `UPDATE items SET tally_synced_at = NOW() WHERE id IN (${ph}) AND tally_synced_at IS NULL`,
            ids,
        );
        return { acknowledged: result.affectedRows ?? 0 };
    }

    /** Ledger masters for Tally (poll-and-acknowledge). One row per customer
     *  record — in this app the customer table doubles as the ledger master
     *  (party_ledger_id and ledger_entries.ledger_id both point at it).
     *  Import these BEFORE vouchers so every <LEDGER> already exists. */
    async getTallyLedgers(opts: { page?: number; limit?: number; includeAll?: boolean; search?: string }) {
        const where: string[] = [];
        const whereParams: any[] = [];
        if (!opts.includeAll) where.push('c.tally_synced_at IS NULL');
        if (opts.search) { where.push('c.company LIKE ?'); whereParams.push(`%${opts.search}%`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const page = opts.page || 1;
        const limit = Math.min(opts.limit || 100, 500);
        const offset = (page - 1) * limit;

        const [countRow] = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM customer c ${whereSql}`,
            whereParams,
        );

        // State can be stored two ways: a numeric state-table id in c.state,
        // or resolvable via the pincode table — same fallback the voucher
        // export uses. Non-numeric c.state values are used as-is.
        const rows = await this.db.query<any>(
            `SELECT c.id, c.company, c.gstin,
                    c.address1, c.address2, c.address3, c.city, c.pincode,
                    c.state AS raw_state, s_direct.name AS state_direct, s_pin.name AS state_from_pincode,
                    c.person, c.mobile, c.email,
                    c.opening_balance, c.opening_balance_type, c.billbybill,
                    c.active_status, c.date AS created_date, c.tally_synced_at,
                    c.ledgergroup AS ledgergroup_id, lg.name AS ledger_group
             FROM customer c
             LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
             LEFT JOIN state s_direct ON c.state REGEXP '^[0-9]+$' AND s_direct.id = CAST(c.state AS UNSIGNED)
             LEFT JOIN pincode pv     ON c.pincode = pv.pincode
             LEFT JOIN state s_pin    ON pv.stateid = s_pin.id
             ${whereSql}
             ORDER BY c.id ASC
             LIMIT ? OFFSET ?`,
            [...whereParams, limit, offset],
        );

        const ledgers = rows.map((r: any) => {
            const rawState = String(r.raw_state ?? '').trim();
            const state = r.state_direct
                || (rawState && !/^\d+$/.test(rawState) ? rawState : null)
                || r.state_from_pincode
                || null;
            const opening = +Number(r.opening_balance || 0).toFixed(2);
            return {
                id:                   r.id,
                ledger_name:          r.company,
                // Parties created before ledgergroup existed have NULL —
                // they're all Sundry Debtors, so default the export to that
                // rather than shipping a group Tally can't file under.
                ledger_group:         r.ledger_group || 'Sundry Debtors',
                is_party:             !r.ledgergroup_id || Number(r.ledgergroup_id) === 26,
                gstin:                r.gstin || null,
                address: {
                    address1: r.address1 || null,
                    address2: r.address2 || null,
                    address3: r.address3 || null,
                    city:     r.city || null,
                    state,
                    pincode:  r.pincode || null,
                },
                contact_person:       r.person || null,
                mobile:               r.mobile || null,
                email:                r.email || null,
                opening_balance:      opening,
                opening_balance_type: opening ? (r.opening_balance_type || 'Dr') : null,
                bill_by_bill:         r.billbybill === 'Yes',
                active:               r.active_status !== 'Inactive',
                created_at:           r.created_date || null,
                tally_synced_at:      r.tally_synced_at || null,
            };
        });

        return { total: Number(countRow?.total) || 0, page, limit, ledgers };
    }

    async acknowledgeTallyLedgers(ids: number[]): Promise<{ acknowledged: number }> {
        if (!ids || ids.length === 0) return { acknowledged: 0 };
        const ph = ids.map(() => '?').join(',');
        const result = await this.db.execute(
            `UPDATE customer SET tally_synced_at = NOW() WHERE id IN (${ph}) AND tally_synced_at IS NULL`,
            ids,
        );
        return { acknowledged: result.affectedRows ?? 0 };
    }

    async upsertTallyDetail(data: {
        serial: string;
        customer_id: number;
        flavor?: string;
        expire_date?: string;
        tally_status?: string;
        active_status?: string;
        renewal?: string;
        reason?: string;
        partner?: string;
    }) {
        const existing = await this.db.queryOne<{ id: number; tally_status: string | null }>(
            "SELECT id, tally_status FROM tallydetails WHERE tallyserial = ?",
            [data.serial]
        );

        // "Our Tally" serials are managed exclusively via the Tally API — no manual
        // updates allowed (not even by admin). Use the Tally API sync button instead.
        if (existing && existing.tally_status === 'Our Tally') {
            throw new ForbiddenException('Our Tally serials cannot be updated manually. Use the Tally API sync.');
        }

        const newStatus = data.tally_status || 'Our Tally';
        if (existing) {
            const becomingOurTally = newStatus === 'Our Tally' && existing.tally_status !== 'Our Tally';
            await this.db.execute(`
                UPDATE tallydetails
                SET customerid = ?, tallyflavor = ?, tallyexpirydate = ?,
                    tally_status = ?, active_status = ?, reneval = ?, reason = ?, partner = ?,
                    became_our_tally_at = CASE WHEN ? = 1 THEN NOW() ELSE became_our_tally_at END,
                    updated_at = NOW()
                WHERE tallyserial = ?
            `, [
                data.customer_id,
                data.flavor || null,
                data.expire_date || null,
                newStatus,
                data.active_status || 'Active',
                data.renewal || 'New Release',
                data.reason || '',
                data.partner || '',
                becomingOurTally ? 1 : 0,
                data.serial
            ]);
        } else {
            const isOurTally = newStatus === 'Our Tally';
            await this.db.execute(`
                INSERT INTO tallydetails
                (tallyserial, customerid, tallyflavor, tallyexpirydate, tally_status, active_status, reneval, reason, partner, became_our_tally_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                data.serial,
                data.customer_id,
                data.flavor || null,
                data.expire_date || null,
                newStatus,
                data.active_status || 'Active',
                data.renewal || 'New Release',
                data.reason || '',
                data.partner || '',
                isOurTally ? new Date() : null,
            ]);
        }
        return { success: true };
    }
}
