import { Controller, Post, Get, Body, UseGuards, Request, Query, Param, ForbiddenException } from '@nestjs/common';
import { AttendanceService } from '../services/attendance.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Attendance')
@Controller('api/attendance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Post('checkin')
  @ApiOperation({ summary: 'Check in for the day (Geofenced)' })
  async checkIn(@Body() body: { lat: number; lng: number }, @Request() req: any) {
    return this.attendanceService.checkIn(req.user.id, body.lat, body.lng);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Check out for the day (Geofenced)' })
  async checkOut(@Body() body: { lat: number; lng: number }, @Request() req: any) {
    return this.attendanceService.checkOut(req.user.id, body.lat, body.lng);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current day attendance status' })
  async getStatus(@Request() req: any) {
    return this.attendanceService.getTodayStatus(req.user.id);
  }

  @Get('report')
  @ApiOperation({ summary: 'Get daily attendance report (Admin)' })
  async getDailyReport(@Request() req: any, @Query('date') date: string) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.getDailyReport(date);
  }

  @Post('force-checkin')
  @ApiOperation({ summary: 'Force check in for a user (Admin)' })
  async forceCheckIn(@Request() req: any, @Body() body: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.forceCheckIn(body.userId, body.date, body.time, body.lat, body.lng, body.address);
  }

  @Post('force-checkout')
  @ApiOperation({ summary: 'Force check out for a user (Admin)' })
  async forceCheckOut(@Request() req: any, @Body() body: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.forceCheckOut(body.userId, body.date, body.time, body.lat, body.lng, body.address);
  }

  @Get('monthly-export')
  @ApiOperation({ summary: 'Get monthly attendance matrix for Excel export (Admin)' })
  async getMonthlyExport(
    @Request() req: any,
    @Query('month') month: string,
    @Query('year') year: string
  ) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.getMonthlyExport(parseInt(month), parseInt(year));
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Get user attendance history' })
  async getUserHistory(
    @Request() req: any,
    @Param('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string
  ) {
    // Non-admin users can only view their own history
    if (req.user?.role?.toLowerCase() !== 'admin' && req.user.id !== userId) {
      throw new ForbiddenException('You can only view your own attendance history');
    }
    return this.attendanceService.getUserHistory(userId, from, to);
  }

  @Get('my-monthly-stats')
  @ApiOperation({ summary: 'Get own monthly attendance stats' })
  async getMyMonthlyStats(
    @Request() req: any,
    @Query('month') month: string,
    @Query('year') year: string
  ) {
    return this.attendanceService.getMyMonthlyStats(req.user.id, parseInt(month), parseInt(year));
  }

  // HOLIDAYS
  @Get('holidays')
  @ApiOperation({ summary: 'Get all holidays (Admin)' })
  async getHolidays(@Request() req: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.getHolidays();
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Add/Update a holiday (Admin)' })
  async addHoliday(@Request() req: any, @Body() body: { date: string; description: string }) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.addHoliday(body.date, body.description);
  }

  @Post('holidays/bulk')
  @ApiOperation({ summary: 'Add multiple holidays (Admin)' })
  async bulkAddHolidays(@Request() req: any, @Body() body: { holidays: { date: string; description: string }[] }) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.bulkAddHolidays(body.holidays);
  }

  @Post('holidays/remove')
  @ApiOperation({ summary: 'Remove a holiday (Admin)' })
  async removeHoliday(@Request() req: any, @Body() body: { date: string }) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin access required');
    return this.attendanceService.removeHoliday(body.date);
  }
}
