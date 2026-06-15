import api from './api';

// Check if push notifications are supported
export function isPushSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Get current permission status
export function getPermissionStatus(): NotificationPermission {
    return Notification.permission;
}

// Request notification permission and subscribe
export async function subscribeToPush(): Promise<boolean> {
    if (!isPushSupported()) {
        console.warn('[Push] Not supported in this browser');
        return false;
    }

    try {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('[Push] Permission denied');
            return false;
        }

        // Get VAPID public key from backend
        const vapidData = await api.get('/notifications/vapid-key') as any;
        if (!vapidData.publicKey) {
            console.error('[Push] No VAPID public key from server');
            return false;
        }

        // Register service worker if not already
        const registration = await navigator.serviceWorker.ready;

        // Check for existing subscription
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            // Create new subscription
            const applicationServerKey = urlBase64ToUint8Array(vapidData.publicKey);
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey,
            });
        }

        // Send subscription to backend
        await api.post('/notifications/subscribe', {
            subscription: subscription.toJSON(),
        });

        console.log('[Push] Subscribed successfully');
        return true;
    } catch (error) {
        console.error('[Push] Subscribe error:', error);
        return false;
    }
}

// Unsubscribe from push
export async function unsubscribeFromPush(): Promise<boolean> {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            // Send endpoint via POST since our api.delete doesn't support body
            await api.post('/notifications/unsubscribe', { endpoint: subscription.endpoint });
            await subscription.unsubscribe();
        }

        return true;
    } catch (error) {
        console.error('[Push] Unsubscribe error:', error);
        return false;
    }
}

// Test notification
export async function sendTestNotification(): Promise<boolean> {
    try {
        await api.post('/notifications/test', {});
        return true;
    } catch (error) {
        console.error('[Push] Test notification error:', error);
        return false;
    }
}

// Helper: Convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
