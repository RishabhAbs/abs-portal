import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw, ChevronUp, ChevronDown, X, AlertTriangle } from 'lucide-react';
import { customersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

type SortField = 'company' | 'email' | 'gstin' | 'pincode';
type SortOrder = 'ASC' | 'DESC';

const InactiveCustomers: React.FC = () => {
  const { isAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('company');
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');
  const [loading, setLoading] = useState(false);

  const [confirmCustomer, setConfirmCustomer] = useState<any>(null);
  const [reactivating, setReactivating] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customersApi.getInactive({
        search: appliedSearch || undefined,
        page,
        limit,
        sortBy,
        sortOrder,
      });
      setData(res.data || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to load inactive customers');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, limit, sortBy, sortOrder, showError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAppliedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortOrder('ASC');
    }
    setPage(1);
  };

  const handleReactivate = async () => {
    if (!confirmCustomer) return;
    setReactivating(true);
    try {
      await customersApi.reactivate(confirmCustomer.id);
      showSuccess('Reactivated', `${confirmCustomer.company} is now Active`);
      setConfirmCustomer(null);
      fetchData();
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to reactivate');
    } finally {
      setReactivating(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (!isAdmin()) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-800">Admin Only</h2>
          <p className="text-sm text-gray-600 mt-1">Only administrators can view inactive customers.</p>
        </div>
      </div>
    );
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <ChevronDown className="h-3 w-3 opacity-30 inline" />;
    return sortOrder === 'ASC'
      ? <ChevronUp className="h-3 w-3 inline text-blue-600" />
      : <ChevronDown className="h-3 w-3 inline text-blue-600" />;
  };

  return (
    <div className="p-3 md:p-5 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">Inactive Customers</h1>
          <p className="text-xs text-gray-500 mt-0.5">Admin-only · click a customer to reactivate</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company, email, gstin, mobile..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none w-72"
            />
          </div>
          {(search || appliedSearch) && (
            <button
              onClick={() => { setSearch(''); setAppliedSearch(''); setPage(1); }}
              className="px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Clear
            </button>
          )}
          <button
            onClick={fetchData}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs text-gray-500 uppercase">
                <th className="px-3 py-2.5 text-left font-semibold">#</th>
                <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-gray-800" onClick={() => toggleSort('company')}>Company <SortIcon field="company" /></th>
                <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-gray-800" onClick={() => toggleSort('email')}>Email <SortIcon field="email" /></th>
                <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-gray-800" onClick={() => toggleSort('gstin')}>GSTIN <SortIcon field="gstin" /></th>
                <th className="px-3 py-2.5 text-left font-semibold">Mobile</th>
                <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-gray-800" onClick={() => toggleSort('pincode')}>Pincode <SortIcon field="pincode" /></th>
                <th className="px-3 py-2.5 text-left font-semibold">Area</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  <div className="animate-spin h-6 w-6 border-b-2 border-blue-500 rounded-full mx-auto mb-2" />
                  Loading...
                </td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-gray-400 text-sm">
                  No inactive customers found.
                </td></tr>
              ) : data.map((c, i) => (
                <tr
                  key={c.id}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                  onClick={() => setConfirmCustomer(c)}
                >
                  <td className="px-3 py-2 text-gray-400 text-xs">{(page - 1) * limit + i + 1}</td>
                  <td className="px-3 py-2 font-medium text-blue-700">{c.company || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.email || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">{c.gstin || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">{c.mobile || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">{c.pincode || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.area || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs">
          <span className="text-gray-600">
            {total === 0 ? '0 records' : `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
          </span>
          <div className="flex gap-1 items-center">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 text-gray-600">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Reactivate Confirmation Popup */}
      {confirmCustomer && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !reactivating && setConfirmCustomer(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-900">Wanna make this customer active?</h3>
                <p className="text-sm text-gray-500 mt-1">Click Yes to proceed.</p>
              </div>
              <button
                onClick={() => !reactivating && setConfirmCustomer(null)}
                className="p-1 hover:bg-gray-100 rounded"
                disabled={reactivating}
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 my-4 space-y-1 text-xs">
              <div><span className="text-gray-500">Company:</span> <span className="font-semibold text-gray-900">{confirmCustomer.company}</span></div>
              {confirmCustomer.email && <div><span className="text-gray-500">Email:</span> <span className="text-gray-700">{confirmCustomer.email}</span></div>}
              {confirmCustomer.gstin && <div><span className="text-gray-500">GSTIN:</span> <span className="text-gray-700 font-mono">{confirmCustomer.gstin}</span></div>}
              {confirmCustomer.mobile && <div><span className="text-gray-500">Mobile:</span> <span className="text-gray-700 font-mono">{confirmCustomer.mobile}</span></div>}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmCustomer(null)}
                disabled={reactivating}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                No
              </button>
              <button
                onClick={handleReactivate}
                disabled={reactivating}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {reactivating ? 'Reactivating...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InactiveCustomers;
