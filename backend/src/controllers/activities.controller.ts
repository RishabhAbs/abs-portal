import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActivitiesService, CalculationRequest } from '../services/activities.service';
import { getISTDateString } from '../utils/date.util';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Activities')
@Controller('api/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ActivitiesController {
  constructor(private activitiesService: ActivitiesService) { }

  @Get('renewal-defaults')
  @ApiOperation({ summary: 'Get smart renewal defaults' })
  @RequirePermission('activities', 'view')
  async getRenewalDefaults(
    @Query('id') id: string,
    @Query('type') type: 'customer' | 'server',
    @Query('server_name') serverName?: string
  ) {
    const defaults = await this.activitiesService.getRenewalDefaults(id, type, serverName);
    return { success: true, data: defaults };
  }


  @Get()
  @ApiOperation({ summary: 'Get all activities with optional filters' })
  @RequirePermission('activities', 'view')
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('search') search: string = '',
    @Query('activity_type') activityType?: string,
    @Query('bill_type') billType?: string,
    @Query('customer_id') customerId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('record_nature') recordNature?: string,
    @Query('server_name') serverName?: string,
    @Query('billing_cycle') billingCycle?: string,
    @Query('billing_mode') billingMode?: string,
    @Query('min_amount') minAmount?: string,
    @Query('max_amount') maxAmount?: string,
  ) {
    const filters = {
      search,
      activity_type: activityType,
      bill_type: billType,
      customer_id: customerId,
      start_date: startDate,
      end_date: endDate,
      record_nature: recordNature,
      server_name: serverName,
      billing_cycle: billingCycle,
      billing_mode: billingMode,
      min_amount: minAmount ? parseFloat(minAmount) : undefined,
      max_amount: maxAmount ? parseFloat(maxAmount) : undefined,
    };


    console.log('[Activities.findAll] filters:', JSON.stringify({ customer_id: customerId, record_nature: recordNature, search, page, limit }));

    try {
      const result = await this.activitiesService.findAll(filters, page, limit);
      return { success: true, ...result };
    } catch (error) {
      console.error('[Activities Controller] findAll ERROR:', error);
      throw error;
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregated activity stats by bucket (New / Renewal / User Increase / User Decrease) honoring the same filter set as findAll.' })
  @RequirePermission('activities', 'view')
  async getStats(
    @Query('search') search: string = '',
    @Query('activity_type') activityType?: string,
    @Query('bill_type') billType?: string,
    @Query('customer_id') customerId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('record_nature') recordNature?: string,
    @Query('server_name') serverName?: string,
    @Query('billing_cycle') billingCycle?: string,
    @Query('billing_mode') billingMode?: string,
    @Query('min_amount') minAmount?: string,
    @Query('max_amount') maxAmount?: string,
  ) {
    const stats = await this.activitiesService.getStats({
      search,
      activity_type: activityType,
      bill_type: billType,
      customer_id: customerId,
      start_date: startDate,
      end_date: endDate,
      record_nature: recordNature,
      server_name: serverName,
      billing_cycle: billingCycle,
      billing_mode: billingMode,
      min_amount: minAmount ? parseFloat(minAmount) : undefined,
      max_amount: maxAmount ? parseFloat(maxAmount) : undefined,
    });
    return { success: true, data: stats };
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue summary' })
  @RequirePermission('activities', 'view')
  async getRevenueSummary() {
    const summary = await this.activitiesService.getRevenueSummary();
    return { success: true, data: summary };
  }

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate bill amount, date diff, and expiry date' })
  @RequirePermission('activities', 'view')
  async calculate(@Body() data: CalculationRequest) {
    const result = await this.activitiesService.calculate(data);
    return { success: true, data: result };
  }

  @Get('customer/:customerId/total-users')
  @ApiOperation({ summary: 'Get total users for a customer' })
  @RequirePermission('activities', 'view')
  async getTotalUsers(@Param('customerId') customerId: string) {
    const totalUsers = await this.activitiesService.getTotalUsersByCustomerId(customerId);
    return { success: true, data: { total_users: totalUsers } };
  }

  @Get('customer/:customerId/last-expiry')
  @ApiOperation({ summary: 'Get last expiry date for a customer' })
  @RequirePermission('activities', 'view')
  async getLastExpiry(@Param('customerId') customerId: string) {
    const lastExpiry = await this.activitiesService.getLastExpiryDate(customerId);
    return { success: true, data: { last_expiry_date: lastExpiry } };
  }

  @Get('customer/:customerId/pending')
  @ApiOperation({ summary: 'Get pending (unbilled) activities for a customer' })
  @RequirePermission('activities', 'view')
  async findPendingByCustomer(@Param('customerId') customerId: string) {
    const data = await this.activitiesService.findPendingByCustomer(customerId);
    return { success: true, data };
  }

  @Post('mark-billed')
  @ApiOperation({ summary: 'Mark activities as billed (link to a voucher by id, with vch_no cached)' })
  @RequirePermission('activities', 'edit')
  async markBilled(@Body() body: { activity_ids: string[]; voucher_id?: number; voucher_no?: string }) {
    const updated = await this.activitiesService.markActivitiesBilled(body.activity_ids, {
      voucherId: body.voucher_id,
      voucherNo: body.voucher_no,
    });
    return { success: true, updated, message: `${updated} activities linked to voucher` };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get activity by ID' })
  @RequirePermission('activities', 'view')
  async findOne(@Param('id') id: string) {
    const activity = await this.activitiesService.findById(id);
    return { success: true, data: activity };
  }

  @Get('customer/:customerId')
  @ApiOperation({ summary: 'Get activities by customer ID' })
  @RequirePermission('activities', 'view')
  async findByCustomer(@Param('customerId') customerId: string) {
    const activities = await this.activitiesService.findByCustomerId(customerId);
    return { success: true, data: activities };
  }

  @Post()
  @ApiOperation({ summary: 'Create new activity' })
  @RequirePermission('activities', 'create')
  async create(@Body() data: any) {
    const activity = await this.activitiesService.create(data);
    return { success: true, data: activity, message: 'Activity created successfully' };
  }

  @Post('generate-for-servers')
  @ApiOperation({ summary: 'Generate renewal activities for selected servers (P.U - Purchase Units)' })
  @RequirePermission('activities', 'create')
  async generateForServers(@Body() data: { server_ids: string[]; purchase_rate?: number }) {
    const result = await this.activitiesService.generateActivitiesForServers(
      data.server_ids,
      data.purchase_rate
    );
    return {
      success: true,
      data: result,
      message: `Created ${result.created.length} activities, skipped ${result.skipped.length} servers`
    };
  }

  @Post('bulk-customer-renewal')
  @ApiOperation({ summary: 'Generate renewal activities for selected customers (B.U - Billing Units)' })
  @RequirePermission('activities', 'create')
  async bulkCustomerRenewal(@Body() data: { customer_ids: string[]; activity_date?: string }) {
    const activityDate = data.activity_date || getISTDateString();
    const result = await this.activitiesService.bulkCustomerRenewal(
      data.customer_ids,
      activityDate
    );
    return {
      success: true,
      data: result,
      message: `Created ${result.created.length} renewals, skipped ${result.skipped.length} customers`
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update activity' })
  @RequirePermission('activities', 'edit')
  async update(@Param('id') id: string, @Body() data: any) {
    const activity = await this.activitiesService.update(id, data);
    return { success: true, data: activity, message: 'Activity updated successfully' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete activity' })
  @RequirePermission('activities', 'delete')
  async remove(@Param('id') id: string) {
    await this.activitiesService.delete(id);
    return { success: true, message: 'Activity deleted successfully' };
  }
}
