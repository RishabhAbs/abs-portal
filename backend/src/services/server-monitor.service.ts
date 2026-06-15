import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DbService } from '../database/db.service';
import * as net from 'net';
import { exec } from 'child_process';
import * as os from 'os';

export interface MonitorRecord {
  id: number;
  customer_ip: string;
  customer_name: string | null;
  port: number;
  status: 'up' | 'down' | 'unknown';
  last_checked_at: string | null;
  last_up_at: string | null;
  last_down_at: string | null;
  downtime_start: string | null;
  is_active: number;
  created_at: string;
}

export interface MonitorLog {
  id: number;
  customer_ip: string;
  event: 'up' | 'down';
  event_at: string;
  downtime_seconds: number | null;
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
// Parse a UTC datetime string from MySQL (no timezone suffix) as UTC, not local time
const parseUtc = (s: string) => new Date(s.replace(' ', 'T') + 'Z');

const isWin = os.platform() === 'win32';

// Method 1: TCP connect to Tally port (no process spawn)
function checkTcp(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; socket.destroy(); resolve(ok); } };
    socket.setTimeout(3000);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.connect(port, host);
  });
}

// Method 2: ICMP ping fallback (windowsHide:true = no visible CMD window)
function checkPing(host: string): Promise<boolean> {
  const cmd = isWin ? `ping -n 1 -w 2000 ${host}` : `ping -c 1 -W 2 ${host}`;
  return new Promise(resolve => {
    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      const out = stdout.toLowerCase();
      resolve(isWin
        ? out.includes('bytes=') || out.includes('reply from')
        : out.includes('1 received') || out.includes('1 packets received'));
    });
  });
}

// Returns true only for valid hostnames or dotted IPs.
// Rejects pure integers (e.g. "1018103187") which are DB record IDs
// accidentally stored in customer_ip — they map to random internet IPs
// and produce false-positive results.
function isValidHost(host: string): boolean {
  if (!host || !host.trim()) return false;
  if (/^\d+$/.test(host)) return false; // pure integer — not a real IP
  return true;
}

// Three-stage check:
//   1. TCP on Tally port — fastest, no process spawn
//   2. ICMP ping fallback — catches servers with Tally port firewalled
//   3. HTTPS port 443 — TS Plus web interface, always public-facing
//      (covers private-network servers like 103.234.186.x whose Tally port
//       is only reachable from inside the Tally cloud network)
async function isHostAlive(host: string, port: number): Promise<boolean> {
  const tcpOk = await checkTcp(host, port);
  if (tcpOk) return true;
  const pingOk = await checkPing(host);
  if (pingOk) return true;
  if (port !== 443) return checkTcp(host, 443);
  return false;
}

