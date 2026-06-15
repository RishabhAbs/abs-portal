import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServiceCallsService } from '../services/servicecalls.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Service Calls')
@Controller('api/service-calls')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ServiceCallsController {
  constructor(private serviceCallsService: ServiceCallsService) {}

  @Get()
  @ApiOperation({ summary: 'List all service calls' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'view' }, { entity: 'leads', action: 'view' })
  async getAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('staff') staff?: string,
    @Query('entryType') entryType?: string,
    @Request() req?: any
  ) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    // Endpoint is shared by service_calls and leads — pick the right view_all flag by entryType.
    const permEntity = entryType === 'Lead' ? 'leads' : 'service_calls';
    const canViewAll = !!req.user?.permissions?.[permEntity]?.view_all;

    // Only pass limitAll=true if NOT admin and does NOT have view_all
    const limitAll = !isAdmin && !canViewAll;

    const result = await this.serviceCallsService.findAll(status, req?.user?.name, search, startDate, endDate, staff, limitAll, entryType);
    return { success: true, ...result };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get service call statistics' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'view' }, { entity: 'leads', action: 'view' })
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('staff') staff?: string,
    @Query('entryType') entryType?: string,
    @Request() req?: any
  ) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const permEntity = entryType === 'Lead' ? 'leads' : 'service_calls';
    const canViewAll = !!req.user?.permissions?.[permEntity]?.view_all;
    const limitAll = !isAdmin && !canViewAll;
    const userName = req.user?.name || req.user?.email || '';

    const stats = await this.serviceCallsService.getStats(startDate, endDate, staff, userName, limitAll, entryType);
    return { success: true, data: stats };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new service call or lead' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'create' }, { entity: 'leads', action: 'create' })
  async create(
    @Body() body: {
      mobile_no: string;
      service_type?: string;
      remark?: string;
      contact_person?: string;
      customer_id?: number;
      serial_number?: string;
      expire_date?: string;
      flavor?: string;
      assign_to?: string;
      entry_type?: string;
      lead_type?: string;
    },
    @Request() req: any
  ) {
    return this.serviceCallsService.create(
      body.mobile_no,
      {
        service_type: body.service_type || null,
        remark: body.remark || null,
        contact_person: body.contact_person || null,
        customer_id: body.customer_id || null,
        serial_number: body.serial_number || null,
        expire_date: body.expire_date || null,
        flavor: body.flavor || null,
        assign_to: body.assign_to || null,
        entry_type: body.entry_type || 'Service',
        lead_type: body.lead_type || null,
      },
      req.user?.name || req.user?.email || 'Unknown'
    );
  }

  @Get('flavors')
  @ApiOperation({ summary: 'Get flavors from singlemaster' })
  @RequirePermission('service_calls', 'view')
  async getFlavors() {
    const data = await this.serviceCallsService.getFlavors();
    return { success: true, data };
  }

  @Get('lookup/:mobile')
  @ApiOperation({ summary: 'Lookup contact by mobile number' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'view' }, { entity: 'leads', action: 'view' })
  async lookupContact(@Param('mobile') mobile: string) {
    return this.serviceCallsService.lookupContact(mobile);
  }

  @Put(':id/take')
  @ApiOperation({ summary: 'Take a service call or lead' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'take' }, { entity: 'leads', action: 'take' })
  async take(@Param('id') id: string, @Request() req: any) {
    return this.serviceCallsService.takeService(parseInt(id, 10), req.user?.name || req.user?.email || 'Unknown');
  }

  @Put(':id/transfer')
  @ApiOperation({ summary: 'Transfer a service call or lead' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'transfer' }, { entity: 'leads', action: 'transfer' })
  async transfer(
    @Param('id') id: string,
    @Body() body: { assign_to: string },
    @Request() req: any
  ) {
    return this.serviceCallsService.transferService(
      parseInt(id, 10),
      body.assign_to,
      req.user?.name || req.user?.email || 'Unknown'
    );
  }

  @Put(':id/close')
  @ApiOperation({ summary: 'Close a service call or lead' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'close' }, { entity: 'leads', action: 'close' })
  async close(
    @Param('id') id: string,
    @Body() body: {
      customer_id?: number;
      contact_person?: string;
      serial_number?: string;
      service_type?: string;
      remark?: string;
      expire_date?: string;
      flavor?: string;
      resolution_note?: string;
      assigned_developer?: string;
    }
  ) {
    return this.serviceCallsService.closeService(parseInt(id, 10), body);
  }

  @Put(':id/confirm')
  @ApiOperation({ summary: 'Confirm a completed service call (follow-up flow)' })
  @RequireAnyPermission({ entity: 'service_followup', action: 'confirm' }, { entity: 'service_calls', action: 'close' })
  async confirm(@Param('id') id: string, @Body() body: { satisfaction_rating?: number }, @Request() req: any) {
    return this.serviceCallsService.confirmService(parseInt(id, 10), req.user?.name || req.user?.email || 'Unknown', body.satisfaction_rating);
  }

  @Put(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed service call (follow-up flow)' })
  @RequireAnyPermission({ entity: 'service_followup', action: 'reopen' }, { entity: 'service_calls', action: 'close' })
  async reopen(
    @Param('id') id: string,
    @Body() body: { assign_to?: string },
    @Request() req: any
  ) {
    return this.serviceCallsService.reopenService(
      parseInt(id, 10),
      req.user?.name || req.user?.email || 'Unknown',
      body.assign_to || undefined
    );
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Cancel a service call or lead' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'cancel' }, { entity: 'leads', action: 'cancel' })
  async cancel(@Param('id') id: string, @Request() req: any) {
    return this.serviceCallsService.cancelService(parseInt(id, 10), req.user?.name || 'Unknown');
  }

  @Put(':id/join')
  @ApiOperation({ summary: 'Join a lead (link customer/serial without closing)' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'close' }, { entity: 'leads', action: 'close' })
  async joinLead(
    @Param('id') id: string,
    @Body() body: {
      customer_id?: number;
      contact_person?: string;
      serial_number?: string;
      service_type?: string;
      remark?: string;
      expire_date?: string;
      flavor?: string;
      assigned_developer?: string;
    }
  ) {
    return this.serviceCallsService.joinLead(parseInt(id, 10), body);
  }

  @Get('reports/user-wise')
  @ApiOperation({ summary: 'User-wise service call report' })
  @RequirePermission('service_calls', 'view')
  async getReportsUserWise(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const data = await this.serviceCallsService.getUserWiseReport(startDate, endDate);
    return { success: true, data };
  }

  @Get('reports/delays')
  @ApiOperation({ summary: 'Service delay report' })
  @RequirePermission('service_calls', 'view')
  async getReportsDelays(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const data = await this.serviceCallsService.getDelayReport(startDate, endDate);
    return { success: true, data };
  }

  @Get('lookup-tally/:serial')
  @ApiOperation({ summary: 'Lookup customer/flavor by Tally serial' })
  @RequirePermission('service_calls', 'view')
  async lookupTally(@Param('serial') serial: string) {
    return this.serviceCallsService.lookupTallySerial(serial);
  }

  @Get('my-corrections')
  @ApiOperation({ summary: 'Get corrections by lead type permissions' })
  async getMyCorrections(@Request() req: any) {
    const perms = req.user?.permissions?.my_requirements || {};
    const isAdmin = req.user?.role === 'admin';
    const typeMap: Record<string, string> = { cloud: 'Cloud', tally: 'Tally', tdl: 'TDL', webapp: 'Web/App' };
    const leadTypes = isAdmin
      ? Object.values(typeMap)
      : Object.entries(typeMap).filter(([key]) => perms[key]).map(([, val]) => val);
    return this.serviceCallsService.getMyCorrections(leadTypes);
  }

  @Put('notes/:noteId/status')
  @ApiOperation({ summary: 'Update correction/note status' })
  async updateNoteStatus(@Param('noteId') noteId: number, @Body() body: { status: string }, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    return this.serviceCallsService.updateNoteStatus(noteId, body.status, req.user?.name || req.user?.username, isAdmin);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: 'Get notes/history for a lead or service call' })
  // view_updates is the dedicated gate for the notes/remarks/status-change
  // feed. Falls back to admin-equivalent perms (view_all) for power users
  // and keeps `leads.view` for the lead-side reads of the same data.
  @RequireAnyPermission(
    { entity: 'service_calls', action: 'view_updates' },
    { entity: 'service_calls', action: 'view_all' },
    { entity: 'leads', action: 'view_all' },
    { entity: 'leads', action: 'view' },
  )
  async getNotes(@Param('id') id: number) {
    return this.serviceCallsService.getNotes(id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note (remark/requirement) to a lead or service call' })
  @RequireAnyPermission({ entity: 'service_calls', action: 'create' }, { entity: 'leads', action: 'create' })
  async addNote(@Param('id') id: number, @Body() body: { note_type: string; content: string; assigned_to?: string; deadline?: string; next_update_date?: string; stage?: string }, @Request() req: any) {
    return this.serviceCallsService.addNote(id, body.note_type, body.content, req.user?.name || req.user?.username, body.assigned_to, body.deadline, body.next_update_date, body.stage);
  }
}
