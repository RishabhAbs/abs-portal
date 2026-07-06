import {
    Controller, Post, Get, Param, Body, Query, UseGuards, UseInterceptors,
    UploadedFile, Request, Res, ParseIntPipe, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { VoucherShareService } from '../services/voucher-share.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

/** Authenticated share actions: upload the rendered PDF, send the email. */
@ApiTags('Voucher Share')
@Controller('api/vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VoucherShareController {
    constructor(private readonly share: VoucherShareService) {}

    @Post(':id/share-pdf')
    @ApiOperation({ summary: 'Upload the rendered voucher PDF; returns the public share token' })
    @RequireAnyPermission({ entity: 'vouchers', action: 'view' }, { entity: 'activities', action: 'view' })
    @UseInterceptors(FileInterceptor('file'))
    async uploadPdf(
        @Param('id', ParseIntPipe) id: number,
        @UploadedFile() file: any,
        @Request() req: any,
    ) {
        if (!file?.buffer) throw new BadRequestException('PDF file is required (multipart field "file")');
        const data = await this.share.storePdf(id, file.buffer, req.user?.name || req.user?.id || null);
        return { success: true, data };
    }

    @Post(':id/share-email')
    @ApiOperation({ summary: 'Email the voucher (details + PDF attachment) to the customer\'s registered email' })
    @RequireAnyPermission({ entity: 'vouchers', action: 'view' }, { entity: 'activities', action: 'view' })
    async shareEmail(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { token?: string; to?: string },
        @Request() req: any,
    ) {
        if (!body?.token) throw new BadRequestException('token (from share-pdf upload) is required');
        const publicBase = `${req.protocol}://${req.get('host')}`;
        const data = await this.share.emailVoucher(id, { token: body.token, to: body.to, publicBase });
        return { success: true, sent_to: data.sent_to };
    }

    @Get(':id/share-summary')
    @ApiOperation({ summary: 'Voucher + registered contact summary used to compose share messages' })
    @RequireAnyPermission({ entity: 'vouchers', action: 'view' }, { entity: 'activities', action: 'view' })
    async shareSummary(@Param('id', ParseIntPipe) id: number) {
        const data = await this.share.getVoucherSummary(id);
        return { success: true, data };
    }
}

/** Public, unauthenticated download of a shared voucher PDF — the link sent
 *  over WhatsApp / SMS / in the email body. Token is a 48-char random hex,
 *  unguessable; only vouchers someone explicitly shared are reachable. */
@ApiTags('Voucher Share (Public)')
@Controller('api/public')
export class PublicVoucherPdfController {
    constructor(private readonly share: VoucherShareService) {}

    @Get('voucher-pdf/:token')
    @ApiOperation({ summary: 'Download a shared voucher PDF (public link)' })
    async download(@Param('token') token: string, @Query('dl') dl: string, @Res() res: Response) {
        if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) throw new NotFoundException();
        const { filePath, vchNo } = await this.share.getPdfByToken(token);
        const filename = `${(vchNo || 'voucher').replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dl === '1' ? 'attachment' : 'inline'}; filename="${filename}"`);
        res.sendFile(filePath);
    }
}
