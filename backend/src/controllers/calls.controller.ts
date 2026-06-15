import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CallsService } from '../services/calls.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Customer Calls')
@Controller('api/calls')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CallsController {
    constructor(private callsService: CallsService) {}

    @Post('create')
    @ApiOperation({ summary: 'Log a customer call' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'create' },
        { entity: 'visits_not_our', action: 'create' },
    )
    async create(
        @Body() body: {
            customer_id: number;
            customer_name?: string;
            phone_no?: string;
            user_name?: string;
            call_status: string;
            call_notes?: string;
            call_responses?: any;
        },
        @Request() req: any,
    ) {
        const callerName = body.user_name || req.user?.name || req.user?.email || 'Unknown';
        const assignedBy = req.user?.name || req.user?.email || 'Unknown';

        const result = await this.callsService.create({
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            phone_no: body.phone_no,
            user_name: callerName,
            assigned_by: assignedBy,
            call_status: body.call_status,
            call_notes: body.call_notes,
            call_responses: body.call_responses,
        });

        return { success: true, data: result, message: 'Call logged successfully' };
    }

    @Get()
    @ApiOperation({ summary: 'List all customer calls with filters' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'view' },
        { entity: 'visits_not_our', action: 'view' },
        { entity: 'call_report', action: 'view' }
    )
    async getAll(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('user_name') user_name?: string,
        @Query('date_from') date_from?: string,
        @Query('date_to') date_to?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
        @Request() req?: any,
    ) {
        const isAdmin = req.user?.role?.toLowerCase() === 'admin';
        const currentUser = req.user?.name || req.user?.email || '';

        const result = await this.callsService.findAll(
            parseInt(page || '1', 10),
            parseInt(limit || '20', 10),
            { status, search, user_name, date_from, date_to },
            currentUser,
            isAdmin,
            req.user?.id,
            sortBy,
            sortOrder,
            req.user?.adminName,
        );

        return { success: true, ...result };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single call detail' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'view' },
        { entity: 'visits_not_our', action: 'view' },
    )
    async getById(@Param('id') id: string) {
        const call = await this.callsService.findById(parseInt(id, 10));
        return { success: true, data: call };
    }
}
