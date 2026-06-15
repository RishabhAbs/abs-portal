import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { usersApi } from '../services/api';
import { MapPin, RefreshCw, X, Navigation, Route, Timer, Activity, Calendar, Info } from 'lucide-react';
import { useToast } from '../components/Toast/Toast';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── Tile providers (all free, no API key) ──
const TILE_PROVIDERS = {
    voyager: {
        name: 'Voyager',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        dark: false,
    },
    positron: {
        name: 'Light',
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        dark: false,
    },
    dark: {
        name: 'Dark',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        dark: true,
    },
    osm: {
        name: 'Street',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        dark: false,
    },
} as const;
type TileStyle = keyof typeof TILE_PROVIDERS;

// ── Haversine distance (meters) ──
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const toRad = (v: number) => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Snap GPS trace to actual road network via OSRM ──
const snapRouteToRoads = async (
    points: [number, number][],
    timestamps: number[]
): Promise<[number, number][] | null> => {
    if (points.length < 2) return null;

    // Subsample to max 100 points for OSRM public API limit
    const MAX = 100;
    const sampled: [number, number][] =
        points.length > MAX
            ? Array.from({ length: MAX }, (_, i) => points[Math.round((i / (MAX - 1)) * (points.length - 1))])
            : points;
    const sampledTs: number[] =
        timestamps.length > MAX
            ? Array.from({ length: MAX }, (_, i) => timestamps[Math.round((i / (MAX - 1)) * (timestamps.length - 1))])
            : [...timestamps];

    // Ensure monotonically increasing timestamps (OSRM requirement)
    for (let i = 1; i < sampledTs.length; i++) {
        if (sampledTs[i] <= sampledTs[i - 1]) sampledTs[i] = sampledTs[i - 1] + 1;
    }

    const coordStr = sampled.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const tsStr = sampledTs.join(';');
    const radStr = sampled.map(() => '50').join(';');

    const url =
        `https://router.project-osrm.org/match/v1/driving/${coordStr}` +
        `?overview=full&geometries=geojson&timestamps=${tsStr}&radiuses=${radStr}&gaps=split`;

    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(tid);

        if (!res.ok) return null;
        const data = await res.json();
        if (data.code !== 'Ok' || !data.matchings?.length) return null;

        const routeCoords: [number, number][] = [];
        for (const m of data.matchings) {
            const coords = m.geometry.coordinates.map(
                ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
            );
            routeCoords.push(...coords);
        }
        return routeCoords.length >= 2 ? routeCoords : null;
    } catch {
        return null;
    }
};

// ── Marker icons ──
const createMarkerIcon = (type: 'start' | 'end' | 'active') => {
    let html = '';
    if (type === 'start') {
        html = `
            <div class="marker-container start">
                <div class="marker-core"></div>
                <div class="marker-ring"></div>
                <div class="marker-label label-bottom">START</div>
            </div>`;
    } else if (type === 'end') {
        html = `
            <div class="marker-container end">
                <svg viewBox="0 0 24 24" class="marker-pin">
                    <path fill="#ef4444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                <div class="marker-label label-top">END</div>
            </div>`;
    } else {
        html = `
            <div class="marker-active-beacon">
                <div class="beacon-core"></div>
                <div class="beacon-wave"></div>
                <div class="beacon-wave-outer"></div>
            </div>`;
    }
    return L.divIcon({ html, className: 'premium-marker', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20] });
};

const startIcon = createMarkerIcon('start');
const endIcon = createMarkerIcon('end');
const activeIcon = createMarkerIcon('active');

// ── Auto-fit bounds to all GPS points (zoom up to 18) ──
const FitBounds: React.FC<{ points: [number, number][] }> = ({ points }) => {
    const map = useMap();
    useEffect(() => {
        if (points.length === 0) return;
        if (points.length === 1) {
            map.setView(points[0], 18);
        } else {
            const bounds = L.latLngBounds(points.map(p => L.latLng(p[0], p[1])));
            map.fitBounds(bounds, { padding: [100, 100], maxZoom: 18 });
        }
    }, [points, map]);
    return null;
};

