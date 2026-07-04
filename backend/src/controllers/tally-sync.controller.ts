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
        const result = await this.tallyService.acknowledgeTallySync(parseIds(body));
        return { success: true, ...result };
    }

    /**
     * GET /api/tally-sync/items
     *
     * Stock item masters. Tally should import these (and ledgers) BEFORE
     * vouchers so every <STOCKITEM> referenced by a voucher already exists.
     * Same poll-and-acknowledge contract as vouchers: unsynced by default,
     * acknowledge with POST /api/tally-sync/items/acknowledge.
     *
     * Query params: page (default 1), limit (default 100, max 500),
     *               include_all=1 to also return already-synced items.
     */
    @Get('items')
    async getItems(
        @Headers('x-tally-key') apiKey: string,
        @Query('page')        page?: string,
        @Query('limit')       limit?: string,
        @Query('include_all') includeAll?: string,
        @Query('search')      search?: string,
    ) {
        checkKey(apiKey);
        const result = await this.tallyService.getTallyItems({
            page:       page  ? parseInt(page,  10) : 1,
            limit:      limit ? parseInt(limit, 10) : 100,
            includeAll: includeAll === '1',
            search:     search || undefined,
        });
        return { success: true, ...result };
    }

    /** POST /api/tally-sync/items/acknowledge — Body: { "ids": [...] } */
    @Post('items/acknowledge')
    async acknowledgeItems(
        @Headers('x-tally-key') apiKey: string,
        @Body() body: { ids?: number[] },
    ) {
        checkKey(apiKey);
        const result = await this.tallyService.acknowledgeTallyItems(parseIds(body));
        return { success: true, ...result };
    }

    /**
     * GET /api/tally-sync/ledgers
     *
     * Ledger masters — one row per customer record (the customer table is
     * this app's ledger master; voucher party and ledger entries reference
     * it). Includes group, GSTIN, full address with resolved state, contact,
     * opening balance and bill-by-bill flag.
     *
     * Query params: page (default 1), limit (default 100, max 500),
     *               include_all=1 to also return already-synced ledgers.
     */
    @Get('ledgers')
    async getLedgers(
        @Headers('x-tally-key') apiKey: string,
        @Query('page')        page?: string,
        @Query('limit')       limit?: string,
        @Query('include_all') includeAll?: string,
        @Query('search')      search?: string,
    ) {
        checkKey(apiKey);
        const result = await this.tallyService.getTallyLedgers({
            page:       page  ? parseInt(page,  10) : 1,
            limit:      limit ? parseInt(limit, 10) : 100,
            includeAll: includeAll === '1',
            search:     search || undefined,
        });
        return { success: true, ...result };
    }

    /** POST /api/tally-sync/ledgers/acknowledge — Body: { "ids": [...] } */
    @Post('ledgers/acknowledge')
    async acknowledgeLedgers(
        @Headers('x-tally-key') apiKey: string,
        @Body() body: { ids?: number[] },
    ) {
        checkKey(apiKey);
        const result = await this.tallyService.acknowledgeTallyLedgers(parseIds(body));
        return { success: true, ...result };
    }
}

/** Shared body validation for all acknowledge endpoints. */
function parseIds(body: { ids?: number[] }): number[] {
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
        throw new BadRequestException('ids must be a non-empty array of IDs');
    }
    const nums = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (nums.length === 0) {
        throw new BadRequestException('ids must contain valid positive integers');
    }
    return nums;
}
