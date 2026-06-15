import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from '../services/customers.service';
import { AdminsService } from '../services/admins.service';
import { UsersService } from '../services/users.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Customers')
@Controller('api/customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CustomersController {
  constructor(
    private customersService: CustomersService,
    private adminsService: AdminsService,
    private usersService: UsersService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Get all customers with pagination' })
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('search') search: string = '',
    @Query('status') status: string = 'all',
    @Query('mapped_only') mappedOnly: string = 'false',
    @Query('aging') aging: string = '',
    @Query('city') city: string = '',
    @Query('pincode') pincode: string = '',
    @Query('group') group: string = '',
    @Query('state') state: string = '',
    @Query('date_from') dateFrom: string = '',
    @Query('date_to') dateTo: string = '',
    @Query('last_visit_person') lastVisitPerson: string = '',
    @Query('sortBy') sortBy: string = 'lastvisitdate',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'DESC',
    @Query('exclude_pending_visits') excludePendingVisits: string = 'false',
    @Query('customer') customerFilter: string = '',
    @Query('contact') contactFilter: string = '',
    @Query('phone') phoneFilter: string = '',
    @Query('email') emailFilter: string = '',
    @Query('area') areaFilter: string = '',
    @Query('gstin') gstinFilter: string = '',
    @Query('reseller') resellerFilter: string = '',
    @Query('active_status') activeStatusFilter: string = '',
    @Query('min_lic') minLicFilter: string = '',
    @Query('min_active') minActiveFilter: string = '',
    @Query('min_not_ours') minNotOursFilter: string = '',
    @Request() req: any
  ) {
    const user = req.user;
    const isMappedOnly = mappedOnly === 'true';

    // Granular Permission Check
    if (user?.role?.toLowerCase() !== 'admin') {
      const canSeeOur = user.permissions?.customers_our?.view;
      const canSeeOthers = user.permissions?.customers_not_our?.view;
      const canSearch = user.permissions?.customer_search?.view;
      
      // Allow searching customers if the user has any related feature permission
      const hasRelatedAccess = canSearch ||
        user.permissions?.activities?.create || user.permissions?.activities?.edit || user.permissions?.activities?.view ||
        user.permissions?.visits_our?.view || user.permissions?.visits_not_our?.view ||
        user.permissions?.mappings?.view ||
        user.permissions?.service_calls?.view;

      if (status === 'Active' || status === 'Our Customer') {
        if (!canSeeOur && !hasRelatedAccess) throw new ForbiddenException('No permission to view "Our Customers"');
      } else if (status === 'Others' || status === 'Not Our Customer') {
        if (!canSeeOthers && !hasRelatedAccess) throw new ForbiddenException('No permission to view "Not Our Customers"');
      } else if (status === 'all') {
        // If searching all, they must have both or we force a filter
        if (!canSeeOur && !canSeeOthers && !hasRelatedAccess) {
          throw new ForbiddenException('No permission to view customers');
        }
        // If they only have one, we MUST force the status filter to that one
        if (!hasRelatedAccess) {
          if (canSeeOur && !canSeeOthers) status = 'Active';
          else if (!canSeeOur && canSeeOthers) status = 'Others';
        }
      }
    }

    const parsedPage = Number(page) || 1;
    const parsedLimit = Number(limit) || 50;

    // Users with visit/customer/activity permissions should see all customers (no group filter)
    const hasRelatedAccess = user?.role?.toLowerCase() !== 'admin' && (
      user.permissions?.customer_search?.view ||
      user.permissions?.activities?.create || user.permissions?.activities?.edit || user.permissions?.activities?.view ||
      user.permissions?.visits_our?.view || user.permissions?.visits_not_our?.view ||
      user.permissions?.mappings?.view ||
      user.permissions?.service_calls?.view
    );
    const effectiveRole = hasRelatedAccess ? 'admin' : user.role;

    const result = await this.customersService.findAll(
      parsedPage, parsedLimit, search, status, isMappedOnly, aging, city, pincode, group, state, dateFrom, dateTo, lastVisitPerson,
      sortBy || 'lastvisitdate', sortOrder || 'DESC', effectiveRole, user.adminId, user.userId, user.adminName,
      excludePendingVisits === 'true',
      gstinFilter, resellerFilter, activeStatusFilter,
      customerFilter, contactFilter, phoneFilter, emailFilter, areaFilter,
      minLicFilter, minActiveFilter, minNotOursFilter,
    );
    return { success: true, ...result };
  }



  @Get('ledger-search')
  @ApiOperation({ summary: 'Search all ledgers (all groups) for voucher journal entries' })
  @RequireAnyPermission(
    { entity: 'activities', action: 'view' },
    { entity: 'activities', action: 'create' },
    { entity: 'vouchers', action: 'view' },
    { entity: 'vouchers', action: 'create' },
  )
  async searchAllLedgers(@Query('q') q: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const allowedGroupIds: number[] = (!isAdmin && req.user?.permissions?.vouchers?.allowed_ledger_group_ids?.length)
      ? req.user.permissions.vouchers.allowed_ledger_group_ids
      : [];
    const data = await this.customersService.searchAllLedgers(q || '', allowedGroupIds);
    return { success: true, data };
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Fast autocomplete search for customer names' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'view' },
    { entity: 'customers_not_our', action: 'view' },
    { entity: 'customer_search', action: 'view' },
    { entity: 'activities', action: 'create' },
    { entity: 'service_calls', action: 'view' },
    { entity: 'mappings', action: 'view' },
    { entity: 'visits_our', action: 'create' },
    { entity: 'visits_not_our', action: 'create' }
  )
  async autocomplete(@Query('q') q: string, @Request() req: any) {
    const isAdmin = req.user?.role?.toLowerCase() === 'admin';
    const userId = req.user?.id;
    // Admins, users with view_all_groups, or users with activities permission see all customers
    const hasActivities = req.user?.permissions?.activities?.create || req.user?.permissions?.activities?.view;
    const viewAllGroups = isAdmin || hasActivities || req.user?.permissions?.customer_search?.view_all_groups === true;
    const groupFilter = viewAllGroups ? null : (userId || 'BLOCK');
    const data = await this.customersService.autocomplete(q, groupFilter);
    return { success: true, data };
  }

  @Get('dropdown')
  @ApiOperation({ summary: 'Get lightweight customer list for dropdowns' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'view' },
    { entity: 'customers_not_our', action: 'view' },
    { entity: 'customer_search', action: 'view' },
    { entity: 'activities', action: 'create' },
    { entity: 'service_calls', action: 'create' },
    { entity: 'service_calls', action: 'view' },
    { entity: 'mappings', action: 'create' },
    { entity: 'visits_our', action: 'create' },
    { entity: 'visits_not_our', action: 'create' }
  )
  async getDropdown() {
    const data = await this.customersService.getForDropdown();
    return { success: true, data };
  }

  @Get('resellers')
  @ApiOperation({ summary: 'Get list of resellers' })
  async getResellers() {
    const data = await this.customersService.findAllResellers();
    return { success: true, data };
  }

  @Get('search-detail')
  @ApiOperation({ summary: 'Comprehensive customer search with permission-gated sections' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'view' },
    { entity: 'customers_not_our', action: 'view' },
    { entity: 'customer_search', action: 'view' },
    { entity: 'service_calls', action: 'view' },
    { entity: 'activities', action: 'view' },
    { entity: 'visits_our', action: 'view' },
    { entity: 'visits_not_our', action: 'view' }
  )
  async searchDetail(
    @Query('search') search: string,
    @Query('search_type') searchType: string,
    @Request() req: any
  ) {
    const user = req.user;
    const isAdmin = user.role?.toLowerCase() === 'admin';
    const hasActivities = user.permissions?.activities?.create || user.permissions?.activities?.view;
    const viewAllGroups = isAdmin || hasActivities || user.permissions?.customer_search?.view_all_groups === true;
    // Group filter only applies to company/person name searches
    // Phone, email, serial, id searches are unrestricted
    const nameSearch = searchType === 'company' || searchType === 'person';
    const groupFilter = (nameSearch && !viewAllGroups) ? (user.id || 'BLOCK') : null;
    const result = await this.customersService.searchDetail(
      search,
      searchType,
      user.permissions,
      isAdmin,
      groupFilter
    );
    return { success: true, ...result };
  }

  // ── User Mapping Endpoints (Admin Only) ──
  // IMPORTANT: These must be ABOVE @Get(':id') to avoid route shadowing

  @Get('mapping/legacy-admins')
  @ApiOperation({ summary: 'Get all legacy admin users with customer counts' })
  async getLegacyAdmins(@Request() req: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin only');
    const data = await this.adminsService.findAllLegacy();
    return { success: true, data };
  }

  @Get('mapping/cloud-users')
  @ApiOperation({ summary: 'Get all cloud users for mapping dropdown' })
  async getCloudUsersForMapping(@Request() req: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin only');
    const result = await this.usersService.findAll();
    return { success: true, data: result };
  }

  @Get('mapping/by-admin/:adminId')
  @ApiOperation({ summary: 'Get customers by legacy admin group ID' })
  async getByAdminGroup(
    @Param('adminId') adminId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('search') search: string = '',
    @Request() req: any
  ) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin only');
    const result = await this.customersService.findByAdminGroup(
      parseInt(adminId, 10),
      Number(page) || 1,
      Number(limit) || 50,
      search
    );
    return { success: true, ...result };
  }

  @Post('mapping/apply')
  @ApiOperation({ summary: 'Map selected customers to cloud users' })
  async applyMapping(
    @Body() body: { customerIds: number[]; cloudGroupId?: string; subgroupId?: string },
    @Request() req: any
  ) {
    if (req.user?.role?.toLowerCase() !== 'admin') throw new ForbiddenException('Admin only');
    const result = await this.customersService.mapCloudUser(
      body.customerIds,
      body.cloudGroupId || null,
      body.subgroupId || null
    );
    return { success: true, ...result, message: `Updated ${result.updated} customers` };
  }

  @Get('inactive')
  @ApiOperation({ summary: 'List inactive customers (admin only)' })
  async listInactive(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Request() req?: any,
  ) {
    if (req?.user?.role?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Only admin can view inactive customers');
    }
    const result = await this.customersService.findInactive({
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate an inactive customer (admin only)' })
  async reactivate(@Param('id') id: string, @Request() req: any) {
    if (req?.user?.role?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Only admin can reactivate customers');
    }
    await this.customersService.reactivate(parseInt(id, 10));
    return { success: true, message: 'Customer reactivated' };
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Paginated customer history (calls / visits / service calls)' })
  async getHistory(
    @Param('id') id: string,
    @Query('type') type: 'call' | 'visit' | 'service',
    @Query('search') search?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.customersService.getHistory(parseInt(id, 10), {
      type,
      search,
      dateFrom,
      dateTo,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
    return { success: true, ...result };
  }

  @Get(':id/opening-bills')
  @ApiOperation({ summary: 'Get opening-balance bill allocation for a customer' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'view' },
    { entity: 'customers_not_our', action: 'view' },
    { entity: 'other_ledgers', action: 'view' },
    { entity: 'activities', action: 'view' },
  )
  async getOpeningBills(@Param('id') id: string) {
    const data = await this.customersService.getOpeningBills(parseInt(id, 10));
    return { success: true, data };
  }

  @Put(':id/opening-bills')
  @ApiOperation({ summary: 'Save (replace) opening-balance bill allocation for a customer' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'edit' },
    { entity: 'customers_not_our', action: 'edit' },
    { entity: 'other_ledgers', action: 'edit' },
  )
  async saveOpeningBills(
    @Param('id') id: string,
    @Body() body: { bills: Array<{ bill_name: string; bill_date?: string | null; amount: number; ref_type?: 'Bill' | 'On Account' }> },
  ) {
    await this.customersService.saveOpeningBills(parseInt(id, 10), body.bills || []);
    return { success: true, message: 'Opening bill allocation saved' };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by ID' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'view' },
    { entity: 'customers_not_our', action: 'view' },
    { entity: 'activities', action: 'view' },
    { entity: 'service_calls', action: 'view' },
    { entity: 'mappings', action: 'view' },
    { entity: 'visits_our', action: 'view' },
    { entity: 'visits_not_our', action: 'view' }
  )
  async findOne(@Param('id') id: string) {
    const customer = await this.customersService.findById(parseInt(id, 10));
    return { success: true, data: customer };
  }

  @Post()
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() data: any, @Request() req: any) {
    // For creation, we also check the status they are trying to set
    const user = req.user;
    if (user?.role?.toLowerCase() !== 'admin') {
      // Users with service_calls.close can create customers from service flow
      const canCreateFromService = user.permissions?.service_calls?.close;
      if (!canCreateFromService) {
        const status = data.status || 'Active';
        if (status === 'Active' && !user.permissions?.customers_our?.create) {
          throw new ForbiddenException('No permission to create "Our Customer"');
        }
        if (status !== 'Active' && !user.permissions?.customers_not_our?.create) {
          throw new ForbiddenException('No permission to create "Not Our Customer"');
        }
      }
      // Reseller assignment is gated by resellers.edit. Strip the field
      // server-side so a tampered payload from a user without perm can't
      // sneak through.
      if (!user.permissions?.resellers?.edit && data.resellerid !== undefined) {
        delete data.resellerid;
      }
    }

    const customer = await this.customersService.create(data);
    return { success: true, data: customer, message: 'Customer created successfully' };
  }

  @Post(':id/contacts')
  @ApiOperation({ summary: 'Create a new contact for a customer' })
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'edit' },
    { entity: 'customers_not_our', action: 'edit' },
    { entity: 'customer_search', action: 'edit' }
  )
  async createContact(@Param('id') id: string, @Body() data: any) {
    const contact = await this.customersService.createContact(parseInt(id, 10), data);
    return { success: true, data: contact, message: 'Contact created successfully' };
  }

  @Put(':id/contacts/:contactId')
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'edit' },
    { entity: 'customers_not_our', action: 'edit' },
    { entity: 'customer_search', action: 'edit' }
  )
  async updateContactMapping(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() data: { status?: string; primary_contact?: string; contact_person?: string }
  ) {
    await this.customersService.updateContactMapping(parseInt(id, 10), parseInt(contactId, 10), data);
    return { success: true, message: 'Contact mapping updated successfully' };
  }

  @Post(':id/map-company')
  @RequireAnyPermission(
    { entity: 'customers_our', action: 'edit' },
    { entity: 'customers_not_our', action: 'edit' },
    { entity: 'customer_search', action: 'edit' }
  )
  async mapCompany(
    @Param('id') id: string,
    @Body('targetCustomerId') targetCustomerId: number
  ) {
    await this.customersService.mapCompany(parseInt(id, 10), targetCustomerId);
    return { success: true, message: 'Companies mapped successfully' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update customer' })
  async update(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    const user = req.user;
    const isAdmin = user?.role?.toLowerCase() === 'admin';

    if (!isAdmin) {
      const existing = await this.customersService.findById(parseInt(id, 10));
      const currentStatus = existing.status || 'Active';

      if (currentStatus === 'Active' && !user.permissions?.customers_our?.edit) {
        throw new ForbiddenException('No permission to edit "Our Customer"');
      }
      if (currentStatus !== 'Active' && !user.permissions?.customers_not_our?.edit) {
        throw new ForbiddenException('No permission to edit "Not Our Customer"');
      }

      // Non-admin can ONLY update address1/2/3 — strip everything else from the payload
      // before it reaches the service. Reseller is allowed through if the user
      // holds resellers.edit (so a salesperson with reseller perm can attach
      // a reseller without getting full customer-edit power).
      const canEditReseller = !!user.permissions?.resellers?.edit;
      data = {
        ...(data.address1 !== undefined ? { address1: data.address1 } : {}),
        ...(data.address2 !== undefined ? { address2: data.address2 } : {}),
        ...(data.address3 !== undefined ? { address3: data.address3 } : {}),
        ...(canEditReseller && data.resellerid !== undefined ? { resellerid: data.resellerid } : {}),
      };
      if (Object.keys(data).length === 0) {
        throw new ForbiddenException('Non-admin users can only update address or reseller fields');
      }
    }

    const customer = await this.customersService.update(parseInt(id, 10), data);
    return { success: true, data: customer, message: 'Customer updated successfully' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete customer' })
  async remove(@Param('id') id: string, @Request() req: any) {
    const user = req.user;
    if (user?.role?.toLowerCase() !== 'admin') {
      const existing = await this.customersService.findById(parseInt(id, 10));
      const status = existing.status || 'Active';
      if (status === 'Active' && !user.permissions?.customers_our?.delete) {
        throw new ForbiddenException('No permission to delete "Our Customer"');
      }
      if (status !== 'Active' && !user.permissions?.customers_not_our?.delete) {
        throw new ForbiddenException('No permission to delete "Not Our Customer"');
      }
    }

    await this.customersService.delete(parseInt(id, 10));
    return { success: true, message: 'Customer deleted successfully' };
  }
}

