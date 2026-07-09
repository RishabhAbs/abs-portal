import { Injectable, OnModuleInit, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DbService } from '../database/db.service';

/** Minimal shape of the JWT user object the report scoping needs. */
type ScopedUser = { id?: string; role?: string } | undefined;

/**
 * Voucher structure (matches Tally-like model):
 *
 * vch_details        id | vch_no | vch_date | vch_type | party_ledger_id | amount | created_by
 * ledger_entries     id | vch_id | ledger_id | amount   (signed: +Dr / -Cr)
 * inventory_entries  id | led_id | item_id   | qty | rate | amount         (led_id → ledger_entries.id)
 *
 * All ledger_id values → customer.id  (customers AND other ledgers live in customer table)
 * inventory_entries hangs off the Sales/Purchase ledger_entry, not the voucher directly.
 */

@Injectable()
export class VouchersService implements OnModuleInit {
    constructor(private db: DbService) {}

    /** Ledger-group scope for report queries.
     *    null → unrestricted (admin, no user context, or the "All Ledgers"
     *           sentinel value 0 on cloud_users.ledger_group_id)
     *    []   → NO access (ledger_group_id not assigned) — callers must
     *           return empty results / block access
     *    ids  → the assigned group plus every descendant group
     *  Mirrors OtherLedgerService.findAll's scoping so the reports and the
     *  ledger picker always agree on visibility. */
    private async getUserLedgerScope(user: ScopedUser): Promise<number[] | null> {
        if (!user?.id || (user.role || '').toLowerCase() === 'admin') return null;
        const row = await this.db.queryOne<any>(
            `SELECT ledger_group_id FROM cloud_users WHERE id = ?`, [user.id],
        ).catch(() => null);
        if (!row) return null; // user row missing — don't lock out on a lookup glitch
        if (row.ledger_group_id === null || row.ledger_group_id === undefined) return []; // not assigned → nothing
        if (Number(row.ledger_group_id) === 0) return null; // "All Ledgers"

        const all = await this.db.query<any>(`SELECT id, parent_id FROM ledgergroup`);
        const children = new Map<number, number[]>();
        for (const g of all) {
            if (g.parent_id && g.parent_id !== g.id) {
                const arr = children.get(Number(g.parent_id)) || [];
                arr.push(Number(g.id));
                children.set(Number(g.parent_id), arr);
            }
        }
        const out: number[] = [];
        const stack = [Number(row.ledger_group_id)];
        while (stack.length) {
            const id = stack.pop()!;
            if (out.includes(id)) continue;
            out.push(id);
            stack.push(...(children.get(id) || []));
        }
        return out;
    }