@Injectable()
export class ServerMonitorService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  // 10-minute interval — less aggressive, and only runs on production (Linux)
  private readonly INTERVAL_MS = 10 * 60 * 1000;
  private running = false;
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    // Auto-checks only run in production (Linux server).
    // On local dev (Windows) they are disabled to prevent spawning hundreds
    // of processes that crash the machine.
    if (!this.isProduction) return;
    setTimeout(() => {
      this.runChecks().catch(() => {});
      this.timer = setInterval(() => this.runChecks().catch(() => {}), this.INTERVAL_MS);
    }, 30000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async checkSingle(customerIp: string): Promise<{ status: 'up' | 'down'; checked: boolean }> {
    const monitor = await this.db.queryOne<MonitorRecord>(
      'SELECT * FROM server_monitor WHERE customer_ip = ?',
      [customerIp],
    );
    if (!monitor) return { status: 'down', checked: false };
    await this.checkOne(monitor);
    const updated = await this.db.queryOne<{ status: string }>(
      'SELECT status FROM server_monitor WHERE customer_ip = ?',
      [customerIp],
    );
    return { status: (updated?.status ?? 'down') as 'up' | 'down', checked: true };
  }

  async runChecks(): Promise<{ checked: number }> {
    if (this.running) return { checked: 0 };
    this.running = true;
    try {
      const monitors = await this.db.query<MonitorRecord>(
        'SELECT * FROM server_monitor WHERE is_active = 1',
        [],
      );
      // TCP sockets — pure Node.js, no OS processes spawned, safe to run 10 at once
      const BATCH = 10;
      for (let i = 0; i < monitors.length; i += BATCH) {
        await Promise.all(monitors.slice(i, i + BATCH).map(m => this.checkOne(m)));
      }
      return { checked: monitors.length };
    } finally {
      this.running = false;
    }
  }

  private async checkOne(monitor: MonitorRecord): Promise<void> {
    const timestamp = now();
    if (!isValidHost(monitor.customer_ip)) {
      // Bad data in customer_ip — mark unknown so it's visible but not falsely Online
      await this.db.execute(
        `UPDATE server_monitor SET status = 'unknown', last_checked_at = ? WHERE id = ?`,
        [timestamp, monitor.id],
      );
      return;
    }
    const isUp = await isHostAlive(monitor.customer_ip, monitor.port);
    const newStatus: 'up' | 'down' = isUp ? 'up' : 'down';

    const fields: string[] = ['last_checked_at = ?'];
    const vals: any[] = [timestamp];

    const statusChanged = (monitor.status as string) !== newStatus;
    if (statusChanged || monitor.status === 'unknown') {
      fields.push('status = ?');
      vals.push(newStatus);

      if (newStatus === 'down') {
        fields.push('last_down_at = ?', 'downtime_start = ?');
        vals.push(timestamp, timestamp);
        await this.db.execute(
          'INSERT INTO server_monitor_logs (customer_ip, event, event_at) VALUES (?, ?, ?)',
          [monitor.customer_ip, 'down', timestamp],
        );
      } else {
        fields.push('last_up_at = ?', 'downtime_start = NULL');
        vals.push(timestamp);
        let downtimeSecs: number | null = null;
        if (monitor.downtime_start) {
          downtimeSecs = Math.floor(
            (Date.now() - parseUtc(monitor.downtime_start).getTime()) / 1000,
          );
        }
        await this.db.execute(
          'INSERT INTO server_monitor_logs (customer_ip, event, event_at, downtime_seconds) VALUES (?, ?, ?, ?)',
          [monitor.customer_ip, 'up', timestamp, downtimeSecs],
        );
      }
    }

    vals.push(monitor.id);
    await this.db.execute(
      `UPDATE server_monitor SET ${fields.join(', ')} WHERE id = ?`,
      vals,
    );
  }

  async syncFromMappings(): Promise<{ added: number; total: number }> {
    const ips = await this.db.query<{ customer_ip: string; company: string; port: string }>(
      `SELECT DISTINCT s.customer_ip, c.company, s.port
       FROM cloud_mappings m
       JOIN cloud_servers s ON m.server_id = s.id
       JOIN customer c ON m.customer_id = c.id
       WHERE s.customer_ip IS NOT NULL AND s.customer_ip != ''
         AND m.status = 'Active'
         AND s.ping_test = 1`,
      [],
    );
    let added = 0;
    for (const row of ips) {
      if (!isValidHost(row.customer_ip)) continue; // skip bad data
      const port = parseInt(row.port, 10) || 9000;
      const existing = await this.db.queryOne(
        'SELECT id FROM server_monitor WHERE customer_ip = ?',
        [row.customer_ip],
      );
      if (!existing) {
        await this.db.execute(
          'INSERT INTO server_monitor (customer_ip, customer_name, port) VALUES (?, ?, ?)',
          [row.customer_ip, row.company, port],
        );
        added++;
      } else {
        // Keep name and port in sync with cloud_servers
        await this.db.execute(
          'UPDATE server_monitor SET customer_name = ?, port = ? WHERE customer_ip = ?',
          [row.company, port, row.customer_ip],
        );
      }
    }
    return { added, total: ips.length };
  }

  async getAll(search = ''): Promise<(MonitorRecord & { total_downtime_seconds: number })[]> {
    const like = `%${search}%`;
    return this.db.query<MonitorRecord & { total_downtime_seconds: number }>(
      `SELECT m.*,
              COALESCE(l.total_downtime, 0) AS total_downtime_seconds
       FROM server_monitor m
       LEFT JOIN (
         SELECT customer_ip, SUM(downtime_seconds) AS total_downtime
         FROM server_monitor_logs
         WHERE event = 'up'
         GROUP BY customer_ip
       ) l ON l.customer_ip = m.customer_ip
       WHERE m.customer_ip LIKE ? OR m.customer_name LIKE ?
       ORDER BY FIELD(m.status,'down','unknown','up'), m.customer_name`,
      [like, like],
    );
  }

  async getStatusMap(): Promise<Record<string, 'up' | 'down' | 'unknown'>> {
    const rows = await this.db.query<{ customer_ip: string; status: string }>(
      'SELECT customer_ip, status FROM server_monitor WHERE is_active = 1',
      [],
    );
    return Object.fromEntries(rows.map(r => [r.customer_ip, r.status as any]));
  }

  async getLogs(customerIp: string, limit = 50): Promise<MonitorLog[]> {
    return this.db.query<MonitorLog>(
      'SELECT * FROM server_monitor_logs WHERE customer_ip = ? ORDER BY event_at DESC LIMIT ?',
      [customerIp, limit],
    );
  }

  async updatePort(customerIp: string, port: number): Promise<void> {
    await this.db.execute(
      'UPDATE server_monitor SET port = ? WHERE customer_ip = ?',
      [port, customerIp],
    );
  }

  async setActive(customerIp: string, isActive: boolean): Promise<void> {
    await this.db.execute(
      'UPDATE server_monitor SET is_active = ? WHERE customer_ip = ?',
      [isActive ? 1 : 0, customerIp],
    );
  }
}
