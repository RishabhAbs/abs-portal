import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { groupChangeApi, customersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

const GroupChangeReport: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCheckPermission, isAdmin } = useAuth();
  // Two distinct sub-permissions, so an admin can grant only group OR only
  // reseller change. Either side renders read-only when disabled.
  const canEditGroup = isAdmin() || canCheckPermission('group_change', 'edit_group');
  const canEditReseller = isAdmin() || canCheckPermission('group_change', 'edit_reseller');

  // Users (cloud_users) and resellers
  const [users, setUsers] = useState<any[]>([]);
  const [resellers, setResellers] = useState<any[]>([]);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const customerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New group / new reseller
  const [newGroupId, setNewGroupId] = useState('');
  const [newResellerId, setNewResellerId] = useState<string>(''); // empty = unassign
  const [transferring, setTransferring] = useState(false);
  const [transferringReseller, setTransferringReseller] = useState(false);

  // Reseller-row's own customer search (so you can pick a customer here
  // without scrolling back up to the group row).
  const [customerSearch2, setCustomerSearch2] = useState('');
  const [customerSuggestions2, setCustomerSuggestions2] = useState<any[]>([]);
  const [showCustomerDropdown2, setShowCustomerDropdown2] = useState(false);
  const customerDropdownRef2 = useRef<HTMLDivElement>(null);
  const customerDebounce2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Searchable reseller dropdown (native <select> doesn't filter, and 80+
  // resellers in a flat list is unfriendly).
  const [resellerSearch, setResellerSearch] = useState('');
  const [showResellerDropdown, setShowResellerDropdown] = useState(false);
  const resellerDropdownRef = useRef<HTMLDivElement>(null);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load users + resellers in parallel. Surface failures to the user (a 404
  // here means the backend is on an older build that doesn't expose the
  // resellers endpoint yet — silently swallowing it leaves the dropdown
  // empty with no clue why).
  useEffect(() => {
    groupChangeApi.getUsers().then(res => setUsers(res.data || [])).catch(e => showError('Users load failed', e?.message || 'Could not load users'));
    groupChangeApi.getResellers().then(res => setResellers(res.data || [])).catch(e => showError('Resellers load failed', e?.message || 'Could not load resellers — restart backend?'));
  }, [showError]);

  // Load history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await groupChangeApi.getHistory(historyPage, 50);
      setHistory(res.data || []);
      setHistoryTotal(res.total || 0);
    } catch { }
    finally { setLoadingHistory(false); }
  }, [historyPage]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Customer search with debounce
  const handleCustomerSearch = (value: string) => {
    setCustomerSearch(value);
    setSelectedCustomer(null);
    if (customerDebounce.current) clearTimeout(customerDebounce.current);
    if (value.trim().length >= 3) {
      customerDebounce.current = setTimeout(async () => {
        try {
          const res = await customersApi.search(value.trim());
          setCustomerSuggestions(res.data || []);
          setShowCustomerDropdown(true);
        } catch { setCustomerSuggestions([]); }
      }, 300);
    } else {
      setCustomerSuggestions([]);
      setShowCustomerDropdown(false);
    }
  };

  const selectCustomer = (c: any) => {
    setSelectedCustomer(c);
    setCustomerSearch(c.company);
    setCustomerSearch2(c.company);
    setShowCustomerDropdown(false);
    setShowCustomerDropdown2(false);
    setCustomerSuggestions([]);
    setCustomerSuggestions2([]);
    setNewGroupId('');
    setNewResellerId('');
    setResellerSearch('');
  };

  // Same debounced search for the reseller-row's own customer picker.
  const handleCustomerSearch2 = (value: string) => {
    setCustomerSearch2(value);
    setSelectedCustomer(null);
    if (customerDebounce2.current) clearTimeout(customerDebounce2.current);
    if (value.trim().length >= 3) {
      customerDebounce2.current = setTimeout(async () => {
        try {
          const res = await customersApi.search(value.trim());
          setCustomerSuggestions2(res.data || []);
          setShowCustomerDropdown2(true);
        } catch { setCustomerSuggestions2([]); }
      }, 300);
    } else {
      setCustomerSuggestions2([]);
      setShowCustomerDropdown2(false);
    }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node))
        setShowCustomerDropdown(false);
      if (customerDropdownRef2.current && !customerDropdownRef2.current.contains(e.target as Node))
        setShowCustomerDropdown2(false);
      if (resellerDropdownRef.current && !resellerDropdownRef.current.contains(e.target as Node))
        setShowResellerDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Transfer
  const handleTransfer = async () => {
    if (!selectedCustomer) { showError('Error', 'Select a customer'); return; }
    if (!newGroupId) { showError('Error', 'Select new group'); return; }

    const newUser = users.find(u => u.id === newGroupId);
    if (!window.confirm(`Change group of "${selectedCustomer.company}" to ${newUser?.name}?`)) return;

    setTransferring(true);
    try {
      const res = await groupChangeApi.transfer([selectedCustomer.id], newGroupId);
      showSuccess('Done', res.message);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setNewGroupId('');
      loadHistory();
    } catch (err: any) { showError('Error', err.message); }
    finally { setTransferring(false); }
  };

  // Reseller transfer
  const handleResellerChange = async () => {
    if (!selectedCustomer) { showError('Error', 'Select a customer'); return; }
    const toIdNum = newResellerId === '' ? null : Number(newResellerId);
    const newName = toIdNum === null ? '(none)' : resellers.find(r => r.id === toIdNum)?.name || '—';
    if (!window.confirm(`Change reseller of "${selectedCustomer.company}" to ${newName}?`)) return;
    setTransferringReseller(true);
    try {
      const res = await groupChangeApi.transferReseller([selectedCustomer.id], toIdNum);
      showSuccess('Done', res.message);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setNewResellerId('');
      loadHistory();
    } catch (err: any) { showError('Error', err.message); }
    finally { setTransferringReseller(false); }
  };

  // Current group name + current reseller name
  const currentHandler = selectedCustomer
    ? users.find(u => u.id === selectedCustomer.cloud_group_id)?.name || selectedCustomer.cloud_group_id || '—'
    : '';
  // Prefer the joined `reseller_name` from autocomplete (always correct
  // straight from the DB), fall back to looking up by id in the resellers
  // array for safety.
  const currentReseller = selectedCustomer
    ? (selectedCustomer.reseller_name
        || resellers.find(r => Number(r.id) === Number(selectedCustomer.resellerid))?.name
        || (selectedCustomer.resellerid ? `#${selectedCustomer.resellerid}` : '—'))
    : '';

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <h1 className="text-lg md:text-2xl font-bold text-gray-900 mt-2 px-1">Group / Reseller Change</h1>

      {/* Group Transfer Row */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          {/* Customer Search */}
          <div ref={customerDropdownRef} className="relative">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Customer</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input value={customerSearch}
                onChange={e => handleCustomerSearch(e.target.value)}
                onFocus={() => { if (customerSuggestions.length > 0) setShowCustomerDropdown(true); }}
                placeholder="Type 3+ chars to search..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 outline-none"
                autoComplete="off" />
            </div>
            {showCustomerDropdown && customerSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                {customerSuggestions.map((c: any) => (
                  <div key={c.id} onClick={() => selectCustomer(c)}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0">
                    <div className="font-medium text-gray-900">{c.company}</div>
                    <div className="text-xs text-gray-400">{c.person} | {c.mobile}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current Group (read-only) */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Current Group</label>
            <input value={currentHandler} readOnly
              className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500" />
          </div>

          {/* New Group */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">New Group</label>
            <select value={newGroupId} onChange={e => setNewGroupId(e.target.value)}
              className="w-full py-2 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-100 outline-none">
              <option value="">-- Select --</option>
              {users.filter(u => u.id !== selectedCustomer?.cloud_group_id).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Transfer Button */}
          <button onClick={handleTransfer} disabled={transferring || !selectedCustomer || !newGroupId || !canEditGroup}
            title={!canEditGroup ? 'You do not have permission to change group' : undefined}
            className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap h-[38px]">
            {transferring ? 'Saving...' : 'Change'}
          </button>
        </div>
      </div>

      {/* Reseller Transfer Row — independent customer search and a search-
          enabled New Reseller dropdown. Empty New Reseller means "remove the
          reseller from this customer". */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          {/* Customer search (parallels the Group row above; same selected
              customer state is shared between rows). */}
          <div ref={customerDropdownRef2} className="relative">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Customer</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input value={customerSearch2}
                onChange={e => handleCustomerSearch2(e.target.value)}
                onFocus={() => { if (customerSuggestions2.length > 0) setShowCustomerDropdown2(true); }}
                placeholder="Type 3+ chars to search..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                autoComplete="off" />
            </div>
            {showCustomerDropdown2 && customerSuggestions2.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                {customerSuggestions2.map((c: any) => (
                  <div key={c.id} onClick={() => selectCustomer(c)}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0">
                    <div className="font-medium text-gray-900">{c.company}</div>
                    <div className="text-xs text-gray-400">{c.person} | {c.mobile}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current Reseller (read-only) */}
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Current Reseller</label>
            <input value={currentReseller} readOnly
              className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500" />
          </div>

          {/* New Reseller — search-as-you-type */}
          <div ref={resellerDropdownRef} className="relative">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">New Reseller</label>
            {(() => {
              const selectedName = newResellerId === ''
                ? (resellerSearch ? '' : '— None / Remove —')
                : resellers.find(r => String(r.id) === String(newResellerId))?.name || '';
              const inputValue = showResellerDropdown ? resellerSearch : selectedName;
              const filtered = resellers
                .filter(r => r.id !== selectedCustomer?.resellerid)
                .filter(r => !resellerSearch || (r.name || '').toLowerCase().includes(resellerSearch.toLowerCase()));
              return (
                <>
                  <input value={inputValue}
                    onChange={e => { setResellerSearch(e.target.value); setShowResellerDropdown(true); setNewResellerId(''); }}
                    onFocus={() => { setShowResellerDropdown(true); setResellerSearch(''); }}
                    placeholder="Search reseller…"
                    className="w-full py-2 px-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                    autoComplete="off" />
                  {showResellerDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
                      <div onClick={() => { setNewResellerId(''); setResellerSearch(''); setShowResellerDropdown(false); }}
                        className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-100 italic text-gray-500">
                        — None / Remove —
                      </div>
                      {filtered.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-400">No resellers match</div>
                      ) : filtered.map((r: any) => (
                        <div key={r.id}
                          onClick={() => { setNewResellerId(String(r.id)); setResellerSearch(''); setShowResellerDropdown(false); }}
                          className={`px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0 ${String(newResellerId) === String(r.id) ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
                          {r.name}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <button onClick={handleResellerChange} disabled={transferringReseller || !selectedCustomer || !canEditReseller}
            title={!canEditReseller ? 'You do not have permission to change reseller' : undefined}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap h-[38px]">
            {transferringReseller ? 'Saving...' : 'Change'}
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Change History</span>
          <button onClick={loadHistory} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2.5 text-left w-12">S.No</th>
                <th className="px-4 py-2.5 text-left">Customer Name</th>
                <th className="px-4 py-2.5 text-left w-24">Type</th>
                <th className="px-4 py-2.5 text-left">From</th>
                <th className="px-4 py-2.5 text-left">To</th>
                <th className="px-4 py-2.5 text-left">Changed By</th>
                <th className="px-4 py-2.5 text-left">Date / Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingHistory ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : history.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No history yet</td></tr>
              ) : history.map((h: any, i: number) => {
                const isReseller = h.change_type === 'reseller';
                // Backend may still emit legacy field names for older rows;
                // fall back to those if the unified labels aren't set.
                const fromLabel = h.from_label ?? h.from_user_name ?? h.from_reseller_name ?? '—';
                const toLabel   = h.to_label   ?? h.to_user_name   ?? h.to_reseller_name   ?? '—';
                return (
                  <tr key={`${h.change_type || 'group'}-${h.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400">{(historyPage - 1) * 50 + i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{h.customer_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${isReseller ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                        {isReseller ? 'Reseller' : 'Group'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{fromLabel || '—'}</td>
                    <td className={`px-4 py-2.5 font-medium ${isReseller ? 'text-blue-600' : 'text-red-600'}`}>{toLabel || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{h.changed_by}</td>
                    <td className="px-4 py-2.5 text-gray-400">
                      {new Date(h.changed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}{' '}
                      {new Date(h.changed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {loadingHistory ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">No history yet</div>
          ) : history.map((h: any, i: number) => {
            const isReseller = h.change_type === 'reseller';
            const fromLabel = h.from_label ?? h.from_user_name ?? h.from_reseller_name ?? '—';
            const toLabel   = h.to_label   ?? h.to_user_name   ?? h.to_reseller_name   ?? '—';
            return (
              <div key={`${h.change_type || 'group'}-${h.id}`} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{(historyPage - 1) * 50 + i + 1}. {h.customer_name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(h.changed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{' '}
                    {new Date(h.changed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isReseller ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                    {isReseller ? 'Reseller' : 'Group'}
                  </span>
                  <span className="text-gray-700">{fromLabel || '—'}</span>
                  <span>→</span>
                  <span className={`font-medium ${isReseller ? 'text-blue-600' : 'text-red-600'}`}>{toLabel || '—'}</span>
                  <span className="text-gray-400 ml-1">by {h.changed_by}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {historyTotal > 50 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">Page {historyPage} of {Math.ceil(historyTotal / 50)}</span>
            <div className="flex gap-2">
              <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1}
                className="px-3 py-1 border rounded text-xs disabled:opacity-50">Prev</button>
              <button onClick={() => setHistoryPage(p => p + 1)} disabled={historyPage >= Math.ceil(historyTotal / 50)}
                className="px-3 py-1 border rounded text-xs disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupChangeReport;
