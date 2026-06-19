import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as archiverNs from 'archiver';
import * as nodemailer from 'nodemailer';
import * as mysqldump from 'mysqldump';

const archiver: any = archiverNs;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private isRunning = false;
  private readonly backupDir = path.join(process.cwd(), 'backups');

  constructor(private config: ConfigService) {}

  // Nightly at 9:00 PM Asia/Kolkata
  @Cron('0 21 * * *', { timeZone: 'Asia/Kolkata' })
  async nightlyBackup() {
    await this.runBackup();
  }

  async runBackup(): Promise<{ sqlSizeKb: number; zipSizeKb: number }> {
    if (this.isRunning) {
      this.logger.warn('Backup already in progress, skipping.');
      throw new Error('Backup already in progress');
    }
    this.isRunning = true;

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sqlFile = path.join(this.backupDir, `abscloud_dbbackup_${stamp}.sql`);
    const zipFile = path.join(this.backupDir, `abscloud_dbbackup_${stamp}.zip`);

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });

      const dbConfig = {
        host: this.config.get<string>('DB_HOST', 'localhost'),
        port: this.config.get<number>('DB_PORT', 3306),
        user: this.config.get<string>('DB_USERNAME', 'root'),
        password: this.config.get<string>('DB_PASSWORD', ''),
        database: this.config.get<string>('DB_DATABASE', ''),
      };

      this.logger.log(`Dumping database: ${dbConfig.database}...`);
      await (mysqldump as any)({
        connection: dbConfig,
        dumpToFile: sqlFile,
      });
      const sqlSizeKb = Number((fs.statSync(sqlFile).size / 1024).toFixed(1));
      this.logger.log(`Dump complete (${sqlSizeKb} KB). Compressing...`);

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipFile);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.file(sqlFile, { name: path.basename(sqlFile) });
        archive.finalize();
      });
      const zipSizeKb = Number((fs.statSync(zipFile).size / 1024).toFixed(1));
      this.logger.log(`Zip ready (${zipSizeKb} KB). Emailing...`);

      const transporter = nodemailer.createTransport({
        host: this.config.get<string>('MAIL_HOST'),
        port: this.config.get<number>('MAIL_PORT', 587),
        secure: this.config.get<number>('MAIL_PORT', 587) === 465,
        auth: {
          user: this.config.get<string>('MAIL_USER'),
          pass: this.config.get<string>('MAIL_PASS'),
        },
      });

      const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      await transporter.sendMail({
        from: this.config.get<string>('MAIL_FROM'),
        to: this.config.get<string>('MAIL_TO'),
        subject: `[ABSCLOUD-DBBACKUP] Database Backup — ${dateStr}`,
        headers: { 'X-ABSCloud-Backup': 'true' },
        html: `
          <div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#1d4ed8">ABS Cloud — Database Backup</h2>
            <table style="border-collapse:collapse;width:100%;font-size:14px">
              <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Date</td>
                  <td style="padding:6px 12px">${now.toLocaleString('en-IN')}</td></tr>
              <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Database</td>
                  <td style="padding:6px 12px">${dbConfig.database}</td></tr>
              <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">SQL Size</td>
                  <td style="padding:6px 12px">${sqlSizeKb} KB</td></tr>
              <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Zip Size</td>
                  <td style="padding:6px 12px">${zipSizeKb} KB</td></tr>
            </table>
            <p style="color:#64748b;font-size:13px;margin-top:16px">Backup attached. Keep it safe.</p>
          </div>
        `,
        attachments: [{ filename: path.basename(zipFile), path: zipFile }],
      });
      this.logger.log('Backup email sent successfully.');

      // Cleanup: remove the raw .sql (zip is kept), prune zips older than 15 days
      fs.unlinkSync(sqlFile);
      const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(this.backupDir)) {
        if (!f.startsWith('abscloud_dbbackup_') || !f.endsWith('.zip')) continue;
        const fp = path.join(this.backupDir, f);
        if (fs.statSync(fp).mtimeMs < fifteenDaysAgo) {
          fs.unlinkSync(fp);
          this.logger.log(`Deleted old local backup: ${f}`);
        }
      }

      return { sqlSizeKb, zipSizeKb };
    } catch (e: any) {
      this.logger.error(`Backup failed: ${e.message}`);
      throw e;
    } finally {
      this.isRunning = false;
    }
  }
}
