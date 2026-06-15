import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../services/users.service';
import { AuthService } from '../services/auth.service';
import { DbService } from '../database/db.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
    private authService: AuthService,
    private db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      // Standardize user identifier resolution
      const userId = payload.sub || payload.userId;
      const sessionId = payload.sessionId;

      if (!userId) {
        throw new UnauthorizedException('Invalid token payload');
      }

      // Fetch user to check status
      const user = await this.usersService.findById(userId);

      if (!user || user.status === 'inactive') {
        throw new UnauthorizedException('User not found or account inactive');
      }

      // Centralized session validation
      const isValid = await this.authService.validateSession(userId, sessionId);

      if (!isValid) {
        throw new UnauthorizedException('Session expired or invalid. Please login again.');
      }

      // Preserve token mappings (adminId, adminName, sessionId, deviceType) that
      // were generated at login. sessionId lets logout target only this device.
      request.user = {
        ...user,
        adminId: payload.adminId,
        adminName: payload.adminName,
        sessionId: payload.sessionId,
        deviceType: payload.deviceType,
      };
      
      return true;
    } catch (e: any) {
      // Expected auth failures (stale session, expired token, inactive user)
      // do not need a stack trace — the client gets 401 and re-authenticates.
      if (e instanceof UnauthorizedException) throw e;

      // Truly unexpected (DB error, malformed JWT, signature mismatch, etc.)
      console.error(`[AUTH GUARD] Unexpected auth failure:`, e.stack || e.message);
      const msg = e?.name === 'TokenExpiredError' ? 'Token expired' : (e?.message || 'Invalid token');
      throw new UnauthorizedException(msg);
    }
  }

  private extractToken(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
