// Native Android notification service bridge
// Starts a foreground service that polls for notifications even when the app is backgrounded/killed.
// `window.Capacitor` is injected by @capacitor/core even in the browser build, so the
// correct native check is `isNativePlatform()` — otherwise registerPlugin proxies throw
// "plugin is not implemented on web" when any method is invoked.
const isNative = !!(window as any).Capacitor?.isNativePlatform?.();

async function getPlugin() {
    if (!isNative) return null;
    try {
        const { registerPlugin } = await import('@capacitor/core');
        return registerPlugin('NotificationBridge');
    } catch {
        return null;
    }
}

let plugin: any = null;
if (isNative) {
    getPlugin().then(p => { plugin = p; }).catch(() => {});
}

export async function startNotificationService(token: string) {
    if (!isNative || !plugin) return;
    try {
        const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
        await plugin.startService({ token, apiUrl });
        console.log('[NotifBridge] Foreground service started');
    } catch (e) {
        console.error('[NotifBridge] Failed to start service:', e);
    }
}

export async function stopNotificationService() {
    if (!isNative || !plugin) return;
    try {
        await plugin.stopService();
        console.log('[NotifBridge] Foreground service stopped');
    } catch (e) {
        console.error('[NotifBridge] Failed to stop service:', e);
    }
}

// Listen for notification taps from native side → navigate
if (typeof window !== 'undefined') {
    window.addEventListener('notificationNav', (e: any) => {
        const url = e.detail;
        if (url && window.location.pathname !== url) {
            window.location.href = url;
        }
    });
}
