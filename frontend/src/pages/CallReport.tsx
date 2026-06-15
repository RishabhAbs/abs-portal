import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { callsApi, usersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import CustomerNameLink from '../components/CustomerNameLink';

const CALL_STATUSES = ['Picked Up', 'Busy', 'Not Reachable', 'No Answer', 'Switched Off', 'Wrong Number'] as const;

const statusColors: Record<string, string> = {
    'Picked Up': 'bg-green-100 text-green-700',
    'Busy': 'bg-yellow-100 text-yellow-700',
    'Not Reachable': 'bg-red-100 text-red-700',
    'No Answer': 'bg-orange-100 text-orange-700',
    'Switched Off': 'bg-gray-200 text-gray-700',
    'Wrong Number': 'bg-red-200 text-red-800',
};

const CallReport: React.FC = () => {
    const { user, isAdmin } = useAuth();
    const { showError } = useToast();

    const [data, setData] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(20);
    const [loading, setLoading] = useState(false);

    const location = useLocation();
    const incomingSearch = (location.state as any)?.customerSearch || '';

    useEffect(() => {
        if (incomingSearch) {
            window.history.replaceState({}, document.title);
        }
    }, [incomingSearch]);

    // Filters
    const [search, setSearch] = useState(incomingSearch);
    const [appliedSearch, setAppliedSearch] = useState(incomingSearch);
    const [statusFilter, setStatusFilter] = useState('');
    const [userFilter, setUserFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    // Sorting
    const [sortBy, setSortBy] = useState<string>('call_date');
    const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

    const [users, setUsers] = useState<any[]>([]);

    useEffect(() => {
        usersApi.getAll().then(res => {
            const list = Array.isArray(res) ? res : (res as any)?.data || [];
            setUsers(list);
        }).catch(() => {});
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await callsApi.getAll(page, limit, {
                search: appliedSearch || undefined,
                status: statusFilter || undefined,
                user_name: userFilter || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            }, sortBy, sortOrder);
            setData(res.data || []);
            setTotal(res.total || 0);
        } catch (e: any) {
            showError('Error', e.message || 'Failed to fetch call report');
        } finally {
            setLoading(false);
        }
    }, [page, limit, appliedSearch, statusFilter, userFilter, dateFrom, dateTo, sortBy, sortOrder]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalPages = Math.ceil(total / limit);

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
        } else {
            setSortBy(field);
            setSortOrder('DESC');
        }
        setPage(1);
    };

    const handleSearch = () => {
        setAppliedSearch(search);
        setPage(1);
    };

    const clearFilters = () => {
        setSearch('');
        setAppliedSearch('');
        setStatusFilter('');
        setUserFilter('');
        setDateFrom('');
        setDateTo('');
        setPage(1);
    };

    const formatDate = (d: string) => {
        if (!d) return '-';
        try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch { return d; }
    };

    const parseResponses = (row: any) => {
        if (!row.call_responses) return null;
        try {
            return typeof row.call_responses === 'string' ? JSON.parse(row.call_responses) : row.call_responses;
        } catch { return null; }
    };

    const formatTime = (t: string) => {
        if (!t) return '-';
        try {
            const [h, m] = t.split(':');
            const hr = parseInt(h, 10);
            const ampm = hr >= 12 ? 'PM' : 'AM';
            return `${hr % 12 || 12}:${m} ${ampm}`;
        } catch { return t; }
    };

    return (
        <div className="flex flex-col h-full bg-white font-inter text-[12px] md:text-sm">
            {/* Standardized Compact Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-4">
                    <h1 className="text-base font-bold text-gray-800">Call Records</h1>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded border border-gray-200">
                        <span className="text-[10px] font-bold text-gray-500">{total} Totals</span>
                        {statusFilter && (
                            <>
                                <span className="text-[10px] text-gray-300">|</span>
                                <span className="text-[10px] font-bold text-blue-600 uppercase">{statusFilter}</span>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="Search customer, staff..."
                            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50/50"
                        />
                    </div>

                    <div className="flex items-center gap-1 px-1.5 py-1 bg-gray-50 rounded border border-gray-200">
                        <Calendar className="h-3 w-3 text-gray-400" />
                        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="bg-transparent border-none text-[10px] p-0 focus:ring-0 text-gray-600 w-24" />
                        <span className="text-gray-300 text-[9px] font-bold">-</span>
                        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="bg-transparent border-none text-[10px] p-0 focus:ring-0 text-gray-600 w-24" />
                    </div>

                    {isAdmin() && (
                        <select value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1); }} className="px-2 py-1.5 bg-white border border-gray-300 rounded text-[11px] font-medium focus:ring-1 focus:ring-blue-500">
                            <option value="">All Staff</option>
                            {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                    )}

                    <button onClick={fetchData} className="p-1.5 border border-gray-300 hover:bg-gray-50 rounded transition-all">
                        <RefreshCw className={`h-3.5 w-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    {(statusFilter || dateFrom || dateTo || userFilter || appliedSearch) && (
                        <button onClick={clearFilters} className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest px-2">
                            Reset
                        </button>
                    )}
                </div>
            </div>

            {/* Quick Filter Bar */}
            <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50/50 border-b border-gray-200 overflow-x-auto">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter mr-2">Quick:</span>
                {CALL_STATUSES.map(s => {
                    const isActive = statusFilter === s;
                    return (
                        <button 
                            key={s}
                            onClick={() => { setStatusFilter(isActive ? '' : s); setPage(1); }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all whitespace-nowrap border ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}
                        >
                            {s}
                        </button>
                    );
                })}
            </div>

            {/* Table - Matches Visit Dashboard grid/cell style */}
            <div className="flex-1 overflow-auto border-x border-gray-300">
                <table className="w-full border-collapse table-fixed text-[12px] md:text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-100 uppercase text-[10px] md:text-xs text-gray-700 font-bold border-b border-gray-300">
                        <tr>
                            <th onClick={() => handleSort('call_date')} className="w-[10%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200">
                                <div className="flex items-center gap-1">DATE {sortBy === 'call_date' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th onClick={() => handleSort('customer_name')} className="w-[22%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200 truncate">
                                <div className="flex items-center gap-1">CUSTOMER NAME {sortBy === 'customer_name' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th className="w-[10%] px-2 py-2 text-left border border-gray-300 truncate">PHONE NO</th>
                            <th onClick={() => handleSort('user_name')} className="w-[12%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200 truncate">
                                <div className="flex items-center gap-1">STAFF {sortBy === 'user_name' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th onClick={() => handleSort('call_status')} className="w-[10%] px-2 py-2 text-center border border-gray-300 cursor-pointer hover:bg-gray-200">
                                <div className="flex items-center justify-center gap-1">STATUS {sortBy === 'call_status' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th className="w-[12%] px-2 py-2 text-left border border-gray-300">INTEREST</th>
                            <th className="w-[24%] px-2 py-2 text-left border border-gray-300">NOTES</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="py-10 text-center text-gray-400 font-medium italic">Loading records...</td></tr>
                        ) : data.length === 0 ? (
                            <tr><td colSpan={7} className="py-10 text-center text-gray-400 font-medium italic">No records found matching filters</td></tr>
                        ) : (
                            data.map((row: any) => {
                                const resp = parseResponses(row);
                                return (
                                    <tr key={row.id} className="hover:bg-gray-50 border-b border-gray-300 bg-white text-gray-800">
                                        <td className="px-2 py-1 border border-gray-300">
                                            <div className="font-semibold text-gray-900">{formatDate(row.call_date)}</div>
                                            <div className="text-[10px] text-gray-400">{formatTime(row.call_time)}</div>
                                        </td>
                                        <td className="px-2 py-1 border border-gray-300 truncate font-semibold text-gray-900" title={row.customer_name}><CustomerNameLink customerId={(row as any).customer_id} name={row.customer_name} /></td>
                                        <td className="px-2 py-1 border border-gray-300 truncate" title={row.phone_no}>{row.phone_no || '-'}</td>
                                        <td className="px-2 py-1 border border-gray-300 truncate">{row.user_name || '-'}</td>
                                        <td className="px-2 py-1 border border-gray-300 text-center">
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${statusColors[row.call_status] || 'bg-gray-100 text-gray-600'}`}>
                                                {row.call_status}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1 border border-gray-300 truncate" title={resp?.interest || ''}>{resp?.interest || '-'}</td>
                                        <td className="px-2 py-1 border border-gray-300 truncate text-gray-700 italic text-[11px]" title={row.call_notes}>{row.call_notes || '-'}</td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Compact Pagination */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-300 bg-gray-50">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Page {page} of {totalPages || 1}</div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded border border-gray-300 bg-white disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setPage(p => Math.min(totalPages || 1, p + 1))} disabled={page >= (totalPages || 1)} className="p-1 rounded border border-gray-300 bg-white disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
            </div>
        </div>
    );
};

export default CallReport;
