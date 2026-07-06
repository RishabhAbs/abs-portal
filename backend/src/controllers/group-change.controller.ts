import { Controller, Get, Post, Query, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';
import { GroupChangeService } from '../services/group-change.service';

// Group / Reseller Change page. Permissions are split:
//   group_change.view         → can open the page (load users, history, etc.)
//   group_change.edit_group   → can reassign a customer's handler (cloud user)
//   group_change.edit_reseller → can reassign a customer's reseller
@Controller('api/group-change')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class GroupChangeController {
  constructor(private readonly groupChangeService: GroupChangeService) {}

  @Get('ping')
  ping() {
    return { ok: true, ts: Date.now() };
  }

  @Get('users')
  @RequirePermission('group_change', 'view')
  async getUsers() {
    const data = await this.groupChangeService.getUsers();
    return { success: true, data };
  }

  @Get('customers')
  @RequirePermission('group_change', 'view')
  async getCustomers(@Query('userId') userId: string) {
    const data = await this.groupChangeService.getCustomersByUser(userId);
    return { success: true, data };
  }

  @Post('transfer')
  @RequirePermission('group_change', 'edit_group')
  async transfer(@Body() body: { customerIds: number[]; toUserId: string }, @Request() req: any) {
    const changedBy = req.user?.name || 'Unknown';
    const result = await this.groupChangeService.transferCustomers(
      body.customerIds,
      body.toUserId,
      changedBy
    );
    return { success: true, ...result, message: `${result.transferred} customers transferred` };
  }

  @Post('transfer-ledger-group')
  @RequirePermission('group_change', 'edit_group')
  async transferLedgerGroup(@Body() body: { oldGroupId: string; newLedgerGroupId: number; resellerId?: number | null }, @Request() req: any) {
    const changedBy = req.user?.name || 'Unknown';
    const result = await this.groupChangeService.transferLedgerGroup(
      body.oldGroupId,
      body.newLedgerGroupId,
      changedBy,
      body.resellerId ?? null
    );
    const msg = `${result.transferred} customers updated${result.resellerUpdated ? `; ${result.resellerUpdated} resellers updated` : ''}`;
    return { success: true, ...result, message: msg };
  }

  @Get('preview-ledger-group')
  @RequirePermission('group_change', 'view')
  async previewLedgerGroup(@Query('oldGroupId') oldGroupId: string, @Query('limit') limit: string = '200', @Query('resellerId') resellerId?: string) {
    const rid = resellerId ? parseInt(resellerId, 10) : undefined;
    const data = await this.groupChangeService.previewLedgerGroup(oldGroupId, parseInt(limit, 10) || 200, rid);
    return { success: true, ...data };
  }

  @Get('resellers')
  @RequirePermission('group_change', 'view')
  async getResellers() {
    const data = await this.groupChangeService.getResellers();
    return { success: true, data };
  }

  @Post('transfer-reseller')
  @RequirePermission('group_change', 'edit_reseller')
  async transferReseller(
    @Body() body: { customerIds: number[]; toResellerId: number | null },
    @Request() req: any,
  ) {
    const changedBy = req.user?.name || 'Unknown';
    const result = await this.groupChangeService.transferReseller(
      body.customerIds,
      body.toResellerId ?? null,
      changedBy,
    );
    return { success: true, ...result, message: `${result.transferred} customer reseller(s) updated` };
  }

  @Get('history')
  @RequirePermission('group_change', 'view')
  async getHistory(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('search') search: string = ''
  ) {
    const result = await this.groupChangeService.getHistory(
      parseInt(page), parseInt(limit), search
    );
    return { success: true, ...result };
  }
}
