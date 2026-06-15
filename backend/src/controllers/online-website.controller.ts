import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServiceCallsService } from '../services/servicecalls.service';

// Maps website service labels → internal service types
function mapServiceType(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('cloud'))                              return 'Cloud';
  if (s.includes('tdl') || s.includes('customiz') || s.includes('integration')) return 'TDL';
  if (s.includes('web') || s.includes('app'))           return 'Web/App';
  // TallyPrime, AMC, TSS, anything else Tally-related
  return 'Tally';
}

// Public endpoints — no JWT guard — called by the ABS Technologies website
@ApiTags('Website (Public)')
@Controller('api')
export class OnlineWebsiteController {
  constructor(private readonly serviceCalls: ServiceCallsService) {}

  // POST /api/online-lead-create  (Contact form on website)
  @Post('online-lead-create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create lead from website contact form (public)' })
  async createOnlineLead(
    @Body() body: {
      company_name: string;
      name: string;
      email: string;
      phone: string;
      service: string;
      team_size?: string;
      requirements?: string;
    },
  ) {
    const { company_name, name, email, phone, service, team_size, requirements } = body;

    if (!phone) throw new BadRequestException('phone is required');
    if (!name)  throw new BadRequestException('name is required');
    if (!service) throw new BadRequestException('service is required');
    if (!company_name) throw new BadRequestException('company_name is required');

    // company_name and email are stored in their own columns — remark only holds what isn't captured elsewhere
    const remark = [
      team_size ? `Team size: ${team_size}` : null,
      requirements || null,
    ].filter(Boolean).join('\n');

    const mappedType = mapServiceType(service);

    await this.serviceCalls.create(
      phone,
      {
        contact_person: name,
        service_type: mappedType,
        remark: remark || null,
        entry_type: 'Lead',
        lead_type: mappedType,
        source: 'website',
        company_name,
        email,
      } as any,
      'website',
    );

    return { success: true, message: 'Lead created successfully' };
  }

  // POST /api/online-service-create/  (Navbar popup on website)
  @Post('online-service-create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create service request from website navbar popup (public)' })
  async createOnlineService(
    @Body() body: {
      service_type: string;
      contact_number: string;
      remark?: string;
    },
  ) {
    const { service_type, contact_number, remark } = body;

    if (!contact_number) throw new BadRequestException('contact_number is required');
    if (!service_type)   throw new BadRequestException('service_type is required');

    await this.serviceCalls.create(
      contact_number,
      {
        service_type: mapServiceType(service_type),
        remark: remark || null,
        entry_type: 'Service',
        source: 'website',
      } as any,
      'website',
    );

    return { success: true, message: 'Service request created successfully' };
  }
}
