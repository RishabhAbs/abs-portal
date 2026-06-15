import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Download, RefreshCw, X, Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { billingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Bill {
  id?: number;
  voucher: string;
  billing_company: string;
  bill_type: string;
  invoice_no: string;
  invoice_date: string;
  customer_name: string;
  reseller_name: string;
  group_name: string;
  grand_total: number;
  bill_status: string;
  no_followup: number;
  pay_status: string;
  pay_type: string;
  pay_date: string;
  pay_remarks: string;
}

type QuickFilter = 'all' | 'no_follow' | 'today' | 'after_today' | 'reseller';
type SortDir = 'asc' | 'desc' | null;

const BillReport: React.FC = () => {
  const navigate = useNavigate();
  const { canView } = useAuth();

  // Data
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);

  // Mobile header controls toggle
  const [showControls, setShowControls] = useState(false);

  // Filters
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [billStatus, setBillStatus] = useState('Pending');
  const [payStatus, setPayStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  // Detail modal
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);

  // Fetch bills
  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (billStatus && billStatus !== 'All') params.bill_status = billStatus;
      if (payStatus && payStatus !== 'All') params.pay_status = payStatus;
      if (appliedSearch) params.search = appliedSearch;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      if (quickFilter === 'no_follow') params.no_follow = true;
      if (quickFilter === 'today') params.today = true;
      if (quickFilter === 'after_today') params.after_today = true;
      if (quickFilter === 'reseller') params.reseller = true;

      const res = await billingApi.getBills(params);
      if (res.success) {
        setBills(res.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch bills:', err);
    } finally {
      setLoading(false);
    }
  }, [billStatus, payStatus, appliedSearch, startDate, endDate, quickFilter]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [quickFilter, appliedSearch, billStatus, payStatus, startDate, endDate]);

  // Sorting
  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortIndicator = (col: string) => {
    if (sortCol !== col) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  // Sorted + paginated data
  const sortedBills = useMemo(() => {
    let arr = [...bills];
    if (sortCol && sortDir) {
      arr.sort((a: any, b: any) => {
        const va = a[sortCol] ?? '';
        const vb = b[sortCol] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
        return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }
    return arr;
  }, [bills, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedBills.length / perPage));
  const paginatedBills = useMemo(() => {
    const start = (page - 1) * perPage;
    return sortedBills.slice(start, start + perPage);
  }, [sortedBills, page, perPage]);

  // Quick filter handler
  const handleQuickFilter = (f: QuickFilter) => {
    setQuickFilter(f);
    if (f === 'all') {
      setBillStatus('Pending');
    }
  };

  // Search
  const applySearch = () => {
    setAppliedSearch(search);
  };

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') applySearch();
  };

  // Export
  const exportToExcel = () => {
    const rows = sortedBills.map((b, i) => ({
      'Sr': i + 1,
      'Voucher': b.voucher,
      'Billing Company': b.billing_company,
      'Bill Type': b.bill_type,
      'Invoice No': b.invoice_no,
      'Invoice Date': b.invoice_date,
      'Company Name': b.customer_name,
      'Reseller Name': b.reseller_name,
      'Group': b.group_name,
      'Total with GST': b.grand_total,
      'Bill Status': b.bill_status,
      'No. FollowUp': b.no_followup,
      'Pay Status': b.pay_status,
      'Pay Type': b.pay_type,
      'Pay Date': b.pay_date,
      'Remarks': b.pay_remarks,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bill Report');
    XLSX.writeFile(wb, `Bill_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Format date
  const fmtDate = (d: string) => {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return d; }
  };

  // Badge helpers
  const billStatusBadge = (s: string) => {
    const lower = (s || '').toLowerCase();
    if (lower === 'paid') return 'bg-emerald-100 text-emerald-700';
    if (lower === 'partial') return 'bg-blue-100 text-blue-700';
    return 'bg-amber-100 text-amber-700'; // pending / default
  };

  const payStatusBadge = (s: string) => {
    const lower = (s || '').toLowerCase();
    if (lower === 'paid') return 'bg-green-100 text-green-700';
    return 'bg-red-100 text-red-700'; // pending / default
  };

  const quickBtnClass = (f: QuickFilter, active: boolean, color: string) =>
    `px-3 py-1 rounded text-xs font-medium transition-colors ${active ? color : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;

  const columns: { key: string; label: string; width?: string }[] = [
    { key: 'sr', label: 'Sr', width: 'w-10' },
    { key: 'voucher', label: 'Voucher', width: 'w-20' },
    { key: 'billing_company', label: 'Billing Company', width: 'w-32' },
    { key: 'bill_type', label: 'Bill Type', width: 'w-20' },
    { key: 'invoice_no', label: 'Invoice No', width: 'w-24' },
    { key: 'invoice_date', label: 'Invoice Date', width: 'w-24' },
    { key: 'customer_name', label: 'Company Name', width: 'w-40' },
    { key: 'reseller_name', label: 'Reseller Name', width: 'w-32' },
    { key: 'group_name', label: 'Group', width: 'w-24' },
    { key: 'grand_total', label: 'Total with GST', width: 'w-24' },
    { key: 'bill_status', label: 'Bill Status', width: 'w-20' },
    { key: 'no_followup', label: 'No. FollowUp', width: 'w-20' },
    { key: 'pay_status', label: 'Pay Status', width: 'w-20' },
    { key: 'pay_type', label: 'Pay Type', width: 'w-20' },
    { key: 'pay_date', label: 'Pay Date', width: 'w-24' },
    { key: 'pay_remarks', label: 'Remarks', width: 'w-32' },
  ];

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-gray-800">Bill Report</h1>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowControls(s => !s); setShowFilterPanel(false); }}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`} title="Search">
            <Search size={18} />
          </button>
          <button onClick={() => { setShowFilterPanel(s => !s); setShowControls(false); }}
            className={`p-2 rounded-lg transition-colors ${showFilterPanel ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`} title="Filter">
            <Filter size={18} />
          </button>
          <button onClick={exportToExcel} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Export Excel">
            <Download size={16} />
          </button>
          <button onClick={fetchBills} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="flex-none bg-white border-b border-gray-200">
        <div className="flex divide-x divide-gray-200">
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Bills</div>
            <div className="text-[14px] font-bold text-slate-700 tabular-nums mt-0.5">{sortedBills.length}</div>
          </div>
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Total</div>
            <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">
              ₹{sortedBills.reduce((s, b) => s + (Number(b.grand_total) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="px-3 py-2.5 flex flex-col items-end justify-center">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Status</div>
            <div className="text-[13px] font-bold text-slate-600 mt-0.5">{billStatus || 'All'}</div>
          </div>
        </div>
      </div>

      {/* ── Quick filter tabs ── */}
      <div className="flex-none bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
        {(['all','no_follow','today','after_today','reseller'] as const).map(f => {
          const labels: Record<string, string> = { all: 'All', no_follow: 'No Follow', today: 'Today', after_today: 'After Today', reseller: 'Reseller' };
          const colors: Record<string, string> = { all: 'bg-blue-500 text-white', no_follow: 'bg-orange-500 text-white', today: 'bg-green-500 text-white', after_today: 'bg-blue-600 text-white', reseller: 'bg-gray-600 text-white' };
          return (
            <button key={f} onClick={() => handleQuickFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${quickFilter === f ? colors[f] : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {labels[f]}
            </button>
          );
        })}
      </div>

      {/* ── Search bar (slide-down) ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-gray-200 px-3 py-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKey}
              placeholder="Search bills…" autoFocus
              className="w-full pl-8 pr-8 py-2.5 border border-gray-300 rounded-lg text-[14px] outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
            {search && (
              <button onClick={() => { setSearch(''); setAppliedSearch(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={applySearch} className="mt-2 w-full py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Search</button>
        </div>
      )}

      {/* ── Filter panel (slide-down) ── */}
      {showFilterPanel && (
        <div className="flex-none bg-slate-50 border-b border-gray-200 px-3 py-3 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 flex items-stretch border border-gray-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-gray-300 bg-slate-100">
                <span className="text-[10px] text-gray-500 font-bold uppercase">From</span>
              </div>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="flex-1 text-[13px] text-gray-700 outline-none bg-transparent px-2 py-1.5 min-w-0" />
            </div>
            <div className="flex-1 flex items-stretch border border-gray-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-gray-300 bg-slate-100">
                <span className="text-[10px] text-gray-500 font-bold uppercase">To</span>
              </div>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="flex-1 text-[13px] text-gray-700 outline-none bg-transparent px-2 py-1.5 min-w-0" />
            </div>
          </div>
          <div className="flex gap-2">
            <select value={billStatus} onChange={e => setBillStatus(e.target.value)}
              className="flex-1 text-[13px] border border-gray-300 rounded-lg px-3 py-2 bg-white outline-none">
              <option value="">All Bill Status</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
            </select>
            <select value={payStatus} onChange={e => setPayStatus(e.target.value)}
              className="flex-1 text-[13px] border border-gray-300 rounded-lg px-3 py-2 bg-white outline-none">
              <option value="">All Pay Status</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
            </select>
          </div>
          <button onClick={() => { setStartDate(''); setEndDate(''); setBillStatus('Pending'); setPayStatus(''); }}
            className="w-full py-2 text-[13px] text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 bg-white">
            Reset Filters
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto px-4 py-2">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={24} className="animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">Loading bills...</span>
            </div>
          </div>
        ) : paginatedBills.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <span className="text-sm text-gray-400">No bills found</span>
          </div>
        ) : (
          <>
            {/* Mobile flat list — visible only below sm breakpoint */}
            <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
              {paginatedBills.map((bill, idx) => {
                const billLower = (bill.bill_status || '').toLowerCase();
                const payLower = (bill.pay_status || '').toLowerCase();
                const billBadgeClass = billLower === 'paid' || billLower === 'settled'
                  ? 'bg-emerald-100 text-emerald-700'
                  : billLower === 'partial'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-700';
                const payBadgeClass = payLower === 'paid'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700';
                return (
                  <div
                    key={bill.id || idx}
                    className="border-b border-gray-200"
                    onClick={() => setSelectedBill(bill)}
                  >
                    <div className="flex items-start justify-between px-4 py-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <p className="font-bold text-gray-900 text-[15px] uppercase leading-tight truncate">
                          {bill.customer_name || '-'}
                        </p>
                        <p className="text-[13px] text-gray-500 mt-0.5">
                          {bill.invoice_date || '-'}&nbsp;&nbsp;|&nbsp;&nbsp;{bill.billing_company || '-'}&nbsp;&nbsp;#{bill.invoice_no || '-'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {bill.bill_status && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${billBadgeClass}`}>
                              {bill.bill_status}
                            </span>
                          )}
                          {bill.pay_status && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${payBadgeClass}`}>
                              {bill.pay_status}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[15px] font-medium text-gray-900 tabular-nums">
                          {bill.grand_total != null
                            ? `₹${Number(bill.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table — hidden on mobile, visible sm and above */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-gray-100">
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => col.key !== 'sr' && handleSort(col.key)}
                      className={`text-[11px] md:text-sm font-semibold text-gray-600 px-2 py-1.5 border border-gray-200 whitespace-nowrap ${col.key !== 'sr' ? 'cursor-pointer hover:bg-gray-200 select-none' : ''} ${col.width || ''}`}
                    >
                      {col.label}{sortIndicator(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedBills.map((bill, idx) => (
                  <tr
                    key={bill.id || idx}
                    onClick={() => setSelectedBill(bill)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 text-center text-gray-500">{(page - 1) * perPage + idx + 1}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 font-medium text-blue-600">{bill.voucher || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.billing_company || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.bill_type || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.invoice_no || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 whitespace-nowrap">{fmtDate(bill.invoice_date)}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 max-w-[160px] truncate" title={bill.customer_name}>{bill.customer_name || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.reseller_name || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.group_name || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 text-right font-medium">
                      {bill.grand_total != null ? Number(bill.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${billStatusBadge(bill.bill_status)}`}>
                        {bill.bill_status || '-'}
                      </span>
                    </td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 text-center">{bill.no_followup ?? 0}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${payStatusBadge(bill.pay_status)}`}>
                        {bill.pay_status || '-'}
                      </span>
                    </td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200">{bill.pay_type || '-'}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 whitespace-nowrap">{fmtDate(bill.pay_date)}</td>
                    <td className="text-xs md:text-sm px-2 py-1 border border-gray-200 max-w-[120px] truncate" title={bill.pay_remarks}>{bill.pay_remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            {/* end desktop table wrapper */}
          </>
        )}
      </div>

      {/* Mobile Grand Total — fixed above pagination */}
      {!loading && sortedBills.length > 0 && (
        <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
            <span className="text-sm tabular-nums font-semibold">{sortedBills.length} records</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Total Amount</div>
              <div className="text-[13px] font-bold text-blue-700 tabular-nums mt-0.5">
                ₹{sortedBills.reduce((s, b) => s + (Number(b.grand_total) || 0), 0)
                  .toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination — flex-none keeps it at bottom */}
      {!loading && sortedBills.length > 0 && (
        <div className="flex-none bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between text-xs print:hidden">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="hidden sm:inline">Showing</span>{(page - 1) * perPage + 1}-{Math.min(page * perPage, sortedBills.length)} of {sortedBills.length}
            <select
              value={perPage}
              onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-6 h-6 rounded text-xs ${page === pageNum ? 'bg-blue-500 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Bill Detail Modal */}
      {selectedBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pb-24 md:pb-4 overflow-y-auto" onClick={() => setSelectedBill(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-bold text-gray-800">Bill Details</h2>
              <button onClick={() => setSelectedBill(null)} className="p-1 rounded hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {[
                { label: 'Voucher', value: selectedBill.voucher },
                { label: 'Billing Company', value: selectedBill.billing_company },
                { label: 'Bill Type', value: selectedBill.bill_type },
                { label: 'Invoice No', value: selectedBill.invoice_no },
                { label: 'Invoice Date', value: fmtDate(selectedBill.invoice_date) },
                { label: 'Company Name', value: selectedBill.customer_name },
                { label: 'Reseller Name', value: selectedBill.reseller_name },
                { label: 'Group', value: selectedBill.group_name },
                { label: 'Total with GST', value: selectedBill.grand_total != null ? `₹ ${Number(selectedBill.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-' },
                { label: 'Bill Status', value: selectedBill.bill_status },
                { label: 'No. FollowUp', value: String(selectedBill.no_followup ?? 0) },
                { label: 'Pay Status', value: selectedBill.pay_status },
                { label: 'Pay Type', value: selectedBill.pay_type },
                { label: 'Pay Date', value: fmtDate(selectedBill.pay_date) },
                { label: 'Remarks', value: selectedBill.pay_remarks },
              ].map(({ label, value }) => (
                <div key={label} className="flex text-xs">
                  <span className="w-32 text-gray-500 font-medium flex-shrink-0">{label}</span>
                  <span className="text-gray-800">{value || '-'}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setSelectedBill(null)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillReport;
