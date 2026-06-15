import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ResellerService, ResellerInput } from '../services/reseller.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Resellers')
@Controller('api/resellers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ResellerController {
    constructor(private readonly resellerService: ResellerService) {}

    @Get()
    @ApiOperation({ summary: 'List resellers' })
    @RequirePermission('resellers', 'view')
    async findAll(@Query('search') search: string = '') {
        const data = await this.resellerService.findAll(search);
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create reseller' })
    @RequirePermission('resellers', 'create')
    async create(@Body() body: ResellerInput) {
        const result = await this.resellerService.create(body);
        return { success: true, data: result, message: 'Reseller created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update reseller' })
    @RequirePermission('resellers', 'edit')
    async update(@Param('id') id: string, @Body() body: ResellerInput) {
        await this.resellerService.update(parseInt(id, 10), body);
        return { success: true, message: 'Reseller updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete reseller' })
    @RequirePermission('resellers', 'delete')
    async remove(@Param('id') id: string) {
        await this.resellerService.delete(parseInt(id, 10));
        return { success: true, message: 'Reseller deleted' };
    }

    // Lightweight dropdown endpoint — used by the customer create/edit form
    // and the Group/Reseller Change page. Gated on resellers.view OR
    // group_change.view so anyone who can pick a reseller can list them.
    @Get('dropdown')
    @ApiOperation({ summary: 'List resellers for dropdowns' })
    async dropdown(@Request() req: any) {
        const perms = req.user?.permissions || {};
        const isAdmin = req.user?.role?.toLowerCase() === 'admin';
        const allowed = isAdmin
            || perms.resellers?.view
            || perms.group_change?.view
            || perms.customers_our?.create   // customer create form needs the list
            || perms.customers_not_our?.create
            || perms.customers_our?.edit
            || perms.customers_not_our?.edit;
        if (!allowed) return { success: true, data: [] };
        const data = await this.resellerService.findAll('');
        return { success: true, data };
    }
}
