import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from '../services/billing.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Billing')
@Controller('api/billing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(private billingService: BillingService) {}

  // ─── Bills ──────────────────────────────────────────────────────────────

  @Post('bills')
  @ApiOperation({ summary: 'Create a new bill' })
  @RequirePermission('activities', 'create')
  async createBill(@Body() body: any, @Request() req: any) {
    return this.billingService.createBill(body, req.user?.name || 'Unknown');
  }

  @Get('bills')
  @ApiOperation({ summary: 'List bills with filters' })
  // Also feeds the standalone Bill Report page.
  @RequireAnyPermission({ entity: 'activities', action: 'view' }, { entity: 'reports_bill_payment', action: 'view' })
  async getBills(
    @Query('bill_type') bill_type?: string,
    @Query('bill_status') bill_status?: string,
    @Query('pay_status') pay_status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('reseller') reseller?: string,
    @Query('no_follow') no_follow?: string,
    @Query('today') today?: string,
    @Query('after_today') after_today?: string,
  ) {
    return this.billingService.getBills({
      bill_type, bill_status, pay_status, search, startDate, endDate,
      reseller: reseller === 'true',
      no_follow: no_follow === 'true',
      today: today === 'true',
      after_today: after_today === 'true',
    });
  }

  @Get('bills/:id')
  @ApiOperation({ summary: 'Get bill with items' })
  @RequirePermission('activities', 'view')
  async getBill(@Param('id') id: string) {
    return this.billingService.getBillWithItems(parseInt(id, 10));
  }

  @Put('bills/:id')
  @ApiOperation({ summary: 'Update a bill' })
  @RequirePermission('activities', 'edit')
  async updateBill(@Param('id') id: string, @Body() body: any) {
    return this.billingService.updateBill(parseInt(id, 10), body);
  }

  @Put('bills/:id/status')
  @ApiOperation({ summary: 'Update bill status' })
  @RequirePermission('activities', 'edit')
  async updateBillStatus(@Param('id') id: string, @Body() body: any) {
    return this.billingService.updateBillStatus(parseInt(id, 10), body);
  }

  @Put('bills/:id/followup')
  @ApiOperation({ summary: 'Increment follow-up count' })
  @RequirePermission('activities', 'edit')
  async incrementFollowup(@Param('id') id: string) {
    return this.billingService.incrementFollowup(parseInt(id, 10));
  }

  // ─── Payments ────────────────────────────────────────────────────────────

  @Post('payments')
  @ApiOperation({ summary: 'Add a payment' })
  @RequirePermission('activities', 'create')
  async addPayment(@Body() body: any, @Request() req: any) {
    return this.billingService.addPayment(body, req.user?.name || 'Unknown');
  }

  @Get('payments')
  @ApiOperation({ summary: 'List payments' })
  // Also feeds the standalone Payment Report page.
  @RequireAnyPermission({ entity: 'activities', action: 'view' }, { entity: 'reports_bill_payment', action: 'view' })
  async getPayments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('payment_complete') payment_complete?: string,
  ) {
    return this.billingService.getPayments({ status, search, startDate, endDate, payment_complete });
  }

  @Put('payments/:id')
  @ApiOperation({ summary: 'Update a payment' })
  // Payment Report page can edit payments with its own permission.
  @RequireAnyPermission({ entity: 'activities', action: 'edit' }, { entity: 'reports_bill_payment', action: 'edit' })
  async updatePayment(@Param('id') id: string, @Body() body: any) {
    return this.billingService.updatePayment(parseInt(id, 10), body);
  }

  // ─── Lookups ──────────────────────────────────────────────────────────────

  @Get('billing-companies/:id/items')
  @ApiOperation({ summary: 'Get billing company items with product names' })
  @RequirePermission('activities', 'view')
  async getBillingCompanyItems(@Param('id') id: string) {
    return this.billingService.getBillingCompanyItems(parseInt(id, 10));
  }

  @Get('billing-companies')
  @ApiOperation({ summary: 'Get billing companies' })
  @RequirePermission('activities', 'view')
  async getBillingCompanies() {
    return this.billingService.getBillingCompanies();
  }

  @Get('products')
  @ApiOperation({ summary: 'Get products' })
  @RequirePermission('activities', 'view')
  async getProducts() {
    return this.billingService.getProducts();
  }

  @Get('tally-item-types')
  @ApiOperation({ summary: 'Get tally item types' })
  @RequirePermission('activities', 'view')
  async getTallyItemTypes() {
    return this.billingService.getTallyItemTypes();
  }
}
