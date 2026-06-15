import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServersService } from '../services/servers.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Servers')
@Controller('api/servers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ServersController {
  constructor(private serversService: ServersService) { }

  @Get()
  @ApiOperation({ summary: 'Get all servers with pagination and search' })
  @RequireAnyPermission(
    { entity: 'servers', action: 'view' },
    { entity: 'activities', action: 'view' },
    { entity: 'mappings', action: 'view' }
  )
  async findAll(
    @Query('page') page: number = 1, 
    @Query('limit') limit: number = 50, 
    @Query('search') search: string = '',
    @Query('company') company?: string,
    @Query('status') status?: string,
    @Query('port') port?: string,
    @Query('server_ip') serverIp?: string,
    @Query('customer_ip') customerIp?: string,
    @Query('admin_username') adminUsername?: string,
    @Query('billing_mode') billingMode?: string,
    @Query('billing_cycle') billingCycle?: string,
    @Query('expiry_start') expiryStart?: string,
    @Query('expiry_end') expiryEnd?: string,
  ) {
    const filters = {
      company, status, port, server_ip: serverIp, customer_ip: customerIp, 
      admin_username: adminUsername, billing_mode: billingMode, billing_cycle: billingCycle,
      expiry_start: expiryStart, expiry_end: expiryEnd
    };
    const result = await this.serversService.findAll(page, limit, search, filters);
    return { success: true, ...result };
  }

  @Get('dropdown')
  @ApiOperation({ summary: 'Get lightweight server list for dropdowns' })
  @RequireAnyPermission(
    { entity: 'servers', action: 'view' },
    { entity: 'activities', action: 'create' },
    { entity: 'activities', action: 'view' },
    { entity: 'mappings', action: 'view' },
    { entity: 'mappings', action: 'create' }
  )
  async getDropdown() {
    const data = await this.serversService.getForDropdown();
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get server by ID' })
  @RequireAnyPermission(
    { entity: 'servers', action: 'view' },
    { entity: 'activities', action: 'create' },
    { entity: 'activities', action: 'view' },
    { entity: 'mappings', action: 'view' }
  )
  async findOne(@Param('id') id: string) {
    const server = await this.serversService.findById(id);
    return { success: true, data: server };
  }

  @Get(':id/customers')
  @ApiOperation({ summary: 'Get customer count for server' })
  @RequirePermission('servers', 'view') // Or maybe specific? but view server usually implies seeing stats
  async getCustomerCount(@Param('id') id: string) {
    const count = await this.serversService.getCustomerCount(id);
    return { success: true, data: { server_id: id, customer_count: count } };
  }

  @Post()
  @ApiOperation({ summary: 'Create new server' })
  @RequirePermission('servers', 'create')
  async create(@Body() data: any) {
    const server = await this.serversService.create(data);
    return { success: true, data: server, message: 'Server created successfully' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update server' })
  @RequirePermission('servers', 'edit')
  async update(@Param('id') id: string, @Body() data: any) {
    const server = await this.serversService.update(id, data);
    return { success: true, data: server, message: 'Server updated successfully' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete server' })
  @RequirePermission('servers', 'delete')
  async remove(@Param('id') id: string) {
    await this.serversService.delete(id);
    return { success: true, message: 'Server deleted successfully' };
  }
}
