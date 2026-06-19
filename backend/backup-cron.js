/**
 * ABS Cloud — Database Backup + Email Script
 * ============================================
 * Dumps the full MySQL database, zips it, emails to configured address.
 *
 * Run manually : node backup-cron.js
 * cPanel Cron  : 0 2 * * * /usr/local/bin/node /home/USERNAME/backend/backup-cron.js >> /home/USERNAME/backup.log 2>&1
 */

'use strict';

const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');
const archiver   = require('archiver');     // bundled via mysqldump dep
const nodemailer = require('nodemailer');
const mysqldump  = require('mysqldump');

// ─────────────────────────────────────────────
//  CONFIGURATION — edit before deploying
// ─────────────────────────────────────────────
const CONFIG = {
  db: {
    host     : process.env.DB_HOST     || 'localhost',
    port     : parseInt(process.env.DB_PORT || '3306'),
    user     : process.env.DB_USERNAME || 'root',
    password : process.env.DB_PASSWORD || 'password',
    database : process.env.DB_DATABASE || 'abs_cloud',
  },
  mail: {
    // SMTP settings — use Gmail App Password or cPanel mail
    host    : process.env.MAIL_HOST || 'smtp.gmail.com',
    port    : parseInt(process.env.MAIL_PORT || '587'),
    secure  : false,                              // true for port 465
    user    : process.env.MAIL_USER || 'your-email@gmail.com',
    pass    : process.env.MAIL_PASS || 'your-app-password',
    from    : process.env.MAIL_FROM || 'ABS Cloud Backup <your-email@gmail.com>',
    to      : process.env.MAIL_TO   || 'backup-recipient@example.com',
  },
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, 'backups'),
};
// ─────────────────────────────────────────────

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function run() {
  const now       = new Date();
  const stamp     = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sqlFile   = path.join(CONFIG.backupDir, `abscloud_dbbackup_${stamp}.sql`);
  const zipFile   = path.join(CONFIG.backupDir, `abscloud_dbbackup_${stamp}.zip`);

  // 1. Create backup directory
  fs.mkdirSync(CONFIG.backupDir, { recursive: true });

  // 2. Dump database to SQL file
  log(`Dumping database: ${CONFIG.db.database}...`);
  await mysqldump({
    connection: {
      host    : CONFIG.db.host,
      port    : CONFIG.db.port,
      user    : CONFIG.db.user,
      password: CONFIG.db.password,
      database: CONFIG.db.database,
    },
    dumpToFile: sqlFile,
  });
  const sqlSize = (fs.statSync(sqlFile).size / 1024).toFixed(1);
  log(`Dump complete: ${sqlFile} (${sqlSize} KB)`);

  // 3. Zip the SQL file
  log('Compressing...');
  await new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(zipFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(sqlFile, { name: path.basename(sqlFile) });
    archive.finalize();
  });
  const zipSize = (fs.statSync(zipFile).size / 1024).toFixed(1);
  log(`Zip ready: ${zipFile} (${zipSize} KB)`);

  // 4. Send email with zip attachment
  log(`Sending email to ${CONFIG.mail.to}...`);
  const transporter = nodemailer.createTransport({
    host  : CONFIG.mail.host,
    port  : CONFIG.mail.port,
    secure: CONFIG.mail.secure,
    auth  : { user: CONFIG.mail.user, pass: CONFIG.mail.pass },
  });

  const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  await transporter.sendMail({
    from   : CONFIG.mail.from,
    to     : CONFIG.mail.to,
    subject: `[ABSCLOUD-DBBACKUP] Database Backup — ${dateStr}`,
    headers: { 'X-ABSCloud-Backup': 'true' },
    html   : `
      <div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#1d4ed8">ABS Cloud — Database Backup</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Date</td>
              <td style="padding:6px 12px">${now.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Database</td>
              <td style="padding:6px 12px">${CONFIG.db.database}</td></tr>
          <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">SQL Size</td>
              <td style="padding:6px 12px">${sqlSize} KB</td></tr>
          <tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Zip Size</td>
              <td style="padding:6px 12px">${zipSize} KB</td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;margin-top:16px">
          Backup attached. Keep it safe.
        </p>
      </div>
    `,
    attachments: [{ filename: path.basename(zipFile), path: zipFile }],
  });
  log('Email sent successfully.');

  // 5. Cleanup SQL file (keep zip for 15 days)
  fs.unlinkSync(sqlFile);

  // 6. Delete zips older than 15 days
  const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(CONFIG.backupDir)) {
    if (!f.startsWith('abscloud_dbbackup_') || !f.endsWith('.zip')) continue;
    const fp = path.join(CONFIG.backupDir, f);
    if (fs.statSync(fp).mtimeMs < fifteenDaysAgo) {
      fs.unlinkSync(fp);
      log(`Deleted old backup: ${f}`);
    }
  }

  log('Backup complete.\n');
}

run().catch(err => {
  console.error(`[${new Date().toISOString()}] BACKUP FAILED:`, err.message);
  process.exit(1);
});
