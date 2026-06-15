import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../database/db.service';
import * as webpush from 'web-push';

@Injectable()
export class NotificationService implements OnModuleInit {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private db: DbService,
        private config: ConfigService,
    ) {}

    async onModuleInit() {
        // Configure web-push with VAPID keys
        const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
        const subject = this.config.get<string>('VAPID_SUBJECT', 'mailto:admin@abstechnologies.in');

        if (publicKey && privateKey) {
            webpush.setVapidDetails(subject, publicKey, privateKey);
            this.logger.log('Web Push VAPID configured successfully');
        } else {
            this.logger.warn('VAPID keys not found in env. Push notifications disabled.');
        }

        // Create push_subscriptions table
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(20) NOT NULL,
                user_name VARCHAR(255),
                endpoint TEXT NOT NULL,
                p256dh VARCHAR(255) NOT NULL,
                auth VARCHAR(255) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_endpoint (endpoint(500))
            )
        `);
        // Fix user_id type if table was created with INT instead of VARCHAR
        await this.db.execute(`ALTER TABLE push_subscriptions MODIFY COLUMN user_id VARCHAR(20) NOT NULL`).catch(() => {});
        this.logger.log('push_subscriptions table ready');

        // In-app notifications table (polling-based, works on Capacitor + browser)
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS user_notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_name VARCHAR(255),
                title VARCHAR(255) NOT NULL,
                body TEXT,
                url VARCHAR(255) DEFAULT '/service/pending',
                is_read TINYINT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_read (user_name, is_read)
            )
        `);
        this.logger.log('user_notifications table ready');
    }

    // Save a push subscription for a user
    async subscribe(userId: string, userName: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
        // Upsert — if endpoint already exists, update user
        await this.db.execute(`
            INSERT INTO push_subscriptions (user_id, user_name, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), user_name = VALUES(user_name), p256dh = VALUES(p256dh), auth = VALUES(auth)
        `, [userId, userName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);

        return { success: true };
    }

    // Remove a subscription
    async unsubscribe(endpoint: string) {
        await this.db.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
        return { success: true };
    }

    // Store in-app notification for a specific user
    private async storeNotification(userName: string, payload: { title: string; body: string; url?: string }) {
        await this.db.execute(
            'INSERT INTO user_notifications (user_name, title, body, url) VALUES (?, ?, ?, ?)',
            [userName, payload.title, payload.body, payload.url || '/service/pending']
        );
    }

    // Store in-app notification for all active users
    private async storeNotificationForAll(payload: { title: string; body: string; url?: string }) {
        const users = await this.db.query<any>("SELECT name FROM cloud_users WHERE status = 'Active'");
        for (const u of users) {
            await this.db.execute(
                'INSERT INTO user_notifications (user_name, title, body, url) VALUES (?, ?, ?, ?)',
                [u.name, payload.title, payload.body, payload.url || '/service/pending']
            );
        }
    }

    // Get unread notifications for a user
    async getUnread(userName: string) {
        return this.db.query<any>(
            'SELECT * FROM user_notifications WHERE user_name = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 20',
            [userName]
        );
    }

    // Mark notifications as read
    async markRead(userName: string, ids?: number[]) {
        if (ids && ids.length) {
            await this.db.execute(
                `UPDATE user_notifications SET is_read = 1 WHERE user_name = ? AND id IN (${ids.map(() => '?').join(',')})`,
                [userName, ...ids]
            );
        } else {
            await this.db.execute(
                'UPDATE user_notifications SET is_read = 1 WHERE user_name = ?',
                [userName]
            );
        }
        return { success: true };
    }

    // Send notification to a specific user (by name, since taken_by stores name)
    async sendToUser(userName: string, payload: { title: string; body: string; url?: string; tag?: string }) {
        // Always store in-app notification
        this.storeNotification(userName, payload).catch(e => this.logger.error('Store notification failed: ' + e.message));

        // Also try web push
        const subs = await this.db.query<any>(
            'SELECT * FROM push_subscriptions WHERE user_name = ?',
            [userName]
        );

        if (!subs.length) return { sent: 0 };
        return this.sendToSubscriptions(subs, payload);
    }

    // Send notification to all users who have a specific permission
    async sendToUsersWithPermission(permissionEntity: string, payload: { title: string; body: string; url?: string; tag?: string }) {
        // Store in-app for all
        this.storeNotificationForAll(payload).catch(e => this.logger.error('Store broadcast notification failed: ' + e.message));

        const subs = await this.db.query<any>(`
            SELECT ps.* FROM push_subscriptions ps
            JOIN cloud_users cu ON ps.user_id = cu.id
            WHERE cu.status = 'Active'
        `);

        if (!subs.length) return { sent: 0 };
        return this.sendToSubscriptions(subs, payload);
    }

    // Send to all active subscriptions (broadcast)
    async sendToAll(payload: { title: string; body: string; url?: string; tag?: string }) {
        // Store in-app for all
        this.storeNotificationForAll(payload).catch(e => this.logger.error('Store broadcast notification failed: ' + e.message));

        const subs = await this.db.query<any>('SELECT * FROM push_subscriptions');
        if (!subs.length) return { sent: 0 };
        return this.sendToSubscriptions(subs, payload);
    }

    // Core: send to a list of subscriptions
    private async sendToSubscriptions(subs: any[], payload: { title: string; body: string; url?: string; tag?: string }) {
        let sent = 0;
        let failed = 0;
        const staleIds: number[] = [];

        for (const sub of subs) {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
            };

            try {
                await webpush.sendNotification(pushSubscription, JSON.stringify({
                    title: payload.title,
                    body: payload.body,
                    url: payload.url || '/service/pending',
                    tag: payload.tag || 'service-call',
                }));
                sent++;
            } catch (err: any) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    // Subscription expired or invalid — mark for cleanup
                    staleIds.push(sub.id);
                }
                failed++;
                this.logger.error(`Push failed for sub ${sub.id}: ${err.message}`);
            }
        }

        // Cleanup stale subscriptions
        if (staleIds.length) {
            await this.db.execute(
                `DELETE FROM push_subscriptions WHERE id IN (${staleIds.map(() => '?').join(',')})`,
                staleIds
            );
            this.logger.log(`Cleaned up ${staleIds.length} stale subscriptions`);
        }

        this.logger.log(`Push sent: ${sent}, failed: ${failed}`);
        return { sent, failed };
    }

    getVapidPublicKey(): string {
        return this.config.get<string>('VAPID_PUBLIC_KEY', '');
    }
}
