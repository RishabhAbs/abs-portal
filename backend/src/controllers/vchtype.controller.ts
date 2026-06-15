import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
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
    async create(@Body() body: { name: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }) {
        const item = await this.vchTypeService.create(body);
        return { success: true, data: item, message: 'Voucher type created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update voucher type' })
    @RequirePermission('vch_types', 'edit')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; parent_id?: number | null; deemed_positive?: 'YES' | 'NO' | null }
    ) {
        await this.vchTypeService.update(parseInt(id, 10), body);
        return { success: true, message: 'Voucher type updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete voucher type' })
    @RequirePermission('vch_types', 'delete')
    async remove(@Param('id') id: string) {
        await this.vchTypeService.delete(parseInt(id, 10));
        return { success: true, message: 'Voucher type deleted' };
    }
}
