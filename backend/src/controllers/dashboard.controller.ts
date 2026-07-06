import { Controller, Get, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from '../services/dashboard.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@ApiTags('Dashboard')
@Controller('api/dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  async getStats() {
    const stats = await this.dashboardService.getStats();
    return { success: true, data: stats };
  }

  @Get('operations-snapshot')
  @ApiOperation({ summary: 'Operations Snapshot — expiry × grade × segment counts + customer movement' })
  async getOperationsSnapshot() {
    const data = await this.dashboardService.getOperationsSnapshot();
    return { success: true, data };
  }

  @Get('recent-servers')
  @ApiOperation({ summary: 'Get recent servers' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecentServers(@Query('limit') limit?: number) {
    const servers = await this.dashboardService.getRecentServers(limit || 5);
    return { success: true, data: servers };
  }

  @Get('recent-customers')
  @ApiOperation({ summary: 'Get recent customers' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecentCustomers(@Query('limit') limit?: number) {
    const customers = await this.dashboardService.getRecentCustomers(limit || 5);
    return { success: true, data: customers };
  }

  @Get('revenue-by-month')
  @ApiOperation({ summary: 'Get revenue by month' })
  async getRevenueByMonth() {
    const revenue = await this.dashboardService.getRevenueByMonth();
    return { success: true, data: revenue };
  }

  @Get('pending-users')
  @ApiOperation({ summary: 'Get pending counts — all users (admin) or self (non-admin)' })
  async getPendingByUser(@Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    if (isAdmin) {
      const data = await this.dashboardService.getPendingByUser();
      return { success: true, data };
    }
    const [myRow, unallottedRow] = await Promise.all([
      this.dashboardService.getMyPending(req.user?.name, JSON.stringify(req.user?.permissions || {})),
      this.dashboardService.getMyPending('Unalloted', '{}')
    ]);
    return { success: true, data: [myRow, unallottedRow] };
  }

  @Get('pending-detail')
  @ApiOperation({ summary: 'Get pending detail for a user by type' })
  @ApiQuery({ name: 'type', required: true })
  @ApiQuery({ name: 'user', required: true })
  async getPendingDetail(@Query('type') type: string, @Query('user') user: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    // Non-admin can only query their own name
    if (!isAdmin && user !== req.user?.name) throw new ForbiddenException();
    const data = await this.dashboardService.getPendingDetail(type, user);
    return { success: true, data };
  }

  @Get('my-performance')
  @ApiOperation({ summary: 'Get my performance metrics' })
  @ApiQuery({ name: 'user', required: false })
  @ApiQuery({ name: 'fy', required: false })
  async getMyPerformance(@Query('user') user: string, @Query('fy') fy: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userName = isAdmin && user ? user : req.user?.name;
    const data = await this.dashboardService.getMyPerformance(userName, fy);
    return { success: true, data };
  }

  @Get('debug-performance')
  @ApiOperation({ summary: 'Debug: return my-performance plus raw plans and voucher aggregates' })
  @ApiQuery({ name: 'user', required: false })
  @ApiQuery({ name: 'fy', required: false })
  async debugPerformance(@Query('user') user: string, @Query('fy') fy: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userName = isAdmin && user ? user : req.user?.name;
    const data = await this.dashboardService.getPerformanceDebug(userName, fy);
    return { success: true, data };
  }

  @Get('admin-performance')
  @ApiOperation({ summary: 'Admin rollup: company + per-category + per-user performance' })
  @ApiQuery({ name: 'fy', required: false })
  async getAdminPerformance(@Query('fy') fy: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    if (!isAdmin) throw new ForbiddenException();
    const data = await this.dashboardService.getAdminPerformance(fy);
    return { success: true, data };
  }
}
