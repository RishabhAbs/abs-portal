import React, { useState, useEffect } from 'react';
import { Search, ChevronLeft, RefreshCw, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { leadRequirementsApi, usersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';

const ITEMS_PER_PAGE = 25;

const devStatusBadge = (status: string) => {
  switch (status) {
    case 'Pending':     return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'In Progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Completed':   return 'bg-green-50 text-green-700 border-green-200';
    case 'On Hold':     return 'bg-orange-50 text-orange-700 border-orange-200';
    default:            return 'bg-gray-50 text-gray-600 border-gray-200';
  }
};

const testingStatusBadge = (status: string) => {
  switch (status) {
    case 'Pending':     return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'In Progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Passed':      return 'bg-green-50 text-green-700 border-green-200';
    case 'Failed':      return 'bg-red-50 text-red-700 border-red-200';
    default:            return 'bg-gray-50 text-gray-600 border-gray-200';
  }
};

const formatDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

const isOverdue = (deadline: string | null, status?: string) => {
  if (!deadline || status === 'Completed') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(deadline) < today;
};

const typeTagColor = (type: string) =>
  type === 'Requirement' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-orange-50 text-orange-700 border-orange-200';

const LeadRequirementsReport: React.FC = () => {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { isAdmin: isAdminFn } = useAuth();
  const isAdmin = isAdminFn();

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [corrTotal, setCorrTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Sorting
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // UI
  const [staffList, setStaffList] = useState<any[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.length >= 3 || search.length === 0) setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch staff
  useEffect(() => {
    if (isAdmin) {
      usersApi.getAll().then(res => {
        setStaffList(Array.isArray(res) ? res : res?.data || []);
      }).catch(() => {});
    }
  }, []);

  // Fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [reqRes, corRes] = await Promise.all([
        leadRequirementsApi.getRequirementsReport({
          search: debouncedSearch, staff: staffFilter, status: statusFilter, priority: priorityFilter,
          startDate, endDate, page, limit: ITEMS_PER_PAGE, sortBy, sortOrder,
        }),
        leadRequirementsApi.getCorrectionReport({
          search: debouncedSearch, staff: staffFilter, updateType: '', startDate, endDate, page, limit: ITEMS_PER_PAGE,
        }),
      ]);
      if (reqRes.success) {
        setRequirements(reqRes.data || []);
        setTotal(reqRes.total || 0);
      }
      setCorrections(corRes.data || []);
      setCorrTotal(corRes.total || 0);
    } catch (e: any) {
      showError('Error', e.message || 'Failed to load');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [page, debouncedSearch, staffFilter, statusFilter, priorityFilter, startDate, endDate, sortBy, sortOrder]);

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return null;
    return sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const filterConfig: FilterConfig[] = [
    ...(isAdmin ? [{ key: 'staff', label: 'Staff', type: 'select' as const, options: [{ value: '', label: 'All Staff' }, ...staffList.map(u => ({ value: u.name, label: u.name }))] }] : []),
    { key: 'status', label: 'Status', type: 'select' as const, options: [
      { value: '', label: 'All' }, { value: 'Pending', label: 'Pending' }, { value: 'In Progress', label: 'In Progress' },
      { value: 'Completed', label: 'Completed' }, { value: 'Transferred', label: 'Transferred' }, { value: 'Cancelled', label: 'Cancelled' },
    ]},
    { key: 'priority', label: 'Priority', type: 'select' as const, options: [
      { value: '', label: 'All' }, { value: 'Low', label: 'Low' }, { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' }, { value: 'Urgent', label: 'Urgent' },
    ]},
    { key: 'startDate', label: 'From Date', type: 'date' as const },
    { key: 'endDate', label: 'To Date', type: 'date' as const },
  ];

  const activeFilterCount = [staffFilter, statusFilter, priorityFilter, startDate, endDate].filter(Boolean).length;

  // Build combined list (requirements + corrections)
  const combinedData = (() => {
    const reqItems = requirements.map(r => ({ ...r, _type: 'Requirement' as const }));
    const corItems = corrections.map(c => ({ ...c, _type: 'Correction' as const, customer_name: c.customer_name || '—', description: c.requirement_description || c.content || '—' }));
    return [...reqItems, ...corItems];
  })();

  const displayTotal = total + corrTotal;

  return (
    <div className="p-0 space-y-0">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-gray-100 rounded-full">
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">Requirements Report</h1>
              {displayTotal > 0 && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold">{displayTotal}</span>}
            </div>
            <div className="flex items-center gap-2">
              {/* Desktop search */}
              <div className="hidden md:block relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search..." className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
              </div>
              {/* Mobile search toggle */}
              <button onClick={() => setShowMobileSearch(v => !v)} className="md:hidden p-2 border rounded-lg text-gray-600">
                <Search className="h-4 w-4" />
              </button>
              <button onClick={() => setShowFilterModal(true)}
                className={`p-2 border rounded-lg relative ${activeFilterCount > 0 ? 'bg-blue-50 border-blue-300 text-blue-600' : 'text-gray-600'}`}>
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 && <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">{activeFilterCount}</span>}
              </button>
              <button onClick={() => fetchData()} className="p-2 border rounded-lg text-gray-600 hover:bg-gray-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Mobile search bar */}
          {showMobileSearch && (
            <div className="md:hidden pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} autoFocus
                  placeholder="Search customer, requirement..." className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="bg-white border-y overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs border-b">
                <tr>
                  <th className="px-4 py-3 border-r w-10">Sr</th>
                  <th className="px-4 py-3 border-r text-center w-24">Type</th>
                  <th className="px-4 py-3 border-r cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('customer_name')}>
                    Customer Name <SortIcon col="customer_name" />
                  </th>
                  <th className="px-4 py-3 border-r">Description</th>
                  <th className="px-4 py-3 border-r cursor-pointer hover:bg-gray-100 text-center" onClick={() => toggleSort('deadline')}>
                    Deadline <SortIcon col="deadline" />
                  </th>
                  <th className="px-4 py-3 border-r text-center">Status</th>
                  <th className="px-4 py-3 border-r cursor-pointer hover:bg-gray-100 text-center" onClick={() => toggleSort('created_at')}>
                    Created <SortIcon col="created_at" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-20 text-gray-400">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 opacity-30" />
                    <p className="font-bold uppercase tracking-widest text-xs">Loading...</p>
                  </td></tr>
                ) : combinedData.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-20 text-gray-400">
                    <p className="font-bold uppercase tracking-widest text-xs">No records found</p>
                  </td></tr>
                ) : (
                  combinedData.map((r: any, idx: number) => (
                    <tr key={`${r._type}-${r.id}`} className="hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3 border-r text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-3 border-r text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${typeTagColor(r._type)}`}>
                          {r._type}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-r">
                        <div className="font-bold text-gray-900">{r.customer_name || '—'}</div>
                        {r._type === 'Requirement' && (
                          <div className="text-xs text-gray-400">{r.contact_person} {r.mobile_no ? `| ${r.mobile_no}` : ''}</div>
                        )}
                        {r._type === 'Correction' && r.mobile_no && (
                          <div className="text-xs text-gray-400">{r.mobile_no}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 border-r max-w-[300px]">
                        <div className="text-gray-800 truncate" title={r.description || r.content}>
                          {r.description || r.content || '—'}
                        </div>
                        {r._type === 'Requirement' && r.assigned_to && <div className="text-xs text-gray-400 mt-0.5">Assigned: {r.assigned_to}</div>}
                        {r._type === 'Correction' && r.update_type && (
                          <span className="text-[9px] font-bold text-gray-400 uppercase">{r.update_type}</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 border-r text-center text-sm ${r._type === 'Requirement' && isOverdue(r.deadline, r.status) ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                        {r._type === 'Requirement' ? formatDate(r.deadline) : '—'}
                      </td>
                      <td className="px-4 py-3 border-r text-center">
                        {r._type === 'Requirement' ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${devStatusBadge(r.dev_status || r.status || 'Pending')}`}>
                              {r.dev_status || r.status || 'Pending'}
                            </span>
                          </div>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${devStatusBadge(r.status || 'Pending')}`}>
                            {r.status || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 border-r text-center text-gray-500 text-sm">
                        {formatDate(r.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t bg-gray-50 text-xs font-bold text-gray-400 uppercase tracking-widest">
            Total {displayTotal} records
          </div>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden p-3 space-y-3 bg-gray-50/50 pb-24">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 opacity-30" />
            Loading...
          </div>
        ) : combinedData.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No records found</div>
        ) : (
          combinedData.map((r: any) => {
            const isReq = r._type === 'Requirement';
            const overdue = isReq && isOverdue(r.deadline, r.status);
            return (
              <div key={`${r._type}-${r.id}`} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${isReq ? 'border-gray-200' : 'border-orange-200'}`}>
                {/* Top accent bar */}
                <div className={`h-1 w-full ${isReq ? 'bg-gradient-to-r from-indigo-400 to-blue-500' : 'bg-gradient-to-r from-orange-400 to-amber-500'}`}></div>
                <div className="p-4">
                  {/* Header: Customer + Type pill */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold text-gray-900 truncate">{r.customer_name || '—'}</div>
                      {(r.contact_person || r.mobile_no) && (
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{r.contact_person} {r.mobile_no ? `· ${r.mobile_no}` : ''}</div>
                      )}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider border ${typeTagColor(r._type)}`}>
                      {isReq ? 'Requirement' : 'Correction'}
                    </span>
                  </div>

                  {/* Description */}
                  <div className="text-sm text-gray-800 leading-snug line-clamp-2 mb-3">
                    {r.description || r.content || '—'}
                  </div>

                  {/* Status badges row */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {isReq ? (
                      <>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${devStatusBadge(r.dev_status || 'Pending')}`}>
                          DEV · {r.dev_status || 'Pending'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${testingStatusBadge(r.testing_status || 'Pending')}`}>
                          QA · {r.testing_status || 'Pending'}
                        </span>
                      </>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${devStatusBadge(r.status || 'Pending')}`}>
                        {r.update_type || r.status || 'Pending'}
                      </span>
                    )}
                  </div>

                  {/* Footer: Deadline | Assigned | Created */}
                  <div className="flex items-center justify-between pt-2.5 border-t border-gray-100 text-[11px]">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400 font-semibold uppercase tracking-wider">{isReq ? 'Deadline' : 'Updated'}</span>
                      <span className={`font-bold ${overdue ? 'text-red-600' : 'text-gray-700'}`}>
                        {isReq ? formatDate(r.deadline) : formatDate(r.created_at)}
                      </span>
                    </div>
                    <span className="text-gray-500 font-medium truncate max-w-[45%] text-right">
                      {r.assigned_to || r.created_by || '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <PaginationControls
        currentPage={page}
        totalPages={Math.ceil(displayTotal / ITEMS_PER_PAGE)}
        onPageChange={setPage}
        loading={loading}
        totalItems={displayTotal}
        itemsPerPage={ITEMS_PER_PAGE}
        className="border-t"
      />

      {/* Filter Modal */}
      <FilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        title="Filter Records"
        config={filterConfig}
        currentFilters={{ staff: staffFilter, status: statusFilter, priority: priorityFilter, startDate, endDate }}
        onApply={(f) => {
          setStaffFilter(f.staff || '');
          setStatusFilter(f.status || '');
          setPriorityFilter(f.priority || '');
          setStartDate(f.startDate || '');
          setEndDate(f.endDate || '');
          setPage(1);
          setShowFilterModal(false);
        }}
        onReset={() => {
          setStaffFilter(''); setStatusFilter(''); setPriorityFilter(''); setStartDate(''); setEndDate('');
          setPage(1);
          setShowFilterModal(false);
        }}
      />
    </div>
  );
};

export default LeadRequirementsReport;
