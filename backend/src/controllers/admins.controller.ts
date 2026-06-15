import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AdminsService } from '../services/admins.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';

// Legacy-admin lookup endpoint. Previously had no guard — any unauthenticated
// request could enumerate admin names/IDs. Gated to users with `users.view`.
@Controller('api/admins')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AdminsController {
    constructor(private readonly adminsService: AdminsService) { }

    @Get()
    @RequirePermission('users', 'view')
    findAll(@Query('search') search?: string) {
        return this.adminsService.findAll(search);
    }
}
