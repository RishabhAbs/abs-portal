import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ItemsService } from '../services/items.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequireAnyPermission } from '../decorators/permissions.decorator';

@ApiTags('Items')
@Controller('api/items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemsController {
    constructor(private itemsService: ItemsService) {}

    @Get('flavours')
    @ApiOperation({ summary: 'Get TallyFlavour options from singlemaster' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getFlavours() {
        const data = await this.itemsService.getFlavours();
        return { success: true, data };
    }

    @Get('groups')
    @ApiOperation({ summary: 'Get item groups' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getGroups() {
        return { success: true, data: await this.itemsService.getGroups() };
    }

    @Post('groups')
    @ApiOperation({ summary: 'Create item group' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async createGroup(@Body() body: { name: string; parent_id?: number | null }) {
        return { success: true, data: await this.itemsService.createGroup(body.name, body.parent_id) };
    }

    @Put('groups/:id')
    @ApiOperation({ summary: 'Update item group' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async updateGroup(@Param('id') id: string, @Body() body: { name: string; parent_id?: number | null }) {
        await this.itemsService.updateGroup(parseInt(id), body.name, body.parent_id);
        return { success: true };
    }

    @Delete('groups/:id')
    @ApiOperation({ summary: 'Delete item group' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async deleteGroup(@Param('id') id: string) {
        await this.itemsService.deleteGroup(parseInt(id));
        return { success: true };
    }

    @Get('categories')
    @ApiOperation({ summary: 'Get item categories' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getCategories() {
        return { success: true, data: await this.itemsService.getCategories() };
    }

    @Post('categories')
    @ApiOperation({ summary: 'Create item category' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async createCategory(@Body() body: { name: string; parent_id?: number | null; target_unit?: string }) {
        return { success: true, data: await this.itemsService.createCategory(body.name, body.parent_id, body.target_unit) };
    }

    @Put('categories/:id')
    @ApiOperation({ summary: 'Update item category' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async updateCategory(@Param('id') id: string, @Body() body: { name: string; parent_id?: number | null; target_unit?: string }) {
        await this.itemsService.updateCategory(parseInt(id), body.name, body.parent_id, body.target_unit);
        return { success: true };
    }

    @Delete('categories/:id')
    @ApiOperation({ summary: 'Delete item category' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async deleteCategory(@Param('id') id: string) {
        await this.itemsService.deleteCategory(parseInt(id));
        return { success: true };
    }

    @Get(':id/opening-batches')
    @ApiOperation({ summary: 'Get opening batches for an item' })
    @RequireAnyPermission({ entity: 'items', action: 'view' })
    async getOpeningBatches(@Param('id') id: string) {
        return { success: true, data: await this.itemsService.getOpeningBatches(parseInt(id, 10)) };
    }

    @Post(':id/opening-batches')
    @ApiOperation({ summary: 'Save opening batches for an item' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async saveOpeningBatches(@Param('id') id: string, @Body() body: { batches: any[] }) {
        await this.itemsService.saveOpeningBatches(parseInt(id, 10), body.batches || []);
        return { success: true };
    }

    @Get()
    @ApiOperation({ summary: 'Get all items' })
    @RequireAnyPermission(
        { entity: 'items',    action: 'view'   },
        { entity: 'vouchers', action: 'view'   },
        { entity: 'vouchers', action: 'create' },
    )
    async findAll() {
        const data = await this.itemsService.findAll();
        return { success: true, data };
    }

    @Post()
    @ApiOperation({ summary: 'Create item' })
    @RequireAnyPermission({ entity: 'items', action: 'create' })
    async create(@Body() body: any) {
        const item = await this.itemsService.create(body);
        return { success: true, data: item, message: 'Item created successfully' };
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update item' })
    @RequireAnyPermission({ entity: 'items', action: 'edit' })
    async update(@Param('id') id: string, @Body() body: any) {
        await this.itemsService.update(parseInt(id, 10), body);
        return { success: true, message: 'Item updated successfully' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete item' })
    @RequireAnyPermission({ entity: 'items', action: 'delete' })
    async remove(@Param('id') id: string) {
        await this.itemsService.delete(parseInt(id, 10));
        return { success: true, message: 'Item deleted successfully' };
    }
}
