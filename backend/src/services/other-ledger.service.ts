import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { DbService } from '../database/db.service';

const SUNDRY_DEBTORS_ID = 26;

@Injectable()
export class OtherLedgerService implements OnModuleInit {
    constructor(private db: DbService) {}

    async onModuleInit() {
        try {
            await this.db.execute(`ALTER TABLE customer ADD COLUMN opening_balance DECIMAL(15,2) DEFAULT 0`).catch(() => {});
            await this.db.execute(`ALTER TABLE customer ADD COLUMN opening_balance_type ENUM('Dr','Cr') DEFAULT 'Dr'`).catch(() => {});

            // Seed standard accounting ledgers so vouchers can post tax / goods /
            // roundoff entries without falling back to a hardcoded null. Each row
            // is inserted only when missing, keyed by company name.
            const seeds: Array<{ name: string; group: number }> = [
                { name: 'Sales',    group: 22 }, // Sales Accounts
                { name: 'Purchase', group: 20 }, // Purchase Accounts
                { name: 'CGST',     group: 11 }, // Duties & Taxes
                { name: 'SGST',     group: 11 },
                { name: 'IGST',     group: 11 },
                { name: 'Roundoff', group: 14 }, // Indirect Incomes
            ];
            for (const s of seeds) {
                const exists = await this.db.queryOne<{ id: number }>(
                    `SELECT id FROM customer WHERE company = ? LIMIT 1`, [s.name],
                );
                if (!exists) {
                    await this.db.execute(
                        `INSERT INTO customer (company, ledgergroup, status, billbybill) VALUES (?, ?, 'Active', 'No')`,
                        [s.name, s.group],
                    ).catch(() => { /* race / duplicate — ignore */ });
                }
            }
        } catch (error) {
            console.error('OtherLedgerService: Schema migration warning (might be handled elsewhere):', error.message);
        }
    }

    async findAll(user?: { id?: string; role?: string }, opts?: { unscoped?: boolean }) {
        // Returns every ledger (including Sundry Debtors / parties) so the
        // Other Ledger screen can edit opening balance + group on any of them.
        // Non-admin users with a ledger_group_id assigned only see ledgers
        // filed under that group or any of its descendant groups.
        // Semantics match VouchersService.getUserLedgerScope:
        //   NULL ledger_group_id → not assigned → NO ledgers at all
        //   0                    → "All Ledgers" sentinel → unrestricted
        //   >0                   → that group and its child groups only
        // opts.unscoped bypasses scoping entirely — voucher entry needs the
        // full chart of accounts (CGST/SGST/IGST/Sales/Round Off) to post
        // taxes, so it must never be filtered by a user's party-group scope.
        let scopeSql = '';
        const params: any[] = [];
        if (!opts?.unscoped && user?.id && (user.role || '').toLowerCase() !== 'admin') {
            const row = await this.db.queryOne<any>(
                `SELECT ledger_group_id FROM cloud_users WHERE id = ?`, [user.id],
            ).catch(() => null);
            if (row && (row.ledger_group_id === null || row.ledger_group_id === undefined)) {
                return []; // no ledger group assigned → sees nothing
            }
            if (row && Number(row.ledger_group_id) > 0) {
                const groupIds = await this.expandGroupTree(Number(row.ledger_group_id));
                scopeSql = ` AND c.ledgergroup IN (${groupIds.map(() => '?').join(',')})`;
                params.push(...groupIds);
            }
        }
        return this.db.query<any>(`
            SELECT c.id, c.company, c.ledgergroup,
                   lg.name AS ledgergroup_name,
                   c.opening_balance, c.opening_balance_type,
                   c.billbybill
            FROM customer c
            LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
            WHERE c.ledgergroup IS NOT NULL${scopeSql}
            ORDER BY c.company ASC
        `, params);
    }

    /** A group plus all of its descendants (ledgergroup.parent_id tree). */
    private async expandGroupTree(rootId: number): Promise<number[]> {
        const rows = await this.db.query<any>(`SELECT id, parent_id FROM ledgergroup`).catch(() => [] as any[]);
        const byParent = new Map<number, number[]>();
        for (const r of rows) {
            if (!r.parent_id || r.parent_id === r.id) continue;
            const arr = byParent.get(Number(r.parent_id)) || [];
            arr.push(Number(r.id));
            byParent.set(Number(r.parent_id), arr);
        }
        const result: number[] = [];
        const queue = [rootId];
        while (queue.length) {
            const id = queue.shift()!;
            if (result.includes(id)) continue;
            result.push(id);
            queue.push(...(byParent.get(id) || []));
        }
        return result;
    }

    async create(data: { company: string; ledgergroup: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) {
        // Sundry Debtors (parties / customers) must be created via the
        // Customers page where address / contact / Tally fields are captured.
        // Block creation here so this screen stays focused on non-party
        // ledgers (Sales, CGST, SGST, Cash, Bank, Roundoff, etc.).
        if (Number(data.ledgergroup) === SUNDRY_DEBTORS_ID) {
            throw new BadRequestException('Sundry Debtors (parties) must be created from the Customers page, not here.');
        }
        const billbybill = data.billbybill === 'Yes' ? 'Yes' : 'No';
        const result = await this.db.execute(
            `INSERT INTO customer (company, ledgergroup, status, billbybill, opening_balance, opening_balance_type)
             VALUES (?, ?, 'Active', ?, ?, ?)`,
            [data.company, data.ledgergroup, billbybill, data.opening_balance ?? 0, data.opening_balance_type ?? 'Dr'],
        );
        return { id: result.insertId, ...data };
    }

    async update(id: number, data: { company?: string; ledgergroup?: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) {
        const fields: string[] = [];
        const params: any[] = [];
        if (data.company !== undefined)               { fields.push('company = ?');               params.push(data.company); }
        if (data.ledgergroup !== undefined)           { fields.push('ledgergroup = ?');           params.push(data.ledgergroup); }
        if (data.opening_balance !== undefined)       { fields.push('opening_balance = ?');       params.push(data.opening_balance); }
        if (data.opening_balance_type !== undefined)  { fields.push('opening_balance_type = ?');  params.push(data.opening_balance_type); }
        if (data.billbybill !== undefined)            { fields.push('billbybill = ?');            params.push(data.billbybill === 'Yes' ? 'Yes' : 'No'); }
        if (!fields.length) return;
        params.push(id);
        await this.db.execute(`UPDATE customer SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id: number) {
        // Block deletion when the ledger is used anywhere in the books —
        // as a voucher party, a ledger entry, or a bill allocation. Deleting
        // a ledger with transactions would corrupt those vouchers.
        const refs = await this.db.queryOne<{ cnt: number }>(
            `SELECT (
                (SELECT COUNT(*) FROM ledger_entries WHERE ledger_id = ?) +
                (SELECT COUNT(*) FROM vch_details    WHERE party_ledger_id = ?) +
                (SELECT COUNT(*) FROM bill_allocation WHERE ledger = ?)
             ) AS cnt`,
            [id, id, id],
        ).catch(() => ({ cnt: 0 }));
        if ((refs?.cnt ?? 0) > 0) {
            throw new BadRequestException(`Cannot delete: this ledger is used in ${refs!.cnt} voucher entr(ies). Deactivate it instead.`);
        }
        // Only allow deleting non-Sundry-Debtor records
        await this.db.execute(
            `DELETE FROM customer WHERE id = ? AND ledgergroup != ${SUNDRY_DEBTORS_ID}`,
            [id],
        );
    }
}
