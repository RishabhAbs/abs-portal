import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Users')
@Controller('api/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) { }

  @Get('network')
  @ApiOperation({ summary: 'Get all user locations for network view' })
  @RequirePermission('users', 'view')
  async getNetwork() {
    const users = await this.usersService.getNetworkStats();
    return { success: true, data: users };
  }

  @Get(':id/location-history')
  @ApiOperation({ summary: 'Get raw location history for a user on a specific date' })
  @RequirePermission('users', 'view')
  async getLocationHistory(@Param('id') id: string, @Query('date') date: string) {
    const history = await this.usersService.getLocationHistory(id, date);
    return { success: true, data: history };
  }

  @Post('location')
  @ApiOperation({ summary: 'Update current user location' })
  async updateLocation(@Body() body: { lat: number; lng: number }, @Request() req: any) {
    if (!req.user || !req.user.id) return { success: false, message: 'User not found' };
    await this.usersService.updateLocation(req.user.id, body.lat, body.lng);
    return { success: true, message: 'Location updated' };
  }

  @Get('basic')
  @ApiOperation({ summary: 'Get basic user list for dropdowns' })
  async findBasic() {
    const users = await this.usersService.getBasicUsers();
    return { success: true, data: users };
  }

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @RequirePermission('users', 'view')
  async findAll() {
    const users = await this.usersService.findAll();
    return { success: true, data: users };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @RequirePermission('users', 'view')
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    return { success: true, data: user };
  }

  @Post()
  @ApiOperation({ summary: 'Create new user' })
  @RequirePermission('users', 'create')
  async create(@Body() data: any) {
    const user = await this.usersService.create(data);
    return { success: true, data: user, message: 'User created successfully' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user' })
  @RequirePermission('users', 'edit')
  async update(@Param('id') id: string, @Body() data: any) {
    const user = await this.usersService.update(id, data);
    return { success: true, data: user, message: 'User updated successfully' };
  }

  @Put(':id/password')
  @ApiOperation({ summary: 'Update user password' })
  @RequirePermission('users', 'edit')
  async updatePassword(@Param('id') id: string, @Body() data: { password: string }) {
    await this.usersService.updatePassword(id, data.password);
    return { success: true, message: 'Password updated successfully' };
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Update user permissions' })
  @RequirePermission('users', 'edit')
  async updatePermissions(@Param('id') id: string, @Body() data: { permissions: any }) {
    const user = await this.usersService.updatePermissions(id, data.permissions);
    return { success: true, data: user, message: 'Permissions updated successfully' };
  }

  @Put(':id/column-permissions')
  @ApiOperation({ summary: 'Update user column-level permissions' })
  @RequirePermission('users', 'edit')
  async updateColumnPermissions(@Param('id') id: string, @Body() data: { column_permissions: any }) {
    const user = await this.usersService.updateColumnPermissions(id, data.column_permissions);
    return { success: true, data: user, message: 'Column permissions updated successfully' };
  }

  @Post(':id/2fa/reset')
  @ApiOperation({ summary: 'Reset user 2FA' })
  @RequirePermission('users', 'edit')
  async reset2FA(@Param('id') id: string) {
    await this.usersService.resetTwoFactor(id);
    return { success: true, message: '2FA reset successfully' };
  }

  @Post(':id/2fa/generate')
  @ApiOperation({ summary: 'Generate 2FA secret for any user' })
  @RequirePermission('users', 'edit')
  async generate2FA(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    // We can reuse a local method or logic to generate
    const secret = require('speakeasy').generateSecret({
      name: `ABS Cloud (${user.email})`
    });
    // Store secret temporarily or just return it? 
    // Usually we return it for the admin to show the QR, then the admin "Enables" it.
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  @Post(':id/2fa/enable')
  @ApiOperation({ summary: 'Enable 2FA for any user' })
  @RequirePermission('users', 'edit')
  async enable2FA(@Param('id') id: string, @Body() body: { secret: string; token: string }) {
    // Verify the token against the secret before enabling
    const isValid = require('speakeasy').totp.verify({
      secret: body.secret,
      encoding: 'base32',
      token: body.token,
      window: 2
    });

    if (!isValid) {
      return { success: false, message: 'Invalid 2FA code. Please verify the code from your authenticator app.' };
    }

    await this.usersService.setTwoFactorSecret(id, body.secret);
    await this.usersService.enableTwoFactor(id);
    return { success: true, message: '2FA enabled for user' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  @RequirePermission('users', 'delete')
  async remove(@Param('id') id: string) {
    await this.usersService.delete(id);
    return { success: true, message: 'User deleted successfully' };
  }
}
