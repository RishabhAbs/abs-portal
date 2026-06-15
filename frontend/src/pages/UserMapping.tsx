import React, { useState, useEffect, useCallback } from 'react';
import { userMappingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, Search, ChevronLeft, ChevronRight, CheckSquare, Square, Users, ArrowRight, Filter } from 'lucide-react';

interface LegacyAdmin {
  id: number;
  name: string;
  status: string;
  customer_count: number;
}

interface CloudUser {
  id: string;
  name: string;
  role: string;
  status: string;
}

interface MappingCustomer {
  id: number;
  company: string;
  person: string | null;
  mobile: string | null;
  email: string | null;
  status: string | null;
  group: number;
  cloud_group_id: string | null;
  subgroupid: string | null;
  admin_name: string | null;
  cloud_user_name: string | null;
  sub_user_name: string | null;
}

const ITEMS_PER_PAGE = 50;

export default function UserMapping() {
  const { user } = useAuth();
  const [legacyAdmins, setLegacyAdmins] = useState<LegacyAdmin[]>([]);
  const [cloudUsers, setCloudUsers] = useState<CloudUser[]>([]);
  const [selectedAdmin, setSelectedAdmin] = useState<number | null>(null);
  const [selectedAdminName, setSelectedAdminName] = useState('');
  const [customers, setCustomers] = useState<MappingCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [cloudGroupId, setCloudGroupId] = useState('');
  const [subgroupId, setSubgroupId] = useState('');
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  // Load legacy admins and cloud users on mount
  useEffect(() => {
    (async () => {
      try {
        const [adminsRes, usersRes] = await Promise.all([
          userMappingApi.getLegacyAdmins(),
          userMappingApi.getCloudUsers(),
        ]);
        setLegacyAdmins((adminsRes as any).data || []);
        const allUsers = (usersRes as any).data || [];
        setCloudUsers(allUsers.filter((u: CloudUser) => u.status === 'active'));
      } catch (e: any) {
        setToast({ msg: e.message || 'Failed to load data', type: 'error' });
      } finally {
        setLoadingAdmins(false);
      }
    })();
  }, []);

  // Load customers when admin selected or page/search changes
  const loadCustomers = useCallback(async () => {
    if (!selectedAdmin) return;
    setLoading(true);
    try {
      const res = await userMappingApi.getCustomersByAdmin(selectedAdmin, page, ITEMS_PER_PAGE, search);
      setCustomers((res as any).data || []);
      setTotal((res as any).total || 0);
    } catch (e: any) {
      setToast({ msg: e.message || 'Failed to load customers', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [selectedAdmin, page, search]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
  }, [toast]);

  const handleSelectAdmin = (admin: LegacyAdmin) => {
    setSelectedAdmin(admin.id);
    setSelectedAdminName(admin.name);
    setPage(1);
    setSearch('');
    setSelectedIds(new Set());
    setCloudGroupId('');
    setSubgroupId('');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === customers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(customers.map(c => c.id)));
    }
  };

  const handleApply = async () => {
    if (!selectedIds.size) return setToast({ msg: 'Select at least one customer', type: 'error' });
    if (!cloudGroupId && !subgroupId) return setToast({ msg: 'Select a Cloud User or Sub User to assign', type: 'error' });
    setApplying(true);
    try {
      const res = await userMappingApi.applyMapping(
        Array.from(selectedIds),
        cloudGroupId || undefined,
        subgroupId || undefined
      );
      setToast({ msg: (res as any).message || `Updated ${selectedIds.size} customers`, type: 'success' });
      setSelectedIds(new Set());
      loadCustomers();
    } catch (e: any) {
      setToast({ msg: e.message || 'Failed to apply mapping', type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  if (user?.role?.toLowerCase() !== 'admin') {
    return <div className="flex items-center justify-center h-64 text-gray-400">Admin access required</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-120px)] md:h-[calc(100dvh-64px)] bg-gray-50 overflow-hidden font-sans">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">User Mapping</h1>
            <p className="text-xs text-gray-500 mt-0.5">Map legacy admin users to cloud users</p>
          </div>
          {selectedAdmin && (
            <button onClick={() => { setSelectedAdmin(null); setCustomers([]); setTotal(0); }}
              className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
              <ChevronLeft className="h-4 w-4" /> Back to admins
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAdmin ? (
          /* ── Step 1: Admin Selection ── */
          <div className="p-4">
            <div className="mb-3 text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users className="h-4 w-4" /> Select a Legacy Admin User
            </div>
            {loadingAdmins ? (
              <div className="py-12 text-center text-gray-400">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 opacity-30" />
                Loading admins...
              </div>
            ) : legacyAdmins.length === 0 ? (
              <div className="py-12 text-center text-gray-400">No admin users with customers found</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {legacyAdmins.map(admin => (
                  <button
                    key={admin.id}
                    onClick={() => handleSelectAdmin(admin)}
                    className="bg-white rounded-xl border-2 border-gray-200 hover:border-blue-400 p-4 text-left transition-all active:scale-[0.98] shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-base font-bold text-gray-900">{admin.name}</div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${admin.status === 'YES' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {admin.status === 'YES' ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-gray-500">ID: {admin.id}</span>
                      <span className="text-sm font-semibold text-blue-600">{admin.customer_count} customers</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-blue-500 font-medium">
                      View customers <ArrowRight className="h-3 w-3" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Step 2: Customer List + Mapping ── */
          <div className="flex flex-col h-full">
            {/* Mapping Bar: Legacy User | Cloud User | Sub User */}
            <div className="bg-white border-b shrink-0">
              <div className="grid grid-cols-1 md:grid-cols-3 border-b">
                {/* Legacy User */}
                <div className="px-4 py-3 md:border-r border-b md:border-b-0 bg-gray-50">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Legacy User</div>
                  <div className="text-base font-bold text-gray-900">{selectedAdminName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">ID: {selectedAdmin} &middot; {total} customers</div>
                </div>
                {/* Cloud User */}
                <div className="px-4 py-3 md:border-r border-b md:border-b-0">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">Cloud User (Primary)</div>
                  <select value={cloudGroupId} onChange={e => setCloudGroupId(e.target.value)}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none bg-blue-50/30">
                    <option value="">-- Select --</option>
                    {cloudUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.id})</option>
                    ))}
                  </select>
                </div>
                {/* Sub User */}
                <div className="px-4 py-3">
                  <div className="text-[10px] font-bold text-purple-500 uppercase tracking-widest mb-1">Cloud User (Sub)</div>
                  <select value={subgroupId} onChange={e => setSubgroupId(e.target.value)}
                    className="w-full border-2 border-purple-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none bg-purple-50/30">
                    <option value="">-- None --</option>
                    {cloudUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.id})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Search + Apply Row */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search by company, mobile, person..."
                    className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                  />
                </div>
                <button
                  onClick={handleApply}
                  disabled={applying || !selectedIds.size || (!cloudGroupId && !subgroupId)}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0"
                >
                  {applying ? 'Applying...' : `Apply to ${selectedIds.size} selected`}
                </button>
              </div>
            </div>

            {/* Customer Table */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="py-12 text-center text-gray-400">
                  <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 opacity-30" />
                  Loading customers...
                </div>
              ) : customers.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <Filter className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No customers found
                </div>
              ) : (
                <>
                  {/* Mobile Card View */}
                  <div className="block md:hidden p-3 space-y-2">
                    {/* Select All */}
                    <button onClick={toggleSelectAll}
                      className="flex items-center gap-2 text-sm font-medium text-gray-600 mb-1 px-1">
                      {selectedIds.size === customers.length
                        ? <CheckSquare className="h-5 w-5 text-blue-600" />
                        : <Square className="h-5 w-5 text-gray-400" />}
                      {selectedIds.size === customers.length ? 'Deselect All' : 'Select All'}
                    </button>
                    {customers.map(c => (
                      <div key={c.id}
                        onClick={() => toggleSelect(c.id)}
                        className={`bg-white p-3.5 rounded-xl border-2 shadow-sm cursor-pointer transition-all ${selectedIds.has(c.id) ? 'border-blue-500 bg-blue-50/30' : 'border-gray-300'}`}>
                        <div className="flex items-center gap-3">
                          {selectedIds.has(c.id)
                            ? <CheckSquare className="h-5 w-5 text-blue-600 shrink-0" />
                            : <Square className="h-5 w-5 text-gray-400 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            {/* Row 1: Company */}
                            <div className="text-[17px] font-bold text-gray-900 truncate">{c.company}</div>
                            {/* Row 2: Person | Mobile */}
                            <div className="flex items-center justify-between gap-2 mt-1">
                              <span className="text-sm text-gray-600 truncate">{c.person || '—'}</span>
                              <span className="text-sm text-gray-600 shrink-0">{c.mobile || '—'}</span>
                            </div>
                            {/* Row 3: Current Mapping */}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {c.cloud_user_name && (
                                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium border border-blue-200">
                                  Primary: {c.cloud_user_name}
                                </span>
                              )}
                              {c.sub_user_name && (
                                <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium border border-purple-200">
                                  Sub: {c.sub_user_name}
                                </span>
                              )}
                              {!c.cloud_user_name && !c.sub_user_name && (
                                <span className="text-xs text-gray-400 italic">Not mapped</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs border-b sticky top-0">
                        <tr>
                          <th className="px-4 py-3 border-r w-10">
                            <button onClick={toggleSelectAll}>
                              {selectedIds.size === customers.length
                                ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                : <Square className="h-4 w-4 text-gray-400" />}
                            </button>
                          </th>
                          <th className="px-4 py-3 border-r">Company</th>
                          <th className="px-4 py-3 border-r">Person</th>
                          <th className="px-4 py-3 border-r">Mobile</th>
                          <th className="px-4 py-3 border-r">Status</th>
                          <th className="px-4 py-3 border-r">Primary User</th>
                          <th className="px-4 py-3">Sub User</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {customers.map(c => (
                          <tr key={c.id}
                            onClick={() => toggleSelect(c.id)}
                            className={`cursor-pointer transition-colors ${selectedIds.has(c.id) ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                            <td className="px-4 py-3 border-r">
                              {selectedIds.has(c.id)
                                ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                : <Square className="h-4 w-4 text-gray-400" />}
                            </td>
                            <td className="px-4 py-3 border-r font-bold text-gray-900">{c.company}</td>
                            <td className="px-4 py-3 border-r text-gray-600">{c.person || '—'}</td>
                            <td className="px-4 py-3 border-r text-gray-600">{c.mobile || '—'}</td>
                            <td className="px-4 py-3 border-r">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                {c.status || 'N/A'}
                              </span>
                            </td>
                            <td className="px-4 py-3 border-r">
                              {c.cloud_user_name
                                ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium border border-blue-200">{c.cloud_user_name}</span>
                                : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {c.sub_user_name
                                ? <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium border border-purple-200">{c.sub_user_name}</span>
                                : <span className="text-xs text-gray-400">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="bg-white border-t px-4 py-2.5 flex items-center justify-between shrink-0">
                <span className="text-xs text-gray-500">
                  Page {page} of {totalPages} ({total} total)
                </span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="p-1.5 rounded-lg border hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="p-1.5 rounded-lg border hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
