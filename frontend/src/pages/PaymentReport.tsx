import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Download, RefreshCw, X, Calendar, Edit2, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { billingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Payment {
    id: number;
    bill_id: number;
    invoice_no: string;
    invoice_date: string;
    customer_name: string;
    billing_company: string;
    payment_ledger: string;
    payment_type: string;
    instrument: string;
    amount: number;
    tds: number;
    bank: string;
    created_at: string;
    added_by: string;
    bank_date: string;
    status: string;
    payment_complete: string;
}

const PAGE_SIZES = [10, 25, 50];

const PaymentReport: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

    // Data
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('Pending');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [showFilterModal, setShowFilterModal] = useState(false);

    // Pagination
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Mobile header controls toggle
    const [showControls, setShowControls] = useState(false);

    // Update modal
    const [editPayment, setEditPayment] = useState<Payment | null>(null);
    const [editStatus, setEditStatus] = useState('');
    const [editBankDate, setEditBankDate] = useState('');
    const [editPaymentComplete, setEditPaymentComplete] = useState('No');
    const [updating, setUpdating] = useState(false);

    const fetchPayments = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
            if (searchTerm) params.search = searchTerm;
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            const res = await billingApi.getPayments(params);
            if (res.success) {
                setPayments(res.data || []);
            }
        } catch (e) {
            console.error('Failed to fetch payments', e);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, searchTerm, startDate, endDate]);

    useEffect(() => {
        fetchPayments();
    }, [fetchPayments]);

    // Client-side search filter (API may also filter, but double-check locally)
    const filtered = payments.filter(p => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            (p.invoice_no || '').toLowerCase().includes(term) ||
            (p.customer_name || '').toLowerCase().includes(term) ||
            (p.billing_company || '').toLowerCase().includes(term) ||
            (p.payment_ledger || '').toLowerCase().includes(term) ||
            (p.added_by || '').toLowerCase().includes(term) ||
            (p.bank || '').toLowerCase().includes(term)
        );
    });

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => { setPage(1); }, [searchTerm, statusFilter, startDate, endDate, pageSize]);

    // Format helpers
    const fmtDate = (d: string | null | undefined) => {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return '-';
            return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch { return '-'; }
    };

    const fmtAmount = (v: number | null | undefined) => {
        if (v == null) return '-';
        return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const statusBadge = (s: string) => {
        const base = 'px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap';
        switch ((s || '').toLowerCase()) {
            case 'completed': return <span className={`${base} bg-emerald-100 text-emerald-700`}>Completed</span>;
            case 'rejected': return <span className={`${base} bg-red-100 text-red-700`}>Rejected</span>;
            default: return <span className={`${base} bg-amber-100 text-amber-700`}>Pending</span>;
        }
    };

    const completeBadge = (v: string) => {
        const yes = (v || '').toLowerCase() === 'yes';
        return yes
            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">Yes</span>
            : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">No</span>;
    };

    // Export
    const exportToExcel = () => {
        const rows = filtered.map((p, i) => ({
            'Sr': i + 1,
            'Invoice No': p.invoice_no,
            'Invoice Date': fmtDate(p.invoice_date),
            'Company Name': p.customer_name || p.billing_company,
            'Payment Ledger': p.payment_ledger,
            'Payment Type': p.payment_type,
            'Instrument': p.instrument,
            'Amount': p.amount,
            'TDS': p.tds,
            'Bank': p.bank,
            'Date Added': fmtDate(p.created_at),
            'Added By': p.added_by,
            'Bank Date': fmtDate(p.bank_date),
            'Status': p.status,
            'Payment Complete': p.payment_complete,
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Payment Report');
        XLSX.writeFile(wb, `Payment_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    // Update modal handlers
    const openEditModal = (p: Payment) => {
        setEditPayment(p);
        setEditStatus(p.status || 'Pending');
        setEditBankDate(p.bank_date ? p.bank_date.slice(0, 10) : '');
        setEditPaymentComplete(p.payment_complete || 'No');
    };

    const closeEditModal = () => {
        setEditPayment(null);
    };

    const handleUpdate = async () => {
        if (!editPayment) return;
        setUpdating(true);
        try {
            await billingApi.updatePayment(editPayment.id, {
                status: editStatus,
                bank_date: editBankDate || null,
                payment_complete: editPaymentComplete,
            });
            closeEditModal();
            fetchPayments();
        } catch (e) {
            console.error('Update failed', e);
        } finally {
            setUpdating(false);
        }
    };

    const applyFilters = () => {
        setShowFilterModal(false);
        fetchPayments();
    };

    const clearFilters = () => {
        setStatusFilter('Pending');
        setStartDate('');
        setEndDate('');
        setShowFilterModal(false);
    };

    // Filter description
    const filterDesc = [
        statusFilter && statusFilter !== 'all' ? `Status: ${statusFilter}` : null,
        startDate ? `From: ${fmtDate(startDate)}` : null,
        endDate ? `To: ${fmtDate(endDate)}` : null,
    ].filter(Boolean).join(' | ');

    return (
        <div className="flex flex-col bg-white fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>

            {/* ── Header bar ── */}
            <div className="flex-none bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
                        <ChevronLeft size={20} />
                    </button>
                    <h1 className="text-[17px] font-bold text-gray-800">Payment Report</h1>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => { setShowControls(s => !s); }}
                        className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`} title="Search">
                        <Search size={18} />
                    </button>
                    <button onClick={() => setShowFilterModal(true)}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Filter">
                        <Filter size={18} />
                    </button>
                    <button onClick={exportToExcel} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Export">
                        <Download size={16} />
                    </button>
                    <button onClick={fetchPayments} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* ── Stats bar — desktop only; mobile shows the same totals in the Grand Total bar above pagination ── */}
            <div className="hidden sm:block flex-none bg-white border-b border-gray-200">
                <div className="flex divide-x divide-gray-200">
                    <div className="flex-1 px-3 py-2.5">
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Records</div>
                        <div className="text-[14px] font-bold text-slate-700 tabular-nums mt-0.5">{filtered.length}</div>
                    </div>
                    <div className="flex-1 px-3 py-2.5">
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Amount</div>
                        <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">₹{fmtAmount(filtered.reduce((s, p) => s + (Number(p.amount) || 0), 0))}</div>
                    </div>
                    <div className="px-3 py-2.5 flex flex-col items-end justify-center">
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">TDS</div>
                        <div className="text-[14px] font-bold text-slate-600 tabular-nums mt-0.5">₹{fmtAmount(filtered.reduce((s, p) => s + (Number(p.tds) || 0), 0))}</div>
                    </div>
                </div>
            </div>

            {/* ── Search bar (slide-down) ── */}
            {showControls && (
                <div className="flex-none bg-slate-50 border-b border-gray-200 px-3 py-2.5">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="text" placeholder="Search…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} autoFocus
                            className="w-full pl-8 pr-8 py-2.5 border border-gray-300 rounded-lg text-[14px] outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                        )}
                    </div>
                </div>
            )}

            {/* Mobile flat list — visible only below sm breakpoint */}
            <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
                {loading ? (
                    <div className="text-center py-10 text-sm text-gray-400">Loading...</div>
                ) : paginated.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">No payment records found</div>
                ) : (
                    <>
                        {paginated.map((p) => {
                            const isPaid = (p.payment_complete || '').toLowerCase() === 'yes';
                            return (
                                <div
                                    key={p.id}
                                    className="border-b border-gray-200"
                                    onClick={() => openEditModal(p)}
                                >
                                    <div className="flex items-start justify-between px-4 py-3">
                                        <div className="flex-1 min-w-0 pr-3">
                                            <p className="font-bold text-gray-900 text-[15px] uppercase leading-tight truncate">
                                                {p.customer_name || p.billing_company || '-'}
                                            </p>
                                            <p className="text-[13px] text-gray-500 mt-0.5">
                                                {fmtDate(p.invoice_date)}&nbsp;&nbsp;|&nbsp;&nbsp;{p.payment_type || '-'}&nbsp;&nbsp;#{p.invoice_no || '-'}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                {p.instrument && (
                                                    <span className="text-[11px] text-gray-500">{p.instrument}</span>
                                                )}
                                                {isPaid
                                                    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">Paid</span>
                                                    : <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">Pending</span>
                                                }
                                                {statusBadge(p.status)}
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-[15px] font-medium text-gray-900 tabular-nums">₹{fmtAmount(p.amount)}</p>
                                            {p.tds ? <p className="text-[12px] text-gray-500 tabular-nums mt-0.5">TDS ₹{fmtAmount(p.tds)}</p> : null}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>

            {/* Table — hidden on mobile, visible sm and above */}
            <div className="hidden sm:block flex-1 overflow-auto px-4 py-2">
                <table className="w-full border-collapse min-w-[1400px] text-sm">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-gray-100">
                            {['Sr', 'Invoice No', 'Invoice Date', 'Company Name', 'Payment Ledger', 'Payment Type', 'Instrument', 'Amount', 'TDS', 'Bank', 'Date Added', 'Added By', 'Bank Date', 'Status', 'Update', 'Payment Complete'].map(h => (
                                <th key={h} className="border border-gray-200 px-2 py-1.5 text-[11px] md:text-sm font-semibold text-gray-600 text-left whitespace-nowrap">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={16} className="text-center py-10 text-xs text-gray-400">Loading...</td>
                            </tr>
                        ) : paginated.length === 0 ? (
                            <tr>
                                <td colSpan={16} className="text-center py-10 text-xs text-gray-400">No payment records found</td>
                            </tr>
                        ) : (
                            paginated.map((p, idx) => (
                                <tr key={p.id} className="hover:bg-blue-50/40">
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{(page - 1) * pageSize + idx + 1}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm font-medium text-gray-800">{p.invoice_no || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600 whitespace-nowrap">{fmtDate(p.invoice_date)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-700 max-w-[180px] truncate">{p.customer_name || p.billing_company || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{p.payment_ledger || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{p.payment_type || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{p.instrument || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-800 font-medium text-right whitespace-nowrap">{fmtAmount(p.amount)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600 text-right whitespace-nowrap">{fmtAmount(p.tds)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{p.bank || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600 whitespace-nowrap">{fmtDate(p.created_at)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600">{p.added_by || '-'}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-gray-600 whitespace-nowrap">{fmtDate(p.bank_date)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm">{statusBadge(p.status)}</td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-center">
                                        <button
                                            onClick={() => openEditModal(p)}
                                            className="p-1 rounded hover:bg-blue-100 text-blue-600"
                                            title="Update payment"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                    </td>
                                    <td className="border border-gray-200 px-2 py-1 text-xs md:text-sm text-center">{completeBadge(p.payment_complete)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            {/* end desktop table wrapper */}

            {/* Mobile Grand Total — fixed above pagination */}
            {!loading && filtered.length > 0 && (
                <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
                    <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
                        <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
                        <span className="text-sm tabular-nums font-semibold">{filtered.length} records</span>
                    </div>
                    <div className="flex divide-x divide-gray-200 bg-white">
                        <div className="flex-1 px-3 py-2.5">
                            <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Amount</div>
                            <div className="text-[13px] font-bold text-blue-700 tabular-nums mt-0.5">₹{fmtAmount(filtered.reduce((s, p) => s + (Number(p.amount) || 0), 0))}</div>
                        </div>
                        <div className="flex-1 px-3 py-2.5">
                            <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">TDS</div>
                            <div className="text-[13px] font-bold text-slate-600 tabular-nums mt-0.5">₹{fmtAmount(filtered.reduce((s, p) => s + (Number(p.tds) || 0), 0))}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Pagination — flex-none keeps it at bottom */}
            <div className="flex-none bg-white border-t px-4 py-2 flex items-center justify-between text-xs print:hidden">
                <span className="text-gray-500">
                    {filtered.length === 0 ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)}`} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-1 rounded border text-xs disabled:opacity-40 hover:bg-gray-50"
                    >
                        <ChevronLeft size={14} />
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
                                className={`w-7 h-7 rounded border text-xs ${page === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
                            >
                                {pageNum}
                            </button>
                        );
                    })}
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="p-1 rounded border text-xs disabled:opacity-40 hover:bg-gray-50"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {/* Filter Modal */}
            {showFilterModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowFilterModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <h3 className="text-sm font-semibold text-gray-800">Filters</h3>
                            <button onClick={() => setShowFilterModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
                                <select
                                    value={statusFilter}
                                    onChange={e => setStatusFilter(e.target.value)}
                                    className="w-full border rounded px-2 py-1.5 text-xs"
                                >
                                    <option value="all">All</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Rejected">Rejected</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Start Date</label>
                                <div className="relative">
                                    <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={e => setStartDate(e.target.value)}
                                        className="w-full border rounded pl-7 pr-2 py-1.5 text-xs"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">End Date</label>
                                <div className="relative">
                                    <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={e => setEndDate(e.target.value)}
                                        className="w-full border rounded pl-7 pr-2 py-1.5 text-xs"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 rounded-b-lg">
                            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">Clear filters</button>
                            <button onClick={applyFilters} className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Apply</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Modal */}
            {editPayment && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={closeEditModal}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <h3 className="text-sm font-semibold text-gray-800">Update Payment</h3>
                            <button onClick={closeEditModal} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="text-xs text-gray-500 mb-2">
                                Invoice: <span className="font-medium text-gray-700">{editPayment.invoice_no}</span> &mdash; {editPayment.customer_name || editPayment.billing_company}
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
                                <select
                                    value={editStatus}
                                    onChange={e => setEditStatus(e.target.value)}
                                    className="w-full border rounded px-2 py-1.5 text-xs"
                                >
                                    <option value="Pending">Pending</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Rejected">Rejected</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Bank Date</label>
                                <div className="relative">
                                    <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="date"
                                        value={editBankDate}
                                        onChange={e => setEditBankDate(e.target.value)}
                                        className="w-full border rounded pl-7 pr-2 py-1.5 text-xs"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Payment Complete</label>
                                <select
                                    value={editPaymentComplete}
                                    onChange={e => setEditPaymentComplete(e.target.value)}
                                    className="w-full border rounded px-2 py-1.5 text-xs"
                                >
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
                            <button onClick={closeEditModal} className="px-4 py-1.5 text-xs border rounded hover:bg-gray-100">Cancel</button>
                            <button
                                onClick={handleUpdate}
                                disabled={updating}
                                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {updating ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PaymentReport;
