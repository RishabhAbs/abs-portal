// Request all required permissions on Capacitor app startup
export async function requestAppPermissions() {
    const isCapacitor = !!(window as any).Capacitor;
    if (!isCapacitor) return;

    // Request notification permission (Android 13+)
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }

    // Request location permission via Geolocation API
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            () => {}, // Success - permission granted
            () => {}, // Error - permission denied (user choice)
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }
}
