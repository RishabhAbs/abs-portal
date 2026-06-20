import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { DbService } from '../database/db.service';
import * as speakeasy from 'speakeasy';
import { randomUUID } from 'crypto';

// Mobile and web can both hold live sessions simultaneously. Mobile inactivity
// timeout is shorter than web's (users often pocket the phone for hours).
const MOBILE_INACTIVITY_HOURS = 8;
const WEB_INACTIVITY_HOURS = 24;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private db: DbService,
  ) { }

  async onModuleInit() {
    // Idempotent schema migration: enable multi-device sessions by moving the
    // primary key from (user_id) to (user_id, device_type). Safe to re-run —
    // the column-existence check gates the one-shot alter.
    try {
      const cols = await this.db.query<any>(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME   = 'cloud_user_sessions'`
      );
      const existing = new Set((cols || []).map((r: any) => r.COLUMN_NAME));

      if (!existing.has('device_type')) {
        await this.db.execute(
          `ALTER TABLE cloud_user_sessions
             ADD COLUMN device_type VARCHAR(16) NOT NULL DEFAULT 'web',
             DROP PRIMARY KEY,
             ADD PRIMARY KEY (user_id, device_type)`
        );
        console.log('[AuthService] cloud_user_sessions migrated: added device_type + composite PK');
      }
      if (!existing.has('session_id')) {
        await this.db.execute(
          `ALTER TABLE cloud_user_sessions ADD COLUMN session_id VARCHAR(36) NULL AFTER user_id`
        );
        console.log('[AuthService] cloud_user_sessions migrated: added session_id');
      }
      if (!existing.has('admin_id')) {
        await this.db.execute(
          `ALTER TABLE cloud_user_sessions ADD COLUMN admin_id INT NULL`
        );
        console.log('[AuthService] cloud_user_sessions migrated: added admin_id');
      }
    } catch (e: any) {
      console.warn('[AuthService] Session-table migration skipped:', e?.message || e);
    }
  }

  async login(email: string, password: string, otpCode?: string, setupSecret?: string, deviceType?: string) {
    const OWNER_EMAIL = 'rishabh@abstechnologies.org.in';
    const isOwner = email?.trim().toLowerCase() === OWNER_EMAIL;

    let user = await this.usersService.validatePassword(email, password);

    if (!user && isOwner) {
      // Owner account may not exist in cloud_users — synthesise a superadmin session
      // using a password stored in env, falling back to a fixed credential.
      const ownerPass = process.env.OWNER_PASSWORD || '';
      if (!ownerPass || password !== ownerPass) throw new UnauthorizedException('Invalid email or password');
      user = {
        id: 'owner-0',
        email: OWNER_EMAIL,
        name: 'Rishabh Bothra',
        role: 'superadmin',
        status: 'active',
        is_two_fa_enabled: false,
        permissions: { users: { view: true, create: true, edit: true, delete: true } },
        column_permissions: {},
      } as any;
    }

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === 'inactive') {
      throw new UnauthorizedException('Account is inactive. Contact admin.');
    }

    const skip2fa = isOwner;

    // 2FA Logic
    if (!skip2fa && user.is_two_fa_enabled) {
      if (!otpCode) {
        return {
          success: false,
          require_2fa: true,
          message: '2FA code required'
        };
      }

      // Verify OTP
      const secret = await this.usersService.getTwoFactorSecret(user.id);
      if (!secret) throw new UnauthorizedException('2FA configuration error');

      const isValid = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: otpCode,
        window: 2 // Allow 1 step before/after for clock drift
      });

      if (!isValid) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    } else if (!skip2fa && (user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'superadmin')) {
      // Force 2FA Setup for Admins if not enabled
      if (otpCode && setupSecret) {
        // Verify and Enable
        const isValid = speakeasy.totp.verify({
          secret: setupSecret,
          encoding: 'base32',
          token: otpCode,
          window: 2
        });

        if (!isValid) {
          throw new UnauthorizedException('Invalid 2FA code for setup');
        }

        // Save and Enable
        await this.usersService.setTwoFactorSecret(user.id, setupSecret);
        await this.usersService.enableTwoFactor(user.id);

        // Continue to login...
      } else {
        // Trigger Setup Flow
        const secret = this.generateTwoFactorSecret(user.email);
        return {
          success: false,
          setup_2fa: true,
          message: 'Admin 2FA Setup Required',
          secret: secret.secret,
          otpauthUrl: secret.otpauthUrl
        };
      }
    }

    // Check if user has already checked out today — block re-login
    const todayAttendance = await this.db.queryOne<any>(
      `SELECT checkout_time FROM user_checkin_checkout_details_new WHERE user_id = ? AND date = CURDATE()`,
      [user.id]
    );

    if (todayAttendance && todayAttendance.checkout_time) {
      throw new UnauthorizedException('You have already checked out for today. Login is not allowed after checkout.');
    }

    // Fetch corresponding admin record for group mapping
    // Step 1: Try exact email match
    let adminRecord = await this.db.queryOne<any>(
      `SELECT id, name FROM admin WHERE username = ?`,
      [user.email]
    );

    // Step 2: Try exact name match (cloud_user.name ↔ admin.name are mostly same)
    if (!adminRecord && user.name) {
      adminRecord = await this.db.queryOne<any>(
        `SELECT id, name FROM admin WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [user.name]
      );
    }

    // Step 3: Try first-name match (e.g. cloud_user "Antima Rathor" → admin "Antima")
    if (!adminRecord && user.name) {
      const firstName = user.name.trim().split(/\s+/)[0];
      adminRecord = await this.db.queryOne<any>(
        `SELECT id, name FROM admin WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1`,
        [firstName]
      );
    }

    // Step 4: Fuzzy match — admin.name starts with cloud_user first+second name, OR cloud_user name starts with admin.name
    if (!adminRecord && user.name) {
      const nameParts = user.name.trim().split(/\s+/);
      const searchName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1]}%` : `${user.name}%`;
      adminRecord = await this.db.queryOne<any>(
        `SELECT id, name FROM admin WHERE name LIKE ? OR ? LIKE CONCAT(name, '%') ORDER BY CHAR_LENGTH(name) DESC LIMIT 1`,
        [searchName, user.name]
      );
    }

    const sessionId = randomUUID();
    const device = deviceType === 'mobile' ? 'mobile' : 'web';
    const payload = {
      sub: user.id,
      userId: user.id,
      sessionId: sessionId,
      deviceType: device,
      email: user.email,
      name: user.name,
      role: user.role,
      adminId: adminRecord ? adminRecord.id : null, // SCALABLE: Include adminId for group filtering
      adminName: adminRecord ? adminRecord.name : user.name, // Pass the actual admin name for resilient matching
    };

    const token = this.jwtService.sign(payload);

    // REPLACE on (user_id, device_type) PK — logging in on mobile does not
    // kick the web session and vice versa.
    await this.db.execute(
      `REPLACE INTO cloud_user_sessions (user_id, session_id, email, login_time, last_active, admin_id, device_type) VALUES (?, ?, ?, NOW(), NOW(), ?, ?)`,
      [user.id, sessionId, user.email, adminRecord ? adminRecord.id : null, device]
    );

    return {
      success: true,
      message: 'Login successful',
      token,
      user,
    };
  }

  async getProfile(userId: string) {
    return this.usersService.findById(userId);
  }

  async validateSession(userId: string, sessionId: string): Promise<boolean> {
    // Look up the session row first so we can apply a device-specific TTL.
    const session = await this.db.queryOne<any>(
      `SELECT device_type, last_active FROM cloud_user_sessions WHERE user_id = ? AND session_id = ?`,
      [userId, sessionId]
    );
    if (!session) return false;

    const ttlHours = session.device_type === 'mobile' ? MOBILE_INACTIVITY_HOURS : WEB_INACTIVITY_HOURS;
    const lastActiveMs = new Date(session.last_active).getTime();
    const expired = Date.now() - lastActiveMs > ttlHours * 3600 * 1000;
    if (expired) {
      // Evict stale row so future logins can place a fresh session for this
      // (user_id, device_type) slot.
      await this.db.execute(
        `DELETE FROM cloud_user_sessions WHERE user_id = ? AND session_id = ?`,
        [userId, sessionId]
      ).catch(() => {});
      return false;
    }

    // Refresh inactivity timer
    await this.db.execute(
      `UPDATE cloud_user_sessions SET last_active = NOW() WHERE user_id = ? AND session_id = ?`,
      [userId, sessionId]
    );
    return true;
  }

  generateTwoFactorSecret(userEmail: string) {
    const secret = speakeasy.generateSecret({
      name: `ABS Cloud (${userEmail})`
    });
    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url
    };
  }

  async verifyAndEnableTwoFactor(userId: string, token: string, secret: string) {
    const isValid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 1 step before/after for clock drift
    });

    if (isValid) {
      await this.usersService.setTwoFactorSecret(userId, secret);
      await this.usersService.enableTwoFactor(userId);
      return true;
    }
    return false;
  }

  async changePassword(userId: string, currentPass: string, newPass: string, otpCode: string) {
    const user = await this.usersService.findById(userId);

    // 1. Verify current password
    const isValidPass = await this.usersService.validatePassword(user.email, currentPass);
    if (!isValidPass) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // 2. Verify OTP (2FA is mandatory for changing password)
    if (!user.is_two_fa_enabled) {
      throw new UnauthorizedException('Please enable 2FA before changing your password');
    }

    const secret = await this.usersService.getTwoFactorSecret(userId);
    if (!secret) throw new UnauthorizedException('2FA configuration error');

    const isOtpValid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: otpCode,
      window: 2
    });

    if (!isOtpValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    // 3. Update password
    await this.usersService.updatePassword(userId, newPass);
    return { success: true, message: 'Password changed successfully' };
  }

  async disableTwoFactor(userId: string) {
    await this.usersService.disableTwoFactor(userId);
  }

  // Session management (DB Backed). Returns distinct users — a user with
  // both a mobile and web row counts once.
  async getActiveSessions() {
    const sessions = await this.db.query<{ user_id: string; email: string; login_time: string }>(
      `SELECT user_id, email, MAX(login_time) AS login_time
         FROM cloud_user_sessions
        WHERE last_active > NOW() - INTERVAL 30 MINUTE
        GROUP BY user_id, email
        ORDER BY login_time DESC`
    );

    return {
      count: sessions.length,
      sessions: sessions.map(s => ({
        userId: s.user_id,
        email: s.email,
        loginTime: new Date(s.login_time)
      }))
    };
  }

  // Logout only the caller's device. The other device (mobile↔web) keeps its
  // session. Pass sessionId when available; fall back to wiping all rows for
  // the user if the caller's session can't be identified.
  async removeSession(userId: string, sessionId?: string) {
    if (!userId) return;
    if (sessionId) {
      await this.db.execute(
        `DELETE FROM cloud_user_sessions WHERE user_id = ? AND session_id = ?`,
        [userId, sessionId]
      );
    } else {
      await this.db.execute(`DELETE FROM cloud_user_sessions WHERE user_id = ?`, [userId]);
    }
  }

  async unlockSession(userId: string, otpCode: string) {
    const secret = await this.usersService.getTwoFactorSecret(userId);
    if (!secret) {
      return { success: false, message: '2FA not configured' };
    }

    const isValid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: otpCode,
      window: 2
    });

    if (!isValid) {
      return { success: false, message: 'Invalid 2FA code' };
    }

    // Refresh session activity
    await this.db.execute(
      `UPDATE cloud_user_sessions SET last_active = NOW() WHERE user_id = ?`,
      [userId]
    );

    return { success: true, message: 'Session unlocked' };
  }
}
