import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Wifi, WifiOff, Search, RotateCcw, Activity, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { serverMonitorApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface MonitorRow {
  id: number;
  customer_ip: string;
  customer_name: string | null;
  port: number;
  status: 'up' | 'down' | 'unknown';
  last_checked_at: string | null;
  last_up_at: string | null;
  last_down_at: string | null;
  downtime_start: string | null;
  total_downtime_seconds: number;
  is_active: number;
}

interface MonitorLog {
  id: number;
  customer_ip: string;
  event: 'up' | 'down';
  event_at: string;
  downtime_seconds: number | null;
}

const PAGE_SIZE = 20;

const fmtDuration = (secs: number | null | undefined): string => {
  if (!secs) return '0s';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
};

// Backend stores UTC via toISOString(). Appending 'Z' forces UTC parsing so the
// browser converts correctly to IST for display and duration calculations.
const toUtcDate = (d: string) => new Date(d.endsWith('Z') ? d : d + 'Z');

const fmtTime = (d: string | null): string => {
  if (!d) return '—';
  const dt = toUtcDate(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const currentDowntime = (start: string | null): string => {
  if (!start) return '—';
  return fmtDuration(Math.floor((Date.now() - toUtcDate(start).getTime()) / 1000));
};

const ServerMonitor: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCheckPermission, isAdmin } = useAuth();
  const hasAccess = isAdmin() || canCheckPermission('server_monitor', 'view');
  const canEdit   = isAdmin() || canCheckPermission('server_monitor', 'edit');

  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingRow, setCheckingRow] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'up' | 'down' | 'unknown' | null>(null);
  const [page, setPage] = useState(1);

  // Log modal
  const [logIp, setLogIp] = useState<string | null>(null);
  const [logCustomer, setLogCustomer] = useState<string>('');
  const [logs, setLogs] = useState<MonitorLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await serverMonitorApi.getAll('');
      if (res.success) setRows(res.data || []);
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  const filtered = useMemo(() => {
    let result = rows;
    if (statusFilter) result = result.filter(r => r.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) result = result.filter(r =>
      r.customer_ip.toLowerCase().includes(q) ||
      (r.customer_name || '').toLowerCase().includes(q)
    );
    return result;
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  useEffect(() => { setPage(1); }, [search]);

  const upCount = rows.filter(r => r.status === 'up').length;
  const downCount = rows.filter(r => r.status === 'down').length;
  const unknownCount = rows.filter(r => r.status === 'unknown').length;

  const openLogs = async (row: MonitorRow) => {
    setLogIp(row.customer_ip);
    setLogCustomer(row.customer_name || row.customer_ip);
    setLogsLoading(true);
    setLogs([]);
    try {
      const res = await serverMonitorApi.getLogs(row.customer_ip, 50);
      if (res.success) setLogs(res.data || []);
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await serverMonitorApi.sync();
      if (res.success) { showSuccess('Synced', res.message); fetchData(); }
    } catch (e: any) { showError('Error', e?.message || 'Sync failed'); }
    finally { setSyncing(false); }
  };

  const handleCheckSingle = async (ip: string) => {
    setCheckingRow(ip);
    try {
      const res = await serverMonitorApi.checkSingle(ip);
      if (res.success) {
        showSuccess('Done', `Status: ${res.status === 'up' ? 'Online' : 'Offline'}`);
        fetchData();
      }
    } catch (e: any) { showError('Error', e?.message || 'Check failed'); }
    finally { setCheckingRow(null); }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      const res = await serverMonitorApi.checkNow();
      if (res.success) { showSuccess('Done', res.message); fetchData(); }
    } catch (e: any) { showError('Error', e?.message || 'Check failed'); }
    finally { setChecking(false); }
  };

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <WifiOff size={48} className="text-gray-300 mb-4" />
        <h2 className="text-lg font-semibold text-gray-700 mb-1">Access Denied</h2>
        <p className="text-sm text-gray-400">You don't have permission to view Server Monitor.<br />Contact your admin to request access.</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-50 min-h-screen">

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Server Monitor</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rows.length} servers &bull; auto-checks every 5 min &bull; refreshes every 30s
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <RotateCcw size={13} className={syncing ? 'animate-spin' : ''} /> Sync IPs
          </button>
          <button onClick={handleCheckNow} disabled={checking}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 font-medium">
            <Activity size={13} className={checking ? 'animate-pulse' : ''} />
            {checking ? 'Checking…' : 'Check Now'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Online',  value: upCount,      filter: 'up' as const,      color: 'border-l-green-500', text: 'text-green-600', ring: 'ring-green-300' },
          { label: 'Offline', value: downCount,     filter: 'down' as const,    color: 'border-l-red-500',   text: 'text-red-500',   ring: 'ring-red-300'   },
          { label: 'Unknown', value: unknownCount,  filter: 'unknown' as const, color: 'border-l-gray-400',  text: 'text-gray-500',  ring: 'ring-gray-300'  },
          { label: 'Total',   value: rows.length,   filter: null,               color: 'border-l-blue-500',  text: 'text-blue-600',  ring: 'ring-blue-300'  },
        ].map(s => {
          const active = statusFilter === s.filter;
          return (
            <div key={s.label}
              onClick={() => { setStatusFilter(active ? null : s.filter); setPage(1); }}
              className={`bg-white rounded-lg border border-gray-200 border-l-4 ${s.color} px-4 py-3 cursor-pointer select-none transition-all
                ${active ? `ring-2 ${s.ring} shadow-sm` : 'hover:shadow-sm hover:border-gray-300'}`}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>{s.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <div className="relative w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search IP or customer…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <div className="flex items-center gap-2">
            {statusFilter && (
              <button onClick={() => { setStatusFilter(null); setPage(1); }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">
                <X size={10} /> {statusFilter === 'up' ? 'Online' : statusFilter === 'down' ? 'Offline' : 'Unknown'}
              </button>
            )}
            <p className="text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            {search ? `No results for "${search}"` : (
              <><p className="mb-1">No servers yet.</p>
                <button onClick={handleSync} className="text-blue-500 hover:underline">Sync from active mappings →</button></>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    {['#','STATUS','CUSTOMER IP','CUSTOMER','PORT','LAST CHECKED','DOWN SINCE','TOTAL DOWNTIME','ACTION'].map(h => (
                      <th key={h} className="py-2.5 px-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap border border-gray-200">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, idx) => (
                    <tr key={r.id} className={`hover:bg-blue-50/30 ${!r.is_active ? 'opacity-40' : ''}`}>
                      <td className="py-2 px-3 text-gray-400 text-xs border border-gray-200 w-8">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2 px-3 border border-gray-200 w-24">
                        <span className={`text-xs font-semibold ${
                          r.status === 'up' ? 'text-green-600'
                          : r.status === 'down' ? 'text-red-500'
                          : 'text-gray-400'
                        }`}>
                          {r.status === 'up' ? 'Online' : r.status === 'down' ? 'Offline' : 'Unknown'}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-xs text-gray-700 border border-gray-200 max-w-[180px] truncate">{r.customer_ip}</td>
                      <td className="py-2 px-3 text-gray-800 font-medium border border-gray-200 max-w-[200px] truncate">{r.customer_name || '—'}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs tabular-nums border border-gray-200">{r.port}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs tabular-nums whitespace-nowrap border border-gray-200">{fmtTime(r.last_checked_at)}</td>
                      <td className="py-2 px-3 text-xs tabular-nums whitespace-nowrap border border-gray-200">
                        {r.status === 'down' && r.downtime_start
                          ? <span className="text-red-500 font-medium">{currentDowntime(r.downtime_start)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3 text-xs tabular-nums text-gray-600 whitespace-nowrap border border-gray-200">
                        {fmtDuration(r.total_downtime_seconds)}
                      </td>
                      <td className="py-2 px-3 border border-gray-200 whitespace-nowrap">
                        <button onClick={() => handleCheckSingle(r.customer_ip)}
                          disabled={checkingRow === r.customer_ip}
                          className="text-xs text-green-600 hover:text-green-800 font-medium hover:underline disabled:opacity-40 mr-3">
                          {checkingRow === r.customer_ip ? '…' : 'Check'}
                        </button>
                        <button onClick={() => openLogs(r)}
                          className="text-xs text-blue-500 hover:text-blue-700 font-medium hover:underline">
                          Logs
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-500">
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) => p === '...'
                    ? <span key={`e${i}`} className="px-1 text-gray-400 text-xs">…</span>
                    : <button key={p} onClick={() => setPage(p as number)}
                        className={`min-w-[26px] h-6 rounded text-xs font-medium ${page === p ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                        {p}
                      </button>
                  )}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-500">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Log popup modal ── */}
      {logIp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLogIp(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md z-10 overflow-hidden">

            {/* Modal header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900">Event History</p>
                <p className="text-xs text-gray-500 mt-0.5">{logCustomer}</p>
                <p className="text-xs font-mono text-gray-400">{logIp}</p>
              </div>
              <button onClick={() => setLogIp(null)} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
                <X size={18} />
              </button>
            </div>

            {/* Log list */}
            <div className="overflow-y-auto max-h-[60vh]">
              {logsLoading ? (
                <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
              ) : logs.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No events recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="py-2 px-5 text-left">Event</th>
                      <th className="py-2 px-5 text-left">Time</th>
                      <th className="py-2 px-5 text-left">Downtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2.5 px-5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            log.event === 'up' ? 'text-green-600' : 'text-red-500'
                          }`}>
                            {log.event === 'up' ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {log.event === 'up' ? 'Came Online' : 'Went Offline'}
                          </span>
                        </td>
                                        <td className="py-2.5 px-5 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                          {fmtTime(log.event_at)}
                        </td>
                        <td className="py-2.5 px-5 text-xs tabular-nums">
                          {log.event === 'up' && log.downtime_seconds
                            ? <span className="text-orange-500 font-medium">{fmtDuration(log.downtime_seconds)}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServerMonitor;
