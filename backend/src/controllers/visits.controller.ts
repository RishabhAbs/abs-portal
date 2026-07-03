import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { createReadStream, existsSync } from 'fs';
import { Response } from 'express';
import { VisitsService } from '../services/visits.service';
import { CustomersService } from '../services/customers.service';
import { TdlService } from '../services/tdl.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('Visits')
@Controller('api/visits')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VisitsController {
    constructor(
        private visitsService: VisitsService,
        private customersService: CustomersService,
        private tdlService: TdlService
    ) { }

    @Post('create')
    @ApiOperation({ summary: 'Assign a new visit / external / self task' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'create' },
        { entity: 'visits_not_our', action: 'create' },
        { entity: 'tasks', action: 'create' }
    )
    async create(
        @Body() body: {
            customer_id?: number | null;
            user_name?: string;
            visit_type: 'Visit' | 'Call' | 'External' | 'Self';
            scheduled_date?: string;
            remark?: string;
        },
        @Request() req: any
    ) {
        const user = req.user;
        const isCustomerBound = body.visit_type === 'Visit' || body.visit_type === 'Call';

        if (isCustomerBound) {
            if (!body.customer_id) throw new ForbiddenException('customer_id is required for Visit/Call');
            if (user?.role?.toLowerCase() !== 'admin') {
                const customer = await this.customersService.findById(body.customer_id);
                const isOur = customer.status === 'Active';
                const permModule = isOur ? 'visits_our' : 'visits_not_our';
                if (!user.permissions?.[permModule]?.create) {
                    throw new ForbiddenException(`No permission to create visits for ${isOur ? 'Our Customers' : 'Not Our Customers'}`);
                }
            }
        } else if (user?.role?.toLowerCase() !== 'admin' && !user.permissions?.tasks?.create) {
            // External/Self both flow through `tasks.create` permission for non-admins.
            throw new ForbiddenException('No permission to create tasks');
        }

        // For Self: lock assignee to the creator's display name (matches the
        // task-page filter, which compares user_name/assigned_by against
        // user.name). For others: trust the form's choice.
        const assigneeName =
            body.visit_type === 'Self'
                ? (user.name || user.email)
                : (body.user_name || user.name || user.email);

        const data = await this.visitsService.create({
            customer_id: isCustomerBound ? body.customer_id : null,
            user_name: assigneeName,
            assigned_by: user.name || user.email,
            visit_type: body.visit_type,
            scheduled_date: body.scheduled_date,
            remark: body.remark
        });
        return { success: true, data };
    }

    @Get('pending')
    @ApiOperation({ summary: 'Get pending visits for logged-in user' })
    // Permits any of visits_our.view, visits_not_our.view, OR tasks.view so
    // task-recipients (e.g. someone assigned a Connect task without broader
    // visit perms) can still see their queue. The controller body further
    // filters the result by perms so users only see what they're entitled to.
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'view' },
        { entity: 'visits_not_our', action: 'view' },
        { entity: 'tasks', action: 'view' },
    )
    async getPending(@Query('user_name') userName?: string, @Request() req?: any) {
        const user = req?.user;
        const result = await this.visitsService.findAllPending(userName || '');
        
        // Filter by permissions
        if (user && user?.role?.toLowerCase() !== 'admin') {
            const canSeeOur = user.permissions?.visits_our?.view;
            const canSeeOthers = user.permissions?.visits_not_our?.view;
            const canSeeTasks = user.permissions?.tasks?.view;

            return result.filter(v => {
                // Always allow if assigned to user or created by user
                if ((v as any).user_name === user.name || (v as any).assigned_by === user.name) return true;

                // Task-only users: only see their own assigned tasks (handled above)
                if (!canSeeOur && !canSeeOthers && canSeeTasks) return false;

                // Default to Active if missing (safe fallback)
                const status = (v as any).customer_status || 'Active';
                const isOur = status === 'Active';
                if (isOur && !canSeeOur) return false;
                if (!isOur && !canSeeOthers) return false;
                return true;
            });
        }
        return result;
    }

    @Get('all')
    @ApiOperation({ summary: 'Get all visits with pagination and filters' })
    @RequireAnyPermission({ entity: 'visits_our', action: 'view' }, { entity: 'visits_not_our', action: 'view' }, { entity: 'tasks', action: 'view' })
    async getAll(
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20',
        @Query('status') status?: string,
        @Query('user_name') userName?: string,
        @Query('search') search?: string,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Request() req?: any
    ) {
        const user = req?.user;
        const filters: any = { status, user_name: userName, search, date_from: dateFrom, date_to: dateTo };
        
        if (user && user?.role?.toLowerCase() !== 'admin') {
            const canSeeOur = user.permissions?.visits_our?.view;
            const canSeeOthers = user.permissions?.visits_not_our?.view;
            const canSeeTasks = user.permissions?.tasks?.view;

            if (!canSeeOur && !canSeeOthers && !canSeeTasks) throw new ForbiddenException('No permission to view visits');

            // Pass permissions to service for internal filtering
            // Task-only users: filter to only their own assigned tasks
            filters.permission_check = { canSeeOur, canSeeOthers, canSeeTasks, userName: user.name };
        }

        // Convert query params to numbers
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;

        // For completed status, combine cloud_visits and TDL Connect tasks
        if (status === 'Completed') {
            const [visitsResult, tdlResult] = await Promise.all([
                this.visitsService.findAll(pageNum, limitNum, filters),
                this.tdlService.getCompletedConnectTasks(pageNum, limitNum, filters)
            ]);

            // Combine and sort by checkout time
            const combined = [...visitsResult.data, ...tdlResult.data].sort((a, b) => {
                const dateA = a.check_out_time ? new Date(a.check_out_time).getTime() : 0;
                const dateB = b.check_out_time ? new Date(b.check_out_time).getTime() : 0;
                return dateB - dateA;
            });

            return {
                success: true,
                data: combined.slice(0, limitNum),
                total: visitsResult.total + tdlResult.total,
                page: pageNum,
                limit: limitNum
            };
        }

        const result = await this.visitsService.findAll(pageNum, limitNum, filters);
        return { success: true, ...result };
    }

    @Post('pause')
    @ApiOperation({ summary: 'Pause a visit' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'pause' }, 
        { entity: 'visits_not_our', action: 'pause' },
        { entity: 'tasks', action: 'checkin' }
    )
    async pause(@Body() body: { id: number }, @Request() req: any) {
        return this.visitsService.updateStatus(body.id, 'Paused', req.user);
    }

    @Post('resume')
    @ApiOperation({ summary: 'Resume a visit' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'pause' }, 
        { entity: 'visits_not_our', action: 'pause' },
        { entity: 'tasks', action: 'checkin' }
    )
    async resume(@Body() body: { id: number }, @Request() req: any) {
        return this.visitsService.updateStatus(body.id, 'In Progress', req.user);
    }

    @Post('complete')
    @ApiOperation({ summary: 'Complete a visit' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'checkin' }, 
        { entity: 'visits_not_our', action: 'checkin' },
        { entity: 'tasks', action: 'checkin' }
    )
    async complete(@Body() body: { id: number; lat: string; lng: string; remark: string }, @Request() req: any) {
        return this.visitsService.complete(body.id, {
            lat: body.lat,
            lng: body.lng,
            remark: body.remark
        }, req.user);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a visit' })
    @RequireAnyPermission({ entity: 'visits_our', action: 'delete' }, { entity: 'visits_not_our', action: 'delete' })
    async delete(@Param('id') id: string, @Request() req: any) {
        const user = req.user;
        if (user?.role?.toLowerCase() !== 'admin') {
            // Check ownership and split permission
            // VisitsService.delete already checks ownership, we should add module check there or here
            // But we need the customer status to know which module to check
        }
        return this.visitsService.delete(parseInt(id), req.user);
    }

    @Post('update')
    @ApiOperation({ summary: 'Update a visit' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'edit' }, 
        { entity: 'visits_not_our', action: 'edit' },
        { entity: 'tasks', action: 'edit' },
        { entity: 'tasks', action: 'checkin' }
    )
    async update(@Body() body: any, @Request() req: any) {
        return this.visitsService.update(body, req.user);
    }

    @Post('force-checkin')
    @ApiOperation({ summary: 'Toggle force check-in for a visit' })
    @RequireAnyPermission({ entity: 'visits_our', action: 'force_checkin' }, { entity: 'visits_not_our', action: 'force_checkin' })
    async forceCheckin(@Body() body: { id: number; allowed: boolean }, @Request() req: any) {
        return this.visitsService.toggleForceCheckin(body.id, body.allowed, req.user);
    }

    @Post(':id/recording')
    @ApiOperation({ summary: 'Upload visit recording (webm/ogg audio)' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'checkin' },
        { entity: 'visits_not_our', action: 'checkin' },
        { entity: 'tasks', action: 'checkin' }
    )
    @UseInterceptors(FileInterceptor('recording', {
        storage: diskStorage({
            destination: join(process.cwd(), 'uploads', 'visit-recordings'),
            filename: (_req, file, cb) => {
                const ext = extname(file.originalname) || '.webm';
                cb(null, `visit-${Date.now()}${ext}`);
            },
        }),
        limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
        fileFilter: (_req, file, cb) => {
            if (file.mimetype.startsWith('audio/')) cb(null, true);
            else cb(new Error('Only audio files are allowed'), false);
        },
    }))
    async uploadRecording(
        @Param('id') id: string,
        @UploadedFile() file: Express.Multer.File,
        @Request() req: any,
    ) {
        if (!file) throw new NotFoundException('No audio file received');
        const relativePath = `visit-recordings/${file.filename}`;
        await this.visitsService.saveRecording(parseInt(id), relativePath);
        return { success: true, path: relativePath };
    }

    @Get(':id/recording')
    @ApiOperation({ summary: 'Stream visit recording audio' })
    @RequireAnyPermission(
        { entity: 'visits_our', action: 'view' },
        { entity: 'visits_not_our', action: 'view' },
        { entity: 'tasks', action: 'view' }
    )
    async getRecording(@Param('id') id: string, @Res() res: Response) {
        const relativePath = await this.visitsService.getRecordingPath(parseInt(id));
        if (!relativePath) throw new NotFoundException('No recording found for this visit');
        const fullPath = join(process.cwd(), 'uploads', relativePath);
        if (!existsSync(fullPath)) throw new NotFoundException('Recording file not found on disk');
        const ext = extname(fullPath).toLowerCase();
        const mimeMap: Record<string, string> = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4' };
        res.setHeader('Content-Type', mimeMap[ext] || 'audio/webm');
        res.setHeader('Content-Disposition', `inline; filename="visit-${id}${ext}"`);
        createReadStream(fullPath).pipe(res);
    }
}
