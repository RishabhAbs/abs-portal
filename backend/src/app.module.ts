import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ScheduleModule } from '@nestjs/schedule';

// Database
import { DbModule } from './database/db.module';

// Services
import { UsersService, ServersService, CustomersService, MappingsService, ActivitiesService, DashboardService, AuthService, TdlService, PincodeService, StateService, VisitsService } from './services';
import { AdminsService } from './services/admins.service';
import { AuditService } from './services/audit.service';
import { TallyService } from './services/tally.service';
import { TdlController } from './controllers/tdl.controller';
import { VisitsController } from './controllers/visits.controller';

// Controllers
import { AuthController, UsersController, ServersController, CustomersController, MappingsController, ActivitiesController, DashboardController, PincodeController, StateController } from './controllers';
import { AdminsController } from './controllers/admins.controller';
import { DebugController } from './controllers/debug.controller';
import { AttendanceController } from './controllers/attendance.controller'; // Added
import { AttendanceService } from './services/attendance.service'; // Added
import { ServiceCallsController } from './controllers/servicecalls.controller';
import { ServiceCallsService } from './services/servicecalls.service';
import { TallyController } from './controllers/tally.controller';
import { TallySyncController } from './controllers/tally-sync.controller';
import { CallsController } from './controllers/calls.controller';
import { CallsService } from './services/calls.service';
import { BillingController } from './controllers/billing.controller';
import { BillingService } from './services/billing.service';
import { NotificationController } from './controllers/notification.controller';
import { NotificationService } from './services/notification.service';
import { LeadRequirementsController } from './controllers/lead-requirements.controller';
import { LeadRequirementsService } from './services/lead-requirements.service';
import { GroupChangeController } from './controllers/group-change.controller';
import { GroupChangeService } from './services/group-change.service';
import { VouchersController } from './controllers/vouchers.controller';
import { VouchersService } from './services/vouchers.service';
import { ItemsController } from './controllers/items.controller';
import { ItemsService } from './services/items.service';
import { LedgerGroupController } from './controllers/ledger-group.controller';
import { LedgerGroupService } from './services/ledger-group.service';
import { OtherLedgerController } from './controllers/other-ledger.controller';
import { OtherLedgerService } from './services/other-ledger.service';
import { VchTypeController } from './controllers/vchtype.controller';
import { VchTypeService } from './services/vchtype.service';
import { TargetsController } from './controllers/targets.controller';
import { TargetsService } from './services/targets.service';
import { ResellerController } from './controllers/reseller.controller';
import { ResellerService } from './services/reseller.service';
import { TdlExpiryController } from './controllers/tdl-expiry.controller';
import { TdlExpiryService } from './services/tdl-expiry.service';
import { TdlBillingController } from './controllers/tdl-billing.controller';
import { TdlBillingService } from './services/tdl-billing.service';
import { ServerMonitorController } from './controllers/server-monitor.controller';
import { ServerMonitorService } from './services/server-monitor.service';
import { OnlineWebsiteController } from './controllers/online-website.controller';

// Guards
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Only serve uploads - Apache handles frontend in split deployment mode
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '24h') },
      }),
    }),
    ScheduleModule.forRoot(),
    DbModule,
  ],
  controllers: [
    AuthController,
    UsersController,
    ServersController,
    CustomersController,
    MappingsController,
    ActivitiesController,
    DashboardController,
    TdlController,
    PincodeController,
    StateController,
    VisitsController,
    AdminsController,
    DebugController,
    // SpaFallbackController removed - Apache handles SPA routing
    AttendanceController,
    ServiceCallsController,
    TallyController,
    TallySyncController,
    CallsController,
    BillingController,
    NotificationController,
    LeadRequirementsController,
    GroupChangeController,
    VouchersController,
    ItemsController,
    LedgerGroupController,
    OtherLedgerController,
    VchTypeController,
    TargetsController,
    ResellerController,
    TdlExpiryController,
    TdlBillingController,
    ServerMonitorController,
    OnlineWebsiteController,
  ],
  providers: [
    UsersService,
    ServersService,
    CustomersService,
    MappingsService,
    ActivitiesService,
    DashboardService,
    AuthService,
    TdlService,
    PincodeService,
    StateService,
    VisitsService,
    AdminsService,
    AuditService,
    JwtAuthGuard,
    AttendanceService,
    ServiceCallsService,
    TallyService,
    CallsService,
    BillingService,
    NotificationService,
    LeadRequirementsService,
    GroupChangeService,
    VouchersService,
    ItemsService,
    LedgerGroupService,
    OtherLedgerService,
    VchTypeService,
    TargetsService,
    ResellerService,
    TdlExpiryService,
    TdlBillingService,
    ServerMonitorService,
  ],
})
export class AppModule { }
