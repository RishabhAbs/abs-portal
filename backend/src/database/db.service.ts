import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

@Injectable()
export class DbService implements OnModuleInit {
  private pool: mysql.Pool;

  constructor(private configService: ConfigService) { }

  async onModuleInit() {
    // cPanel shared hosting typically allows only ~25 max_user_connections.
    // Keep pool small (5) to stay well under the limit and avoid exhaustion.
    const connectionLimit = parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10);

    this.pool = mysql.createPool({
      host: this.configService.get('DB_HOST', 'localhost'),
      port: this.configService.get<number>('DB_PORT', 3306),
      user: this.configService.get('DB_USERNAME', 'root'),
      password: this.configService.get('DB_PASSWORD', 'password'),
      database: this.configService.get('DB_DATABASE', 'abs_cloud'),
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,               // unlimited queue (wait instead of error)
      idleTimeout: 30000,          // release idle connections after 30s
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      timezone: '+05:30', // Indian Standard Time (Asia/Kolkata)
      dateStrings: true,
    });
    
    console.log(`[DbService] Pool created — limit: ${connectionLimit}, host: ${this.configService.get('DB_HOST')}:${this.configService.get('DB_PORT')}, db: ${this.configService.get('DB_DATABASE')}`);

    // Set session timezone to Indian Standard Time for all connections
    this.pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+05:30'");
    });

    // Test connection
    try {
      const conn = await this.pool.getConnection();
      conn.release();
      console.log('[DbService] ✅ Connection test passed');
    } catch (error) {
      console.error('❌ MySQL Connection Failed:', error.message);
    }

    // Auto-create missing tables on startup (safe — uses CREATE TABLE IF NOT EXISTS)
    await this.runStartupMigrations();
  }

  private async runStartupMigrations() {
    const migrations: string[] = [
      `CREATE TABLE IF NOT EXISTS \`server_monitor\` (
        \`id\`              INT           NOT NULL AUTO_INCREMENT,
        \`customer_ip\`     VARCHAR(45)   NOT NULL,
        \`customer_name\`   VARCHAR(255)  DEFAULT NULL,
        \`port\`            INT           NOT NULL DEFAULT 9000,
        \`status\`          ENUM('up','down','unknown') NOT NULL DEFAULT 'unknown',
        \`last_checked_at\` DATETIME      DEFAULT NULL,
        \`last_up_at\`      DATETIME      DEFAULT NULL,
        \`last_down_at\`    DATETIME      DEFAULT NULL,
        \`downtime_start\`  DATETIME      DEFAULT NULL,
        \`is_active\`       TINYINT(1)    NOT NULL DEFAULT 1,
        \`created_at\`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_customer_ip\` (\`customer_ip\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS \`server_monitor_logs\` (
        \`id\`               INT          NOT NULL AUTO_INCREMENT,
        \`customer_ip\`      VARCHAR(45)  NOT NULL,
        \`event\`            ENUM('up','down') NOT NULL,
        \`event_at\`         DATETIME     NOT NULL,
        \`downtime_seconds\` INT          DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_customer_ip\` (\`customer_ip\`),
        KEY \`idx_event_at\`    (\`event_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS \`tdl_expiry_records\` (
        \`id\`                    INT           NOT NULL AUTO_INCREMENT,
        \`customer_name\`         VARCHAR(255)  NOT NULL,
        \`tdl_name\`              VARCHAR(255)  NOT NULL,
        \`first_activation_date\` DATE          DEFAULT NULL,
        \`total_amount\`          DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`amc_amount\`            DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`billing_cycle\`         ENUM('monthly','quarterly','half_yearly','yearly') NOT NULL DEFAULT 'yearly',
        \`start_date\`            DATE          DEFAULT NULL,
        \`remark\`                TEXT          DEFAULT NULL,
        \`expiry_date\`           DATE          DEFAULT NULL,
        \`texpiry\`               DATE          DEFAULT NULL,
        \`release_version\`       VARCHAR(100)  DEFAULT NULL,
        \`token\`                 VARCHAR(64)   NOT NULL,
        \`is_active\`             TINYINT(1)    NOT NULL DEFAULT 1,
        \`created_at\`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_token\` (\`token\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

      `CREATE TABLE IF NOT EXISTS \`tdl_billing_activities\` (
        \`id\`            INT           NOT NULL AUTO_INCREMENT,
        \`tdl_expiry_id\` INT           NOT NULL,
        \`customer_name\` VARCHAR(255)  NOT NULL,
        \`tdl_name\`      VARCHAR(255)  NOT NULL,
        \`type\`          ENUM('new','renew') NOT NULL,
        \`cycle\`         ENUM('monthly','quarterly','half_yearly','yearly') NOT NULL,
        \`amc_amount\`    DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`total_amount\`  DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`start_date\`    DATE          DEFAULT NULL,
        \`expiry_date\`   DATE          DEFAULT NULL,
        \`notes\`         TEXT          DEFAULT NULL,
        \`created_at\`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_tdl_expiry_id\` (\`tdl_expiry_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];

    const conn = await this.pool.getConnection();
    try {
      for (const sql of migrations) {
        await conn.query(sql);
      }
      console.log('[DbService] ✅ Startup migrations done');
    } catch (err) {
      console.error('[DbService] ❌ Startup migration error:', err.message);
    } finally {
      conn.release();
    }
  }

  // Transaction Wrapper
  async withTransaction<T>(operation: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await operation(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // Execute SELECT query - returns rows
  // When no explicit connection is passed, we getConnection + release to
  // guarantee the connection is returned to the pool immediately.
  async query<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T[]> {
    if (conn) {
      // Caller owns the connection (e.g. inside a transaction) — don't release
      try {
        const [rows] = await conn.query(sql, params);
        return rows as T[];
      } catch (error) {
        throw this.handleError(error, sql);
      }
    }

    const ownConn = await this.pool.getConnection();
    try {
      const [rows] = await ownConn.query(sql, params);
      return rows as T[];
    } catch (error) {
      throw this.handleError(error, sql);
    } finally {
      ownConn.release();
    }
  }

  // Execute standard query (not prepared) - useful for LIMIT/OFFSET with some drivers/versions
  async queryStandard<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T[]> {
    if (conn) {
      try {
        const [rows] = await conn.query(sql, params);
        return rows as T[];
      } catch (error) {
        throw this.handleError(error, sql);
      }
    }

    const ownConn = await this.pool.getConnection();
    try {
      const [rows] = await ownConn.query(sql, params);
      return rows as T[];
    } catch (error) {
      throw this.handleError(error, sql);
    } finally {
      ownConn.release();
    }
  }

  // Execute INSERT/UPDATE/DELETE - returns result info
  async execute(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<mysql.ResultSetHeader> {
    if (conn) {
      try {
        const [result] = await conn.query(sql, params);
        return result as mysql.ResultSetHeader;
      } catch (error) {
        throw this.handleError(error, sql);
      }
    }

    const ownConn = await this.pool.getConnection();
    try {
      const [result] = await ownConn.query(sql, params);
      return result as mysql.ResultSetHeader;
    } catch (error) {
      throw this.handleError(error, sql);
    } finally {
      ownConn.release();
    }
  }

  // Get single row
  async queryOne<T = any>(sql: string, params: any[] = [], conn?: mysql.PoolConnection): Promise<T | null> {
    const rows = await this.query<T>(sql, params, conn);
    return rows.length > 0 ? rows[0] : null;
  }

  private handleError(error: any, sql: string) {
    const errorInfo = {
      code: error.code || 'UNKNOWN',
      message: error.message,
      sql: sql.substring(0, 100),
      solution: this.getSolution(error.code),
    };


    const customError = new Error(error.message);
    (customError as any).dbError = errorInfo;
    return customError;
  }

  private getSolution(code: string): string {
    const solutions: Record<string, string> = {
      'ER_DUP_ENTRY': 'This record already exists. Try using a different value.',
      'ER_NO_REFERENCED_ROW': 'Referenced record not found. Check if parent record exists.',
      'ER_ROW_IS_REFERENCED': 'Cannot delete. This record is being used elsewhere.',
      'ER_BAD_NULL_ERROR': 'Required field is missing. Please fill all required fields.',
      'ER_ACCESS_DENIED_ERROR': 'Database access denied. Check credentials in .env file.',
      'ECONNREFUSED': 'Cannot connect to database. Make sure MySQL is running.',
      'ER_USER_LIMIT_REACHED': 'Too many database connections. Please try again shortly.',
    };
    return solutions[code] || 'Please check the error details and try again.';
  }
}
