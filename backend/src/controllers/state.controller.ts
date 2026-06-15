import { Controller, Get, UseGuards } from '@nestjs/common';
import { StateService } from '../services/state.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/states')
@UseGuards(JwtAuthGuard)
export class StateController {
    constructor(private stateService: StateService) { }

    @Get()
    async findAll() {
        const data = await this.stateService.findAll();
        return { success: true, data };
    }
}
