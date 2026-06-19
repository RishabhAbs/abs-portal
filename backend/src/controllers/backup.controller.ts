import { Controller, Post, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BackupService } from '../services/backup.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/backup')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  // Manual trigger — admin only. Runs the same dump+zip+email flow as the
  // nightly 9 PM IST cron, useful for testing the SMTP setup on demand.
  @Post('run-now')
  async runNow(@Req() req: any) {
    if (req.user?.role?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Only admins can trigger a manual backup');
    }
    const result = await this.backupService.runBackup();
    return { success: true, ...result };
  }
}
