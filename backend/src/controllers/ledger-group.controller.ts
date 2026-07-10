import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LedgerGroupService } from '../services/ledger-group.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission, RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Ledger Groups')
@Controller('api/ledger-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LedgerGroupController {
    constructor(private ledgerGroupService: LedgerGroupService) {}

    @Get()
    @ApiOperation({ summary: 'Get all ledger groups' })
    // Read-only list is also needed by the Group Transfer page (destination dropdown).
    @RequireAnyPermission({ entity: 'ledger_groups', action: 'view' }, { entity: 'group_transfer', action: 'view' })
    async findAll() {
        const data = await this.ledgerGroupService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create ledger group' })
    @RequirePermission('ledger_groups', 'create')
    async create(@Body() body: { name: string; parent_id?: number | null }) {
        const item = await this.ledgerGroupService.create(body);
        return { success: true, data: item, message: 'Ledger group created' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update ledger group' })
    @RequirePermission('ledger_groups', 'edit')
    async update(@Param('id') id: string, @Body() body: { name?: string; parent_id?: number | null }) {
        await this.ledgerGroupService.update(parseInt(id, 10), body);
        return { success: true, message: 'Ledger group updated' };
    }

    @Put(':id/active')
    @ApiOperation({ summary: 'Activate / deactivate a ledger group' })
    @RequirePermission('ledger_groups', 'edit')
    async setActive(@Param('id') id: string, @Body() body: { active: boolean }) {
        await this.ledgerGroupService.setActive(parseInt(id, 10), !!body.active);
        return { success: true, message: body.active ? 'Ledger group activated' : 'Ledger group deactivated' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete ledger group' })
    @RequirePermission('ledger_groups', 'delete')
    async remove(@Param('id') id: string) {
        await this.ledgerGroupService.delete(parseInt(id, 10));
        return { success: true, message: 'Ledger group deleted' };
    }
}
