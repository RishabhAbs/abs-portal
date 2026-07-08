import { Controller, Get, Post, Query, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';
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
  // Shared with Group Transfer page — allow either permission.
  @RequireAnyPermission({ entity: 'group_change', action: 'view' }, { entity: 'group_transfer', action: 'view' })
  async getUsers() {
    const data = await this.groupChangeService.getUsers();
    return { success: true, data };
  }

  // Distinct groupings (cloud + legacy) actually present in the customer table,
  // used by the Group Transfer "Old Group" dropdown.
  @Get('customer-groups')
  @RequireAnyPermission({ entity: 'group_change', action: 'view' }, { entity: 'group_transfer', action: 'view' })
  async getCustomerGroups() {
    const data = await this.groupChangeService.getCustomerGroups();
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
  @RequireAnyPermission({ entity: 'group_change', action: 'edit_group' }, { entity: 'group_transfer', action: 'edit' })
  async transferLedgerGroup(@Body() body: { oldGroupId: string; newLedgerGroupId: number; resellerId?: number | null; groupType?: 'cloud' | 'group' }, @Request() req: any) {
    const changedBy = req.user?.name || 'Unknown';
    const result = await this.groupChangeService.transferLedgerGroup(
      body.oldGroupId,
      body.newLedgerGroupId,
      changedBy,
      body.resellerId ?? null,
      body.groupType === 'group' ? 'group' : 'cloud'
    );
    const msg = `${result.transferred} customers updated${result.resellerUpdated ? `; ${result.resellerUpdated} resellers updated` : ''}`;
    return { success: true, ...result, message: msg };
  }

  @Get('preview-ledger-group')
  @RequireAnyPermission({ entity: 'group_change', action: 'view' }, { entity: 'group_transfer', action: 'view' })
  async previewLedgerGroup(@Query('oldGroupId') oldGroupId: string, @Query('limit') limit: string = '200', @Query('resellerId') resellerId?: string, @Query('groupType') groupType?: string) {
    const rid = resellerId ? parseInt(resellerId, 10) : undefined;
    const gt = groupType === 'group' ? 'group' : 'cloud';
    const data = await this.groupChangeService.previewLedgerGroup(oldGroupId, parseInt(limit, 10) || 200, rid, gt);
    return { success: true, ...data };
  }

  @Get('resellers')
  @RequireAnyPermission({ entity: 'group_change', action: 'view' }, { entity: 'group_transfer', action: 'view' })
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
