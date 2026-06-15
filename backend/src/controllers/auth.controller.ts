import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional } from 'class-validator';
import { AuthService } from '../services/auth.service';
import { AuditService } from '../services/audit.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

class LoginDto {
  @IsEmail()
  @IsString()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  otp?: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsString()
  device_type?: string;
}

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private auditService: AuditService
  ) { }

  @Get('health')
  @ApiOperation({ summary: 'Health check (DB independent)' })
  checkHealth() {
    return { status: 'ok', timestamp: Date.now(), service: 'abs-backend' };
  }

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  async login(@Body() dto: LoginDto, @Request() req: any) {
    const result = await this.authService.login(dto.email, dto.password, dto.otp, dto.secret, dto.device_type);

    if (result.success && result.token) {
      try {
        await this.auditService.log({
          user_id: result.user.id,
          user_name: result.user.name,
          action: 'LOGIN',
          resource: 'Auth',
          details: 'User logged in',
          ip_address: req.ip || req.connection.remoteAddress,
          user_agent: req.headers['user-agent']
        });
      } catch (error) {
        console.error('Audit log failed:', error);
      }
    }
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret' })
  async generateTwoFactor(@Request() req: any) {
    return this.authService.generateTwoFactorSecret(req.user.email);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA' })
  async enableTwoFactor(@Request() req: any, @Body() body: { token: string; secret: string }) {
    const isVerified = await this.authService.verifyAndEnableTwoFactor(req.user.id, body.token, body.secret);
    if (!isVerified) {
      return { success: false, message: 'Invalid token' };
    }
    return { success: true, message: '2FA enabled successfully' };
  }

  @Post('profile/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change personal password with 2FA' })
  async changePassword(
    @Request() req: any,
    @Body() body: { currentPass: string; newPass: string; otp: string }
  ) {
    return this.authService.changePassword(
      req.user.id,
      body.currentPass,
      body.newPass,
      body.otp
    );
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTwoFactor(@Request() req: any) {
    await this.authService.disableTwoFactor(req.user.id);
    return { success: true, message: '2FA disabled successfully' };
  }

  @Get('sessions/active')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions count' })
  async getActiveSessions() {
    return this.authService.getActiveSessions();
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Request() req: any) {
    this.authService.removeSession(req.user.id, req.user.sessionId);

    this.auditService.log({
      user_id: req.user.id,
      user_name: req.user.email, // Or fetch name if available
      action: 'LOGOUT',
      resource: 'Auth',
      details: 'User logged out',
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.headers['user-agent']
    });

    return { success: true, message: 'Logged out successfully' };
  }

  @Post('session/unlock')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlock session with 2FA' })
  async unlockSession(@Request() req: any, @Body() body: { otp: string }) {
    const result = await this.authService.unlockSession(req.user.id, body.otp);
    return result;
  }
}
