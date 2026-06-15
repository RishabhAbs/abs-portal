import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Navigation, Menu, CheckCircle, MapPin, Loader2, PauseCircle, PlayCircle, Clock, RefreshCw, X, ChevronRight, LayoutList, CheckSquare, Search } from 'lucide-react';
import { visitsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

interface Visit {
    id: number;
    customer_name: string;
    person_name: string;
    phone_no: string;
    customer_lat: string;
    customer_lng: string;
    address1?: string;
    city?: string;
    pincode?: string;
    status: 'Pending' | 'Paused' | 'Completed';
    scheduled_date: string;
}

const ConnectMap = () => {
    const { user, canEdit, canCheckPermission } = useAuth();
    const canPauseAnyVisit = canCheckPermission('visits_our', 'pause') || canCheckPermission('visits_not_our', 'pause');
    const canEditAnyVisit = canEdit('visits_our') || canEdit('visits_not_our');
    const navigate = useNavigate();
    const { showError, showSuccess } = useToast();
    const [visits, setVisits] = useState<Visit[]>([]);
    const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'active' | 'deferred'>('active');
    const [searchTerm, setSearchTerm] = useState('');

    // Complete Modal State
    const [completeModal, setCompleteModal] = useState<Visit | null>(null);
    const [completeRemark, setCompleteRemark] = useState('');
    const [completing, setCompleting] = useState(false);

    useEffect(() => {
        // High Accuracy Geolocation
        if (navigator.geolocation) {
            const watchId = navigator.geolocation.watchPosition(
                (position) => {
                    setUserLocation([position.coords.latitude, position.coords.longitude]);
                },
                (err) => {
                },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
            );
            return () => navigator.geolocation.clearWatch(watchId);
        }
    }, []);

    useEffect(() => {
        fetchVisits();
    }, [user]);

    const fetchVisits = async () => {
        try {
            if (!user?.name) return;
            const data = await visitsApi.getPending(user.name);
            setVisits(data);
        } catch (err) {
        } finally {
            setLoading(false);
        }
    };

    // --- GREEDY TSP ALGORITHM ---
    const sortedRoute = useMemo(() => {
        // Filter tasks
        const pending = visits.filter(v => v.status === 'Pending');
        const paused = visits.filter(v => v.status === 'Paused');

        if (!userLocation || pending.length === 0) {
            return { active: pending, deferred: paused };
        }

        // Clone to avoid mutating state
        const remaining = [...pending];
        const sorted: Visit[] = [];
        let currentLoc = { lat: userLocation[0], lng: userLocation[1] };

        // Greedy Sort
        while (remaining.length > 0) {
            let nearestIdx = -1;
            let minDist = Infinity;

            for (let i = 0; i < remaining.length; i++) {
                const v = remaining[i];
                if (!v.customer_lat || !v.customer_lng) continue; // Skip missing coords

                const d = getDistance(currentLoc.lat, currentLoc.lng, parseFloat(v.customer_lat), parseFloat(v.customer_lng));
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }

            if (nearestIdx !== -1) {
                const next = remaining[nearestIdx];
                sorted.push(next);
                // Update current location to this task's location
                if (next.customer_lat && next.customer_lng) {
                    currentLoc = { lat: parseFloat(next.customer_lat), lng: parseFloat(next.customer_lng) };
                }
                remaining.splice(nearestIdx, 1);
            } else {
                // If remaining have no coords, just append them
                sorted.push(...remaining);
                break;
            }
        }

        return { active: sorted, deferred: paused };
    }, [visits, userLocation]);

    const handleTogglePause = async (e: React.MouseEvent, visit: Visit) => {
        e.stopPropagation();
        const newStatus = visit.status === 'Pending' ? 'Paused' : 'Pending';

        // Optimistic UI update
        setVisits(prev => prev.map(v => v.id === visit.id ? { ...v, status: newStatus } : v));

        try {
            if (newStatus === 'Paused') {
                await visitsApi.pause(visit.id);
                showSuccess('Paused', 'Task moved to Deferred tab');
            } else {
                await visitsApi.resume(visit.id);
                showSuccess('Resumed', 'Task moved to Active Route');
            }
        } catch (err) {
            fetchVisits(); // Revert on error
        }
    };

    const handleComplete = async () => {
        if (!completeModal) return;
        setCompleting(true);
        try {
            const loc = userLocation || [0, 0];
            await visitsApi.complete({
                id: completeModal.id,
                lat: loc[0].toString(),
                lng: loc[1].toString(),
                remark: completeRemark
            });
            showSuccess('Completed', 'Visit marked as done');
            setCompleteModal(null);
            setCompleteRemark('');
            fetchVisits();
        } catch (e: any) {
            showError('Error', 'Failed to complete task');
        } finally {
            setCompleting(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-blue-600" /></div>;

    if (visits.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-6 text-center">
                <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm">
                    <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="h-8 w-8" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">All Done!</h2>
                    <p className="text-gray-500 mt-2 mb-6">No pending visits assigned to you.</p>
                    <button onClick={() => navigate('/dashboard')} className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold">Back to Dashboard</button>
                    <button onClick={fetchVisits} className="mt-4 text-blue-600 text-sm font-bold flex items-center justify-center gap-2"><RefreshCw className="h-4 w-4" /> Refresh</button>
                </div>
            </div>
        );
    }

    const rawList = activeTab === 'active' ? sortedRoute.active : sortedRoute.deferred;
    const displayList = rawList.filter(v =>
        (v.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.city || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.person_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm border-b">
                <div>
                    <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
                        <LayoutList className="h-6 w-6 text-blue-600" />
                        Smart Route
                    </h1>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                        {userLocation ? 'GPS Active' : 'Acquiring GPS...'}
                        {userLocation && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative hidden md:block w-48 transition-all focus-within:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search route..."
                            className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                        />
                    </div>
                    <button onClick={fetchVisits} className="p-2 bg-gray-50 border rounded-xl hover:bg-gray-100 text-gray-600">
                        <RefreshCw className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Mobile Search (Collapsible or just always visible in header on mobile? Let's generic approach) */}
            <div className="md:hidden px-4 pb-2 bg-white border-b">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search route..."
                        className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm outline-none"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="px-4 py-2 bg-white border-b flex gap-2 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('active')}
                    className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'active' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                >
                    Active Route ({sortedRoute.active.length})
                </button>
                <button
                    onClick={() => setActiveTab('deferred')}
                    className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'deferred' ? 'bg-amber-500 text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                >
                    Deferred ({sortedRoute.deferred.length})
                </button>
            </div>

            {/* List Content */}
            <div className="flex-1 p-3 md:p-4 space-y-3 pb-20">
                {displayList.length === 0 ? (
                    <div className="text-center py-20 text-gray-400">
                        <div className="h-16 w-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckSquare className="h-8 w-8 opacity-50" />
                        </div>
                        <p className="font-bold uppercase tracking-widest text-sm">No tasks in this list</p>
                    </div>
                ) : (
                    displayList.map((visit, idx) => {
                        let prevLat = userLocation?.[0] || 0;
                        let prevLng = userLocation?.[1] || 0;

                        // For item > 0, calculate distance from PREVIOUS item
                        if (idx > 0 && activeTab === 'active') {
                            const prev = displayList[idx - 1];
                            if (prev.customer_lat && prev.customer_lng) {
                                prevLat = parseFloat(prev.customer_lat);
                                prevLng = parseFloat(prev.customer_lng);
                            }
                        }

                        const dist = (visit.customer_lat && visit.customer_lng) ?
                            getDistance(prevLat, prevLng, parseFloat(visit.customer_lat), parseFloat(visit.customer_lng)).toFixed(1) + ' km' : '?';

                        return (
                            <div key={visit.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
                                {activeTab === 'active' && (
                                    <div className="absolute top-0 right-0 p-3 bg-blue-50 rounded-bl-2xl">
                                        <div className="text-right">
                                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-tight">Step</div>
                                            <div className="text-lg font-black text-blue-600 leading-none">#{idx + 1}</div>
                                        </div>
                                    </div>
                                )}

                                <div className="pr-12">
                                    <h3 className="font-bold text-gray-900 text-lg leading-tight">{visit.customer_name}</h3>
                                    <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500 font-medium">
                                        <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                        {visit.city || 'Unknown City'}
                                        {activeTab === 'active' && <span className="text-blue-600 font-bold bg-blue-50 px-1.5 rounded-md text-xs ml-1">+{dist}</span>}
                                    </div>
                                </div>

                                {/* Address / Metadata */}
                                <div className="mt-4 grid grid-cols-2 gap-3 text-xs bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <div>
                                        <span className="block font-bold text-gray-400 uppercase text-[9px]">Contact</span>
                                        <span className="font-semibold text-gray-700 truncate block">{visit.person_name}</span>
                                    </div>
                                    <div>
                                        <span className="block font-bold text-gray-400 uppercase text-[9px]">Phone</span>
                                        <span className="font-semibold text-gray-700 truncate block">{visit.phone_no}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 mt-4">
                                    {/* Action 1: Navigate (Google Maps) */}
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${visit.customer_lat},${visit.customer_lng}`, '_blank')}
                                        className="flex-1 py-3 bg-white border-2 border-gray-100 text-gray-700 rounded-xl font-bold text-xs uppercase tracking-wider hover:border-blue-200 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Navigation className="h-4 w-4" /> Nav
                                    </button>

                                    {/* Action 2: Pause/Resume */}
                                    {canPauseAnyVisit && <button
                                        onClick={(e) => handleTogglePause(e, visit)}
                                        className={`flex-1 py-3 border-2 border-transparent rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors
                                            ${visit.status === 'Paused' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-amber-100 hover:text-amber-700'}
                                        `}
                                    >
                                        {visit.status === 'Paused' ? <><PlayCircle className="h-4 w-4" /> Resume</> : <><PauseCircle className="h-4 w-4" /> Pause</>}
                                    </button>}

                                    {/* Action 3: Complete */}
                                    {canEditAnyVisit && <button
                                        onClick={() => setCompleteModal(visit)}
                                        className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                                    >
                                        <CheckCircle className="h-4 w-4" /> Done
                                    </button>}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Complete Modal */}
            {completeModal && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
                    <div className="bg-white rounded-t-[2rem] md:rounded-[2rem] shadow-2xl w-full max-w-md animate-in slide-in-from-bottom duration-300 overflow-hidden">
                        <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                            <h3 className="text-lg font-black text-gray-900">Complete Visit</h3>
                            <button onClick={() => setCompleteModal(null)} className="p-2 hover:bg-gray-200 rounded-full">
                                <X className="h-5 w-5 text-gray-500" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Remark / Outcome</label>
                                <textarea
                                    value={completeRemark}
                                    onChange={e => setCompleteRemark(e.target.value)}
                                    className="w-full p-4 bg-gray-50 border-2 border-transparent focus:border-blue-500 rounded-xl outline-none font-medium h-32 resize-none"
                                    placeholder="Enter meeting notes..."
                                />
                            </div>
                            <button
                                onClick={handleComplete}
                                disabled={completing}
                                className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-200 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {completing ? 'Submitting...' : 'Submit & Complete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Haversine Helper
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg: number) {
    return deg * (Math.PI / 180)
}

export default ConnectMap;
