import { Controller, Get, Post, Query, Body, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { TallyService } from '../services/tally.service';

// Set TALLY_SYNC_KEY in your .env to change this secret.
// Tally must send:  x-tally-key: <value>  in every request header.
const TALLY_API_KEY = process.env.TALLY_SYNC_KEY || 'abs-tally-2024';

function checkKey(key: string) {
    if (!key || key !== TALLY_API_KEY) {
        throw new UnauthorizedException('Invalid or missing x-tally-key header');
    }
}

@Controller('api/tally-sync')
export class TallySyncController {
    constructor(private readonly tallyService: TallyService) {}

    /**
     * GET /api/tally-sync/vouchers
     *
     * Tally calls this to pull all vouchers that have not yet been synced
     * (tally_synced_at IS NULL). Supports optional date filtering and
     * voucher-type filtering. Paginated — use page + limit params.
     *
     * After importing, Tally must call POST /api/tally-sync/acknowledge
     * with the list of voucher IDs so they are excluded from future fetches.
     *
     * Headers: x-tally-key: <TALLY_SYNC_KEY>
     * Query params:
     *   date_from  – YYYY-MM-DD  filter vouchers from this date
     *   date_to    – YYYY-MM-DD  filter vouchers up to this date
     *   vch_type   – e.g. Sales | Purchase | Payment | Receipt | Journal | Contra
     *   page       – default 1
     *   limit      – default 100, max 500
     *   include_all – 1 to also return already-synced vouchers (for re-import / audit)
     */
    @Get('vouchers')
    async getVouchers(
        @Headers('x-tally-key') apiKey: string,
        @Query('date_from')   dateFrom?: string,
        @Query('date_to')     dateTo?: string,
        @Query('vch_type')    vchType?: string,
        @Query('page')        page?: string,
        @Query('limit')       limit?: string,
        @Query('include_all') includeAll?: string,
    ) {
        checkKey(apiKey);
        const result = await this.tallyService.getTallyVouchers({
            dateFrom:   dateFrom  || undefined,
            dateTo:     dateTo    || undefined,
            vchType:    vchType   || undefined,
            page:       page   ? parseInt(page,  10) : 1,
            limit:      limit  ? parseInt(limit, 10) : 100,
            includeAll: includeAll === '1',
        });
        return { success: true, ...result };
    }

    /**
     * POST /api/tally-sync/acknowledge
     *
     * Tally calls this after successfully importing a batch of vouchers.
     * Stamps tally_synced_at on each ID so they are excluded from future
     * GET /api/tally-sync/vouchers responses.
     *
     * Body: { "ids": [1, 2, 3, ...] }
     * Headers: x-tally-key: <TALLY_SYNC_KEY>
     */
    @Post('acknowledge')
    async acknowledge(
        @Headers('x-tally-key') apiKey: string,
        @Body() body: { ids?: number[] },
    ) {
        checkKey(apiKey);
        const ids = body?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new BadRequestException('ids must be a non-empty array of voucher IDs');
        }
        const nums = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
        if (nums.length === 0) {
            throw new BadRequestException('ids must contain valid positive integers');
        }
        const result = await this.tallyService.acknowledgeTallySync(nums);
        return { success: true, ...result };
    }
}
