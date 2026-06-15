import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, ChevronDown, ClipboardList } from 'lucide-react';
import { leadRequirementsApi, serviceCallsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

type ItemType = 'Requirement' | 'Correction';

interface UnifiedItem {
  _id: string;
  _type: ItemType;
  id: number;
  customer_name: string;
  description: string;
  lead_type?: string;
  service_type?: string;
  deadline?: string;
  priority?: string;
  status: string;
  // Two-stage completion fields — set when the dev marks complete; handler finalizes.
  dev_completed_at?: string | null;
  dev_completed_by?: string | null;
  handler_name?: string | null;
  latest_remark?: string;
  latest_remark_at?: string;
  created_by?: string;
  created_at?: string;
  contact_person?: string;
  mobile_no?: string;
}

const MyRequirements: React.FC = () => {
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedReqs, setExpandedReqs] = useState<string[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'All' | 'Requirement' | 'Correction'>('All');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [reqRes, corRes] = await Promise.all([
        leadRequirementsApi.getMyRequirements(),
        serviceCallsApi.getMyCorrections(),
      ]);
      if (reqRes.success) setRequirements(reqRes.data || []);
      if (corRes.success) setCorrections(corRes.data || []);
    } catch (e: any) {
      showError('Error', e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Normalize both into a unified list
  const unifiedList: UnifiedItem[] = [
    ...requirements.map(r => ({
      _id: `req-${r.id}`,
      _type: 'Requirement' as ItemType,
      id: r.id,
      customer_name: r.customer_name || r.contact_person || r.mobile_no || 'Unknown',
      description: r.description || '',
      lead_type: r.lead_type,
      deadline: r.deadline,
      priority: r.priority,
      status: r.status || 'Pending',
      dev_completed_at: r.dev_completed_at,
      dev_completed_by: r.dev_completed_by,
      handler_name: r.handler_name,
      latest_remark: r.latest_remark,
      latest_remark_at: r.latest_remark_at,
      contact_person: r.contact_person,
      mobile_no: r.mobile_no,
    })),
    ...corrections.map(c => ({
      _id: `cor-${c.id}`,
      _type: 'Correction' as ItemType,
      id: c.id,
      customer_name: c.customer_name || 'Walk-in',
      description: c.content || '',
      service_type: c.service_type,
      lead_type: c.lead_type,
      deadline: c.deadline,
      status: c.status || 'Pending',
      dev_completed_at: c.dev_completed_at,
      dev_completed_by: c.dev_completed_by,
      handler_name: c.handler_name,
      created_by: c.created_by,
      created_at: c.created_at,
      mobile_no: c.mobile_no,
    })),
  ];

  const handleStatusChange = async (item: UnifiedItem, newStatus: string) => {
    try {
      // Backend returns { stage: 'dev' | 'final' } when newStatus === 'Completed'.
      // - 'dev':   developer marked done; handler must finalize. Keep item in list
      //            with dev_completed_* populated so we can render the waiting badge.
      // - 'final': item is fully Completed; remove from the list.
      let res: any;
      if (item._type === 'Requirement') {
        res = await leadRequirementsApi.updateRequirementStatus(item.id, newStatus);
      } else {
        res = await serviceCallsApi.updateNoteStatus(item.id, newStatus);
      }
      const stage: string | undefined = res?.stage;
      const finalized = newStatus === 'Completed' && stage !== 'dev';

      if (item._type === 'Requirement') {
        if (finalized) {
          setRequirements(prev => prev.filter(r => r.id !== item.id));
        } else if (stage === 'dev') {
          setRequirements(prev => prev.map(r => r.id === item.id
            ? { ...r, dev_completed_at: new Date().toISOString(), dev_completed_by: 'you', status: r.status === 'Pending' ? 'In Progress' : r.status }
            : r));
        } else {
          setRequirements(prev => prev.map(r => r.id === item.id ? { ...r, status: newStatus } : r));
        }
      } else {
        if (finalized) {
          setCorrections(prev => prev.filter(c => c.id !== item.id));
        } else if (stage === 'dev') {
          setCorrections(prev => prev.map(c => c.id === item.id
            ? { ...c, dev_completed_at: new Date().toISOString(), dev_completed_by: 'you', status: c.status === 'Pending' ? 'In Progress' : c.status }
            : c));
        } else {
          setCorrections(prev => prev.map(c => c.id === item.id ? { ...c, status: newStatus } : c));
        }
      }
      showSuccess('Success', stage === 'dev' ? 'Marked done — handler will finalize' : 'Status updated');
    } catch (e: any) { showError('Error', e.message); }
  };

  const getOverdueDays = (deadline: string) => {
    if (!deadline) return 0;
    const diff = Math.floor((new Date().getTime() - new Date(deadline).getTime()) / (1000 * 3600 * 24));
    return diff > 0 ? diff : 0;
  };

  const isToday = (date: string) => {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const getTimeAgo = (d: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24);
    if (days > 0) return `${days}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return 'now';
  };

  // Filter by search + type
  const filtered = unifiedList.filter(item => {
    if (typeFilter !== 'All' && item._type !== typeFilter) return false;
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return item.customer_name.toLowerCase().includes(s) ||
      item.description.toLowerCase().includes(s) ||
      (item.lead_type || '').toLowerCase().includes(s) ||
      (item.service_type || '').toLowerCase().includes(s);
  });

  // Group by urgency
  const overdue = filtered.filter(r => r.deadline && getOverdueDays(r.deadline) > 0);
  const today = filtered.filter(r => r.deadline && isToday(r.deadline));
  const upcoming = filtered.filter(r => !overdue.includes(r) && !today.includes(r));

  const statusColor = (status: string) => {
    switch (status) {
      case 'In Progress': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Completed': return 'bg-green-50 text-green-700 border-green-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  const typeColor = (type: ItemType) =>
    type === 'Requirement' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-orange-50 text-orange-700 border-orange-200';

  const deadlineDisplay = (item: UnifiedItem) => {
    const od = getOverdueDays(item.deadline || '');
    if (od > 0) return { text: `${od}d overdue`, className: 'font-bold text-red-600' };
    if (item.deadline && isToday(item.deadline)) return { text: 'Today', className: 'font-semibold text-amber-600' };
    if (item.deadline) return { text: formatDate(item.deadline), className: 'text-gray-600' };
    return { text: '-', className: 'text-gray-400' };
  };

  const reqCount = unifiedList.filter(i => i._type === 'Requirement').length;
  const corCount = unifiedList.filter(i => i._type === 'Correction').length;

  // ── Mobile Card ──
  const renderCard = (item: UnifiedItem) => {
    const od = getOverdueDays(item.deadline || '');
    const isExpanded = expandedReqs.includes(item._id);

    return (
      <div key={item._id}>
        <div className={`bg-white p-3.5 rounded-xl border shadow-sm ${item._type === 'Correction' ? 'border-l-4 border-l-orange-400 border-gray-200' : 'border-gray-200'}`}>
          <div
            className="cursor-pointer active:bg-gray-50 select-none"
            onClick={() => setExpandedReqs(prev =>
              prev.includes(item._id) ? prev.filter(id => id !== item._id) : [...prev, item._id]
            )}
          >
            {/* Row 1: Customer Name | Type Badge | Status */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900 truncate">{item.customer_name}</div>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${typeColor(item._type)}`}>
                  {item._type === 'Requirement' ? 'REQ' : 'COR'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.dev_completed_at ? (
                  <span
                    onClick={e => e.stopPropagation()}
                    title={`Dev completed by ${item.dev_completed_by || 'you'} — handler ${item.handler_name || ''} will finalize`}
                    className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded px-2 py-0.5 text-[11px] font-semibold"
                  >
                    ✓ Dev Done — awaiting handler
                  </span>
                ) : (
                  <select
                    value={item.status}
                    onChange={e => { e.stopPropagation(); handleStatusChange(item, e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-sm text-gray-900 font-medium focus:outline-none appearance-none bg-white"
                  >
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                  </select>
                )}
                <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </div>
            </div>

            {/* Row 2: Description */}
            <div className="text-sm text-gray-900 truncate mt-1.5">{item.description}</div>

            {/* Row 3: Lead Type | Deadline | Priority/Created by */}
            <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-900">
              {(item.lead_type || item.service_type) && <span>{item.lead_type || item.service_type}</span>}
              {item.deadline && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className={od > 0 ? 'font-bold text-red-600' : ''}>
                    {od > 0 ? `${od}d overdue` : isToday(item.deadline) ? 'Today' : formatDate(item.deadline)}
                  </span>
                </>
              )}
              {item._type === 'Requirement' && item.priority && item.priority !== 'Medium' && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className={item.priority === 'Urgent' ? 'font-bold text-red-600' : item.priority === 'High' ? 'font-semibold' : ''}>{item.priority}</span>
                </>
              )}
              {item._type === 'Correction' && item.created_by && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className="text-gray-500">by {item.created_by}</span>
                </>
              )}
            </div>
          </div>

          {/* Expanded Details */}
          {isExpanded && (
            <div className="mt-2 pt-2 border-t border-gray-100 space-y-1 text-sm text-gray-900">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div><strong>Type:</strong> {item._type}</div>
                <div><strong>Status:</strong> {item.status}</div>
                {item.lead_type && <div><strong>Lead Type:</strong> {item.lead_type}</div>}
                {item.deadline && <div><strong>Deadline:</strong> {formatDate(item.deadline)}</div>}
                {item._type === 'Requirement' && <div><strong>Priority:</strong> {item.priority || 'Medium'}</div>}
                {item._type === 'Correction' && item.created_by && <div><strong>Created by:</strong> {item.created_by}</div>}
                {item.mobile_no && <div><strong>Mobile:</strong> {item.mobile_no}</div>}
                {item.latest_remark && (
                  <div className="col-span-2"><strong>Last Remark:</strong> {item.latest_remark}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Desktop Table Row ──
  const renderTableRow = (item: UnifiedItem, index: number) => {
    const dl = deadlineDisplay(item);
    return (
      <tr key={item._id} className="hover:bg-blue-50/30 transition-colors group">
        <td className="px-3 py-2 border border-gray-200 text-xs text-gray-500 font-medium">{index + 1}</td>
        <td className="px-3 py-2 border border-gray-200">
          <span className="text-xs font-bold text-gray-800">{item.customer_name}</span>
        </td>
        <td className="px-3 py-2 border border-gray-200 text-xs text-gray-600 max-w-[200px] truncate">{item.description || '—'}</td>
        <td className="px-3 py-2 border border-gray-200 text-center">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${typeColor(item._type)}`}>
            {item._type}
          </span>
        </td>
        <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-600 font-semibold">{item.lead_type || item.service_type || '—'}</td>
        <td className="px-3 py-2 border border-gray-200 text-center">
          <span className={`text-xs ${dl.className}`}>{dl.text}</span>
        </td>
        <td className="px-3 py-2 border border-gray-200 text-center">
          {item._type === 'Requirement' && item.priority && item.priority !== 'Medium' ? (
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${item.priority === 'Urgent' ? 'bg-red-50 text-red-700 border-red-200' :
              item.priority === 'High' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-gray-50 text-gray-600 border-gray-200'
              }`}>{item.priority}</span>
          ) : <span className="text-gray-400 text-xs">{item._type === 'Requirement' ? 'Medium' : '—'}</span>}
        </td>
        <td className="px-3 py-2 border border-gray-200 text-center">
          {item.dev_completed_at ? (
            <span
              title={`Dev completed by ${item.dev_completed_by || 'you'} — handler ${item.handler_name || ''} will finalize`}
              className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            >
              ✓ Dev Done
            </span>
          ) : (
            <select
              value={item.status}
              onChange={e => { e.stopPropagation(); handleStatusChange(item, e.target.value); }}
              onClick={e => e.stopPropagation()}
              className="border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 font-medium focus:outline-none bg-white cursor-pointer"
            >
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          )}
        </td>
        <td className="px-3 py-2 border border-gray-200 text-[10px] text-gray-500 max-w-[120px] truncate">
          {item.latest_remark || (item._type === 'Correction' && item.created_by ? `by ${item.created_by}` : '—')}
        </td>
      </tr>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-6 w-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base md:text-xl font-bold text-gray-900">My Requirements ({filtered.length})</div>
            {filtered.length > 0 && (
              <div className="flex items-center gap-3 mt-0.5 text-sm text-gray-900">
                {overdue.length > 0 && <span className="font-bold text-red-600">{overdue.length} overdue</span>}
                {today.length > 0 && <span className="font-semibold">{today.length} today</span>}
                <span>{upcoming.length} upcoming</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSearch(!showSearch)} className={`p-2 border rounded-lg md:hidden ${showSearch ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-600'}`}>
              <Search className="h-4 w-4" />
            </button>
            <button onClick={fetchData} className="p-2 rounded-lg hover:bg-gray-100"><RefreshCw className="h-4 w-4 text-gray-400" /></button>
          </div>
        </div>

        {/* Type Filter Chips */}
        <div className="flex items-center gap-2 mt-2">
          {(['All', 'Requirement', 'Correction'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${typeFilter === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {t === 'All' ? `All (${unifiedList.length})` : t === 'Requirement' ? `Requirements (${reqCount})` : `Corrections (${corCount})`}
            </button>
          ))}
        </div>

        {/* Desktop Search */}
        <div className="hidden md:block mt-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Mobile Search */}
        {showSearch && (
          <div className="mt-3 pt-3 border-t md:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-400" />
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="bg-white">
          {/* Desktop Table */}
          <table className="hidden md:table w-full border-collapse bg-white">
            <thead className="bg-[#f8f9fa] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
              <tr>
                <th className="px-3 py-2 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase w-10">Sr</th>
                <th className="px-3 py-2 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Customer</th>
                <th className="px-3 py-2 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                <th className="px-3 py-2 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Type</th>
                <th className="px-3 py-2 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Category</th>
                <th className="px-3 py-2 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Deadline</th>
                <th className="px-3 py-2 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Priority</th>
                <th className="px-3 py-2 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-3 py-2 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ClipboardList className="h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-400">No pending items assigned to you</p>
                  </div>
                </td></tr>
              ) : (
                <>
                  {overdue.length > 0 && (
                    <>
                      <tr><td colSpan={9} className="px-3 py-1.5 bg-red-50 text-xs font-bold text-red-600 uppercase tracking-wide border border-gray-200">Overdue ({overdue.length})</td></tr>
                      {overdue.map((r, i) => renderTableRow(r, i))}
                    </>
                  )}
                  {today.length > 0 && (
                    <>
                      <tr><td colSpan={9} className="px-3 py-1.5 bg-amber-50 text-xs font-bold text-amber-700 uppercase tracking-wide border border-gray-200">Today ({today.length})</td></tr>
                      {today.map((r, i) => renderTableRow(r, overdue.length + i))}
                    </>
                  )}
                  {upcoming.length > 0 && (
                    <>
                      <tr><td colSpan={9} className="px-3 py-1.5 bg-gray-50 text-xs font-bold text-gray-600 uppercase tracking-wide border border-gray-200">Upcoming ({upcoming.length})</td></tr>
                      {upcoming.map((r, i) => renderTableRow(r, overdue.length + today.length + i))}
                    </>
                  )}
                </>
              )}
            </tbody>
          </table>

          {/* Mobile Cards */}
          <div className="md:hidden p-3 space-y-2.5 bg-gray-50/50 pb-24">
            {filtered.length === 0 ? (
              <div className="py-12 text-center">
                <ClipboardList className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <div className="text-sm text-gray-400">No pending items assigned to you</div>
              </div>
            ) : (
              <>
                {overdue.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-red-600 uppercase tracking-wide">Overdue ({overdue.length})</div>
                    {overdue.map(renderCard)}
                  </>
                )}
                {today.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-gray-900 uppercase tracking-wide mt-2">Today ({today.length})</div>
                    {today.map(renderCard)}
                  </>
                )}
                {upcoming.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-gray-900 uppercase tracking-wide mt-2">Upcoming ({upcoming.length})</div>
                    {upcoming.map(renderCard)}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyRequirements;