    async onModuleInit() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vch_details (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                vch_type         VARCHAR(100) NOT NULL,
                vch_type_id      INT            DEFAULT NULL,
                vch_no           VARCHAR(100)   DEFAULT NULL,
                vch_date         DATE           DEFAULT NULL,
                party_ledger_id  INT            NOT NULL,
                amount           DECIMAL(14,2)  NOT NULL DEFAULT 0,
                remark           TEXT           DEFAULT NULL,
                created_by       VARCHAR(100),
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_type   (vch_type),
                INDEX idx_date   (vch_date),
                INDEX idx_party  (party_ledger_id)
            )
        `);

        // Drop legacy vch_type text column — use vch_type_id (FK to vchtype) only
        const [vtypeCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'vch_type'`
        );
        if ((vtypeCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE vch_details DROP COLUMN vch_type`).catch(() => {});
        }
        // Add remark column if missing
        const [remarkCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'remark'`
        );
        if ((remarkCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN remark TEXT DEFAULT NULL`);
        }
        // Add vch_type_id column if missing
        const [vtCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'vch_type_id'`
        );
        if ((vtCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN vch_type_id INT DEFAULT NULL`);
        }

        // Add lead_id (FK to service_calls.id where entry_type='Lead'). When set,
        // saving the voucher auto-closes the linked lead with closed_via='Billing'.
        const [leadCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'lead_id'`
        );
        if ((leadCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN lead_id INT DEFAULT NULL`);
            await this.db.execute(`ALTER TABLE vch_details ADD INDEX idx_lead (lead_id)`).catch(() => {});
        }

        // checked_by + checked_at — once a voucher is "checked" (verified by a
        // user with vouchers.check), only admins can edit/delete it. Everyone
        // else gets read-only even if they hold vouchers.edit.
        const [checkedByCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vch_details' AND COLUMN_NAME = 'checked_by'`
        );
        if ((checkedByCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN checked_by VARCHAR(100) DEFAULT NULL`);
            await this.db.execute(`ALTER TABLE vch_details ADD COLUMN checked_at DATETIME DEFAULT NULL`);
            await this.db.execute(`ALTER TABLE vch_details ADD INDEX idx_checked_by (checked_by)`).catch(() => {});
        }

        // Make party_ledger_id nullable — Stock Journal vouchers have no party
        await this.db.execute(
            `ALTER TABLE vch_details MODIFY COLUMN party_ledger_id INT DEFAULT NULL`
        ).catch(() => {});

        // Trail of retroactive vch_no rewrites (e.g. re-applying a changed
        // prefix/suffix to already-saved vouchers) — every change is logged
        // here so it can be manually reviewed or reversed later.
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS vch_no_retrofit_audit (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                vch_id       INT NOT NULL,
                old_vch_no   VARCHAR(100) NOT NULL,
                new_vch_no   VARCHAR(100) NOT NULL,
                changed_by   VARCHAR(255) NULL,
                changed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vch (vch_id)
            )
        `);

        // Payment-followup tracking for Outstanding report bills — one row
        // per (ledger, bill) holding the CURRENT contact/next-date/remark,
        // overwritten on each update (mirrors tallydetails' expiry-call
        // pattern: latest state only, no separate interaction log).
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS bill_followup (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                ledger_id    INT NOT NULL,
                bill_name    VARCHAR(255) NOT NULL,
                status       ENUM('Followup','Payment','Error','Frustitting') DEFAULT NULL,
                person_name  VARCHAR(255) DEFAULT NULL,
                phone_number VARCHAR(50)  DEFAULT NULL,
                next_date    DATE         DEFAULT NULL,
                remark       TEXT         DEFAULT NULL,
                updated_by   VARCHAR(255) DEFAULT NULL,
                updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_bill (ledger_id, bill_name(191))
            )
        `);
        // In case bill_followup was already created (via hot-reload) before status existed.
        await this.db.execute(
            `ALTER TABLE bill_followup ADD COLUMN status ENUM('Followup','Payment','Error','Frustitting') DEFAULT NULL AFTER bill_name`
        ).catch(() => {});

        // Every followup save also appends here (bill_followup keeps only the
        // latest state) so the Outstanding report can show how many times a
        // bill has been chased.
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS bill_followup_history (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                ledger_id    INT NOT NULL,
                bill_name    VARCHAR(255) NOT NULL,
                status       VARCHAR(30)  DEFAULT NULL,
                person_name  VARCHAR(255) DEFAULT NULL,
                phone_number VARCHAR(50)  DEFAULT NULL,
                next_date    DATE         DEFAULT NULL,
                remark       TEXT         DEFAULT NULL,
                updated_by   VARCHAR(255) DEFAULT NULL,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_bill (ledger_id, bill_name(191))
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                vch_id     INT           NOT NULL,
                ledger_id  INT           DEFAULT NULL,
                amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vch    (vch_id),
                INDEX idx_ledger (ledger_id),
                FOREIGN KEY (vch_id) REFERENCES vch_details(id) ON DELETE CASCADE
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS inventory_entries (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                led_id     INT           NOT NULL,
                item_id    INT           NOT NULL,
                qty        DECIMAL(10,3) DEFAULT 1,
                rate       DECIMAL(14,2) DEFAULT 0,
                amount     DECIMAL(14,2) DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_led  (led_id),
                INDEX idx_item (item_id),
                FOREIGN KEY (led_id) REFERENCES ledger_entries(id) ON DELETE CASCADE
            )
        `);

        // Migration: add gst_rate to inventory_entries if missing
        await this.db.execute(`ALTER TABLE inventory_entries ADD COLUMN gst_rate DECIMAL(5,2) DEFAULT 0`).catch(() => {});
        // Migration: add side column for Stock Journal (source/destination)
        await this.db.execute(`ALTER TABLE inventory_entries ADD COLUMN side ENUM('source','destination') DEFAULT NULL`).catch(() => {});

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS batch (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                vch_id       INT           NOT NULL,
                inventory_id INT           DEFAULT NULL,
                item_id      INT           NOT NULL,
                batch_name   VARCHAR(255)  DEFAULT NULL,
                qty          DECIMAL(10,3) DEFAULT 1,
                rate         DECIMAL(14,2) DEFAULT 0,
                amount       DECIMAL(14,2) DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vch  (vch_id),
                INDEX idx_inv  (inventory_id),
                INDEX idx_item (item_id)
            )
        `);

        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS bill_allocation (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                vchid        INT           NOT NULL,
                ledentry_id  INT           DEFAULT NULL,
                ledger       INT           DEFAULT NULL,
                billname     VARCHAR(255)  DEFAULT NULL,
                amount       DECIMAL(14,2) DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_vchid     (vchid),
                INDEX idx_ledentry  (ledentry_id),
                INDEX idx_billname  (billname),
                INDEX idx_ledger    (ledger)
            )
        `);

        // Migration: drop type column if exists
        const [baTypeCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'type'`
        );
        if ((baTypeCol?.cnt ?? 0) > 0) {
            await this.db.execute(`ALTER TABLE bill_allocation DROP COLUMN type`).catch(() => {});
        }

        // Migration: change ledger column from VARCHAR to INT (stores customer.id)
        const [baLedgerType] = await this.db.query<any>(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'ledger'`
        );
        if (baLedgerType?.DATA_TYPE && baLedgerType.DATA_TYPE.toLowerCase() !== 'int') {
            await this.db.execute(`ALTER TABLE bill_allocation MODIFY COLUMN ledger INT DEFAULT NULL`);
        }

        // Migration: allow vchid=NULL so opening-balance bills can live in
        // bill_allocation alongside voucher-driven entries. Each opening
        // bill is just a row with vchid=NULL, ledger=customer_id, billname,
        // amount, and the user-entered bill_date (column added below).
        const [baVchidNullable] = await this.db.query<any>(
            `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'vchid'`
        );
        if (baVchidNullable?.IS_NULLABLE === 'NO') {
            await this.db.execute(`ALTER TABLE bill_allocation MODIFY COLUMN vchid INT DEFAULT NULL`).catch(() => {});
        }
        const [baBillDateCol] = await this.db.query<any>(
            `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_allocation' AND COLUMN_NAME = 'bill_date'`
        );
        if ((baBillDateCol?.cnt ?? 0) === 0) {
            await this.db.execute(`ALTER TABLE bill_allocation ADD COLUMN bill_date DATE DEFAULT NULL`).catch(() => {});
            await this.db.execute(`ALTER TABLE bill_allocation ADD INDEX idx_bill_date (bill_date)`).catch(() => {});
        }
    }

    /** Keep bill_allocation in sync with the party ledger entry.
     *
     *  When the caller-supplied bill_allocation doesn't sum to the expected
     *  party-signed amount (the divergence we saw on voucher 165: bill_alloc
     *  5310 vs party 4500), we DON'T reject the save — that would brick
     *  legacy vouchers carrying stale bill-alloc rows. Instead we auto-heal:
     *  collapse the rows into a single allocation covering the actual party
     *  amount, preserving the first row's bill name so outstanding still
     *  groups under the same invoice number.
     *
     *  When bill_allocation is empty / undefined we leave it alone — the
     *  caller decides whether to insert a default row (we don't fabricate
     *  bill-by-bill on a customer who didn't have it).
     *
     *  Returns the normalized array the INSERT loop should use.
     */
    private normalizeBillAllocation(
        expectedPartySigned: number,
        billAlloc: Array<{ amount: number; direction?: string; type?: string; refno?: string }> | undefined,
        defaultBillName: string | null,
    ): Array<{ amount: number; direction?: string; type?: string; refno?: string }> | undefined {
        if (!billAlloc || billAlloc.length === 0) return billAlloc;
        const expected = +Number(expectedPartySigned).toFixed(2);
        const baSigned = +billAlloc.reduce((s, ba) => {
            const amt = Math.abs(Number(ba.amount) || 0);
            const signed = ba.direction
                ? (ba.direction === 'Cr' ? -amt : amt)
                : (ba.type === 'Agr.' ? -amt : amt);
            return s + signed;
        }, 0).toFixed(2);
        if (Math.abs(expected - baSigned) <= 0.01) return billAlloc;

        // Mismatch — collapse to one synthetic row covering the party amount.
        const refno = (billAlloc[0]?.refno || defaultBillName || '').trim() || null;
        const direction: 'Dr' | 'Cr' = expected >= 0 ? 'Dr' : 'Cr';
        console.warn(
            `[vouchers] bill_allocation total ${baSigned.toFixed(2)} ≠ party ${expected.toFixed(2)} — ` +
            `normalizing to single row "${refno ?? '(unnamed)'}" amount ${Math.abs(expected).toFixed(2)} ${direction}`,
        );
        return [{
            type: billAlloc[0]?.type ?? 'New',
            refno: refno ?? '',
            amount: Math.abs(expected),
            direction,
        }];
    }

    /** Reject voucher save when any batch=Yes item is missing batch rows or
     *  a serial number on any row. The frontend already blocks this, but a
     *  direct API call could bypass that — so re-check on the server too.
     *  We look up the item's `batch` flag from the `item` table so we can
     *  trust the answer regardless of what the client sent.
     */
    private async validateBatchSerials(
        items: Array<{ item_id: number; batch_rows?: Array<{ batch_name?: string; qty: number; rate: number; amount: number }> | null }>,
    ): Promise<void> {
        if (!items || items.length === 0) return;
        const ids = Array.from(new Set(items.map(i => i.item_id).filter(Boolean)));
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(',');
        const rows = await this.db.query<{ id: number; item_name: string; batch: string }>(
            `SELECT id, item_name, batch FROM items WHERE id IN (${placeholders})`,
            ids,
        );
        const byId = new Map(rows.map(r => [Number(r.id), r]));
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const meta = byId.get(Number(it.item_id));
            if (!meta || meta.batch !== 'Yes') continue;
            const batchRows = it.batch_rows || [];
            if (batchRows.length === 0) {
                throw new BadRequestException(
                    `Row ${i + 1}: "${meta.item_name}" requires a serial / batch number — open the batch popup and enter one.`
                );
            }
            const blank = batchRows.findIndex(b => !(b.batch_name || '').trim());
            if (blank !== -1) {
                throw new BadRequestException(
                    `Row ${i + 1}: "${meta.item_name}" — serial / batch number is empty for batch row ${blank + 1}.`
                );
            }
        }
    }

    /** Look up ledger_id from customer table by company name */
    private async lookupLedgerId(name: string): Promise<number | null> {
        const row = await this.db.queryOne<{ id: number }>(
            `SELECT id FROM customer WHERE company = ? LIMIT 1`,
            [name],
        );
        return row?.id ?? null;
    }

    /** Find a ledger by name, or create it under the given ledgergroup if missing.
     *  Used so GST / Sales / Purchase / Roundoff postings always have a real
     *  customer-table row to attach to — without this, ledger_entries would
     *  carry NULL ledger_ids and the customer's voucher total would silently
     *  drop the tax component (showing item value instead of full invoice). */
    private async lookupOrCreateLedger(name: string, ledgergroup: number, conn?: import('mysql2/promise').PoolConnection): Promise<number> {
        const existing = await this.db.queryOne<{ id: number }>(
            `SELECT id FROM customer WHERE company = ? LIMIT 1`, [name], conn,
        );
        if (existing?.id) return existing.id;
        const result = await this.db.execute(
            `INSERT INTO customer (company, ledgergroup, status, billbybill) VALUES (?, ?, 'Active', 'No')`,
            [name, ledgergroup], conn,
        );
        return result.insertId;
    }

    /** Resolve the goods + tax ledger IDs for an items-mode voucher, creating
     *  any missing ones. Returns null IDs only when the items array is empty. */
    private async resolveStandardLedgers(goodsName: 'Sales' | 'Purchase', conn?: import('mysql2/promise').PoolConnection) {
        const goodsGroup = goodsName === 'Sales' ? 22 /* Sales Accounts */ : 20 /* Purchase Accounts */;
        const dutiesGroup = 11; // Duties & Taxes
        const indirectIncome = 14; // Indirect Incomes (used for Roundoff)
        const [goods, cgst, sgst, igst, roundoff] = await Promise.all([
            this.lookupOrCreateLedger(goodsName, goodsGroup, conn),
            this.lookupOrCreateLedger('CGST', dutiesGroup, conn),
            this.lookupOrCreateLedger('SGST', dutiesGroup, conn),
            this.lookupOrCreateLedger('IGST', dutiesGroup, conn),
            this.lookupOrCreateLedger('Roundoff', indirectIncome, conn),
        ]);
        return { goods, cgst, sgst, igst, roundoff };
    }

    /** Build the effective ledger list (tax + extras) for an items voucher.
     *  Aggregates per-item GST into single tax entries, drops any frontend-
     *  supplied tax rows that would double-count, and computes the roundoff so
     *  party amount = subtotal + GST + other ledgers + roundoff (rounded). */
    private async buildItemsLedgerSet(
        items: Array<{ amount: number; cgst_amount?: number; sgst_amount?: number; igst_amount?: number }>,
        userLedgers: Array<{ ledger_id: number; amount: number }>,
        goodsName: 'Sales' | 'Purchase',
        conn?: import('mysql2/promise').PoolConnection,
    ): Promise<{
        ledgers: Array<{ ledger_id: number; amount: number }>; // signed: positive amounts
        goodsLedgerId: number;
        subtotal: number;
        grandTotal: number;
    }> {
        const { goods, cgst, sgst, igst, roundoff } = await this.resolveStandardLedgers(goodsName, conn);

        const subtotal = +items.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2);
        const itemCgst = +items.reduce((s, i) => s + (i.cgst_amount || 0), 0).toFixed(2);
        const itemSgst = +items.reduce((s, i) => s + (i.sgst_amount || 0), 0).toFixed(2);
        const itemIgst = +items.reduce((s, i) => s + (i.igst_amount || 0), 0).toFixed(2);

        // Drop any frontend tax / roundoff rows — backend re-derives them from
        // items + rounding so the customer ledger total is always self-consistent.
        const taxIds = new Set<number>([cgst, sgst, igst, roundoff]);
        const extras = userLedgers.filter(l => l.ledger_id != null && !taxIds.has(l.ledger_id));

        const ledgers: Array<{ ledger_id: number; amount: number }> = [];
        if (itemCgst > 0) ledgers.push({ ledger_id: cgst, amount: itemCgst });
        if (itemSgst > 0) ledgers.push({ ledger_id: sgst, amount: itemSgst });
        if (itemIgst > 0) ledgers.push({ ledger_id: igst, amount: itemIgst });
        for (const e of extras) ledgers.push({ ledger_id: e.ledger_id, amount: Math.abs(e.amount || 0) });

        const preRound = +(subtotal + ledgers.reduce((s, l) => s + l.amount, 0)).toFixed(2);
        const rounded = Math.round(preRound);
        const roundoffAmt = +(rounded - preRound).toFixed(2);
        if (Math.abs(roundoffAmt) >= 0.01) {
            ledgers.push({ ledger_id: roundoff, amount: roundoffAmt });
        }

        const grandTotal = +(subtotal + ledgers.reduce((s, l) => s + l.amount, 0)).toFixed(2);
        return { ledgers, goodsLedgerId: goods, subtotal, grandTotal };
    }

    async create(data: {
        vch_type_id?: number;
        vch_no?: string;
        vch_date?: string;
        remark?: string;
        party_ledger_id: number;
        created_by?: string;
        is_igst?: boolean;
        // When set, marks this voucher as the bill that closes a Lead. After the
        // voucher is saved, the linked lead is auto-transitioned to Closed with
        // closed_via='Billing' — the only path to closing a lead besides Cancel.
        lead_id?: number;
        items: Array<{
            item_id: number;
            qty: number;
            rate: number;
            amount: number;
            gst_rate?: number;
            cgst_amount: number;
            sgst_amount: number;
            igst_amount: number;
            batch_rows?: Array<{ batch_name?: string; qty: number; rate: number; amount: number }> | null;
        }>;
        ledgers?: Array<{ ledger_id: number; amount: number }>; // user-defined, pre-filtered non-zero
        // ledger_id ties an allocation to a specific journal row so multiple
        // bill-by-bill ledgers in one voucher (e.g. two customers in one
        // Receipt) each keep their own bill tracking. Omitting it falls
        // back to party_ledger_id for legacy callers.
        bill_allocation?: Array<{ type: string; refno: string; amount: number; direction?: string; ledger_id?: number }>;
        stock_source?: Array<{ item_id: number; qty: number; rate: number; amount: number; gst_rate?: number; batch_rows?: Array<{ batch_name?: string; qty: number; rate: number; amount: number }> | null }>;
        stock_destination?: Array<{ item_id: number; qty: number; rate: number; amount: number; gst_rate?: number; batch_rows?: Array<{ batch_name?: string; qty: number; rate: number; amount: number }> | null }>;
    }) {
        // Pre-flight validations (outside transaction — no DB writes yet)
        let assignedVchNo = data.vch_no || null;
        let vchNoBumped   = false; // true if we auto-incremented past a collision
        if (assignedVchNo && data.vch_type_id) {
            assignedVchNo = await this.resolveUniqueVchNo(assignedVchNo, data.vch_type_id, data.vch_date || undefined);
            if (assignedVchNo !== data.vch_no) vchNoBumped = true;
        }
        await this.validateBatchSerials(data.items || []);

        // ── All DB writes inside a transaction — atomic all-or-nothing ──
        return this.db.withTransaction(async (conn) => {

            // ── Stock Journal mode: only inventory entries, no ledger entries ──
            const isStockJournal = await (async () => {
                if (!data.vch_type_id) return false;
                const vt = await this.db.queryOne<any>(
                    `SELECT v.name, p.name AS parent_name FROM vchtype v
                     LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                     WHERE v.id = ?`, [data.vch_type_id], conn,
                );
                const n = ((vt?.name || '') + (vt?.parent_name || '')).toLowerCase();
                return n.includes('stock journal');
            })();

            if (isStockJournal) {
                const sourceItems = (data.stock_source || []) as any[];
                const destItems   = (data.stock_destination || []) as any[];

                const vchResult = await this.db.execute(
                    `INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by)
                     VALUES (?, ?, ?, NULL, 0, ?, ?)`,
                    [data.vch_type_id, assignedVchNo, data.vch_date || null,
                     data.remark || null, data.created_by || null],
                    conn,
                );
                const vchId = vchResult.insertId;

                // Dummy ledger entry to hang inventory_entries off (led_id required)
                const dummyLed = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, 0, 0)`,
                    [vchId], conn,
                );
                const dummyLedId = dummyLed.insertId;

                // Source = negative (consumption/outward)
                for (const item of sourceItems) {
                    const qty = -(Math.abs(Number(item.qty)));
                    const amt = -(Math.abs(Number(item.amount)));
                    const invRes = await this.db.execute(
                        `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate, side) VALUES (?, ?, ?, ?, ?, ?, 'source')`,
                        [dummyLedId, item.item_id, qty, item.rate, amt, item.gst_rate || 0], conn,
                    );
                    if (item.batch_rows?.length) {
                        for (const b of item.batch_rows) {
                            await this.db.execute(
                                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [vchId, invRes.insertId, item.item_id, b.batch_name || null, -(Math.abs(Number(b.qty))), b.rate, -(Math.abs(Number(b.amount)))], conn,
                            );
                        }
                    }
                }

                // Destination = positive (production/inward)
                for (const item of destItems) {
                    const qty = Math.abs(Number(item.qty));
                    const amt = Math.abs(Number(item.amount));
                    const invRes = await this.db.execute(
                        `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate, side) VALUES (?, ?, ?, ?, ?, ?, 'destination')`,
                        [dummyLedId, item.item_id, qty, item.rate, amt, item.gst_rate || 0], conn,
                    );
                    if (item.batch_rows?.length) {
                        for (const b of item.batch_rows) {
                            await this.db.execute(
                                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [vchId, invRes.insertId, item.item_id, b.batch_name || null, Math.abs(Number(b.qty)), b.rate, Math.abs(Number(b.amount))], conn,
                            );
                        }
                    }
                }

                return { id: vchId, vch_no: assignedVchNo, vch_no_bumped: vchNoBumped };
            }

            // Journal mode: Contra / Journal / Payment / Receipt — no inventory items
            if (!data.items || data.items.length === 0) {
                const drTotal = +(data.ledgers || [])
                    .filter(l => (l.amount || 0) > 0)
                    .reduce((s, l) => s + l.amount, 0).toFixed(2);

                const vchResult = await this.db.execute(
                    `INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [data.vch_type_id || null, assignedVchNo, data.vch_date || null,
                     data.party_ledger_id, drTotal, data.remark || null, data.created_by || null],
                    conn,
                );
                const vchId = vchResult.insertId;

                // Multiple ledger rows can each be bill-by-bill — track every
                // ledger's own ledentry_id, not just the single party's.
                const ledEntryIdByLedger = new Map<number, number>();
                for (const led of data.ledgers || []) {
                    if (!led.ledger_id || !led.amount) continue;
                    const ledRes = await this.db.execute(
                        `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                        [vchId, led.ledger_id, led.amount],
                        conn,
                    );
                    if (!ledEntryIdByLedger.has(led.ledger_id)) {
                        ledEntryIdByLedger.set(led.ledger_id, ledRes.insertId);
                    }
                }

                // Group bill_allocation entries by ledger_id (falls back to the
                // primary party_ledger_id for legacy callers that omit ledger_id),
                // normalize each ledger's allocations against ITS OWN signed
                // amount, then insert against ITS OWN ledentry_id.
                const baByLedger = new Map<number, Array<{ amount: number; direction?: string; type?: string; refno?: string }>>();
                for (const ba of data.bill_allocation || []) {
                    const ledgerId = (ba as any).ledger_id ?? data.party_ledger_id;
                    if (!baByLedger.has(ledgerId)) baByLedger.set(ledgerId, []);
                    baByLedger.get(ledgerId)!.push(ba);
                }
                for (const [ledgerId, entries] of baByLedger) {
                    const led = (data.ledgers || []).find(l => l.ledger_id === ledgerId);
                    const normalizedBA = this.normalizeBillAllocation(
                        led?.amount ?? 0,
                        entries,
                        assignedVchNo,
                    );
                    const ledEntryId = ledEntryIdByLedger.get(ledgerId) ?? null;
                    if (!normalizedBA || normalizedBA.length === 0) continue;
                    for (const ba of normalizedBA) {
                        if (!ba.amount) continue;
                        const signedAmt = ba.direction
                            ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                            : (ba.type === 'Agr.' ? -Math.abs(ba.amount) : Math.abs(ba.amount));
                        const billname = (!ba.type || ba.type === 'New')
                            ? (assignedVchNo || ba.refno || null)
                            : (ba.refno || null);
                        await this.db.execute(
                            `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                            [vchId, ledEntryId, ledgerId, billname, signedAmt],
                            conn,
                        );
                    }
                }

                await this.linkLeadAndAutoClose(vchId, data.lead_id, data.created_by, conn);
                return { id: vchId, vch_no: assignedVchNo, vch_no_bumped: vchNoBumped };
            }

            // 2. Sign + goods-ledger logic via deemed_positive from vchtype table.
            let deemedPositive: boolean | null = null;
            let goodsLedgerName: 'Sales' | 'Purchase' = 'Sales';
            if (data.vch_type_id) {
                const vtRow = await this.db.queryOne<any>(
                    `SELECT v.name, v.deemed_positive,
                     p.name AS parent_name, p.deemed_positive AS parent_deemed
                     FROM vchtype v
                     LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                     WHERE v.id = ?`, [data.vch_type_id],
                    conn,
                );
                const dp = vtRow?.deemed_positive || vtRow?.parent_deemed;
                if (dp === 'YES') deemedPositive = true;
                else if (dp === 'NO') deemedPositive = false;
                const pname = (vtRow?.parent_name || vtRow?.name || '').toLowerCase();
                goodsLedgerName = (pname.includes('purchase') || pname.includes('debit')) ? 'Purchase' : 'Sales';
            }
            const effectivePositive = deemedPositive ?? true;

            const { ledgers: effectiveLedgers, goodsLedgerId, subtotal, grandTotal } =
                await this.buildItemsLedgerSet(data.items, data.ledgers || [], goodsLedgerName, conn);

            // 1. Voucher header
            const vchResult = await this.db.execute(
                `INSERT INTO vch_details (vch_type_id, vch_no, vch_date, party_ledger_id, amount, remark, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data.vch_type_id || null, assignedVchNo, data.vch_date || null, data.party_ledger_id, grandTotal, data.remark || null, data.created_by || null],
                conn,
            );
            const vchId = vchResult.insertId;

            let goodsLedId: number | null = null;
            let partyLedEntryId: number | null = null;

            if (effectivePositive === true) {
                const pr = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, data.party_ledger_id, +grandTotal], conn,
                );
                partyLedEntryId = pr.insertId;
                const r = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, goodsLedgerId, -subtotal], conn,
                );
                goodsLedId = r.insertId;
            } else {
                const pr = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, data.party_ledger_id, -grandTotal], conn,
                );
                partyLedEntryId = pr.insertId;
                const r = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, goodsLedgerId, +subtotal], conn,
                );
                goodsLedId = r.insertId;
            }

            // 3. Inventory entries + batch
            if (goodsLedId) {
                const sign = effectivePositive === true ? -1 : 1;
                for (const item of data.items) {
                    const invResult = await this.db.execute(
                        `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate) VALUES (?, ?, ?, ?, ?, ?)`,
                        [goodsLedId, item.item_id, item.qty * sign, item.rate, item.amount * sign, item.gst_rate || 0],
                        conn,
                    );
                    const invId = invResult.insertId;

                    if (item.batch_rows && item.batch_rows.length > 0) {
                        for (const b of item.batch_rows) {
                            await this.db.execute(
                                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [vchId, invId, item.item_id, b.batch_name || null, b.qty * sign, b.rate, b.amount * sign],
                                conn,
                            );
                        }
                    } else {
                        await this.db.execute(
                            `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [vchId, invId, item.item_id, null, item.qty * sign, item.rate, item.amount * sign],
                            conn,
                        );
                    }
                }
            }

            // 4. Tax + extra ledger entries
            if (effectiveLedgers.length > 0) {
                const sign = effectivePositive === true ? -1 : 1;
                for (const led of effectiveLedgers) {
                    if (!led.ledger_id || !led.amount) continue;
                    await this.db.execute(
                        `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                        [vchId, led.ledger_id, led.amount * sign],
                        conn,
                    );
                }
            }

            // 5. Bill allocation entries
            const baseSignCreate = effectivePositive ? 1 : -1;
            const normalizedBACreate = this.normalizeBillAllocation(
                grandTotal * baseSignCreate,
                data.bill_allocation,
                assignedVchNo,
            );
            if (normalizedBACreate && normalizedBACreate.length > 0) {
                const baseSign = baseSignCreate;
                for (const ba of normalizedBACreate) {
                    if (!ba.amount) continue;
                    const signedAmt = ba.direction
                        ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                        : (ba.type === 'Agr.'
                            ? -Math.abs(ba.amount) * baseSign
                            :  Math.abs(ba.amount) * baseSign);
                    // For 'New' refs, always use the actual saved vch_no (handles race-bumped numbers)
                    const billname = (!ba.type || ba.type === 'New')
                        ? (assignedVchNo || ba.refno || null)
                        : (ba.refno || null);
                    await this.db.execute(
                        `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                        [vchId, partyLedEntryId, data.party_ledger_id, billname, signedAmt],
                        conn,
                    );
                }
            }

            await this.linkLeadAndAutoClose(vchId, data.lead_id, data.created_by, conn);
            return { id: vchId, vch_no: assignedVchNo, vch_no_bumped: vchNoBumped };
        });
    }

    /** Find the next unused voucher number starting from `candidate`.
     *  Increments the counter portion (never a prefix/suffix digit, e.g. a
     *  year embedded in the suffix) until no collision. Max 1000 attempts. */
    private async resolveUniqueVchNo(candidate: string, vchTypeId: number, forDate?: string): Promise<string> {
        const { prefix, suffix } = await this.resolveAffixes(vchTypeId, forDate);
        let current = candidate;
        for (let i = 0; i < 1000; i++) {
            const [dup] = await this.db.query<any>(
                `SELECT COUNT(*) as cnt FROM vch_details WHERE vch_no = ? AND vch_type_id = ?`,
                [current, vchTypeId],
            );
            if ((dup?.cnt ?? 0) === 0) return current;
            current = this.bumpVchNo(current, prefix, suffix);
        }
        return current;
    }

    /** Increment the numeric counter in a voucher number, stripping the known
     *  prefix/suffix first so digits inside the suffix (e.g. a year) are never
     *  mistaken for the counter. Falls back to the last digit run in the whole
     *  string when the value doesn't match the configured prefix/suffix
     *  (e.g. manually-typed numbers that don't follow the current pattern). */
    private bumpVchNo(value: string, prefix: string, suffix: string): string {
        const hasPrefix = !!prefix && value.startsWith(prefix);
        const hasSuffix = !!suffix && value.endsWith(suffix) && value.length >= prefix.length + suffix.length;
        if (hasPrefix || hasSuffix) {
            const body = value.slice(hasPrefix ? prefix.length : 0, hasSuffix ? value.length - suffix.length : undefined);
            if (/^\d+$/.test(body)) {
                const bumped = String(parseInt(body, 10) + 1).padStart(body.length, '0');
                return `${hasPrefix ? prefix : ''}${bumped}${hasSuffix ? suffix : ''}`;
            }
        }
        // Fallback: last digit run in the string (pre-existing best-effort behavior)
        let fallback = value.replace(/(\d+)(?=\D*$)/, (m) => String(parseInt(m, 10) + 1).padStart(m.length, '0'));
        if (!/\d/.test(fallback)) fallback = fallback + '1';
        return fallback;
    }

    // Stamp the voucher with lead_id and close the linked lead. Idempotent and
    // fail-soft: a problem closing the lead must not roll back the voucher save.
    private async linkLeadAndAutoClose(vchId: number, leadId: number | undefined, createdBy?: string, conn?: import('mysql2/promise').PoolConnection): Promise<void> {
        if (!leadId) return;
        try {
            await this.db.execute(`UPDATE vch_details SET lead_id = ? WHERE id = ?`, [leadId, vchId], conn);
            await this.db.execute(
                `UPDATE service_calls
                 SET status = 'Closed', closed_at = NOW(), closed_via = 'Billing', voucher_id = ?, updated_at = NOW()
                 WHERE id = ? AND status NOT IN ('Closed','Cancelled')`,
                [vchId, leadId], conn,
            );
            try {
                await this.db.execute(
                    `INSERT INTO lead_notes (service_call_id, note_type, content, status, created_by)
                     VALUES (?, 'StatusChange', ?, 'Completed', ?)`,
                    [leadId, `Lead closed via voucher #${vchId}`, createdBy || 'System'], conn,
                );
            } catch { /* lead_notes table may not exist in all envs */ }
        } catch (e) {
            console.error('[vouchers.create] linkLeadAndAutoClose failed:', e);
        }
    }

    async findAll(page = 1, limit = 20, filters?: {
        vch_type?: string;
        search?: string;
        date_from?: string;
        date_to?: string;
    }) {
        const conditions: string[] = [];
        const params: any[] = [];
        if (filters?.vch_type)  { conditions.push('COALESCE(p.name, vt.name) = ?'); params.push(filters.vch_type); }
        if (filters?.search)    { conditions.push('(v.vch_no LIKE ? OR c.company LIKE ?)'); params.push(`%${filters.search}%`, `%${filters.search}%`); }
        if (filters?.date_from) { conditions.push('v.vch_date >= ?');   params.push(filters.date_from); }
        if (filters?.date_to)   { conditions.push('v.vch_date <= ?');   params.push(filters.date_to); }

        const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const offset = (page - 1) * limit;

        const [count] = await this.db.query<any>(
            `SELECT COUNT(*) as total FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${where}`, params,
        );

        const data = await this.db.query<any>(
            `SELECT v.*, c.company AS party_name,
             COALESCE(p.name, vt.name) AS vch_type_name, vt.name AS vch_subtype_name
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${where}
             ORDER BY v.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        return { data, total: count?.total || 0, page, limit };
    }

    async getDaybook(opts: { date?: string; dateFrom?: string; dateTo?: string; user?: ScopedUser }) {
        // Day Book amount = the party ledger's total exposure for the voucher.
        // Source of truth is vch_details.amount (the recorded grand total
        // including item value + GST + roundoff). Direction comes from the
        // voucher type's deemed_positive flag:
        //   YES → Sales / Debit Note → Customer Dr (Debit column)
        //   NO  → Purchase / Credit Note → Customer Cr (Credit column)
        // Journal / Contra (no deemed_positive on parent) fall back to the
        // sign on ledger_entries since direction is per-row there.
        // Accepts either a single date OR a from/to range. dateFrom/dateTo
        // take precedence when both are supplied.
        const where: string[] = [];
        const params: any[] = [];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        if (!opts.dateFrom && !opts.dateTo && opts.date) {
            where.push('DATE(v.vch_date) = ?');
            params.push(opts.date);
        }
        // Ledger-group-scoped users only see vouchers whose party ledger
        // falls inside their assigned group subtree. Empty scope (no group
        // assigned) = no rows at all.
        const scope = await this.getUserLedgerScope(opts.user);
        if (scope) {
            if (scope.length === 0) return [];
            where.push(`c.ledgergroup IN (${scope.map(() => '?').join(',')})`);
            params.push(...scope);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        return this.db.query<any>(
            `SELECT v.id, v.vch_no, v.vch_date, v.remark,
                    v.checked_by, v.checked_at,
                    c.company AS party_name,
                    COALESCE(p.name, vt.name) AS vch_type_name,
                    vt.name AS vch_subtype_name,
                    CASE
                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'YES' THEN v.amount
                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'NO'  THEN 0
                        WHEN ple.amount > 0 THEN ple.amount
                        ELSE 0
                    END AS dr_amount,
                    CASE
                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'NO'  THEN v.amount
                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'YES' THEN 0
                        WHEN ple.amount < 0 THEN ABS(ple.amount)
                        ELSE 0
                    END AS cr_amount,
                    v.created_at
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             LEFT JOIN ledger_entries ple ON ple.vch_id = v.id AND ple.ledger_id = v.party_ledger_id
             ${whereSql}
             ORDER BY v.vch_date ASC, v.created_at ASC`,
            params,
        );
    }

    /** Sales Register summary — month-wise totals across the date range,
     *  matching the Tally "Sales Register" landing screen. Each row =
     *  one calendar month with the gross sales total. Drill-down to a
     *  single month is exposed via getSalesRegister() (date range narrowed
     *  client-side to that month).
     *
     *  The MONTHS that fall within the requested window are emitted even
     *  if there were zero vouchers — that way the report visually mirrors
     *  Tally (always 12 rows for a full FY) rather than skipping months. */
    async getSalesRegisterMonthly(opts: {
        dateFrom?: string;
        dateTo?: string;
    }) {
        const where: string[] = ["COALESCE(p.name, vt.name) = 'Sales'"];
        const params: any[] = [];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        // Aggregate gross sales per (year, month). v.amount is the grand
        // total (taxable + GST + others) which matches Tally's Closing
        // column. Debit/Credit columns mirror Tally too: a Sales voucher
        // credits the Sales account → shows under Credit; debit stays 0
        // unless the user defined an inverted Sales subtype.
        const rows = await this.db.query<any>(
            `SELECT YEAR(v.vch_date)  AS year,
                    MONTH(v.vch_date) AS month,
                    COUNT(*)          AS voucher_count,
                    COALESCE(SUM(CASE WHEN COALESCE(p.deemed_positive, vt.deemed_positive) = 'YES' THEN v.amount ELSE 0 END), 0) AS credit_total,
                    COALESCE(SUM(CASE WHEN COALESCE(p.deemed_positive, vt.deemed_positive) = 'NO'  THEN v.amount ELSE 0 END), 0) AS debit_total,
                    COALESCE(SUM(v.amount), 0) AS gross_total
             FROM vch_details v
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${whereSql}
             GROUP BY YEAR(v.vch_date), MONTH(v.vch_date)
             ORDER BY year ASC, month ASC`,
            params,
        );

        // Build the full month list across the date range so empty months
        // still appear (matches Tally's behaviour of showing 12 months for
        // a full FY even when most have no entries).
        const fillMonths = (): { year: number; month: number }[] => {
            if (!opts.dateFrom || !opts.dateTo) {
                return rows.map((r: any) => ({ year: Number(r.year), month: Number(r.month) }));
            }
            const start = new Date(opts.dateFrom);
            const end   = new Date(opts.dateTo);
            const list: { year: number; month: number }[] = [];
            const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
            const endTag = end.getFullYear() * 12 + end.getMonth();
            while (cursor.getFullYear() * 12 + cursor.getMonth() <= endTag) {
                list.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
                cursor.setMonth(cursor.getMonth() + 1);
            }
            return list;
        };
        const monthSlots = fillMonths();
        const byKey = new Map<string, any>();
        for (const r of rows) byKey.set(`${r.year}-${r.month}`, r);

        const data = monthSlots.map(slot => {
            const r = byKey.get(`${slot.year}-${slot.month}`) || {};
            const credit = +Number(r.credit_total || 0).toFixed(2);
            const debit  = +Number(r.debit_total  || 0).toFixed(2);
            return {
                year:          slot.year,
                month:         slot.month,
                voucher_count: Number(r.voucher_count) || 0,
                debit_total:   debit,
                credit_total:  credit,
                gross_total:   +Number(r.gross_total || 0).toFixed(2),
            };
        });

        const totals = data.reduce((acc, m) => ({
            voucher_count: acc.voucher_count + m.voucher_count,
            debit_total:   acc.debit_total   + m.debit_total,
            credit_total:  acc.credit_total  + m.credit_total,
            gross_total:   acc.gross_total   + m.gross_total,
        }), { voucher_count: 0, debit_total: 0, credit_total: 0, gross_total: 0 });

        return {
            rows: data,
            totals: {
                voucher_count: totals.voucher_count,
                debit_total:   +totals.debit_total.toFixed(2),
                credit_total:  +totals.credit_total.toFixed(2),
                gross_total:   +totals.gross_total.toFixed(2),
            },
        };
    }

    /** Sales Register detail — one row per Sales voucher in the date range.
     *  "Sales" includes any voucher whose top-level parent type is named
     *  "Sales" (so user-defined subtypes like "Sales-Export" or "Sales-2"
     *  are included automatically). Each row carries the taxable subtotal,
     *  the CGST/SGST/IGST split, the gross total, and party metadata for
     *  GSTR-style reconciliation.
     *
     *  Tax split heuristic: CGST/SGST/IGST contributions are detected by
     *  ledger name prefix (`CGST%`, `SGST%`, `IGST%` against customer.company).
     *  This matches the seed naming used elsewhere in the codebase. Anything
     *  that doesn't match those prefixes lands in `other_charges` so totals
     *  always reconcile to vch_details.amount. */
    async getSalesRegister(opts: {
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const where: string[] = ["COALESCE(p.name, vt.name) = 'Sales'"];
        const params: any[] = [];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        if (opts.search)   { where.push('(c.company LIKE ? OR v.vch_no LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`); }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        const rows = await this.db.query<any>(
            `SELECT v.id                                        AS vch_id,
                    v.vch_no,
                    v.vch_date,
                    vt.name                                     AS vch_subtype_name,
                    COALESCE(p.name, vt.name)                   AS vch_type_name,
                    c.company                                   AS party_name,
                    c.gstin                                     AS party_gst,
                    s.name                                      AS party_state,
                    v.amount                                    AS total_amount,
                    (SELECT COALESCE(SUM(ie.amount), 0)
                       FROM inventory_entries ie
                       INNER JOIN ledger_entries le ON ie.led_id = le.id
                       WHERE le.vch_id = v.id)                  AS taxable_amount,
                    (SELECT COALESCE(SUM(le.amount), 0)
                       FROM ledger_entries le
                       LEFT JOIN customer cl ON le.ledger_id = cl.id
                       WHERE le.vch_id = v.id AND cl.company LIKE 'CGST%') AS cgst_amount,
                    (SELECT COALESCE(SUM(le.amount), 0)
                       FROM ledger_entries le
                       LEFT JOIN customer cl ON le.ledger_id = cl.id
                       WHERE le.vch_id = v.id AND cl.company LIKE 'SGST%') AS sgst_amount,
                    (SELECT COALESCE(SUM(le.amount), 0)
                       FROM ledger_entries le
                       LEFT JOIN customer cl ON le.ledger_id = cl.id
                       WHERE le.vch_id = v.id AND cl.company LIKE 'IGST%') AS igst_amount,
                    (SELECT COUNT(*)
                       FROM inventory_entries ie
                       INNER JOIN ledger_entries le ON ie.led_id = le.id
                       WHERE le.vch_id = v.id)                  AS item_count
             FROM vch_details v
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN pincode pv ON c.pincode = pv.pincode
             LEFT JOIN state s    ON pv.stateid = s.id
             ${whereSql}
             ORDER BY v.vch_date ASC, v.id ASC`,
            params,
        );

        // Normalize numbers + compute the leftover bucket so the row totals
        // always equal total_amount (taxable + CGST + SGST + IGST + other).
        const data = rows.map((r: any) => {
            const taxable = +Number(r.taxable_amount || 0).toFixed(2);
            const cgst    = +Number(r.cgst_amount    || 0).toFixed(2);
            const sgst    = +Number(r.sgst_amount    || 0).toFixed(2);
            const igst    = +Number(r.igst_amount    || 0).toFixed(2);
            const total   = +Number(r.total_amount   || 0).toFixed(2);
            const other   = +(total - (taxable + cgst + sgst + igst)).toFixed(2);
            return {
                vch_id:          r.vch_id,
                vch_no:          r.vch_no,
                vch_date:        r.vch_date,
                vch_type_name:   r.vch_type_name,
                vch_subtype_name: r.vch_subtype_name,
                party_name:      r.party_name || '—',
                party_gst:       r.party_gst || null,
                party_state:     r.party_state || null,
                item_count:      Number(r.item_count) || 0,
                taxable_amount:  taxable,
                cgst_amount:     cgst,
                sgst_amount:     sgst,
                igst_amount:     igst,
                other_charges:   other,
                total_amount:    total,
            };
        });

        const totals = data.reduce((acc, r) => ({
            taxable: acc.taxable + r.taxable_amount,
            cgst:    acc.cgst + r.cgst_amount,
            sgst:    acc.sgst + r.sgst_amount,
            igst:    acc.igst + r.igst_amount,
            other:   acc.other + r.other_charges,
            total:   acc.total + r.total_amount,
        }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, other: 0, total: 0 });

        return {
            rows: data,
            totals: {
                taxable: +totals.taxable.toFixed(2),
                cgst:    +totals.cgst.toFixed(2),
                sgst:    +totals.sgst.toFixed(2),
                igst:    +totals.igst.toFixed(2),
                other:   +totals.other.toFixed(2),
                total:   +totals.total.toFixed(2),
            },
        };
    }

    /** Group Summary — debit / credit / net balance grouped by the
     *  accounting *ledger group* (`customer.ledgergroup` → ledgergroup.id,
     *  e.g. "Sundry Debtors", "Bank Accounts", "Sales Accounts"). This is
     *  the standard Trial-Balance-style summary by ledger classification.
     *
     *  Aggregates ledger_entries via the customer attached to each row and
     *  sums each side: debit = positive, credit = negative. */
    async getGroupSummary(opts: {
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        // Load ALL ledger groups so we can walk to true root in JS
        const allGroups = await this.db.query<any>(`SELECT id, name, parent_id FROM ledgergroup`);
        const groupMap = new Map<number, { id: number; name: string; parent_id: number | null }>();
        for (const g of allGroups) groupMap.set(Number(g.id), { id: Number(g.id), name: g.name, parent_id: g.parent_id != null ? Number(g.parent_id) : null });

        // Walk up to the true root ancestor (parent_id IS NULL)
        const rootOf = (gid: number): { id: number; name: string } => {
            let cur = groupMap.get(gid);
            if (!cur) return { id: gid, name: 'Ungrouped' };
            const visited = new Set<number>();
            while (cur.parent_id != null && !visited.has(cur.id)) {
                visited.add(cur.id);
                const parent = groupMap.get(cur.parent_id);
                if (!parent) break;
                cur = parent;
            }
            return { id: cur.id, name: cur.name };
        };

        // Only root groups (parent_id IS NULL) should appear in the root view
        const rootGroupIds = new Set<number>();
        for (const g of allGroups) {
            if (g.parent_id == null) rootGroupIds.add(Number(g.id));
        }

        // Load all customers with opening balances
        const customers = await this.db.query<any>(
            `SELECT c.id, c.ledgergroup,
                    COALESCE(c.opening_balance, 0) *
                      CASE WHEN c.opening_balance_type = 'Cr' THEN -1 ELSE 1 END AS master_opening
             FROM customer c`,
        );

        // Prior activity (before dateFrom) per ledger
        const priorParams: any[] = [];
        let priorSql = '';
        if (opts.dateFrom) {
            priorSql = `SELECT le.ledger_id, COALESCE(SUM(le.amount), 0) AS prior_total
                        FROM ledger_entries le
                        INNER JOIN vch_details v ON le.vch_id = v.id
                        WHERE v.vch_date < ?
                        GROUP BY le.ledger_id`;
            priorParams.push(opts.dateFrom);
        }
        const priorRows = priorSql ? await this.db.query<any>(priorSql, priorParams) : [];
        const priorByLed = new Map<number, number>();
        for (const r of priorRows) priorByLed.set(Number(r.ledger_id), Number(r.prior_total) || 0);

        // Range activity per ledger
        const rangeWhere: string[] = [];
        const rangeParams: any[] = [];
        if (opts.dateFrom) { rangeWhere.push('v.vch_date >= ?'); rangeParams.push(opts.dateFrom); }
        if (opts.dateTo)   { rangeWhere.push('v.vch_date <= ?'); rangeParams.push(opts.dateTo); }
        const rangeCondSql = rangeWhere.length ? 'WHERE ' + rangeWhere.join(' AND ') : '';
        const rangeRows = await this.db.query<any>(
            `SELECT le.ledger_id,
                    COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0) AS debit_total,
                    COALESCE(SUM(CASE WHEN le.amount < 0 THEN ABS(le.amount) ELSE 0 END), 0) AS credit_total
             FROM ledger_entries le
             INNER JOIN vch_details v ON le.vch_id = v.id
             ${rangeCondSql}
             GROUP BY le.ledger_id`,
            rangeParams,
        );
        const rangeByLed = new Map<number, { debit: number; credit: number }>();
        for (const r of rangeRows) rangeByLed.set(Number(r.ledger_id), {
            debit:  Number(r.debit_total)  || 0,
            credit: Number(r.credit_total) || 0,
        });

        // Aggregate by true root group
        const byRoot = new Map<number, { name: string; ledger_count: number; opening: number; debit: number; credit: number }>();

        for (const c of customers) {
            const gid = c.ledgergroup != null ? Number(c.ledgergroup) : null;
            const root = gid != null ? rootOf(gid) : { id: -1, name: 'Ungrouped' };
            if (!byRoot.has(root.id)) byRoot.set(root.id, { name: root.name, ledger_count: 0, opening: 0, debit: 0, credit: 0 });
            const bucket = byRoot.get(root.id)!;
            const masterOpening = Number(c.master_opening) || 0;
            const prior = priorByLed.get(Number(c.id)) || 0;
            const opening = masterOpening + prior;
            const range = rangeByLed.get(Number(c.id)) || { debit: 0, credit: 0 };
            bucket.ledger_count += 1;
            bucket.opening += opening;
            bucket.debit   += range.debit;
            bucket.credit  += range.credit;
        }

        const search = (opts.search || '').trim().toLowerCase();
        const data = Array.from(byRoot.entries())
            .map(([gid, b]) => ({
                group_id:     gid,
                group_name:   b.name,
                ledger_count: b.ledger_count,
                total_debit:  +b.debit.toFixed(2),
                total_credit: +b.credit.toFixed(2),
                opening:      +b.opening.toFixed(2),
                net_balance:  +(b.opening + b.debit - b.credit).toFixed(2),
            }))
            .filter((g) => !search || g.group_name.toLowerCase().includes(search))
            .sort((a, b) => a.group_name.localeCompare(b.group_name));

        const totals = data.reduce((acc, g) => ({
            debit:   acc.debit   + g.total_debit,
            credit:  acc.credit  + g.total_credit,
            opening: acc.opening + g.opening,
            balance: acc.balance + g.net_balance,
        }), { debit: 0, credit: 0, opening: 0, balance: 0 });

        return {
            rows: data,
            totals: {
                debit:   +totals.debit.toFixed(2),
                credit:  +totals.credit.toFixed(2),
                opening: +totals.opening.toFixed(2),
                balance: +totals.balance.toFixed(2),
            },
        };
    }

    /** Group Summary drill-down — list every ledger in the requested
     *  group with its Tally-style opening / debit / credit / closing
     *  balance for the date window.
     *
     *  Opening per ledger = master opening (customer.opening_balance,
     *  signed by opening_balance_type Dr/Cr) + activity strictly before
     *  dateFrom. Debit/Credit columns split the in-range activity by
     *  sign (debit = positive ledger_entries, credit = negative).
     *  Closing = opening + (debit − credit).
     *
     *  This mirrors how Tally's "Group Summary" drill-down shows ledgers
     *  within a selected accounting group. */
    async getGroupLedgers(opts: {
        groupId: number;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const group = await this.db.queryOne<any>(
            `SELECT id, name, parent_id FROM ledgergroup WHERE id = ?`, [opts.groupId],
        );

        // Child sub-groups of this parent group
        const childGroups = await this.db.query<any>(
            `SELECT id, name FROM ledgergroup WHERE parent_id = ? ORDER BY name ASC`,
            [opts.groupId],
        );

        // Build date range SQL snippets (reused for sub-group + direct ledger queries)
        const rangeWhere: string[] = [];
        const rangeParams: any[] = [];
        if (opts.dateFrom) { rangeWhere.push('v.vch_date >= ?'); rangeParams.push(opts.dateFrom); }
        if (opts.dateTo)   { rangeWhere.push('v.vch_date <= ?'); rangeParams.push(opts.dateTo); }
        const rangeSql = rangeWhere.length ? 'AND ' + rangeWhere.join(' AND ') : '';

        const priorWhere = opts.dateFrom ? 'AND v.vch_date < ?' : '';
        const priorParams = opts.dateFrom ? [opts.dateFrom] : [];

        // Aggregate each child sub-group's ledgers into one summary row
        const subGroupRows: any[] = [];
        for (const cg of childGroups) {
            const cgCustomers = await this.db.query<any>(
                `SELECT c.id,
                        COALESCE(c.opening_balance, 0) *
                          CASE WHEN c.opening_balance_type = 'Cr' THEN -1 ELSE 1 END AS master_opening
                 FROM customer c WHERE c.ledgergroup = ?`,
                [cg.id],
            );
            if (cgCustomers.length === 0) {
                subGroupRows.push({
                    row_type: 'subgroup',
                    ledger_id: null,
                    group_id: cg.id,
                    ledger_name: cg.name,
                    ledger_count: 0,
                    opening_balance: 0,
                    debit_total: 0,
                    credit_total: 0,
                    closing_balance: 0,
                });
                continue;
            }
            const ids = cgCustomers.map((c: any) => c.id);
            const idList = ids.map(() => '?').join(',');
            const masterOpeningSum = cgCustomers.reduce((s: number, c: any) => s + (Number(c.master_opening) || 0), 0);

            const [priorRow] = opts.dateFrom ? await this.db.query<any>(
                `SELECT COALESCE(SUM(le.amount), 0) AS prior_total
                 FROM ledger_entries le
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 WHERE le.ledger_id IN (${idList}) ${priorWhere}`,
                [...ids, ...priorParams],
            ) : [{ prior_total: 0 }];

            const [rangeRow] = await this.db.query<any>(
                `SELECT COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0) AS debit_total,
                        COALESCE(SUM(CASE WHEN le.amount < 0 THEN ABS(le.amount) ELSE 0 END), 0) AS credit_total
                 FROM ledger_entries le
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 WHERE le.ledger_id IN (${idList}) ${rangeSql}`,
                [...ids, ...rangeParams],
            );

            const opening = +(masterOpeningSum + (Number(priorRow?.prior_total) || 0)).toFixed(2);
            const debit   = +Number(rangeRow?.debit_total  || 0).toFixed(2);
            const credit  = +Number(rangeRow?.credit_total || 0).toFixed(2);
            subGroupRows.push({
                row_type: 'subgroup',
                ledger_id: null,
                group_id: cg.id,
                ledger_name: cg.name,
                ledger_count: ids.length,
                opening_balance: opening,
                debit_total:  debit,
                credit_total: credit,
                closing_balance: +(opening + debit - credit).toFixed(2),
            });
        }

        // Direct ledgers whose group IS this parent group
        const directWhere: string[] = ['c.ledgergroup = ?'];
        const directParams: any[] = [opts.groupId];
        if (opts.search) { directWhere.push('c.company LIKE ?'); directParams.push(`%${opts.search}%`); }
        const customers = await this.db.query<any>(
            `SELECT c.id, c.company,
                    COALESCE(c.opening_balance, 0) *
                      CASE WHEN c.opening_balance_type = 'Cr' THEN -1 ELSE 1 END AS master_opening
             FROM customer c
             WHERE ${directWhere.join(' AND ')}
             ORDER BY c.company ASC`,
            directParams,
        );

        let ledgerRows: any[] = [];
        if (customers.length > 0) {
            const ids = customers.map((c: any) => c.id);
            const idList = ids.map(() => '?').join(',');

            const priorRows = opts.dateFrom ? await this.db.query<any>(
                `SELECT le.ledger_id, COALESCE(SUM(le.amount), 0) AS prior_total
                 FROM ledger_entries le
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 WHERE le.ledger_id IN (${idList}) ${priorWhere}
                 GROUP BY le.ledger_id`,
                [...ids, ...priorParams],
            ) : [];
            const priorByLed = new Map<number, number>();
            for (const r of priorRows) priorByLed.set(Number(r.ledger_id), Number(r.prior_total) || 0);

            const rangeRows = await this.db.query<any>(
                `SELECT le.ledger_id,
                        COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0) AS debit_total,
                        COALESCE(SUM(CASE WHEN le.amount < 0 THEN ABS(le.amount) ELSE 0 END), 0) AS credit_total
                 FROM ledger_entries le
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 WHERE le.ledger_id IN (${idList}) ${rangeSql}
                 GROUP BY le.ledger_id`,
                [...ids, ...rangeParams],
            );
            const rangeByLed = new Map<number, { debit: number; credit: number }>();
            for (const r of rangeRows) rangeByLed.set(Number(r.ledger_id), {
                debit:  Number(r.debit_total)  || 0,
                credit: Number(r.credit_total) || 0,
            });

            ledgerRows = customers.map((c: any) => {
                const masterOpening = Number(c.master_opening) || 0;
                const prior = priorByLed.get(Number(c.id)) || 0;
                const opening = +(masterOpening + prior).toFixed(2);
                const split = rangeByLed.get(Number(c.id)) || { debit: 0, credit: 0 };
                const closing = +(opening + split.debit - split.credit).toFixed(2);
                return {
                    row_type: 'ledger',
                    ledger_id:    c.id,
                    group_id: null,
                    ledger_name:  c.company || '—',
                    ledger_count: null,
                    opening_balance: opening,
                    debit_total:  +split.debit.toFixed(2),
                    credit_total: +split.credit.toFixed(2),
                    closing_balance: closing,
                };
            });
        }

        const allRows = [...subGroupRows, ...ledgerRows];
        const totals = allRows.reduce((acc, r) => ({
            opening: acc.opening + r.opening_balance,
            debit:   acc.debit   + r.debit_total,
            credit:  acc.credit  + r.credit_total,
            closing: acc.closing + r.closing_balance,
        }), { opening: 0, debit: 0, credit: 0, closing: 0 });

        return {
            group: group || { id: opts.groupId, name: 'Unknown' },
            rows: allRows,
            totals: {
                opening: +totals.opening.toFixed(2),
                debit:   +totals.debit.toFixed(2),
                credit:  +totals.credit.toFixed(2),
                closing: +totals.closing.toFixed(2),
            },
        };
    }

    /** User-wise Pending Payment — outstanding bills aggregated by the
     *  user/team that owns each customer (`customer.group` → admin.name OR
     *  `customer.cloud_group_id` → cloud_users.name). Each row is one
     *  user with a count of pending bills, total receivable, and aging
     *  buckets: 0-15 / 16-30 / 30+ days from the bill's first activity.
     *
     *  Aging is computed against `as_of` (defaults to today). Only
     *  outstanding receivables are counted (closing > 0); credit balances
     *  are excluded so the report stays a "money owed to us" view. */
    async getUserWiseOutstanding(opts: {
        asOf?: string;
        search?: string;
        user?: ScopedUser;
    }) {
        const asOf = opts.asOf || null;

        // Ledger-group-scoped users only see bills of parties inside their
        // assigned group subtree. Empty scope (no group assigned) = nothing.
        const scope = await this.getUserLedgerScope(opts.user);
        if (scope && scope.length === 0) {
            return {
                rows: [],
                totals: { bill_count: 0, total_due: 0, due_0_15: 0, due_16_30: 0, due_30_plus: 0 },
                asOf,
            };
        }
        const scopeSql = scope ? `WHERE c.ledgergroup IN (${scope.map(() => '?').join(',')})` : '';

        const rows = await this.db.query<any>(
            `WITH ranked AS (
                SELECT ba.id, ba.ledger, ba.billname, ba.amount, v.vch_date,
                       ROW_NUMBER() OVER (
                           PARTITION BY ba.ledger, ba.billname
                           ORDER BY v.vch_date ASC, ba.id ASC
                       ) AS rn
                FROM bill_allocation ba
                LEFT JOIN vch_details v ON ba.vchid = v.id
             ),
             bills AS (
                SELECT r.ledger,
                       r.billname,
                       SUM(r.amount) AS closing_balance,
                       MAX(CASE WHEN r.rn = 1 THEN r.vch_date END) AS bill_date
                FROM ranked r
                GROUP BY r.ledger, r.billname
                HAVING SUM(r.amount) > 0.01
             )
             SELECT COALESCE(u.name, cu.name, 'Unassigned')             AS user_name,
                    COUNT(b.billname)                                   AS bill_count,
                    COALESCE(SUM(b.closing_balance), 0)                 AS total_due,
                    COALESCE(SUM(CASE
                        WHEN DATEDIFF(COALESCE(?, CURDATE()), b.bill_date) <= 15
                        THEN b.closing_balance ELSE 0 END), 0)          AS due_0_15,
                    COALESCE(SUM(CASE
                        WHEN DATEDIFF(COALESCE(?, CURDATE()), b.bill_date) BETWEEN 16 AND 30
                        THEN b.closing_balance ELSE 0 END), 0)          AS due_16_30,
                    COALESCE(SUM(CASE
                        WHEN DATEDIFF(COALESCE(?, CURDATE()), b.bill_date) > 30
                        THEN b.closing_balance ELSE 0 END), 0)          AS due_30_plus
             FROM bills b
             INNER JOIN customer c ON b.ledger = c.id
             LEFT JOIN admin u       ON c.\`group\` = CAST(u.id AS CHAR)
             LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
             ${scopeSql}
             GROUP BY user_name
             ORDER BY total_due DESC, user_name ASC`,
            [asOf, asOf, asOf, ...(scope || [])],
        );

        const search = (opts.search || '').trim().toLowerCase();
        const data = rows
            .map((r: any) => ({
                user_name:    r.user_name,
                bill_count:   Number(r.bill_count) || 0,
                total_due:    +Number(r.total_due  || 0).toFixed(2),
                due_0_15:     +Number(r.due_0_15   || 0).toFixed(2),
                due_16_30:    +Number(r.due_16_30  || 0).toFixed(2),
                due_30_plus:  +Number(r.due_30_plus || 0).toFixed(2),
            }))
            .filter((u: any) => !search || u.user_name.toLowerCase().includes(search));

        const totals = data.reduce((acc, u) => ({
            bill_count:  acc.bill_count + u.bill_count,
            total_due:   acc.total_due + u.total_due,
            due_0_15:    acc.due_0_15 + u.due_0_15,
            due_16_30:   acc.due_16_30 + u.due_16_30,
            due_30_plus: acc.due_30_plus + u.due_30_plus,
        }), { bill_count: 0, total_due: 0, due_0_15: 0, due_16_30: 0, due_30_plus: 0 });

        return {
            rows: data,
            totals: {
                bill_count:  totals.bill_count,
                total_due:   +totals.total_due.toFixed(2),
                due_0_15:    +totals.due_0_15.toFixed(2),
                due_16_30:   +totals.due_16_30.toFixed(2),
                due_30_plus: +totals.due_30_plus.toFixed(2),
            },
            asOf,
        };
    }

    /** Stock Summary — opening / inward / outward / closing per item.
     *
     *  Opening qty/value comes from items.opening_qty + opening_value (set
     *  at item creation). Movement is summed from inventory_entries joined
     *  to ledger_entries → vch_details → vchtype, where deemed_positive
     *  classifies the voucher: YES (Sales / Debit Note) → outward,
     *  NO (Purchase / Credit Note) → inward.
     *
     *  Closing = opening + inward − outward (all in qty terms).
     *  Closing value uses the most recent inward rate — a pragmatic
     *  approximation in lieu of true FIFO/weighted-average costing. */
    /** Per-item opening/inward/outward/closing for the date window, including
     *  each item's own item_group_id — the shared building block behind the
     *  flat Stock Summary list AND the Group Summary-style drill-down below. */
    private async computeItemStockRows(opts: {
        dateFrom?: string;
        dateTo?: string;
    }) {
        // Movement aggregated per item over the date window.
        // Inward  = Purchase qty − Purchase Return qty
        // Outward = Sales qty    − Sales Return qty
        // A "return" vchtype is identified by its resolved name containing
        // "return" OR being "debit note" (purchase return) / "credit note"
        // (sales return). The parent name takes precedence when set.
        const where: string[] = [];
        const params: any[] = [];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        // Classification strategy (in priority order):
        //   1. If vchtype name is "Credit Note" → sales return (reduces outward)
        //   2. If vchtype name is "Debit Note"  → purchase return (reduces inward)
        //   3. If vchtype name contains "return" → use qty sign to pick inward/outward return
        //   4. qty > 0  → inward (purchase)
        //   4. qty < 0  → outward (sales)
        //   5. qty = 0, amount > 0 → inward (purchase receipt with no qty e.g. service)
        //   5. qty = 0, amount < 0 → outward (sales invoice with no qty)
        const movement = await this.db.query<any>(
            `SELECT ie.item_id,
                    -- resolved type name (parent beats child)
                    -- credit note → sales return; debit note → purchase return;
                    -- *return* in name → return of same direction as qty sign;
                    -- otherwise qty sign drives inward vs outward.

                    -- PURCHASE (inward, not a return)
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND COALESCE(ie.qty, ie.amount) >= 0
                          THEN ABS(ie.qty) ELSE 0 END)            AS purchase_qty,
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND COALESCE(ie.qty, ie.amount) >= 0
                          THEN ABS(ie.amount) ELSE 0 END)         AS purchase_value,

                    -- PURCHASE RETURN / DEBIT NOTE (reduces inward)
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%debit note%'
                            OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                AND COALESCE(ie.qty, ie.amount) >= 0)
                          THEN ABS(ie.qty) ELSE 0 END)            AS purchase_return_qty,
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%debit note%'
                            OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                AND COALESCE(ie.qty, ie.amount) >= 0)
                          THEN ABS(ie.amount) ELSE 0 END)         AS purchase_return_value,

                    -- SALES (outward, not a return)
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND COALESCE(ie.qty, ie.amount) < 0
                          THEN ABS(ie.qty) ELSE 0 END)            AS sales_qty,
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND COALESCE(ie.qty, ie.amount) < 0
                          THEN ABS(ie.amount) ELSE 0 END)         AS sales_value,

                    -- SALES RETURN / CREDIT NOTE (reduces outward)
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%credit note%'
                            OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                AND COALESCE(ie.qty, ie.amount) < 0)
                          THEN ABS(ie.qty) ELSE 0 END)            AS sales_return_qty,
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%credit note%'
                            OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                AND COALESCE(ie.qty, ie.amount) < 0)
                          THEN ABS(ie.amount) ELSE 0 END)         AS sales_return_value,

                    -- Fallback count: service items where qty=0 but amount exists
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND ie.qty = 0 AND ie.amount > 0
                          THEN 1 ELSE 0 END)                      AS purchase_count,
                    SUM(CASE
                          WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                           AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                           AND ie.qty = 0 AND ie.amount < 0
                          THEN 1 ELSE 0 END)                      AS sales_count,

                    MAX(CASE WHEN COALESCE(ie.qty, ie.amount) >= 0 THEN ABS(ie.rate) END) AS last_in_rate
             FROM inventory_entries ie
             INNER JOIN ledger_entries le ON ie.led_id = le.id
             INNER JOIN vch_details v ON le.vch_id = v.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
             ${whereSql}
             GROUP BY ie.item_id`,
            params,
        );
        const moveByItem = new Map<number, any>();
        for (const m of movement) moveByItem.set(Number(m.item_id), m);

        // Prior-period movement (before dateFrom) to compute true opening
        const priorMoveByItem = new Map<number, { qty: number; value: number }>();
        if (opts.dateFrom) {
            const priorMovement = await this.db.query<any>(
                `SELECT ie.item_id,
                        SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                               AND COALESCE(ie.qty, ie.amount) >= 0
                              THEN ABS(ie.qty) ELSE 0 END)
                      - SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%debit note%'
                                OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                    AND COALESCE(ie.qty, ie.amount) >= 0)
                              THEN ABS(ie.qty) ELSE 0 END)           AS net_inward_qty,
                        SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                               AND COALESCE(ie.qty, ie.amount) >= 0
                              THEN ABS(ie.amount) ELSE 0 END)
                      - SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%debit note%'
                                OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                    AND COALESCE(ie.qty, ie.amount) >= 0)
                              THEN ABS(ie.amount) ELSE 0 END)        AS net_inward_value,
                        SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                               AND COALESCE(ie.qty, ie.amount) < 0
                              THEN ABS(ie.qty) ELSE 0 END)
                      - SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%credit note%'
                                OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                    AND COALESCE(ie.qty, ie.amount) < 0)
                              THEN ABS(ie.qty) ELSE 0 END)           AS net_outward_qty,
                        SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%credit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%debit note%'
                               AND LOWER(COALESCE(p.name, vt.name, '')) NOT LIKE '%return%'
                               AND COALESCE(ie.qty, ie.amount) < 0
                              THEN ABS(ie.amount) ELSE 0 END)
                      - SUM(CASE
                              WHEN LOWER(COALESCE(p.name, vt.name, '')) LIKE '%credit note%'
                                OR (LOWER(COALESCE(p.name, vt.name, '')) LIKE '%return%'
                                    AND COALESCE(ie.qty, ie.amount) < 0)
                              THEN ABS(ie.amount) ELSE 0 END)        AS net_outward_value
                 FROM inventory_entries ie
                 INNER JOIN ledger_entries le ON ie.led_id = le.id
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
                 LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
                 WHERE v.vch_date < ?
                 GROUP BY ie.item_id`,
                [opts.dateFrom],
            );
            for (const m of priorMovement) {
                const netQty   = (Number(m.net_inward_qty)   || 0) - (Number(m.net_outward_qty)   || 0);
                const netValue = (Number(m.net_inward_value) || 0) - (Number(m.net_outward_value) || 0);
                priorMoveByItem.set(Number(m.item_id), { qty: netQty, value: netValue });
            }
        }

        // All items, even those with no movement — those just show their
        // opening as both opening and closing so the report is complete.
        const items = await this.db.query<any>(
            `SELECT i.id, i.item_name, i.gst, i.item_group_id, i.category_id,
                    COALESCE(i.opening_qty, 0)   AS opening_qty,
                    COALESCE(i.opening_rate, 0)  AS opening_rate,
                    COALESCE(i.opening_value, 0) AS opening_value,
                    ig.name                       AS group_name
             FROM items i
             LEFT JOIN item_groups ig ON i.item_group_id = ig.id
             ORDER BY i.item_name ASC`,
        );

        const data = items
            .map((i: any) => {
                const m = moveByItem.get(Number(i.id)) || {};
                const prior             = priorMoveByItem.get(Number(i.id)) || { qty: 0, value: 0 };
                const openingQty        = (Number(i.opening_qty)   || 0) + prior.qty;
                const openingValue      = (Number(i.opening_value) || 0) + prior.value;
                const purchaseValue     = Number(m.purchase_value)       || 0;
                const purchaseReturnVal = Number(m.purchase_return_value) || 0;
                const salesValue        = Number(m.sales_value)          || 0;
                const salesReturnVal    = Number(m.sales_return_value)   || 0;
                // When qty=0 but value exists (service items from Tally), use
                // purchase_count / sales_count as fallback qty (number of line items)
                const purchaseQty       = Number(m.purchase_qty)  || (purchaseValue > 0 ? Number(m.purchase_count)  || 0 : 0);
                const purchaseReturnQty = Number(m.purchase_return_qty) || 0;
                const salesQty          = Number(m.sales_qty)     || (salesValue    > 0 ? Number(m.sales_count)     || 0 : 0);
                const salesReturnQty    = Number(m.sales_return_qty)    || 0;
                // Net inward = Purchase − Purchase Return
                const inwardQty    = purchaseQty    - purchaseReturnQty;
                const inwardValue  = purchaseValue  - purchaseReturnVal;
                // Net outward = Sales − Sales Return
                const outwardQty   = salesQty       - salesReturnQty;
                const outwardValue = salesValue      - salesReturnVal;
                const closingQty   = openingQty + inwardQty - outwardQty;
                // Pick the most recent inward rate, then opening rate, then
                // average outward rate as a fallback for valuation.
                const valuationRate = Number(m.last_in_rate)
                    || Number(i.opening_rate)
                    || (outwardQty > 0 ? outwardValue / outwardQty : 0);
                const closingValue = +(closingQty * valuationRate).toFixed(2);
                return {
                    item_id:        i.id,
                    item_name:      i.item_name,
                    item_group_id:  i.item_group_id != null ? Number(i.item_group_id) : null,
                    category_id:    i.category_id   != null ? Number(i.category_id)   : null,
                    group_name:     i.group_name || null,
                    gst:            i.gst || null,
                    opening_qty:    +openingQty.toFixed(3),
                    opening_value:  +openingValue.toFixed(2),
                    inward_qty:     +inwardQty.toFixed(3),
                    inward_value:   +inwardValue.toFixed(2),
                    outward_qty:    +outwardQty.toFixed(3),
                    outward_value:  +outwardValue.toFixed(2),
                    closing_qty:    +closingQty.toFixed(3),
                    closing_value:  closingValue,
                };
            });

        return data;
    }

    /** Stock Summary — flat, searchable list of every item's movement. */
    async getStockSummary(opts: {
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const all = await this.computeItemStockRows(opts);
        const search = (opts.search || '').trim().toLowerCase();
        const data = all.filter((r) =>
            !search
            || r.item_name.toLowerCase().includes(search)
            || (r.group_name || '').toLowerCase().includes(search),
        );

        const totals = data.reduce((acc, r) => ({
            opening_value: acc.opening_value + r.opening_value,
            inward_value:  acc.inward_value  + r.inward_value,
            outward_value: acc.outward_value + r.outward_value,
            closing_value: acc.closing_value + r.closing_value,
        }), { opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

        return {
            rows: data,
            totals: {
                opening_value: +totals.opening_value.toFixed(2),
                inward_value:  +totals.inward_value.toFixed(2),
                outward_value: +totals.outward_value.toFixed(2),
                closing_value: +totals.closing_value.toFixed(2),
            },
        };
    }

    /** Stock Summary, Tally-style — root view: every top-level item group
     *  (walking each item up to its true root ancestor) with rolled-up
     *  opening/inward/outward/closing across all descendant items. Mirrors
     *  getGroupSummary()'s approach for ledger groups. */
    async getStockGroupSummary(opts: {
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const allGroups = await this.db.query<any>(`SELECT id, name, parent_id FROM item_groups`);
        const groupMap = new Map<number, { id: number; name: string; parent_id: number | null }>();
        for (const g of allGroups) groupMap.set(Number(g.id), { id: Number(g.id), name: g.name, parent_id: g.parent_id != null ? Number(g.parent_id) : null });

        const rootOf = (gid: number): { id: number; name: string } => {
            let cur = groupMap.get(gid);
            if (!cur) return { id: gid, name: 'Ungrouped' };
            const visited = new Set<number>();
            while (cur.parent_id != null && !visited.has(cur.id)) {
                visited.add(cur.id);
                const parent = groupMap.get(cur.parent_id);
                if (!parent) break;
                cur = parent;
            }
            return { id: cur.id, name: cur.name };
        };

        const items = await this.computeItemStockRows(opts);

        const byRoot = new Map<number, { name: string; item_count: number; opening_qty: number; opening_value: number; inward_qty: number; inward_value: number; outward_qty: number; outward_value: number; closing_qty: number; closing_value: number }>();
        for (const it of items) {
            const root = it.item_group_id != null ? rootOf(it.item_group_id) : { id: -1, name: 'Ungrouped' };
            if (!byRoot.has(root.id)) byRoot.set(root.id, { name: root.name, item_count: 0, opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_value: 0 });
            const b = byRoot.get(root.id)!;
            b.item_count    += 1;
            b.opening_qty   += it.opening_qty;
            b.opening_value += it.opening_value;
            b.inward_qty    += it.inward_qty;
            b.inward_value  += it.inward_value;
            b.outward_qty   += it.outward_qty;
            b.outward_value += it.outward_value;
            b.closing_qty   += it.closing_qty;
            b.closing_value += it.closing_value;
        }

        const search = (opts.search || '').trim().toLowerCase();
        const data = Array.from(byRoot.entries())
            .map(([gid, b]) => ({
                group_id:      gid,
                group_name:    b.name,
                item_count:    b.item_count,
                opening_qty:   +b.opening_qty.toFixed(3),
                opening_value: +b.opening_value.toFixed(2),
                inward_qty:    +b.inward_qty.toFixed(3),
                inward_value:  +b.inward_value.toFixed(2),
                outward_qty:   +b.outward_qty.toFixed(3),
                outward_value: +b.outward_value.toFixed(2),
                closing_qty:   +b.closing_qty.toFixed(3),
                closing_value: +b.closing_value.toFixed(2),
            }))
            .filter((g) => !search || g.group_name.toLowerCase().includes(search))
            .sort((a, b) => a.group_name.localeCompare(b.group_name));

        const totals = data.reduce((acc, g) => ({
            opening_value: acc.opening_value + g.opening_value,
            inward_value:  acc.inward_value  + g.inward_value,
            outward_value: acc.outward_value + g.outward_value,
            closing_value: acc.closing_value + g.closing_value,
        }), { opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

        return {
            rows: data,
            totals: {
                opening_value: +totals.opening_value.toFixed(2),
                inward_value:  +totals.inward_value.toFixed(2),
                outward_value: +totals.outward_value.toFixed(2),
                closing_value: +totals.closing_value.toFixed(2),
            },
        };
    }

    /** Stock Summary drill-down — immediate sub-groups (each rolled up) plus
     *  items directly assigned to this group. Mirrors getGroupLedgers(). */
    async getStockGroupItems(opts: {
        groupId: number;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        // group_id = -1 is the synthetic "Ungrouped" bucket used at root for
        // items with no item_group_id — there's no real item_groups row for
        // it, it has no sub-groups, and its items match on IS NULL, not -1.
        const isUngrouped = opts.groupId === -1;
        const group = isUngrouped
            ? { id: -1, name: 'Ungrouped', parent_id: null }
            : await this.db.queryOne<any>(`SELECT id, name, parent_id FROM item_groups WHERE id = ?`, [opts.groupId]);
        const childGroups = isUngrouped
            ? []
            : await this.db.query<any>(`SELECT id, name FROM item_groups WHERE parent_id = ? ORDER BY name ASC`, [opts.groupId]);

        const items = await this.computeItemStockRows({ dateFrom: opts.dateFrom, dateTo: opts.dateTo });

        const subGroupRows = childGroups.map((cg: any) => {
            const inGroup = items.filter(it => it.item_group_id === Number(cg.id));
            const agg = inGroup.reduce((acc, it) => ({
                opening_qty: acc.opening_qty + it.opening_qty, opening_value: acc.opening_value + it.opening_value,
                inward_qty:  acc.inward_qty  + it.inward_qty,  inward_value:  acc.inward_value  + it.inward_value,
                outward_qty: acc.outward_qty + it.outward_qty, outward_value: acc.outward_value + it.outward_value,
                closing_qty: acc.closing_qty + it.closing_qty, closing_value: acc.closing_value + it.closing_value,
            }), { opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_value: 0 });
            return {
                row_type: 'subgroup' as const,
                item_id: null, group_id: cg.id, item_name: cg.name, item_count: inGroup.length,
                opening_qty: +agg.opening_qty.toFixed(3), opening_value: +agg.opening_value.toFixed(2),
                inward_qty:  +agg.inward_qty.toFixed(3),  inward_value:  +agg.inward_value.toFixed(2),
                outward_qty: +agg.outward_qty.toFixed(3), outward_value: +agg.outward_value.toFixed(2),
                closing_qty: +agg.closing_qty.toFixed(3), closing_value: +agg.closing_value.toFixed(2),
            };
        });

        const search = (opts.search || '').trim().toLowerCase();
        const itemRows = items
            .filter(it => isUngrouped ? it.item_group_id == null : it.item_group_id === opts.groupId)
            .filter(it => !search || it.item_name.toLowerCase().includes(search))
            .map(it => ({
                row_type: 'item' as const,
                item_id: it.item_id, group_id: null, item_name: it.item_name, item_count: null,
                opening_qty: it.opening_qty, opening_value: it.opening_value,
                inward_qty:  it.inward_qty,  inward_value:  it.inward_value,
                outward_qty: it.outward_qty, outward_value: it.outward_value,
                closing_qty: it.closing_qty, closing_value: it.closing_value,
            }));

        const allRows = [...subGroupRows, ...itemRows];
        const totals = allRows.reduce((acc, r) => ({
            opening_value: acc.opening_value + r.opening_value,
            inward_value:  acc.inward_value  + r.inward_value,
            outward_value: acc.outward_value + r.outward_value,
            closing_value: acc.closing_value + r.closing_value,
        }), { opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

        return {
            group: group || { id: opts.groupId, name: 'Unknown' },
            rows: allRows,
            totals: {
                opening_value: +totals.opening_value.toFixed(2),
                inward_value:  +totals.inward_value.toFixed(2),
                outward_value: +totals.outward_value.toFixed(2),
                closing_value: +totals.closing_value.toFixed(2),
            },
        };
    }

    /** Stock Summary, by Category — root view: every top-level item category
     *  (walking each item up to its true root ancestor category) with
     *  rolled-up movement. Item categories are an independent hierarchy from
     *  item groups (a separate "by what kind of thing" cut vs "by what
     *  group it's filed under"), so this mirrors getStockGroupSummary()
     *  exactly but keyed on item_categories / category_id. */
    async getStockCategorySummary(opts: {
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const allCats = await this.db.query<any>(`SELECT id, name, parent_id FROM item_categories`);
        const catMap = new Map<number, { id: number; name: string; parent_id: number | null }>();
        for (const c of allCats) catMap.set(Number(c.id), { id: Number(c.id), name: c.name, parent_id: c.parent_id != null ? Number(c.parent_id) : null });

        const rootOf = (cid: number): { id: number; name: string } => {
            let cur = catMap.get(cid);
            if (!cur) return { id: cid, name: 'Uncategorized' };
            const visited = new Set<number>();
            while (cur.parent_id != null && !visited.has(cur.id)) {
                visited.add(cur.id);
                const parent = catMap.get(cur.parent_id);
                if (!parent) break;
                cur = parent;
            }
            return { id: cur.id, name: cur.name };
        };

        const items = await this.computeItemStockRows(opts);

        const byRoot = new Map<number, { name: string; item_count: number; opening_qty: number; opening_value: number; inward_qty: number; inward_value: number; outward_qty: number; outward_value: number; closing_qty: number; closing_value: number }>();
        for (const it of items) {
            const root = it.category_id != null ? rootOf(it.category_id) : { id: -1, name: 'Uncategorized' };
            if (!byRoot.has(root.id)) byRoot.set(root.id, { name: root.name, item_count: 0, opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_value: 0 });
            const b = byRoot.get(root.id)!;
            b.item_count    += 1;
            b.opening_qty   += it.opening_qty;
            b.opening_value += it.opening_value;
            b.inward_qty    += it.inward_qty;
            b.inward_value  += it.inward_value;
            b.outward_qty   += it.outward_qty;
            b.outward_value += it.outward_value;
            b.closing_qty   += it.closing_qty;
            b.closing_value += it.closing_value;
        }

        const search = (opts.search || '').trim().toLowerCase();
        const data = Array.from(byRoot.entries())
            .map(([cid, b]) => ({
                group_id:      cid,
                group_name:    b.name,
                item_count:    b.item_count,
                opening_qty:   +b.opening_qty.toFixed(3),
                opening_value: +b.opening_value.toFixed(2),
                inward_qty:    +b.inward_qty.toFixed(3),
                inward_value:  +b.inward_value.toFixed(2),
                outward_qty:   +b.outward_qty.toFixed(3),
                outward_value: +b.outward_value.toFixed(2),
                closing_qty:   +b.closing_qty.toFixed(3),
                closing_value: +b.closing_value.toFixed(2),
            }))
            .filter((g) => !search || g.group_name.toLowerCase().includes(search))
            .sort((a, b) => a.group_name.localeCompare(b.group_name));

        const totals = data.reduce((acc, g) => ({
            opening_value: acc.opening_value + g.opening_value,
            inward_value:  acc.inward_value  + g.inward_value,
            outward_value: acc.outward_value + g.outward_value,
            closing_value: acc.closing_value + g.closing_value,
        }), { opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

        return {
            rows: data,
            totals: {
                opening_value: +totals.opening_value.toFixed(2),
                inward_value:  +totals.inward_value.toFixed(2),
                outward_value: +totals.outward_value.toFixed(2),
                closing_value: +totals.closing_value.toFixed(2),
            },
        };
    }

    /** Stock Summary by Category — drill-down. Mirrors getStockGroupItems(). */
    async getStockCategoryItems(opts: {
        groupId: number;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const isUncategorized = opts.groupId === -1;
        const group = isUncategorized
            ? { id: -1, name: 'Uncategorized', parent_id: null }
            : await this.db.queryOne<any>(`SELECT id, name, parent_id FROM item_categories WHERE id = ?`, [opts.groupId]);
        const childCats = isUncategorized
            ? []
            : await this.db.query<any>(`SELECT id, name FROM item_categories WHERE parent_id = ? ORDER BY name ASC`, [opts.groupId]);

        const items = await this.computeItemStockRows({ dateFrom: opts.dateFrom, dateTo: opts.dateTo });

        const subGroupRows = childCats.map((cg: any) => {
            const inCat = items.filter(it => it.category_id === Number(cg.id));
            const agg = inCat.reduce((acc, it) => ({
                opening_qty: acc.opening_qty + it.opening_qty, opening_value: acc.opening_value + it.opening_value,
                inward_qty:  acc.inward_qty  + it.inward_qty,  inward_value:  acc.inward_value  + it.inward_value,
                outward_qty: acc.outward_qty + it.outward_qty, outward_value: acc.outward_value + it.outward_value,
                closing_qty: acc.closing_qty + it.closing_qty, closing_value: acc.closing_value + it.closing_value,
            }), { opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0, outward_qty: 0, outward_value: 0, closing_qty: 0, closing_value: 0 });
            return {
                row_type: 'subgroup' as const,
                item_id: null, group_id: cg.id, item_name: cg.name, item_count: inCat.length,
                opening_qty: +agg.opening_qty.toFixed(3), opening_value: +agg.opening_value.toFixed(2),
                inward_qty:  +agg.inward_qty.toFixed(3),  inward_value:  +agg.inward_value.toFixed(2),
                outward_qty: +agg.outward_qty.toFixed(3), outward_value: +agg.outward_value.toFixed(2),
                closing_qty: +agg.closing_qty.toFixed(3), closing_value: +agg.closing_value.toFixed(2),
            };
        });

        const search = (opts.search || '').trim().toLowerCase();
        const itemRows = items
            .filter(it => isUncategorized ? it.category_id == null : it.category_id === opts.groupId)
            .filter(it => !search || it.item_name.toLowerCase().includes(search))
            .map(it => ({
                row_type: 'item' as const,
                item_id: it.item_id, group_id: null, item_name: it.item_name, item_count: null,
                opening_qty: it.opening_qty, opening_value: it.opening_value,
                inward_qty:  it.inward_qty,  inward_value:  it.inward_value,
                outward_qty: it.outward_qty, outward_value: it.outward_value,
                closing_qty: it.closing_qty, closing_value: it.closing_value,
            }));

        const allRows = [...subGroupRows, ...itemRows];
        const totals = allRows.reduce((acc, r) => ({
            opening_value: acc.opening_value + r.opening_value,
            inward_value:  acc.inward_value  + r.inward_value,
            outward_value: acc.outward_value + r.outward_value,
            closing_value: acc.closing_value + r.closing_value,
        }), { opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

        return {
            group: group || { id: opts.groupId, name: 'Unknown' },
            rows: allRows,
            totals: {
                opening_value: +totals.opening_value.toFixed(2),
                inward_value:  +totals.inward_value.toFixed(2),
                outward_value: +totals.outward_value.toFixed(2),
                closing_value: +totals.closing_value.toFixed(2),
            },
        };
    }

    /** Outstanding bills — one row per (ledger, billname) from bill_allocation.
     *  Opening = the FIRST allocation entry's amount (the "New" transaction
     *  that opened the bill — its original face value). Closing = the net
     *  remaining after all subsequent allocations (payments / Agst entries).
     *  Bills with zero closing are excluded.
     *
     *  Filters:
     *  - dateTo / asOf:  upper bound on allocations included in the netting,
     *                    i.e. "outstanding as of this date". Allocations after
     *                    this date are ignored (treated as future activity).
     *  - dateFrom:       narrows the LIST to bills opened on/after this date
     *                    (applied to the opening row's bill_date in the outer
     *                    HAVING). Critically, NOT applied inside the CTE —
     *                    if it filtered the netting we'd hide opening rows
     *                    older than dateFrom and report a fully-paid bill as
     *                    a phantom outstanding (only the payment side would
     *                    sum). Bills opened earlier and still unpaid are
     *                    surfaced when dateFrom is omitted.
     *  - billName:       substring match on ba.billname.
     *  - search:         substring match on party (customer.company). */
    async getOutstanding(opts: {
        asOf?: string;
        dateFrom?: string;
        dateTo?: string;
        billName?: string;
        search?: string;
        side?: 'receivable' | 'payable' | 'all';
        user?: ScopedUser;
    }) {
        const where: string[] = [];
        const params: any[] = [];
        const upperBound = opts.dateTo || opts.asOf;
        // Inside the CTE we only cap by upperBound. dateFrom is applied AFTER
        // aggregation so a fully-settled bill (sum=0) cleanly drops out
        // regardless of how the user picked their date window.
        if (upperBound)    { where.push('COALESCE(v.vch_date, ba.bill_date) <= ?'); params.push(upperBound); }
        if (opts.billName) { where.push('ba.billname LIKE ?'); params.push(`%${opts.billName}%`); }
        if (opts.search)   { where.push('c.company LIKE ?');   params.push(`%${opts.search}%`); }
        // Ledger-group-scoped users only see bills of parties inside their
        // assigned group subtree. Empty scope (no group assigned) = nothing.
        const scope = await this.getUserLedgerScope(opts.user);
        if (scope) {
            if (scope.length === 0) {
                return { bills: [], totalReceivable: 0, totalPayable: 0, asOf: opts.asOf || null };
            }
            where.push(`c.ledgergroup IN (${scope.map(() => '?').join(',')})`);
            params.push(...scope);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const havingClauses = ['ABS(SUM(r.amount)) >= 0.01'];
        const havingParams: any[] = [];
        if (opts.dateFrom) {
            havingClauses.push('MAX(CASE WHEN r.rn = 1 THEN r.vch_date END) >= ?');
            havingParams.push(opts.dateFrom);
        }
        const havingSql = `HAVING ${havingClauses.join(' AND ')}`;

        // ROW_NUMBER over (ledger, billname) ordered by effective date then
        // id lets the outer aggregation pluck the first allocation as the
        // opening face value. Subsequent payments / Agst rows reduce it.
        // Opening-balance rows live with vchid=NULL — their date comes from
        // ba.bill_date, picked up via COALESCE.
        const rows = await this.db.query<any>(
            `WITH ranked AS (
                SELECT ba.id, ba.ledger, ba.billname, ba.amount,
                       COALESCE(v.vch_date, ba.bill_date) AS vch_date,
                       c.company AS party_name,
                       COALESCE(u.name, cu.name) AS group_name,
                       r.name AS reseller_name,
                       ROW_NUMBER() OVER (
                           PARTITION BY ba.ledger, ba.billname
                           ORDER BY COALESCE(v.vch_date, ba.bill_date) ASC, ba.id ASC
                       ) AS rn
                FROM bill_allocation ba
                LEFT JOIN vch_details v ON ba.vchid = v.id
                LEFT JOIN customer c ON ba.ledger = c.id
                LEFT JOIN admin u ON c.\`group\` = CAST(u.id AS CHAR)
                LEFT JOIN cloud_users cu ON c.cloud_group_id = cu.id
                LEFT JOIN reseller r ON c.resellerid = r.id
                ${whereSql}
             )
             SELECT r.ledger                              AS ledger_id,
                    r.party_name                          AS party_name,
                    MAX(r.group_name)                     AS group_name,
                    MAX(r.reseller_name)                  AS reseller_name,
                    r.billname                            AS bill_name,
                    MAX(CASE WHEN r.rn = 1 THEN r.amount   END) AS opening_amount,
                    MAX(CASE WHEN r.rn = 1 THEN r.vch_date END) AS bill_date,
                    SUM(r.amount)                         AS closing_balance,
                    MAX(r.vch_date)                       AS last_activity,
                    DATEDIFF(
                        COALESCE(?, CURDATE()),
                        MAX(CASE WHEN r.rn = 1 THEN r.vch_date END)
                    ) AS age_days
             FROM ranked r
             GROUP BY r.ledger, r.party_name, r.billname
             ${havingSql}
             ORDER BY MAX(CASE WHEN r.rn = 1 THEN r.vch_date END) ASC, r.party_name ASC`,
            [...params, upperBound || null, ...havingParams],
        );

        // Latest payment-followup logged per (ledger, bill), if any.
        const followupRows = await this.db.query<any>(
            `SELECT ledger_id, bill_name, status, person_name, phone_number, next_date, remark FROM bill_followup`,
        );
        const followupByKey = new Map<string, any>();
        for (const f of followupRows) followupByKey.set(`${f.ledger_id}::${f.bill_name}`, f);

        // How many times each bill has been followed up (full interaction log).
        const followupCountRows = await this.db.query<any>(
            `SELECT ledger_id, bill_name, COUNT(*) AS cnt FROM bill_followup_history GROUP BY ledger_id, bill_name`,
        ).catch(() => [] as any[]);
        const followupCountByKey = new Map<string, number>();
        for (const f of followupCountRows) followupCountByKey.set(`${f.ledger_id}::${f.bill_name}`, Number(f.cnt) || 0);

        // Each customer's primary contact (same "primary_contact='Yes' wins,
        // else earliest" rule used across the CRM) — used as the followup
        // modal's default Person Name/Number when no bill-specific one has
        // been logged yet, so it's never blank on first open.
        const contactRows = await this.db.query<any>(
            `SELECT c.id AS customer_id, ccd.contact_person, COALESCE(ccd.mobile_no, c.mobile) AS mobile
             FROM customer c
             LEFT JOIN (
                 SELECT customer_id, mobile_id,
                        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY CASE WHEN primary_contact = 'Yes' THEN 0 ELSE 1 END, id) AS rn
                 FROM customer_contact_mapping_data
                 WHERE status = 'Active'
             ) prim_ccm ON c.id = prim_ccm.customer_id AND prim_ccm.rn = 1
             LEFT JOIN customer_contact_details ccd ON prim_ccm.mobile_id = ccd.id`,
        );
        const contactByCustomer = new Map<number, { person: string | null; mobile: string | null }>();
        for (const c of contactRows) contactByCustomer.set(Number(c.customer_id), {
            person: c.contact_person || null, mobile: c.mobile || null,
        });

        // Every active contact linked to a customer (not just the primary
        // one) — lets the followup modal offer a full dropdown of everyone
        // on file for that party, instead of only the single default.
        const allContactRows = await this.db.query<any>(
            `SELECT ccm.customer_id, ccd.contact_person, ccd.mobile_no, ccm.primary_contact
             FROM customer_contact_mapping_data ccm
             JOIN customer_contact_details ccd ON ccm.mobile_id = ccd.id
             WHERE ccm.status = 'Active' AND ccd.mobile_no IS NOT NULL AND ccd.mobile_no != ''
             ORDER BY CASE WHEN ccm.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccm.id`,
        );
        const allContactsByCustomer = new Map<number, { person: string | null; mobile: string; is_primary: boolean }[]>();
        for (const c of allContactRows) {
            const cid = Number(c.customer_id);
            if (!allContactsByCustomer.has(cid)) allContactsByCustomer.set(cid, []);
            allContactsByCustomer.get(cid)!.push({ person: c.contact_person || null, mobile: c.mobile_no, is_primary: c.primary_contact === 'Yes' });
        }

        const sideFilter = opts.side || 'all';
        const bills = rows
            .map((b: any) => {
                const followup = followupByKey.get(`${b.ledger_id}::${b.bill_name || ''}`);
                const contact = contactByCustomer.get(Number(b.ledger_id));
                return {
                    ledger_id: b.ledger_id,
                    party_name: b.party_name || 'Unallocated',
                    group_name: b.group_name || null,
                    reseller_name: b.reseller_name || null,
                    bill_name: b.bill_name || '—',
                    bill_date: b.bill_date,
                    last_activity: b.last_activity,
                    age_days: Number(b.age_days) || 0,
                    // Opening = absolute face value of the first transaction.
                    // Closing keeps its sign so the UI can render Dr / Cr.
                    opening_balance: +Math.abs(Number(b.opening_amount || 0)).toFixed(2),
                    closing_balance: +Number(b.closing_balance || 0).toFixed(2),
                    followup_status: followup?.status || null,
                    followup_person: followup?.person_name || null,
                    followup_phone:  followup?.phone_number || null,
                    followup_next_date: followup?.next_date || null,
                    followup_remark: followup?.remark || null,
                    followup_count: followupCountByKey.get(`${b.ledger_id}::${b.bill_name || ''}`) || 0,
                    customer_person: contact?.person || null,
                    customer_mobile: contact?.mobile || null,
                    all_contacts: allContactsByCustomer.get(Number(b.ledger_id)) || [],
                };
            })
            .filter((b: any) => {
                if (sideFilter === 'receivable') return b.closing_balance > 0;
                if (sideFilter === 'payable')    return b.closing_balance < 0;
                return true;
            });

        const totalReceivable = +bills.reduce((s, b) => s + (b.closing_balance > 0 ? b.closing_balance : 0), 0).toFixed(2);
        const totalPayable    = +bills.reduce((s, b) => s + (b.closing_balance < 0 ? Math.abs(b.closing_balance) : 0), 0).toFixed(2);

        return { bills, totalReceivable, totalPayable, asOf: opts.asOf || null };
    }

    /** Save (or update) the payment-followup contact/next-date/remark for
     *  one outstanding bill. Overwrites the current state for that
     *  (ledger, bill) pair — same "latest state only" model as the Tally
     *  expiry-call update. */
    async upsertBillFollowup(opts: {
        ledgerId: number;
        billName: string;
        status?: string | null;
        personName?: string | null;
        phoneNumber?: string | null;
        nextDate?: string | null;
        remark?: string | null;
        updatedBy?: string | null;
    }) {
        await this.db.execute(
            `INSERT INTO bill_followup (ledger_id, bill_name, status, person_name, phone_number, next_date, remark, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                person_name = VALUES(person_name),
                phone_number = VALUES(phone_number),
                next_date = VALUES(next_date),
                remark = VALUES(remark),
                updated_by = VALUES(updated_by)`,
            [
                opts.ledgerId, opts.billName, opts.status || null,
                opts.personName || null, opts.phoneNumber || null,
                opts.nextDate || null, opts.remark || null,
                opts.updatedBy || null,
            ],
        );
        // Append to the interaction log — this is what drives the visible
        // "how many times was this bill chased" count. Fail-soft: the
        // latest-state upsert above is the primary write.
        await this.db.execute(
            `INSERT INTO bill_followup_history (ledger_id, bill_name, status, person_name, phone_number, next_date, remark, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                opts.ledgerId, opts.billName, opts.status || null,
                opts.personName || null, opts.phoneNumber || null,
                opts.nextDate || null, opts.remark || null,
                opts.updatedBy || null,
            ],
        ).catch(() => {});
        return { success: true };
    }

    /** Full interaction log for one outstanding bill, newest first. */
    async getBillFollowupHistory(ledgerId: number, billName: string) {
        return this.db.query<any>(
            `SELECT status, person_name, phone_number, next_date, remark, updated_by, created_at
             FROM bill_followup_history
             WHERE ledger_id = ? AND bill_name = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 200`,
            [ledgerId, billName],
        );
    }

    /** Tally-style ledger statement for a single ledger.
     *  Each row = one voucher hitting the ledger. The PARTICULARS column
     *  intentionally excludes the queried ledger (you wouldn't write
     *  "ABC Customer" as the particulars on ABC Customer's own statement)
     *  — instead it lists the contra ledgers paired with this entry.
     *  Returns opening + closing balance plus the row list within the date range. */
    async getLedgerStatement(opts: {
        ledgerId: number;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
        user?: ScopedUser;
    }) {
        const ledger = await this.db.queryOne<any>(
            `SELECT id, company, ledgergroup, opening_balance, opening_balance_type FROM customer WHERE id = ?`,
            [opts.ledgerId],
        );
        if (!ledger) {
            return { ledger: null, opening: 0, closing: 0, rows: [] };
        }

        // Ledger-group-scoped users can only open statements for ledgers
        // inside their assigned group subtree.
        const scope = await this.getUserLedgerScope(opts.user);
        if (scope && !scope.includes(Number(ledger.ledgergroup))) {
            throw new ForbiddenException('This ledger is outside your assigned ledger group.');
        }

        // Master opening = customer.opening_balance (signed by Dr/Cr).
        const masterOpening = +(Number(ledger.opening_balance || 0) *
            (ledger.opening_balance_type === 'Cr' ? -1 : 1)).toFixed(2);

        // Activity strictly before dateFrom rolls into the period opening.
        let priorActivity = 0;
        if (opts.dateFrom) {
            const r = await this.db.queryOne<any>(
                `SELECT COALESCE(SUM(le.amount), 0) AS total
                 FROM ledger_entries le
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 WHERE le.ledger_id = ? AND v.vch_date < ?`,
                [opts.ledgerId, opts.dateFrom],
            );
            priorActivity = Number(r?.total || 0);
        }
        const opening = +(masterOpening + priorActivity).toFixed(2);

        // Rows in range. Particulars = GROUP_CONCAT of contra ledger names
        // (every entry on the same voucher except the queried one).
        const where: string[] = ['le.ledger_id = ?'];
        const params: any[] = [opts.ledgerId];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        if (opts.search) {
            where.push('(v.vch_no LIKE ? OR v.remark LIKE ?)');
            params.push(`%${opts.search}%`, `%${opts.search}%`);
        }

        // ONE row per voucher. Particulars uses Tally convention:
        //   - If the queried ledger is the FIRST ledger_entry on this voucher
        //     (lowest le.id), show the SECOND entry's ledger name.
        //   - Otherwise show the FIRST entry's ledger name.
        // ROW_NUMBER ranks all ledger_entries per voucher by id; we then
        // pick rn=1 / rn=2 via LEFT JOINs on a CTE.
        const rowsRaw = await this.db.query<any>(
            `WITH ranked AS (
                SELECT le.id, le.vch_id, le.ledger_id, le.amount,
                       c.company AS ledger_name,
                       ROW_NUMBER() OVER (PARTITION BY le.vch_id ORDER BY le.id ASC) AS rn
                FROM ledger_entries le
                LEFT JOIN customer c ON le.ledger_id = c.id
             )
             SELECT v.id                                             AS vch_id,
                    v.vch_no,
                    v.vch_date,
                    v.remark,
                    COALESCE(p.name, vt.name)                        AS vch_type_name,
                    vt.name                                          AS vch_subtype_name,
                    party_le.amount                                  AS party_amount,
                    party_le.id                                      AS party_le_id,
                    first_le.id                                      AS first_le_id,
                    -- Goods-name fallback for orphan NULL-ledger rows.
                    CONVERT(
                        COALESCE(
                            first_le.ledger_name,
                            CASE
                                WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'YES' THEN 'Sales'
                                WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'NO'  THEN 'Purchase'
                                ELSE 'Goods'
                            END
                        )
                        USING latin1
                    )                                                AS first_ledger_name,
                    CONVERT(
                        COALESCE(
                            second_le.ledger_name,
                            CASE
                                WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'YES' THEN 'Sales'
                                WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'NO'  THEN 'Purchase'
                                ELSE 'Goods'
                            END
                        )
                        USING latin1
                    )                                                AS second_ledger_name,
                    (SELECT GROUP_CONCAT(DISTINCT ba.billname SEPARATOR ', ')
                       FROM bill_allocation ba
                       WHERE ba.vchid = v.id AND ba.ledger = party_le.ledger_id
                    )                                                AS bill_names
             FROM ledger_entries party_le
             INNER JOIN vch_details v ON party_le.vch_id = v.id
             LEFT JOIN ranked first_le  ON first_le.vch_id = v.id AND first_le.rn = 1
             LEFT JOIN ranked second_le ON second_le.vch_id = v.id AND second_le.rn = 2
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             WHERE ${where.map(w => w.replace('le.', 'party_le.')).join(' AND ')}
             ORDER BY v.vch_date ASC, v.id ASC`,
            params,
        );

        // Walk vouchers; running balance steps by the party amount per row.
        let running = opening;
        const data = rowsRaw.map((r: any) => {
            const partyAmt = Number(r.party_amount || 0);
            const debit  = partyAmt > 0 ?  +partyAmt.toFixed(2) : 0;
            const credit = partyAmt < 0 ? +Math.abs(partyAmt).toFixed(2) : 0;
            running = +(running + debit - credit).toFixed(2);
            // Tally rule: if this party row IS the first ledger entry, show
            // the second entry as the contra; otherwise show the first one.
            const isFirstEntry = r.party_le_id != null && r.party_le_id === r.first_le_id;
            const contraName = isFirstEntry
                ? (r.second_ledger_name || '—')
                : (r.first_ledger_name  || '—');
            return {
                vch_id: r.vch_id,
                vch_no: r.vch_no,
                vch_date: r.vch_date,
                vch_type_name: r.vch_type_name,
                vch_subtype_name: r.vch_subtype_name,
                is_first: true,
                is_last: true,
                remark: r.remark,
                // Particulars = the contra ledger name only. The voucher
                // number lives in its own VCH NO. column, so prefixing
                // bill names here just duplicates information.
                particulars: contraName,
                debit,
                credit,
                running_balance: running,
            };
        });

        const totalDebit  = +data.reduce((s, r) => s + r.debit, 0).toFixed(2);
        const totalCredit = +data.reduce((s, r) => s + r.credit, 0).toFixed(2);
        const closing = +running.toFixed(2);

        return {
            ledger: { id: ledger.id, company: ledger.company },
            opening,
            closing,
            totalDebit,
            totalCredit,
            rows: data,
        };
    }

    /** Classify one inventory_entries row the same way computeItemStockRows
     *  classifies aggregates (credit note → sales return; debit note →
     *  purchase return; "return" in the name → return matching the qty
     *  sign; otherwise qty sign picks purchase vs sale) — kept in sync with
     *  that method so the item voucher register and the summary totals it
     *  drills from always agree. */
    private classifyInventoryRow(vchTypeName: string | null, qty: number, amount: number): 'purchase' | 'purchase_return' | 'sales' | 'sales_return' {
        const t = (vchTypeName || '').toLowerCase();
        const sign = qty !== 0 ? qty : amount;
        const isCreditNote = t.includes('credit note');
        const isDebitNote  = t.includes('debit note');
        const isReturnWord = t.includes('return');
        if (isDebitNote || (isReturnWord && sign >= 0)) return 'purchase_return';
        if (isCreditNote || (isReturnWord && sign < 0)) return 'sales_return';
        if (sign >= 0) return 'purchase';
        return 'sales';
    }

    /** Stock item voucher register — Tally-style drill-down from a Stock
     *  Summary row: one row per voucher that moved this item, in date
     *  order, with a running opening/inward/outward/closing balance (qty
     *  and value) so each row shows the balance immediately before and
     *  after that transaction — same idea as getLedgerStatement() but for
     *  item quantity/value instead of a ledger's Dr/Cr balance. */
    async getItemVoucherRegister(opts: {
        itemId: number;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
    }) {
        const item = await this.db.queryOne<any>(
            `SELECT i.id, i.item_name,
                    COALESCE(i.opening_qty, 0)   AS opening_qty,
                    COALESCE(i.opening_value, 0) AS opening_value
             FROM items i WHERE i.id = ?`, [opts.itemId],
        );
        if (!item) return { item: null, opening: { qty: 0, value: 0 }, closing: { qty: 0, value: 0 }, rows: [] };

        // Prior movement (before dateFrom) nets into the opening balance,
        // same as computeItemStockRows' priorMoveByItem.
        let priorQty = 0, priorValue = 0;
        if (opts.dateFrom) {
            const priorRows = await this.db.query<any>(
                `SELECT ie.qty, ie.amount, COALESCE(p.name, vt.name, '') AS vch_type_name
                 FROM inventory_entries ie
                 INNER JOIN ledger_entries le ON ie.led_id = le.id
                 INNER JOIN vch_details v ON le.vch_id = v.id
                 LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
                 LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
                 WHERE ie.item_id = ? AND v.vch_date < ?`,
                [opts.itemId, opts.dateFrom],
            );
            for (const r of priorRows) {
                const qty = Number(r.qty) || 0;
                const amt = Number(r.amount) || 0;
                const cat = this.classifyInventoryRow(r.vch_type_name, qty, amt);
                if (cat === 'purchase')             { priorQty += Math.abs(qty); priorValue += Math.abs(amt); }
                else if (cat === 'purchase_return') { priorQty -= Math.abs(qty); priorValue -= Math.abs(amt); }
                else if (cat === 'sales')            { priorQty -= Math.abs(qty); priorValue -= Math.abs(amt); }
                else                                  { priorQty += Math.abs(qty); priorValue += Math.abs(amt); } // sales_return
            }
        }
        const openingQty   = +((Number(item.opening_qty)   || 0) + priorQty).toFixed(3);
        const openingValue = +((Number(item.opening_value) || 0) + priorValue).toFixed(2);

        const where: string[] = ['ie.item_id = ?'];
        const params: any[] = [opts.itemId];
        if (opts.dateFrom) { where.push('v.vch_date >= ?'); params.push(opts.dateFrom); }
        if (opts.dateTo)   { where.push('v.vch_date <= ?'); params.push(opts.dateTo); }
        if (opts.search)   { where.push('(v.vch_no LIKE ? OR c.company LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`); }

        const rowsRaw = await this.db.query<any>(
            `SELECT v.id AS vch_id, v.vch_no, v.vch_date,
                    COALESCE(p.name, vt.name, '') AS vch_type_name,
                    c.company AS party_name,
                    ie.qty, ie.amount
             FROM inventory_entries ie
             INNER JOIN ledger_entries le ON ie.led_id = le.id
             INNER JOIN vch_details v ON le.vch_id = v.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             WHERE ${where.join(' AND ')}
             ORDER BY v.vch_date ASC, v.id ASC, ie.id ASC`,
            params,
        );

        let runningQty = openingQty;
        let runningValue = openingValue;
        const rows = rowsRaw.map((r: any, idx: number) => {
            const qty = Number(r.qty) || 0;
            const amt = Number(r.amount) || 0;
            const cat = this.classifyInventoryRow(r.vch_type_name, qty, amt);
            let inwardQty = 0, inwardValue = 0, outwardQty = 0, outwardValue = 0;
            if (cat === 'purchase')             { inwardQty  =  Math.abs(qty); inwardValue  =  Math.abs(amt); }
            else if (cat === 'purchase_return') { inwardQty  = -Math.abs(qty); inwardValue  = -Math.abs(amt); }
            else if (cat === 'sales')            { outwardQty =  Math.abs(qty); outwardValue =  Math.abs(amt); }
            else                                  { outwardQty = -Math.abs(qty); outwardValue = -Math.abs(amt); } // sales_return

            const rowOpeningQty = runningQty, rowOpeningValue = runningValue;
            runningQty   = +(runningQty   + inwardQty  - outwardQty ).toFixed(3);
            runningValue = +(runningValue + inwardValue - outwardValue).toFixed(2);

            return {
                sno: idx + 1,
                vch_id: r.vch_id,
                vch_no: r.vch_no,
                vch_date: r.vch_date,
                vch_type_name: r.vch_type_name || null,
                particulars: r.party_name || '—',
                opening_qty: +rowOpeningQty.toFixed(3), opening_value: +rowOpeningValue.toFixed(2),
                inward_qty:  +inwardQty.toFixed(3),     inward_value:  +inwardValue.toFixed(2),
                outward_qty: +outwardQty.toFixed(3),    outward_value: +outwardValue.toFixed(2),
                closing_qty: runningQty,                closing_value: runningValue,
            };
        });

        return {
            item: { id: item.id, name: item.item_name },
            opening: { qty: openingQty, value: openingValue },
            closing: { qty: runningQty, value: runningValue },
            rows,
        };
    }

    async deleteVoucher(id: number, _isAdmin: boolean = false) {
        // A "checked" voucher is locked against deletion — no one (not even
        // admin) can delete it directly. To delete, an admin must first
        // unmark it via /vouchers/:id/uncheck, which reopens the row for
        // edits and removals. This makes the Checked flag a true audit
        // gate rather than something an admin can bypass in one click.
        const row = await this.db.queryOne<{ checked_by: string | null }>(
            `SELECT checked_by FROM vch_details WHERE id = ?`, [id],
        );
        if (row?.checked_by) {
            throw new BadRequestException(
                `This voucher is marked as Checked by ${row.checked_by}. An admin must unmark it first before it can be deleted.`,
            );
        }
        // Unlink any cloud_activities that reference this voucher so they
        // don't keep showing the (now dead) voucher number on the Activities
        // page. Activities also become unbilled-and-eligible-for-rebill again.
        // We try both columns — voucher_id (FK, source of truth) and the
        // denormalized voucher_no cache. Wrapped in catch so older DBs
        // without those columns don't blow up the delete.
        await this.db.execute(
            `UPDATE cloud_activities SET voucher_id = NULL, voucher_no = NULL WHERE voucher_id = ?`,
            [id],
        ).catch(() => {});
        // Belt-and-suspenders: also clear by vch_no string for legacy rows
        // that have voucher_no cached but no voucher_id set.
        const vchNoRow = await this.db.queryOne<{ vch_no: string | null }>(
            `SELECT vch_no FROM vch_details WHERE id = ?`, [id],
        );
        if (vchNoRow?.vch_no) {
            await this.db.execute(
                `UPDATE cloud_activities SET voucher_id = NULL, voucher_no = NULL WHERE voucher_no = ?`,
                [vchNoRow.vch_no],
            ).catch(() => {});
        }

        await this.db.execute(`DELETE FROM bill_allocation WHERE vchid = ?`, [id]);
        await this.db.execute(`DELETE FROM batch WHERE vch_id = ?`, [id]);
        await this.db.execute(
            `DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)`, [id],
        );
        await this.db.execute(`DELETE FROM ledger_entries WHERE vch_id = ?`, [id]);
        await this.db.execute(`DELETE FROM vch_details WHERE id = ?`, [id]);
    }

    /** Toggle the "Checked" flag on a voucher. Requires vouchers.check perm
     *  (gated in the controller). When set, only admins can edit/delete. */
    async setChecked(id: number, checkedBy: string | null): Promise<void> {
        if (checkedBy) {
            await this.db.execute(
                `UPDATE vch_details SET checked_by = ?, checked_at = NOW() WHERE id = ?`,
                [checkedBy, id],
            );
        } else {
            await this.db.execute(
                `UPDATE vch_details SET checked_by = NULL, checked_at = NULL WHERE id = ?`,
                [id],
            );
        }
    }

    async findById(id: number) {
        // Include vch type + parent name + party name so the edit-mode form
        // can populate the Voucher Type dropdown without a second round-trip
        // to /api/vchtypes (which has its own permission gate that may not
        // be granted to users with voucher-only access). Customer address
        // / GST fields for the Print Voucher tax invoice are fetched
        // separately by the frontend so a missing column on this DB
        // instance doesn't blow up every voucher fetch.
        const vch = await this.db.queryOne<any>(
            `SELECT v.*, c.company AS party_name,
                    c.address1 AS party_address1,
                    c.address2 AS party_address2,
                    c.gstin    AS party_gst,
                    c.mobile   AS party_mobile,
                    c.email    AS party_email,
                    c.person   AS party_contact_person,
                    c.pincode  AS party_pincode,
                    pv.city    AS party_city,
                    s.name     AS party_state,
                    vt.name AS vch_type_name,
                    vt.parent_id AS vch_type_parent_id,
                    p.name AS vch_parent_type_name,
                    COALESCE(p.name, vt.name) AS vch_display_type
             FROM vch_details v
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             LEFT JOIN pincode pv ON c.pincode = pv.pincode
             LEFT JOIN state s    ON pv.stateid = s.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             WHERE v.id = ?`, [id],
        );
        if (!vch) return null;

        // Pull ledger entries + label them. Pre-fix vouchers have orphan goods
        // rows with ledger_id=NULL because Sales/Purchase didn't exist at save
        // time — fall back to inferring the goods name from the voucher type
        // so the detail view never renders a blank ledger cell.
        // The CASE produces utf8mb4 string literals while c.company is
        // latin1_swedish_ci — force the fallback into latin1 so COALESCE
        // doesn't blow up with ER_CANT_AGGREGATE_2COLLATIONS.
        const ledgerEntries = await this.db.query<any>(
            `SELECT le.*,
                    COALESCE(
                        c.company,
                        CONVERT(
                            CASE
                                WHEN le.ledger_id IS NULL THEN
                                    CASE
                                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'YES' THEN 'Sales'
                                        WHEN COALESCE(vt.deemed_positive, p.deemed_positive) = 'NO'  THEN 'Purchase'
                                        ELSE 'Goods'
                                    END
                                ELSE NULL
                            END
                            USING latin1
                        )
                    ) AS ledger_name
             FROM ledger_entries le
             LEFT JOIN customer c ON le.ledger_id = c.id
             LEFT JOIN vch_details v ON le.vch_id = v.id
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p ON vt.parent_id = p.id AND vt.parent_id != vt.id
             WHERE le.vch_id = ? ORDER BY le.id`, [id],
        );

        // Attach inventory + batch rows to their ledger entry.
        // Project items.gst as `gst_rate` (what the edit form expects) rather
        // than re-aliasing alongside ie.gst_rate — mysql2's silent dedupe of
        // duplicate aliases is what was throwing the 500 on /vouchers/:id.
        for (const le of ledgerEntries) {
            le.inventoryEntries = await this.db.query<any>(
                `SELECT ie.id, ie.led_id, ie.item_id, ie.qty, ie.rate, ie.amount,
                        ie.created_at, ie.side,
                        i.item_name,
                        i.hsn,
                        COALESCE(i.gst, ie.gst_rate, 0) AS gst_rate
                 FROM inventory_entries ie
                 LEFT JOIN items i ON ie.item_id = i.id
                 WHERE ie.led_id = ? ORDER BY ie.id`, [le.id],
            );
            for (const ie of le.inventoryEntries) {
                ie.batchRows = await this.db.query<any>(
                    `SELECT batch_name, qty, rate, amount FROM batch WHERE inventory_id = ? ORDER BY id`, [ie.id],
                );
            }
        }

        // Attach bill allocation entries
        const billAllocations = await this.db.query<any>(
            `SELECT billname, amount, ledger FROM bill_allocation WHERE vchid = ? ORDER BY id`, [id],
        );

        return { ...vch, ledgerEntries, billAllocations };
    }

    /** Resolve the effective prefix/suffix particulars for a vch_type on a given date. */
    private async resolveAffixes(vchTypeId: number, forDate?: string): Promise<{ prefix: string; suffix: string }> {
        const today = forDate || new Date().toISOString().split('T')[0];
        const pp = await this.db.queryOne<any>(
            `SELECT particulars FROM vchtype_prefix_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchTypeId, today]
        );
        const sp = await this.db.queryOne<any>(
            `SELECT particulars FROM vchtype_suffix_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchTypeId, today]
        );
        return { prefix: pp?.particulars ?? '', suffix: sp?.particulars ?? '' };
    }

    /** Generate next voucher number for a given vch_type_id using date-effective periods.
     *  opts.force generates a number even when the type is set to manual
     *  numbering — used by auto-created vouchers (activity auto-invoices)
     *  that must ALWAYS carry a number so their "New" bill allocation has a
     *  reference to hang on. */
    async getNextVoucherNo(vchTypeId: number, forDate?: string, opts?: { force?: boolean }): Promise<string> {
        const today = forDate || new Date().toISOString().split('T')[0];

        const vtRow = await this.db.queryOne<any>(
            `SELECT numbering_mode, vch_width FROM vchtype WHERE id = ?`, [vchTypeId]
        );
        if (!vtRow || (!opts?.force && vtRow.numbering_mode !== 'automatic')) return '';

        const width: number = vtRow.vch_width || 3;

        // Resolve effective prefix/suffix/start_no for the voucher date from period tables
        const np = await this.db.queryOne<any>(
            `SELECT applicable_from, start_no, period_type FROM vchtype_numbering_period
             WHERE vchtype_id = ? AND applicable_from <= ? ORDER BY applicable_from DESC LIMIT 1`,
            [vchTypeId, today]
        );
        const { prefix, suffix } = await this.resolveAffixes(vchTypeId, today);
        const startNo: number = np?.start_no ?? 1;
        const periodType: string = np?.period_type ?? 'yearly';
        const currentPeriodFrom: string | null = np?.applicable_from
            ? (typeof np.applicable_from === 'string' ? np.applicable_from : new Date(np.applicable_from).toISOString().split('T')[0])
            : null;

        // Filter by effective period date range so the counter restarts when a new period begins.
        // The lower bound is the period's applicable_from (or financial year start for yearly mode).
        // The upper bound is the next period's applicable_from (if any).
        let dateFilter = '';
        let dateParams: any[] = [];

        if (periodType === 'yearly' && currentPeriodFrom) {
            // For yearly: use financial year start OR the period's applicable_from, whichever is later
            const d = new Date(today);
            const fyStart = d.getMonth() >= 3
                ? `${d.getFullYear()}-04-01`
                : `${d.getFullYear() - 1}-04-01`;
            const effectiveStart = currentPeriodFrom > fyStart ? currentPeriodFrom : fyStart;
            dateFilter = ' AND vch_date >= ?';
            dateParams = [effectiveStart];
        } else if (currentPeriodFrom) {
            // For non-yearly: use the period's applicable_from
            dateFilter = ' AND vch_date >= ?';
            dateParams = [currentPeriodFrom];
        }

        // Find the NEXT numbering period's start date to cap the upper bound
        const nextPeriod = await this.db.queryOne<any>(
            `SELECT applicable_from FROM vchtype_numbering_period
             WHERE vchtype_id = ? AND applicable_from > ? ORDER BY applicable_from ASC LIMIT 1`,
            [vchTypeId, currentPeriodFrom || today]
        );
        if (nextPeriod?.applicable_from) {
            const nextFrom = typeof nextPeriod.applicable_from === 'string'
                ? nextPeriod.applicable_from
                : new Date(nextPeriod.applicable_from).toISOString().split('T')[0];
            dateFilter += ' AND vch_date < ?';
            dateParams.push(nextFrom);
        }

        // Tally-style "Restart Numbering": the running count is purely a
        // property of the numbering period's date range — how many numbered
        // vouchers of this type have already landed in it — never a function
        // of prefix/suffix text. Editing a prefix/suffix's wording or its own
        // applicable_from later only changes the cosmetic wrapper on future
        // numbers; it can never disrupt or reset the underlying count, and it
        // never needs to parse (and possibly misparse) the last saved number.
        const countRow = await this.db.queryOne<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM vch_details WHERE vch_type_id = ? AND vch_no IS NOT NULL${dateFilter}`,
            [vchTypeId, ...dateParams]
        );
        const nextNum = startNo + (countRow?.cnt ?? 0);
        return `${prefix}${String(nextNum).padStart(width, '0')}${suffix}`;
    }

    /**
     * Re-wrap already-saved voucher numbers to match a changed prefix/suffix,
     * for vouchers dated within the affected period's range. Only touches
     * vouchers whose CURRENT number precisely matches the OLD prefix/suffix —
     * anything ambiguous (e.g. a manually-typed number from before automatic
     * numbering existed) is left alone and reported as skipped, never guessed.
     * dryRun=true returns the preview without writing anything.
     */
    async retrofitVoucherNumbering(params: {
        vchTypeId: number;
        oldPrefix: string; oldSuffix: string;
        newPrefix: string; newSuffix: string;
        fromDate: string; toDate?: string;
        changedBy?: string | null;
        dryRun: boolean;
    }): Promise<{
        changed: { id: number; old: string; new: string }[];
        skipped: { id: number; vch_no: string }[];
    }> {
        const { vchTypeId, oldPrefix, oldSuffix, newPrefix, newSuffix, fromDate, toDate, changedBy, dryRun } = params;

        let dateFilter = ' AND vch_date >= ?';
        const dateParams: any[] = [fromDate];
        if (toDate) { dateFilter += ' AND vch_date < ?'; dateParams.push(toDate); }

        const rows = await this.db.query<{ id: number; vch_no: string }>(
            `SELECT id, vch_no FROM vch_details WHERE vch_type_id = ? AND vch_no IS NOT NULL${dateFilter}`,
            [vchTypeId, ...dateParams],
        );

        const changed: { id: number; old: string; new: string }[] = [];
        const skipped: { id: number; vch_no: string }[] = [];
        for (const r of rows) {
            const raw = r.vch_no;

            // Already wrapped in the exact target format (e.g. a prior retrofit
            // run already applied it, or it was saved that way to begin with)
            // — leave it alone. Without this check, re-running against an
            // assumed old prefix/suffix of '' would double-wrap an already
            // "pay/xxx/paise dede" value into "pay/pay/xxx/paise dede/paise dede".
            const alreadyTargetFormat = (newPrefix || newSuffix)
                && raw.startsWith(newPrefix) && raw.endsWith(newSuffix)
                && raw.length >= newPrefix.length + newSuffix.length;
            if (alreadyTargetFormat) continue;

            const hasPrefix = !oldPrefix || raw.startsWith(oldPrefix);
            const hasSuffix = !oldSuffix || raw.endsWith(oldSuffix);
            if (!hasPrefix || !hasSuffix || raw.length < oldPrefix.length + oldSuffix.length) {
                skipped.push({ id: r.id, vch_no: raw });
                continue;
            }
            const core = raw.slice(oldPrefix.length, raw.length - oldSuffix.length);
            const newNo = `${newPrefix}${core}${newSuffix}`;
            if (newNo !== raw) changed.push({ id: r.id, old: raw, new: newNo });
        }

        if (dryRun || changed.length === 0) return { changed, skipped };

        return this.db.withTransaction(async (conn) => {
            // Verify none of the new numbers collide with a voucher outside this batch
            for (const c of changed) {
                const [dup] = await this.db.query<any>(
                    `SELECT COUNT(*) as cnt FROM vch_details WHERE vch_no = ? AND vch_type_id = ? AND id != ?`,
                    [c.new, vchTypeId, c.id], conn,
                );
                if ((dup?.cnt ?? 0) > 0) {
                    throw new BadRequestException(`Cannot retrofit: "${c.new}" would collide with an existing voucher number. No changes were made.`);
                }
            }
            for (const c of changed) {
                await this.db.execute(`UPDATE vch_details SET vch_no = ? WHERE id = ?`, [c.new, c.id], conn);
                await this.db.execute(
                    `INSERT INTO vch_no_retrofit_audit (vch_id, old_vch_no, new_vch_no, changed_by) VALUES (?, ?, ?, ?)`,
                    [c.id, c.old, c.new, changedBy ?? null], conn,
                );
            }
            return { changed, skipped };
        });
    }

    /** Return open/pending bill references for a customer.
     *  direction='Cr' (default) — party on Cr side (Receipt/Payment) → show positive pending bills
     *  direction='Dr' — party on Dr side → show negative pending (credit notes)
     *
     *  excludeVchId: when editing an existing voucher, pass its id so its own
     *  allocations are removed from the netting. Otherwise a Receipt that already
     *  fully settles a bill would hide that bill from its own edit screen — the
     *  user would see "No pending bills" while editing the very voucher that
     *  settled it. Tally semantics: while editing voucher X, the bills it's
     *  currently allocating to should still be selectable. */
    async getPendingRefs(
        customerId: number,
        _direction?: 'Dr' | 'Cr',
        excludeVchId?: number,
    ): Promise<{ billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[]> {
        const exclude = excludeVchId && Number.isInteger(excludeVchId) && excludeVchId > 0
            ? excludeVchId
            : null;
        const excludeFilter = exclude ? 'AND (ba.vchid IS NULL OR ba.vchid != ?)' : '';
        // Show ALL pending refs (both Dr and Cr) — positive = Dr, negative = Cr
        // Use LEFT JOIN on vch_details so opening balances (where ba.vchid IS NULL) are included.
        const namedParams: any[] = [customerId];
        if (exclude) namedParams.push(exclude);
        const onAcctParams: any[] = [customerId];
        if (exclude) onAcctParams.push(exclude);
        return this.db.query<any>(
            `SELECT billname, ABS(net_amount) AS amount, vch_date, vch_no,
                    CASE WHEN net_amount > 0 THEN 'Dr' ELSE 'Cr' END AS direction
             FROM (
                -- Named bills: any non-zero net balance
                SELECT
                    ba.billname,
                    SUM(ba.amount) AS net_amount,
                    MIN(COALESCE(v.vch_date, ba.bill_date)) AS vch_date,
                    MIN(v.vch_no)   AS vch_no
                FROM bill_allocation ba
                LEFT JOIN vch_details v ON ba.vchid = v.id
                WHERE ba.ledger = ?
                  AND ba.billname IS NOT NULL AND ba.billname != ''
                  ${excludeFilter}
                GROUP BY ba.billname
                HAVING ABS(SUM(ba.amount)) > 0.01

                UNION ALL

                -- On Account entries: billname IS NULL, grouped by voucher (or ba.id for opening balances)
                SELECT
                    CONCAT('On Acct (', COALESCE(MAX(v.vch_no), MAX(v.id), MAX(ba.id)), ')') AS billname,
                    SUM(ba.amount) AS net_amount,
                    MIN(COALESCE(v.vch_date, ba.bill_date)) AS vch_date,
                    MIN(v.vch_no)   AS vch_no
                FROM bill_allocation ba
                LEFT JOIN vch_details v ON ba.vchid = v.id
                WHERE ba.ledger = ?
                  AND (ba.billname IS NULL OR ba.billname = '')
                  ${excludeFilter}
                GROUP BY COALESCE(ba.vchid, ba.id)
                HAVING ABS(SUM(ba.amount)) > 0.01
             ) AS combined
             ORDER BY vch_date DESC
             LIMIT 50`,
            [...namedParams, ...onAcctParams],
        );
    }

    /** Return distinct serial numbers owned by this customer (from tallydetails).
     *  Optionally filtered by flavour. Excludes serials already sold via batch. */
    async getSerials(customerId: number, flavourId?: number): Promise<string[]> {
        const tdFilter = flavourId ? 'AND td.tallyflavor = ?' : '';
        const tdParams: any[] = [customerId];
        if (flavourId) tdParams.push(flavourId);

        const rows = await this.db.query<{ s: string }>(
            `SELECT DISTINCT td.tallyserial AS s
             FROM tallydetails td
             WHERE CAST(td.customerid AS UNSIGNED) = ?
               ${tdFilter}
               AND td.tallyserial IS NOT NULL AND td.tallyserial != ''
               AND td.tallyserial NOT IN (
                   SELECT DISTINCT b2.batch_name FROM batch b2
                   WHERE b2.batch_name IS NOT NULL AND b2.qty < 0
               )
             ORDER BY td.tallyserial ASC`,
            tdParams,
        );

        return rows.map(r => r.s);
    }

    /** Update an existing voucher: delete all child entries and re-insert. */
    async update(id: number, data: Parameters<VouchersService['create']>[0], isAdmin: boolean = false) {
        // Lock check — admin override only.
        const row = await this.db.queryOne<{ checked_by: string | null; vch_no: string | null }>(
            `SELECT checked_by, vch_no FROM vch_details WHERE id = ?`, [id],
        );
        if (row?.checked_by && !isAdmin) {
            throw new BadRequestException('This voucher is marked as Checked. Only an admin can edit it.');
        }
        // Pre-flight validation (outside transaction — no DB writes)
        await this.validateBatchSerials(data.items || []);

        if (data.vch_no) {
            const [dup] = await this.db.query<any>(
                `SELECT COUNT(*) as cnt FROM vch_details WHERE vch_no = ? AND vch_type_id = ? AND id != ?`,
                [data.vch_no, data.vch_type_id || null, id],
            );
            if ((dup?.cnt ?? 0) > 0) {
                if (!row?.vch_no && data.vch_type_id) {
                    // This voucher never had its own number before, so this is
                    // effectively a first-time assignment (e.g. numbering
                    // several previously-"—" vouchers in one session, which
                    // can land on the same suggested number before either is
                    // saved) — auto-bump past the collision like create() does,
                    // instead of blocking the save.
                    data = { ...data, vch_no: await this.resolveUniqueVchNo(data.vch_no, data.vch_type_id, data.vch_date || undefined) };
                } else {
                    throw new BadRequestException(`Voucher number "${data.vch_no}" already exists for this voucher type`);
                }
            }
        }

        // ── All DB writes inside a transaction — atomic all-or-nothing ──
        return this.db.withTransaction(async (conn) => {
            // Delete old entries
            await this.db.execute(`DELETE FROM bill_allocation WHERE vchid = ?`, [id], conn);
            await this.db.execute(`DELETE FROM batch WHERE vch_id = ?`, [id], conn);
            await this.db.execute(
                `DELETE FROM inventory_entries WHERE led_id IN (SELECT id FROM ledger_entries WHERE vch_id = ?)`, [id], conn,
            );
            await this.db.execute(`DELETE FROM ledger_entries WHERE vch_id = ?`, [id], conn);

            // Stock Journal update path
            const isStockJournalUpd = await (async () => {
                if (!data.vch_type_id) return false;
                const vt = await this.db.queryOne<any>(
                    `SELECT v.name, p.name AS parent_name FROM vchtype v
                     LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                     WHERE v.id = ?`, [data.vch_type_id], conn,
                );
                const n = ((vt?.name || '') + (vt?.parent_name || '')).toLowerCase();
                return n.includes('stock journal');
            })();

            if (isStockJournalUpd) {
                const sourceItems = (data.stock_source || []) as any[];
                const destItems   = (data.stock_destination || []) as any[];

                await this.db.execute(
                    `UPDATE vch_details SET vch_type_id=?, vch_no=?, vch_date=?, party_ledger_id=NULL, amount=0, remark=? WHERE id=?`,
                    [data.vch_type_id || null, data.vch_no || null, data.vch_date || null, data.remark || null, id], conn,
                );

                const dummyLed = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, 0, 0)`, [id], conn,
                );
                const dummyLedId = dummyLed.insertId;

                // Source = negative
                for (const item of sourceItems) {
                    const qty = -(Math.abs(Number(item.qty)));
                    const amt = -(Math.abs(Number(item.amount)));
                    const invRes = await this.db.execute(
                        `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate, side) VALUES (?, ?, ?, ?, ?, ?, 'source')`,
                        [dummyLedId, item.item_id, qty, item.rate, amt, item.gst_rate || 0], conn,
                    );
                    if (item.batch_rows?.length) {
                        for (const b of item.batch_rows) {
                            await this.db.execute(
                                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [id, invRes.insertId, item.item_id, b.batch_name || null, -(Math.abs(Number(b.qty))), b.rate, -(Math.abs(Number(b.amount)))], conn,
                            );
                        }
                    }
                }

                // Destination = positive
                for (const item of destItems) {
                    const qty = Math.abs(Number(item.qty));
                    const amt = Math.abs(Number(item.amount));
                    const invRes = await this.db.execute(
                        `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate, side) VALUES (?, ?, ?, ?, ?, ?, 'destination')`,
                        [dummyLedId, item.item_id, qty, item.rate, amt, item.gst_rate || 0], conn,
                    );
                    if (item.batch_rows?.length) {
                        for (const b of item.batch_rows) {
                            await this.db.execute(
                                `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [id, invRes.insertId, item.item_id, b.batch_name || null, Math.abs(Number(b.qty)), b.rate, Math.abs(Number(b.amount))], conn,
                            );
                        }
                    }
                }

                return { id };
            }

            // Re-compute grandTotal
            let grandTotal = 0;
            let resolvedSet: Awaited<ReturnType<VouchersService['buildItemsLedgerSet']>> | null = null;
            if (!data.items || data.items.length === 0) {
                grandTotal = +(data.ledgers || []).filter(l => (l.amount || 0) > 0).reduce((s, l) => s + l.amount, 0).toFixed(2);
            } else {
                let goodsLedgerName: 'Sales' | 'Purchase' = 'Sales';
                if (data.vch_type_id) {
                    const vtRow = await this.db.queryOne<any>(
                        `SELECT v.name, p.name AS parent_name
                         FROM vchtype v
                         LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                         WHERE v.id = ?`, [data.vch_type_id], conn,
                    );
                    const pname = (vtRow?.parent_name || vtRow?.name || '').toLowerCase();
                    goodsLedgerName = (pname.includes('purchase') || pname.includes('debit')) ? 'Purchase' : 'Sales';
                }
                resolvedSet = await this.buildItemsLedgerSet(data.items, data.ledgers || [], goodsLedgerName, conn);
                grandTotal = resolvedSet.grandTotal;
            }

            await this.db.execute(
                `UPDATE vch_details SET vch_type_id=?, vch_no=?, vch_date=?, party_ledger_id=?, amount=?, remark=? WHERE id=?`,
                [data.vch_type_id || null, data.vch_no || null, data.vch_date || null,
                 data.party_ledger_id, grandTotal, data.remark || null, id], conn,
            );

            await this._insertChildEntries(id, grandTotal, data, resolvedSet, conn);
            return { id };
        });
    }

    /** Insert ledger, inventory, batch, and bill_allocation rows for an existing vch_id. */
    private async _insertChildEntries(
        vchId: number,
        grandTotal: number,
        data: Parameters<VouchersService['create']>[0],
        prebuilt?: Awaited<ReturnType<VouchersService['buildItemsLedgerSet']>> | null,
        conn?: import('mysql2/promise').PoolConnection,
    ) {
        // Journal mode — multiple ledger rows can each be bill-by-bill, so
        // allocations are grouped per ledger_id (see create() for the same
        // pattern) rather than always attached to the single party ledger.
        if (!data.items || data.items.length === 0) {
            const ledEntryIdByLedger = new Map<number, number>();
            for (const led of data.ledgers || []) {
                if (!led.ledger_id || !led.amount) continue;
                const ledRes = await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, led.ledger_id, led.amount],
                    conn,
                );
                if (!ledEntryIdByLedger.has(led.ledger_id)) {
                    ledEntryIdByLedger.set(led.ledger_id, ledRes.insertId);
                }
            }

            const baByLedger = new Map<number, Array<{ amount: number; direction?: string; type?: string; refno?: string }>>();
            for (const ba of data.bill_allocation || []) {
                const ledgerId = (ba as any).ledger_id ?? data.party_ledger_id;
                if (!baByLedger.has(ledgerId)) baByLedger.set(ledgerId, []);
                baByLedger.get(ledgerId)!.push(ba);
            }
            for (const [ledgerId, entries] of baByLedger) {
                const led = (data.ledgers || []).find(l => l.ledger_id === ledgerId);
                // Auto-heal stale bill_alloc totals so a re-saved legacy voucher
                // ends up with allocations matching its own ledger amount.
                const normalizedBA = this.normalizeBillAllocation(
                    led?.amount ?? 0,
                    entries,
                    data.vch_no || null,
                );
                const ledEntryId = ledEntryIdByLedger.get(ledgerId) ?? null;
                if (!normalizedBA || normalizedBA.length === 0) continue;
                for (const ba of normalizedBA) {
                    if (!ba.amount) continue;
                    const signedAmt = ba.direction
                        ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                        : (ba.type === 'Agr.' ? -Math.abs(ba.amount) : Math.abs(ba.amount));
                    await this.db.execute(
                        `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                        [vchId, ledEntryId, ledgerId, ba.refno || null, signedAmt], conn,
                    );
                }
            }
            return;
        }

        let deemedPositive: boolean | null = null;
        let goodsLedgerName: 'Sales' | 'Purchase' = 'Sales';
        if (data.vch_type_id) {
            const vtRow = await this.db.queryOne<any>(
                `SELECT v.name, v.deemed_positive,
                 p.name AS parent_name, p.deemed_positive AS parent_deemed
                 FROM vchtype v
                 LEFT JOIN vchtype p ON v.parent_id = p.id AND v.parent_id != v.id
                 WHERE v.id = ?`, [data.vch_type_id], conn,
            );
            const dp = vtRow?.deemed_positive || vtRow?.parent_deemed;
            if (dp === 'YES') deemedPositive = true;
            else if (dp === 'NO') deemedPositive = false;
            const pname = (vtRow?.parent_name || vtRow?.name || '').toLowerCase();
            goodsLedgerName = (pname.includes('purchase') || pname.includes('debit')) ? 'Purchase' : 'Sales';
        }

        // Reuse the resolved set from update(), or build one fresh.
        const set = prebuilt
            ?? await this.buildItemsLedgerSet(data.items, data.ledgers || [], goodsLedgerName, conn);
        const { ledgers: effectiveLedgers, goodsLedgerId, subtotal } = set;
        const effectivePositive = deemedPositive ?? true;
        let partyLedEntryId: number | null = null;
        let goodsLedId: number | null = null;

        if (effectivePositive) {
            const pr = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, data.party_ledger_id, +grandTotal], conn);
            partyLedEntryId = pr.insertId;
            const r = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, goodsLedgerId, -subtotal], conn);
            goodsLedId = r.insertId;
        } else {
            const pr = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, data.party_ledger_id, -grandTotal], conn);
            partyLedEntryId = pr.insertId;
            const r = await this.db.execute(`INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`, [vchId, goodsLedgerId, +subtotal], conn);
            goodsLedId = r.insertId;
        }

        if (goodsLedId) {
            const sign = effectivePositive ? -1 : 1;
            for (const item of data.items) {
                const invResult = await this.db.execute(
                    `INSERT INTO inventory_entries (led_id, item_id, qty, rate, amount, gst_rate) VALUES (?, ?, ?, ?, ?, ?)`,
                    [goodsLedId, item.item_id, item.qty * sign, item.rate, item.amount * sign, item.gst_rate || 0], conn,
                );
                const invId = invResult.insertId;
                if (item.batch_rows && item.batch_rows.length > 0) {
                    for (const b of item.batch_rows) {
                        await this.db.execute(
                            `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [vchId, invId, item.item_id, b.batch_name || null, b.qty * sign, b.rate, b.amount * sign], conn,
                        );
                    }
                } else {
                    await this.db.execute(
                        `INSERT INTO batch (vch_id, inventory_id, item_id, batch_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [vchId, invId, item.item_id, null, item.qty * sign, item.rate, item.amount * sign], conn,
                    );
                }
            }
        }

        if (effectiveLedgers.length > 0) {
            const sign = effectivePositive ? -1 : 1;
            for (const led of effectiveLedgers) {
                if (!led.ledger_id || !led.amount) continue;
                await this.db.execute(
                    `INSERT INTO ledger_entries (vch_id, ledger_id, amount) VALUES (?, ?, ?)`,
                    [vchId, led.ledger_id, led.amount * sign],
                    conn,
                );
            }
        }

        const baseSignUpdate = effectivePositive ? 1 : -1;
        const normalizedBAUpdate = this.normalizeBillAllocation(
            grandTotal * baseSignUpdate,
            data.bill_allocation,
            data.vch_no || null,
        );
        if (normalizedBAUpdate && normalizedBAUpdate.length > 0) {
            const baseSign = baseSignUpdate;
            for (const ba of normalizedBAUpdate) {
                if (!ba.amount) continue;
                const signedAmt = ba.direction
                    ? (ba.direction === 'Cr' ? -Math.abs(ba.amount) : Math.abs(ba.amount))
                    : (ba.type === 'Agr.' ? -Math.abs(ba.amount) * baseSign : Math.abs(ba.amount) * baseSign);
                await this.db.execute(
                    `INSERT INTO bill_allocation (vchid, ledentry_id, ledger, billname, amount) VALUES (?, ?, ?, ?, ?)`,
                    [vchId, partyLedEntryId, data.party_ledger_id, ba.refno || null, signedAmt], conn,
                );
            }
        }
    }
}
