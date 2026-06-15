import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { attendanceApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MonthlyAttendanceDetail: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, isAdmin } = useAuth();

    const userId = searchParams.get('userId') || '';
    const userName = searchParams.get('name') || 'Employee';
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));

    const [records, setRecords] = useState<any[]>([]);
    const [holidayDates, setHolidayDates] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState<string | null>(null);

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Helper: normalize date
    const normalizeDate = (d: any): string => {
        if (!d) return '';
        const s = String(d);
        if (s.includes('T')) return s.split('T')[0];
        if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
        try {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
                return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            }
        } catch {}
        return s;
    };

    // Compute status from record fields (single source of truth)
    const computeStatus = (record: any): string => {
        if (!record) return 'Absent';
        const checkin = record.checkin_time;
        const checkout = record.checkout_time;
        const coAddr = record.checkout_address || '';
        if (!checkin) return 'Absent';
        let status = 'Present';
        if (checkin > '10:10:00') status = 'Late Comer';
        if (checkout && checkout < '18:20:00') status = 'Early Leaver';
        if (checkout && checkout < '14:00:00') status = 'Half Day';
        if (coAddr.includes('Auto Check-Out') || (checkout && checkout >= '23:00:00')) status = 'Half Day';
        return status;
    };

    // Compute stats
    const computeStats = () => {
        const lastDay = new Date(year, month, 0).getDate();
        const holidaySet = new Set((holidayDates || []).map(d => normalizeDate(d)));
        const recordMap: Record<string, any> = {};
        for (const r of records) {
            recordMap[normalizeDate(r.date)] = r;
        }
        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
        let present = 0, absent = 0, halfDay = 0;
        for (let d = 1; d <= lastDay; d++) {
            const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (ds > todayStr) continue;
            const dow = new Date(year, month - 1, d).getDay();
            if (dow === 0 || holidaySet.has(ds)) continue;
            const rec = recordMap[ds];
            const status = computeStatus(rec);
            if (status === 'Half Day') halfDay++;
            else if (rec) present++;
            else absent++;
        }
        return { total_days: lastDay, present, absent, half_day: halfDay };
    };

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Non-admin: use own endpoint
                if (!isAdmin()) {
                    const data = await attendanceApi.getMyMonthlyStats(month, year);
                    setRecords(data.records || []);
                    setHolidayDates(data.holiday_dates || []);
                } else {
                    // Admin: fetch user's history + holidays
                    const from = `${year}-${String(month).padStart(2, '0')}-01`;
                    const lastDay = new Date(year, month, 0).getDate();
                    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
                    const history = await attendanceApi.getUserHistory(userId, from, to) as any[];
                    const holidays = await attendanceApi.getHolidays();
                    const monthHolidays = (holidays || []).filter((h: any) => {
                        const d = normalizeDate(h.holiday_date);
                        return d.startsWith(`${year}-${String(month).padStart(2, '0')}`);
                    }).map((h: any) => normalizeDate(h.holiday_date));
                    setRecords(history || []);
                    setHolidayDates(monthHolidays);
                }
            } catch (err: any) {
                console.error('Failed to load attendance:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, month, year]);

    const stats = computeStats();

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Present': case 'Late Comer': case 'Early Leaver': return 'bg-emerald-500 text-white';
            case 'Half Day': return 'bg-amber-500 text-white';
            case 'Sunday': return 'bg-orange-500 text-white';
            case 'Holiday': return 'bg-blue-500 text-white';
            default: return 'bg-red-500 text-white';
        }
    };

    // Build days
    const buildDays = () => {
        const lastDay = new Date(year, month, 0).getDate();
        const holidaySet = new Set((holidayDates || []).map(d => normalizeDate(d)));
        const recordMap: Record<string, any> = {};
        for (const r of records) {
            recordMap[normalizeDate(r.date)] = r;
        }
        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

        const allDays: any[] = [];
        for (let d = lastDay; d >= 1; d--) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (dateStr > todayStr) continue;
            const record = recordMap[dateStr];
            const dayOfWeek = new Date(year, month - 1, d).getDay();
            const isSunday = dayOfWeek === 0;
            const isHoliday = holidaySet.has(dateStr);
            const dayName = new Date(year, month - 1, d).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();

            let statusLabel = 'Absent';
            if (isSunday) statusLabel = 'Sunday';
            else if (isHoliday) statusLabel = 'Holiday';
            else statusLabel = computeStatus(record);

            if (activeFilter) {
                if (activeFilter === 'Present' && (statusLabel === 'Absent' || statusLabel === 'Sunday' || statusLabel === 'Holiday' || statusLabel === 'Half Day')) continue;
                if (activeFilter === 'Absent' && statusLabel !== 'Absent') continue;
                if (activeFilter === 'Half Day' && statusLabel !== 'Half Day') continue;
            }

            allDays.push({ day: d, dateStr, record, dayName, isSunday, isHoliday, statusLabel });
        }
        return allDays;
    };

    const allDays = loading ? [] : buildDays();

    return (
        <div className="bg-[#f2f4f7] min-h-screen font-sans" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>
            {/* DARK HEADER */}
            <div className="bg-gradient-to-r from-[#0a1628] to-[#162544] px-4 py-4 md:px-6 md:py-5">
                <div className="max-w-5xl mx-auto flex justify-between items-center">
                    <div>
                        <div className="text-[10px] md:text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Monthly Attendance</div>
                        <div className="text-[20px] md:text-[26px] font-extrabold text-white uppercase leading-tight">{userName}</div>
                        <div className="text-[13px] md:text-[15px] text-slate-300 font-medium mt-0.5">{months[month - 1]} {year}</div>
                    </div>
                    <button 
                        onClick={() => navigate(-1)} 
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-white text-[12px] font-bold uppercase transition-all"
                    >
                        <ChevronLeft className="h-4 w-4" /> Back
                    </button>
                </div>
            </div>

            {/* SUMMARY PILLS */}
            <div className="max-w-5xl mx-auto">
                <div className="flex bg-white border-b border-gray-200 divide-x divide-gray-200 shadow-sm">
                    {[
                        { label: 'All', value: stats.total_days, filter: null, color: 'text-gray-900', activeColor: 'text-white', bg: activeFilter === null ? 'bg-[#0a1628]' : '' },
                        { label: 'Present', value: stats.present, filter: 'Present', color: 'text-green-600', activeColor: 'text-green-600', bg: activeFilter === 'Present' ? 'bg-green-50 ring-1 ring-green-200' : '' },
                        { label: 'Absent', value: stats.absent, filter: 'Absent', color: 'text-red-600', activeColor: 'text-red-600', bg: activeFilter === 'Absent' ? 'bg-red-50 ring-1 ring-red-200' : '' },
                        { label: 'Half-Day', value: stats.half_day, filter: 'Half Day', color: 'text-amber-600', activeColor: 'text-amber-600', bg: activeFilter === 'Half Day' ? 'bg-amber-50 ring-1 ring-amber-200' : '' },
                    ].map((pill, i) => {
                        const isActive = activeFilter === pill.filter;
                        const isAllActive = pill.filter === null && isActive;
                        return (
                        <button key={i} onClick={() => setActiveFilter(pill.filter)} className={`flex-1 py-3.5 text-center transition-all ${pill.bg}`}>
                            <div className={`text-[20px] md:text-[22px] font-extrabold ${isAllActive ? 'text-white' : pill.color}`}>{pill.value}</div>
                            <div className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${isAllActive ? 'text-slate-300' : 'text-gray-400'}`}>{pill.label}</div>
                        </button>
                        );
                    })}
                </div>
            </div>

            {/* DAILY ROWS */}
            <div className="max-w-5xl mx-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-24 bg-white">
                        <Loader2 className="h-7 w-7 text-blue-500 animate-spin" />
                        <span className="ml-3 text-[15px] text-gray-400 font-semibold">Loading attendance...</span>
                    </div>
                ) : (
                    <div className="p-2 md:p-4 space-y-2 md:space-y-0 bg-white shadow-sm">
                        {/* Desktop Table Header */}
                        <div className="hidden md:grid md:grid-cols-[60px_70px_1fr_1fr_100px_120px] bg-[#0a1628] text-white text-[12px] font-bold uppercase tracking-wider rounded-t-lg">
                            <div className="px-3 py-3 text-center border-r border-slate-600">Date</div>
                            <div className="px-3 py-3 text-center border-r border-slate-600">Day</div>
                            <div className="px-3 py-3 text-center border-r border-slate-600">Check In</div>
                            <div className="px-3 py-3 text-center border-r border-slate-600">Check Out</div>
                            <div className="px-3 py-3 text-center border-r border-slate-600">Hours</div>
                            <div className="px-3 py-3 text-center">Status</div>
                        </div>

                        {allDays.length === 0 && !loading && (
                            <div className="text-center py-12 text-gray-400 text-[14px] font-semibold">No matching records</div>
                        )}

                        {allDays.map(({ day, dateStr, record, dayName, isSunday, isHoliday, statusLabel }, idx) => {
                            const statusStyles = getStatusStyle(statusLabel);
                            return (
                                <React.Fragment key={dateStr}>
                                    {/* DESKTOP ROW */}
                                    <div className={`hidden md:grid md:grid-cols-[60px_70px_1fr_1fr_100px_120px] border-b border-gray-200 text-[14px] font-medium transition-colors ${isSunday ? 'bg-orange-50' : isHoliday ? 'bg-blue-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'} hover:bg-blue-50/50`}>
                                        <div className="px-3 py-3 text-center font-extrabold text-gray-800 tabular-nums border-r border-gray-200">{String(day).padStart(2, '0')}</div>
                                        <div className={`px-3 py-3 text-center font-bold uppercase text-[13px] border-r border-gray-200 ${isSunday ? 'text-orange-600' : 'text-gray-500'}`}>{dayName}</div>
                                        <div className="px-3 py-2.5 tabular-nums border-r border-gray-200">
                                            {record ? (
                                                <div className="text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <ArrowDown className="h-4 w-4 text-emerald-500" />
                                                        <span className="text-gray-800 font-semibold">{record.checkin_time || '--:--'}</span>
                                                    </div>
                                                    {record.checkin_address && (
                                                        <div className="text-[11px] text-emerald-500 font-medium mt-0.5">{record.checkin_address}</div>
                                                    )}
                                                </div>
                                            ) : <span className="text-gray-300 text-center block">—</span>}
                                        </div>
                                        <div className="px-3 py-2.5 tabular-nums border-r border-gray-200">
                                            {record ? (
                                                <div className="text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <ArrowUp className="h-4 w-4 text-red-400" />
                                                        <span className="text-gray-800 font-semibold">{record.checkout_time || '---:---'}</span>
                                                    </div>
                                                    {record.checkout_address && (
                                                        <div className="text-[11px] text-red-400 font-medium mt-0.5">{record.checkout_address}</div>
                                                    )}
                                                </div>
                                            ) : <span className="text-gray-300 text-center block">—</span>}
                                        </div>
                                        <div className="px-3 py-2.5 text-center border-r border-gray-200 flex items-center justify-center">
                                            {record?.working_hours ? (
                                                <span className="text-[13px] font-bold text-blue-600">{record.working_hours}</span>
                                            ) : <span className="text-gray-300">—</span>}
                                        </div>
                                        <div className="px-2 py-2.5 flex items-center justify-center">
                                            <span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-md ${statusStyles}`}>{statusLabel}</span>
                                        </div>
                                    </div>

                                    {/* MOBILE CARD */}
                                    <div className={`md:hidden rounded-xl border overflow-hidden shadow-sm ${isSunday ? 'border-orange-200 bg-orange-50' : isHoliday ? 'border-blue-200 bg-blue-50/70' : 'border-gray-200 bg-white'}`}>
                                        {isSunday || isHoliday ? (
                                            <div className="flex items-center justify-between px-4 py-3.5">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[22px] font-extrabold text-gray-800 tabular-nums leading-none">{String(day).padStart(2, '0')}</span>
                                                    <span className={`text-[14px] font-bold uppercase ${isSunday ? 'text-orange-600' : 'text-blue-600'}`}>{dayName}</span>
                                                </div>
                                                <span className={`text-[15px] font-bold ${isSunday ? 'text-orange-500' : 'text-blue-500'}`}>{isSunday ? 'Sunday' : 'Holiday'}</span>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/80 border-b border-gray-100">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[22px] font-extrabold text-gray-800 tabular-nums leading-none">{String(day).padStart(2, '0')}</span>
                                                        <span className="text-[14px] font-bold uppercase text-gray-500">{dayName}</span>
                                                    </div>
                                                    <span className={`text-[11px] font-bold uppercase px-3 py-1 rounded-full ${statusStyles}`}>{statusLabel}</span>
                                                </div>
                                                {record ? (
                                                    <div className="flex items-center justify-between px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <ArrowDown className="h-4 w-4 text-emerald-500" />
                                                            <div>
                                                                <div className="text-[14px] font-bold text-gray-800 tabular-nums">{record.checkin_time || '--:--'}</div>
                                                                {record.checkin_address && <div className="text-[10px] text-emerald-500 font-medium">{record.checkin_address}</div>}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <ArrowUp className="h-4 w-4 text-red-400" />
                                                            <div>
                                                                <div className="text-[14px] font-bold text-gray-800 tabular-nums">{record.checkout_time || '---:---'}</div>
                                                                {record.checkout_address && <div className="text-[10px] text-red-400 font-medium">{record.checkout_address}</div>}
                                                            </div>
                                                        </div>
                                                        <div className="text-center">
                                                            <div className="text-[10px] text-gray-400 font-bold">Hours</div>
                                                            <div className="text-[14px] font-bold text-blue-600 tabular-nums">{record.working_hours || '—'}</div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="px-4 py-3">
                                                        <span className="text-[13px] font-medium text-red-400">No attendance recorded</span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MonthlyAttendanceDetail;
