import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PincodeService } from '../services/pincode.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../decorators/permissions.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Pincodes')
@Controller('api/pincodes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PincodeController {
    constructor(private readonly pincodeService: PincodeService) { }

    @Get()
    @ApiOperation({ summary: 'Get all pincodes' })
    @RequirePermission('pincodes', 'view')
    async getAll(@Query('page') page: number = 1, @Query('limit') limit: number = 50, @Query('search') search: string = '') {
        const result = await this.pincodeService.findAll(page, limit, search);
        return { success: true, ...result };
    }

    @Get('lookup/:code')
    @ApiOperation({ summary: 'Lookup pincode' })
    // Lookup might be public or require view? Let's say view. 
    // If it's used for auto-filling forms for users who might not have "pincodes.view" permission?
    // UserPermissions has 'pincodes'. 
    // If a normal user creates a customer and types a pincode, do they need 'pincodes.view'?
    // defaultUserPermissions for 'pincodes' is view: false.
    // If I protect this, normal users might fail to auto-fill city/state.
    // I should probably Allow this one for all authenticated users?
    // Or check if user can create customers?
    // For now, I'll leave it protected by JwtAuthGuard ONLY (no decorator).
    async lookup(@Param('code') code: string) {
        const data = await this.pincodeService.findByPincode(code);
        if (!data) {
            return { city: '', state: '' };
        }
        return data;
    }

    @Post()
    @ApiOperation({ summary: 'Create pincode' })
    @RequirePermission('pincodes', 'create')
    async create(@Body() data: any) {
        const payload = {
            pincode: data.pincode,
            city: data.city,
            stateid: data.stateid ? Number(data.stateid) : undefined
        };
        return this.pincodeService.create(payload);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update pincode' })
    @RequirePermission('pincodes', 'edit')
    async update(@Param('id') id: string, @Body() data: any) {
        const payload = {
            pincode: data.pincode,
            city: data.city,
            stateid: data.stateid ? Number(data.stateid) : undefined
        };
        return this.pincodeService.update(Number(id), payload);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete pincode' })
    @RequirePermission('pincodes', 'delete')
    async delete(@Param('id') id: string) {
        await this.pincodeService.delete(Number(id));
        return { success: true };
    }
}
