import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VchTypeService } from '../services/vchtype.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Voucher Types')
@Controller('api/vchtypes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VchTypeController {
    constructor(private vchTypeService: VchTypeService) {}

    @Get()
    @ApiOperation({ summary: 'Get all voucher types' })
    @RequireAnyPermission(
        { entity: 'vch_types', action: 'view' },
        { entity: 'vouchers', action: 'view' },
        { entity: 'vouchers', action: 'create' },
        { entity: 'activities', action: 'view' },
    )
    async findAll() {
        const data = await this.vchTypeService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create voucher type' })
    @RequirePermission('vch_types', 'create')
    async create(@Body() body: any) {
        const item = await this.vchTypeService.create(body);
        return { success: true, data: item, message: 'Voucher type created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update voucher type' })
    @RequirePermission('vch_types', 'edit')
    async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
        await this.vchTypeService.update(parseInt(id, 10), body, req.user?.name || req.user?.id || null);
        return { success: true, message: 'Voucher type updated' };
    }

    @Get(':id/audit')
    @ApiOperation({ summary: 'Numbering/prefix/suffix config history for a voucher type' })
    @RequirePermission('vch_types', 'edit')
    async audit(@Param('id') id: string) {
        const data = await this.vchTypeService.getAudit(parseInt(id, 10));
        return { success: true, data };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete voucher type' })
    @RequirePermission('vch_types', 'delete')
    async remove(@Param('id') id: string) {
        await this.vchTypeService.delete(parseInt(id, 10));
        return { success: true, message: 'Voucher type deleted' };
    }
}
