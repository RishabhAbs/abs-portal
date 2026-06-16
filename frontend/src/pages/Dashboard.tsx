import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { authApi, attendanceApi, serviceCallsApi, dashboardApi, targetsApi, usersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import {
  Server, Building2, Link2, AlertCircle, Activity,
  Users, CheckCircle, TrendingUp, TrendingDown, DollarSign, MapPin, LogOut, Clock, RefreshCw,
  PhoneCall, UserPlus, FileText, ChevronRight, X, Target, Award, AlertTriangle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/dateUtils';

const TARGET_CATEGORIES: { key: string; label: string }[] = [
  { key: 'new_target', label: 'NEW' },
  { key: 'tss',        label: 'TSS' },
  { key: 'cloud',      label: 'CLOUD' },
  { key: 'tdl',        label: 'TDL' },
  { key: 'visit',      label: 'VISIT' },
  { key: 'call',       label: 'CALL' },
];

function currentFY() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

function fmtTargetValue(val: number, unit: string): string {
  if (!val) return '0';
  if (unit === 'amount') {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000)   return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000)     return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val}`;
  }
  return String(val);
}

const Dashboard: React.FC = () => {
  const { user, isAdmin, canView, canCheckPermission, logout } = useAuth();
  const admin = isAdmin();
  const canViewAllService = admin || canCheckPermission('service_calls', 'view_all');
  const canViewAllLeads = admin || canCheckPermission('leads', 'view_all');

  const { showSuccess, showError } = useToast();
  const [attendanceStatus, setAttendanceStatus] = useState<'Pending' | 'Checked In' | 'Checked Out'>('Pending');
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [showCheckInPopup, setShowCheckInPopup] = useState(false);
  const [showCheckOutConfirm, setShowCheckOutConfirm] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [liveUsersCount, setLiveUsersCount] = useState(0);

  // Dashboard summary stats
  const [dashStats, setDashStats] = useState<any>(null);

  // Operations Snapshot — expiry × grade × segment + customer movement.
  // Loaded once on mount; admins always see it, regular users get a
  // tighter "my activity" mode (we just show movement, not company-wide
  // expiry numbers).
  const [opsSnapshot, setOpsSnapshot] = useState<any>(null);

  // Module stats
  const [serviceStats, setServiceStats] = useState<any>(null);
  const [leadStats, setLeadStats] = useState<any>(null);

  // Targets (user-scoped): actuals + plans from my-performance, unit types from targets
  const [perf, setPerf] = useState<any>(null);
  const [targetUnitTypes, setTargetUnitTypes] = useState<Record<string, string>>({});
  const fy = useMemo(() => currentFY(), []);

  // Admin target rollup (used to derive company-wide numbers into perfForUI)
  const [adminPerf, setAdminPerf] = useState<any>(null);

  // Admin: filter targets by specific user
  const [targetUserFilter, setTargetUserFilter] = useState<string>('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [filteredUserPerf, setFilteredUserPerf] = useState<any>(null);

  // Pending by user (admin only)
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [showPendingTable, setShowPendingTable] = useState(false);
  const [pendingPopup, setPendingPopup] = useState<{ type: string; user: string; label: string } | null>(null);
  const [pendingDetail, setPendingDetail] = useState<{ today: any[]; yesterday: any[]; older: any[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const staffFilter = admin ? '' : (user?.name || '');

  useEffect(() => {
    dashboardApi.getStats().then(res => { if (res?.data) setDashStats(res.data); }).catch(() => {});
    dashboardApi.getOperationsSnapshot()
      .then(res => { if (res?.data) setOpsSnapshot(res.data); })
      .catch(() => {});
    dashboardApi.getPendingUsers()
      .then(res => { if (res?.data) setPendingUsers(res.data); })
      .catch(() => {});
    if (admin) {
      authApi.getActiveSessions()
        .then(data => setLiveUsersCount(data.count))
        .catch(() => setLiveUsersCount(0));
    }
    attendanceApi.getStatus().then(res => {
      setAttendanceStatus(res.status as any);
      if (res.status === 'Pending') setShowCheckInPopup(true);
      if (res.checkin) {
        const timeStr = new Date(res.checkin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setCheckInTime(timeStr);
      }
    }).catch(() => {});

    // Targets (actuals + plans) for the logged-in user
    if (user?.name) {
      dashboardApi.myPerformance(user.name, fy)
        .then(res => setPerf(res?.data || null))
        .catch(() => setPerf(null));
      targetsApi.getUnitTypes(fy, user.name)
        .then(res => setTargetUnitTypes(res?.data || {}))
        .catch(() => setTargetUnitTypes({}));
    }

    if (admin) {
      dashboardApi.adminPerformance(fy)
        .then(res => setAdminPerf(res?.data || null))
        .catch(() => setAdminPerf(null));
      usersApi.getBasic()
        .then((res: any) => setAllUsers(Array.isArray(res) ? res : res?.data || []))
        .catch(() => setAllUsers([]));
    }
  }, [user, fy, admin]);

  // Re-fetch when admin picks a specific user to view targets for
  useEffect(() => {
    if (admin && targetUserFilter) {
      dashboardApi.myPerformance(targetUserFilter, fy)
        .then(res => setFilteredUserPerf(res?.data || null))
        .catch(() => setFilteredUserPerf(null));
    } else {
      setFilteredUserPerf(null);
    }
  }, [admin, targetUserFilter, fy]);

  useEffect(() => {
    if (showCheckInPopup && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setUserLocation(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, [showCheckInPopup]);

  // Fetch service & lead stats
  useEffect(() => {
    const fetchModuleStats = async () => {
      try {
        const [svc, lead] = await Promise.all([
          serviceCallsApi.getStats(undefined, undefined, staffFilter, 'Service').catch(() => null),
          serviceCallsApi.getStats(undefined, undefined, staffFilter, 'Lead').catch(() => null),
        ]);
        if (svc?.data) setServiceStats(svc.data);
        if (lead?.data) setLeadStats(lead.data);
      } catch {}
    };
    fetchModuleStats();
  }, [staffFilter]);

  const openPendingDetail = async (type: string, user: string, label: string) => {
    setPendingPopup({ type, user, label });
    setPendingDetail(null);
    setLoadingDetail(true);
    try {
      const res = await dashboardApi.getPendingDetail(type, user);
      if (res?.data) setPendingDetail(res.data);
    } catch {}
    finally { setLoadingDetail(false); }
  };

  const handleAttendance = async (type: 'checkin' | 'checkout') => {
    if (!navigator.geolocation) { showError('Error', 'Geolocation not supported'); return; }
    setLoadingAttendance(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          if (type === 'checkin') {
            const res = await attendanceApi.checkIn(latitude, longitude);
            showSuccess('Checked In', `Welcome to ${res.office}`);
            setAttendanceStatus('Checked In');
            setCheckInTime(new Date().toLocaleTimeString());
            setShowCheckInPopup(false);
          } else {
            const res = await attendanceApi.checkOut(latitude, longitude);
            showSuccess('Checked Out', res.message);
            setAttendanceStatus('Checked Out');
            setTimeout(() => logout(), 1500);
          }
        } catch (err: any) {
          showError('Attendance Error', err.message || 'Failed');
        } finally { setLoadingAttendance(false); }
      },
      () => { showError('Location Error', 'Unable to retrieve location.'); setLoadingAttendance(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const activeServers = Number(dashStats?.servers?.active ?? 0);
  const inactiveServers = Number(dashStats?.servers?.inactive ?? 0);
  const totalServers = Number(dashStats?.servers?.total ?? 0);
  const activeCustomers = Number(dashStats?.customers?.active ?? 0);
  const totalCustomers = Number(dashStats?.customers?.total ?? 0);
  const activeMappings = Number(dashStats?.mappings?.active ?? 0);
  const totalMappings = Number(dashStats?.mappings?.total ?? 0);
  const unmappedCount = Number(dashStats?.mappings?.unmapped ?? 0);
  const totalActivities = Number(dashStats?.revenue?.totalActivities ?? 0);
  const totalRevenue = Number(dashStats?.revenue?.totalRevenue ?? 0);
  const taxInvoiceRevenue = Number(dashStats?.revenue?.byType?.taxInvoice ?? 0);
  const creditNoteAmount = Math.abs(Number(dashStats?.revenue?.byType?.creditNote ?? 0));
  const currentMonthRevenue = Number(dashStats?.revenue?.currentMonth ?? 0);
  const recentActivities: any[] = dashStats?.recentActivities ?? [];

  const fc = (amt: number) => `₹${Math.abs(Number(amt) || 0).toLocaleString('en-IN')}`;

  // Unify admin and user targets into one panel. For users, source is `perf`
  // (per-user metrics from /dashboard/my-performance). For admins, we reshape
  // `adminPerf` (company rollup) into the same { metrics: {cat: {mtd:{actual,plan}}} }
  // contract so the same JSX renders both. Numbers for admins are the sum
  // across all users per category per period.
  const perfForUI = useMemo(() => {
    if (!admin) return perf;
    // Admin filtered by a specific user → show that user's actuals (same shape as `perf`)
    if (targetUserFilter && filteredUserPerf) return filteredUserPerf;
    if (!adminPerf?.categories) return null;
    const metrics: any = {};
    for (const c of adminPerf.categories) {
      metrics[c.key] = {
        today: 0,
        mtd: { actual: Number(c.mtd?.total_actual || 0), plan: Number(c.mtd?.total_plan || 0) },
        qtd: { actual: Number(c.qtd?.total_actual || 0), plan: Number(c.qtd?.total_plan || 0) },
        fy:  { actual: Number(c.fy?.total_actual  || 0), plan: Number(c.fy?.total_plan  || 0) },
      };
    }
    return { activation_today: 0, metrics };
  }, [admin, perf, adminPerf, targetUserFilter, filteredUserPerf]);

  // Unit types: per-user for users; majority-per-category across users for admin.
  // When users in a category disagree on unit (qty vs amount), we pick whichever
  // is used by more plan-holders; default 'qty'.
  const unitsForUI = useMemo<Record<string, string>>(() => {
    if (!admin) return targetUnitTypes;
    const users: any[] = adminPerf?.users || [];
    const keys = ['new_target','tss','cloud','tdl','app','visit','call'] as const;
    const out: Record<string, string> = {};
    for (const k of keys) {
      let qty = 0, amt = 0;
      for (const u of users) {
        const b = u?.breakdown?.[k];
        if (!b) continue;
        const hasPlan = (b.mtd?.plan || 0) + (b.qtd?.plan || 0) + (b.fy?.plan || 0) > 0;
        if (!hasPlan) continue;
        if (b.unit === 'amount') amt++; else qty++;
      }
      out[k] = amt > qty ? 'amount' : 'qty';
    }
    return out;
  }, [admin, targetUnitTypes, adminPerf]);

  // Read actual/plan from the active perf source; returns {actual, plan} per (category, period)
  const getAP = (catKey: string, period: 'mtd' | 'qtd' | 'fy') => {
    const m = perfForUI?.metrics?.[catKey]?.[period];
    return { actual: Number(m?.actual || 0), plan: Number(m?.plan || 0) };
  };
  const getToday = (catKey: string) => Number(perfForUI?.metrics?.[catKey]?.today || 0);

  const greeting = () => {
    const h = parseInt(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
    if (h < 12) return 'Good morning'; if (h < 17) return 'Good afternoon'; return 'Good evening';
  };

  const StatCard = ({ title, value, subtext, icon: Icon, color, link, trend }: any) => (
    <Link to={link} className="bg-white border border-gray-200 p-5 rounded-lg hover:shadow-md transition-shadow group relative overflow-hidden">
      <div className={`absolute top-0 right-0 w-16 h-16 bg-${color}-50 rounded-bl-3xl -mr-2 -mt-2 transition-transform group-hover:scale-110`} />
      <div className="relative">
        <div className="flex justify-between items-start mb-3">
          <div className={`p-2 bg-${color}-50 rounded-lg text-${color}-600`}><Icon className="h-5 w-5" /></div>
          {trend !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${trend > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {trend > 0 ? <TrendingUp className="h-3 w-3" /> : null}
              {trend > 0 ? `+${trend}` : 'No change'} <span className="hidden sm:inline">this month</span>
            </div>
          )}
        </div>
        <div className="mt-2">
          <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
          <p className="text-sm font-medium text-gray-500 mt-0.5">{title}</p>
        </div>
        {subtext && <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">{subtext}</div>}
      </div>
    </Link>
  );

  // Module card: Service / Lead / Task
  const ModuleCard = ({ title, icon: Icon, color, pills, link }: {
    title: string; icon: any; color: string; pills: { label: string; value: number; bg: string; text: string }[]; link: string;
  }) => (
    <Link to={link} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 bg-${color}-50 rounded-lg text-${color}-600`}><Icon className="h-4 w-4" /></div>
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
        </div>
        <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
      </div>
      <div className="flex gap-2">
        {pills.map(p => (
          <div key={p.label} className={`flex-1 text-center py-2 px-1 rounded-lg ${p.bg}`}>
            <div className={`text-lg font-bold ${p.text}`}>{p.value}</div>
            <div className="text-[10px] font-medium text-gray-500 mt-0.5">{p.label}</div>
          </div>
        ))}
      </div>
    </Link>
  );

  return (
    // Use the full viewport from lg+ (1024 px) so the 3-column dashboard
    // works on standard 1366 / 1440 laptops too. Mobile / tablet keep the
    // comfortable max-w-5xl reading width. Page padding shrinks at lg+.
    <div className="space-y-3 max-w-5xl lg:max-w-none mx-auto px-4 sm:px-6 lg:px-3 pt-3 pb-10">

      {/* Three-column dashboard from lg+ (1024 px) so 1366×768 / 1440×900
            laptops get the dense view too. Below lg everything stacks.
            `items-start` keeps each column anchored to the top regardless
            of how tall its siblings grow. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 items-start">

      {/* Targets — same layout for everyone. For admin, numbers are the sum across
          all users; for regular users, they're personal actuals vs personal plans. */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-200 bg-violet-50/50 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <Target className="h-3.5 w-3.5 text-violet-600" />
            <h3 className="font-semibold text-gray-900 text-sm truncate">
              {admin ? (targetUserFilter ? `Targets — ${targetUserFilter}` : 'Company Targets') : 'My Targets'}
            </h3>
            <span className="text-[10px] font-medium text-gray-500">FY {fy}</span>
            {admin && (
              <select
                value={targetUserFilter}
                onChange={e => setTargetUserFilter(e.target.value)}
                className="ml-1 px-1.5 py-0.5 text-[11px] border border-violet-200 rounded bg-white focus:ring-2 focus:ring-violet-200 outline-none"
                title="Filter targets by user"
              >
                <option value="">All Users</option>
                {allUsers.map((u: any) => (
                  <option key={u.id} value={u.name}>{u.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">Today</span>
            <span className="text-xs font-bold text-gray-900">₹{(perfForUI?.activation_today || 0).toLocaleString('en-IN')}</span>
            <Link to="/targets" className="text-[10px] font-medium text-violet-700 hover:underline">Manage</Link>
          </div>
        </div>
        {/* Compressed layout: smaller padding, tighter cell internals,
            and a 1-line value/plan/% so 7 categories fit in roughly the
            same vertical space as ~3 used to, keeping the dashboard
            above the fold even on a 1080p screen. */}
        <div className="p-2.5 space-y-2">
          {TARGET_CATEGORIES.map(cat => {
            const unit = unitsForUI[cat.key] || 'qty';
            const todayVal = getToday(cat.key);
            const showTodayHeader = cat.key === 'new_target' || cat.key === 'tss';
            return (
              <div key={cat.key}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-2">
                  <span>{cat.label}{showTodayHeader ? ' Today' : ''}</span>
                  {showTodayHeader && <span className="text-gray-700 normal-case font-semibold">{fmtTargetValue(todayVal, unit)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['mtd', 'qtd', 'fy'] as const).map(period => {
                    const { actual, plan } = getAP(cat.key, period);
                    const hasAny = actual > 0 || plan > 0;
                    return (
                      <div key={period} className="border border-gray-200 rounded p-1.5 bg-gray-50/50">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-[9px] font-bold text-gray-500 uppercase">{period}</span>
                          {plan > 0 && <span className="text-[9px] font-semibold text-gray-500">{Math.min(Math.round((actual / plan) * 100), 999)}%</span>}
                        </div>
                        <div className={`text-sm font-bold leading-tight ${hasAny ? 'text-gray-900' : 'text-gray-300'}`}>
                          {hasAny ? fmtTargetValue(actual, unit) : '—'}
                        </div>
                        <div className="text-[9px] text-gray-400 leading-tight">Plan: {fmtTargetValue(plan, unit)}</div>
                        {hasAny && (() => {
                          const pct = plan > 0 ? Math.min((actual / plan) * 100, 100) : (actual > 0 ? 100 : 0);
                          const barColor = plan === 0
                            ? 'bg-gray-300'
                            : pct >= 100 ? 'bg-emerald-500'
                            : pct >= 60  ? 'bg-amber-400'
                            : 'bg-red-400';
                          return (
                            <div className="mt-1 h-0.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Work Table — inline */}
      {(
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 bg-amber-50/50 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <h3 className="font-semibold text-gray-900 text-sm">{admin ? 'Pending Work' : 'My Pending Work'}</h3>
            {admin && pendingUsers.length > 0 && (
              <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{pendingUsers.length} users</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-[10px] text-gray-500 uppercase">
                  {(admin || pendingUsers.length > 1) && <th className="px-2 py-1.5 text-left">User</th>}
                  <th className="px-2 py-1.5 text-center">Service</th>
                  <th className="px-2 py-1.5 text-center">Task</th>
                  <th className="px-2 py-1.5 text-center">Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingUsers.length === 0 ? (
                  <tr><td colSpan={admin || pendingUsers.length > 1 ? 4 : 3} className="px-2 py-6 text-center text-gray-400 text-xs">No pending work</td></tr>
                ) : pendingUsers.map(u => (
                  <tr key={u.user_name} className="hover:bg-gray-50">
                    {(admin || pendingUsers.length > 1) && (
                      <td className="px-2 py-1 font-medium text-gray-800 truncate max-w-[120px]">
                        {u.user_name === user?.name ? 'My Pending' : u.user_name}
                      </td>
                    )}
                    <td className="px-2 py-1 text-center">
                      {u.service > 0
                        ? <button onClick={() => openPendingDetail('service', u.user_name, 'Service')}
                            className="inline-block min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 hover:bg-blue-200">{u.service}</button>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {u.task > 0
                        ? <button onClick={() => openPendingDetail('task', u.user_name, 'Task')}
                            className="inline-block min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 hover:bg-orange-200">{u.task}</button>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {u.lead > 0
                        ? <button onClick={() => openPendingDetail('lead', u.user_name, 'Lead')}
                            className="inline-block min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700 hover:bg-violet-200">{u.lead}</button>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending Detail Popup */}
      {pendingPopup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">{pendingPopup.label} — {pendingPopup.user}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Pending items breakdown</p>
              </div>
              <button onClick={() => { setPendingPopup(null); setPendingDetail(null); }}
                className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {loadingDetail ? (
                <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
              ) : pendingDetail ? (
                <>
                  {(['today', 'yesterday', 'older'] as const).map(bucket => {
                    const rows = pendingDetail[bucket];
                    const label = bucket === 'today' ? 'Today' : bucket === 'yesterday' ? 'Yesterday' : 'Before Yesterday';
                    const color = bucket === 'today' ? 'text-red-600 bg-red-50 border-red-100'
                      : bucket === 'yesterday' ? 'text-amber-600 bg-amber-50 border-amber-100'
                      : 'text-gray-500 bg-gray-50 border-gray-100';
                    return (
                      <div key={bucket}>
                        <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-2 px-2 py-1 rounded border ${color}`}>
                          {label} <span className="ml-auto font-bold">{rows.length}</span>
                        </div>
                        {rows.length === 0 ? (
                          <p className="text-xs text-gray-400 italic px-2">None</p>
                        ) : (
                          <div className="space-y-1.5">
                            {rows.map((r: any) => (
                              <div key={r.id} className="px-3 py-2 bg-gray-50 rounded border border-gray-100 text-sm">
                                <div className="font-medium text-gray-800">{r.company || r.customer_name || r.content || '—'}</div>
                                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                                  {r.service_type && <span>{r.service_type}</span>}
                                  {r.lead_type && <span className="text-violet-600">{r.lead_type}</span>}
                                  {r.dev_status && <span className="text-blue-500">{r.dev_status}</span>}
                                  {r.priority && <span className={r.priority === 'High' ? 'text-red-600 font-semibold' : 'text-gray-500'}>{r.priority}</span>}
                                  {r.status && <span className={r.status === 'Open' ? 'text-blue-600' : 'text-amber-600'}>{r.status}</span>}
                                  {r.deadline && <span className="text-red-500">Due: {String(r.deadline).slice(0, 10)}</span>}
                                  <span className="text-gray-400">{String(r.created_at || '').slice(0, 10)}</span>
                                </div>
                                {(r.remark || r.customer_name) && <div className="text-xs text-gray-400 mt-0.5 truncate">{r.remark || r.customer_name}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="text-center py-10 text-gray-400 text-sm">No data</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Operations Snapshot — admin-only dense KPI grid. Mirrors the PHP
          dashboard: 3 expiry buckets × Our/Other × Silver/Gold/Auditor +
          3 customer-movement cards. */}
      {admin && opsSnapshot && (
        <OperationsSnapshot data={opsSnapshot} />
      )}

      </div>{/* /three-col grid */}

      {/* Floating Check-Out FAB — visible whenever the user is currently
          checked in. Tapping it opens a confirmation dialog so an accidental
          tap doesn't end the workday + force-logout the user. */}
      {attendanceStatus === 'Checked In' && (
        <button
          onClick={() => setShowCheckOutConfirm(true)}
          disabled={loadingAttendance}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex items-center gap-2 px-4 py-3 bg-red-600 text-white rounded-full shadow-lg hover:bg-red-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          title="Check Out"
        >
          {loadingAttendance ? (
            <RefreshCw className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <LogOut className="h-4 w-4" />
              <span className="text-sm font-semibold">Check Out</span>
              {checkInTime && <span className="text-[11px] opacity-80 ml-1 hidden sm:inline">· in {checkInTime}</span>}
            </>
          )}
        </button>
      )}

      {/* Check-Out confirmation dialog */}
      {showCheckOutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => !loadingAttendance && setShowCheckOutConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <LogOut className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Check Out?</h3>
              <p className="text-sm text-gray-500 mb-5">
                This will end your workday{checkInTime && <> (started at {checkInTime})</>} and log you out of the app. Are you sure?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCheckOutConfirm(false)}
                  disabled={loadingAttendance}
                  className="flex-1 h-10 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowCheckOutConfirm(false); handleAttendance('checkout'); }}
                  disabled={loadingAttendance}
                  className="flex-1 h-10 px-4 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loadingAttendance ? <RefreshCw className="h-4 w-4 animate-spin" /> : <>Yes, Check Out</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Check-In Popup */}
      {showCheckInPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="relative w-full h-48 bg-gray-100">
              {userLocation ? (
                <iframe title="Your Location" width="100%" height="100%" style={{ border: 0 }} loading="eager" referrerPolicy="no-referrer"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${userLocation.lng - 0.001},${userLocation.lat - 0.001},${userLocation.lng + 0.001},${userLocation.lat + 0.001}&layer=mapnik&marker=${userLocation.lat},${userLocation.lng}`} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <RefreshCw className="h-6 w-6 animate-spin mb-2" />
                  <span className="text-xs font-bold uppercase tracking-wider">Fetching location...</span>
                </div>
              )}
              {userLocation && (
                <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-md flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                  <span className="text-[10px] font-bold text-gray-700">{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</span>
                </div>
              )}
            </div>
            <div className="p-6 text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Morning Check-In Required</h2>
              <p className="text-sm text-gray-500 mb-6">Please check in to start your workday. Your location will be verified against office geofences.</p>
              <button onClick={() => handleAttendance('checkin')} disabled={loadingAttendance}
                className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold text-base disabled:opacity-50">
                {loadingAttendance ? <RefreshCw className="h-5 w-5 animate-spin" /> : <><CheckCircle className="h-5 w-5" /> Check In Now</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

// ─── Operations Snapshot ─────────────────────────────────────────────
// Dense KPI grid matching the legacy PHP dashboard the team is used to.
// Layout strategy:
//   • Mobile (default): single column — every section stacks.
//   • Tablet (md): 2 columns — Our / Other side-by-side per expiry block.
//   • Desktop (lg+): 6 columns — entire bucket fits one row, two
//     buckets share width comfortably.
// Numbers are intentionally large so the page reads as a status board
// rather than a data table. Each tile is clickable in the future for
// drill-down (the existing /tally/expiry pages already accept filters).
function OperationsSnapshot({ data }: { data: any }) {
  type Grade = { silver: number; gold: number; auditor: number; total: number };
  type Segment = { our: Grade; other: Grade };
  type ExpiryKey = 'old' | 'this_month' | 'future';
  const expiry: Record<ExpiryKey, Segment> = data?.expiry || {
    old:        { our: { silver: 0, gold: 0, auditor: 0, total: 0 }, other: { silver: 0, gold: 0, auditor: 0, total: 0 } },
    this_month: { our: { silver: 0, gold: 0, auditor: 0, total: 0 }, other: { silver: 0, gold: 0, auditor: 0, total: 0 } },
    future:     { our: { silver: 0, gold: 0, auditor: 0, total: 0 }, other: { silver: 0, gold: 0, auditor: 0, total: 0 } },
  };
  const movement: Record<'onboard_new' | 'onboard_from_other' | 'left', Grade> = data?.movement || {
    onboard_new:        { silver: 0, gold: 0, auditor: 0, total: 0 },
    onboard_from_other: { silver: 0, gold: 0, auditor: 0, total: 0 },
    left:               { silver: 0, gold: 0, auditor: 0, total: 0 },
  };

  // Active expiry tab — null = no tab selected, fall through to the
  // customer-movement default view. Clicking a tab swaps the body to
  // the matching expiry block (Our + Other × Sil/Gol/Aud).
  const [activeExpiry, setActiveExpiry] = useState<ExpiryKey | null>(null);
  const TABS: Array<{ key: ExpiryKey; label: string; accent: string }> = [
    { key: 'old',        label: 'Old',        accent: 'rose' },
    { key: 'this_month', label: 'This Month', accent: 'amber' },
    { key: 'future',     label: 'Future',     accent: 'emerald' },
  ];
  const totalFor = (k: ExpiryKey) => (expiry[k].our?.total || 0) + (expiry[k].other?.total || 0);
  const accentMap: Record<ExpiryKey, string> = { old: 'rose', this_month: 'amber', future: 'emerald' };
  const tabActive = (k: ExpiryKey) => activeExpiry === k;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-slate-50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-slate-600" />
          <h3 className="font-semibold text-gray-900 text-sm">Operations Snapshot</h3>
        </div>
        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Expiry × segment × grade</span>
      </div>

      <div className="p-2.5 space-y-2">
        {/* Expiry tabs — click to drill into one bucket. The selected
            tab gets a stronger ring + tint AND surfaces an "✕ Close"
            affordance below so the way back to the movement view is
            obvious. */}
        <div className="grid grid-cols-3 gap-1.5">
          {TABS.map(t => {
            const a = ACCENT_CLASSES[t.accent] || ACCENT_CLASSES.rose;
            const active = tabActive(t.key);
            return (
              <button key={t.key}
                onClick={() => setActiveExpiry(active ? null : t.key)}
                className={`text-left rounded px-2 py-1.5 ring-1 transition-colors ${
                  active
                    ? `${a.bg} ${a.ring} ring-2 shadow-inner`
                    : `bg-white ${a.ring} hover:${a.bg}`
                }`}>
                <div className={`text-[10px] font-bold uppercase tracking-wide ${a.head} flex items-center justify-between`}>
                  <span>{t.label}</span>
                  {active && <span className={`text-[9px] ${a.head} opacity-70`}>● selected</span>}
                </div>
                <div className={`text-base font-bold tabular-nums ${a.head}`}>{totalFor(t.key)}</div>
              </button>
            );
          })}
        </div>

        {/* Body — toggles between the active expiry block (if a tab is
            selected) and the three customer-movement cards (default). */}
        {activeExpiry ? (
          <div>
            <button
              onClick={() => setActiveExpiry(null)}
              className="mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded">
              <X size={10} /> Close · show movement
            </button>
            <ExpiryBlock
              title={`${TABS.find(t => t.key === activeExpiry)?.label} Expiry`}
              seg={expiry[activeExpiry]}
              accent={accentMap[activeExpiry]}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-2">
            <MovementBlock title="Onboarded — New (30d)"        grade={movement.onboard_new}        accent="emerald" />
            <MovementBlock title="Onboarded — From Other (30d)" grade={movement.onboard_from_other} accent="blue" />
            <MovementBlock title="Left Customer (30d)"          grade={movement.left}               accent="rose" />
          </div>
        )}
      </div>
    </div>
  );
}

const ACCENT_CLASSES: Record<string, { bg: string; ring: string; head: string; tile: string }> = {
  rose:    { bg: 'bg-rose-50',    ring: 'ring-rose-200',    head: 'text-rose-700',    tile: 'bg-rose-500' },
  amber:   { bg: 'bg-amber-50',   ring: 'ring-amber-200',   head: 'text-amber-700',   tile: 'bg-amber-500' },
  emerald: { bg: 'bg-emerald-50', ring: 'ring-emerald-200', head: 'text-emerald-700', tile: 'bg-emerald-500' },
  blue:    { bg: 'bg-blue-50',    ring: 'ring-blue-200',    head: 'text-blue-700',    tile: 'bg-blue-500' },
};
const GRADE_TILES: Array<{ key: 'silver' | 'gold' | 'auditor'; label: string; bg: string; text: string }> = [
  { key: 'silver',  label: 'Silver',  bg: 'bg-pink-500',   text: 'text-white' },
  { key: 'gold',    label: 'Gold',    bg: 'bg-blue-500',   text: 'text-white' },
  { key: 'auditor', label: 'Auditor', bg: 'bg-amber-400',  text: 'text-white' },
];

function ExpiryBlock({ title, seg, accent }: { title: string; seg: any; accent: string }) {
  const a = ACCENT_CLASSES[accent] || ACCENT_CLASSES.rose;
  const totalAll = (seg.our?.total || 0) + (seg.other?.total || 0);
  return (
    <div className={`rounded ring-1 ${a.ring} ${a.bg} p-2`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${a.head}`}>{title}</span>
        <span className={`text-[10px] font-bold ${a.head}`}>{totalAll}</span>
      </div>
      <div className="space-y-1.5">
        <SegmentRow label="Our"   total={seg.our?.total || 0}   grade={seg.our} />
        <SegmentRow label="Other" total={seg.other?.total || 0} grade={seg.other} />
      </div>
    </div>
  );
}

function SegmentRow({ label, total, grade }: { label: string; total: number; grade: any }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[10px] font-medium text-gray-600">{label}</span>
        <span className="text-[10px] font-semibold text-gray-700 tabular-nums">({total})</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {GRADE_TILES.map(t => {
          const v = Number(grade?.[t.key] || 0);
          return (
            <div key={t.key} className={`${t.bg} ${t.text} rounded px-1.5 py-1 flex items-center justify-between gap-1`}>
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-90">{t.label.slice(0, 3)}</span>
              <span className="text-[13px] font-bold tabular-nums leading-none">{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MovementBlock({ title, grade, accent }: { title: string; grade: any; accent: string }) {
  const a = ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald;
  return (
    <div className={`rounded ring-1 ${a.ring} ${a.bg} p-2`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${a.head}`}>{title}</span>
        <span className={`text-[10px] font-bold ${a.head}`}>({grade?.total || 0})</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {GRADE_TILES.map(t => {
          const v = Number(grade?.[t.key] || 0);
          return (
            <div key={t.key} className={`${t.bg} ${t.text} rounded px-1.5 py-1 flex items-center justify-between gap-1`}>
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-90">{t.label.slice(0, 3)}</span>
              <span className="text-[13px] font-bold tabular-nums leading-none">{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
