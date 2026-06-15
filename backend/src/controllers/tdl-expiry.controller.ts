import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TdlExpiryService, TdlExpiryInput } from '../services/tdl-expiry.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('TDL Expiry')
@Controller('api/tdl-expiry')
export class TdlExpiryController {
  constructor(private readonly tdlExpiryService: TdlExpiryService) {}

  // ── Public endpoint (no auth) ── Tally calls this with just the token ──────
  @Get('check/:token')
  @ApiOperation({ summary: 'Public: get expiry info by token (used by Tally)' })
  async checkByToken(@Param('token') token: string) {
    const data = await this.tdlExpiryService.findByToken(token);
    if (!data) return { success: false, message: 'Invalid or expired token' };
    return { success: true, ...data };
  }

  // ── Protected CRUD ────────────────────────────────────────────────────────
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('tdl', 'view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List TDL expiry records (paginated)' })
  async findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('search') search = '',
  ) {
    const result = await this.tdlExpiryService.findAll(
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
    );
    return { success: true, ...result };
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('tdl', 'create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a TDL expiry record (token auto-generated)' })
  async create(@Body() body: TdlExpiryInput) {
    const record = await this.tdlExpiryService.create(body);
    return { success: true, data: record, message: 'TDL expiry record created' };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('tdl', 'edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a TDL expiry record' })
  async update(@Param('id') id: string, @Body() body: Partial<TdlExpiryInput>) {
    await this.tdlExpiryService.update(parseInt(id, 10), body);
    return { success: true, message: 'Updated' };
  }

  @Patch(':id/active')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('tdl', 'edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate or deactivate a TDL token' })
  async setActive(@Param('id') id: string, @Body() body: { is_active: boolean }) {
    await this.tdlExpiryService.setActive(parseInt(id, 10), body.is_active);
    return { success: true, message: body.is_active ? 'Token activated' : 'Token deactivated' };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('tdl', 'delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a TDL expiry record' })
  async remove(@Param('id') id: string) {
    await this.tdlExpiryService.delete(parseInt(id, 10));
    return { success: true, message: 'Deleted' };
  }
}
