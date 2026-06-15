import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TdlBillingService, CreateBillingInput, BillingCycle } from '../services/tdl-billing.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('TDL Billing')
@Controller('api/tdl-billing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TdlBillingController {
  constructor(private readonly tdlBillingService: TdlBillingService) {}

  @Get('customers')
  @RequirePermission('tdl', 'view')
  @ApiOperation({ summary: 'Unique customers that have TDL expiry records' })
  async getCustomers(@Query('search') search = '') {
    const data = await this.tdlBillingService.getCustomers(search);
    return { success: true, data };
  }

  @Get('tdls/:customerName')
  @RequirePermission('tdl', 'view')
  @ApiOperation({ summary: "TDL expiry records for a customer with billing stats" })
  async getTdlsByCustomer(@Param('customerName') customerName: string) {
    const data = await this.tdlBillingService.getTdlsByCustomer(decodeURIComponent(customerName));
    return { success: true, data };
  }

  @Get('prepare/:tdlExpiryId')
  @RequirePermission('tdl', 'view')
  @ApiOperation({ summary: 'Calculate New/Renew type, start date, and expiry for a given cycle' })
  async prepare(
    @Param('tdlExpiryId') id: string,
    @Query('cycle') cycle: BillingCycle,
    @Query('startDate') startDate?: string,
  ) {
    const data = await this.tdlBillingService.prepare(parseInt(id, 10), cycle, startDate);
    return { success: true, ...data };
  }

  @Get()
  @RequirePermission('tdl', 'view')
  @ApiOperation({ summary: 'List all TDL billing activities (paginated)' })
  async findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('search') search = '',
  ) {
    const result = await this.tdlBillingService.findAll(parseInt(page, 10), parseInt(limit, 10), search);
    return { success: true, ...result };
  }

  @Post()
  @RequirePermission('tdl', 'create')
  @ApiOperation({ summary: 'Create a TDL billing activity and sync expiry to TDL record' })
  async create(@Body() body: CreateBillingInput) {
    const record = await this.tdlBillingService.create(body);
    return { success: true, data: record, message: 'Billing activity created' };
  }

  @Put(':id')
  @RequirePermission('tdl', 'edit')
  @ApiOperation({ summary: 'Update a billing activity and re-sync TDL expiry' })
  async update(@Param('id') id: string, @Body() body: any) {
    const record = await this.tdlBillingService.update(parseInt(id, 10), body);
    return { success: true, data: record, message: 'Updated' };
  }

  @Delete(':id')
  @RequirePermission('tdl', 'delete')
  @ApiOperation({ summary: 'Delete a billing activity and re-sync TDL expiry' })
  async remove(@Param('id') id: string) {
    await this.tdlBillingService.delete(parseInt(id, 10));
    return { success: true, message: 'Deleted' };
  }
}
