import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { attendanceApi } from '../services/api';
import { Search, RefreshCw, X, Zap, AlertCircle, Navigation, ChevronLeft, ChevronRight, CalendarDays, BarChart2, Tablet, Smartphone, Monitor, Info, CheckCircle2, Wand2, MapPin, ChevronDown, ChevronUp, Clock, Loader2, ArrowDown, ArrowUp, Download } from 'lucide-react';
import { useToast } from '../components/Toast/Toast';
import { useNavigate } from 'react-router-dom';

const AttendanceHistory: React.FC = () => {
    const { isAdmin, user } = useAuth();
    const { showError, showSuccess } = useToast();
    const navigate = useNavigate();
    
    // VIEWPORT LOGIC
    const [viewMode, setViewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            if (width < 640) setViewMode('mobile');
            else if (width < 1024) setViewMode('tablet');
            else setViewMode('desktop');
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // TAB STATE
    const [activeTab, setActiveTab] = useState<'today' | 'monthly' | 'holidays'>('today');

    // HOLIDAY STATE
    const [holidaysList, setHolidaysList] = useState<any[]>([]);
    const [holidayCalendarDate, setHolidayCalendarDate] = useState(new Date());
    const [selectedDateForModal, setSelectedDateForModal] = useState<string | null>(null);
    const [holidayDescModal, setHolidayDescModal] = useState('');
    const [submittingHoliday, setSubmittingHoliday] = useState(false);

    // TODAY'S REPORT STATE
    const [todayDate, setTodayDate] = useState(new Date().toISOString().split('T')[0]);
    const [todaySearch, setTodaySearch] = useState('');
    const [todayReport, setTodayReport] = useState<any[]>([]);
    const [todaySummary, setTodaySummary] = useState<any>({ total: 0, present: 0, absent: 0, half_day: 0, late: 0, early: 0 });
    const [todayFilter, setTodayFilter] = useState<string | null>(null);

    // MONTHLY REPORT STATE
    const [monthlyMonth, setMonthlyMonth] = useState(new Date().getMonth() + 1);
    const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear());
    const [monthlySearch, setMonthlySearch] = useState('');
    const [monthlyReport, setMonthlyReport] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // NON-ADMIN SELF STATS
    const [selfStats, setSelfStats] = useState<any>(null);
    const [selfStatsLoading, setSelfStatsLoading] = useState(false);
    const [selfDetailFilter, setSelfDetailFilter] = useState<string | null>(null);

    // EXPANDED ROW STATE (Daily Report - click to show location)
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [geocodedAddresses, setGeocodedAddresses] = useState<Record<string, { checkin?: string; checkout?: string }>>({});

    // Reverse geocode using stored lat/lng via OpenStreetMap Nominatim
    const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
                headers: { 'User-Agent': 'ABSCloud/1.0' }
            });
            if (!res.ok) return '';
            const data = await res.json();
            if (data?.display_name) {
                return data.display_name.split(', ').slice(0, 4).join(', ');
            }
            return '';
        } catch { return ''; }
    };

    // When expanding a row, geocode addresses if lat/lng available
    const handleExpandRow = async (userId: string, row: any) => {
        if (expandedUserId === userId) { setExpandedUserId(null); return; }
        setExpandedUserId(userId);
        if (geocodedAddresses[userId]) return; // already geocoded

        const addresses: { checkin?: string; checkout?: string } = {};
        if (row.checkin_latitude && row.checkin_longitude) {
            addresses.checkin = await reverseGeocode(row.checkin_latitude, row.checkin_longitude);
        }
        if (row.checkout_latitude && row.checkout_longitude) {
            addresses.checkout = await reverseGeocode(row.checkout_latitude, row.checkout_longitude);
        }
        setGeocodedAddresses(prev => ({ ...prev, [userId]: addresses }));
    };

    // MONTHLY DETAIL MODAL STATE
    const [monthlyDetailUser, setMonthlyDetailUser] = useState<any | null>(null);
    const [monthlyDetailData, setMonthlyDetailData] = useState<any[]>([]);
    const [monthlyDetailLoading, setMonthlyDetailLoading] = useState(false);
    const [monthlyDetailFilter, setMonthlyDetailFilter] = useState<string | null>(null);
    const [monthlyDetailHolidayDates, setMonthlyDetailHolidayDates] = useState<string[]>([]);

    // MODAL STATE (FORCE)
    const [forceUser, setForceUser] = useState<any | null>(null);
    const [forceTime, setForceTime] = useState('');
    const [submittingForce, setSubmittingForce] = useState(false);

    // FETCH DATA
    const fetchData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'today') {
                const data = await attendanceApi.getDailyReport(todayDate) as any;
                setTodayReport(data.records || []);
                setTodaySummary(data.summary || { total: 0, present: 0, absent: 0, half_day: 0, late: 0, early: 0 });
            } else if (activeTab === 'monthly') {
                const firstOfMonth = `${monthlyYear}-${String(monthlyMonth).padStart(2, '0')}-01`;
                const data = await attendanceApi.getDailyReport(firstOfMonth) as any;
                setMonthlyReport(data.records || []);
            } else if (activeTab === 'holidays') {
                const data = await attendanceApi.getHolidays();
                setHolidaysList(data || []);
            }
        } catch (err: any) {
            showError('Error', err.message || 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin()) fetchData();
    }, [todayDate, monthlyMonth, monthlyYear, activeTab]);

    // NON-ADMIN: Fetch own monthly stats
    const fetchSelfStats = async () => {
        setSelfStatsLoading(true);
        try {
            const data = await attendanceApi.getMyMonthlyStats(monthlyMonth, monthlyYear);
            setSelfStats(data);
        } catch (err: any) {
            showError('Error', err.message || 'Failed to load your stats');
        } finally {
            setSelfStatsLoading(false);
        }
    };

    useEffect(() => {
        if (!isAdmin() && user) {
            fetchSelfStats();
        }
    }, [monthlyMonth, monthlyYear, user]);

    // HOLIDAY ACTIONS
    const handleAddHoliday = async () => {
        if (!selectedDateForModal) return;
        setSubmittingHoliday(true);
        try {
            await attendanceApi.addHoliday(selectedDateForModal, holidayDescModal);
            showSuccess('Success', 'Holiday saved');
            setSelectedDateForModal(null);
            fetchData();
        } catch (err: any) {
            showError('Error', err.message);
        } finally {
            setSubmittingHoliday(false);
        }
    };

    const handleRemoveHoliday = async (date: string) => {
        try {
            await attendanceApi.removeHoliday(date);
            showSuccess('Deleted', 'Holiday removed');
            fetchData();
        } catch (err: any) {
            showError('Error', err.message);
        }
    };

    const autoSuggestHolidays = async () => {
        const year = holidayCalendarDate.getFullYear();
        const month = holidayCalendarDate.getMonth();
        const holidays: { date: string; description: string }[] = [];
        
        // 1. Sundays in the SELECTED month only
        const date = new Date(year, month, 1);
        while (date.getMonth() === month) {
            if (date.getDay() === 0) { // Sunday
                const y = date.getFullYear();
                const mStr = String(date.getMonth() + 1).padStart(2, '0');
                const dStr = String(date.getDate()).padStart(2, '0');
                holidays.push({ 
                    date: `${y}-${mStr}-${dStr}`, 
                    description: 'Sunday' 
                });
            }
            date.setDate(date.getDate() + 1);
        }

        // 2. Comprehensive Indian Holidays for 2026 filter by month
        const major = [
            { m: 0, d: '01', n: 'New Year\'s Day' },
            { m: 0, d: '14', n: 'Makar Sankranti / Pongal' },
            { m: 0, d: '26', n: 'Republic Day' },
            { m: 1, d: '15', n: 'Maha Shivratri' },
            { m: 2, d: '03', n: 'Holi' },
            { m: 2, d: '19', n: 'Gudi Padwa / Ugadi' },
            { m: 2, d: '21', n: 'Eid-ul-Fitr' },
            { m: 2, d: '27', n: 'Ram Navami' },
            { m: 3, d: '03', n: 'Good Friday' },
            { m: 3, d: '14', n: 'Dr. Ambedkar Jayanti' },
            { m: 4, d: '01', n: 'Maharashtra Day / May Day' },
            { m: 5, d: '30', n: 'Eid-ul-Adha' },
            { m: 7, d: '15', n: 'Independence Day' },
            { m: 7, d: '28', n: 'Raksha Bandhan' },
            { m: 8, d: '04', n: 'Janmashtami' },
            { m: 8, d: '15', n: 'Ganesh Chaturthi' },
            { m: 9, d: '02', n: 'Gandhi Jayanti' },
            { m: 9, d: '20', n: 'Dussehra' },
            { m: 10, d: '08', n: 'Diwali' },
            { m: 11, d: '25', n: 'Christmas' }
        ];

        major.filter(h => h.m === month).forEach(h => {
            holidays.push({ date: `${year}-${String(h.m+1).padStart(2, '0')}-${h.d}`, description: h.n });
        });

        if (window.confirm(`Auto-suggest ${holidays.length} holidays for ${months[month]} ${year}?`)) {
            setLoading(true);
            try {
                await attendanceApi.bulkAddHolidays(holidays);
                showSuccess('Success', `Holidays suggested for ${months[month]}`);
                fetchData();
            } catch (err: any) {
                showError('Error', err.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Present': return 'text-green-600 bg-green-50 border-green-100';
            case 'Late Comer': return 'text-orange-600 bg-orange-50 border-orange-100';
            case 'Early Leaver': return 'text-blue-600 bg-blue-50 border-blue-100';
            case 'Half Day': return 'text-amber-600 bg-amber-50 border-amber-100';
            case 'Absent': return 'text-red-500 bg-red-50 border-red-100';
            default: return 'text-gray-400 bg-gray-50 border-gray-100';
        }
    };

    // CALENDAR LOGIC
    const calendarDays = useMemo(() => {
        const year = holidayCalendarDate.getFullYear();
        const month = holidayCalendarDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const days = [];
        // Add empty slots for days before the 1st
        for (let i = 0; i < firstDay; i++) days.push(null);
        // Add all days of the month
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const holiday = holidaysList.find(h => h.holiday_date.split('T')[0] === dateStr);
            days.push({ day: i, dateStr, holiday, isSunday: new Date(year, month, i).getDay() === 0 });
        }
        return days;
    }, [holidayCalendarDate, holidaysList]);

    const changeTodayDate = (days: number) => {
        const current = new Date(todayDate);
        current.setDate(current.getDate() + days);
        setTodayDate(current.toISOString().split('T')[0]);
    };

    const changeMonthly = (delta: number) => {
        let newMonth = monthlyMonth + delta;
        let newYear = monthlyYear;
        if (newMonth > 12) { newMonth = 1; newYear++; }
        if (newMonth < 1) { newMonth = 12; newYear--; }
        setMonthlyMonth(newMonth);
        setMonthlyYear(newYear);
    };

    const filteredToday = todayReport.filter(r => {
        const matchesSearch = r.name.toLowerCase().includes(todaySearch.toLowerCase());
        const matchesStatus = !todayFilter || 
                             (todayFilter === 'Present' && r.checkin_time) ||
                             (todayFilter === 'Absent' && !r.checkin_time) ||
                             (todayFilter === 'Half Day' && r.status === 'Half Day') ||
                             (todayFilter === 'Late Comer' && r.status === 'Late Comer') ||
                             (todayFilter === 'Early Leaver' && r.status === 'Early Leaver');
        return matchesSearch && matchesStatus;
    });

    const filteredMonthly = monthlyReport.filter(r => 
        r.name.toLowerCase().includes(monthlySearch.toLowerCase())
    );

    const handleForceAttendance = async (type: 'checkin' | 'checkout') => {
        if (!forceUser) return;
        setSubmittingForce(true);
        try {
            const payload = {
                userId: forceUser.user_id,
                date: todayDate,
                time: forceTime + ":00",
                lat: 0, lng: 0, address: "Admin Entry"
            };
            const res = type === 'checkin' ? await attendanceApi.forceCheckIn(payload) : await attendanceApi.forceCheckOut(payload);
            showSuccess('Success', res.message);
            setForceUser(null);
            fetchData();
        } catch (err: any) {
            showError('Error', err.message);
        } finally {
            setSubmittingForce(false);
        }
    };

    const openMonthlyDetail = (userRow: any) => {
        const params = new URLSearchParams({
            userId: userRow.user_id,
            name: userRow.name,
            month: String(monthlyMonth),
            year: String(monthlyYear),
        });
        navigate(`/attendance/monthly?${params.toString()}`);
    };

    const [exporting, setExporting] = useState(false);

    const exportMonthlyExcel = async () => {
        setExporting(true);
        try {
            const data = await attendanceApi.getMonthlyExport(monthlyMonth, monthlyYear);
            const { utils, writeFile } = await import('xlsx');

            // Build header rows
            // Row 1: Sr | User Name | date1 | (empty for checkout) | date2 | ...
            // Row 2: (empty) | (empty) | Day | (empty) | Day | ...
            const dates: { date: string; day: string }[] = data.dates;
            const headerRow1: string[] = ['Sr', 'User Name'];
            const headerRow2: string[] = ['', ''];
            for (const d of dates) {
                headerRow1.push(d.date, '');
                headerRow2.push(d.day, '');
            }

            const wsData: any[][] = [headerRow1, headerRow2];

            // Data rows
            for (const row of data.rows) {
                const r: any[] = [row.sr, row.name];
                for (const d of dates) {
                    const att = row.attendance[d.date];
                    r.push(att?.checkin || '-', att?.checkout || '-');
                }
                wsData.push(r);
            }

            const ws = utils.aoa_to_sheet(wsData);

            // Merge date header cells (each date spans 2 columns)
            const merges: any[] = [];
            for (let i = 0; i < dates.length; i++) {
                const col = 2 + i * 2; // starting column for this date
                merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
            }
            ws['!merges'] = merges;

            // Set column widths
            const colWidths: any[] = [{ wch: 4 }, { wch: 18 }];
            for (let i = 0; i < dates.length; i++) {
                colWidths.push({ wch: 10 }, { wch: 10 });
            }
            ws['!cols'] = colWidths;

            const wb = utils.book_new();
            utils.book_append_sheet(wb, ws, 'Attendance');
            writeFile(wb, `Attendance_${months[monthlyMonth - 1]}_${monthlyYear}.xlsx`);
            showSuccess('Exported', 'Excel file downloaded');
        } catch (err: any) {
            showError('Export Failed', err.message || 'Failed to export');
        } finally {
            setExporting(false);
        }
    };

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Helper: normalize date to YYYY-MM-DD string
    const normalizeDate = (d: any): string => {
        if (!d) return '';
        const s = String(d);
        if (s.includes('T')) return s.split('T')[0];
        // Handle Date objects serialized differently
        if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
        // Try parsing as Date
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

    // Compute stats from records - single source for both pills and rows
    const computeMonthlyStats = (records: any[], holidayDatesArr: string[]) => {
        const lastDay = new Date(monthlyYear, monthlyMonth, 0).getDate();
        const holidaySet = new Set((holidayDatesArr || []).map(d => normalizeDate(d)));
        const recordMap: Record<string, any> = {};
        for (const r of records) {
            recordMap[normalizeDate(r.date)] = r;
        }
        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
        let present = 0, absent = 0, halfDay = 0;
        for (let d = 1; d <= lastDay; d++) {
            const ds = `${monthlyYear}-${String(monthlyMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (ds > todayStr) continue;
            const dow = new Date(monthlyYear, monthlyMonth - 1, d).getDay();
            if (dow === 0 || holidaySet.has(ds)) continue;
            const rec = recordMap[ds];
            const status = computeStatus(rec);
            if (status === 'Half Day') halfDay++;
            else if (rec) present++;
            else absent++;
        }
        return { total_days: lastDay, present, absent, half_day: halfDay };
    };

    // SHARED: Render daily attendance rows
    const renderDailyRows = (records: any[], holidayDatesArr: string[], activeFilter: string | null) => {
        const lastDay = new Date(monthlyYear, monthlyMonth, 0).getDate();
        const holidaySet = new Set((holidayDatesArr || []).map(d => normalizeDate(d)));

        // Build record map
        const recordMap: Record<string, any> = {};
        for (const r of records) {
            recordMap[normalizeDate(r.date)] = r;
        }

        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
        const allDays: any[] = [];
        for (let d = lastDay; d >= 1; d--) {
            const dateStr = `${monthlyYear}-${String(monthlyMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (dateStr > todayStr) continue; // Skip future dates
            const record = recordMap[dateStr];
            const dayOfWeek = new Date(monthlyYear, monthlyMonth - 1, d).getDay();
            const isSunday = dayOfWeek === 0;
            const isHoliday = holidaySet.has(dateStr);
            const dayName = new Date(monthlyYear, monthlyMonth - 1, d).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();

            let statusLabel = 'Absent';
            if (isSunday) statusLabel = 'Sunday';
            else if (isHoliday) statusLabel = 'Holiday';
            else statusLabel = computeStatus(record);

            // Filter logic
            if (activeFilter) {
                if (activeFilter === 'Present' && (statusLabel === 'Absent' || statusLabel === 'Sunday' || statusLabel === 'Holiday' || statusLabel === 'Half Day')) continue;
                if (activeFilter === 'Absent' && statusLabel !== 'Absent') continue;
                if (activeFilter === 'Half Day' && statusLabel !== 'Half Day') continue;
            }

            allDays.push({ day: d, dateStr, record, dayName, isSunday, isHoliday, statusLabel });
        }

        const getStatusStyle = (status: string) => {
            switch (status) {
                case 'Present': case 'Late Comer': case 'Early Leaver': return 'bg-emerald-500 text-white';
                case 'Half Day': return 'bg-amber-500 text-white';
                case 'Sunday': return 'bg-orange-500 text-white';
                case 'Holiday': return 'bg-blue-500 text-white';
                default: return 'bg-red-500 text-white';
            }
        };

        return (
            <div className="p-2 md:p-4 space-y-2 md:space-y-0">
                {/* Desktop Table Header */}
                <div className="hidden md:grid md:grid-cols-[60px_70px_1fr_1fr_100px_100px] bg-[#0a1628] text-white text-[12px] font-bold uppercase tracking-wider rounded-t-lg">
                    <div className="px-3 py-3 text-center border-r border-slate-600">Date</div>
                    <div className="px-3 py-3 text-center border-r border-slate-600">Day</div>
                    <div className="px-3 py-3 text-center border-r border-slate-600">Check In</div>
                    <div className="px-3 py-3 text-center border-r border-slate-600">Check Out</div>
                    <div className="px-3 py-3 text-center border-r border-slate-600">Hours</div>
                    <div className="px-3 py-3 text-center">Status</div>
                </div>

                {allDays.length === 0 && (
                    <div className="text-center py-12 text-gray-400 text-[14px] font-semibold">No matching records</div>
                )}

                {allDays.map(({ day, dateStr, record, dayName, isSunday, isHoliday, statusLabel }, idx) => {
                    const statusStyles = getStatusStyle(statusLabel);

                    return (
                        <React.Fragment key={dateStr}>
                            {/* DESKTOP ROW */}
                            <div className={`hidden md:grid md:grid-cols-[60px_70px_1fr_1fr_100px_100px] border-b border-gray-200 text-[14px] font-medium transition-colors ${isSunday ? 'bg-orange-50' : isHoliday ? 'bg-blue-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'} hover:bg-blue-50/50`}>
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
                                    <span className={`text-[11px] font-bold uppercase px-2 py-1 rounded-md ${statusStyles}`}>{statusLabel}</span>
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
        );
    };

    // SHARED: Render detail screen (used by both non-admin view and admin inline view)
    const renderDetailScreen = (userName: string, records: any[], holidayDatesArr: string[], activeFilter: string | null, setFilter: (f: string | null) => void, onBack?: () => void) => {
        const stats = computeMonthlyStats(records, holidayDatesArr);
        return (
            <div className="bg-gray-50 min-h-[400px]">
                {/* DARK HEADER */}
                <div className="bg-gradient-to-r from-[#0a1628] to-[#162544] px-5 py-4 md:px-6 md:py-5 flex justify-between items-center">
                    <div>
                        <h3 className="text-[11px] md:text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1">Monthly Attendance</h3>
                        <div className="text-[18px] md:text-[22px] font-extrabold text-white uppercase leading-tight">{userName}</div>
                        <div className="text-[13px] md:text-[14px] text-slate-300 font-medium mt-0.5">{months[monthlyMonth - 1]} {monthlyYear}</div>
                    </div>
                    {onBack && (
                        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-[12px] font-bold uppercase transition-all">
                            <ChevronLeft className="h-4 w-4" /> Back
                        </button>
                    )}
                </div>

                {/* SUMMARY PILLS */}
                <div className="flex bg-white border-b border-gray-200 divide-x divide-gray-200">
                    {[
                        { label: 'All', value: stats.total_days, filter: null, bg: activeFilter === null ? 'bg-[#0a1628] text-white' : '' },
                        { label: 'Present', value: stats.present, filter: 'Present', color: 'text-green-600', bg: activeFilter === 'Present' ? 'bg-green-50' : '' },
                        { label: 'Absent', value: stats.absent, filter: 'Absent', color: 'text-red-600', bg: activeFilter === 'Absent' ? 'bg-red-50' : '' },
                        { label: 'Half-Day', value: stats.half_day, filter: 'Half Day', color: 'text-amber-600', bg: activeFilter === 'Half Day' ? 'bg-amber-50' : '' },
                    ].map((pill, i) => (
                        <button key={i} onClick={() => setFilter(pill.filter)} className={`flex-1 py-3 text-center transition-all ${pill.bg}`}>
                            <div className={`text-[18px] font-extrabold ${pill.color || 'text-gray-900'}`}>{pill.value}</div>
                            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">{pill.label}</div>
                        </button>
                    ))}
                </div>

                {/* DAILY ROWS */}
                {renderDailyRows(records, holidayDatesArr, activeFilter)}
            </div>
        );
    };

    // NON-ADMIN: Navigate to detail page for own stats
    useEffect(() => {
        if (!isAdmin()) {
            const params = new URLSearchParams({
                userId: user?.id || '',
                name: user?.name || 'Employee',
                month: String(monthlyMonth),
                year: String(monthlyYear),
            });
            navigate(`/attendance/monthly?${params.toString()}`, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!isAdmin()) {
        return null;
    }

    // RENDER HELPERS
    const renderSummary = () => (
        <div className={`flex md:grid md:grid-cols-6 bg-white border border-gray-300 shadow-sm md:divide-x divide-gray-200 overflow-x-auto no-scrollbar`}>
            {[
                { label: 'STAFF', value: todaySummary.total, filter: null },
                { label: 'PRESENT', value: todaySummary.present, filter: 'Present', color: 'text-green-600' },
                { label: 'ABSENT', value: todaySummary.absent, filter: 'Absent', color: 'text-red-600' },
                { label: 'HALF', value: todaySummary.half_day, filter: 'Half Day', color: 'text-amber-600' },
                { label: 'LATE', value: todaySummary.late, filter: 'Late Comer', color: 'text-orange-500' },
                { label: 'EARLY', value: todaySummary.early, filter: 'Early Leaver', color: 'text-blue-500' }
            ].map((kpi, i) => (
                <div 
                    key={i} 
                    onClick={() => setTodayFilter(kpi.filter)} 
                    className={`flex-1 min-w-[80px] md:min-w-0 p-2 text-center cursor-pointer transition-all border-r md:border-r-0 last:border-r-0 border-gray-100 ${todayFilter === kpi.filter ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                >
                    <div className="text-[8px] text-gray-400 font-bold uppercase tracking-tight mb-0.5">{kpi.label}</div>
                    <div className={`text-[13px] font-bold ${kpi.color || 'text-gray-900'}`}>{kpi.value}</div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="bg-[#f2f4f7] min-h-screen font-sans text-gray-800 p-1.5 md:p-4 pb-10">
            <div className="max-w-7xl mx-auto space-y-2 md:space-y-4">
                
                {/* 1. HEADER CONTROLS */}
                <div className="flex flex-col md:flex-row gap-2">
                    <div className="flex-1 bg-white border border-gray-300 flex items-center px-3 py-1.5 w-full shadow-sm">
                        <Search className="h-4 w-4 text-gray-300 mr-2" />
                        <input 
                            type="text" 
                            placeholder={activeTab === 'today' ? "Find staff..." : "Search stats..."}
                            value={activeTab === 'today' ? todaySearch : monthlySearch}
                            onChange={(e) => activeTab === 'today' ? setTodaySearch(e.target.value) : setMonthlySearch(e.target.value)}
                            className="bg-transparent border-none outline-none text-[13px] w-full text-gray-700 font-medium placeholder:text-gray-300"
                        />
                        <button onClick={fetchData}><RefreshCw className={`h-4 w-4 text-blue-500 ${loading ? 'animate-spin' : ''}`} /></button>
                    </div>
                    {activeTab === 'today' && (
                        <div className="flex bg-white border border-gray-300 p-1 items-center gap-1 px-3 shrink-0 shadow-sm">
                            <button onClick={() => changeTodayDate(-1)}><ChevronLeft className="h-4 w-4 text-gray-400"/></button>
                            <div className="flex items-center gap-2 px-4 border-x border-gray-200">
                                <span className="text-[12px] font-bold tabular-nums text-gray-700 uppercase">{todayDate}</span>
                            </div>
                            <button onClick={() => changeTodayDate(1)}><ChevronRight className="h-4 w-4 text-gray-400"/></button>
                        </div>
                    )}
                    {activeTab === 'monthly' && (
                        <div className="flex bg-white border border-gray-300 p-1 items-center gap-1 px-3 shrink-0 shadow-sm">
                            <button onClick={() => changeMonthly(-1)}><ChevronLeft className="h-4 w-4 text-gray-400"/></button>
                            <div className="flex items-center gap-2 px-4 border-x border-gray-200 min-w-[140px] justify-center text-center">
                                <span className="text-[12px] font-bold text-gray-700 uppercase">{months[monthlyMonth-1]} {monthlyYear}</span>
                            </div>
                            <button onClick={() => changeMonthly(1)}><ChevronRight className="h-4 w-4 text-gray-400"/></button>
                        </div>
                    )}
                    {activeTab === 'holidays' && (
                        <div className="flex bg-white border border-gray-300 p-1 items-center gap-1 px-3 shrink-0 shadow-sm">
                             <button onClick={() => setHolidayCalendarDate(new Date(holidayCalendarDate.setMonth(holidayCalendarDate.getMonth() - 1)))}><ChevronLeft className="h-4 w-4 text-gray-400"/></button>
                            <div className="flex items-center gap-2 px-4 border-x border-gray-200 min-w-[140px] justify-center text-center">
                                <span className="text-[12px] font-bold text-gray-700 uppercase">{months[holidayCalendarDate.getMonth()]} {holidayCalendarDate.getFullYear()}</span>
                            </div>
                            <button onClick={() => setHolidayCalendarDate(new Date(holidayCalendarDate.setMonth(holidayCalendarDate.getMonth() + 1)))}><ChevronRight className="h-4 w-4 text-gray-400"/></button>
                        </div>
                    )}
                </div>

                {/* TAB SWITCHER */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex gap-px bg-gray-300 border border-gray-300 w-full md:w-fit overflow-hidden">
                        <button 
                            onClick={() => setActiveTab('today')}
                            className={`flex-1 md:flex-none px-6 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'today' ? 'bg-white text-blue-600' : 'bg-gray-50/80 text-gray-400 hover:bg-white'}`}
                        >
                            Daily Report
                        </button>
                        <button 
                            onClick={() => setActiveTab('monthly')}
                            className={`flex-1 md:flex-none px-6 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'monthly' ? 'bg-white text-blue-600' : 'bg-gray-50/80 text-gray-400 hover:bg-white'}`}
                        >
                            Monthly Stats
                        </button>
                        <button 
                            onClick={() => setActiveTab('holidays')}
                            className={`flex-1 md:flex-none px-6 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'holidays' ? 'bg-white text-blue-600' : 'bg-gray-50/80 text-gray-400 hover:bg-white'}`}
                        >
                            Holidays
                        </button>
                    </div>
                    {activeTab === 'monthly' && (
                        <button
                            onClick={exportMonthlyExcel}
                            disabled={exporting}
                            className="bg-gray-900 text-white px-4 py-2 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600 transition-all shadow-sm disabled:opacity-50"
                        >
                            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Export Excel
                        </button>
                    )}
                    {activeTab === 'holidays' && (
                        <button
                            onClick={autoSuggestHolidays}
                            className="bg-gray-900 text-white px-4 py-2 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600 transition-all shadow-sm"
                        >
                            <Wand2 className="h-3 w-3" /> Auto Suggest Holidays
                        </button>
                    )}
                </div>

                {/* 2. TAB CONTENT */}
                {activeTab === 'today' ? (
                    <div className="space-y-2 md:space-y-4">
                        {renderSummary()}
                        <div className="bg-white border border-gray-300 shadow-sm overflow-hidden min-h-[400px]">
                            {viewMode === 'desktop' ? (
                                <table className="w-full text-left border-collapse table-fixed text-[11px] md:text-sm">
                                    <thead className="bg-[#f2f4f7] border-b border-gray-300">
                                        <tr className="divide-x divide-gray-300">
                                            <th className="px-4 py-2 w-[250px] font-bold text-gray-600 uppercase tracking-tighter">EMPLOYEE</th>
                                            <th className="px-4 py-2 w-[120px] font-bold text-gray-600 uppercase text-center tracking-tighter">IN</th>
                                            <th className="px-4 py-2 w-[120px] font-bold text-gray-600 uppercase text-center tracking-tighter">OUT</th>
                                            <th className="px-4 py-2 w-[120px] font-bold text-gray-600 uppercase text-center tracking-tighter">STATUS</th>
                                            <th className="px-4 py-2 w-[120px] font-bold text-gray-600 uppercase text-right tracking-tighter">ACTION</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-300 text-gray-700">
                                        {filteredToday.map((row) => (
                                            <React.Fragment key={row.user_id}>
                                                <tr
                                                    onClick={() => handleExpandRow(row.user_id, row)}
                                                    className={`divide-x divide-gray-300 cursor-pointer transition-colors ${expandedUserId === row.user_id ? 'bg-blue-50/40' : 'hover:bg-blue-50/10'}`}
                                                >
                                                    <td className="px-4 py-1.5 font-bold uppercase truncate">
                                                        <span className="flex items-center gap-1.5">
                                                            {expandedUserId === row.user_id ? <ChevronUp className="h-3 w-3 text-blue-400 shrink-0" /> : <ChevronDown className="h-3 w-3 text-gray-300 shrink-0" />}
                                                            {row.name}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-1.5 text-center tabular-nums">{row.checkin_time || '-'}</td>
                                                    <td className="px-4 py-1.5 text-center tabular-nums">{row.checkout_time || '-'}</td>
                                                    <td className="px-4 py-1.5 text-center">
                                                        <span className={`px-2 py-0.5 text-[8px] font-black uppercase border ${getStatusColor(row.status)}`}>
                                                            {row.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-1.5 text-right">
                                                        <div className="flex gap-3 justify-end items-center" onClick={(e) => e.stopPropagation()}>
                                                            <Navigation onClick={() => navigate(`/network?user=${row.user_id}&date=${todayDate}`)} className="h-3.5 w-3.5 text-blue-500 cursor-pointer" />
                                                            <Zap onClick={() => { setForceUser(row); setForceTime(new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())); }} className="h-3.5 w-3.5 text-red-500 cursor-pointer" />
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedUserId === row.user_id && (
                                                    <tr className="bg-gray-50/80">
                                                        <td colSpan={5} className="px-6 py-3">
                                                            <div className="flex flex-col md:flex-row gap-4 text-[11px]">
                                                                <div className="flex-1 flex items-start gap-2">
                                                                    <MapPin className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                                                                    <div>
                                                                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Check-in Location</div>
                                                                        <div className="text-gray-700 font-medium">
                                                                            {geocodedAddresses[row.user_id]?.checkin || row.checkin_address || 'No location recorded'}
                                                                        </div>
                                                                        {!geocodedAddresses[row.user_id]?.checkin && row.checkin_latitude && (
                                                                            <span className="text-[9px] text-gray-400 italic">Resolving address...</span>
                                                                        )}
                                                                        {row.checkin_latitude && row.checkin_longitude && (
                                                                            <a href={`https://www.google.com/maps?q=${row.checkin_latitude},${row.checkin_longitude}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[9px] text-blue-500 hover:underline mt-0.5 inline-block">View on Map</a>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="flex-1 flex items-start gap-2">
                                                                    <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                                                    <div>
                                                                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Check-out Location</div>
                                                                        <div className="text-gray-700 font-medium">
                                                                            {geocodedAddresses[row.user_id]?.checkout || row.checkout_address || 'Not checked out yet'}
                                                                        </div>
                                                                        {!geocodedAddresses[row.user_id]?.checkout && row.checkout_latitude && (
                                                                            <span className="text-[9px] text-gray-400 italic">Resolving address...</span>
                                                                        )}
                                                                        {row.checkout_latitude && row.checkout_longitude && (
                                                                            <a href={`https://www.google.com/maps?q=${row.checkout_latitude},${row.checkout_longitude}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[9px] text-blue-500 hover:underline mt-0.5 inline-block">View on Map</a>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="divide-y divide-gray-200">
                                    {filteredToday.map((row) => (
                                        <div key={row.user_id}>
                                            <div
                                                onClick={() => handleExpandRow(row.user_id, row)}
                                                className={`p-3 flex items-center justify-between cursor-pointer ${expandedUserId === row.user_id ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}
                                            >
                                                <div className="flex-1 min-w-0 pr-2">
                                                    <div className="text-[12px] font-black uppercase truncate text-gray-900">{row.name}</div>
                                                    <div className="flex gap-4 mt-1">
                                                        <div className="text-[10px] text-gray-400 font-bold uppercase"><span className="text-gray-300 font-bold">IN</span> {row.checkin_time || '--:--'}</div>
                                                        <div className="text-[10px] text-gray-400 font-bold uppercase"><span className="text-gray-300 font-bold">OUT</span> {row.checkout_time || '--:--'}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className={`px-1.5 py-0.5 text-[8px] font-black uppercase border ${getStatusColor(row.status)}`}>
                                                        {row.status}
                                                    </span>
                                                    <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
                                                        <Navigation onClick={() => navigate(`/network?user=${row.user_id}&date=${todayDate}`)} className="h-4 w-4 text-blue-500" />
                                                        <Zap onClick={() => { setForceUser(row); setForceTime(new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())); }} className="h-4 w-4 text-red-500" />
                                                    </div>
                                                </div>
                                            </div>
                                            {expandedUserId === row.user_id && (
                                                <div className="px-4 pb-3 pt-1 bg-gray-50/80 space-y-2">
                                                    <div className="flex items-start gap-2">
                                                        <MapPin className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                                                        <div>
                                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Check-in</div>
                                                            <div className="text-[11px] text-gray-700 font-medium">
                                                                {geocodedAddresses[row.user_id]?.checkin || row.checkin_address || 'No location recorded'}
                                                            </div>
                                                            {!geocodedAddresses[row.user_id]?.checkin && row.checkin_latitude && (
                                                                <span className="text-[9px] text-gray-400 italic">Resolving address...</span>
                                                            )}
                                                            {row.checkin_latitude && row.checkin_longitude && (
                                                                <a href={`https://www.google.com/maps?q=${row.checkin_latitude},${row.checkin_longitude}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 inline-block">View on Map</a>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-start gap-2">
                                                        <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                                        <div>
                                                            <div className="text-[9px] font-bold text-gray-400 uppercase">Check-out</div>
                                                            <div className="text-[11px] text-gray-700 font-medium">
                                                                {geocodedAddresses[row.user_id]?.checkout || row.checkout_address || 'Not checked out yet'}
                                                            </div>
                                                            {!geocodedAddresses[row.user_id]?.checkout && row.checkout_latitude && (
                                                                <span className="text-[9px] text-gray-400 italic">Resolving address...</span>
                                                            )}
                                                            {row.checkout_latitude && row.checkout_longitude && (
                                                                <a href={`https://www.google.com/maps?q=${row.checkout_latitude},${row.checkout_longitude}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline mt-0.5 inline-block">View on Map</a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : activeTab === 'monthly' ? (
                    <div className="space-y-4">
                        <div className="bg-white border border-gray-300 shadow-sm overflow-hidden min-h-[400px]">
                            {viewMode === 'desktop' ? (
                                <table className="w-full text-left border-collapse table-fixed text-[11px] md:text-sm">
                                    <thead className="bg-[#f2f4f7] border-b border-gray-300">
                                        <tr className="divide-x divide-gray-300">
                                            <th className="px-4 py-2 w-[220px] font-bold text-gray-600 uppercase">EMPLOYEE</th>
                                            <th className="px-4 py-2 w-[90px] font-bold text-center text-green-600 uppercase" title="Sum of On Time + Late + Early + Half Day">PRESENT</th>
                                            <th className="px-4 py-2 w-[90px] font-bold text-center text-emerald-600 uppercase" title="Came on time AND stayed full day">ON TIME</th>
                                            <th className="px-4 py-2 w-[90px] font-bold text-center text-amber-600 uppercase" title="Checked in after 10:10 AM (full day)">LATE</th>
                                            <th className="px-4 py-2 w-[90px] font-bold text-center text-orange-600 uppercase" title="Left between 2:00 and 6:20 PM">EARLY</th>
                                            <th className="px-4 py-2 w-[100px] font-bold text-center text-purple-600 uppercase" title="Left before 2 PM, after 11 PM, or auto-midnight">HALF DAY</th>
                                            <th className="px-4 py-2 w-[90px] font-bold text-center text-red-600 uppercase">ABSENT</th>
                                            <th className="px-4 py-2 w-[100px] font-bold text-center text-blue-600 uppercase">HOLIDAYS</th>
                                            <th className="px-4 py-2 w-[70px] font-bold text-right text-gray-400 uppercase">VIEW</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-300">
                                        {filteredMonthly.map((row) => (
                                            <tr key={row.user_id} className="divide-x divide-gray-300 hover:bg-gray-50 cursor-pointer" onClick={() => openMonthlyDetail(row)}>
                                                <td className="px-4 py-1.5 font-bold uppercase text-gray-900 truncate">{row.name}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-green-700 tabular-nums">{row.total_present || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-emerald-700 tabular-nums">{row.total_on_time || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-amber-700 tabular-nums">{row.total_late || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-orange-700 tabular-nums">{row.total_early || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-purple-700 tabular-nums">{row.total_half_day || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-red-700 tabular-nums">{row.total_absent || 0}</td>
                                                <td className="px-4 py-1.5 text-center font-bold text-blue-700 tabular-nums">{row.total_holiday || 0}</td>
                                                <td className="px-4 py-1.5 text-right">
                                                    <button className="text-[10px] font-black text-blue-500 hover:underline">MTD</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="divide-y divide-gray-200">
                                    {filteredMonthly.map((row) => (
                                        <div key={row.user_id} className="p-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer" onClick={() => openMonthlyDetail(row)}>
                                            <div className="flex-1 min-w-0 pr-4">
                                                <div className="text-[12px] font-black uppercase truncate text-gray-900">{row.name}</div>
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                                    <div className="text-[10px] text-emerald-600 font-bold uppercase"><span className="text-gray-300">OT:</span> {row.total_on_time || 0}</div>
                                                    <div className="text-[10px] text-amber-600 font-bold uppercase"><span className="text-gray-300">L:</span> {row.total_late || 0}</div>
                                                    <div className="text-[10px] text-orange-600 font-bold uppercase"><span className="text-gray-300">E:</span> {row.total_early || 0}</div>
                                                    <div className="text-[10px] text-purple-600 font-bold uppercase"><span className="text-gray-300">HD:</span> {row.total_half_day || 0}</div>
                                                    <div className="text-[10px] text-red-500 font-bold uppercase"><span className="text-gray-300">A:</span> {row.total_absent || 0}</div>
                                                    <div className="text-[10px] text-blue-500 font-bold uppercase"><span className="text-gray-300">H:</span> {row.total_holiday || 0}</div>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-black text-blue-500 border border-blue-50 px-2 py-1 uppercase tracking-tighter">MTD</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="bg-white border border-gray-300 shadow-sm p-4 max-w-5xl mx-auto">
                        <div className="grid grid-cols-7 border-t border-l border-gray-200 shadow-sm">
                            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
                                <div key={d} className="bg-[#f2f4f7] p-2 text-center text-[9px] font-black uppercase text-gray-500 border-r border-b border-gray-200">{d}</div>
                            ))}
                            {calendarDays.map((d, i) => (
                                <div 
                                    key={i} 
                                    onClick={() => {
                                        if (d) {
                                            setSelectedDateForModal(d.dateStr);
                                            setHolidayDescModal(d.holiday?.description || '');
                                        }
                                    }}
                                    className={`relative min-h-[60px] md:min-h-[85px] p-2 border-r border-b border-gray-100 cursor-pointer hover:bg-blue-50/20 transition-all ${!d ? 'bg-gray-50/50' : ''} ${d?.holiday ? 'bg-blue-50/40' : d?.isSunday ? 'bg-orange-50/30' : ''}`}
                                >
                                    {d && (
                                        <>
                                            <div 
                                                style={{ fontFamily: "'Roboto', sans-serif" }}
                                                className={`text-[24px] font-bold tracking-tighter leading-none mb-1 ${d.isSunday ? 'text-orange-500' : 'text-gray-300'}`}
                                            >
                                                {d.day}
                                            </div>
                                            {d.holiday && (
                                                <div className="mt-1">
                                                    <div className="bg-blue-600 text-white text-[8px] font-black uppercase px-1 py-0.5 rounded-px truncate leading-tight shadow-sm">
                                                        {d.holiday.description || 'HOLIDAY'}
                                                    </div>
                                                </div>
                                            )}
                                            {d.isSunday && !d.holiday && <div className="text-[7px] font-bold text-orange-300 uppercase">Sunday</div>}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-4 text-[9px] font-bold uppercase text-gray-400">
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-blue-500"></div> Holiday Mark</div>
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-orange-100"></div> Weekend</div>
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 border border-gray-200"></div> Regular Day</div>
                        </div>
                    </div>
                )}

            </div>


            {selectedDateForModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
                    <div className="bg-white border border-gray-300 w-full max-w-sm shadow-2xl overflow-hidden">
                        <div className="bg-[#f2f4f7] px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <div>
                                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">SET HOLIDAY</h3>
                                <div className="text-xl font-black text-gray-900 tabular-nums">{selectedDateForModal}</div>
                            </div>
                            <button onClick={() => setSelectedDateForModal(null)} className="p-2 hover:bg-gray-200 rounded-full transition-all"><X className="h-5 w-5 text-gray-400"/></button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <label className="text-[9px] font-bold text-gray-400 uppercase mb-2 block tracking-widest">Reason / Occasion</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. Diwali, Holi, Sunday"
                                    value={holidayDescModal}
                                    onChange={(e) => setHolidayDescModal(e.target.value)}
                                    autoFocus
                                    className="w-full bg-gray-50 border border-gray-200 p-3 text-[14px] font-bold outline-none focus:border-blue-500 focus:bg-white transition-all"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleRemoveHoliday(selectedDateForModal)}
                                    className="flex-1 border border-red-500 text-red-500 py-3 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition-all"
                                >
                                    Unmark
                                </button>
                                <button 
                                    onClick={handleAddHoliday}
                                    disabled={submittingHoliday}
                                    className="flex-[2] bg-blue-600 text-white py-3 text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
                                >
                                    Save Holiday
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* FORCE ATTENDANCE MODAL */}
            {forceUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/10 backdrop-blur-sm">
                    <div className="bg-white border border-gray-300 p-6 w-full max-w-xs shadow-2xl">
                        <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-2">
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Override</h3>
                            <button onClick={() => setForceUser(null)}><X className="h-4 w-4 text-gray-300"/></button>
                        </div>
                        <div className="mb-8 p-6 bg-gray-50 border border-gray-100 text-center">
                            <input type="time" value={forceTime} onChange={(e) => setForceTime(e.target.value)} className="w-full text-5xl font-light text-center bg-transparent border-none outline-none text-gray-800 tabular-nums"/>
                        </div>
                        <div className="grid grid-cols-2 gap-px bg-gray-200 border border-gray-200 overflow-hidden shadow-sm">
                            <button onClick={() => handleForceAttendance('checkin')} disabled={submittingForce} className="py-4 bg-white text-gray-800 font-bold text-[10px] uppercase tracking-widest hover:bg-gray-900 hover:text-white transition-all">In</button>
                            <button onClick={() => handleForceAttendance('checkout')} disabled={submittingForce} className="py-4 bg-white text-gray-800 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all">Out</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AttendanceHistory;
