import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Calendar, Phone, Building2, User, Tag, Clock, ChevronLeft, ChevronRight, RefreshCw, AlertCircle, FileSpreadsheet, FileText, Copy } from 'lucide-react';
import { tallyApi } from '../services/api';
import UpdateExpiryModal from '../components/Tally/UpdateExpiryModal';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface ExpiryRenewPageProps {
    customerType: 'our' | 'not_our';
}

const ExpiryRenewPage: React.FC<ExpiryRenewPageProps> = ({ customerType }) => {
    const { showError, showSuccess } = useToast();
    const { canCheckPermission, isAdmin } = useAuth();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
    const [page, setPage] = useState(1);
    const [limit] = useState(50);
    const [search, setSearch] = useState('');
    const [activeStatus, setActiveStatus] = useState('All');
    const [allCount, setAllCount] = useState(0);

    
    // Default Dates: First day of current month to last day of current month (Corrected for timezone)
    const getDefaultDates = () => {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        // Use local components to avoid UTC shifting
        const formatLocal = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        return {
            from: formatLocal(first),
            to: formatLocal(last)
        };
    };


    const [dateFrom, setDateFrom] = useState(getDefaultDates().from);
    const [dateTo, setDateTo] = useState(getDefaultDates().to);
    
    const [selectedTally, setSelectedTally] = useState<any>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const statuses = [
        { name: 'All', color: '#28a745' }, // Green
        { name: 'Pending', color: '#007bff' }, // Blue
        { name: 'Pending-Order', color: '#fd7e14' }, // Orange
        { name: 'Interested', color: '#00ccff' }, // Light Blue
        { name: 'Not-Interested', color: '#6610f2' }, // Purple
        { name: 'Call-Back Later', color: '#ffc107' }, // Yellow
        { name: 'Wrong-No', color: '#e83e8c' }, // Pink
        { name: 'Not-Responding', color: '#20c997' }, // Greenish
        { name: 'Business-Closed', color: '#dc3545' }, // Red
        { name: 'Software-Change', color: '#ff8c00' }, // Dark Orange
        { name: 'Not In Use', color: '#c0392b' }, // Dark Red
        { name: 'Reseller', color: '#922b21' } // Darker Red
    ];

    const [activeSearch, setActiveSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => {
            setActiveSearch(search);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchReport = async () => {
        setLoading(true);
        try {
            const response = await tallyApi.getExpiryReport({
                customer_type: customerType,
                expiry_status: activeStatus,
                search: activeSearch,
                page,
                limit,
                date_from: dateFrom,
                date_to: dateTo
            });
            setData(response.data);
            setTotal(response.total);
            setAllCount(response.allCount || response.total); // Fallback to total if allCount not provided
            setStatusCounts(response.statusCounts);

        } catch (error: any) {
            showError('Error', error.message || 'Failed to fetch report');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, [customerType, activeStatus, page, activeSearch]);

    // Auto-sync stale serials with the Tally API in the background, then refetch.
    // "Stale" = never checked OR checked more than 7 days ago. Limited to 10 per page
    // load to avoid hammering the Tally API. Sequential with a small delay between
    // calls so we don't trip rate limits.
    const [autoSyncing, setAutoSyncing] = useState(false);
    const autoSyncedKey = useRef<string>('');
    useEffect(() => {
        if (loading || data.length === 0 || autoSyncing) return;
        const key = `${customerType}|${activeStatus}|${page}|${activeSearch}`;
        if (autoSyncedKey.current === key) return; // already synced this view

        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const stale = data.filter((r: any) => {
            if (!r.tallyserial) return false;
            if (!r.tally_api_checked_at) return true;
            const ts = new Date(r.tally_api_checked_at).getTime();
            return Date.now() - ts > SEVEN_DAYS_MS;
        }).slice(0, 10);

        if (stale.length === 0) return;
        autoSyncedKey.current = key;

        (async () => {
            setAutoSyncing(true);
            for (const row of stale) {
                try {
                    await tallyApi.syncSerial(row.tallyserial);
                    await new Promise(r => setTimeout(r, 800));
                } catch { /* ignore individual failures */ }
            }
            setAutoSyncing(false);
            // Refresh once all synced
            fetchReport();
        })();
    }, [loading, data, customerType, activeStatus, page, activeSearch]);

    const handleSearch = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setPage(1);
        setActiveSearch(search);
        fetchReport();
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Copied', `${label} copied to clipboard`);
        }).catch(() => {
            showError('Error', 'Failed to copy to clipboard');
        });
    };

    const handleExport = async (type: 'excel' | 'pdf') => {
        try {
            if (type === 'excel') {
                const { utils, writeFile } = await import('xlsx');
                
                showSuccess('Exporting', 'Fetching all matching records...');
                
                // Fetch ALL matching activities for export (no pagination)
                const response = await tallyApi.getExpiryReport({
                    customer_type: customerType,
                    expiry_status: activeStatus,
                    search,
                    page: 1,
                    limit: 10000, // Large limit for export
                    date_from: dateFrom,
                    date_to: dateTo
                });

                if (!response.data || response.data.length === 0) {
                    showError('Export Failed', 'No data found to export');
                    return;
                }

                const exportData = response.data.map((item: any, idx: number) => ({
                    'Sr No': idx + 1,
                    'Tally Serial': item.tallyserial,
                    'Expiry Date': item.tallyexpirydate ? new Date(item.tallyexpirydate).toLocaleDateString('en-GB') : 'N/A',
                    'Company Name': item.company_name,
                    'Group': item.staff_name || 'admin',
                    'Reseller': item.reseller_name || '',
                    'Person': item.customer_person || 'N/A',

                    'Mobile': item.customer_mobile || 'N/A',
                    'Flavor': item.flavor_name || 'Silver',
                    'Next Date': item.next_follow_date ? new Date(item.next_follow_date).toLocaleDateString('en-GB') : '-',
                    'Remark': item.expiry_remarks || '-'
                }));

                const ws = utils.json_to_sheet(exportData);
                const wb = utils.book_new();
                utils.book_append_sheet(wb, ws, 'Expiry Report');
                writeFile(wb, `Tally_Expiry_Report_${activeStatus}_${new Date().toISOString().split('T')[0]}.xlsx`);
                showSuccess('Success', 'Excel export complete');
            } else {
                // simple PDF export using window.print() or just notify it's coming
                showSuccess('Exporting', 'Preparing PDF for print...');
                window.print();
            }
        } catch (error: any) {
            showError('Export Failed', error.message || 'Error generating export');
        }
    };


    return (
        <div className="flex flex-col h-full bg-[#f8f9fa]">
            {/* Header Section */}
            <div className="bg-white border-b border-gray-200 px-6 py-3">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-gray-800">
                            {customerType === 'our' ? 'Our Tally' : 'Not Our Tally'} Expiry Report
                        </h1>
                        <span className="text-[13px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded italic">
                            {dateFrom} to {dateTo} - {activeStatus}
                        </span>
                    </div>

                    {isAdmin() && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleExport('excel')}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 transition-colors text-[13px] font-bold text-gray-700"
                            >
                                <FileSpreadsheet className="h-4 w-4 text-green-700" />
                                Excel
                            </button>
                            <button
                                onClick={() => handleExport('pdf')}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 transition-colors text-[13px] font-bold text-gray-700"
                            >
                                <FileText className="h-4 w-4 text-red-700" />
                                PDF
                            </button>
                        </div>
                    )}
                </div>


                {/* Filters and Status Row - Ultra Compact */}
                <div className="flex flex-col gap-3">
                    {/* Status Tags */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {statuses.map(s => (
                            <button
                                key={s.name}
                                onClick={() => { setActiveStatus(s.name); setPage(1); }}
                                style={{ 
                                    backgroundColor: activeStatus === s.name ? s.color : '#fff',
                                    borderColor: s.color,
                                    color: activeStatus === s.name ? '#fff' : s.color
                                }}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1 ${activeStatus === s.name ? 'shadow-sm' : 'hover:bg-opacity-10'}`}
                            >
                                {s.name} <span className="opacity-80 text-[10px]">({s.name === 'All' ? allCount : (statusCounts[s.name] || 0)})</span>

                            </button>
                        ))}
                    </div>

                    {/* Filter Inputs Bar */}
                    <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 md:gap-4 bg-gray-50 p-2 rounded-lg border border-gray-100">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Calendar className="h-4 w-4 text-gray-400 hidden md:block" />
                            <div className="flex items-center gap-1">
                                <input
                                    type="date"
                                    className="px-2 py-1.5 border border-gray-300 rounded text-[12px] md:text-[13px] focus:ring-1 focus:ring-green-500 w-[130px] md:w-36 outline-none"
                                    value={dateFrom}
                                    onChange={e => setDateFrom(e.target.value)}
                                />
                                <span className="text-gray-400 text-xs">to</span>
                                <input
                                    type="date"
                                    className="px-2 py-1.5 border border-gray-300 rounded text-[12px] md:text-[13px] focus:ring-1 focus:ring-green-500 w-[130px] md:w-36 outline-none"
                                    value={dateTo}
                                    onChange={e => setDateTo(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={handleSearch}
                                className="px-4 py-1.5 bg-green-600 text-white rounded text-[12px] md:text-[13px] font-bold hover:bg-green-700 transition-colors shadow-sm"
                            >
                                Update
                            </button>
                        </div>

                        <div className="h-px md:h-6 w-full md:w-px bg-gray-300"></div>

                        <div className="flex-1 flex items-center gap-2">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Search details..."
                                    className="pl-8 pr-3 py-1.5 border border-sky-200 rounded text-[12px] md:text-[13px] outline-none focus:ring-1 focus:ring-sky-500 w-full"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            handleSearch();
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Table Section */}
            <div className="flex-1 overflow-auto px-2 md:px-6 py-2 md:py-4">
                <div className="bg-white border border-gray-300 rounded-sm shadow-sm">
                    <table className="w-full text-left border-collapse table-fixed border-hidden">
                        <thead>
                            <tr className="bg-[#f1f5f9] border-b border-gray-300">
                                <th className="px-2 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[45px] text-center">Sr</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[110px]">Tally Serial</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[100px]">Expiry Date</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 min-w-[200px]">Company Name</th>

                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[100px]">Group</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[100px]">Reseller</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[100px]">Person</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[110px]">Mobile</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[90px]">Flavor</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[100px]">Next Date</th>
                                <th className="px-3 py-2 text-[12px] font-bold text-gray-800 border border-gray-300 w-[150px]">Remark</th>
                            </tr>
                        </thead>

                        <tbody className="bg-white">
                            {loading ? (
                                Array.from({ length: 15 }).map((_, i) => (
                                    <tr key={i}>
                                        {Array.from({ length: 11 }).map((_, j) => (
                                            <td key={j} className="px-3 py-2 border border-gray-300 bg-gray-50/20"><div className="h-4 bg-gray-100 rounded w-full animate-pulse"></div></td>
                                        ))}
                                    </tr>
                                ))
                            ) : data.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="px-4 py-12 text-center bg-gray-50/10 border border-gray-300">
                                        <div className="flex flex-col items-center gap-2 text-gray-400">
                                            <AlertCircle className="h-10 w-10 opacity-20" />
                                            <p className="text-sm">No records found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : data.map((item, idx) => (
                                <tr key={item.id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-2 py-1.5 text-[12px] text-gray-600 border border-gray-300 text-center">{(page - 1) * limit + idx + 1}</td>
                                    <td className="px-3 py-1.5 border border-gray-300 group/cell">
                                        <div className="flex items-center justify-between gap-1">
                                            <button 
                                                onClick={() => { setSelectedTally(item); setIsModalOpen(true); }}
                                                className="text-blue-700 font-bold hover:underline text-[12px] whitespace-nowrap"
                                            >
                                                {item.tallyserial}
                                            </button>
                                            {canCheckPermission(customerType === 'our' ? 'expiry_renew_our' : 'expiry_renew_not_our', 'copy') && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(item.tallyserial, 'Serial'); }}
                                                    className="p-1 text-gray-300 hover:text-blue-500 opacity-0 group-hover/cell:opacity-100 transition-opacity"
                                                    title="Copy Serial"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 whitespace-nowrap">
                                        {item.tallyexpirydate ? new Date(item.tallyexpirydate).toLocaleDateString('en-GB') : 'N/A'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] font-bold text-gray-900 border border-gray-300 truncate group/company">
                                        <div className="flex items-center justify-between gap-1">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); navigate('/search', { state: { customerId: item.customerid } }); }}
                                                className="hover:underline text-blue-700 hover:text-blue-900 cursor-pointer text-left truncate" 
                                                title={item.company_name}
                                            >
                                                {item.company_name}
                                            </button>
                                            {canCheckPermission(customerType === 'our' ? 'expiry_renew_our' : 'expiry_renew_not_our', 'copy') && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(item.company_name, 'Company Name'); }}
                                                    className="p-1 text-gray-300 hover:text-blue-500 opacity-0 group-hover/company:opacity-100 transition-opacity"
                                                    title="Copy Company"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </td>

                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 truncate" title={item.staff_name}>
                                        {item.staff_name || 'admin'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 truncate" title={item.reseller_name}>
                                        {item.reseller_name || '—'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 truncate" title={item.customer_person}>
                                        {item.customer_person || 'N/A'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 whitespace-nowrap group/mobile">
                                        <div className="flex items-center justify-between gap-1">
                                            <span>{item.customer_mobile || 'N/A'}</span>
                                            {item.customer_mobile && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(item.customer_mobile, 'Mobile'); }}
                                                    className="p-1 text-gray-300 hover:text-blue-500 opacity-0 group-hover/mobile:opacity-100 transition-opacity"
                                                    title="Copy Mobile"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300">
                                        {item.flavor_name || 'Silver'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-700 border border-gray-300 whitespace-nowrap">
                                        {item.next_follow_date ? new Date(item.next_follow_date).toLocaleDateString('en-GB') : '-'}
                                    </td>
                                    <td className="px-3 py-1.5 text-[12px] text-gray-600 border border-gray-300 truncate" title={item.expiry_remarks}>
                                        {item.expiry_remarks || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>

                    </table>

                    {/* Footer Info */}
                    <div className="px-4 py-2 bg-[#f8f9fa] border-t border-gray-300 flex items-center justify-between">
                         <p className="text-[13px] text-gray-600">
                            Showing <span className="font-bold">{(page - 1) * limit + 1}</span> to <span className="font-bold">{Math.min(page * limit, total)}</span> of <span className="font-bold">{total}</span> results
                        </p>
                        
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-[13px] font-bold px-3">Page 1 of {Math.ceil(total / limit) || 1}</span>
                            <button
                                onClick={() => setPage(p => (p * limit < total ? p + 1 : p))}
                                disabled={page * limit >= total}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Update Modal */}
            <UpdateExpiryModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={fetchReport}
                data={selectedTally}
            />
        </div>
    );
};

export default ExpiryRenewPage;
