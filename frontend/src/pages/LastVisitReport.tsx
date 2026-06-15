import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChevronLeft, MapPin, Search, Phone, UserPlus, X, Info, Calendar, User, Hash, MessageSquare, ChevronRight, Filter, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { customersApi, usersApi, visitsApi, callsApi, serviceCallsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';
import CustomerNameLink from '../components/CustomerNameLink';

interface VisitReportRow {
    id: string;
    customer_id: number;
    customer_name: string;
    group: string;
    person_name: string;
    phone_no: string;
    pincode: string;
    area: string;
    city: string;
    state: string;
    last_visit_date: string;
    last_visit_person: string;
    last_visit_remark: string;
    aging_days: number;
    reseller_name?: string;
    loyalty?: string;
    conversion_probability?: string;
    // Tracking Details
    e_invoice?: string;
    business_type?: string;
    accounts_person_type?: string;
    account_contact_id?: string;
    it_person?: string;
    it_person_id?: string;
    ca_name?: string;
    ca_id?: string;
    business_description?: string;
    e_way_bill?: string;
    connected_banking?: string;
    whatsapp_enabled?: string;
    customisation?: string;
    tally_slow?: string;
    customer_behaviour?: string;
    // Pending Data
    pending_visit_person?: string;
    pending_visit_date?: string;
    status: string;
}

const LastVisitReport: React.FC<{ segment?: string }> = ({ segment: propSegment }) => {
    const navigate = useNavigate();
    const { user, canCreate, canView, canDelete } = useAuth();
    const { showError, showSuccess } = useToast();
    const showErrorRef = useRef(showError);
    showErrorRef.current = showError;
    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState<VisitReportRow[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const incomingSearch = (location.state as any)?.customerSearch || '';

    // Clear location state after consuming to prevent stale filters on back-navigation
    useEffect(() => {
        if (incomingSearch) {
            window.history.replaceState({}, document.title);
        }
    }, []);

    // Pagination State
    const [page, setPage] = useState(1);
    const [limit] = useState(50);
    const [total, setTotal] = useState(0);

    // Sync state with URL params when they change
    const segmentParam = propSegment || searchParams.get('segment') || 'our';
    const isOurSegment = segmentParam !== 'not_our';

    // Connect Modal / Wizard State
    const [connectModal, setConnectModal] = useState<{ customer: VisitReportRow } | null>(null);
    const [wizardStep, setWizardStep] = useState(1);
    const [callConfirmation, setCallConfirmation] = useState<{ name: string; phone: string } | null>(null);
    const [infoModal, setInfoModal] = useState<VisitReportRow | null>(null);

    // Filter state
    const [showFilterPopup, setShowFilterPopup] = useState(false);
    const [searchQuery, setSearchQuery] = useState(incomingSearch);

    // Applied filters
    const [appliedFilters, setAppliedFilters] = useState({
        search: incomingSearch,
        group: '',
        pincode: '',
        area: '',
        state: '',
        date_from: '',
        date_to: '',
        last_visit_person: '',
        aging: 'all' as 'all' | '30' | '60' | '90' | '180'
    });
    // Dropdown data for filters
    const [groups, setGroups] = useState<any[]>([]);
    const [states, setStates] = useState<any[]>([]);

    // FIX: Reset page when segment changes
    useEffect(() => {
        setPage(1);
    }, [segmentParam]);

    const [connectForm, setConnectForm] = useState({
        type: 'Visit' as 'Call' | 'Visit',
        assign_to: '',
        deadline: new Date().toISOString().split('T')[0],
        remark: '',
        create_visit_task: false
    });
    const [users, setUsers] = useState<any[]>([]);

    // Call Flow State
    const [callFlowActive, setCallFlowActive] = useState(false);
    const [callWizardStep, setCallWizardStep] = useState(0);
    const [callDecision, setCallDecision] = useState<'' | 'Accepted' | 'Rejected'>('');
    // For Rejected branch: holds the specific reason (Not Reachable / Busy / etc.)
    const [rejectionReason, setRejectionReason] = useState('');
    const [callNotes, setCallNotes] = useState('');
    const [callResponses, setCallResponses] = useState({
        interest: '',
        behavior: '',
        followUp: '',
        leadType: '',
        specialCases: [] as string[],
        productInterest: '',
    });

    // Lead creation toggle (only shown on Accepted branch). When the call goes
    // well, the staff can promote the conversation to a Lead — assigned to
    // themself by default, or transferred to a colleague who holds the matching
    // my_requirements permission for the chosen lead type.
    const LEAD_TYPES = ['Cloud', 'Tally', 'TDL', 'Web/App'] as const;
    const leadKeyOf = (lt: string): 'cloud' | 'tally' | 'tdl' | 'webapp' | null => {
        const t = (lt || '').toLowerCase();
        if (t === 'cloud') return 'cloud';
        if (t === 'tally') return 'tally';
        if (t === 'tdl') return 'tdl';
        if (t === 'web/app' || t === 'webapp' || t === 'web' || t === 'app') return 'webapp';
        return null;
    };
    // Map the Product Interest dropdown back to the lead-system category so
    // the user doesn't have to pick the same thing twice.
    const productToLeadType = (p: string): string => {
        switch (p) {
            case 'Tally Prime': return 'Tally';
            case 'Tally on Cloud': return 'Cloud';
            case 'TDL / Customization': return 'TDL';
            case 'ABS Suite': return 'Web/App';
            default: return '';
        }
    };
    const [createLead, setCreateLead] = useState(false);
    const [leadType, setLeadType] = useState('');
    const [leadAssignTo, setLeadAssignTo] = useState('');
    const [leadRemark, setLeadRemark] = useState('');

    const canConnect = (row: VisitReportRow) => {
        const isOur = row.status === 'Active';
        return canCreate(isOur ? 'visits_our' : 'visits_not_our');
    };

    // Sorting
    const [sortBy, setSortBy] = useState<string>('lastvisitdate');
    const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const currentSegment = segmentParam || 'all';
            let backendStatus = 'all';
            if (currentSegment === 'our') backendStatus = 'Our Customer';
            else if (currentSegment === 'not_our') backendStatus = 'Not Our Customer';

            const [customersResult, usersResult] = await Promise.allSettled([
                customersApi.getAll(
                    page,
                    limit,
                    appliedFilters.search,
                    backendStatus,
                    false,
                    appliedFilters.aging === 'all' ? '' : appliedFilters.aging,
                    appliedFilters.area,
                    appliedFilters.pincode,
                    appliedFilters.group === 'all' ? '' : appliedFilters.group,
                    appliedFilters.state === 'all' ? '' : appliedFilters.state,
                    appliedFilters.date_from,
                    appliedFilters.date_to,
                    appliedFilters.last_visit_person,
                    sortBy,
                    sortOrder,
                    // Hide customers that already have a pending Connect visit so
                    // this dashboard stays a clean "needs visit" queue.
                    true
                ),
                // Unguarded endpoint; getAll requires users.view and silently
                // empties this list for non-admins.
                usersApi.getBasic(),
            ]);

            const customersRes = customersResult.status === 'fulfilled' ? customersResult.value : { data: [], total: 0 };
            const usersRes = usersResult.status === 'fulfilled' ? usersResult.value : [];

            const customers = customersRes.data || [];
            setTotal(customersRes.total || 0);
            setUsers(Array.isArray(usersRes) ? usersRes : usersRes?.data || []);
            
            const uniqueGroups = Array.from(new Set(customers.map((c: any) => c.group_name).filter(Boolean)));
            const uniqueStates = Array.from(new Set(customers.map((c: any) => c.state_name || c.state).filter(Boolean)));
            setGroups(uniqueGroups.map(g => ({ name: g })));
            setStates(uniqueStates.map(s => ({ name: s })));

            const rows: VisitReportRow[] = customers.map((c: any) => ({
                ...c,
                id: c.id.toString(),
                customer_id: c.id,
                customer_name: c.company || '-',
                group: c.group_name || '-',
                person_name: c.person || '-',
                phone_no: c.mobile || '-',
                pincode: c.pincode || '-',
                area: c.area || '-',
                city: c.city || '-',
                state: c.state || '-',
                last_visit_date: (c.lastvisitdate && c.lastvisitdate !== '0000-00-00' && c.lastvisitdate !== '0000-00-00 00:00:00') ? new Date(c.lastvisitdate).toLocaleDateString('en-GB') : 'Never',
                last_visit_person: c.lastvisitperson_name || '-',
                last_visit_remark: c.lastvisitremark || '-',
                aging_days: c.aging_days || 0,
                reseller_name: c.reseller_name || '',
                pending_visit_person: c.pending_visit_person,
                pending_visit_date: c.pending_visit_date
            }));

            setReportData(rows);
        } catch (err: any) {
            showErrorRef.current('Error', 'Failed to load report data');
        } finally {
            setLoading(false);
        }
    }, [segmentParam, searchParams, appliedFilters, page, limit, canView, sortBy, sortOrder]);

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
        } else {
            setSortBy(field);
            setSortOrder('DESC');
        }
        setPage(1);
    };

    useEffect(() => {
        fetchData();
    }, [fetchData, page, appliedFilters, segmentParam]);

    const handleSegmentChange = (newSegment: 'our' | 'not_our') => {
        setSearchParams({ segment: newSegment });
    };

    const openConnectModal = (row: VisitReportRow) => {
        setConnectModal({ customer: row });
        setWizardStep(0);
        setConnectForm({
            type: 'Visit',
            assign_to: '',
            deadline: new Date().toISOString().split('T')[0],
            remark: '',
            create_visit_task: false
        });
    };

    const handleConnectSave = async () => {
        if (!connectModal) return;
        setLoading(true);
        try {
            await visitsApi.create({
                customer_id: connectModal.customer.customer_id,
                user_name: connectForm.assign_to,
                visit_type: connectForm.type as 'Visit' | 'Call',
            });
            showSuccess('Assigned', 'Task assigned successfully');
            setConnectModal(null);
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to create task');
        } finally {
            setLoading(false);
        }
    };

    const resetCallState = () => {
        setCallFlowActive(false);
        setCallWizardStep(0);
        setCallDecision('');
        setRejectionReason('');
        setCallNotes('');
        setCallResponses({ interest: '', behavior: '', followUp: '', leadType: '', specialCases: [], productInterest: '' });
        setCreateLead(false);
        setLeadType('');
        setLeadAssignTo('');
        setLeadRemark('');
    };

    const handleCallSave = async () => {
        if (!connectModal || !callDecision) return;
        // Map the new Accepted/Rejected UI back to the legacy call_status string the
        // backend already understands. Accepted → 'Picked Up'. Rejected → the chosen reason.
        const status = callDecision === 'Accepted' ? 'Picked Up' : (rejectionReason || 'Rejected');
        if (callDecision === 'Rejected' && !rejectionReason) return;
        // Lead creation requires a lead type. Block save until picked.
        if (callDecision === 'Accepted' && createLead && !leadType) {
            showError('Lead Type Required', 'Pick a Lead Type to create the lead');
            return;
        }
        setLoading(true);
        try {
            await callsApi.create({
                customer_id: connectModal.customer.customer_id,
                customer_name: connectModal.customer.customer_name,
                phone_no: connectModal.customer.phone_no,
                user_name: connectForm.assign_to,
                call_status: status,
                call_notes: callNotes,
                call_responses: callDecision === 'Accepted' ? callResponses : undefined,
            });

            // Promote to Lead if the staff opted-in. Default assignee is the current user.
            if (callDecision === 'Accepted' && createLead && leadType) {
                const phone = (connectModal.customer.phone_no || '').replace(/[^0-9]/g, '').slice(-10);
                if (phone.length === 10) {
                    try {
                        await serviceCallsApi.create({
                            mobile_no: phone,
                            contact_person: connectModal.customer.customer_name || undefined,
                            customer_id: connectModal.customer.customer_id || undefined,
                            entry_type: 'Lead',
                            lead_type: leadType,
                            service_type: leadType,
                            remark: leadRemark.trim() || callNotes || `Lead from call · ${callResponses.productInterest || 'general enquiry'}`,
                            assign_to: leadAssignTo || user?.name || undefined,
                        });
                        showSuccess('Lead Created', `Lead assigned to ${leadAssignTo || user?.name || 'you'}`);
                    } catch (leadErr: any) {
                        // Don't block the call save — surface lead failure separately.
                        showError('Lead Create Failed', leadErr.message || 'Call saved, but lead could not be created');
                    }
                } else {
                    showError('Invalid Phone', 'Cannot create lead: customer phone is not a valid 10-digit number');
                }
            }

            showSuccess('Call Logged', 'Call record saved successfully');
            setConnectModal(null);
            resetCallState();
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to save call');
        } finally {
            setLoading(false);
        }
    };

    const applySearch = () => {
        setAppliedFilters(prev => ({ ...prev, search: searchQuery }));
        setPage(1);
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') applySearch();
    };

    const resetFilters = () => {
        const cleared = { search: '', group: '', pincode: '', area: '', state: '', date_from: '', date_to: '', last_visit_person: '', aging: 'all' as const };
        setAppliedFilters(cleared);
        setSearchQuery('');
        setPage(1);
    };

    const filterConfig: FilterConfig[] = [
        { key: 'group', label: 'Group', type: 'select', options: [{ value: '', label: 'All Groups' }, ...groups.map(g => ({ value: g.name, label: g.name }))] },
        { key: 'state', label: 'State', type: 'select', options: [{ value: '', label: 'All States' }, ...states.map(s => ({ value: s.name, label: s.name }))] },
        { key: 'area', label: 'Area', type: 'text', placeholder: 'Search Area' },
        { key: 'pincode', label: 'Pincode', type: 'text', placeholder: 'Search Pincode' },
        { key: 'last_visit_person', label: 'Last Visit By', type: 'select', options: [{ value: '', label: 'All Staff' }, ...users.map(u => ({ value: u.name, label: u.name }))] },
        { key: 'aging', label: 'Aging', type: 'select', options: [
            { value: 'all', label: 'All' },
            { value: '30', label: '30+ Days' },
            { value: '60', label: '60+ Days' },
            { value: '90', label: '90+ Days' },
            { value: '180', label: '180+ Days' }
        ]},
        { key: 'date_from', label: 'Date From', type: 'date' },
        { key: 'date_to', label: 'Date To', type: 'date' },
    ];

    const hasActiveFilters = appliedFilters.search || appliedFilters.group || appliedFilters.pincode || appliedFilters.area || appliedFilters.state || appliedFilters.date_from || appliedFilters.date_to || appliedFilters.last_visit_person || appliedFilters.aging !== 'all';
    const totalPages = Math.ceil(total / limit);

    return (
        <div className="flex flex-col h-full bg-white font-inter text-[12px] md:text-sm">
            {/* Standardized Header (Matches Activities Style) */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-4">
                    <h1 className="text-base font-bold text-gray-800">Visit Dashboard</h1>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded border border-gray-200">
                        <span className="text-[10px] font-bold text-gray-500">{total} Entries</span>
                        <span className="text-[10px] text-gray-300">|</span>
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-tighter">{segmentParam === 'not_our' ? 'NOC' : 'OC'} Mode</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Switcher removed as pages are now separate */}
                    
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Search identity..."
                            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-gray-50/50"
                        />
                    </div>

                    <button 
                        onClick={() => setShowFilterPopup(true)} 
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-bold uppercase transition-all ${hasActiveFilters ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                    >
                        <Filter className="h-3.5 w-3.5" />
                        Filter
                    </button>

                    <button onClick={fetchData} className="p-1.5 border border-gray-300 hover:bg-gray-50 rounded transition-all">
                        <RefreshCw className={`h-3.5 w-3.5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            <FilterModal
                isOpen={showFilterPopup}
                onClose={() => setShowFilterPopup(false)}
                title="Filter View"
                config={filterConfig}
                currentFilters={appliedFilters}
                onApply={(newFilters) => {
                    setAppliedFilters(prev => ({ ...prev, ...newFilters }));
                    setPage(1);
                    setShowFilterPopup(false);
                }}
                onReset={() => {
                    const resetPart = { group: '', pincode: '', area: '', state: '', date_from: '', date_to: '', last_visit_person: '', aging: 'all' as const };
                    setAppliedFilters(prev => ({ ...prev, ...resetPart }));
                    setPage(1);
                    setShowFilterPopup(false);
                }}
            />

            {/* ─────────── MOBILE CARD VIEW ─────────── */}
            <div className="md:hidden flex-1 overflow-auto bg-gray-50/50 px-3 pt-2 pb-24 space-y-2">
                {loading ? (
                    <div className="py-10 text-center text-sm text-gray-400 italic">Loading records…</div>
                ) : reportData.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-400 italic">No records found matching current group/filters</div>
                ) : (
                    reportData.map((row) => {
                        const agingColor = row.aging_days > 90 ? 'bg-red-100 text-red-700 border-red-200'
                            : row.aging_days > 30 ? 'bg-orange-100 text-orange-700 border-orange-200'
                            : 'bg-emerald-100 text-emerald-700 border-emerald-200';
                        return (
                            <div key={row.id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                {/* Top row — name + days badge */}
                                <div className="px-3 py-2 flex items-start justify-between gap-2 border-b border-gray-100">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[14px] font-semibold text-gray-900 truncate">
                                            <CustomerNameLink customerId={(row as any).customer_id} name={row.customer_name} />
                                        </div>
                                        {row.group && (
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 mt-0.5 truncate">{row.group}</div>
                                        )}
                                    </div>
                                    <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${agingColor}`}>
                                        {row.aging_days}d
                                    </span>
                                </div>

                                {/* Body — key fields, two-column compact grid */}
                                <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                                    {row.person_name && (
                                        <div className="col-span-1 min-w-0">
                                            <div className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide">Person</div>
                                            <div className="text-gray-800 truncate">{row.person_name}</div>
                                        </div>
                                    )}
                                    {row.phone_no && (
                                        <div className="col-span-1 min-w-0">
                                            <div className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide">Phone</div>
                                            <a href={`tel:${row.phone_no}`} className="text-blue-600 truncate block">{row.phone_no}</a>
                                        </div>
                                    )}
                                    {(row.area || row.state) && (
                                        <div className="col-span-2 min-w-0">
                                            <div className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide">Area</div>
                                            <div className="text-gray-700 truncate">{[row.area, row.state, row.pincode].filter(Boolean).join(' · ')}</div>
                                        </div>
                                    )}
                                    {row.last_visit_date && (
                                        <div className="col-span-2 min-w-0">
                                            <div className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide">Last visit</div>
                                            <div className="text-gray-700 truncate">
                                                {row.last_visit_date}
                                                {row.last_visit_person && <span className="text-gray-400 italic"> · {row.last_visit_person}</span>}
                                            </div>
                                        </div>
                                    )}
                                    {row.last_visit_remark && (
                                        <div className="col-span-2 min-w-0">
                                            <div className="text-[9px] font-semibold uppercase text-gray-400 tracking-wide">Remark</div>
                                            <div className="text-gray-600 italic line-clamp-2">{row.last_visit_remark}</div>
                                        </div>
                                    )}
                                </div>

                                {/* Action — full-width connect */}
                                {canConnect(row) && (
                                    <button
                                        onClick={() => openConnectModal(row)}
                                        className="w-full py-2 bg-gray-900 text-white text-[12px] font-semibold uppercase tracking-wide hover:bg-black transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Phone className="h-3.5 w-3.5" />
                                        Connect
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* ─────────── DESKTOP TABLE ─────────── */}
            {/* Ultra-High Density Table Coverage (Matches Activities page) */}
            <div className="hidden md:block flex-1 overflow-auto border-x border-gray-300">
                <table className="w-full border-collapse table-fixed text-[12px] md:text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-100 uppercase text-[10px] md:text-xs text-gray-700 font-bold border-b border-gray-300">
                        <tr>
                            <th onClick={() => handleSort('company')} className="w-[15%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200 truncate">
                                <div className="flex items-center gap-1">CUSTOMER NAME {sortBy === 'company' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th onClick={() => handleSort('group')} className="w-[8%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200 truncate">
                                <div className="flex items-center gap-1">GROUP {sortBy === 'group' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th className="w-[8%] px-2 py-2 text-left border border-gray-300 truncate">PERSON NAME</th>
                            <th className="w-[10%] px-2 py-2 text-left border border-gray-300 truncate">PHONE NO</th>
                            <th className="w-[6%] px-2 py-2 text-left border border-gray-300">PINCODE</th>
                            <th className="w-[8%] px-2 py-2 text-left border border-gray-300 truncate">AREA</th>
                            <th className="w-[7%] px-2 py-2 text-left border border-gray-300 truncate">STATE</th>
                            <th onClick={() => handleSort('lastvisitdate')} className="w-[8%] px-2 py-2 text-left border border-gray-300 cursor-pointer hover:bg-gray-200">
                                <div className="flex items-center gap-1">LAST VISIT DATE {sortBy === 'lastvisitdate' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th className="w-[8%] px-2 py-2 text-left border border-gray-300 truncate">LAST PERSON</th>
                            <th className="w-[9%] px-2 py-2 text-left border border-gray-300">LAST REMARK</th>
                            <th className="w-[7%] px-2 py-2 text-left border border-gray-300 truncate">RESELLER</th>
                            <th onClick={() => handleSort('aging_days')} className="w-[4%] px-2 py-2 text-center border border-gray-300 cursor-pointer hover:bg-gray-200">
                                <div className="flex items-center justify-center gap-1">DAYS {sortBy === 'aging_days' && <ChevronDown className={`h-3 w-3 ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} />}</div>
                            </th>
                            <th className="w-[6%] px-2 py-2 text-center border border-gray-300">ACTION</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={13} className="py-10 text-center text-gray-400 font-medium italic">Loading records...</td></tr>
                        ) : reportData.length === 0 ? (
                            <tr><td colSpan={13} className="py-10 text-center text-gray-400 font-medium italic">No records found matching current group/filters</td></tr>
                        ) : (
                            reportData.map((row) => (
                                <tr key={row.id} className="hover:bg-gray-50 border-b border-gray-300 bg-white text-gray-800">
                                    <td className="px-2 py-1 border border-gray-300 truncate font-semibold text-gray-900" title={row.customer_name}><CustomerNameLink customerId={(row as any).customer_id} name={row.customer_name} /></td>
                                    <td className="px-2 py-1 border border-gray-300 truncate text-indigo-600 font-bold uppercase text-[10px]" title={row.group}>{row.group}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.person_name}>{row.person_name}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.phone_no}>{row.phone_no}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.pincode}>{row.pincode}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.area}>{row.area}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.state}>{row.state}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.last_visit_date}>{row.last_visit_date}</td>
                                    <td className="px-2 py-1 border border-gray-300 truncate text-gray-600 italic" title={row.last_visit_person}>{row.last_visit_person}</td>
                                    <td className="px-2 py-1 border border-gray-300" title={row.last_visit_remark}>
                                        <div className="truncate w-full text-gray-700 italic text-[11px]" title={row.last_visit_remark}>
                                            {row.last_visit_remark}
                                        </div>
                                    </td>
                                    <td className="px-2 py-1 border border-gray-300 truncate" title={row.reseller_name || ''}>
                                        {row.reseller_name || <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-2 py-1 border border-gray-300 text-center">
                                        <div className={`font-bold ${row.aging_days > 90 ? 'text-red-600' : row.aging_days > 30 ? 'text-orange-600' : 'text-green-600'}`}>
                                            {row.aging_days}
                                        </div>
                                    </td>
                                    <td className="px-1 py-1 border border-gray-300 text-center">
                                        {canConnect(row) && (
                                            <button onClick={() => openConnectModal(row)} className="px-2 py-0.5 bg-gray-800 text-white rounded text-[9px] font-bold uppercase hover:bg-black transition-colors">
                                                Connect
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))
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

            {/* Connect Wizard */}
            {connectModal && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-4">
                    <div className="bg-white rounded-t-lg md:rounded-md shadow-lg w-full max-w-md md:max-h-[90vh] flex flex-col border border-gray-200">
                        {/* Header */}
                        <div className="px-4 py-2.5 flex justify-between items-center border-b border-gray-100">
                            <div className="flex items-center gap-2 min-w-0">
                                {callFlowActive ? <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <UserPlus className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                                <h3 className="text-sm font-semibold text-gray-900">{callFlowActive ? 'Log Call' : 'New Connect'}</h3>
                                <span className="text-gray-300">·</span>
                                <p className="text-xs text-gray-500 truncate normal-case" style={{ textTransform: 'none' }}>{connectModal.customer.customer_name}</p>
                            </div>
                            <button onClick={() => { setConnectModal(null); resetCallState(); }} className="p-1 -mr-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 shrink-0">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {!callFlowActive && (
                            <div className="p-4 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setConnectForm({ ...connectForm, type: 'Visit' })} className={`h-10 px-3 border rounded text-sm transition-colors flex items-center justify-center gap-2 ${connectForm.type === 'Visit' ? 'bg-gray-50 border-gray-400 text-gray-900 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                        <MapPin className="h-3.5 w-3.5" />
                                        Visit
                                    </button>
                                    <button onClick={() => { setConnectForm({ ...connectForm, type: 'Call', assign_to: user?.name || '' }); setCallFlowActive(true); }} className="h-10 px-3 border border-gray-200 rounded text-sm bg-white text-gray-600 hover:border-gray-300 transition-colors flex items-center justify-center gap-2">
                                        <Phone className="h-3.5 w-3.5" />
                                        Call
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Assign to</label>
                                    <select value={connectForm.assign_to} onChange={(e) => setConnectForm({ ...connectForm, assign_to: e.target.value })} className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none">
                                        <option value="">Select staff…</option>
                                        {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                    </select>
                                </div>
                                <button onClick={handleConnectSave} disabled={!connectForm.assign_to || loading} className="w-full h-9 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
                                    {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Assign & Create Task'}
                                </button>
                            </div>
                        )}

                        {callFlowActive && (
                            <>
                                <div className="p-4 space-y-3 overflow-y-auto flex-1">
                                    {/* Accepted / Rejected — segmented control with sliding indicator feel */}
                                    <div className="inline-flex p-0.5 bg-gray-100 rounded w-full">
                                        <button
                                            onClick={() => { setCallDecision('Accepted'); setRejectionReason(''); }}
                                            className={`flex-1 h-7 px-3 text-xs font-medium rounded transition-colors ${callDecision === 'Accepted' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            Accepted
                                        </button>
                                        <button
                                            onClick={() => { setCallDecision('Rejected'); setCallResponses({ interest: '', behavior: '', followUp: '', leadType: '', specialCases: [], productInterest: '' }); }}
                                            className={`flex-1 h-7 px-3 text-xs font-medium rounded transition-colors ${callDecision === 'Rejected' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            Rejected
                                        </button>
                                    </div>

                                    {/* Empty hint state */}
                                    {!callDecision && (
                                        <p className="text-xs text-gray-400 text-center py-6">Choose an outcome above to continue</p>
                                    )}

                                    {/* ── ACCEPTED branch ── */}
                                    {callDecision === 'Accepted' && (
                                        <div className="space-y-2.5">
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">What customer said</label>
                                                <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Key points discussed…" rows={2} className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Customer nature</label>
                                                    <select value={callResponses.behavior} onChange={(e) => setCallResponses({ ...callResponses, behavior: e.target.value })} className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none">
                                                        <option value="">Select</option>
                                                        <option value="Very Cooperative">Very Cooperative</option>
                                                        <option value="Polite">Polite</option>
                                                        <option value="Natural">Regular</option>
                                                        <option value="Rude">Rude</option>
                                                        <option value="Aggressive">Aggressive</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-gray-500 mb-1">Interest</label>
                                                    <select value={callResponses.interest} onChange={(e) => setCallResponses({ ...callResponses, interest: e.target.value })} className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none">
                                                        <option value="">Select</option>
                                                        <option value="Highly Interested">Highly Interested</option>
                                                        <option value="Interested">Interested</option>
                                                        <option value="Slightly Interested">Slightly Interested</option>
                                                        <option value="Not Interested">Not Interested</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Promote to Lead — opt-in toggle. Once on, pick lead type +
                                                assignee. Default assignee = current user. */}
                                            <div className="pt-2.5 border-t border-gray-100">
                                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={createLead}
                                                        onChange={(e) => {
                                                            const on = e.target.checked;
                                                            setCreateLead(on);
                                                            if (on) {
                                                                if (!leadAssignTo) setLeadAssignTo(user?.name || '');
                                                                // Pre-fill category from Product Interest if it maps cleanly
                                                                const derived = productToLeadType(callResponses.productInterest);
                                                                if (!leadType && derived) setLeadType(derived);
                                                            } else {
                                                                setLeadType('');
                                                                setLeadAssignTo('');
                                                            }
                                                        }}
                                                        className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-blue-300"
                                                    />
                                                    <span className="text-xs text-gray-700">Promote this call to a Lead</span>
                                                </label>

                                                {createLead && (
                                                    <div className="mt-2 space-y-2">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="block text-xs text-gray-500 mb-1">Category <span className="text-red-500">*</span></label>
                                                                <select
                                                                    value={leadType}
                                                                    onChange={(e) => { setLeadType(e.target.value); setLeadAssignTo(user?.name || ''); }}
                                                                    className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                                                >
                                                                    <option value="">Select…</option>
                                                                    {LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-gray-500 mb-1">Assign to</label>
                                                                {(() => {
                                                                    // Eligible owners = anyone holding leads.view (or admin).
                                                                    // create/take aren't required for ownership — view is the
                                                                    // base gate that lets them see the lead in the first place.
                                                                    const eligible = users.filter((u: any) =>
                                                                        u?.status !== 'inactive' &&
                                                                        (u?.role === 'admin' || u?.permissions?.leads?.view === true)
                                                                    );
                                                                    return (
                                                                        <select
                                                                            value={leadAssignTo}
                                                                            onChange={(e) => setLeadAssignTo(e.target.value)}
                                                                            className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                                                        >
                                                                            <option value="">{eligible.length ? 'Select…' : 'No user with leads permission'}</option>
                                                                            {eligible.map((u: any) => (
                                                                                <option key={u.id} value={u.name}>
                                                                                    {u.name}{u.name === user?.name ? ' (me)' : ''}{u.role === 'admin' ? ' · admin' : ''}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs text-gray-500 mb-1">Lead Remark</label>
                                                            <textarea
                                                                value={leadRemark}
                                                                onChange={(e) => setLeadRemark(e.target.value)}
                                                                rows={2}
                                                                placeholder="What's the follow-up about? (optional — defaults to call notes)"
                                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── REJECTED branch ── */}
                                    {callDecision === 'Rejected' && (
                                        <div className="space-y-2.5">
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Reason</label>
                                                <select value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none">
                                                    <option value="">Select reason</option>
                                                    <option value="Not Reachable">Not Reachable</option>
                                                    <option value="Busy">Busy</option>
                                                    <option value="No Answer">No Answer</option>
                                                    <option value="Switched Off">Switched Off</option>
                                                    <option value="Wrong Number">Wrong Number</option>
                                                    <option value="Call Disconnected">Call Disconnected</option>
                                                    <option value="Customer Refused">Customer Refused</option>
                                                    <option value="Language Barrier">Language Barrier</option>
                                                    <option value="Other">Other</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Remark</label>
                                                <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Additional details…" rows={2} className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none" />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer — sticky inside flex column */}
                                <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/30 flex items-center gap-2">
                                    <button onClick={() => { resetCallState(); setConnectForm({ ...connectForm, type: 'Visit' }); }} className="h-8 px-3 bg-white border border-gray-300 text-gray-600 rounded text-xs font-medium hover:bg-gray-50 transition-colors">Back</button>
                                    <button
                                        onClick={handleCallSave}
                                        disabled={!callDecision || (callDecision === 'Rejected' && !rejectionReason) || loading}
                                        className="flex-1 h-8 bg-gray-900 text-white rounded text-xs font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                    >
                                        {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Save Log'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Info Modal */}
            {infoModal && (
                <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4 text-left">
                    <div className="bg-white rounded-t-[3rem] md:rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom duration-300">
                        <div className="p-6 pb-2 flex justify-between items-center border-b border-gray-50">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600"><Info className="h-5 w-5" /></div>
                                <div>
                                    <h3 className="text-lg font-black text-gray-900 uppercase">Customer Meta</h3>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{infoModal.customer_name}</p>
                                </div>
                            </div>
                            <button onClick={() => setInfoModal(null)} className="p-2 hover:bg-gray-100 rounded-2xl"><X className="h-5 w-5 text-gray-400" /></button>
                        </div>
                        
                        <div className="overflow-hidden">
                            <div className="grid grid-cols-2 border-b border-gray-100">
                                <div className="p-4 border-r border-gray-100">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Primary Contact</p>
                                    <p className="font-bold text-gray-900 text-sm">{infoModal.person_name || 'N/A'}</p>
                                </div>
                                <div className="p-4">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Contact Number</p>
                                    <p className="font-bold text-gray-900 text-sm">{infoModal.phone_no || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-4 bg-gray-50/30">
                                {[
                                    { label: 'E-Invoice', value: infoModal.e_invoice, icon: Hash },
                                    { label: 'Type', value: infoModal.business_type, icon: Calendar },
                                    { label: 'IT Person', value: infoModal.it_person, icon: User },
                                    { label: 'WhatsApp', value: infoModal.whatsapp_enabled, icon: MessageSquare },
                                ].map((field, i) => (
                                    <div key={i} className={`p-3 border-b border-gray-100 ${i % 4 !== 3 ? 'border-r border-gray-100' : ''}`}>
                                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-1">{field.label}</p>
                                        <p className="text-[11px] font-bold text-gray-700 truncate">{field.value || 'N/A'}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="p-5 bg-white border-b border-gray-100">
                                <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-2">Latest Visit Intelligence</p>
                                <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl">
                                    <p className="text-xs text-gray-600 leading-relaxed font-medium">{infoModal.last_visit_remark || 'No intelligence records available.'}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="p-5">
                            <button onClick={() => setInfoModal(null)} className="w-full py-4 bg-gray-900 text-white rounded-[1.5rem] font-bold text-sm uppercase">Close View</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LastVisitReport;
