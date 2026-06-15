import { useState, useEffect, useCallback, useRef } from 'react';
import api, { getToken } from '../services/api';

const isCapacitor = !!(window as any).Capacitor;

interface AppNotification {
    id: number;
    title: string;
    body: string;
    url: string;
    is_read: number;
    created_at: string;
}

// ── Capacitor Local Notifications (system notification bar) ──
let LocalNotifications: any = null;
if (isCapacitor) {
    import('@capacitor/local-notifications').then(mod => {
        LocalNotifications = mod.LocalNotifications;
        // Create notification channel with custom sound (Android)
        LocalNotifications.createChannel?.({
            id: 'abs-service',
            name: 'Service Notifications',
            description: 'Service call and lead notifications',
            importance: 5, // MAX
            visibility: 1, // PUBLIC
            vibration: true,
            sound: 'notification.mp3',
        }).catch(() => {});
    }).catch(() => {});
}

async function showSystemNotification(notif: AppNotification) {
    if (isCapacitor && LocalNotifications) {
        try {
            const perms = await LocalNotifications.checkPermissions();
            if (perms.display !== 'granted') {
                await LocalNotifications.requestPermissions();
            }
            await LocalNotifications.schedule({
                notifications: [{
                    id: notif.id,
                    title: notif.title,
                    body: notif.body,
                    channelId: 'abs-service',
                    sound: 'notification.mp3',
                    extra: { url: notif.url },
                    smallIcon: 'ic_launcher',
                    largeIcon: 'ic_launcher',
                }],
            });
        } catch (e) {
            console.error('Local notification failed:', e);
        }
    } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notif.title, { body: notif.body, icon: '/logo.png' });
    }
}

// Web fallback sound (non-Capacitor)
const notifSound = !isCapacitor && typeof window !== 'undefined' ? new Audio('/notification.mp3') : null;
if (notifSound) notifSound.volume = 0.7;

// Unlock audio on first touch for web mobile
let audioUnlocked = false;
if (typeof window !== 'undefined' && notifSound) {
    const unlockAudio = () => {
        if (audioUnlocked) return;
        notifSound.play().then(() => {
            notifSound.pause();
            notifSound.currentTime = 0;
            audioUnlocked = true;
        }).catch(() => {});
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
}

// ── Capacitor: Listen for notification taps → navigate ──
if (isCapacitor) {
    import('@capacitor/local-notifications').then(mod => {
        mod.LocalNotifications.addListener('localNotificationActionPerformed', (action: any) => {
            const url = action.notification?.extra?.url;
            if (url && window.location.pathname !== url) {
                window.location.href = url;
            }
        });
    }).catch(() => {});
}

// ── Background polling for Capacitor ──
// Keep polling even when component unmounts (app backgrounded but process alive)
let bgInterval: any = null;
let bgFetchFn: (() => Promise<void>) | null = null;

function startBackgroundPolling(fetchFn: () => Promise<void>) {
    bgFetchFn = fetchFn;
    if (bgInterval) return; // already running
    bgInterval = setInterval(() => {
        // Stop polling once logged out — the server's 23:50 session wipe
        // would otherwise keep this firing 401s all night.
        if (!getToken()) {
            clearInterval(bgInterval);
            bgInterval = null;
            bgFetchFn = null;
            return;
        }
        if (bgFetchFn) bgFetchFn();
    }, 15000);
}

export function useNotifications(enabled: boolean = true) {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const prevCountRef = useRef(-1); // -1 = first fetch, skip sound
    const shownIdsRef = useRef<Set<number>>(new Set()); // track which notifications we've shown

    const fetchUnread = useCallback(async () => {
        if (!enabled) return;
        if (!getToken()) return;
        try {
            const data = await api.get('/notifications/unread') as any;
            if (data.success) {
                const notifs: AppNotification[] = data.notifications || [];
                setNotifications(notifs);
                const count = notifs.length;

                // Show system notification + play sound for NEW notifications
                if (count > 0 && prevCountRef.current >= 0) {
                    for (const n of notifs) {
                        if (!shownIdsRef.current.has(n.id)) {
                            shownIdsRef.current.add(n.id);
                            // Show in system notification bar
                            showSystemNotification(n);
                            // Play sound on web (Capacitor uses channel sound)
                            if (!isCapacitor && notifSound) {
                                notifSound.currentTime = 0;
                                notifSound.play().catch(() => {});
                            }
                        }
                    }
                } else if (prevCountRef.current < 0) {
                    // First fetch — just record IDs, don't alert
                    for (const n of notifs) {
                        shownIdsRef.current.add(n.id);
                    }
                }

                prevCountRef.current = count;
                setUnreadCount(count);
            }
        } catch {
            // Silently fail — polling shouldn't break the app
        }
    }, [enabled]);

    const markAllRead = useCallback(async () => {
        try {
            await api.post('/notifications/mark-read', {});
            setNotifications([]);
            setUnreadCount(0);
            prevCountRef.current = -1;
            shownIdsRef.current.clear();
        } catch { }
    }, []);

    const markRead = useCallback(async (ids: number[]) => {
        try {
            await api.post('/notifications/mark-read', { ids });
            setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
            setUnreadCount(prev => Math.max(0, prev - ids.length));
        } catch { }
    }, []);

    // Poll every 15 seconds
    useEffect(() => {
        if (!enabled) return;
        fetchUnread();
        const interval = setInterval(fetchUnread, 15000);

        // On Capacitor, also start background polling that survives unmount
        if (isCapacitor) {
            startBackgroundPolling(fetchUnread);
        }

        return () => clearInterval(interval);
    }, [enabled, fetchUnread]);

    return { notifications, unreadCount, markAllRead, markRead, refetch: fetchUnread };
}
