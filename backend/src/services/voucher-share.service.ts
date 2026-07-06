import { Injectable, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DbService } from '../database/db.service';

/**
 * Voucher sharing — Email / WhatsApp / SMS.
 *
 * Flow: the frontend renders the invoice (same layout as Print Voucher),
 * produces a PDF blob with html2pdf, and uploads it here. We store it on
 * disk keyed by a random token, so it can be:
 *   - attached to an email sent to the customer's registered email
 *   - downloaded publicly via GET /api/public/voucher-pdf/:token
 *     (the link shared over WhatsApp / SMS)
 *
 * SMTP: reuses the same MAIL_* env config the backup mailer uses.
 * From address: VOUCHER_SHARE_FROM env, defaulting to the accounts inbox.
 */
@Injectable()
export class VoucherShareService implements OnModuleInit {
    private uploadDir = path.join(process.cwd(), 'uploads', 'voucher-pdfs');

    constructor(private db: DbService, private config: ConfigService) {}

    async onModuleInit() {
        try {
            fs.mkdirSync(this.uploadDir, { recursive: true });
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS voucher_share (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    vch_id     INT NOT NULL,
                    token      VARCHAR(64) NOT NULL UNIQUE,
                    file_path  VARCHAR(500) NOT NULL,
                    created_by VARCHAR(255) DEFAULT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_vch (vch_id)
                )
            `);
        } catch (e: any) {
            console.error('[VoucherShareService] init error:', e?.message);
        }
    }

    /** Store an uploaded voucher PDF and return its public token.
     *  Re-sharing the same voucher replaces the stored file (latest wins). */
    async storePdf(vchId: number, buffer: Buffer, createdBy?: string | null) {
        if (!buffer?.length) throw new BadRequestException('Empty PDF upload');
        const voucher = await this.db.queryOne<any>(`SELECT id FROM vch_details WHERE id = ?`, [vchId]);
        if (!voucher) throw new NotFoundException(`Voucher ${vchId} not found`);

        // Reuse the existing token for this voucher if one exists so old
        // shared links keep working and point at the freshest PDF.
        const existing = await this.db.queryOne<any>(
            `SELECT token, file_path FROM voucher_share WHERE vch_id = ? ORDER BY id DESC LIMIT 1`, [vchId],
        );
        const token = existing?.token || crypto.randomBytes(24).toString('hex');
        const filePath = path.join(this.uploadDir, `${token}.pdf`);
        fs.writeFileSync(filePath, buffer);

        if (!existing) {
            await this.db.execute(
                `INSERT INTO voucher_share (vch_id, token, file_path, created_by) VALUES (?, ?, ?, ?)`,
                [vchId, token, filePath, createdBy || null],
            );
        }
        return { token, public_path: `/api/public/voucher-pdf/${token}` };
    }

    /** Resolve a stored PDF by its public token. */
    async getPdfByToken(token: string): Promise<{ filePath: string; vchNo: string | null }> {
        const row = await this.db.queryOne<any>(
            `SELECT vs.file_path, v.vch_no FROM voucher_share vs
             LEFT JOIN vch_details v ON v.id = vs.vch_id
             WHERE vs.token = ?`,
            [token],
        );
        if (!row || !fs.existsSync(row.file_path)) throw new NotFoundException('This shared voucher link is no longer available');
        return { filePath: row.file_path, vchNo: row.vch_no || null };
    }

    /** Voucher header + party + line summary for message bodies. */
    async getVoucherSummary(vchId: number) {
        const v = await this.db.queryOne<any>(
            `SELECT v.id, v.vch_no, v.vch_date, v.amount,
                    COALESCE(p.name, vt.name) AS vch_type, vt.name AS vch_subtype,
                    c.id AS customer_id, c.company AS party_name, c.email AS party_email, c.mobile AS party_mobile
             FROM vch_details v
             LEFT JOIN vchtype vt ON v.vch_type_id = vt.id
             LEFT JOIN vchtype p  ON vt.parent_id = p.id AND vt.parent_id != vt.id
             LEFT JOIN customer c ON v.party_ledger_id = c.id
             WHERE v.id = ?`,
            [vchId],
        );
        if (!v) throw new NotFoundException(`Voucher ${vchId} not found`);

        // Registered contact: primary contact mapping wins, else customer row
        const contact = await this.db.queryOne<any>(
            `SELECT ccd.contact_person, ccd.mobile_no
             FROM customer_contact_mapping_data ccm
             JOIN customer_contact_details ccd ON ccm.mobile_id = ccd.id
             WHERE ccm.customer_id = ? AND ccm.status = 'Active'
             ORDER BY CASE WHEN ccm.primary_contact = 'Yes' THEN 0 ELSE 1 END, ccm.id
             LIMIT 1`,
            [v.customer_id],
        ).catch(() => null);

        const items = await this.db.query<any>(
            `SELECT i.item_name, ie.qty, ie.rate, ie.amount
             FROM inventory_entries ie
             INNER JOIN ledger_entries le ON ie.led_id = le.id
             INNER JOIN items i ON ie.item_id = i.id
             WHERE le.vch_id = ?
             ORDER BY ie.id`,
            [vchId],
        ).catch(() => [] as any[]);

        return {
            id: v.id,
            vch_no: v.vch_no || null,
            vch_date: v.vch_date,
            vch_type: v.vch_subtype || v.vch_type || 'Voucher',
            amount: +Number(v.amount || 0).toFixed(2),
            party_name: v.party_name || null,
            party_email: v.party_email || null,
            party_mobile: contact?.mobile_no || v.party_mobile || null,
            contact_person: contact?.contact_person || null,
            items: items.map((it: any) => ({
                name: it.item_name,
                qty: +Number(Math.abs(it.qty || 0)).toFixed(3),
                rate: +Number(it.rate || 0).toFixed(2),
                amount: +Number(Math.abs(it.amount || 0)).toFixed(2),
            })),
        };
    }

    /** Email the voucher (details in body + PDF attached) to the customer's
     *  registered email — or an explicit override address. */
    async emailVoucher(vchId: number, opts: { token: string; to?: string; publicBase?: string }) {
        const summary = await this.getVoucherSummary(vchId);
        const to = (opts.to || summary.party_email || '').trim();
        if (!to) throw new BadRequestException(`No registered email found for ${summary.party_name || 'this customer'} — add one on the Customers page or type an address.`);

        const { filePath } = await this.getPdfByToken(opts.token);

        const host = this.config.get<string>('MAIL_HOST');
        const user = this.config.get<string>('MAIL_USER');
        if (!host || !user) {
            throw new BadRequestException('Email is not configured — set MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS in the backend .env');
        }
        const transporter = nodemailer.createTransport({
            host,
            port: this.config.get<number>('MAIL_PORT', 587),
            secure: Number(this.config.get<number>('MAIL_PORT', 587)) === 465,
            auth: { user, pass: this.config.get<string>('MAIL_PASS') },
        });

        const from = this.config.get<string>('VOUCHER_SHARE_FROM')
            || `"ABS Technologies Accounts" <account@abstechnologies.co.in>`;
        const dateStr = summary.vch_date ? new Date(summary.vch_date).toLocaleDateString('en-GB') : '—';
        const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        const itemRows = summary.items.map(it =>
            `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;">${it.name}</td>
                 <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${it.qty}</td>
                 <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${inr(it.rate)}</td>
                 <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${inr(it.amount)}</td></tr>`
        ).join('');
        const downloadLink = opts.publicBase ? `${opts.publicBase}/api/public/voucher-pdf/${opts.token}` : null;

        const html = `
            <div style="font-family:Segoe UI,Arial,sans-serif;color:#1e293b;max-width:640px;">
              <p>Dear ${summary.contact_person || summary.party_name || 'Customer'},</p>
              <p>Please find attached your <b>${summary.vch_type}</b> from ABS Technologies.</p>
              <table style="border-collapse:collapse;margin:12px 0;">
                <tr><td style="padding:4px 10px;color:#64748b;">Voucher No.</td><td style="padding:4px 10px;font-weight:600;">${summary.vch_no || '—'}</td></tr>
                <tr><td style="padding:4px 10px;color:#64748b;">Date</td><td style="padding:4px 10px;font-weight:600;">${dateStr}</td></tr>
                <tr><td style="padding:4px 10px;color:#64748b;">Party</td><td style="padding:4px 10px;font-weight:600;">${summary.party_name || '—'}</td></tr>
                <tr><td style="padding:4px 10px;color:#64748b;">Amount</td><td style="padding:4px 10px;font-weight:700;color:#1d4ed8;">${inr(summary.amount)}</td></tr>
              </table>
              ${summary.items.length ? `
              <table style="border-collapse:collapse;width:100%;font-size:13px;">
                <tr style="background:#f1f5f9;">
                  <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Item</th>
                  <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">Qty</th>
                  <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">Rate</th>
                  <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">Amount</th>
                </tr>
                ${itemRows}
              </table>` : ''}
              ${downloadLink ? `<p style="margin-top:14px;">You can also <a href="${downloadLink}">download the PDF here</a>.</p>` : ''}
              <p style="margin-top:18px;">Regards,<br/><b>ABS Technologies — Accounts</b></p>
            </div>`;

        await transporter.sendMail({
            from,
            to,
            subject: `${summary.vch_type} ${summary.vch_no || ''} — ABS Technologies`.replace(/\s+/g, ' ').trim(),
            html,
            attachments: [{
                filename: `${(summary.vch_no || `Voucher-${vchId}`).replace(/[\\/:*?"<>|]/g, '-')}.pdf`,
                path: filePath,
                contentType: 'application/pdf',
            }],
        });

        return { success: true, sent_to: to };
    }
}
