import React, { useState, useEffect } from 'react';
import { Search, ChevronLeft, RefreshCw, Eye, Edit2, X, ChevronDown, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tdlApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';
import SwipeableCard from '../components/Shared/SwipeableCard';

interface RequirementData {
    id: number;
    tdl_id: string;
    requirement: string;
    amount: number;
    development_days: number;
    dev_allotment_date: string | null;
    stats: {
        no_of_dev_tasks: number;
        no_of_imp_tasks: number;
        development_percent: number;
        implementation_percent: number;
        overdue_days: number;
    };
    req_status: string;
    customer_name?: string;
    project_name?: string;
    tasks?: any[];
}

const RequirementReport: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [requirements, setRequirements] = useState<RequirementData[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const { showError } = useToast();
    const { canView, canEdit } = useAuth();
    const [viewReq, setViewReq] = useState<RequirementData | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [expandedReqs, setExpandedReqs] = useState<number[]>([]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const data = await tdlApi.getAllCustomizations();
            const allReqs: RequirementData[] = [];
            data.forEach((tdl: any) => {
                if (tdl.requirements && tdl.requirements.length > 0) {
                    tdl.requirements.forEach((r: any) => {
                        allReqs.push({
                            ...r,
                            tdl_id: tdl.id,
                            customer_name: tdl.customer_name || tdl.person_name || 'N/A',
                            project_name: tdl.project_name || 'N/A',
                        });
                    });
                }
            });
            setRequirements(allReqs);
        } catch (err: any) {
            showError('Error', err.message || 'Failed to load requirements');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const filtered = requirements.filter(r =>
        r.requirement?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.project_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB') : '-';

    const statusColor = (status: string) => {
        switch (status) {
            case 'Completed': return 'bg-green-50 text-green-700 border-green-200';
            case 'In Progress': return 'bg-blue-50 text-blue-700 border-blue-200';
            default: return 'bg-gray-50 text-gray-600 border-gray-200';
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <div className="bg-white border-b px-3 py-2.5 md:px-4 md:py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <button onClick={() => navigate(-1)} className="p-1.5 bg-gray-50 border rounded-lg hover:bg-gray-100 transition-colors">
                            <ChevronLeft className="h-4 w-4 md:h-5 md:w-5 text-gray-600" />
                        </button>
                        <div>
                            <h1 className="text-base md:text-xl font-bold text-gray-900">Requirements ({filtered.length})</h1>
                            <p className="text-xs text-gray-500 hidden md:block">Overview of all requirements and status</p>
                        </div>
                    </div>
                    {/* Mobile Actions */}
                    <div className="flex items-center gap-2 md:hidden">
                        <button onClick={() => setShowFilters(!showFilters)} className={`p-2 border rounded-lg ${showFilters ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-600'}`}>
                            <Search className="h-4 w-4" />
                        </button>
                        <button onClick={fetchData} className="p-2 bg-white border rounded-lg text-gray-600">
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    {/* Desktop Search */}
                    <div className="hidden md:flex items-center gap-3">
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search requirements..."
                                className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                            />
                        </div>
                        <button onClick={fetchData} className="p-2 bg-gray-50 border rounded-lg hover:bg-gray-100 text-gray-600 transition-colors">
                            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Mobile Search (Collapsible) */}
                {showFilters && (
                    <div className="mt-3 pt-3 border-t md:hidden">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search requirements..."
                                className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <div className="bg-white">
                    {/* ── Desktop Table ── */}
                    <table className="hidden md:table w-full border-collapse bg-white">
                        <thead className="bg-[#f8f9fa] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                            <tr>
                                <th className="px-3 py-2 border border-gray-200 text-left text-sm font-bold text-gray-600 uppercase w-10">Sr</th>
                                <th className="px-3 py-2 border border-gray-200 text-left text-sm font-bold text-gray-600 uppercase">Requirement</th>
                                <th className="px-3 py-2 border border-gray-200 text-left text-sm font-bold text-gray-600 uppercase">Customer</th>
                                <th className="px-3 py-2 border border-gray-200 text-right text-sm font-bold text-gray-600 uppercase">Amount</th>
                                <th className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-600 uppercase">Dev Days</th>
                                <th className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-600 uppercase">Overdue</th>
                                <th className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-600 uppercase">Tasks</th>
                                <th className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-600 uppercase">Status</th>
                                <th className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-600 uppercase">Allotment</th>
                                <th className="px-3 py-2 border border-gray-200 text-right text-sm font-bold text-gray-600 uppercase">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr><td colSpan={10} className="px-6 py-12 text-center text-sm text-gray-400">Loading requirements...</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={10} className="px-6 py-12 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <ClipboardList className="h-8 w-8 text-gray-300" />
                                        <p className="text-sm text-gray-400">No requirements found</p>
                                    </div>
                                </td></tr>
                            ) : filtered.map((r, i) => (
                                <tr key={r.id} className="hover:bg-blue-50/50 transition-colors group">
                                    <td className="px-3 py-2 border border-gray-200 text-sm text-gray-500 font-medium">{i + 1}</td>
                                    <td className="px-3 py-2 border border-gray-200 max-w-[280px]">
                                        <div className="text-sm font-bold text-gray-800 line-clamp-2">{r.requirement || 'N/A'}</div>
                                    </td>
                                    <td className="px-3 py-2 border border-gray-200 text-sm text-gray-600 font-medium">{r.customer_name}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-right text-sm font-mono text-gray-700 font-bold">₹{(r.amount || 0).toLocaleString('en-IN')}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center text-sm text-gray-600 font-medium">{r.development_days || 0}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">
                                        {r.stats?.overdue_days > 0 ? (
                                            <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-100">{r.stats.overdue_days}d</span>
                                        ) : <span className="text-gray-400">-</span>}
                                    </td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">
                                        <span className="text-[10px] font-bold text-gray-600">D:{r.stats?.no_of_dev_tasks || 0}</span>
                                        <span className="text-gray-300 mx-0.5">/</span>
                                        <span className="text-[10px] font-bold text-gray-400">I:{r.stats?.no_of_imp_tasks || 0}</span>
                                    </td>
                                    <td className="px-3 py-2 border border-gray-200 text-center">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${statusColor(r.req_status)}`}>
                                            {r.req_status || 'Pending'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 border border-gray-200 text-center text-sm text-gray-500 font-medium">{formatDate(r.dev_allotment_date)}</td>
                                    <td className="px-3 py-2 border border-gray-200 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {canView('tdl') && (
                                                <button onClick={() => setViewReq(r)}
                                                    className="px-2 py-1 text-[10px] font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded transition-colors" title="View Details">
                                                    <Eye className="h-3 w-3 inline mr-0.5" /> View
                                                </button>
                                            )}
                                            {canEdit('tdl') && (
                                                <button onClick={() => navigate(`/tdl/tasks/${r.tdl_id}/${r.id}`)}
                                                    className="px-2 py-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded transition-colors" title="Manage Tasks">
                                                    <Edit2 className="h-3 w-3 inline mr-0.5" /> Tasks
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* ── Mobile Swipeable Cards ── */}
                    <div className="md:hidden p-3 space-y-2.5 bg-gray-50/50 pb-24">
                        {loading ? (
                            <div className="py-8 text-center text-sm text-gray-400">Loading requirements...</div>
                        ) : filtered.length === 0 ? (
                            <div className="py-8 text-center">
                                <ClipboardList className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-400">No requirements found</p>
                            </div>
                        ) : filtered.map(r => {
                            const isExpanded = expandedReqs.includes(r.id);
                            const swipeActions = [
                                ...(canView('tdl') ? [{ label: 'View', color: 'bg-purple-500', onClick: () => setViewReq(r) }] : []),
                                ...(canEdit('tdl') ? [{ label: 'Tasks', color: 'bg-indigo-500', onClick: () => navigate(`/tdl/tasks/${r.tdl_id}/${r.id}`) }] : []),
                            ];

                            return (
                                <SwipeableCard key={r.id} actions={swipeActions}>
                                    <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
                                        <div
                                            className="cursor-pointer active:bg-gray-50 select-none"
                                            onClick={() => setExpandedReqs(prev =>
                                                prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id]
                                            )}
                                        >
                                            {/* Row 1: Requirement Name | Status */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="text-sm font-bold text-gray-900 line-clamp-2 flex-1">{r.requirement || 'N/A'}</div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${statusColor(r.req_status)}`}>
                                                        {r.req_status || 'Pending'}
                                                    </span>
                                                    <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                </div>
                                            </div>

                                            {/* Row 2: Customer */}
                                            <div className="text-sm text-gray-600 truncate mt-1">{r.customer_name}</div>

                                            {/* Row 3: Amount | Dev Days | Overdue */}
                                            <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-900">
                                                <span className="font-mono font-bold">₹{(r.amount || 0).toLocaleString('en-IN')}</span>
                                                <span className="text-gray-300">|</span>
                                                <span>{r.development_days || 0}d dev</span>
                                                {r.stats?.overdue_days > 0 && (
                                                    <>
                                                        <span className="text-gray-300">|</span>
                                                        <span className="font-bold text-red-600">{r.stats.overdue_days}d overdue</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Expanded Details */}
                                        {isExpanded && (
                                            <div className="mt-2 pt-2 border-t border-gray-100 space-y-1 text-sm text-gray-900">
                                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                                    <div><strong>Dev Tasks:</strong> {r.stats?.no_of_dev_tasks || 0}</div>
                                                    <div><strong>Imp Tasks:</strong> {r.stats?.no_of_imp_tasks || 0}</div>
                                                    <div><strong>Dev %:</strong> {r.stats?.development_percent || 0}%</div>
                                                    <div><strong>Imp %:</strong> {r.stats?.implementation_percent || 0}%</div>
                                                    <div><strong>Allotment:</strong> {formatDate(r.dev_allotment_date)}</div>
                                                    <div><strong>Project:</strong> {r.project_name}</div>
                                                </div>
                                                <div className="pt-1.5 flex gap-2">
                                                    {canView('tdl') && (
                                                        <button onClick={() => setViewReq(r)}
                                                            className="flex-1 py-1.5 text-sm font-semibold text-purple-700 bg-purple-50 rounded-lg active:bg-purple-100">
                                                            View Details
                                                        </button>
                                                    )}
                                                    {canEdit('tdl') && (
                                                        <button onClick={() => navigate(`/tdl/tasks/${r.tdl_id}/${r.id}`)}
                                                            className="flex-1 py-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 rounded-lg active:bg-indigo-100">
                                                            Manage Tasks
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </SwipeableCard>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* View Modal */}
            {viewReq && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                        <div className="p-4 border-b flex justify-between items-center">
                            <h3 className="font-bold text-gray-800">Requirement Details</h3>
                            <button onClick={() => setViewReq(null)}><X className="h-5 w-5 text-gray-400" /></button>
                        </div>
                        <div className="p-4 space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-4">
                                <div><span className="text-gray-500">Requirement:</span><div className="font-medium">{viewReq.requirement}</div></div>
                                <div><span className="text-gray-500">Customer:</span><div className="font-medium">{viewReq.customer_name}</div></div>
                                <div><span className="text-gray-500">Amount:</span><div className="font-medium">₹{(viewReq.amount || 0).toLocaleString('en-IN')}</div></div>
                                <div><span className="text-gray-500">Dev Days:</span><div className="font-medium">{viewReq.development_days || 0}</div></div>
                                <div><span className="text-gray-500">Status:</span><div className="font-medium">{viewReq.req_status || 'Pending'}</div></div>
                                <div><span className="text-gray-500">Allotment:</span><div className="font-medium">{formatDate(viewReq.dev_allotment_date)}</div></div>
                                <div><span className="text-gray-500">Dev Tasks:</span><div className="font-medium">{viewReq.stats?.no_of_dev_tasks || 0}</div></div>
                                <div><span className="text-gray-500">Imp Tasks:</span><div className="font-medium">{viewReq.stats?.no_of_imp_tasks || 0}</div></div>
                                <div><span className="text-gray-500">Dev %:</span><div className="font-medium">{viewReq.stats?.development_percent || 0}%</div></div>
                                <div><span className="text-gray-500">Imp %:</span><div className="font-medium">{viewReq.stats?.implementation_percent || 0}%</div></div>
                                <div><span className="text-gray-500">Overdue:</span><div className="font-medium text-red-600">{viewReq.stats?.overdue_days || 0} days</div></div>
                            </div>
                        </div>
                        <div className="p-4 border-t flex justify-end">
                            <button
                                onClick={() => { setViewReq(null); navigate(`/tdl/tasks/${viewReq.tdl_id}/${viewReq.id}`); }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
                            >
                                Manage Tasks
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RequirementReport;
