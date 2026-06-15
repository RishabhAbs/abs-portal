import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle, RotateCcw, Star, UserPlus, Loader2, Phone, Search, RefreshCw, ClipboardCheck, X, ChevronDown, ArrowUpDown, Filter, Clock } from 'lucide-react';
import { serviceCallsApi, usersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import CustomerNameLink from '../components/CustomerNameLink';

const ServiceFollowUp: React.FC = () => {
  const { isAdmin, canCheckPermission, user } = useAuth();
  const canViewAll = isAdmin() || canCheckPermission('service_calls', 'view_all');
  const canConfirm = isAdmin() || canCheckPermission('service_followup', 'confirm');
  const canReopen = isAdmin() || canCheckPermission('service_followup', 'reopen');

  // ── List State ──────────────────────────────────────────────────────────
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // ── Sort State ──────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string>('closed_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ── Filter State ────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState('');
  const [filterHandler, setFilterHandler] = useState(() => canViewAll ? '' : (user?.name || ''));
  const [showFilters, setShowFilters] = useState(false);
  const [expandedCalls, setExpandedCalls] = useState<number[]>([]);

  // ── Action State ────────────────────────────────────────────────────────
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [mode, setMode] = useState<'choose' | 'confirm' | 'reopen'>('choose');
  const [actionLoading, setActionLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reopenAssignTo, setReopenAssignTo] = useState('');
  const [cloudUsers, setCloudUsers] = useState<any[]>([]);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const res = await serviceCallsApi.getAll('Closed', activeSearch);
      setCalls(res.data || []);
    } catch (e: any) {
      console.error('Failed to fetch follow-up calls', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
    const loadUsers = async () => {
      try {
        const res = await usersApi.getBasic();
        setCloudUsers(res.data || []);
      } catch { /* ignore */ }
    };
    loadUsers();
  }, [activeSearch]);

  // Only show Closed (not Confirmed) calls
  const pendingCalls = useMemo(() => calls.filter(c => c.status === 'Closed'), [calls]);

  // Unique values for filters
  const serviceTypes = useMemo(() => Array.from(new Set(pendingCalls.map(c => c.service_type).filter(Boolean))), [pendingCalls]);
  const handlers = useMemo(() => Array.from(new Set(pendingCalls.map(c => c.taken_by).filter(Boolean))), [pendingCalls]);

  // Filtered + sorted calls
  const displayCalls = useMemo(() => {
    let filtered = [...pendingCalls];

    if (filterType) filtered = filtered.filter(c => c.service_type === filterType);
    if (filterHandler) filtered = filtered.filter(c => c.taken_by === filterHandler);

    filtered.sort((a, b) => {
      let valA: any, valB: any;
      switch (sortField) {
        case 'closed_at':
          valA = new Date(a.closed_at || a.updated_at || a.created_at).getTime();
          valB = new Date(b.closed_at || b.updated_at || b.created_at).getTime();
          break;
        case 'created_at':
          valA = new Date(a.created_at).getTime();
          valB = new Date(b.created_at).getTime();
          break;
        case 'customer_name':
          valA = (a.customer_name || '').toLowerCase();
          valB = (b.customer_name || '').toLowerCase();
          break;
        case 'service_type':
          valA = (a.service_type || '').toLowerCase();
          valB = (b.service_type || '').toLowerCase();
          break;
        case 'taken_by':
          valA = (a.taken_by || '').toLowerCase();
          valB = (b.taken_by || '').toLowerCase();
          break;
        default:
          valA = a[sortField]; valB = b[sortField];
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [pendingCalls, filterType, filterHandler, sortField, sortDir]);

  // ── Pagination ──
  const ITEMS_PER_PAGE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(displayCalls.length / ITEMS_PER_PAGE);
  const paginatedCalls = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displayCalls.slice(start, start + ITEMS_PER_PAGE);
  }, [displayCalls, currentPage]);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [filterType, filterHandler, activeSearch]);

  const hasActiveFilters = filterType || filterHandler;

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => (
    <ArrowUpDown className={`h-3 w-3 inline ml-1 ${sortField === field ? 'text-blue-600' : 'text-gray-300'}`} />
  );

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  const getTimeAgo = (dateStr: string) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const openAction = (call: any) => {
    setSelectedCall(call);
    setMode('choose');
    setRating(0);
    setHoverRating(0);
    setReopenAssignTo('');
  };

  const handleConfirm = async () => {
    if (!selectedCall || rating === 0) {
      alert('Please select a satisfaction rating (1-5 stars)');
      return;
    }
    setActionLoading(true);
    try {
      await serviceCallsApi.confirm(selectedCall.id, rating);
      setSelectedCall(null);
      await fetchCalls();
    } catch (e: any) {
      alert(e.message || 'Failed to confirm');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopen = async () => {
    if (!selectedCall) return;
    setActionLoading(true);
    try {
      await serviceCallsApi.reopen(selectedCall.id, reopenAssignTo || undefined);
      setSelectedCall(null);
      await fetchCalls();
    } catch (e: any) {
      alert(e.message || 'Failed to reopen');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden font-sans">

      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">Service Follow-Up</h1>
          <span className="shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase rounded-full">
            {displayCalls.length} Pending
          </span>
          {/* ── Inline Filters ── */}
          {canViewAll && (
            <select value={filterHandler} onChange={e => setFilterHandler(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="">All Handlers</option>
              {handlers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="">All Types</option>
            {serviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {canViewAll && (filterHandler || filterType) && (
            <button onClick={() => { setFilterHandler(''); setFilterType(''); }} className="text-xs text-red-500 hover:underline">Clear</button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search mobile, name, S/N..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setActiveSearch(searchQuery)}
              className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-md w-48 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:w-56 transition-all"
            />
          </div>
          <button onClick={() => setActiveSearch(searchQuery)} className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-semibold rounded-md hover:bg-blue-100 transition-colors">
            Search
          </button>
          {activeSearch && (
            <button onClick={() => { setActiveSearch(''); setSearchQuery(''); }} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Clear">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              hasActiveFilters
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Filter
            {hasActiveFilters && (
              <span className="bg-white text-blue-600 text-[10px] px-1 py-0.5 rounded-full font-bold ml-0.5">
                {[filterType, filterHandler].filter(Boolean).length}
              </span>
            )}
          </button>
          <button onClick={fetchCalls} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      {showFilters && (
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase">Type:</label>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-200 outline-none"
            >
              <option value="">All Types</option>
              {serviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase">Handled By:</label>
            <select
              value={filterHandler}
              onChange={e => setFilterHandler(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-200 outline-none"
            >
              <option value="">All Handlers</option>
              {handlers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterType(''); setFilterHandler(''); }}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium ml-2"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col lg:flex-row h-full">

          {/* ── Calls List ── */}
          <div className={`flex-1 bg-white overflow-auto ${selectedCall ? 'hidden lg:block lg:border-r lg:border-gray-200' : ''}`}>
            <table className="hidden md:table w-full border-collapse bg-white">
              <thead className="bg-[#f8f9fa] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                <tr>
                  <th className="px-3 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase w-10">Sr</th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('customer_name')}>
                    Customer <SortIcon field="customer_name" />
                  </th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase">Mobile</th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase">S/N</th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('service_type')}>
                    Type <SortIcon field="service_type" />
                  </th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('taken_by')}>
                    Handled By <SortIcon field="taken_by" />
                  </th>
                  <th className="px-4 py-2 border border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase">Remark</th>
                  <th className="px-4 py-2 border border-gray-200 text-center text-[11px] font-bold text-gray-600 uppercase cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('closed_at')}>
                    Closed <SortIcon field="closed_at" />
                  </th>
                  <th className="px-4 py-2 border border-gray-200 text-center text-[11px] font-bold text-gray-600 uppercase w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-gray-400">Loading...</td></tr>
                ) : displayCalls.length === 0 ? (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-gray-400">No pending follow-ups</td></tr>
                ) : paginatedCalls.map((call, i) => (
                  <tr 
                    key={call.id} 
                    className={`hover:bg-blue-50/50 transition-colors cursor-pointer ${selectedCall?.id === call.id ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
                    onClick={() => openAction(call)}
                  >
                    <td className="px-3 py-2 border border-gray-200 text-[11px] text-gray-500 font-medium">{i + 1}</td>
                    <td className="px-4 py-2 border border-gray-200">
                      <span className="text-[12px] font-bold text-gray-800">{call.customer_name ? <CustomerNameLink customerId={(call as any).customer_id} name={call.customer_name} /> : <span className="text-gray-400 italic">Walk-in</span>}</span>
                    </td>
                    <td className="px-4 py-2 border border-gray-200 text-[11px] text-gray-600 font-mono">{call.mobile_no}</td>
                    <td className="px-4 py-2 border border-gray-200 text-[11px] text-gray-500 font-mono">{call.serial_number || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 border border-gray-200 text-[11px] text-gray-600">{call.service_type || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 border border-gray-200 text-[11px] text-gray-700 font-medium">{call.taken_by || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 border border-gray-200 text-[10px] text-gray-600 max-w-[150px] truncate" title={call.remark || ''}>{call.remark || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 border border-gray-200 text-center text-[11px] text-gray-500 font-medium">
                      {formatDate(call.closed_at)} <span className="text-gray-300">({getTimeAgo(call.closed_at)})</span>
                    </td>
                    <td className="px-4 py-2 border border-gray-200 text-center">
                      <button className="p-1.5 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded transition-colors" title="Follow Up">
                        <ClipboardCheck className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Mobile View ── */}
            <div className="md:hidden p-3 space-y-2.5 bg-gray-50/50 overflow-y-auto relative">
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
              ) : displayCalls.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No pending follow-ups</div>
              ) : paginatedCalls.map((call) => (
                <div
                  key={call.id}
                  className={`bg-white p-2 rounded-xl border-2 border-gray-300 shadow-sm border-l-4 border-l-amber-400 ${selectedCall?.id === call.id ? 'ring-2 ring-blue-500' : ''}`}
                >
                  {/* Row 1: Company + Action Buttons */}
                  <div className="flex items-center justify-between gap-2 border-b-2 border-gray-200 pb-[3px] mb-[3px]">
                    <div className="text-[22px] text-gray-900 truncate flex-1">
                      {call.customer_name ? <CustomerNameLink customerId={(call as any).customer_id} name={call.customer_name} /> : <span className="italic">Walk-in</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      {canConfirm && (
                        <button onClick={() => { setSelectedCall(call); setMode('confirm'); }}
                          className="w-8 h-8 flex items-center justify-center bg-emerald-500 text-white rounded-full active:bg-emerald-600 transition-colors" title="Confirm">
                          <CheckCircle className="h-4 w-4" />
                        </button>
                      )}
                      {canReopen && (
                        <button onClick={() => { setSelectedCall(call); setMode('reopen'); }}
                          className="w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-full active:bg-red-600 transition-colors" title="Reopen">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Info Grid */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden text-[22px] text-gray-900 leading-tight">
                    <div className="flex border-b border-gray-200">
                      <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">Mobile</div>
                      <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">
                        <a href={`tel:${call.mobile_no}`} onClick={e => e.stopPropagation()}>{call.mobile_no}</a>
                      </div>
                    </div>
                    <div className="flex border-b border-gray-200">
                      <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">{call.service_type || 'Type'}</div>
                      <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">{call.remark || '—'}</div>
                    </div>
                    <div className="flex">
                      <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">S/N</div>
                      <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">{call.serial_number || '—'}</div>
                    </div>
                  </div>

                  {/* Status | Handler */}
                  <div className="mt-[3px] flex items-center gap-1 text-[22px] text-gray-900">
                    <span>Handler:</span>
                    <span className="truncate">{call.taken_by || 'Unassigned'}</span>
                    <span className="mx-1 text-gray-300">|</span>
                    <span>{getTimeAgo(call.closed_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {displayCalls.length > ITEMS_PER_PAGE && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalItems={displayCalls.length}
                itemsPerPage={ITEMS_PER_PAGE}
                loading={loading}
                sticky={false}
              />
            )}
          </div>

          {/* ── Action Panel Modal ── */}
          {selectedCall && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
              <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#0a1628] to-[#162544] px-5 py-4 shrink-0">
                  <div className="flex items-start justify-between">
                    <div className="pr-4">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Follow-Up #{selectedCall.id}</div>
                      <div className="text-[18px] font-extrabold text-white leading-tight mt-1 truncate max-w-[300px]" title={selectedCall.customer_name || 'Walk-in'}>
                        {selectedCall.customer_name || 'Walk-in'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {selectedCall.mobile_no && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-300 font-medium bg-white/10 px-2 py-0.5 rounded pl-1.5">
                            <Phone className="h-3 w-3 opacity-70" /> {selectedCall.mobile_no}
                          </span>
                        )}
                        {selectedCall.service_type && (
                          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[9px] font-bold uppercase rounded-full">
                            {selectedCall.service_type}
                          </span>
                        )}
                      </div>
                      {selectedCall.taken_by && (
                        <div className="text-[10px] text-slate-400 mt-2">Handled by: <span className="text-white font-semibold">{selectedCall.taken_by}</span></div>
                      )}
                      {selectedCall.closed_at && (
                        <div className="text-[10px] text-slate-400 mt-0.5">Closed: <span className="text-slate-300">{formatDate(selectedCall.closed_at)}</span></div>
                      )}
                      {selectedCall.remark && (
                        <div className="text-[10px] text-slate-400 mt-1 pt-1 border-t border-white/10">Remark: <span className="text-slate-300">{selectedCall.remark}</span></div>
                      )}
                    </div>
                    <button 
                      onClick={() => setSelectedCall(null)} 
                      className="p-1.5 bg-white/10 hover:bg-red-500/80 rounded-lg text-white transition-colors shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Action Content */}
                <div className="p-6 overflow-y-auto">
                  {mode === 'choose' && (
                    <div className="space-y-3 p-1">
                      {canConfirm && (
                        <button
                          onClick={() => setMode('confirm')}
                          className="w-full flex items-center gap-4 p-4 bg-white border-2 border-slate-100 rounded-xl hover:border-emerald-400 hover:bg-emerald-50/30 hover:shadow-md transition-all group text-left"
                        >
                          <div className="p-3 bg-emerald-100/50 rounded-xl group-hover:bg-emerald-200/50 group-hover:scale-105 transition-all shrink-0">
                            <CheckCircle className="h-6 w-6 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-[15px] font-bold text-slate-800">Mark as Confirmed</p>
                            <p className="text-[12px] text-slate-500 mt-0.5">Rate customer satisfaction</p>
                          </div>
                        </button>
                      )}

                      {canReopen && (
                        <button
                          onClick={() => setMode('reopen')}
                          className="w-full flex items-center gap-4 p-4 bg-white border-2 border-slate-100 rounded-xl hover:border-amber-400 hover:bg-amber-50/30 hover:shadow-md transition-all group text-left"
                        >
                          <div className="p-3 bg-amber-100/50 rounded-xl group-hover:bg-amber-200/50 group-hover:scale-105 transition-all shrink-0">
                            <RotateCcw className="h-6 w-6 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-[15px] font-bold text-slate-800">Reopen Service Call</p>
                            <p className="text-[12px] text-slate-500 mt-0.5">Issue remains unresolved</p>
                          </div>
                        </button>
                      )}

                      {!canConfirm && !canReopen && (
                        <div className="text-center py-8 text-slate-400 text-sm italic">
                          You don't have permission to confirm or reopen service calls.
                        </div>
                      )}
                    </div>
                  )}

                  {mode === 'confirm' && (
                    <div className="space-y-6">
                      <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="p-1 bg-emerald-100 rounded text-emerald-600"><CheckCircle className="h-3.5 w-3.5" /></div>
                          <span className="text-[13px] font-bold text-emerald-900">Confirm Service</span>
                        </div>
                        <p className="text-[11px] text-emerald-700/80 ml-7">Record satisfaction for quality control</p>
                      </div>

                      {/* Star Rating */}
                      <div className="text-center py-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">Select Rating</p>
                        <div className="flex items-center justify-center gap-2">
                          {[1, 2, 3, 4, 5].map(star => (
                            <button
                              key={star}
                              onClick={() => setRating(star)}
                              onMouseEnter={() => setHoverRating(star)}
                              onMouseLeave={() => setHoverRating(0)}
                              className="p-1 transition-transform hover:scale-125 focus:outline-none"
                            >
                              <Star 
                                className={`h-10 w-10 transition-colors drop-shadow-sm ${
                                  star <= (hoverRating || rating) 
                                    ? 'text-amber-400 fill-amber-400 hover:text-amber-300' 
                                    : 'text-slate-200'
                                }`} 
                              />
                            </button>
                          ))}
                        </div>
                        <div className="h-6 mt-3 flex items-center justify-center">
                          {rating > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-full shadow-sm">
                              <span className="text-[12px] font-bold text-amber-600">
                                {rating === 1 ? 'Poor' : rating === 2 ? 'Below Average' : rating === 3 ? 'Average' : rating === 4 ? 'Good' : 'Excellent'}
                              </span>
                              <span className="text-[11px] text-slate-400 border-l border-slate-200 pl-1.5 font-medium">{rating}/5</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button onClick={() => { setMode('choose'); setRating(0); setHoverRating(0); }} disabled={actionLoading}
                          className="flex-[0.4] px-4 py-2.5 text-[13px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                          Back
                        </button>
                        <button onClick={handleConfirm} disabled={actionLoading || rating === 0}
                          className="flex-1 px-4 py-2.5 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow hover:shadow-lg disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2">
                          {actionLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</> : <><CheckCircle className="h-4 w-4" /> Confirm & Close</>}
                        </button>
                      </div>
                    </div>
                  )}

                  {mode === 'reopen' && (
                    <div className="space-y-6">
                      <div className="bg-amber-50/50 border border-amber-100 rounded-xl px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="p-1 bg-amber-100 rounded text-amber-600"><RotateCcw className="h-3.5 w-3.5" /></div>
                          <span className="text-[13px] font-bold text-amber-900">Reopen Service Call</span>
                        </div>
                        <p className="text-[11px] text-amber-700/80 ml-7">This moves it back to pending status</p>
                      </div>

                      <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                          <UserPlus className="h-3.5 w-3.5" /> Assign To (Optional)
                        </label>
                        <div className="relative">
                          <select value={reopenAssignTo} onChange={e => setReopenAssignTo(e.target.value)}
                            className="w-full px-3.5 py-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white font-medium shadow-sm transition-shadow">
                            <option value="">Leave Open — Unassigned</option>
                            {cloudUsers.map(u => (
                              <option key={u.id} value={u.name}>{u.name}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2 bg-white/60 p-2 rounded border border-slate-100/50 inline-block w-full">
                          {reopenAssignTo
                            ? <span className="text-blue-600 font-medium whitespace-nowrap">Assigned to {reopenAssignTo} as "In Progress"</span>
                            : <span>Will be marked <span className="font-bold">"Open"</span> for anyone to take.</span>}
                        </p>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button onClick={() => setMode('choose')} disabled={actionLoading}
                          className="flex-[0.4] px-4 py-2.5 text-[13px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                          Back
                        </button>
                        <button onClick={handleReopen} disabled={actionLoading}
                          className="flex-1 px-4 py-2.5 text-[13px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-all shadow hover:shadow-lg disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2">
                          {actionLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</> : <><RotateCcw className="h-4 w-4" /> Reopen Service</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceFollowUp;
