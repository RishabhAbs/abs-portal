import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, ForbiddenException, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VouchersService } from '../services/vouchers.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Vouchers')
@Controller('api/vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VouchersController {
    constructor(private vouchersService: VouchersService) {}

    @Post()
    @ApiOperation({ summary: 'Create a voucher with ledger & inventory entries' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'create' },
        { entity: 'activities', action: 'create' },
    )
    async create(@Body() body: any, @Request() req: any) {
        console.log('[Voucher] create body:', JSON.stringify(body));
        const isStockJournal = Array.isArray(body.stock_source) || Array.isArray(body.stock_destination);
        const partyId = parseInt(body.party_ledger_id, 10);
        if (!isStockJournal && (!partyId || isNaN(partyId))) throw new BadRequestException('party_ledger_id is required and must be a valid number');
        this.checkVchTypePermission(req, body.vch_type_id);
        const createdBy = req.user?.id ?? req.user?.userId ?? null;
        const result = await this.vouchersService.create({ ...body, created_by: createdBy });
        return { success: true, data: result, message: 'Voucher created successfully' };
    }

    @Get()
    @ApiOperation({ summary: 'List vouchers with filters' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async findAll(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('vch_type') vch_type?: string,
        @Query('search') search?: string,
        @Query('date_from') date_from?: string,
        @Query('date_to') date_to?: string,
    ) {
        const result = await this.vouchersService.findAll(
            parseInt(page || '1', 10),
            parseInt(limit || '20', 10),
            { vch_type, search, date_from, date_to },
        );
        return { success: true, ...result };
    }

    @Get('pending-refs')
    @ApiOperation({ summary: 'Get open bill references for a customer' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'view' },
        { entity: 'vouchers', action: 'create' },
        { entity: 'activities', action: 'view' },
        { entity: 'activities', action: 'create' },
    )
    async getPendingRefs(
        @Query('customer_id') customerId: string,
        @Query('direction') direction?: string,
        @Query('exclude_vch_id') excludeVchId?: string,
    ) {
        const cId = parseInt(customerId, 10);
        if (!cId) return { success: true, data: [] };
        const dir = direction === 'Dr' ? 'Dr' : 'Cr';
        const excludeId = excludeVchId ? parseInt(excludeVchId, 10) : undefined;
        const data = await this.vouchersService.getPendingRefs(
            cId, dir, Number.isFinite(excludeId as number) ? excludeId : undefined,
        );
        return { success: true, data };
    }

    @Get('serials')
    @ApiOperation({ summary: 'Get distinct serial numbers for a customer + flavour' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'view' },
        { entity: 'vouchers', action: 'create' },
        { entity: 'activities', action: 'view' },
        { entity: 'activities', action: 'create' },
    )
    async getSerials(
        @Query('customer_id') customerId: string,
        @Query('flavour_id') flavourId: string,
    ) {
        const cId = parseInt(customerId, 10);
        if (!cId) return { success: true, data: [] };
        const fId = flavourId ? parseInt(flavourId, 10) : undefined;
        const data = await this.vouchersService.getSerials(cId, fId);
        return { success: true, data };
    }

    @Get('next-no')
    @ApiOperation({ summary: 'Get next auto-generated voucher number for a vch_type_id' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'view' },
        { entity: 'vouchers', action: 'create' },
        { entity: 'activities', action: 'view' },
        { entity: 'activities', action: 'create' },
    )
    async getNextNo(@Query('vch_type_id') vchTypeId: string, @Query('for_date') forDate?: string) {
        const id = parseInt(vchTypeId, 10);
        if (!id) return { success: true, data: '' };
        const vch_no = await this.vouchersService.getNextVoucherNo(id, forDate || undefined);
        return { success: true, data: vch_no };
    }

    @Get('daybook')
    @ApiOperation({ summary: 'Get all vouchers for a specific date' })
    @RequireAnyPermission(
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getDaybook(
        @Query('date') date?: string,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
    ) {
        const today = new Date().toISOString().split('T')[0];
        const data = await this.vouchersService.getDaybook({
            date: dateFrom || dateTo ? undefined : (date || today),
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
        });
        return { success: true, data };
    }

    @Get('sales-register/monthly')
    @ApiOperation({ summary: 'Sales Register summary — month-wise totals (Tally landing screen)' })
    @RequireAnyPermission(
        { entity: 'reports_sales_register', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getSalesRegisterMonthly(
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
    ) {
        const data = await this.vouchersService.getSalesRegisterMonthly({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
        });
        return { success: true, data };
    }

    @Get('sales-register')
    @ApiOperation({ summary: 'Sales Register detail — one row per Sales voucher with tax split (drill-down)' })
    @RequireAnyPermission(
        { entity: 'reports_sales_register', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getSalesRegister(
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.vouchersService.getSalesRegister({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get('group-summary')
    @ApiOperation({ summary: 'Group Summary — debit/credit totals grouped by ledger group' })
    @RequireAnyPermission(
        { entity: 'reports_group_summary', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getGroupSummary(
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.vouchersService.getGroupSummary({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get('group-summary/:groupId/ledgers')
    @ApiOperation({ summary: 'Group Summary drill-down — ledgers within a group with opening/dr/cr/closing' })
    @RequireAnyPermission(
        { entity: 'reports_group_summary', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getGroupLedgers(
        @Param('groupId', ParseIntPipe) groupId: number,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.vouchersService.getGroupLedgers({
            groupId,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get('user-wise-outstanding')
    @ApiOperation({ summary: 'User-wise Outstanding — pending receivables aged by user/team' })
    @RequireAnyPermission(
        { entity: 'reports_user_outstanding', action: 'view' },
        { entity: 'reports_outstanding', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getUserWiseOutstanding(
        @Query('as_of') asOf?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.vouchersService.getUserWiseOutstanding({
            asOf: asOf || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get('stock-summary')
    @ApiOperation({ summary: 'Stock Summary — opening / inward / outward / closing per item' })
    @RequireAnyPermission(
        { entity: 'reports_stock_summary', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getStockSummary(
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.vouchersService.getStockSummary({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get('outstanding')
    @ApiOperation({ summary: 'Outstanding bills (one row per (party, bill) with opening + closing)' })
    @RequireAnyPermission(
        { entity: 'reports_outstanding', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getOutstanding(
        @Query('as_of') asOf?: string,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('bill_name') billName?: string,
        @Query('search') search?: string,
        @Query('side') side?: 'receivable' | 'payable' | 'all',
    ) {
        const data = await this.vouchersService.getOutstanding({
            asOf: asOf || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            billName: billName || undefined,
            search: search || undefined,
            side: side || 'all',
        });
        return { success: true, data };
    }

    @Get('ledger')
    @ApiOperation({ summary: 'Tally-style ledger statement for a given party / ledger' })
    @RequireAnyPermission(
        { entity: 'reports_ledger', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async getLedger(
        @Query('ledger_id') ledgerId: string,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('search') search?: string,
    ) {
        const id = parseInt(ledgerId, 10);
        if (!id || isNaN(id)) throw new BadRequestException('ledger_id is required');
        const data = await this.vouchersService.getLedgerStatement({
            ledgerId: id,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search || undefined,
        });
        return { success: true, data };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get voucher detail with ledger & inventory entries' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'view' },
        { entity: 'reports_outstanding', action: 'view' },
        { entity: 'reports_ledger', action: 'view' },
        { entity: 'reports_daybook', action: 'view' },
        { entity: 'activities', action: 'view' },
    )
    async findOne(@Param('id') id: string) {
        const voucher = await this.vouchersService.findById(parseInt(id, 10));
        return { success: true, data: voucher };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update a voucher (re-inserts all child entries)' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'edit' },
        { entity: 'activities', action: 'edit' },
    )
    async update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Request() req: any) {
        const isStockJournal = Array.isArray(body.stock_source) || Array.isArray(body.stock_destination);
        const partyId = parseInt(body.party_ledger_id, 10);
        if (!isStockJournal && (!partyId || isNaN(partyId))) throw new BadRequestException('party_ledger_id is required');
        this.checkVchTypePermission(req, body.vch_type_id);
        const isAdmin = req.user?.role?.toLowerCase() === 'admin';
        const result = await this.vouchersService.update(id, { ...body, created_by: req.user?.id ?? null }, isAdmin);
        return { success: true, data: result, message: 'Voucher updated successfully' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a voucher and all its entries' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'delete' },
        { entity: 'activities', action: 'delete' },
    )
    async remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
        const isAdmin = req.user?.role?.toLowerCase() === 'admin';
        await this.vouchersService.deleteVoucher(id, isAdmin);
        return { success: true, message: 'Voucher deleted' };
    }

    /** Mark a voucher as Checked.
     *  Routine reviewer action — anyone with edit access (or the explicit
     *  vouchers.check permission) can mark. Once marked, only an admin can
     *  unmark the flag (see markUnchecked below) so the audit trail can't
     *  be silently rolled back. */
    @Post(':id/check')
    @ApiOperation({ summary: 'Mark voucher as Checked' })
    @RequireAnyPermission(
        { entity: 'vouchers', action: 'check' },
        { entity: 'vouchers', action: 'edit' },
        { entity: 'activities', action: 'edit' },
    )
    async markChecked(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
        const checker = req.user?.name || req.user?.email || `user#${req.user?.id ?? 'unknown'}`;
        await this.vouchersService.setChecked(id, checker);
        return { success: true, message: `Voucher marked as Checked by ${checker}` };
    }

    /** Remove the Checked flag — admin only. Reverting a check is a
     *  privileged operation because it re-opens the voucher for edits and
     *  effectively rewinds the review state, so we don't grant it to any
     *  per-entity permission. */
    @Post(':id/uncheck')
    @ApiOperation({ summary: 'Remove the Checked flag (admin only)' })
    async markUnchecked(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
        if (req.user?.role?.toLowerCase() !== 'admin') {
            throw new BadRequestException('Only an admin can remove the Checked flag');
        }
        await this.vouchersService.setChecked(id, null);
        return { success: true, message: 'Voucher Checked flag removed' };
    }

    // Check if user is allowed to use this voucher type (parent id restriction)
    private checkVchTypePermission(req: any, vchTypeId: any) {
        if (req.user?.role?.toLowerCase() === 'admin') return;
        const allowed: number[] = req.user?.permissions?.vouchers?.allowed_vch_parent_ids ?? [];
        if (allowed.length === 0) return; // empty = all allowed
        const parentId = parseInt(vchTypeId, 10);
        if (!parentId || !allowed.includes(parentId)) {
            throw new ForbiddenException('You are not allowed to create/edit this voucher type');
        }
    }
}