// ── Fly camera to a selected point ──
const FlyToPoint: React.FC<{ point: [number, number] | null }> = ({ point }) => {
    const map = useMap();
    useEffect(() => {
        if (point) map.flyTo(point, 18, { duration: 1, easeLinearity: 0.25 });
    }, [point, map]);
    return null;
};

// ────────────────────────────────────────────────────────────────────────────
const Network: React.FC = () => {
    const { isAdmin } = useAuth();
    const { showError } = useToast();

    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [historyDate, setHistoryDate] = useState(new Date().toISOString().split('T')[0]);
    const [historyData, setHistoryData] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const [snapLoading, setSnapLoading] = useState(false);
    const [routePath, setRoutePath] = useState<[number, number][]>([]);

    const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
    const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [mapStyle, setMapStyle] = useState<TileStyle>('voyager');

    // ── Fetch all network users ──
    const fetchNetwork = async () => {
        setLoading(true);
        try {
            const res = await usersApi.getNetwork();
            if (res.success) setUsers(res.data);
        } catch (err: any) {
            showError('Error', err.message || 'Failed to load network data');
        } finally {
            setLoading(false);
        }
    };

    // ── Fetch GPS history + snap to roads ──
    const fetchHistory = async (userId: string, date: string) => {
        setLoadingHistory(true);
        setActivePointIndex(null);
        setFlyTarget(null);
        setRoutePath([]);
        setSnapLoading(false);
        try {
            const res = await usersApi.getLocationHistory(userId, date);
            if (res.success) {
                const raw = res.data;

                // Speed-outlier filter: remove GPS jumps > 120 km/h (bad satellite fix)
                const cleaned: any[] = [];
                if (raw.length > 0) {
                    cleaned.push(raw[0]);
                    for (let i = 1; i < raw.length; i++) {
                        const dist = haversineDistance(
                            Number(raw[i - 1].latitude), Number(raw[i - 1].longitude),
                            Number(raw[i].latitude), Number(raw[i].longitude)
                        );
                        const tHours = (new Date(raw[i].recorded_at).getTime() - new Date(raw[i - 1].recorded_at).getTime()) / 3_600_000;
                        const speed = tHours > 0 ? (dist / 1000) / tHours : 0;
                        if (speed < 120 || i < 2) cleaned.push(raw[i]);
                    }
                }

                setHistoryData(cleaned);
                setLoadingHistory(false);

                // Snap route to actual roads via OSRM
                if (cleaned.length >= 2) {
                    setSnapLoading(true);
                    const pts: [number, number][] = cleaned.map(p => [Number(p.latitude), Number(p.longitude)]);
                    const ts = cleaned.map(p => Math.floor(new Date(p.recorded_at).getTime() / 1000));
                    const snapped = await snapRouteToRoads(pts, ts);
                    if (snapped) setRoutePath(snapped);
                    setSnapLoading(false);
                }
                return;
            }
        } catch (err: any) {
            showError('Error', err.message || 'Failed to load history');
            setSnapLoading(false);
        }
        setLoadingHistory(false);
    };

    const openHistory = (user: any) => {
        setSelectedUser(user);
        const today = new Date().toISOString().split('T')[0];
        setHistoryDate(today);
        setHistoryModalOpen(true);
        fetchHistory(user.id, today);
    };

    const closeHistory = () => {
        setHistoryModalOpen(false);
        setSelectedUser(null);
        setHistoryData([]);
        setRoutePath([]);
        setActivePointIndex(null);
        setFlyTarget(null);
        setTimelineOpen(false);
        setSnapLoading(false);
    };

    // Re-fetch when date changes while modal is open
    useEffect(() => {
        if (historyModalOpen && selectedUser) fetchHistory(selectedUser.id, historyDate);
    }, [historyDate]);

    // Auto-refresh network list every minute
    useEffect(() => {
        fetchNetwork();
        const iv = setInterval(fetchNetwork, 60_000);
        return () => clearInterval(iv);
    }, []);

    const openGoogleMap = (lat: number, lng: number) =>
        window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');

    const formatDate = (ds: string) => (ds ? new Date(ds).toLocaleString() : 'Unknown');

    const getTimeAgo = (ds: string) => {
        if (!ds) return '—';
        const mins = Math.floor((Date.now() - new Date(ds).getTime()) / 60_000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    // ── Sorted GPS data ──
    const sortedData = useMemo(
        () => [...historyData].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()),
        [historyData]
    );

    // ── Raw GPS coordinates (for markers + FitBounds) ──
    const mapPoints: [number, number][] = useMemo(
        () => sortedData.map(p => [Number(p.latitude), Number(p.longitude)] as [number, number]),
        [sortedData]
    );

    // ── Deduplicated points for circle markers (collapse stationary pings) ──
    const dedupPoints: [number, number][] = useMemo(() => {
        if (mapPoints.length === 0) return [];
        const result: [number, number][] = [mapPoints[0]];
        for (let i = 1; i < mapPoints.length; i++) {
            const last = result[result.length - 1];
            const d = haversineDistance(last[0], last[1], mapPoints[i][0], mapPoints[i][1]);
            if (d >= 20) result.push(mapPoints[i]); // minimum 20m between visible dots
        }
        return result;
    }, [mapPoints]);

    // ── Trip statistics ──
    const stats = useMemo(() => {
        if (sortedData.length < 2) return { distance: 0, duration: '—', points: sortedData.length };
        let totalDist = 0;
        for (let i = 1; i < sortedData.length; i++) {
            totalDist += haversineDistance(
                Number(sortedData[i - 1].latitude), Number(sortedData[i - 1].longitude),
                Number(sortedData[i].latitude), Number(sortedData[i].longitude)
            );
        }
        const totalMins = Math.floor(
            (new Date(sortedData[sortedData.length - 1].recorded_at).getTime() -
                new Date(sortedData[0].recorded_at).getTime()) / 60_000
        );
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return { distance: totalDist, duration: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`, points: sortedData.length };
    }, [sortedData]);

    const handleTimelineClick = (index: number) => {
        setActivePointIndex(index);
        setFlyTarget(mapPoints[index]);
        document.getElementById(`timeline-entry-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    if (!isAdmin()) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50">
                <div className="text-center">
                    <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <X className="h-8 w-8 text-red-300" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-800 mb-1">Access Restricted</h2>
                    <p className="text-sm text-slate-400">Admin privileges required</p>
                </div>
            </div>
        );
    }

    // Use road-snapped route if available; fall back to raw GPS polyline
    const polylinePath = routePath.length >= 2 ? routePath : mapPoints;

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen bg-slate-50">
            {/* ── Inline CSS ── */}
            <style>{`
                .glass-panel {
                    background: rgba(255, 255, 255, 0.75);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
                }

                /* ── Markers ── */
                .marker-container { display:flex; flex-direction:column; align-items:center; position:relative; }
                .marker-core { width:14px; height:14px; background:#22c55e; border:3px solid white; border-radius:50%; box-shadow:0 0 10px rgba(34,197,94,0.6); z-index:2; }
                .marker-ring { position:absolute; width:30px; height:30px; background:rgba(34,197,94,0.2); border:1px solid rgba(34,197,94,0.5); border-radius:50%; animation:pulse-ring 2s infinite; z-index:1; }
                .marker-label { position:absolute; white-space:nowrap; padding:2px 7px; background:rgba(15,23,42,0.9); color:white; border-radius:5px; font-size:9px; font-weight:800; letter-spacing:0.6px; box-shadow:0 2px 8px rgba(0,0,0,0.35); z-index:10; }
                .label-bottom { top:100%; left:50%; transform:translate(-50%,8px); }
                .label-top { bottom:100%; left:50%; transform:translate(-50%,-12px); }
                .marker-pin { width:30px; height:30px; filter:drop-shadow(0 3px 5px rgba(0,0,0,0.3)); }

                .marker-active-beacon { position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center; }
                .beacon-core { width:14px; height:14px; background:#4f46e5; border:3px solid white; border-radius:50%; box-shadow:0 0 12px rgba(79,70,229,0.8); z-index:3; }
                .beacon-wave, .beacon-wave-outer { position:absolute; width:100%; height:100%; border:2px solid #4f46e5; border-radius:50%; opacity:0; z-index:1; }
                .beacon-wave { animation:beacon-ripple 1.5s infinite ease-out; }
                .beacon-wave-outer { animation:beacon-ripple 1.5s infinite ease-out 0.75s; }

                @keyframes pulse-ring { 0%{transform:scale(0.6);opacity:1} 100%{transform:scale(1.5);opacity:0} }
                @keyframes beacon-ripple { 0%{transform:scale(0.3);opacity:0.9} 100%{transform:scale(2.5);opacity:0} }

                /* ── Scrollbar ── */
                .glass-scroll::-webkit-scrollbar { width:4px; }
                .glass-scroll::-webkit-scrollbar-track { background:transparent; }
                .glass-scroll::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.12); border-radius:10px; }
            `}</style>

            {/* ── Page Header ── */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <div className="flex items-center gap-2.5 mb-0.5">
                        <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-200">
                            <Navigation className="h-4 w-4 text-white" />
                        </div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Network</h1>
                    </div>
                    <p className="text-sm text-slate-400 font-medium ml-10">
                        {users.length} agent{users.length !== 1 ? 's' : ''} in field
                    </p>
                </div>
                <button
                    onClick={fetchNetwork}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-700 font-semibold text-sm hover:bg-slate-50 shadow-sm transition-all hover:shadow-md active:scale-95 disabled:opacity-60"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''} text-indigo-600`} />
                    <span className="hidden sm:inline">Refresh</span>
                </button>
            </div>

            {/* ── User List ── */}
            <div className="bg-white rounded-2xl shadow-md shadow-slate-200/60 border border-slate-100 overflow-hidden">
                {/* Table header (desktop only) */}
                <div className="hidden md:grid grid-cols-[1fr_140px_110px_150px] gap-4 px-6 py-3 bg-slate-50 border-b border-slate-100">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Agent</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Seen</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</span>
                </div>

                <div className="divide-y divide-slate-100">
                    {/* Loading skeleton */}
                    {loading && users.length === 0 && (
                        <div className="py-12 flex justify-center">
                            <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                        </div>
                    )}

                    {users.map(user => (
                        <div
                            key={user.id}
                            onClick={() => openHistory(user)}
                            className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_140px_110px_150px] gap-3 md:gap-4 items-center px-4 py-4 md:px-6 hover:bg-slate-50 transition-colors cursor-pointer group"
                        >
                            {/* Agent info */}
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center font-black text-base shadow-md shadow-blue-100 group-hover:scale-105 transition-transform flex-shrink-0">
                                    {user.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-900 text-sm truncate leading-tight">{user.name}</p>
                                    <p className="text-[11px] text-slate-400 truncate leading-tight">{user.email}</p>
                                    {/* Time — visible on mobile below name */}
                                    <div className="flex items-center gap-1 mt-1 md:hidden">
                                        <Timer className="h-3 w-3 text-indigo-400 flex-shrink-0" />
                                        <span className="text-[10px] text-slate-500 font-medium">{getTimeAgo(user.last_location_at)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Last seen (desktop) */}
                            <div className="hidden md:block">
                                <p className="text-sm font-semibold text-slate-800 leading-tight">{getTimeAgo(user.last_location_at)}</p>
                                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                                    {formatDate(user.last_location_at)?.split(',')[0]}
                                </p>
                            </div>

                            {/* Status badge (desktop) */}
                            <div className="hidden md:flex justify-center">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${user.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                    {user.status === 'active' ? 'Live' : 'Offline'}
                                </span>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 justify-end flex-shrink-0">
                                {/* Status badge mobile */}
                                <span className={`md:hidden inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold uppercase ${user.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                    {user.status === 'active' ? 'Live' : 'Off'}
                                </span>

                                <button
                                    onClick={e => { e.stopPropagation(); openGoogleMap(user.last_location?.lat, user.last_location?.lng); }}
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                    title="Open in Google Maps"
                                >
                                    <MapPin className="h-4 w-4" />
                                </button>

                                <button
                                    onClick={e => { e.stopPropagation(); openHistory(user); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[11px] font-bold hover:bg-indigo-600 hover:text-white transition-all"
                                >
                                    <Route className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Track</span>
                                </button>
                            </div>
                        </div>
                    ))}

                    {users.length === 0 && !loading && (
                        <div className="py-16 text-center">
                            <Info className="h-8 w-8 mx-auto mb-3 text-slate-200" />
                            <p className="text-sm font-bold text-slate-400">No agents in the network</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── LOCATION HISTORY MODAL ── */}
            {historyModalOpen && selectedUser && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={closeHistory} />

                    {/* Modal shell */}
                    <div className="relative w-full h-full md:w-[96vw] md:h-[94vh] md:rounded-[2rem] bg-slate-100 shadow-2xl overflow-hidden border border-white/10 flex flex-col">

                        {/* ── FLOATING TOP CONTROLS ── */}
                        <div className="absolute top-3 left-3 right-3 md:top-4 md:left-4 md:right-4 z-[70] flex flex-col gap-2 pointer-events-none">
                            {/* Row 1: User info + tile picker + close */}
                            <div className="flex items-center gap-2 pointer-events-auto">
                                {/* User + date card */}
                                <div className="glass-panel flex items-center gap-2.5 px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex-1 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-sm flex-shrink-0">
                                        {selectedUser.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-black text-slate-900 text-sm leading-tight truncate">{selectedUser.name}</p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <Calendar className="h-2.5 w-2.5 text-indigo-500 flex-shrink-0" />
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                                                {new Date(historyDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>
                                    {/* Compact date input */}
                                    <input
                                        type="date"
                                        value={historyDate}
                                        onChange={e => setHistoryDate(e.target.value)}
                                        className="bg-white/60 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 font-bold text-[10px] md:text-xs cursor-pointer outline-none flex-shrink-0"
                                    />
                                </div>

                                {/* Tile style switcher */}
                                <div className="glass-panel p-1 rounded-xl flex items-center gap-0.5 overflow-x-auto max-w-[40vw] md:max-w-none">
                                    {(Object.keys(TILE_PROVIDERS) as TileStyle[]).map(key => (
                                        <button
                                            key={key}
                                            onClick={() => setMapStyle(key)}
                                            className={`px-2.5 py-1.5 rounded-lg text-[8px] md:text-[9px] font-black tracking-widest uppercase transition-all whitespace-nowrap ${mapStyle === key ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-white/60'}`}
                                        >
                                            {TILE_PROVIDERS[key].name}
                                        </button>
                                    ))}
                                </div>

                                {/* Close */}
                                <button
                                    onClick={closeHistory}
                                    className="glass-panel p-2.5 rounded-xl text-slate-500 hover:text-red-500 hover:bg-red-50/80 transition-all flex-shrink-0"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            {/* Row 2: Road-snap status banner */}
                            {snapLoading && (
                                <div className="flex justify-center pointer-events-none">
                                    <div className="bg-indigo-600 text-white text-[10px] font-bold px-4 py-1.5 rounded-full shadow-lg flex items-center gap-2">
                                        <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        Matching to road network...
                                    </div>
                                </div>
                            )}
                            {!snapLoading && routePath.length > 0 && !loadingHistory && (
                                <div className="flex justify-center pointer-events-none">
                                    <div className="bg-emerald-600/90 text-white text-[10px] font-bold px-3 py-1 rounded-full">
                                        ✓ Road-matched route
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ── DESKTOP: Right timeline sidebar ── */}
                        <div className={`hidden md:block absolute top-[4.5rem] bottom-[5rem] right-4 z-[70] w-72 transition-all duration-300 ${timelineOpen ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+16px)] opacity-0 pointer-events-none'}`}>
                            <div className="glass-panel h-full rounded-2xl flex flex-col overflow-hidden border border-white/60">
                                <div className="px-5 py-4 border-b border-slate-200/60 flex items-center justify-between flex-shrink-0">
                                    <div>
                                        <h4 className="font-black text-slate-900 text-sm">Telemetry Feed</h4>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{sortedData.length} pings recorded</p>
                                    </div>
                                    <Activity className="h-4 w-4 text-slate-400" />
                                </div>
                                <div className="flex-1 overflow-y-auto glass-scroll p-3 space-y-1.5">
                                    {sortedData.map((point, index) => {
                                        const isActive = activePointIndex === index;
                                        return (
                                            <button
                                                key={index}
                                                id={`timeline-entry-${index}`}
                                                onClick={() => handleTimelineClick(index)}
                                                className={`w-full rounded-xl p-3 text-left transition-all ${isActive ? 'bg-indigo-600 shadow-lg shadow-indigo-200' : 'bg-white hover:bg-indigo-50 border border-slate-100'}`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={`text-[11px] font-black ${isActive ? 'text-white' : 'text-slate-900'}`}>
                                                        {new Date(point.recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </span>
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-white' : 'bg-indigo-400'}`} />
                                                </div>
                                                <div className={`text-[9px] font-mono leading-none ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
                                                    {Number(point.latitude).toFixed(5)}°N {Number(point.longitude).toFixed(5)}°E
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* ── MOBILE: Bottom sheet timeline ── */}
                        <div className={`md:hidden absolute inset-x-0 bottom-0 z-[75] transition-transform duration-300 ease-out ${timelineOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                            <div className="bg-white rounded-t-2xl shadow-2xl border-t border-slate-200 flex flex-col" style={{ maxHeight: '60vh' }}>
                                {/* Drag handle */}
                                <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
                                    <div className="w-10 h-1.5 bg-slate-200 rounded-full" />
                                </div>
                                <div className="px-4 pb-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                                    <div>
                                        <p className="font-black text-slate-900 text-sm">Telemetry Feed</p>
                                        <p className="text-[10px] font-bold text-slate-400">{sortedData.length} pings</p>
                                    </div>
                                    <button onClick={() => setTimelineOpen(false)} className="p-1.5 text-slate-400 rounded-lg">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="overflow-y-auto p-3 space-y-1.5 flex-1">
                                    {sortedData.map((point, index) => {
                                        const isActive = activePointIndex === index;
                                        return (
                                            <button
                                                key={index}
                                                onClick={() => { handleTimelineClick(index); setTimelineOpen(false); }}
                                                className={`w-full rounded-xl p-3 text-left flex items-center gap-3 transition-all ${isActive ? 'bg-indigo-600' : 'bg-slate-50 border border-slate-100 active:bg-indigo-50'}`}
                                            >
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-white' : 'bg-indigo-400'}`} />
                                                <div className="min-w-0">
                                                    <p className={`text-[11px] font-black leading-tight ${isActive ? 'text-white' : 'text-slate-900'}`}>
                                                        {new Date(point.recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </p>
                                                    <p className={`text-[9px] font-mono mt-0.5 ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
                                                        {Number(point.latitude).toFixed(4)}°N {Number(point.longitude).toFixed(4)}°E
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* ── BOTTOM STATS BAR ── */}
                        {!loadingHistory && sortedData.length > 0 && (
                            <div className="absolute bottom-3 left-3 right-3 md:bottom-4 md:left-4 md:right-auto z-[70]">
                                <div className="glass-panel px-4 py-3 md:px-6 md:py-3.5 rounded-2xl flex items-center gap-4 md:gap-8 overflow-x-auto">
                                    <div className="flex flex-col flex-shrink-0">
                                        <span className="text-[8px] md:text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-0.5">Distance</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-base md:text-xl font-black text-slate-900">
                                                {stats.distance >= 1000 ? (stats.distance / 1000).toFixed(2) : Math.round(stats.distance)}
                                            </span>
                                            <span className="text-[9px] font-bold text-slate-400">
                                                {stats.distance >= 1000 ? 'km' : 'm'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="w-px h-8 bg-slate-200 flex-shrink-0" />
                                    <div className="flex flex-col flex-shrink-0">
                                        <span className="text-[8px] md:text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-0.5">Duration</span>
                                        <span className="text-base md:text-xl font-black text-slate-900 whitespace-nowrap">{stats.duration}</span>
                                    </div>
                                    <div className="w-px h-8 bg-slate-200 flex-shrink-0" />
                                    <div className="flex flex-col flex-shrink-0">
                                        <span className="text-[8px] md:text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-0.5">Pings</span>
                                        <span className="text-base md:text-xl font-black text-slate-900">{stats.points}</span>
                                    </div>
                                    <button
                                        onClick={() => setTimelineOpen(v => !v)}
                                        className={`ml-2 p-2.5 md:p-3 rounded-xl transition-all flex-shrink-0 ${timelineOpen ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        title="Toggle Telemetry Feed"
                                    >
                                        <Activity className="h-4 w-4 md:h-5 md:w-5" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── MAP ── */}
                        <div className="absolute inset-0 z-0">
                            {loadingHistory ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100">
                                    <div className="relative mb-5">
                                        <div className="w-14 h-14 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Navigation className="h-5 w-5 text-indigo-600" />
                                        </div>
                                    </div>
                                    <p className="font-black text-slate-800 text-base">Loading GPS Data</p>
                                    <p className="text-sm text-slate-400 mt-1">Fetching telemetry...</p>
                                </div>
                            ) : sortedData.length > 0 ? (
                                <MapContainer
                                    center={mapPoints[0] || [20.5937, 78.9629]}
                                    zoom={18}
                                    className="w-full h-full"
                                    zoomControl={false}
                                >
                                    <TileLayer
                                        key={mapStyle}
                                        attribution={TILE_PROVIDERS[mapStyle].attribution}
                                        url={TILE_PROVIDERS[mapStyle].url}
                                    />
                                    <FitBounds points={mapPoints} />
                                    <FlyToPoint point={flyTarget} />

                                    {/* Road-snapped route (or GPS polyline fallback) */}
                                    <Polyline
                                        positions={polylinePath}
                                        pathOptions={{
                                            color: TILE_PROVIDERS[mapStyle].dark ? '#818cf8' : '#4f46e5',
                                            weight: 4,
                                            opacity: 0.85,
                                            lineCap: 'round',
                                            lineJoin: 'round',
                                        }}
                                    />

                                    {/* Deduplicated GPS ping dots (no stacking) */}
                                    {dedupPoints.map((point, idx) => (
                                        <CircleMarker
                                            key={`dot-${idx}`}
                                            center={point}
                                            radius={3}
                                            pathOptions={{
                                                color: '#ffffff',
                                                fillColor: TILE_PROVIDERS[mapStyle].dark ? '#4f46e5' : '#6366f1',
                                                fillOpacity: 1,
                                                weight: 1.5,
                                            }}
                                        />
                                    ))}

                                    {/* Start marker */}
                                    <Marker position={mapPoints[0]} icon={startIcon}>
                                        <Popup>
                                            <div className="p-1.5 min-w-[140px]">
                                                <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Journey Start</div>
                                                <div className="text-base font-black text-slate-900">
                                                    {new Date(sortedData[0].recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <button
                                                    onClick={() => openGoogleMap(sortedData[0].latitude, sortedData[0].longitude)}
                                                    className="mt-2 w-full py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold"
                                                >
                                                    Open in Maps
                                                </button>
                                            </div>
                                        </Popup>
                                    </Marker>

                                    {/* End marker */}
                                    {mapPoints.length > 1 && (
                                        <Marker position={mapPoints[mapPoints.length - 1]} icon={endIcon}>
                                            <Popup>
                                                <div className="p-1.5 min-w-[140px]">
                                                    <div className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-1">Journey End</div>
                                                    <div className="text-base font-black text-slate-900">
                                                        {new Date(sortedData[sortedData.length - 1].recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                    <button
                                                        onClick={() => openGoogleMap(sortedData[sortedData.length - 1].latitude, sortedData[sortedData.length - 1].longitude)}
                                                        className="mt-2 w-full py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold"
                                                    >
                                                        Open in Maps
                                                    </button>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )}

                                    {/* Selected point beacon */}
                                    {activePointIndex !== null && (
                                        <Marker position={mapPoints[activePointIndex]} icon={activeIcon}>
                                            <Popup>
                                                <div className="p-1.5 min-w-[140px]">
                                                    <div className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-1">Selected Point</div>
                                                    <div className="text-base font-black text-slate-900">
                                                        {new Date(sortedData[activePointIndex].recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                    <button
                                                        onClick={() => openGoogleMap(sortedData[activePointIndex].latitude, sortedData[activePointIndex].longitude)}
                                                        className="mt-2 w-full py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold"
                                                    >
                                                        Open in Maps
                                                    </button>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )}
                                </MapContainer>
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50">
                                    <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center mb-5">
                                        <MapPin className="h-9 w-9 text-slate-300" />
                                    </div>
                                    <p className="font-black text-slate-800 text-base">No GPS Data</p>
                                    <p className="text-sm text-slate-400 mt-1">No location records for this date</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Network;
