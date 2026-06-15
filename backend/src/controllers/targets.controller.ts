import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';
import { TargetsService } from '../services/targets.service';

@ApiTags('Targets')
@Controller('api/targets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TargetsController {
  constructor(private targetsService: TargetsService) {}

  // ── Get targets ──
  // Admin (or users with targets.view): GET /api/targets?fy=…&user=…
  // Plain users: always scoped to themselves — the service filter below enforces this
  //   even if a non-admin passes a `user` param.
  @Get()
  @ApiOperation({ summary: 'Get targets (own for users, all/filtered for admin)' })
  async getTargets(@Query('fy') fy: string, @Query('user') user: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userName = isAdmin ? (user || undefined) : req.user?.name;
    const rows = await this.targetsService.getTargets(fy, userName);
    return { success: true, data: rows };
  }

  // ── User submits their own full grid (admin-only; users cannot edit their own targets) ──
  @Post('save')
  @ApiOperation({ summary: 'Admin-only — users cannot edit their own targets' })
  async saveGrid(@Body() body: { fy: string; rows: any[] }, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    if (!isAdmin) throw new ForbiddenException('Only admin can set targets');
    const userName = req.user?.name;
    await this.targetsService.saveGrid(userName, body.fy, body.rows, userName);
    return { success: true, message: 'Targets saved' };
  }

  // ── Admin creates/sets targets for any user (approved immediately) ──
  @Post('admin')
  @ApiOperation({ summary: 'Admin creates/sets approved targets for a user' })
  @RequirePermission('targets', 'approve')
  async adminCreate(@Body() body: { user_name: string; fy: string; rows: any[] }, @Request() req: any) {
    await this.targetsService.adminCreate(body.user_name, body.fy, body.rows, req.user?.name);
    return { success: true, message: 'Targets set successfully' };
  }

  // ── Admin edits/approves a single row ──
  @Put(':id')
  @ApiOperation({ summary: 'Admin edits or approves a single target row' })
  @RequirePermission('targets', 'approve')
  async adminUpdate(@Param('id') id: string, @Body() body: any) {
    await this.targetsService.adminUpdate(parseInt(id), body);
    return { success: true, message: 'Updated' };
  }

  // ── Admin: approve all pending for a user+FY ──
  @Post('approve-all')
  @ApiOperation({ summary: 'Admin approves all pending targets for a user+FY' })
  @RequirePermission('targets', 'approve')
  async approveAll(@Body() body: { user_name: string; fy: string }) {
    await this.targetsService.approveAll(body.user_name, body.fy);
    return { success: true, message: 'All pending targets approved' };
  }

  // ── Delete a row ──
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a target row' })
  @RequirePermission('targets', 'delete')
  async delete(@Param('id') id: string) {
    await this.targetsService.delete(parseInt(id));
    return { success: true, message: 'Deleted' };
  }

  // ── Pending count for admin dashboard ──
  @Get('pending-count')
  @ApiOperation({ summary: 'Get count of pending target approvals' })
  async pendingCount(@Request() req: any) {
    // Kept permissive — returns 0 for users without approval rights so the
    // shared admin header badge doesn't blow up on non-admin sessions.
    const hasApprove = req.user?.role?.toLowerCase() === 'admin' || req.user?.permissions?.targets?.approve;
    if (!hasApprove) return { success: true, count: 0 };
    const count = await this.targetsService.getPendingCount();
    return { success: true, count };
  }

  // ── Get unit types for a user+FY ──
  @Get('unit-types')
  @ApiOperation({ summary: 'Get qty/amount unit type for each target type' })
  async getUnitTypes(@Query('fy') fy: string, @Query('user') user: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userName = isAdmin ? (user || req.user?.name) : req.user?.name;
    const data = await this.targetsService.getUnitTypes(fy, userName);
    return { success: true, data };
  }

  // ── Save unit types for a user+FY ──
  @Post('unit-types')
  @ApiOperation({ summary: 'Save qty/amount unit type for each target type' })
  async saveUnitTypes(@Body() body: { user_name: string; fy: string; types: Record<string, string> }, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userName = isAdmin ? (body.user_name || req.user?.name) : req.user?.name;
    await this.targetsService.saveUnitTypes(userName, body.fy, body.types);
    return { success: true };
  }
}
