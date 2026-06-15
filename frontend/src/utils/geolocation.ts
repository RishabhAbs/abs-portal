export interface PreciseLocation {
    lat: number;
    lng: number;
    accuracy: number; // metres — radius of 68% confidence circle
}

interface Options {
    // Resolve as soon as a sample with accuracy ≤ this (metres) arrives.
    desiredAccuracy?: number;
    // Hard cap (ms); returns the best sample seen so far even if desiredAccuracy never met.
    maxWait?: number;
}

/**
 * High-accuracy geolocation via watchPosition. GPS warms up over a few seconds
 * — early samples are often ±100m from Wi-Fi, later ones ±5–20m from satellites.
 * Returns the best sample seen within `maxWait`, short-circuiting once a good
 * enough reading arrives.
 */
export function getPreciseLocation(options: Options = {}): Promise<PreciseLocation> {
    const desiredAccuracy = options.desiredAccuracy ?? 30;
    const maxWait = options.maxWait ?? 12000;

    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser'));
            return;
        }

        let best: PreciseLocation | null = null;
        let watchId: number | null = null;
        let done = false;

        const finish = (err?: any) => {
            if (done) return;
            done = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            clearTimeout(hardTimer);
            if (err && !best) reject(err);
            else if (best) resolve(best);
            else reject(new Error('Unable to determine location'));
        };

        const hardTimer = setTimeout(() => finish(), maxWait);

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const sample: PreciseLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                };
                if (!best || sample.accuracy < best.accuracy) best = sample;
                if (best.accuracy <= desiredAccuracy) finish();
            },
            (err) => finish(err),
            { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait }
        );
    });
}
