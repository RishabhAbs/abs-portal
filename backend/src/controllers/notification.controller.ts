import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { NotificationService } from '../services/notification.service';

@Controller('api/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    constructor(private notificationService: NotificationService) {}

    // Get VAPID public key (needed by frontend to subscribe)
    @Get('vapid-key')
    getVapidKey() {
        return { publicKey: this.notificationService.getVapidPublicKey() };
    }

    // Subscribe to push notifications
    @Post('subscribe')
    async subscribe(@Body() body: { subscription: any }, @Req() req: any) {
        const user = req.user;
        await this.notificationService.subscribe(
            user.id,
            user.name || user.email,
            body.subscription
        );
        return { success: true, message: 'Subscribed to push notifications' };
    }

    // Unsubscribe
    @Post('unsubscribe')
    async unsubscribe(@Body() body: { endpoint: string }) {
        await this.notificationService.unsubscribe(body.endpoint);
        return { success: true, message: 'Unsubscribed from push notifications' };
    }

    // Get unread in-app notifications (for polling)
    @Get('unread')
    async getUnread(@Req() req: any) {
        const user = req.user;
        const notifications = await this.notificationService.getUnread(user.name || user.email);
        return { success: true, notifications };
    }

    // Mark notifications as read
    @Post('mark-read')
    async markRead(@Body() body: { ids?: number[] }, @Req() req: any) {
        const user = req.user;
        await this.notificationService.markRead(user.name || user.email, body.ids);
        return { success: true };
    }

    // Test notification
    @Post('test')
    async testNotification(@Req() req: any) {
        const user = req.user;
        const result = await this.notificationService.sendToUser(
            user.name || user.email,
            {
                title: 'Test Notification',
                body: 'Push notifications are working!',
                url: '/service/pending',
            }
        );
        return { success: true, ...result };
    }
}
