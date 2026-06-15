import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MappingsService } from '../services/mappings.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Mappings')
@Controller('api/mappings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MappingsController {
  constructor(private mappingsService: MappingsService) { }

  @Get()
  @ApiOperation({ summary: 'Get all mappings with pagination' })
  @RequirePermission('mappings', 'view')
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('server_id') serverId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('billing_mode') billing_mode?: string,
    @Query('billing_cycle') billing_cycle?: string,
    @Query('expiry_start') expiry_start?: string,
    @Query('expiry_end') expiry_end?: string,
    @Query('mapped_at_start') mapped_at_start?: string,
    @Query('mapped_at_end') mapped_at_end?: string,
    @Query('company') company?: string,
    @Query('customer_ip') customer_ip?: string,
    @Query('serial_no') serial_no?: string,
    @Query('min_rate') min_rate?: string,
    @Query('max_rate') max_rate?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: 'ASC' | 'DESC'
  ) {
    const sanitize = (val?: string) => (val === 'all' || val === 'All' || !val) ? '' : val;

    const filters = {
      status: sanitize(status), 
      billing_mode: sanitize(billing_mode), 
      billing_cycle: sanitize(billing_cycle), 
      expiry_start: sanitize(expiry_start), 
      expiry_end: sanitize(expiry_end),
      mapped_at_start: sanitize(mapped_at_start),
      mapped_at_end: sanitize(mapped_at_end),
      company: sanitize(company),
      customer_ip: sanitize(customer_ip),
      serial_no: sanitize(serial_no),
      min_rate: sanitize(min_rate),
      max_rate: sanitize(max_rate),
    };
    
    const sort = sortBy ? { field: sortBy, dir: sortDir || 'DESC' } : undefined;

    const result = await this.mappingsService.findAll(page, limit, serverId, search, filters, sort);
    return { success: true, ...result };
  }

  @Get('unmapped-customers')
  @ApiOperation({ summary: 'Get customers not mapped to any server' })
  @RequirePermission('mappings', 'view')
  async getUnmappedCustomers() {
    const customers = await this.mappingsService.getUnmappedCustomers();
    return { success: true, data: customers };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get mapping by ID' })
  @RequireAnyPermission(
    { entity: 'mappings', action: 'view' },
    { entity: 'activities', action: 'view' }
  )
  async findOne(@Param('id') id: string) {
    const mapping = await this.mappingsService.findById(id);
    return { success: true, data: mapping };
  }

  @Get('customer/:customerId')
  @ApiOperation({ summary: 'Get mapping by customer ID' })
  @RequireAnyPermission(
    { entity: 'mappings', action: 'view' },
    { entity: 'activities', action: 'view' },
    { entity: 'activities', action: 'create' }
  )
  async findByCustomer(@Param('customerId') customerId: string) {
    const mapping = await this.mappingsService.findByCustomerId(parseInt(customerId, 10));
    return { success: true, data: mapping };
  }

  @Get('customer/:customerId/all')
  @ApiOperation({ summary: 'Get ALL mappings by customer ID' })
  @RequireAnyPermission(
    { entity: 'mappings', action: 'view' },
    { entity: 'activities', action: 'view' },
    { entity: 'activities', action: 'create' }
  )
  async findAllByCustomer(@Param('customerId') customerId: string) {
    const mappings = await this.mappingsService.findAllByCustomerId(parseInt(customerId, 10));
    return { success: true, data: mappings };
  }

  @Get('customer/:customerId/check')
  @ApiOperation({ summary: 'Check if customer is mapped' })
  @RequirePermission('mappings', 'view')
  async checkCustomerMapped(@Param('customerId') customerId: string) {
    const isMapped = await this.mappingsService.isCustomerMapped(parseInt(customerId, 10));
    return { success: true, data: { customer_id: parseInt(customerId, 10), is_mapped: isMapped } };
  }

  @Post()
  @ApiOperation({ summary: 'Create new mapping' })
  @RequirePermission('mappings', 'create')
  async create(@Body() data: any) {
    const mapping = await this.mappingsService.create(data);
    return { success: true, data: mapping, message: 'Mapping created successfully' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update mapping' })
  @RequirePermission('mappings', 'edit')
  async update(@Param('id') id: string, @Body() data: any) {
    const mapping = await this.mappingsService.update(id, data);
    return { success: true, data: mapping, message: 'Mapping updated successfully' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete mapping' })
  @RequirePermission('mappings', 'delete')
  async remove(@Param('id') id: string) {
    await this.mappingsService.delete(id);
    return { success: true, message: 'Mapping deleted successfully' };
  }
}
