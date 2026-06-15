import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LeadRequirementsService } from '../services/lead-requirements.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Lead Requirements')
@Controller('api/lead-requirements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LeadRequirementsController {
  constructor(private readonly svc: LeadRequirementsService) {}

  // ── Reports (must be before :id routes) ──

  @Get('report/requirements')
  @RequireAnyPermission({ entity: 'service_calls', action: 'view' }, { entity: 'tdl', action: 'view' }, { entity: 'leads', action: 'view' })
  async getRequirementsReport(@Query() query: any) {
    return this.svc.getRequirementsReport(query);
  }

  @Get('report/corrections')
  @RequireAnyPermission({ entity: 'service_calls', action: 'view' }, { entity: 'tdl', action: 'view' }, { entity: 'leads', action: 'view' })
  async getCorrectionReport(@Query() query: any) {
    return this.svc.getCorrectionReport(query);
  }

  // ── My Requirements (must be before :id routes) ──

  @Get('my-requirements')
  async getMyRequirements(@Req() req: any) {
    const perms = req.user?.permissions?.my_requirements || {};
    const isAdmin = req.user?.role === 'admin';
    const typeMap: Record<string, string> = { cloud: 'Cloud', tally: 'Tally', tdl: 'TDL', webapp: 'Web/App' };
    const leadTypes = isAdmin
      ? Object.values(typeMap)
      : Object.entries(typeMap).filter(([key]) => perms[key]).map(([, val]) => val);
    return this.svc.getMyRequirements(leadTypes);
  }

  // ── Lead Detail ──

  @Get('lead/:id')
  @RequirePermission('leads', 'view')
  async getLeadDetail(@Param('id') id: string) {
    return this.svc.getLeadDetail(+id);
  }

  // ── Requirements ──

  @Get('lead/:id/requirements')
  @RequirePermission('leads', 'view')
  async getRequirements(@Param('id') id: string, @Query('status') status?: string) {
    return this.svc.getRequirements(+id, status);
  }

  @Post('lead/:id/requirements')
  @RequirePermission('leads', 'create')
  async addRequirement(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addRequirement(+id, body, req.user.name);
  }

  @Put('requirements/:reqId')
  @RequirePermission('leads', 'take')
  async updateRequirement(@Param('reqId') reqId: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateRequirement(+reqId, body, req.user.name);
  }

  @Put('requirements/:reqId/complete')
  @RequirePermission('leads', 'close')
  async completeRequirement(@Param('reqId') reqId: string, @Body() body: any, @Req() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    return this.svc.completeRequirement(+reqId, body, req.user.name, isAdmin);
  }

  @Put('requirements/:reqId/transfer')
  @RequirePermission('leads', 'transfer')
  async transferRequirement(@Param('reqId') reqId: string, @Body() body: any, @Req() req: any) {
    return this.svc.transferRequirement(+reqId, body, req.user.name);
  }

  @Put('requirements/:reqId/status')
  @RequirePermission('leads', 'take')
  async updateRequirementStatus(@Param('reqId') reqId: string, @Body() body: any, @Req() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    return this.svc.updateRequirementStatus(+reqId, body.status, req.user.name, isAdmin);
  }

  @Get('requirements/:reqId/updates')
  @RequirePermission('leads', 'view')
  async getRequirementUpdates(@Param('reqId') reqId: string) {
    return this.svc.getRequirementUpdates(+reqId);
  }

  // ── Follow-ups ──

  @Get('lead/:id/followups')
  @RequirePermission('leads', 'view')
  async getFollowups(@Param('id') id: string) {
    return this.svc.getFollowups(+id);
  }

  @Post('lead/:id/followups')
  @RequirePermission('leads', 'create')
  async addFollowup(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addFollowup(+id, body, req.user.name);
  }

  @Put('followups/:followupId/done')
  @RequirePermission('leads', 'take')
  async markFollowupDone(@Param('followupId') followupId: string) {
    return this.svc.markFollowupDone(+followupId);
  }
}
