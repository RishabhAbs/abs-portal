import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronLeft, RefreshCw, Edit2, Eye, X, Filter, Download, MapPin, Trash2, CheckCircle2, LogIn, LogOut, Phone, Shield, ShieldAlert, Plus, MessageSquare, Clock, User, Briefcase } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CustomerNameLink from '../components/CustomerNameLink';
import { tdlApi, usersApi, visitsApi, customersApi, serviceCallsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import SwipeableCard from '../components/Shared/SwipeableCard';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';
import { useColumnPermissions } from '../hooks/useColumnPermissions';
import { useSwipeTabs } from '../hooks/useSwipeTabs';
import { getPreciseLocation } from '../utils/geolocation';
import GpsOverlay from '../components/Shared/GpsOverlay';

interface TaskData {
    id: number;
    req_id: number;
    user_name: string;
    task_type: 'Development' | 'Implementation' | 'Connect';
    visit_type?: 'Visit' | 'Call' | 'External' | 'Self';
    allotment_date: string | null;
    deadline: string | null;
    completion_date: string | null;
    status: string;
    remark: string;
    assigned_by: string;
    requirement_name?: string;
    customer_id?: number | null;
    customer_name?: string;
    tdl_id?: string;
    source?: 'tdl' | 'visit';
    check_in_date?: string | null;
    check_in_time?: string | null;
    check_in_lat?: number | null;
    check_in_lng?: number | null;
    check_out_time?: string | null;
    check_out_lat?: number | null;
    check_out_lng?: number | null;
    phone_no?: string;
    customer_status?: string;
    force_checkin_allowed?: boolean;
}

const TaskReport: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [tasks, setTasks] = useState<TaskData[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [checkInBusyId, setCheckInBusyId] = useState<number | null>(null);
    const [checkOutSubmitting, setCheckOutSubmitting] = useState(false);
    const [recordingVisitId, setRecordingVisitId] = useState<number | null>(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Synchronous refs — setState is async, so rapid taps can slip past the state
    // guard before React re-renders. Refs update immediately and reliably block it.
    const checkInLockRef = useRef(false);
    const checkOutLockRef = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const activeStreamRef = useRef<MediaStream | null>(null);
    const pendingToastShownRef = useRef(false);
    const [typeFilter, setTypeFilter] = useState<'all' | 'Development' | 'Implementation' | 'Connect'>('all');
    // 4-tab filter (Call Connect / Visit Connect / External / Self) above the
    // task list. 'self' shows only the creator's own reminders unless admin
    // overrides via assigneeFilter.
    const CONNECT_TABS = ['call', 'visit', 'external', 'self'] as const;
    type ConnectTab = typeof CONNECT_TABS[number];
    const [connectTab, setConnectTab] = useState<ConnectTab>('call');
    const connectTabSwipe = useSwipeTabs(CONNECT_TABS, connectTab, setConnectTab);
    const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'In Progress' | 'Completed'>('all');
    const [users, setUsers] = useState<any[]>([]);
    const { showError, showSuccess } = useToast();
    const { isAdmin: isAdminFn, user, canView, canEdit, canDelete, canCheckPermission } = useAuth();
    const isAdmin = isAdminFn();
    const colPermsActive = useColumnPermissions('tasks_active');
    const colPermsCompleted = useColumnPermissions('tasks_completed');

    // Determine visit permission entity based on customer status
    const getVisitEntity = (t: any) => (t.customer_status === 'Active' ? 'visits_our' : 'visits_not_our') as import('../context/AuthContext').EntityType;
    
    // Permission Helpers with Fallbacks and Assignee Auto-Rights
    const isAssignee = (t: any) => user?.name && t.user_name === user.name;
    
    const canEditVisit = (t: any) => canEdit(getVisitEntity(t)) || canEdit('tasks');
    const canDeleteVisit = (t: any) => canDelete(getVisitEntity(t)) || canDelete('tasks');
    const canCheckinVisit = (t: any) => 
        isAssignee(t) || 
        canCheckPermission(getVisitEntity(t), 'checkin') || 
        canCheckPermission('tasks', 'checkin');
        
    const canPauseVisit = (t: any) => 
        isAssignee(t) || 
        canCheckPermission(getVisitEntity(t), 'pause') || 
        canCheckPermission('tasks', 'checkin');
        
    const canForceCheckinVisit = (t: any) => canCheckPermission(getVisitEntity(t), 'force_checkin');
    

    // Tabs
    const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
    const taskTabSwipe = useSwipeTabs(['active', 'completed'] as const, activeTab, setActiveTab);
    // const [segment, setSegment] = useState<'our' | 'not_our'>('our'); // Removed segment
    const [searchParams, setSearchParams] = useSearchParams();

    // Sync filters with URL
    useEffect(() => {
        // Segment logic removed


        const type = searchParams.get('type');
        if (type && ['all', 'Development', 'Implementation', 'Connect'].includes(type)) {
            setTypeFilter(type as any);
        }

        const status = searchParams.get('status');
        if (status && ['all', 'Pending', 'In Progress', 'Completed'].includes(status)) {
            setStatusFilter(status as any);
        }
    }, [searchParams]);



    // Completed Tasks State
    const [completedTasks, setCompletedTasks] = useState<any[]>([]);
    const [completedPage, setCompletedPage] = useState(1);
    const [completedTotal, setCompletedTotal] = useState(0);
    const [completedLimit] = useState(20);
    const [completedLoading, setCompletedLoading] = useState(false);
    const [completedFilters, setCompletedFilters] = useState({
        user_name: 'all',
        date_from: '',
        date_to: '',
        search: ''
    });
    const [showCompletedFilters, setShowCompletedFilters] = useState(false);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [debouncedCompletedSearch, setDebouncedCompletedSearch] = useState('');

    // Debounce Active Search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchTerm.length >= 4 || searchTerm.length === 0) {
                setDebouncedSearch(searchTerm);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Debounce Completed Search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (completedFilters.search.length >= 4 || completedFilters.search.length === 0) {
                setDebouncedCompletedSearch(completedFilters.search);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [completedFilters.search]);

     const completedFilterConfig: FilterConfig[] = [
        { key: 'user_name', label: 'Staff', type: 'select', options: [{ value: 'all', label: 'All Staff' }, ...users.map(u => ({ value: u.name, label: u.name }))] },
        { key: 'date_from', label: 'From Date', type: 'date' },
        { key: 'date_to', label: 'To Date', type: 'date' },
    ];

    // View Modal
    const [viewTask, setViewTask] = useState<TaskData | null>(null);
    const [viewCompletedTask, setViewCompletedTask] = useState<any | null>(null);
    const [completedTaskUpdates, setCompletedTaskUpdates] = useState<any[]>([]);
    const [completedTaskUpdatesLoading, setCompletedTaskUpdatesLoading] = useState(false);

    const openCompletedTask = async (t: any) => {
        setViewCompletedTask(t);
        setCompletedTaskUpdates([]);
        if (t && t.source === 'tdl' && isExternalTask(t)) {
            setCompletedTaskUpdatesLoading(true);
            try {
                const res = await tdlApi.getTaskUpdates(t.id);
                setCompletedTaskUpdates(res.success ? res.data : []);
            } catch { setCompletedTaskUpdates([]); }
            finally { setCompletedTaskUpdatesLoading(false); }
        }
    };

    // Edit Modal
    const [editTask, setEditTask] = useState<TaskData | null>(null);
    const [editForm, setEditForm] = useState({ user_name: '', deadline: '', status: '', remark: '' });

    // Checkout    // Modals state
    const [checkoutModal, setCheckoutModal] = useState<{
        task: TaskData,
        remark: string,
        // Tracking Fields
        e_invoice: string,
        business_type: string,
        accounts_person_type: string,
        it_person: string,
        ca_name: string,
        business_description: string,
        e_way_bill: string,
        connected_banking: string,
        whatsapp_enabled: string,
        customisation: string,
        tally_slow: string,
        customer_behaviour: string,
        check_out_response: string
    } | null>(null);

    // Promote-to-Lead state for the Check Out modal. Mirrors the Log-Call
    // "Promote this call to a Lead" UX so a successful visit can spawn a
    // follow-up lead in service_calls assigned to a teammate.
    const LEAD_TYPES = ['Cloud', 'Tally', 'TDL', 'Web/App'] as const;
    const [createLead, setCreateLead] = useState(false);
    const [leadType, setLeadType] = useState('');
    const [leadAssignTo, setLeadAssignTo] = useState('');
    const [leadRemark, setLeadRemark] = useState('');
    useEffect(() => {
        if (!checkoutModal) {
            setCreateLead(false);
            setLeadType('');
            setLeadAssignTo('');
            setLeadRemark('');
        }
    }, [checkoutModal]);
    const [showActiveFilters, setShowActiveFilters] = useState(false);
    const [callConfirmation, setCallConfirmation] = useState<{ name: string; phone: string } | null>(null);

    // Create Task Modal
    const [showCreateTask, setShowCreateTask] = useState(false);
    const [customerSearch, setCustomerSearch] = useState('');
    const [customerResults, setCustomerResults] = useState<any[]>([]);
    const [customerSearching, setCustomerSearching] = useState(false);
    const [createTaskForm, setCreateTaskForm] = useState({
        customer_id: null as number | null,
        customer_name: '',
        person_name: '',
        phone_no: '',
        // 'customer' = Visit/Call against a customer (asks for Visit/Call sub-type)
        // 'external' = no customer, can assign to anyone (incl. self)
        // 'self'     = creator-only reminder (assignee forced to current user)
        task_category: '' as 'customer' | 'external' | 'self' | '',
        visit_type: '' as 'Call' | 'Visit' | '',
        date: '',
        remark: '',
        assign_to: '',
    });
    const [creatingTask, setCreatingTask] = useState(false);

    // Update Task Modal (like lead requirement update)
    const [updateTaskModal, setUpdateTaskModal] = useState<TaskData | null>(null);
    const [updateTaskForm, setUpdateTaskForm] = useState({ remark: '', status: '', next_date: '', external_action: '' as 'complete' | 'shift' | 'note' | '' });
    const [taskUpdates, setTaskUpdates] = useState<any[]>([]);
    const [taskUpdatesLoading, setTaskUpdatesLoading] = useState(false);
    const [updatingTask, setUpdatingTask] = useState(false);

     const activeFilterConfig: FilterConfig[] = [
        ...(isAdmin ? [{ key: 'assignee', label: 'Staff', type: 'select' as const, options: [
            { value: 'all', label: 'All Staff' },
            ...users.map(u => ({ value: u.name, label: u.name }))
        ]}] : []),
        { key: 'type', label: 'Task Type', type: 'select', options: [
            { value: 'all', label: 'All Types' },
            { value: 'Development', label: 'Development' },
            { value: 'Implementation', label: 'Implementation' },
            { value: 'Connect', label: 'Connect' }
        ]},
        { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'all', label: 'All Status' },
            { value: 'Pending', label: 'Pending' },
            { value: 'In Progress', label: 'Running' },
            { value: 'Completed', label: 'Completed' }
        ]}
    ];

    // Helper to clear active filters
    const resetActiveFilters = () => {
        setTypeFilter('all');
        setStatusFilter('all');
        if (isAdmin) setAssigneeFilter('all');
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            // Check for 'view_all' permission

            
            // STRICT "My Tasks" Logic:
            // Non-Admins ONLY see their own tasks. Admins see all.
            const targetUser = isAdmin ? '' : (user?.name || '');
            console.log('[TaskReport] Fetching with:', { targetUser, isAdmin, permissions: user?.permissions });

            const [customizationsResult, usersResult, visitsResult] = await Promise.allSettled([
                tdlApi.getAllCustomizations(),
                // getBasic is unguarded — required so non-admins (who don't hold
                // users.view) can still see the assignee dropdown. Previous code
                // used getAll with a permission gate, which silently returned an
                // empty list and made Assign / Transfer unusable.
                usersApi.getBasic(),
                visitsApi.getPending(targetUser),
            ]);

            const data = customizationsResult.status === 'fulfilled' ? customizationsResult.value : [];
            const usersRes = usersResult.status === 'fulfilled' ? usersResult.value : [];
            const visitsRes = visitsResult.status === 'fulfilled' ? visitsResult.value : [];
            setUsers(Array.isArray(usersRes) ? usersRes : usersRes?.data || []);

            const allTasks: TaskData[] = [];
            let pendingConnectTasks = 0;

            // Derive 4-tab bucket for TDL Connect tasks from the requirement label.
            // Mirrors backend CASE in tdl.service.ts (getPendingConnectTasks/getCompletedConnectTasks)
            // and extends it for External + Self so those rows surface in their
            // own tabs instead of falling through to 'Visit'.
            const deriveVisitTypeFromReq = (req: string): 'Call' | 'Visit' | 'External' | 'Self' => {
                const s = (req || '').toLowerCase();
                if (s.includes('external')) return 'External';
                if (s.includes('self') || s.includes('reminder') || s.includes('complain')) return 'Self';
                if (s.includes('call')) return 'Call';
                return 'Visit';
            };

            // 1. TDL Tasks
            data.forEach((tdl: any) => {
                if (tdl.requirements && tdl.requirements.length > 0) {
                    tdl.requirements.forEach((r: any) => {
                        if (r.tasks && r.tasks.length > 0) {
                            r.tasks.forEach((t: any) => {
                                const derivedVisitType = t.task_type === 'Connect'
                                    ? deriveVisitTypeFromReq(r.requirement || '')
                                    : undefined;
                                const task = {
                                    ...t,
                                    visit_type: t.visit_type || derivedVisitType,
                                    requirement_name: r.requirement || 'N/A',
                                    customer_id: tdl.customer_id || null,
                                    customer_name: tdl.customer_name || tdl.person_name || 'N/A',
                                    tdl_id: tdl.id,
                                    phone_no: tdl.phone_no || tdl.contact_no || '',
                                    customer_status: tdl.customer_status || 'Active',
                                    source: 'tdl' as const,
                                };
                                allTasks.push(task);

                                if (task.task_type === 'Connect' && task.status === 'Pending') {
                                    pendingConnectTasks++;
                                }
                            });
                        }
                    });
                }
            });

            // 2. Visit Tasks
            if (Array.isArray(visitsRes)) {
                visitsRes.forEach((v: any) => {
                    const isExt = v.visit_type === 'External' || v.visit_type === 'Self';
                    // External/Self have no customer — surface the typed remark
                    // and the assignee's name so the card has something readable.
                    const remark = v.check_out_remark
                        ? v.check_out_remark
                        : v.visit_type + ' Activity';
                    const reqName = isExt
                        ? (v.check_out_remark || (v.visit_type === 'Self' ? 'Complain' : 'External Task'))
                        : (v.visit_type + ' @ ' + (v.city || 'Location'));
                    const visitTask: TaskData = {
                        id: v.id,
                        req_id: 0, // Placeholder
                        user_name: v.user_name,
                        task_type: 'Connect', // Treat visits as Connect tasks
                        visit_type: v.visit_type, // 'Visit' | 'Call' | 'External' | 'Self'
                        allotment_date: v.scheduled_date,
                        deadline: v.scheduled_date, // Visits usually due on same day
                        completion_date: v.status === 'Completed' ? v.scheduled_date : null,
                        status: v.status,
                        remark,
                        assigned_by: v.assigned_by,
                        requirement_name: reqName,
                        customer_id: v.customer_id || null,
                        customer_name: isExt ? '' : (v.customer_name || 'Unknown'),
                        phone_no: v.phone_no,
                        check_in_date: v.check_in_time ? v.check_in_time.split('T')[0] : null,
                        check_in_time: v.check_in_time,
                        check_in_lat: v.check_in_lat,
                        check_in_lng: v.check_in_lng,
                        check_out_time: v.check_out_time,
                        customer_status: v.customer_status || 'Active',
                        source: 'visit',
                    };
                    allTasks.push(visitTask);
                });
            }

            setTasks(allTasks);

            // Only surface the pending-visits toast once per session — it used to
            // fire on every fetchData() (check-in, check-out, edit, refresh), and
            // StrictMode's double-effect on mount made it appear twice.
            if (pendingConnectTasks > 0 && !pendingToastShownRef.current) {
                pendingToastShownRef.current = true;
                showSuccess('Pending Visits', `You have ${pendingConnectTasks} pending Connect visits.`);
            }

            // Request Location Permission on Load
            navigator.geolocation.getCurrentPosition(() => { }, () => { });

        } catch (err: any) {
            showError('Error', err.message || 'Failed to load tasks');
        } finally {
            setLoading(false);
        }
    };

    const fetchCompletedTasks = async () => {
        setCompletedLoading(true);
        try {
            // Creators with only `tasks.view` need to see visits they assigned
            // out (e.g. assigned a Customer Call to Rahul). The frontend
            // permission filter below (line ~427) still restricts non-admins to
            // their own creator/assignee rows, so opening this gate doesn't
            // leak data — it just stops dropping completed visits for users
            // who hold tasks-only permissions.
            const canViewVisits = canView('visits_our') || canView('visits_not_our') || canView('tasks');

            // 1. Fetch Completed Visits (only if user has visit permissions)
            // 2. Fetch Completed TDL Tasks (Customizations)
            const [visitsResult, tdlResult] = await Promise.allSettled([
                canViewVisits
                    ? visitsApi.getAll(completedPage, completedLimit, {
                        ...completedFilters,
                        search: debouncedCompletedSearch,
                        status: 'Completed'
                    })
                    : Promise.resolve({ success: true, data: [] }),
                tdlApi.getAllCustomizations(),
            ]);

            const visitsRes = visitsResult.status === 'fulfilled' ? visitsResult.value : { success: false, data: [] };
            const tdlRes = tdlResult.status === 'fulfilled' ? tdlResult.value : [];

            let combined: any[] = [];

            if (visitsRes.success && Array.isArray(visitsRes.data)) {
                combined = [...combined, ...visitsRes.data.map((v: any) => ({
                    ...v,
                    task_type: 'Visit'
                }))];
            }

            if (Array.isArray(tdlRes)) {
                // Derive 4-tab bucket from the requirement label (Customer Call /
                // Customer Visit / External Task / Self Reminder) so completed TDL
                // Connect tasks land in the correct connect tab instead of all
                // falling into Visit Connect.
                const deriveVisitTypeFromReq = (req: string): 'Call' | 'Visit' | 'External' | 'Self' => {
                    const s = (req || '').toLowerCase();
                    if (s.includes('external')) return 'External';
                    if (s.includes('self') || s.includes('reminder') || s.includes('complain')) return 'Self';
                    if (s.includes('call')) return 'Call';
                    return 'Visit';
                };
                tdlRes.forEach((tdl: any) => {
                    if (tdl.requirements) {
                        tdl.requirements.forEach((r: any) => {
                            if (r.tasks) {
                                r.tasks.forEach((t: any) => {
                                    if (t.status === 'Completed') {
                                        const derivedVisitType = t.task_type === 'Connect'
                                            ? deriveVisitTypeFromReq(r.requirement || '')
                                            : undefined;
                                        combined.push({
                                            ...t,
                                            visit_type: t.visit_type || derivedVisitType,
                                            requirement_name: r.requirement || 'N/A',
                                            customer_name: tdl.customer_name || tdl.person_name || 'N/A',
                                            tdl_id: tdl.id,
                                            task_type: 'TDL'
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }

            // PERMISSION FILTER:
            combined = combined.filter(t => isAdmin || (user?.name && (t.assigned_by === user.name || t.user_name === user.name)));

            // Client-side search for TDL tasks if needed
            if (debouncedCompletedSearch) {
                const s = debouncedCompletedSearch.toLowerCase();
                combined = combined.filter(t => 
                    t.customer_name?.toLowerCase().includes(s) || 
                    t.requirement_name?.toLowerCase().includes(s) ||
                    t.user_name?.toLowerCase().includes(s)
                );
            }

            // Sort by completion date descending
            combined.sort((a, b) => {
                const dateA = new Date(a.completion_date || 0).getTime();
                const dateB = new Date(b.completion_date || 0).getTime();
                return dateB - dateA;
            });

            setCompletedTasks(combined);
            setCompletedTotal(combined.length);
        } catch (err: any) {
            console.error('Failed to fetch completed tasks:', err);
            showError('Error', 'Failed to load task history');
        } finally {
            setCompletedLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'completed') {
            fetchCompletedTasks();
        }
    }, [activeTab, completedPage, completedFilters]);

    // Search debounce for completed
    useEffect(() => {
        if (activeTab === 'completed') {
             setCompletedPage(1);
             fetchCompletedTasks();
        }
    }, [activeTab, debouncedCompletedSearch]);

    useEffect(() => { fetchData(); }, []);

    // Auth Context is now at the top

    const filtered = tasks.filter(t => {
        // PERMISSION FILTER:
        const hasPermission = isAdmin || (user?.name && (t.assigned_by === user.name || t.user_name === user.name));

        if (!hasPermission) return false;

        const matchesSearch =
            t.user_name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
            t.requirement_name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
            t.customer_name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
            t.remark?.toLowerCase().includes(debouncedSearch.toLowerCase());
        const matchesType = typeFilter === 'all' || t.task_type === typeFilter;

        // 4-tab filter: Call Connect / Visit Connect / External / Self.
        // Maps to cloud_visits.visit_type. 'Self' (reminder) shows only the
        // current user's tasks unless admin picks another user via assigneeFilter.
        const tabType =
            connectTab === 'call'     ? 'Call' :
            connectTab === 'visit'    ? 'Visit' :
            connectTab === 'external' ? 'External' :
                                        'Self';
        const matchesTab = (t.visit_type || (t.task_type === 'Connect' ? 'Visit' : '')) === tabType;
        // Self tab is creator-scoped: non-admin only sees their own
        const matchesSelfScope = connectTab !== 'self'
            || isAdmin
            || (user?.name && (t.assigned_by === user.name || t.user_name === user.name));

        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
        const matchesAssignee = !isAdmin || assigneeFilter === 'all' || t.user_name === assigneeFilter;

        return matchesSearch && matchesType && matchesTab && matchesSelfScope && matchesStatus && matchesAssignee;
    }).sort((a, b) => {
        // Primary: status bucket (In Progress first, Pending/Paused next, rest last).
        // Secondary: OLDEST first — queue semantics. Newly-created Connects drop to
        // the bottom of their status group so they're worked through in arrival order.
        const score = (status: string) => {
            if (status === 'In Progress') return 0;
            if (status === 'Pending') return 1;
            return 2;
        };
        const s = score(a.status) - score(b.status);
        if (s !== 0) return s;
        const ts = (t: any) => {
            const d = t.allotment_date || t.created_at || t.deadline || '';
            const n = d ? new Date(String(d).replace(' ', 'T')).getTime() : 0;
            return isNaN(n) ? 0 : n;
        };
        return ts(a) - ts(b);
    });

    // Filter completed tasks by the 4-tab connect bar (Call/Visit/External/Complain).
    // visit_type is set directly on cloud_visits rows and derived from the requirement
    // label for TDL Connect rows in fetchCompletedTasks. Non-Connect TDL customizations
    // (e.g. Tally, Cloud) have no visit_type and won't appear under any of the 4 tabs.
    const filteredCompletedTasks = completedTasks.filter(t => {
        const tabType =
            connectTab === 'call'     ? 'Call' :
            connectTab === 'visit'    ? 'Visit' :
            connectTab === 'external' ? 'External' :
                                        'Self';
        return t.visit_type === tabType;
    });

    const formatDate = (d: string | null | undefined) => {
        if (!d) return '-';
        try {
            // Handle MySQL dateStrings format: "YYYY-MM-DD HH:mm:ss" (space instead of T)
            const normalized = d.replace(' ', 'T');
            const date = new Date(normalized);
            return isNaN(date.getTime()) ? d : date.toLocaleDateString('en-GB');
        } catch (e) {
            return d;
        }
    };
    // Helper to format time specifically for 12-hour format
    const formatTime = (t: string | null | undefined) => {
        if (!t) return '-';
        try {
            // Handle MySQL dateStrings format: "YYYY-MM-DD HH:mm:ss" (space instead of T)
            const normalized = t.includes('T') ? t : t.replace(' ', 'T');
            // Handle plain HH:mm:ss
            const date = normalized.includes('T') ? new Date(normalized) : new Date(`2000-01-01T${normalized}`);
            if (isNaN(date.getTime())) return t; // Fallback to raw string if unparseable
            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch (e) {
            return t;
        }
    };
    const formatCoord = (c: string | number | null | undefined) => {
        if (!c) return '-';
        return typeof c === 'number' ? c.toFixed(6) : parseFloat(c).toFixed(6);
    };

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // in metres
    };

    const getCurrentLocation = () => getPreciseLocation();

    const startRecording = async (visitId: number) => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) return;
            // Mono 16kHz — enough for voice, ~60KB/min
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 8000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            activeStreamRef.current = stream;
            audioChunksRef.current = [];
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
            // 8kbps opus — telephone quality, ~60KB/min, perfect for voice
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 8000 } : { audioBitsPerSecond: 8000 });
            recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            recorder.start(1000);
            mediaRecorderRef.current = recorder;
            setRecordingVisitId(visitId);
            setRecordingSeconds(0);
            recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
        } catch {
            // Mic denied — recording is optional
        }
    };

    const stopAndUploadRecording = async (visitId: number) => {
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setRecordingSeconds(0);
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
            activeStreamRef.current?.getTracks().forEach(t => t.stop());
            activeStreamRef.current = null;
            setRecordingVisitId(null);
            return;
        }
        return new Promise<void>((resolve) => {
            recorder.onstop = async () => {
                // Wait for any pending ondataavailable to fire after requestData
                await new Promise(r => setTimeout(r, 500));
                activeStreamRef.current?.getTracks().forEach(t => t.stop());
                activeStreamRef.current = null;
                mediaRecorderRef.current = null;
                setRecordingVisitId(null);
                const chunks = audioChunksRef.current;
                audioChunksRef.current = [];
                if (chunks.length === 0) { showError('Recording', 'No audio chunks captured'); resolve(); return; }
                const mimeType = chunks[0].type || 'audio/webm';
                const ext = mimeType.includes('ogg') ? '.ogg' : mimeType.includes('mp4') ? '.mp4' : '.webm';
                const blob = new Blob(chunks, { type: mimeType });
                showSuccess('Recording', `Uploading ${chunks.length} chunks, ${Math.round(blob.size/1024)}KB`);
                try {
                    await visitsApi.uploadRecording(visitId, blob, ext);
                    showSuccess('Recording saved', 'Audio uploaded successfully');
                } catch (e: any) { showError('Recording upload failed', e.message || 'Unknown error'); }
                resolve();
            };
            try { recorder.requestData(); } catch { /* flush buffered audio */ }
            recorder.stop();
        });
    };

    const handleCheckIn = async (task: TaskData) => {
        if (checkInLockRef.current) return; // synchronous double-click guard
        checkInLockRef.current = true;
        setCheckInBusyId(task.id);
        try {
            const loc = await getCurrentLocation();
            // Generate time in Indian timezone (Asia/Kolkata, UTC+5:30)
            const now = new Date();
            const indianTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            
            // Format for MySQL datetime: YYYY-MM-DD HH:MM:SS in Indian timezone
            const year = indianTime.getFullYear();
            const month = String(indianTime.getMonth() + 1).padStart(2, '0');
            const day = String(indianTime.getDate()).padStart(2, '0');
            const hours = String(indianTime.getHours()).padStart(2, '0');
            const minutes = String(indianTime.getMinutes()).padStart(2, '0');
            const seconds = String(indianTime.getSeconds()).padStart(2, '0');
            
            const dateStr = `${year}-${month}-${day}`;
            const mysqlDateTime = `${dateStr} ${hours}:${minutes}:${seconds}`;
            const timeStr = indianTime.toLocaleTimeString('en-IN', { hour12: true, timeZone: 'Asia/Kolkata' }); // HH:MM:SS AM/PM

            if (task.req_id === 0 && task.task_type === 'Connect') {
                await visitsApi.update({
                    id: task.id,
                    check_in_time: mysqlDateTime, // MySQL DateTime format in Indian timezone
                    check_in_lat: loc.lat.toString(),
                    check_in_lng: loc.lng.toString(),
                    check_in_accuracy: loc.accuracy.toString(),
                    status: 'In Progress'
                });
            } else {
                await tdlApi.manageTasks(task.req_id, [{
                    id: task.id,
                    check_in_date: dateStr,
                    check_in_time: timeStr,
                    check_in_lat: loc.lat.toString(),
                    check_in_lng: loc.lng.toString(),
                    check_in_accuracy: loc.accuracy.toString(),
                    status: 'In Progress' // Auto update status
                }]);
            }
            showSuccess('Checked In', 'Location and time recorded successfully');
            await startRecording(task.id);
            fetchData();
        } catch (e: any) {
            showError('Check-in Failed', e.message || 'Could not fetch location');
        } finally {
            setCheckInBusyId(null);
            checkInLockRef.current = false;
        }
    };

    const handleCheckOut = (task: TaskData) => {
        setCheckoutModal({
            task,
            remark: '',
            // Yes/No fields default to 'No' (unchecked)
            e_invoice: 'No',
            business_type: '',
            accounts_person_type: '',
            it_person: '',
            ca_name: '',
            business_description: '',
            e_way_bill: 'No',
            connected_banking: 'No',
            whatsapp_enabled: 'No',
            customisation: '',
            tally_slow: 'No',
            customer_behaviour: '',
            check_out_response: ''
        });
    };

    const confirmCheckOut = async () => {
        if (!checkoutModal) return;
        if (checkOutLockRef.current) return; // synchronous double-click guard

        // Validate all required fields for Connect tasks
        if (checkoutModal.task.task_type === 'Connect') {
            const missingFields: string[] = [];

            // Only Remark is strictly required now to reduce errors
            if (!checkoutModal.remark?.trim()) missingFields.push('Visit Remark');

            if (missingFields.length > 0) {
                showError('Required Fields', `Please fill: ${missingFields.join(', ')}`);
                return;
            }

            // Lead promotion requires a category. Block save until picked so
            // we don't drop the user's intent on a half-filled form.
            if (createLead && !leadType) {
                showError('Lead Type Required', 'Pick a Lead Type to create the lead');
                return;
            }
        } else {
            if (!checkoutModal.remark.trim()) {
                showError('Remark Required', 'Please enter a remark to proceed with checkout.');
                return;
            }
        }

        checkOutLockRef.current = true;
        setCheckOutSubmitting(true);
        try {
            const { task, remark } = checkoutModal;
            const loc = await getCurrentLocation();

            // Generate time in Indian timezone (Asia/Kolkata, UTC+5:30)
            const now = new Date();
            const indianTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

            const year = indianTime.getFullYear();
            const month = String(indianTime.getMonth() + 1).padStart(2, '0');
            const day = String(indianTime.getDate()).padStart(2, '0');
            const hours = String(indianTime.getHours()).padStart(2, '0');
            const minutes = String(indianTime.getMinutes()).padStart(2, '0');
            const seconds = String(indianTime.getSeconds()).padStart(2, '0');

            const mysqlDateTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            const timeStr = indianTime.toLocaleTimeString('en-IN', { hour12: true, timeZone: 'Asia/Kolkata' });

            if (task.req_id === 0 && task.task_type === 'Connect') {
                await visitsApi.update({
                    id: task.id,
                    status: 'Completed',
                    check_out_time: mysqlDateTime, // MySQL DateTime format in Indian timezone
                    check_out_lat: loc.lat.toString(),
                    check_out_lng: loc.lng.toString(),
                    check_out_accuracy: loc.accuracy.toString(),
                    remark: remark,
                    // Tracking Fields
                    e_invoice: checkoutModal.e_invoice,
                    business_type: checkoutModal.business_type,
                    accounts_person_type: checkoutModal.accounts_person_type,
                    it_person: checkoutModal.it_person,
                    ca_name: checkoutModal.ca_name,
                    business_description: checkoutModal.business_description,
                    e_way_bill: checkoutModal.e_way_bill,
                    connected_banking: checkoutModal.connected_banking,
                    whatsapp_enabled: checkoutModal.whatsapp_enabled,
                    customisation: checkoutModal.customisation,
                    tally_slow: checkoutModal.tally_slow,
                    customer_behaviour: checkoutModal.customer_behaviour,
                    check_out_response: checkoutModal.check_out_response
                });
            } else {
                await tdlApi.manageTasks(task.req_id, [{
                    id: task.id,
                    check_out_time: timeStr,
                    check_out_lat: loc.lat.toString(),
                    check_out_lng: loc.lng.toString(),
                    check_out_accuracy: loc.accuracy.toString(),
                    remark: checkoutModal.remark,
                    customer_behaviour: checkoutModal.customer_behaviour,
                    check_out_response: checkoutModal.check_out_response,
                    // Include all tracking fields
                    e_invoice: checkoutModal.e_invoice,
                    business_type: checkoutModal.business_type,
                    accounts_person_type: checkoutModal.accounts_person_type,
                    it_person: checkoutModal.it_person,
                    ca_name: checkoutModal.ca_name,
                    business_description: checkoutModal.business_description,
                    e_way_bill: checkoutModal.e_way_bill,
                    connected_banking: checkoutModal.connected_banking,
                    whatsapp_enabled: checkoutModal.whatsapp_enabled,
                    customisation: checkoutModal.customisation,
                    tally_slow: checkoutModal.tally_slow
                }]);
            }
            // Promote the visit to a Lead if the user opted-in. Same shape
            // as the Log-Call lead path — service_calls.create with entry_type
            // 'Lead' and the chosen category. Failure is surfaced separately
            // so the check-out itself stays successful.
            if (checkoutModal.task.task_type === 'Connect' && createLead && leadType) {
                const phone = (task.phone_no || '').replace(/[^0-9]/g, '').slice(-10);
                if (phone.length === 10) {
                    try {
                        await serviceCallsApi.create({
                            mobile_no: phone,
                            contact_person: task.customer_name || undefined,
                            customer_id: task.customer_id || undefined,
                            entry_type: 'Lead',
                            lead_type: leadType,
                            service_type: leadType,
                            remark: leadRemark.trim() || remark || `Lead from visit · ${checkoutModal.business_description || 'visit follow-up'}`,
                            assign_to: leadAssignTo || user?.name || undefined,
                        });
                        showSuccess('Lead Created', `Lead assigned to ${leadAssignTo || user?.name || 'you'}`);
                    } catch (leadErr: any) {
                        showError('Lead Create Failed', leadErr.message || 'Visit checked out, but lead could not be created');
                    }
                } else {
                    showError('Invalid Phone', 'Cannot create lead: customer phone is not a valid 10-digit number');
                }
            }

            await stopAndUploadRecording(task.id).catch(() => {});
            showSuccess('Checked Out', 'Task completed successfully');
            setCheckoutModal(null);
            fetchData();
        } catch (e: any) {
            showError('Check-out Failed', e.message || 'Could not fetch location');
        } finally {
            setCheckOutSubmitting(false);
            checkOutLockRef.current = false;
        }
    };

    const handleTaskStatusUpdate = async (task: TaskData, newStatus: string) => {
        try {
            if (task.req_id === 0 && task.task_type === 'Connect') {
                await visitsApi.update({
                    id: task.id,
                    status: newStatus
                });
            } else {
                await tdlApi.manageTasks(task.req_id, [{
                    id: task.id,
                    status: newStatus
                }]);
            }
            const action = newStatus === 'Pending' ? 'Paused' : 'Resumed';
            showSuccess(action, `Task ${action.toLowerCase()} successfully`);
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to update task status');
        }
    };

    const openEditModal = (task: TaskData) => {
        setEditTask(task);
        setEditForm({
            user_name: task.user_name || '',
            deadline: task.deadline ? task.deadline.split('T')[0] : '',
            status: task.status || 'Pending',
            remark: task.remark || ''
        });
    };

    const handleEditSave = async () => {
        if (!editTask) return;
        try {
            await tdlApi.manageTasks(editTask.req_id, [{
                id: editTask.id,
                user_name: editForm.user_name,
                task_type: editTask.task_type,
                deadline: editForm.deadline || null,
                status: editForm.status,
                remark: editForm.remark,
                completion_date: editForm.status === 'Completed' ? new Date().toISOString().split('T')[0] : editTask.completion_date,
            }]);
            showSuccess('Updated', 'Task updated successfully');
            setEditTask(null);
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to update task');
        }
    };

    const handleToggleForceCheckin = async (task: TaskData) => {
        if (!isAdmin && !canForceCheckinVisit(task)) return;
        try {
            const newStatus = !task.force_checkin_allowed;
            await visitsApi.toggleForceCheckin(task.id, newStatus);
            showSuccess('Updated', `Force Check-in ${newStatus ? 'Enabled' : 'Disabled'}`);
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to toggle force check-in');
        }
    };

    // ── Create Task Handlers ──
    const handleCustomerSearch = async (q: string) => {
        setCustomerSearch(q);
        if (q.length < 4) { setCustomerResults([]); return; }
        setCustomerSearching(true);
        try {
            const res = await customersApi.search(q);
            setCustomerResults(res.success ? res.data : []);
        } catch { setCustomerResults([]); }
        finally { setCustomerSearching(false); }
    };

    const selectCustomer = (c: any) => {
        setCreateTaskForm(prev => ({
            ...prev,
            customer_id: c.id,
            customer_name: c.company || c.name || '',
            person_name: c.contact_person || '',
            phone_no: c.mobile || c.mobile_no || '',
            task_category: 'customer',
        }));
        setCustomerSearch(c.company || c.name || '');
        setCustomerResults([]);
    };

    const resetCreateTaskForm = () => {
        setCreateTaskForm({ customer_id: null, customer_name: '', person_name: '', phone_no: '', task_category: '', visit_type: '', date: '', remark: '', assign_to: '' });
        setCustomerSearch('');
        setCustomerResults([]);
    };

    const handleCreateTask = async () => {
        if (!createTaskForm.task_category) { showError('Error', 'Please choose Customer, External or Complain'); return; }
        if (createTaskForm.task_category === 'customer' && !createTaskForm.customer_id) { showError('Error', 'Please select a customer'); return; }
        if (createTaskForm.task_category === 'customer' && !createTaskForm.visit_type) { showError('Error', 'Please select Call or Visit'); return; }
        if (!createTaskForm.date) { showError('Error', 'Please select a date'); return; }
        if (!createTaskForm.remark.trim()) { showError('Error', 'Please enter a remark'); return; }

        // Map UI category → cloud_visits.visit_type. Customer Tasks use the
        // Visit/Call sub-pick; External/Self map directly. This keeps all four
        // tabs (Call/Visit/External/Self) reading from a single table.
        const visitType: 'Visit' | 'Call' | 'External' | 'Self' =
            createTaskForm.task_category === 'customer' ? (createTaskForm.visit_type as 'Visit' | 'Call')
            : createTaskForm.task_category === 'external' ? 'External'
            : 'Self';

        // Self tasks are creator-locked; backend will overwrite user_name to assigned_by anyway.
        const assignee =
            createTaskForm.task_category === 'self'
                ? (user?.name || user?.email || '')
                : (createTaskForm.assign_to || user?.name || user?.email || '');

        setCreatingTask(true);
        try {
            const payload: any = {
                visit_type: visitType,
                user_name: assignee,
                scheduled_date: createTaskForm.date,
                remark: createTaskForm.remark,
            };
            if (createTaskForm.task_category === 'customer') {
                payload.customer_id = createTaskForm.customer_id;
            }
            const res = await visitsApi.create(payload);
            if (res.success) {
                showSuccess('Created', 'Task created successfully');
                setShowCreateTask(false);
                resetCreateTaskForm();
                fetchData();
            } else {
                showError('Error', (res as any).message || 'Failed to create task');
            }
        } catch (e: any) {
            showError('Error', e.message || 'Failed to create task');
        } finally { setCreatingTask(false); }
    };

    // ── Update Task Handlers ──
    const openUpdateTaskModal = async (task: TaskData) => {
        setUpdateTaskModal(task);
        setUpdateTaskForm({ remark: '', status: task.status, next_date: '', external_action: '' });
        setTaskUpdatesLoading(true);
        try {
            const res = await tdlApi.getTaskUpdates(task.id);
            setTaskUpdates(res.success ? res.data : []);
        } catch { setTaskUpdates([]); }
        finally { setTaskUpdatesLoading(false); }
    };

    const isExternalTask = (task: TaskData | null) => {
        if (!task) return false;
        if (task.customer_id && task.customer_id > 0) return false;
        const name = (task.customer_name || '').trim();
        return !name || name === 'N/A';
    };

    const handleTaskUpdate = async () => {
        if (!updateTaskModal) return;
        const external = isExternalTask(updateTaskModal);
        // Visit-backed rows (Customer Call/Visit, External, Self) live in
        // cloud_visits — status changes have to go through visitsApi.update,
        // otherwise the row stays as 'In Progress' and never leaves the
        // pending list. TDL/Customization rows still flow through tdlApi.
        const isVisitRow = updateTaskModal.req_id === 0 && updateTaskModal.task_type === 'Connect';

        if (external) {
            if (!updateTaskForm.external_action) { showError('Error', 'Choose an action: Complete, Shift or Save Note'); return; }
            if (!updateTaskForm.remark.trim()) { showError('Error', 'Please enter a remark'); return; }
            if (updateTaskForm.external_action === 'shift' && !updateTaskForm.next_date) { showError('Error', 'Please pick a next date'); return; }
        } else {
            if (!updateTaskForm.remark.trim() && updateTaskForm.status === updateTaskModal.status) {
                showError('Error', 'Enter a remark or change status');
                return;
            }
        }

        setUpdatingTask(true);
        try {
            const payload: { remark?: string; status?: string; next_date?: string } = {
                remark: updateTaskForm.remark.trim() || undefined,
            };
            if (external) {
                if (updateTaskForm.external_action === 'complete') payload.status = 'Completed';
                if (updateTaskForm.external_action === 'shift') payload.next_date = updateTaskForm.next_date;
            } else {
                if (updateTaskForm.status !== updateTaskModal.status) payload.status = updateTaskForm.status;
            }

            let ok = false;
            let errMsg = '';
            if (isVisitRow) {
                // Stamp check_out_time when transitioning to Completed so the
                // completed-tab card has a date. Lat/lng are skipped — the
                // backend geofence is already disabled for Call/External/Self
                // and the user explicitly chose 'Complete' here, no GPS needed.
                const visitPayload: any = { id: updateTaskModal.id };
                if (payload.remark) visitPayload.remark = payload.remark;
                if (payload.status) {
                    visitPayload.status = payload.status;
                    if (payload.status === 'Completed' && !updateTaskModal.check_out_time) {
                        visitPayload.check_out_time = new Date().toISOString().slice(0, 19).replace('T', ' ');
                    }
                }
                if (payload.next_date) visitPayload.scheduled_date = payload.next_date;
                const res = await visitsApi.update(visitPayload);
                ok = (res as any)?.success !== false;
                errMsg = (res as any)?.message || '';
            } else {
                const res = await tdlApi.addTaskUpdate(updateTaskModal.id, payload);
                ok = res.success;
                errMsg = res.message || '';
            }

            if (ok) {
                showSuccess('Updated', 'Task updated successfully');
                setUpdateTaskModal(null);
                fetchData();
            } else {
                showError('Error', errMsg || 'Failed to update');
            }
        } catch (e: any) {
            showError('Error', e.message || 'Failed to update task');
        } finally { setUpdatingTask(false); }
    };

    const formatUpdateTime = (d: string) => {
        if (!d) return '';
        const date = new Date(d.replace(' ', 'T'));
        if (isNaN(date.getTime())) return d;
        const now = Date.now();
        const diff = now - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);
        if (days > 0) return `${days}d ago`;
        if (hrs > 0) return `${hrs}h ago`;
        if (mins > 0) return `${mins}m ago`;
        return 'just now';
    };

    const handleDelete = async (task: TaskData) => {
        const label = task.customer_name || task.requirement_name || `task #${task.id}`;
        if (!window.confirm(`Delete "${label}"? This will remove the task and any check-in/check-out records on it.`)) return;
        if (!window.confirm('This cannot be undone. Continue?')) return;
        try {
            // Check if it's a Visit Task (req_id is 0 placeholder)
            if (task.req_id === 0 && task.task_type === 'Connect') {
                await visitsApi.delete(task.id);
            } else {
                await tdlApi.deleteTask(task.id);
            }
            showSuccess('Deleted', 'Task deleted successfully');
            fetchData();
        } catch (e: any) {
            showError('Error', e.message || 'Failed to delete task');
        }
    };

    // PERMISSION CHECK for Edit Modal
    // Admin: Can edit all
    // Creator (assigned_by user): Can edit all
    // Assignee (user_name): Can ONLY edit Status & Remark
    const canEditAll = editTask && (isAdmin || (user?.name && editTask.assigned_by === user.name));

    return (
        <div className="p-0 space-y-0.5 md:space-y-1" {...taskTabSwipe}>
            {/* Call Confirmation Modal */}
            {callConfirmation && (
                <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-xs overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className="h-16 w-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Phone className="h-8 w-8" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Call</h3>
                            <p className="text-sm text-gray-500 leading-relaxed">
                                Do you want to call <span className="font-bold text-gray-900">{callConfirmation.name}</span>?
                            </p>
                        </div>
                        <div className="flex border-t border-gray-100">
                            <button
                                onClick={() => setCallConfirmation(null)}
                                className="flex-1 px-4 py-4 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors border-r border-gray-100"
                            >
                                No
                            </button>
                            <button
                                onClick={() => {
                                    window.location.href = `tel:${callConfirmation.phone}`;
                                    setCallConfirmation(null);
                                }}
                                className="flex-1 px-4 py-4 text-sm font-bold text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                                Yes, Call
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Recording indicator bar */}
            {recordingVisitId && (
                <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white flex items-center justify-center gap-3 py-2 text-sm font-semibold shadow-lg">
                    <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                    <span>Recording in progress</span>
                    <span className="font-mono bg-red-700 px-2 py-0.5 rounded text-xs">
                        {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                    </span>
                    <span className="text-red-200 text-xs">· Auto-saves on checkout</span>
                </div>
            )}

            {/* Header / Top Bar */}
            <div className={`bg-white border-b border-gray-200 sticky z-10 ${recordingVisitId ? 'top-9' : 'top-0'}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* ─────────── MOBILE HEADER (clean 2 rows) ─────────── */}
                    <div className="md:hidden">
                        {/* Row 1: Back + Title (left) | Filter + Refresh (right) */}
                        <div className="flex items-center justify-between py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                                <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 hover:bg-gray-100 rounded-full shrink-0">
                                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                                </button>
                                <h1 className="text-[18px] font-bold text-gray-900 truncate">My Tasks</h1>
                                {(assigneeFilter !== 'all' || typeFilter !== 'all') && (
                                    <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                        {[assigneeFilter !== 'all' ? assigneeFilter : null, typeFilter !== 'all' ? typeFilter : null].filter(Boolean).join(' · ')}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => activeTab === 'completed' ? setShowCompletedFilters(true) : setShowActiveFilters(true)}
                                    className={`h-9 w-9 inline-flex items-center justify-center border rounded-lg ${(assigneeFilter !== 'all' || typeFilter !== 'all') ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-600 border-gray-200'}`}
                                >
                                    <Filter className="h-4 w-4" />
                                </button>
                                <button onClick={() => activeTab === 'completed' ? fetchCompletedTasks() : fetchData()} className="h-9 w-9 inline-flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-600">
                                    <RefreshCw className={`h-4 w-4 ${(activeTab === 'completed' ? completedLoading : loading) ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>
                        {/* Row 2: full-width Active/Completed underline tabs */}
                        <div className="flex border-b border-gray-200 -mx-4 sm:-mx-6">
                            <button
                                onClick={() => setActiveTab('active')}
                                className={`flex-1 py-2.5 text-[15px] font-semibold text-center border-b-2 transition-colors ${activeTab === 'active' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
                            >
                                Active
                            </button>
                            <button
                                onClick={() => setActiveTab('completed')}
                                className={`flex-1 py-2.5 text-[15px] font-semibold text-center border-b-2 transition-colors ${activeTab === 'completed' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
                            >
                                Completed
                            </button>
                        </div>
                    </div>

                    {/* ─────────── DESKTOP HEADER (2 full-width rows) ─────────── */}
                    <div className="hidden md:block">
                        {/* Row 1: Back + Title + Filters | Active/Completed | Search + Filter + Refresh — full width */}
                        <div className="flex items-center gap-3 py-2.5">
                            <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 hover:bg-gray-100 rounded-full shrink-0">
                                <ChevronLeft className="w-5 h-5 text-gray-600" />
                            </button>
                            <h1 className="text-xl font-bold text-gray-900 tracking-tight shrink-0">My Tasks</h1>

                            {isAdmin && (
                                <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
                                    className="h-9 px-2.5 text-xs font-medium border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 shrink-0">
                                    <option value="all">All Staff</option>
                                    {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                </select>
                            )}
                            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
                                className="h-9 px-2.5 text-xs font-medium border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 shrink-0">
                                <option value="all">All Types</option>
                                <option value="Development">Development</option>
                                <option value="Implementation">Implementation</option>
                                <option value="Connect">Connect</option>
                            </select>
                            {isAdmin && (assigneeFilter !== 'all' || typeFilter !== 'all') && (
                                <button onClick={() => { setAssigneeFilter('all'); setTypeFilter('all'); }} className="text-xs font-medium text-red-500 hover:underline shrink-0">Clear</button>
                            )}

                            <div className="flex bg-gray-100 p-0.5 rounded-lg shrink-0">
                                <button
                                    onClick={() => setActiveTab('active')}
                                    className={`px-4 h-8 rounded-md text-xs font-semibold transition-all ${activeTab === 'active' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Active
                                </button>
                                <button
                                    onClick={() => setActiveTab('completed')}
                                    className={`px-4 h-8 rounded-md text-xs font-semibold transition-all ${activeTab === 'completed' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Completed
                                </button>
                            </div>

                            {/* spacer pushes search + actions to far right */}
                            <div className="flex-1" />

                            <div className="relative flex-1 min-w-[180px] max-w-sm">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    value={activeTab === 'completed' ? completedFilters.search : searchTerm}
                                    onChange={e => activeTab === 'completed' ? setCompletedFilters(prev => ({ ...prev, search: e.target.value })) : setSearchTerm(e.target.value)}
                                    placeholder={activeTab === 'completed' ? 'Search completed tasks…' : 'Search active tasks…'}
                                    className="w-full h-9 pl-9 pr-3 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none transition-colors"
                                />
                            </div>
                            <button
                                onClick={() => activeTab === 'completed' ? setShowCompletedFilters(true) : setShowActiveFilters(true)}
                                className={`h-9 w-9 inline-flex items-center justify-center border rounded-lg transition-colors shrink-0 ${activeTab === 'completed' ? (Object.values(completedFilters).some(f => f && f !== 'all' && f !== '') ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50') : ((typeFilter !== 'all' || statusFilter !== 'all') ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50')}`}
                                title="Filters"
                            >
                                <Filter className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => activeTab === 'completed' ? fetchCompletedTasks() : fetchData()}
                                className="h-9 w-9 inline-flex items-center justify-center bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors shrink-0"
                                title="Refresh"
                            >
                                <RefreshCw className={`h-4 w-4 ${(activeTab === 'completed' ? completedLoading : loading) ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* ─────────── ROW 2 (shared mobile + desktop): 4 connect tabs span full width ─────────── */}
                    <div className="flex items-stretch w-full border-t border-gray-100">
                            {([
                                { key: 'call',     label: 'Call Connect'  },
                                { key: 'visit',    label: 'Visit Connect' },
                                { key: 'external', label: 'External'      },
                                { key: 'self',     label: 'Complain'      },
                            ] as const).map(t => {
                                const active = connectTab === t.key;
                                return (
                                    <button
                                        key={t.key}
                                        onClick={() => setConnectTab(t.key as ConnectTab)}
                                        className={`flex-1 px-2 py-2.5 text-[13px] font-semibold border-b-2 transition-colors min-w-0 truncate ${
                                            active
                                                ? 'text-blue-700 border-blue-600'
                                                : 'text-gray-500 border-transparent hover:text-gray-700 active:bg-gray-50'
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                );
                            })}
                    </div>
                </div>
            </div>

                    {/* Filter Active Modal */}
                    <FilterModal
                        isOpen={showActiveFilters}
                        onClose={() => setShowActiveFilters(false)}
                        title="Filter Active Tasks"
                        config={activeFilterConfig}
                        currentFilters={{ type: typeFilter, status: statusFilter, ...(isAdmin ? { assignee: assigneeFilter } : {}) }}
                        onApply={(newFilters) => {
                            setTypeFilter(newFilters.type as any);
                            setStatusFilter(newFilters.status as any);
                            if (isAdmin && newFilters.assignee !== undefined) setAssigneeFilter(newFilters.assignee as any);
                            setShowActiveFilters(false);
                        }}
                        onReset={() => {
                            resetActiveFilters();
                            setShowActiveFilters(false);
                        }}
                    />


            {/* Content for Active Tab */}
            {activeTab === 'active' && (
                <>
                {/* Swipe wrapper — entire tab content is swipeable */}
                <div {...connectTabSwipe}>
                {/* Mobile View (Cards) */}
            <div className="block md:hidden p-3 space-y-2.5 bg-gray-50/50 mb-20">
                {loading ? (
                    <div className="py-8 text-center text-sm text-gray-400">Loading tasks...</div>
                ) : filtered.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400">No tasks found</div>
                ) : (
                    filtered.map(t => {
                        const swipeActions = [
                            ...(canCheckinVisit(t) && !isExternalTask(t) && !t.check_in_date && t.status === 'In Progress' ? [{ label: 'Check In', color: 'bg-blue-500', onClick: () => handleCheckIn(t) }] : []),
                            ...(canCheckinVisit(t) && !isExternalTask(t) && t.check_in_date && t.status === 'In Progress' && !t.check_out_time ? [{ label: recordingVisitId === t.id ? '● Out' : 'Check Out', color: 'bg-emerald-500', onClick: () => handleCheckOut(t) }] : []),
                            ...(canPauseVisit(t) && t.task_type === 'Connect' && !t.check_in_date && t.status !== 'Completed' && t.status === 'In Progress' ? [{ label: 'Pause', color: 'bg-amber-500', onClick: () => handleTaskStatusUpdate(t, 'Pending') }] : []),
                            ...(canPauseVisit(t) && t.task_type === 'Connect' && !t.check_in_date && t.status !== 'Completed' && t.status !== 'In Progress' ? [{ label: 'Resume', color: 'bg-blue-500', onClick: () => handleTaskStatusUpdate(t, 'In Progress') }] : []),
                            ...(t.source === 'tdl' ? [{ label: 'Update', color: 'bg-purple-500', onClick: () => openUpdateTaskModal(t) }] : []),
                            { label: 'Map', color: 'bg-gray-500', onClick: () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.customer_name || '')}`, '_blank') },
                            ...(canEditVisit(t) ? [{ label: 'Edit', color: 'bg-indigo-500', onClick: () => openEditModal(t) }] : []),
                            ...(canDeleteVisit(t) ? [{ label: 'Delete', color: 'bg-red-500', onClick: () => handleDelete(t) }] : []),
                        ];

                        return (
                            <SwipeableCard key={t.id} actions={swipeActions}>
                                <div className="bg-white p-3.5 rounded-xl border-2 border-gray-300 shadow-sm">
                                        {/* Row 1: Company Name | Time */}
                                        <div className="flex items-center justify-between gap-2 border-b-2 border-gray-100 pb-2 mb-2">
                                            <div className="text-[19px] font-bold text-gray-900 truncate flex-1">
                                                <CustomerNameLink customerId={t.customer_id} name={t.customer_name} fallback="Generic Task" />
                                            </div>
                                            <span className="text-[19px] text-gray-500 shrink-0">{t.allotment_date ? Math.floor((new Date().getTime() - new Date(t.allotment_date).getTime()) / (1000 * 3600 * 24)) + 'd ago' : '—'}</span>
                                        </div>

                                        {/* Row 2: Staff | Phone */}
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[19px] text-gray-900 truncate">{t.user_name || '—'}</span>
                                            {t.phone_no ? (
                                                <a href={`tel:${t.phone_no}`} className="text-[19px] text-gray-900 shrink-0">{t.phone_no}</a>
                                            ) : (
                                                <span className="text-[19px] text-gray-400 shrink-0">—</span>
                                            )}
                                        </div>

                                        {/* Row 3: Remark */}
                                        {t.remark && (
                                        <div className="mt-2">
                                            <span className="text-[19px] text-gray-900 truncate block">{t.remark}</span>
                                        </div>
                                        )}
                                </div>
                            </SwipeableCard>
                        );
                    })
                )}
            </div>

            {/* Table View (Desktop) */}
            <div className="hidden md:block">
                <div className="bg-white border-y overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-base md:text-sm text-left">
                            <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs md:text-sm border-b">
                                <tr>
                                    {colPermsActive.isVisible('customer') && <th className="px-4 py-3 border-r">Customer</th>}
                                    {colPermsActive.isVisible('type') && <th className="px-4 py-3 border-r">Type</th>}
                                    {colPermsActive.isVisible('staff') && <th className="px-4 py-3 border-r">Staff</th>}
                                    {colPermsActive.isVisible('added') && <th className="px-4 py-3 border-r text-center">Added</th>}
                                    {colPermsActive.isVisible('in_time') && <th className="px-4 py-3 border-r text-center">In Time</th>}
                                    {colPermsActive.isVisible('out_time') && <th className="px-4 py-3 border-r text-center">Out Time</th>}
                                    {colPermsActive.isVisible('remark') && <th className="px-4 py-3 border-r">Remark</th>}
                                    <th className="px-4 py-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr><td colSpan={8} className="text-center py-20 text-gray-400">
                                        <RefreshCw className="h-10 w-10 animate-spin mx-auto mb-2 opacity-20" />
                                        <p className="font-bold uppercase tracking-widest text-sm">Loading...</p>
                                    </td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="text-center py-20 text-gray-400">
                                        <Filter className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                        <p className="font-bold uppercase tracking-widest text-sm">No records</p>
                                    </td></tr>
                                ) : (
                                    filtered.map(t => (
                                        <tr key={t.id} className="hover:bg-blue-50/30 transition-colors">
                                            {colPermsActive.isVisible('customer') && <td className="px-4 py-3 border-r" style={colPermsActive.cellStyle('customer')} onContextMenu={colPermsActive.onCellContextMenu('customer')}>
                                                <div className="font-bold text-gray-900 text-base md:text-sm">
                                                    <CustomerNameLink customerId={t.customer_id} name={t.customer_name} />
                                                </div>
                                                <div className="text-sm md:text-sm text-gray-400 font-medium truncate max-w-[200px]">{t.requirement_name}</div>
                                            </td>}
                                            {colPermsActive.isVisible('type') && <td className="px-4 py-3 border-r text-gray-600 font-bold text-base md:text-sm" style={colPermsActive.cellStyle('type')} onContextMenu={colPermsActive.onCellContextMenu('type')}>{t.task_type}</td>}
                                            {colPermsActive.isVisible('staff') && <td className="px-4 py-3 border-r text-gray-600 font-medium text-base md:text-sm" style={colPermsActive.cellStyle('staff')} onContextMenu={colPermsActive.onCellContextMenu('staff')}>{t.user_name || '-'}</td>}
                                            {colPermsActive.isVisible('added') && <td className="px-4 py-3 border-r text-center text-gray-500 text-sm md:text-sm" style={colPermsActive.cellStyle('added')} onContextMenu={colPermsActive.onCellContextMenu('added')}>{formatDate(t.allotment_date)}</td>}
                                            {colPermsActive.isVisible('in_time') && <td className="px-4 py-3 border-r text-center text-gray-500 text-sm md:text-sm" style={colPermsActive.cellStyle('in_time')} onContextMenu={colPermsActive.onCellContextMenu('in_time')}>{formatTime(t.check_in_time)}</td>}
                                            {colPermsActive.isVisible('out_time') && <td className="px-4 py-3 border-r text-center text-gray-500 text-sm md:text-sm" style={colPermsActive.cellStyle('out_time')} onContextMenu={colPermsActive.onCellContextMenu('out_time')}>{formatTime(t.check_out_time)}</td>}
                                            {colPermsActive.isVisible('remark') && <td className="px-4 py-3 border-r text-gray-500 text-sm md:text-sm max-w-xs truncate" style={colPermsActive.cellStyle('remark')} onContextMenu={colPermsActive.onCellContextMenu('remark')} title={t.remark}>{t.remark || '-'}</td>}
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    {canEditVisit(t) && !isExternalTask(t) && (
                                                        !t.check_in_date ? (
                                                            <button onClick={() => handleCheckIn(t)} disabled={checkInBusyId === t.id} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase active:scale-95 shadow-sm hover:bg-blue-700 transition-all inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed">{checkInBusyId === t.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'In'}</button>
                                                        ) : (!t.check_out_time && t.status === 'In Progress') ? (
                                                            <button onClick={() => handleCheckOut(t)} className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase active:scale-95 shadow-sm hover:bg-emerald-700 transition-all inline-flex items-center gap-1">
                                                                {recordingVisitId === t.id && <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
                                                                Out
                                                            </button>
                                                        ) : null
                                                    )}
                                                    {t.source === 'tdl' && <button onClick={() => openUpdateTaskModal(t)} className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg border border-transparent hover:border-purple-100 transition-all" title="Update"><MessageSquare className="h-5 w-5" /></button>}
                                                    {canEditVisit(t) && <button onClick={() => openEditModal(t)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-all"><Edit2 className="h-5 w-5" /></button>}
                                                    {canDeleteVisit(t) && <button onClick={() => handleDelete(t)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all"><Trash2 className="h-5 w-5" /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-5 py-3 border-t bg-gray-50 text-xs font-bold text-gray-400 uppercase tracking-widest">
                        Total {filtered.length} tasks
                    </div>
                </div>
            </div>
            </div>
            </>
          )}

        {/* Completed Tab Content */}
        {activeTab === 'completed' && (
            <div className="bg-white">

                {/* Mobile Card View */}
                <div className="block md:hidden p-3 space-y-2.5 bg-gray-50/50 mb-20">
                    {completedLoading ? (
                        <div className="py-8 text-center text-sm text-gray-400">Loading history...</div>
                    ) : filteredCompletedTasks.length === 0 ? (
                        <div className="py-8 text-center text-sm text-gray-400">No history found</div>
                    ) : (
                        filteredCompletedTasks.map((t, idx) => (
                            <SwipeableCard key={idx} actions={[
                                { label: 'View', color: 'bg-purple-500', onClick: () => openCompletedTask(t) },
                            ]}>
                                <div className="bg-white p-3.5 rounded-xl border-2 border-gray-300 shadow-sm cursor-pointer active:bg-gray-50" onClick={() => openCompletedTask(t)}>
                                        {/* Row 1: Company Name | Date */}
                                        <div className="flex items-center justify-between gap-2 border-b-2 border-gray-100 pb-2 mb-2">
                                            <div className="text-[19px] font-bold text-gray-900 truncate flex-1">
                                                <CustomerNameLink customerId={t.customer_id} name={t.customer_name} fallback="Unknown" />
                                            </div>
                                            <span className="text-[19px] text-gray-500 shrink-0">{t.check_out_time || t.completion_date ? new Date(t.check_out_time || t.completion_date).toLocaleDateString('en-IN') : '—'}</span>
                                        </div>

                                        {/* Row 2: Staff | Phone */}
                                        <div className="flex items-center justify-between gap-2 mt-1.5">
                                            <span className="text-[19px] text-gray-900 truncate">{t.user_name || '—'}</span>
                                            {t.phone_no ? (
                                                <a href={`tel:${t.phone_no}`} onClick={e => e.stopPropagation()} className="text-[19px] text-gray-900 shrink-0">{t.phone_no}</a>
                                            ) : (
                                                <span className="text-[19px] text-gray-400 shrink-0">—</span>
                                            )}
                                        </div>

                                        {/* Row 3: Remark */}
                                        {(t.check_out_remark || t.remark) && (
                                        <div className="mt-2">
                                            <span className="text-[19px] text-gray-900 truncate block">{t.check_out_remark || t.remark}</span>
                                        </div>
                                        )}
                                </div>
                            </SwipeableCard>
                        ))
                    )}

                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-base md:text-sm text-left whitespace-nowrap">
                        <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-xs md:text-sm border-b">
                            <tr>
                                {colPermsCompleted.isVisible('checkout_date') && <th className="px-4 py-3 border-r">Check-out Date</th>}
                                {colPermsCompleted.isVisible('customer') && <th className="px-4 py-3 border-r">Customer</th>}
                                {colPermsCompleted.isVisible('staff') && <th className="px-4 py-3 border-r">Staff</th>}
                                {colPermsCompleted.isVisible('type') && <th className="px-4 py-3 border-r">Type</th>}
                                {colPermsCompleted.isVisible('in_time') && <th className="px-4 py-3 border-r text-center">In Time</th>}
                                {colPermsCompleted.isVisible('out_time') && <th className="px-4 py-3 border-r text-center">Out Time</th>}
                                {colPermsCompleted.isVisible('remark') && <th className="px-4 py-3 border-r">Remark</th>}
                                {/* Tracking Cols */}
                                {colPermsCompleted.isVisible('response') && <th className="px-4 py-3 border-r bg-blue-50/50">Response</th>}
                                {colPermsCompleted.isVisible('loyalty') && <th className="px-4 py-3 border-r bg-blue-50/50">Loyalty</th>}
                                {colPermsCompleted.isVisible('biz_type') && <th className="px-4 py-3 border-r bg-blue-50/50">Biz Type</th>}
                                {colPermsCompleted.isVisible('einvoice') && <th className="px-4 py-3 border-r bg-blue-50/50">E-Invoice</th>}
                                {colPermsCompleted.isVisible('acct_person') && <th className="px-4 py-3 border-r bg-blue-50/50">Acct Person</th>}
                                {colPermsCompleted.isVisible('it_person') && <th className="px-4 py-3 border-r bg-blue-50/50">IT Person</th>}
                                {colPermsCompleted.isVisible('ca_name') && <th className="px-4 py-3 border-r bg-blue-50/50">CA Name</th>}
                                {colPermsCompleted.isVisible('eway_bill') && <th className="px-4 py-3 border-r bg-blue-50/50">E-Way Bill</th>}
                                {colPermsCompleted.isVisible('banking') && <th className="px-4 py-3 border-r bg-blue-50/50">Banking</th>}
                                {colPermsCompleted.isVisible('whatsapp') && <th className="px-4 py-3 border-r bg-blue-50/50">Whatsapp</th>}
                                {colPermsCompleted.isVisible('custom') && <th className="px-4 py-3 border-r bg-blue-50/50">Custom</th>}
                                {colPermsCompleted.isVisible('tally_slow') && <th className="px-4 py-3 border-r bg-blue-50/50">Tally Slow</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {completedLoading ? (
                                <tr>
                                    <td colSpan={20} className="px-4 py-10 text-center text-gray-400">
                                        <RefreshCw className="h-10 w-10 animate-spin mx-auto mb-2" />
                                        <p className="font-bold uppercase tracking-widest text-sm">Loading history...</p>
                                    </td>
                                </tr>
                            ) : filteredCompletedTasks.length === 0 ? (
                                <tr><td colSpan={20} className="text-center py-20 text-gray-400 font-bold uppercase tracking-widest text-sm">No history found</td></tr>
                            ) : (
                                filteredCompletedTasks.map((t, idx) => (
                                    <tr key={idx} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => openCompletedTask(t)}>
                                         {colPermsCompleted.isVisible('checkout_date') && <td className="px-4 py-3 border-r font-medium text-gray-500 text-sm md:text-sm" style={colPermsCompleted.cellStyle('checkout_date')} onContextMenu={colPermsCompleted.onCellContextMenu('checkout_date')}>
                                             <div className="flex items-center gap-1.5">
                                                 {t.recording_path && <span title="Has recording" className="w-2 h-2 rounded-full bg-red-400 shrink-0" />}
                                                 {formatDate(t.check_out_time || t.completion_date)}
                                             </div>
                                         </td>}
                                         {colPermsCompleted.isVisible('customer') && <td className="px-4 py-3 border-r font-bold text-gray-900 text-base md:text-sm" style={colPermsCompleted.cellStyle('customer')} onContextMenu={colPermsCompleted.onCellContextMenu('customer')} onClick={e => e.stopPropagation()}><CustomerNameLink customerId={t.customer_id} name={t.customer_name} /></td>}
                                         {colPermsCompleted.isVisible('staff') && <td className="px-4 py-3 border-r text-gray-600 text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('staff')} onContextMenu={colPermsCompleted.onCellContextMenu('staff')}>{t.user_name}</td>}
                                         {colPermsCompleted.isVisible('type') && <td className="px-4 py-3 border-r text-base md:text-sm" style={colPermsCompleted.cellStyle('type')} onContextMenu={colPermsCompleted.onCellContextMenu('type')}>{t.visit_type || t.task_type}</td>}
                                         {colPermsCompleted.isVisible('in_time') && <td className="px-4 py-3 border-r text-center font-medium text-gray-500 text-sm md:text-sm" style={colPermsCompleted.cellStyle('in_time')} onContextMenu={colPermsCompleted.onCellContextMenu('in_time')}>{formatTime(t.check_in_time)}</td>}
                                         {colPermsCompleted.isVisible('out_time') && <td className="px-4 py-3 border-r text-center font-medium text-gray-500 text-sm md:text-sm" style={colPermsCompleted.cellStyle('out_time')} onContextMenu={colPermsCompleted.onCellContextMenu('out_time')}>{formatTime(t.check_out_time)}</td>}
                                         {colPermsCompleted.isVisible('remark') && <td className="px-4 py-3 border-r max-w-xs truncate text-sm md:text-sm" style={colPermsCompleted.cellStyle('remark')} onContextMenu={colPermsCompleted.onCellContextMenu('remark')} title={t.check_out_remark || t.remark}>{t.check_out_remark || t.remark || '-'}</td>}

                                         {colPermsCompleted.isVisible('response') && <td className="px-4 py-3 border-r text-blue-600 font-bold text-base md:text-sm" style={colPermsCompleted.cellStyle('response')} onContextMenu={colPermsCompleted.onCellContextMenu('response')}>{t.check_out_response || '-'}</td>}
                                         {colPermsCompleted.isVisible('loyalty') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('loyalty')} onContextMenu={colPermsCompleted.onCellContextMenu('loyalty')}>{t.customer_behaviour || '-'}</td>}
                                         {colPermsCompleted.isVisible('biz_type') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('biz_type')} onContextMenu={colPermsCompleted.onCellContextMenu('biz_type')}>{t.business_type || '-'}</td>}
                                         {colPermsCompleted.isVisible('einvoice') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('einvoice')} onContextMenu={colPermsCompleted.onCellContextMenu('einvoice')}>{t.e_invoice || '-'}</td>}
                                         {colPermsCompleted.isVisible('acct_person') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('acct_person')} onContextMenu={colPermsCompleted.onCellContextMenu('acct_person')}>{t.accounts_person_type || '-'}</td>}
                                         {colPermsCompleted.isVisible('it_person') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('it_person')} onContextMenu={colPermsCompleted.onCellContextMenu('it_person')}>{t.it_person || '-'}</td>}
                                         {colPermsCompleted.isVisible('ca_name') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('ca_name')} onContextMenu={colPermsCompleted.onCellContextMenu('ca_name')}>{t.ca_name || '-'}</td>}
                                         {colPermsCompleted.isVisible('eway_bill') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('eway_bill')} onContextMenu={colPermsCompleted.onCellContextMenu('eway_bill')}>{t.e_way_bill || '-'}</td>}
                                         {colPermsCompleted.isVisible('banking') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('banking')} onContextMenu={colPermsCompleted.onCellContextMenu('banking')}>{t.connected_banking || '-'}</td>}
                                         {colPermsCompleted.isVisible('whatsapp') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('whatsapp')} onContextMenu={colPermsCompleted.onCellContextMenu('whatsapp')}>{t.whatsapp_enabled || '-'}</td>}
                                         {colPermsCompleted.isVisible('custom') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('custom')} onContextMenu={colPermsCompleted.onCellContextMenu('custom')}>{t.customisation || '-'}</td>}
                                         {colPermsCompleted.isVisible('tally_slow') && <td className="px-4 py-3 border-r text-base md:text-sm font-medium" style={colPermsCompleted.cellStyle('tally_slow')} onContextMenu={colPermsCompleted.onCellContextMenu('tally_slow')}>{t.tally_slow || '-'}</td>}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                
                 <PaginationControls
                    currentPage={completedPage}
                    totalPages={Math.ceil(completedTotal / completedLimit)}
                    onPageChange={setCompletedPage}
                    loading={completedLoading}
                    totalItems={completedTotal}
                    itemsPerPage={completedLimit}
                    className="border-t"
                />

                <FilterModal
                    isOpen={showCompletedFilters}
                    onClose={() => setShowCompletedFilters(false)}
                    config={completedFilterConfig}
                    currentFilters={completedFilters}
                    onApply={(newFilters) => { setCompletedFilters(prev => ({ ...prev, ...newFilters })); setCompletedPage(1); }}
                    onReset={() => { setCompletedFilters({ user_name: 'all', date_from: '', date_to: '', search: '' }); setCompletedPage(1); }}
                />
            </div>
        )}


            {/* View Modal */}
            {
                viewTask && (
                    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-5 border-b flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-800">Task Details</h3>
                                <button onClick={() => setViewTask(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Customer</div>
                                        <div className="font-medium text-gray-900">{viewTask?.customer_name}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Task Type</div>
                                        <div className="font-medium text-gray-900">{viewTask?.task_type}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Assigned To</div>
                                        <div className="font-medium text-gray-900">{viewTask?.user_name || '-'}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Assigned By</div>
                                        <div className="font-medium text-gray-900">{viewTask?.assigned_by || '-'}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Added Date</div>
                                        <div className="font-medium text-gray-900">{formatDate(viewTask?.allotment_date)}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Deadline</div>
                                        <div className="font-medium text-gray-900">{formatDate(viewTask?.deadline)}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Completed</div>
                                        <div className="font-medium text-gray-900">{formatDate(viewTask?.completion_date)}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Status</div>
                                        <div className="font-medium text-gray-900">{viewTask?.status || 'Pending'}</div>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-gray-500">Requirement</div>
                                    <div className="font-medium text-gray-900 bg-gray-50 p-3 rounded-lg text-sm">{viewTask?.requirement_name}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-gray-500">Remark</div>
                                    <div className="font-medium text-gray-900 bg-gray-50 p-3 rounded-lg text-sm">{viewTask?.remark || 'No remark'}</div>
                                </div>
                            </div>
                            <div className="p-5 border-t bg-gray-50 flex justify-end rounded-b-2xl">
                                <button onClick={() => setViewTask(null)} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Checkout Details Modal (for completed tasks) */}
            {
                viewCompletedTask && (
                    <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center pb-16 md:pb-0" onClick={() => setViewCompletedTask(null)}>
                        <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom md:fade-in md:zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                            {/* Header */}
                            <div className={`p-4 border-b flex justify-between items-start ${isExternalTask(viewCompletedTask) ? 'bg-gradient-to-r from-purple-50 to-fuchsia-50' : 'bg-gradient-to-r from-blue-50 to-indigo-50'}`}>
                                <div>
                                    {isExternalTask(viewCompletedTask) ? (
                                        <h3 className="text-lg font-bold text-purple-700 flex items-center gap-2"><Briefcase className="h-4 w-4" /> External Task</h3>
                                    ) : (
                                        <h3 className="text-lg font-bold text-gray-900">{viewCompletedTask.customer_name}</h3>
                                    )}
                                    <div className="flex items-center gap-3 mt-1">
                                        <span className="text-xs font-bold text-gray-500">{viewCompletedTask.user_name}</span>
                                        <span className="text-xs text-gray-300">•</span>
                                        <span className="text-xs font-bold text-gray-500">{formatDate(viewCompletedTask.check_out_time || viewCompletedTask.completion_date)}</span>
                                    </div>
                                </div>
                                <button onClick={() => setViewCompletedTask(null)} className="p-1.5 hover:bg-white/80 rounded-lg">
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>

                            {isExternalTask(viewCompletedTask) ? (
                                /* External Task — Simplified view (no checkout form fields) */
                                <div className="overflow-y-auto max-h-[65vh] p-4 space-y-4">
                                    {/* Final remark */}
                                    {viewCompletedTask.remark && (
                                        <div className="bg-gray-50 rounded-lg p-3">
                                            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Final Remark</div>
                                            <div className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{viewCompletedTask.remark}</div>
                                        </div>
                                    )}

                                    {/* Activity Timeline */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Clock className="h-4 w-4 text-gray-400" />
                                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Activity Timeline</span>
                                        </div>
                                        {completedTaskUpdatesLoading ? (
                                            <div className="py-4 text-center text-sm text-gray-400">Loading...</div>
                                        ) : completedTaskUpdates.length === 0 ? (
                                            <div className="py-4 text-center text-sm text-gray-400">No updates recorded</div>
                                        ) : (
                                            <div className="space-y-2">
                                                {completedTaskUpdates.map((u: any) => (
                                                    <div key={u.id} className="border-l-2 border-purple-200 pl-3 py-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                                u.update_type === 'Remark' ? 'bg-blue-100 text-blue-700' :
                                                                u.update_type === 'StatusChange' ? 'bg-amber-100 text-amber-700' :
                                                                u.update_type === 'DateChange' ? 'bg-purple-100 text-purple-700' :
                                                                'bg-gray-100 text-gray-600'
                                                            }`}>{u.update_type}</span>
                                                            <span className="text-[11px] text-gray-400">{formatUpdateTime(u.created_at)}</span>
                                                        </div>
                                                        {u.content && <p className="text-xs text-gray-700 mt-0.5">{u.content}</p>}
                                                        {(u.update_type === 'StatusChange' || u.update_type === 'DateChange') && (
                                                            <p className="text-xs text-gray-500 mt-0.5">{u.old_value || '—'} → {u.new_value}</p>
                                                        )}
                                                        <p className="text-[11px] text-gray-400 mt-0.5">by {u.created_by}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Time Info */}
                                    <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-100">
                                        <div className="px-4 py-3 text-center">
                                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">In Time</div>
                                            <div className="text-sm font-bold text-gray-900 mt-0.5">{formatTime(viewCompletedTask.check_in_time)}</div>
                                        </div>
                                        <div className="px-4 py-3 text-center">
                                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Out Time</div>
                                            <div className="text-sm font-bold text-gray-900 mt-0.5">{formatTime(viewCompletedTask.check_out_time)}</div>
                                        </div>
                                    </div>

                                    {/* Checkout Form Data */}
                                    <div className="overflow-y-auto max-h-[55vh] p-4 space-y-3">
                                        {/* Remark */}
                                        {(viewCompletedTask.check_out_remark || viewCompletedTask.remark) && (
                                            <div className="bg-gray-50 rounded-lg p-3">
                                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Remark</div>
                                                <div className="text-sm font-medium text-gray-900">{viewCompletedTask.check_out_remark || viewCompletedTask.remark}</div>
                                            </div>
                                        )}

                                        {/* Form Fields Grid */}
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { label: 'Response', value: viewCompletedTask.check_out_response, highlight: true },
                                                { label: 'Loyalty', value: viewCompletedTask.customer_behaviour },
                                                { label: 'Business Type', value: viewCompletedTask.business_type },
                                                { label: 'E-Invoice', value: viewCompletedTask.e_invoice },
                                                { label: 'Accounts Person', value: viewCompletedTask.accounts_person_type },
                                                { label: 'IT Person', value: viewCompletedTask.it_person },
                                                { label: 'CA Name', value: viewCompletedTask.ca_name },
                                                { label: 'E-Way Bill', value: viewCompletedTask.e_way_bill },
                                                { label: 'Banking', value: viewCompletedTask.connected_banking },
                                                { label: 'WhatsApp', value: viewCompletedTask.whatsapp_enabled },
                                                { label: 'Customisation', value: viewCompletedTask.customisation },
                                                { label: 'Tally Slow', value: viewCompletedTask.tally_slow },
                                                { label: 'Conversion', value: viewCompletedTask.conversion_probability },
                                                { label: 'Biz Description', value: viewCompletedTask.business_description },
                                            ].map((field, i) => (
                                                <div key={i} className={`rounded-lg p-2.5 border ${field.highlight && field.value ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                                                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{field.label}</div>
                                                    <div className={`text-sm font-bold mt-0.5 ${field.highlight && field.value ? 'text-blue-700' : 'text-gray-900'}`}>
                                                        {field.value || '-'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Recording playback */}
                            {viewCompletedTask.recording_path && (
                                <div className="px-4 pb-3">
                                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Visit Recording</p>
                                    <audio controls className="w-full" src={visitsApi.getRecordingUrl(viewCompletedTask.id, viewCompletedTask.recording_path)} />
                                </div>
                            )}

                            {/* Footer */}
                            <div className="p-4 border-t bg-gray-50 flex justify-end rounded-b-2xl">
                                <button onClick={() => setViewCompletedTask(null)} className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 active:scale-95 transition-all">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Edit Modal */}
            {
                editTask && (
                    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-5 border-b flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-800">Edit Task</h3>
                                <button onClick={() => setEditTask(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Assigned By</label>
                                        <input
                                            value={editTask?.assigned_by || 'System'}
                                            disabled
                                            className="w-full border rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Assigned To</label>
                                        <select
                                            value={editForm.user_name}
                                            onChange={e => setEditForm({ ...editForm, user_name: e.target.value })}
                                            disabled={!canEditAll}
                                            className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        >
                                            <option value="">Select Person</option>
                                            {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Deadline</label>
                                    <input
                                        type="date"
                                        value={editForm.deadline}
                                        onChange={e => setEditForm({ ...editForm, deadline: e.target.value })}
                                        disabled={!canEditAll}
                                        className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Status</label>
                                    <select
                                        value={editForm.status}
                                        onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                                        className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                                    >
                                        <option value="Pending">Pending</option>
                                        <option value="In Progress">In Progress</option>
                                        <option value="Completed">Completed</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Remark</label>
                                    <textarea
                                        value={editForm.remark}
                                        onChange={e => setEditForm({ ...editForm, remark: e.target.value })}
                                        rows={3}
                                        className="w-full border rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-100 outline-none"
                                        placeholder="Enter remark..."
                                    />
                                </div>
                            </div>
                            <div className="p-5 border-t bg-gray-50 flex justify-end gap-2 rounded-b-2xl">
                                <button onClick={() => setEditTask(null)} className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50">
                                    Cancel
                                </button>
                                <button onClick={handleEditSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Checkout Modal */}
            {/* Floating + Button */}
            <button
                onClick={() => { resetCreateTaskForm(); setShowCreateTask(true); }}
                className="fixed bottom-24 right-6 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center md:bottom-8 md:right-8"
            >
                <Plus className="h-7 w-7" />
            </button>

            {/* Create Task Modal */}
            {showCreateTask && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center pb-16 md:pb-0" onClick={() => setShowCreateTask(false)}>
                    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom md:fade-in md:zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b flex justify-between items-center">
                            <h3 className="text-lg font-bold text-gray-900">Create Task</h3>
                            <button onClick={() => setShowCreateTask(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="h-5 w-5 text-gray-400" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
                            {/* Task Category Toggle */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Task For</label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        onClick={() => setCreateTaskForm(prev => ({ ...prev, task_category: 'customer' }))}
                                        className={`py-3 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center justify-center gap-1 ${createTaskForm.task_category === 'customer' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                        <User className="h-4 w-4" /> Customer
                                    </button>
                                    <button
                                        onClick={() => { setCreateTaskForm(prev => ({ ...prev, task_category: 'external', customer_id: null, customer_name: '', person_name: '', phone_no: '', visit_type: '' })); setCustomerSearch(''); setCustomerResults([]); }}
                                        className={`py-3 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center justify-center gap-1 ${createTaskForm.task_category === 'external' ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                        <Briefcase className="h-4 w-4" /> External
                                    </button>
                                    <button
                                        onClick={() => { setCreateTaskForm(prev => ({ ...prev, task_category: 'self', customer_id: null, customer_name: '', person_name: '', phone_no: '', visit_type: '', assign_to: '' })); setCustomerSearch(''); setCustomerResults([]); }}
                                        className={`py-3 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center justify-center gap-1 ${createTaskForm.task_category === 'self' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                        <Clock className="h-4 w-4" /> Complain
                                    </button>
                                </div>
                                {createTaskForm.task_category === 'self' && (
                                    <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                                        Complain entry visible only to you. Admins can view via the user filter.
                                    </div>
                                )}
                            </div>

                            {/* Customer Search - only when Customer Task selected */}
                            {createTaskForm.task_category === 'customer' && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Search Customer</label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <input
                                            value={customerSearch}
                                            onChange={e => handleCustomerSearch(e.target.value)}
                                            placeholder="Search by name, mobile..."
                                            className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                                        />
                                        {customerSearching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
                                    </div>
                                    {customerResults.length > 0 && (
                                        <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto bg-white shadow-lg">
                                            {customerResults.map((c: any) => (
                                                <button key={c.id} onClick={() => selectCustomer(c)}
                                                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-0 text-sm">
                                                    <div className="font-medium text-gray-900">{c.company || c.name}</div>
                                                    <div className="text-xs text-gray-500">{c.mobile || c.mobile_no} {c.city ? `- ${c.city}` : ''}</div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {createTaskForm.customer_id && (
                                        <div className="mt-2 flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg">
                                            <span className="text-sm font-medium text-blue-800">{createTaskForm.customer_name}</span>
                                            <button onClick={() => { setCreateTaskForm(prev => ({ ...prev, customer_id: null, customer_name: '', person_name: '', phone_no: '', visit_type: '' })); setCustomerSearch(''); }}
                                                className="ml-auto text-blue-600 hover:text-blue-800"><X className="h-4 w-4" /></button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Task Type (Call/Visit) - only if customer selected */}
                            {createTaskForm.task_category === 'customer' && createTaskForm.customer_id && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Type</label>
                                    <div className="flex gap-3">
                                        {(['Call', 'Visit'] as const).map(type => (
                                            <button key={type} onClick={() => setCreateTaskForm(prev => ({ ...prev, visit_type: type }))}
                                                className={`flex-1 py-2.5 rounded-lg text-sm font-bold border-2 transition-all ${createTaskForm.visit_type === type ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Date + Assign To row */}
                            {createTaskForm.task_category && (
                                <div className={`grid gap-3 ${createTaskForm.task_category === 'self' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Date</label>
                                        <input type="date" value={createTaskForm.date}
                                            onChange={e => setCreateTaskForm(prev => ({ ...prev, date: e.target.value }))}
                                            className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
                                    </div>
                                    {createTaskForm.task_category !== 'self' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Assign To</label>
                                            <select value={createTaskForm.assign_to}
                                                onChange={e => setCreateTaskForm(prev => ({ ...prev, assign_to: e.target.value }))}
                                                className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none">
                                                <option value="">Me ({user?.name})</option>
                                                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Remark */}
                            {createTaskForm.task_category && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Remark</label>
                                    <textarea value={createTaskForm.remark}
                                        onChange={e => setCreateTaskForm(prev => ({ ...prev, remark: e.target.value }))}
                                        rows={3} placeholder="Enter task details..."
                                        className="w-full border rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-100 outline-none" />
                                </div>
                            )}
                        </div>
                        <div className="p-5 border-t bg-gray-50 flex justify-end gap-2 rounded-b-2xl">
                            <button onClick={() => setShowCreateTask(false)} className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
                            <button onClick={handleCreateTask} disabled={creatingTask}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {creatingTask ? 'Creating...' : 'Create Task'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Task Modal (like lead requirement update) */}
            {updateTaskModal && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center pb-16 md:pb-0" onClick={() => setUpdateTaskModal(null)}>
                    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom md:fade-in md:zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b shrink-0">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-900">Update Task</h3>
                                <button onClick={() => setUpdateTaskModal(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5 truncate">
                                {isExternalTask(updateTaskModal) ? (
                                    <span className="inline-flex items-center gap-1 text-purple-600 font-semibold"><Briefcase className="h-3 w-3" /> External Task</span>
                                ) : updateTaskModal.customer_name} {updateTaskModal.remark ? `- ${updateTaskModal.remark}` : ''}
                            </p>
                        </div>
                        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                            {isExternalTask(updateTaskModal) ? (
                                <>
                                    {/* External: Action picker */}
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Action</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            <button onClick={() => setUpdateTaskForm(p => ({ ...p, external_action: 'complete' }))}
                                                className={`py-2.5 px-2 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center gap-1 ${updateTaskForm.external_action === 'complete' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                                <CheckCircle2 className="h-4 w-4" /> Complete
                                            </button>
                                            <button onClick={() => setUpdateTaskForm(p => ({ ...p, external_action: 'shift' }))}
                                                className={`py-2.5 px-2 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center gap-1 ${updateTaskForm.external_action === 'shift' ? 'border-amber-600 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                                <Clock className="h-4 w-4" /> Shift Date
                                            </button>
                                            <button onClick={() => setUpdateTaskForm(p => ({ ...p, external_action: 'note' }))}
                                                className={`py-2.5 px-2 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center gap-1 ${updateTaskForm.external_action === 'note' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                                <Edit2 className="h-4 w-4" /> Save Note
                                            </button>
                                        </div>
                                    </div>

                                    {/* Shift Date input */}
                                    {updateTaskForm.external_action === 'shift' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Next Date</label>
                                            <input type="date" value={updateTaskForm.next_date}
                                                onChange={e => setUpdateTaskForm(p => ({ ...p, next_date: e.target.value }))}
                                                className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-100 outline-none" />
                                        </div>
                                    )}

                                    {/* Remark - always required */}
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Remark <span className="text-red-500">*</span></label>
                                        <textarea placeholder="What happened on this task?" value={updateTaskForm.remark}
                                            onChange={e => setUpdateTaskForm(p => ({ ...p, remark: e.target.value }))}
                                            className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} />
                                    </div>
                                </>
                            ) : (
                                <>
                                    {/* Customer: Remark + Status */}
                                    <textarea placeholder="Add a remark..." value={updateTaskForm.remark}
                                        onChange={e => setUpdateTaskForm(p => ({ ...p, remark: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} autoFocus />

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                                        <select value={updateTaskForm.status} onChange={e => setUpdateTaskForm(p => ({ ...p, status: e.target.value }))}
                                            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                                            <option value="Pending">Pending</option>
                                            <option value="In Progress">In Progress</option>
                                            <option value="Completed">Completed</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* Timeline */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <Clock className="h-4 w-4 text-gray-400" />
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Activity Timeline</span>
                                </div>
                                {taskUpdatesLoading ? (
                                    <div className="py-4 text-center text-sm text-gray-400">Loading...</div>
                                ) : taskUpdates.length === 0 ? (
                                    <div className="py-4 text-center text-sm text-gray-400">No updates yet</div>
                                ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {taskUpdates.map((u: any) => (
                                            <div key={u.id} className="border-l-2 border-purple-200 pl-3 py-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                        u.update_type === 'Remark' ? 'bg-blue-100 text-blue-700' :
                                                        u.update_type === 'StatusChange' ? 'bg-amber-100 text-amber-700' :
                                                        u.update_type === 'DateChange' ? 'bg-purple-100 text-purple-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>{u.update_type}</span>
                                                    <span className="text-[11px] text-gray-400">{formatUpdateTime(u.created_at)}</span>
                                                </div>
                                                {u.content && <p className="text-xs text-gray-700 mt-0.5">{u.content}</p>}
                                                {u.update_type === 'StatusChange' && (
                                                    <p className="text-xs text-gray-500 mt-0.5">{u.old_value} → {u.new_value}</p>
                                                )}
                                                <p className="text-[11px] text-gray-400 mt-0.5">by {u.created_by}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-5 border-t bg-gray-50 flex justify-end gap-2 rounded-b-2xl shrink-0">
                            <button onClick={() => setUpdateTaskModal(null)} className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
                            <button onClick={handleTaskUpdate} disabled={updatingTask}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
                                {updatingTask ? 'Saving...' : 'Save Update'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {checkoutModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-24 md:pb-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-xl w-full max-w-xl shadow-xl animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
                        <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-800">Check Out</h3>
                                <p className="text-xs text-gray-500 mt-0.5">{checkoutModal?.task.customer_name}</p>
                            </div>
                            <button onClick={() => setCheckoutModal(null)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                                <X className="h-4 w-4 text-gray-400" />
                            </button>
                        </div>

                        <div className="px-4 py-3 overflow-y-auto flex-1 custom-scrollbar">
                            {checkoutModal?.task.task_type === 'Connect' ? (
                                <div className="space-y-4">
                                    {/* Business Tracking flags — single inline row, no card wrapper */}
                                    <div>
                                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">Business Tracking</div>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                            {[
                                                { key: 'e_invoice' as const, label: 'E-Invoice' },
                                                { key: 'e_way_bill' as const, label: 'E-Way Bill' },
                                                { key: 'connected_banking' as const, label: 'Connected Banking' },
                                                { key: 'whatsapp_enabled' as const, label: 'WhatsApp Enabled' },
                                                { key: 'tally_slow' as const, label: 'Tally Slow' },
                                            ].map(f => (
                                                <label key={f.key} className="flex items-center gap-2 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.[f.key] === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, [f.key]: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-blue-300"
                                                    />
                                                    <span className="text-xs text-gray-700">{f.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Dropdowns — 2 per row, compact */}
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Business Type <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.business_type || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, business_type: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Distribution">Distribution</option>
                                                <option value="Retail">Retail</option>
                                                <option value="Wholesale">Wholesale</option>
                                                <option value="Manufacturing">Manufacturing</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Accounts Person <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.accounts_person_type || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, accounts_person_type: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Owner">Owner</option>
                                                <option value="Accountant">Accountant</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Customisation <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.customisation || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, customisation: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Light">Light</option>
                                                <option value="Heavy">Heavy</option>
                                                <option value="None">None</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Customer Response <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.check_out_response || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, check_out_response: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Happy">Happy</option>
                                                <option value="Not interested">Not interested</option>
                                                <option value="Business Close">Business Close</option>
                                                <option value="Align Other partner">Align Other partner</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">CA Person <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.ca_name || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, ca_name: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Available">Available</option>
                                                <option value="Not Available">Not Available</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">IT Person <span className="text-red-500">*</span></label>
                                            <select
                                                value={checkoutModal?.it_person || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, it_person: e.target.value } : null)}
                                                className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                            >
                                                <option value="">Select…</option>
                                                <option value="Available">Available</option>
                                                <option value="Not Available">Not Available</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Text Fields */}
                                    <div className="space-y-2.5">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Business Description <span className="text-red-500">*</span></label>
                                            <textarea
                                                value={checkoutModal?.business_description || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, business_description: e.target.value } : null)}
                                                placeholder="e.g. Garment manufacturing, retail shop…"
                                                rows={2}
                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Customer Behaviour <span className="text-red-500">*</span></label>
                                            <textarea
                                                value={checkoutModal?.customer_behaviour || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, customer_behaviour: e.target.value } : null)}
                                                rows={2}
                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                                placeholder="e.g. Very positive, interested in customization…"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Visit Remark <span className="text-red-500">*</span></label>
                                            <textarea
                                                value={checkoutModal?.remark || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, remark: e.target.value } : null)}
                                                rows={2}
                                                className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                                placeholder="Enter visit completion details…"
                                            />
                                        </div>
                                    </div>

                                    {/* Promote to Lead — opt-in toggle. Mirrors the Log-Call
                                        Accepted-branch UX so a successful visit can spawn a
                                        follow-up lead. Default assignee = current user. */}
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
                                                    } else {
                                                        setLeadType('');
                                                        setLeadAssignTo('');
                                                    }
                                                }}
                                                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-blue-300"
                                            />
                                            <span className="text-xs text-gray-700">Promote this visit to a Lead</span>
                                        </label>

                                        {createLead && (
                                            <div className="mt-2 space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="block text-xs text-gray-500 mb-1">Category <span className="text-red-500">*</span></label>
                                                        <select
                                                            value={leadType}
                                                            onChange={(e) => { setLeadType(e.target.value); if (!leadAssignTo) setLeadAssignTo(user?.name || ''); }}
                                                            className="w-full h-9 px-2.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none"
                                                        >
                                                            <option value="">Select…</option>
                                                            {LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-gray-500 mb-1">Assign to</label>
                                                        {(() => {
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
                                                        placeholder="What's the follow-up about? (optional — defaults to visit remark)"
                                                        className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-xs text-gray-500 mb-2">General task completion. Record any final notes below.</p>
                                    <label className="block text-xs text-gray-500 mb-1">Remark <span className="text-red-500">*</span></label>
                                    <textarea
                                        value={checkoutModal?.remark || ''}
                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, remark: e.target.value } : null)}
                                        rows={5}
                                        className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                                        placeholder="Enter completion details…"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/30 flex justify-end gap-2 flex-shrink-0">
                            <button
                                onClick={() => setCheckoutModal(null)}
                                disabled={checkOutSubmitting}
                                className="h-8 px-3 bg-white border border-gray-300 text-gray-600 rounded text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmCheckOut}
                                disabled={checkOutSubmitting}
                                className="h-8 px-4 bg-gray-900 text-white rounded text-xs font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
                            >
                                {checkOutSubmitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Confirm Check Out'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <GpsOverlay
                visible={checkInBusyId !== null || checkOutSubmitting}
                message={checkOutSubmitting ? 'Submitting check-out…' : 'Acquiring precise location…'}
            />
        </div>
    );
};

export default TaskReport;