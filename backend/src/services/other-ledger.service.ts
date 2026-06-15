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

    async findAll() {
        // Returns every ledger (including Sundry Debtors / parties) so the
        // Other Ledger screen can edit opening balance + group on any of them.
        return this.db.query<any>(`
            SELECT c.id, c.company, c.ledgergroup,
                   lg.name AS ledgergroup_name,
                   c.opening_balance, c.opening_balance_type,
                   c.billbybill
            FROM customer c
            LEFT JOIN ledgergroup lg ON c.ledgergroup = lg.id
            WHERE c.ledgergroup IS NOT NULL
            ORDER BY c.company ASC
        `);
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
        // Only allow deleting non-Sundry-Debtor records
        await this.db.execute(
            `DELETE FROM customer WHERE id = ? AND ledgergroup != ${SUNDRY_DEBTORS_ID}`,
            [id],
        );
    }
}
