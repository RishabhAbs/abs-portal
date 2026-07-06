import { Controller, Get, Post, Query, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { TallyService } from '../services/tally.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@Controller('api/tally')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TallyController {
    constructor(private readonly tallyService: TallyService) {}

    @Get('expiry-report')
    @RequireAnyPermission({ entity: 'expiry_renew_our', action: 'view' }, { entity: 'expiry_renew_not_our', action: 'view' })
    async getExpiryReport(
        @Query('customer_type') customer_type?: 'our' | 'not_our',
        @Query('expiry_status') expiry_status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('date_from') date_from?: string,
        @Query('date_to') date_to?: string,
        @Req() req?: any,
    ) {
        return this.tallyService.getExpiryReport({
            customer_type,
            expiry_status,
            search,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
            date_from,
            date_to,
            user: req?.user,
        });
    }

    @Post('renewal-call')
    @RequireAnyPermission({ entity: 'expiry_renew_our', action: 'view' }, { entity: 'expiry_renew_not_our', action: 'view' })
    async updateRenewalCall(@Body() data: any, @Req() req: any) {
        return this.tallyService.updateExpiryCall({
            ...data,
            user_name: req.user.name,
        });
    }

    /** Auto-called by the quick-invoice flow after a voucher is created for
     *  a serial from the expiry report. This is the only path that sets the
     *  Billed status — it requires a real voucher id, so the status can't be
     *  set manually. */
    @Post('mark-billed')
    @RequireAnyPermission({ entity: 'expiry_renew_our', action: 'view' }, { entity: 'expiry_renew_not_our', action: 'view' })
    async markBilled(@Body() body: { tallyserial: string; voucher_id: number }) {
        return this.tallyService.markTallyBilled(body?.tallyserial, Number(body?.voucher_id));
    }

    @Post('upsert-detail')
    async upsertTallyDetail(@Body() data: any, @Req() req: any) {
        const isAdmin = req.user?.role?.toLowerCase() === 'admin';
        if (!isAdmin) throw new ForbiddenException('Only admin can update Tally serial details');
        return this.tallyService.upsertTallyDetail(data);
    }

    @Post('sync-serial')
    async syncSerialNow(@Body() body: { serial: string }, @Req() req: any) {
        return this.tallyService.syncSerialNow(body?.serial, req.user?.name || 'system');
    }

    @Get('expiry-call-history')
    @RequireAnyPermission({ entity: 'expiry_renew_our', action: 'view' }, { entity: 'expiry_renew_not_our', action: 'view' })
    async getExpiryCallHistory(@Query('serial') serial: string) {
        const data = await this.tallyService.getExpiryCallHistory(serial);
        return { success: true, data };
    }

    @Get('serial-history')
    async getSerialHistory(@Query('serial') serial: string, @Query('limit') limit?: string) {
        const data = await this.tallyService.getSerialUpdateHistory(serial, limit ? parseInt(limit) : 50);
        return { success: true, data };
    }
}
