import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OtherLedgerService } from '../services/other-ledger.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

@ApiTags('Other Ledgers')
@Controller('api/other-ledgers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OtherLedgerController {
    constructor(private otherLedgerService: OtherLedgerService) {}

    @Get()
    @ApiOperation({ summary: 'Get all other ledgers (scoped to the user\'s ledger group when one is assigned)' })
    @RequirePermission('other_ledgers', 'view')
    async findAll(@Req() req: any) {
        const data = await this.otherLedgerService.findAll(req.user);
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create other ledger' })
    @RequirePermission('other_ledgers', 'create')
    async create(@Body() body: { company: string; ledgergroup: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) {
        const item = await this.otherLedgerService.create(body);
        return { success: true, data: item, message: 'Ledger created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update other ledger' })
    @RequirePermission('other_ledgers', 'edit')
    async update(@Param('id') id: string, @Body() body: { company?: string; ledgergroup?: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) {
        await this.otherLedgerService.update(parseInt(id, 10), body);
        return { success: true, message: 'Ledger updated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete other ledger' })
    @RequirePermission('other_ledgers', 'delete')
    async remove(@Param('id') id: string) {
        await this.otherLedgerService.delete(parseInt(id, 10));
        return { success: true, message: 'Ledger deleted' };
    }
}
