import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServerMonitorService } from '../services/server-monitor.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Server Monitor')
@Controller('api/server-monitor')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ServerMonitorController {
  constructor(private readonly svc: ServerMonitorService) {}

  @Get()
  @RequirePermission('server_monitor', 'view')
  @ApiOperation({ summary: 'List all monitored IPs with current status' })
  async getAll(@Query('search') search = '') {
    const data = await this.svc.getAll(search);
    return { success: true, data };
  }

  @Get('statuses')
  @RequirePermission('server_monitor', 'view')
  @ApiOperation({ summary: 'IP → status map for mapping page dots' })
  async getStatusMap() {
    const data = await this.svc.getStatusMap();
    return { success: true, data };
  }

  @Post('sync')
  @RequirePermission('server_monitor', 'edit')
  @ApiOperation({ summary: 'Sync monitored IPs from active mappings' })
  async sync() {
    const result = await this.svc.syncFromMappings();
    return { success: true, ...result, message: `Synced — ${result.added} new IPs added` };
  }

  @Post('check-now')
  @RequirePermission('server_monitor', 'view')
  @ApiOperation({ summary: 'Trigger an immediate check of all IPs' })
  async checkNow() {
    const result = await this.svc.runChecks();
    return { success: true, ...result, message: `Checked ${result.checked} servers` };
  }

  @Post(':ip/check')
  @RequirePermission('server_monitor', 'view')
  @ApiOperation({ summary: 'Check a single IP right now' })
  async checkSingle(@Param('ip') ip: string) {
    const result = await this.svc.checkSingle(decodeURIComponent(ip));
    return { success: true, ...result };
  }

  @Get(':ip/logs')
  @RequirePermission('server_monitor', 'view')
  @ApiOperation({ summary: 'Event history for an IP' })
  async getLogs(@Param('ip') ip: string, @Query('limit') limit = '50') {
    const data = await this.svc.getLogs(decodeURIComponent(ip), parseInt(limit, 10));
    return { success: true, data };
  }

  @Patch(':ip/port')
  @RequirePermission('server_monitor', 'edit')
  @ApiOperation({ summary: 'Update the port being checked for an IP' })
  async updatePort(@Param('ip') ip: string, @Body() body: { port: number }) {
    await this.svc.updatePort(decodeURIComponent(ip), body.port);
    return { success: true, message: 'Port updated' };
  }

  @Patch(':ip/active')
  @RequirePermission('server_monitor', 'edit')
  @ApiOperation({ summary: 'Enable or disable monitoring for an IP' })
  async setActive(@Param('ip') ip: string, @Body() body: { is_active: boolean }) {
    await this.svc.setActive(decodeURIComponent(ip), body.is_active);
    return { success: true };
  }
}
