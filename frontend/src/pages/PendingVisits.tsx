import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronLeft, RefreshCw, Edit2, Eye, X, Filter, Download, MapPin, Trash2, CheckCircle2, LogIn, LogOut, Phone, Shield, ShieldAlert } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { tdlApi, usersApi, visitsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import { useColumnPermissions } from '../hooks/useColumnPermissions';
import CustomerNameLink from '../components/CustomerNameLink';
import { getPreciseLocation } from '../utils/geolocation';
import GpsOverlay from '../components/Shared/GpsOverlay';

interface TaskData {
    id: number;
    req_id: number;
    user_name: string;
    task_type: 'Development' | 'Implementation' | 'Connect';
    allotment_date: string | null;
    deadline: string | null;
    completion_date: string | null;
    status: string;
    remark: string;
    assigned_by: string;
    requirement_name?: string;
    customer_name?: string;
    tdl_id?: string;
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

const PendingVisits: React.FC<{ segment?: string }> = ({ segment: propSegment }) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [tasks, setTasks] = useState<TaskData[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [users, setUsers] = useState<any[]>([]);
    const [checkInBusyId, setCheckInBusyId] = useState<number | null>(null);
    const [checkOutSubmitting, setCheckOutSubmitting] = useState(false);
    // Synchronous refs block rapid double-taps (setState is async).
    const checkInLockRef = useRef(false);
    const checkOutLockRef = useRef(false);
    const { showError, showSuccess } = useToast();
    const { isAdmin: isAdminFn, user, canView, canEdit, canDelete, canCreate, canCheckPermission } = useAuth();
    const isAdmin = isAdminFn();
    const { isVisible, cellStyle, onCellContextMenu } = useColumnPermissions('pending_visits');

    // Determine visit permission entity based on customer status
    const getVisitEntity = (t: TaskData) => (t.customer_status === 'Active' ? 'visits_our' : 'visits_not_our') as import('../context/AuthContext').EntityType;
    
    // Permission Helpers with Fallbacks and Assignee Auto-Rights
    const isAssignee = (t: TaskData) => user?.name && t.user_name === user.name;
    
    const canEditVisit = (t: TaskData) => canEdit(getVisitEntity(t)) || canEdit('tasks');
    const canDeleteVisit = (t: TaskData) => canDelete(getVisitEntity(t)) || canDelete('tasks');
    const canCheckinVisit = (t: TaskData) => 
        isAssignee(t) || 
        canCheckPermission(getVisitEntity(t), 'checkin') || 
        canCheckPermission('tasks', 'checkin');
        
    const canPauseVisit = (t: TaskData) => 
        isAssignee(t) || 
        canCheckPermission(getVisitEntity(t), 'pause') || 
        canCheckPermission('tasks', 'checkin'); // Reuse checkin permission for pause/resume if needed
        
    const canForceCheckinVisit = (t: TaskData) => canCheckPermission(getVisitEntity(t), 'force_checkin');

    const [searchParams] = useSearchParams();
    const segment = propSegment || searchParams.get('segment') || 'our';



    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce Active Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // View Modal
    const [viewTask, setViewTask] = useState<TaskData | null>(null);
    // Edit Modal
    const [editTask, setEditTask] = useState<TaskData | null>(null);
    const [editForm, setEditForm] = useState({ user_name: '', deadline: '', status: '', remark: '' });

    // Modals state
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
    const [callConfirmation, setCallConfirmation] = useState<{ name: string; phone: string } | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Pending Visits (Manager View) = Always fetch ALL
            // Backend will enforce permissions based on 'our' vs 'not_our' module rights.
            const targetUser = ''; 
            console.log('[PendingVisits] Fetching ALL pending visits for segment:', segment);

            const [_tdlResult, usersResult, visitsResult] = await Promise.allSettled([
                tdlApi.getConnectPending(targetUser), // Fetch TDL Connect Tasks
                // getBasic is unguarded — needed so non-admins (who don't have
                // users.view) can still see the assignee dropdown. getAll requires
                // users.view and would leave the dropdown empty.
                usersApi.getBasic(),
                visitsApi.getPending(targetUser),
            ]);
            const tdlRes = _tdlResult.status === 'fulfilled' ? _tdlResult.value : [];
            const usersRes = usersResult.status === 'fulfilled' ? usersResult.value : [];
            const visitsRes = visitsResult.status === 'fulfilled' ? visitsResult.value : [];
            setUsers(Array.isArray(usersRes) ? usersRes : usersRes?.data || []);

            const allTasks: TaskData[] = [];
            
            // 1. TDL Tasks (Only Pending/In Progress)
            if (Array.isArray(tdlRes)) {
                tdlRes.filter((t: any) => t.status !== 'Completed' && t.status !== 'Done' && t.task_type === 'Connect').forEach((v: any) => {
                    allTasks.push({
                        ...v,
                        customer_status: v.customer_status || 'Active'
                    });
                });
            }
            const rawVisits = visitsRes;

            // 2. Visit Tasks
            if (Array.isArray(rawVisits)) {
                rawVisits.forEach((v: any) => {
                    const visitTask: TaskData = {
                        id: v.id,
                        req_id: 0, 
                        user_name: v.user_name,
                        task_type: 'Connect',
                        allotment_date: v.scheduled_date,
                        deadline: v.scheduled_date, 
                        completion_date: v.status === 'Completed' ? v.scheduled_date : null,
                        status: v.status,
                        remark: v.visit_type + ' Activity',
                        assigned_by: v.assigned_by,
                        requirement_name: v.visit_type + ' @ ' + (v.city || 'Location'),
                        customer_name: v.customer_name || 'Unknown',
                        phone_no: v.phone_no,
                        check_in_date: v.check_in_time ? v.check_in_time.split('T')[0] : null,
                        check_in_time: v.check_in_time,
                        check_in_lat: v.check_in_lat,
                        check_in_lng: v.check_in_lng,
                        check_out_time: v.check_out_time,
                        customer_status: v.customer_status || 'Active',
                        force_checkin_allowed: v.force_checkin_allowed
                    };
                    allTasks.push(visitTask);
                });
            }

            setTasks(allTasks);
            navigator.geolocation.getCurrentPosition(() => { }, () => { });

        } catch (err: any) {
            showError('Error', err.message || 'Failed to load tasks');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // Simplified filtering: Just search
    // Filtering Logic
    const filtered = tasks.filter(t => {
        // 1. Segment Filter
        const isOur = t.customer_status === 'Active';
        if (segment === 'our' && !isOur) return false;
        if (segment === 'not_our' && isOur) return false;

        // 2. Search Filter
        if (!debouncedSearch) return true;
        const searchLower = debouncedSearch.toLowerCase();
        return (
            t.user_name?.toLowerCase().includes(searchLower) ||
            t.requirement_name?.toLowerCase().includes(searchLower) ||
            t.customer_name?.toLowerCase().includes(searchLower) ||
            t.remark?.toLowerCase().includes(searchLower)
        );
    });

    const formatDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('en-GB') : '-';
    const formatTime = (t: string | null | undefined) => {
        if (!t) return '-';
        // Handle ISO strings or HH:mm:ss
        try {
            const date = t.includes('T') ? new Date(t) : new Date(`2000-01-01T${t}`);
            return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
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
            
            // Business Tracking - Dropdowns
            if (!checkoutModal.business_type) missingFields.push('Business Type');
            if (!checkoutModal.accounts_person_type) missingFields.push('Accounts Person');
            if (!checkoutModal.customisation) missingFields.push('Customisation');
            if (!checkoutModal.check_out_response) missingFields.push('Customer Response');
            if (!checkoutModal.ca_name) missingFields.push('CA Person');
            if (!checkoutModal.it_person) missingFields.push('IT Person');
            
            // Text fields
            if (!checkoutModal.business_description?.trim()) missingFields.push('Business Description');
            if (!checkoutModal.customer_behaviour?.trim()) missingFields.push('Customer Behaviour Details');
            if (!checkoutModal.remark?.trim()) missingFields.push('Visit Remark');
            
            if (missingFields.length > 0) {
                showError('Required Fields', `Please fill: ${missingFields.join(', ')}`);
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

    const handleDelete = async (task: TaskData) => {
        const label = task.customer_name || `visit task #${task.id}`;
        if (!window.confirm(`Delete "${label}"? This visit task will be removed from the queue.`)) return;
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
        <div className="p-0 space-y-0.5 md:space-y-1">
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
            {/* Header / Top Bar */}
            <div className="bg-gray-100 border-b border-gray-300 sticky top-0 z-10 shadow-sm">
                <div className="w-full px-4 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors">
                            <ChevronLeft size={18} />
                        </button>
                        <h1 className="text-[13px] font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                            {segment === 'our' ? 'OC Pending Dataset' : 'NOC Pending Dataset'}
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative w-48 lg:w-64">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                            <input
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Grid Search..."
                                className="w-full pl-8 pr-3 py-1 bg-white border border-gray-300 rounded text-[11px] focus:ring-1 focus:ring-blue-500 outline-none shadow-inner"
                            />
                        </div>
                        <button onClick={fetchData} className="p-1.5 bg-white border border-gray-300 rounded text-gray-600 hover:bg-gray-50 shadow-sm transition-all active:scale-95">
                            <RefreshCw size={14} className={loading ? 'animate-spin text-blue-600' : ''} />
                        </button>
                    </div>
                </div>
            </div>
        {/* Content */}
        <>
            {/* Mobile View (Cards) */}
            <div className="block md:hidden space-y-3 mb-20">
                {loading ? (
                    <div className="text-center py-12 text-gray-400">
                        <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Refreshing...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 bg-white border-y border-gray-100">
                        <Filter className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p className="text-[10px] font-bold uppercase tracking-wider">No tasks found</p>
                    </div>
                ) : (
                    filtered.map(t => (
                        <div key={t.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            {/* Row 1: Name | Actions */}
                            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                                <h4 className="text-base font-bold text-gray-900 truncate flex-1"><CustomerNameLink customerId={(t as any).customer_id} name={t.customer_name} fallback="Generic Task" /></h4>
                                <div className="flex items-center gap-1.5 ml-2">
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.customer_name || '')}`, '_blank')}
                                        className="h-7 w-7 bg-gray-50 border border-gray-100 rounded-md flex items-center justify-center text-gray-600 active:scale-95"
                                        title="View on Google Maps"
                                    >
                                        <MapPin className="h-3.5 w-3.5" />
                                    </button>

                                    {/* Connect Navigation Button */}
                                    {/* Pause / Resume Controls for Connect Tasks (Only before Check-In) */}
                                    {canPauseVisit(t) && t.task_type === 'Connect' && !t.check_in_date && t.status !== 'Completed' && (
                                        <>
                                            {t.status === 'In Progress' ? (
                                                <button
                                                    onClick={() => handleTaskStatusUpdate(t, 'Pending')}
                                                    className="h-7 px-2 bg-yellow-50 border border-yellow-100 rounded-md flex items-center justify-center text-yellow-600 active:scale-95"
                                                    title="Pause Task"
                                                >
                                                    <span className="text-[9px] font-bold uppercase">Pause</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleTaskStatusUpdate(t, 'In Progress')}
                                                    className="h-7 px-2 bg-blue-50 border border-blue-100 rounded-md flex items-center justify-center text-blue-600 active:scale-95"
                                                    title="Resume Task"
                                                >
                                                    <span className="text-[9px] font-bold uppercase">Resume</span>
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {t.status === 'Completed' ? (
                                        <div className="h-7 px-3 bg-green-50 text-green-600 border border-green-100 rounded-md flex items-center justify-center text-[10px] font-bold">
                                            Done
                                        </div>
                                    ) : canCheckinVisit(t) && (!t.check_in_date && t.status === 'In Progress') ? (
                                        <button
                                            onClick={() => handleCheckIn(t)}
                                            disabled={checkInBusyId === t.id}
                                            className="h-7 px-3 bg-blue-600 rounded-md flex items-center justify-center text-white text-[10px] font-bold shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {checkInBusyId === t.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'In'}
                                        </button>
                                    ) : canCheckinVisit(t) && t.status === 'In Progress' ? (
                                        <button
                                            onClick={() => handleCheckOut(t)}
                                            className="h-7 px-3 bg-emerald-600 rounded-md flex items-center justify-center text-white text-[10px] font-bold shadow-sm active:scale-95"
                                        >
                                            Out
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            {/* Row 2: Days */}
                            <div className="flex items-center px-3 py-2 border-b border-gray-50">
                                <div className="flex-1">
                                    <span className="text-sm text-gray-500">Days : </span>
                                    <span className="text-sm font-bold text-gray-800">
                                        {t.allotment_date ? Math.floor((new Date().getTime() - new Date(t.allotment_date).getTime()) / (1000 * 3600 * 24)) : '0'}
                                    </span>
                                </div>
                            </div>

                            {/* Row 3: User | Call */}
                            <div className="flex items-center px-3 py-2 text-sm">
                                <span className="text-gray-500">User :</span>
                                <span className="font-semibold text-gray-900 ml-1 truncate">{t.user_name || '—'}</span>
                                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                                <div className="flex-shrink-0">
                                    {t.phone_no ? (
                                        <a
                                            href={`tel:${t.phone_no}`}
                                            className="text-sm font-bold text-blue-600 flex items-center gap-1 active:scale-95 no-underline"
                                            onClick={(e) => { e.stopPropagation(); }}
                                        >
                                            <Phone className="h-4 w-4" />
                                            {t.phone_no}
                                        </a>
                                    ) : (
                                        <span className="text-sm text-gray-400 flex items-center gap-1">
                                            <Phone className="h-4 w-4" /> No Number
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Table View (Desktop) */}
            <div className="hidden md:block">
                <div className="bg-white border border-gray-200 shadow-sm overflow-hidden mb-4">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse table-fixed text-[11px] md:text-sm font-inter border border-gray-300">
                            <thead>
                                <tr className="bg-gray-100 border-b border-gray-300 text-[10px] md:text-xs font-black text-gray-500 uppercase tracking-wider">
                                    {isVisible('customer') && <th className="w-[20%] px-2 py-2 text-left border-r border-gray-300">Identity</th>}
                                    {isVisible('staff') && <th className="w-[12%] px-2 py-2 text-left border-r border-gray-300">Staff</th>}
                                    {isVisible('added') && <th className="w-[10%] px-2 py-2 text-center border-r border-gray-300">Sched.</th>}
                                    {isVisible('in_time') && <th className="w-[10%] px-2 py-2 text-center border-r border-gray-300">In</th>}
                                    {isVisible('out_time') && <th className="w-[10%] px-2 py-2 text-center border-r border-gray-300">Out</th>}
                                    {isVisible('remark') && <th className="w-[25%] px-2 py-2 text-left border-r border-gray-300">Observation</th>}
                                    <th className="w-[13%] px-2 py-2 text-center border-r border-gray-300">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-300">
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="py-10 text-center text-gray-400 font-bold uppercase tracking-widest text-[9px] italic">
                                            Syncing Dataset...
                                        </td>
                                    </tr>
                                ) : filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-10 text-center text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                                            Empty Result Set
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map(t => (
                                        <tr key={t.id} className="hover:bg-gray-50 transition-colors border-b border-gray-200 text-gray-900">
                                            {isVisible('customer') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 align-top" style={cellStyle('customer')} onContextMenu={onCellContextMenu('customer')}>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-gray-900 leading-tight truncate"><CustomerNameLink customerId={(t as any).customer_id} name={t.customer_name} /></span>
                                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter truncate opacity-70">{t.requirement_name}</span>
                                                    </div>
                                                </td>
                                            )}
                                            {isVisible('staff') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 align-top" style={cellStyle('staff')} onContextMenu={onCellContextMenu('staff')}>
                                                    <span className="text-gray-600 font-black uppercase text-[9px] tracking-wider truncate block">{t.user_name || '-'}</span>
                                                </td>
                                            )}
                                            {isVisible('added') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 text-center align-top" style={cellStyle('added')} onContextMenu={onCellContextMenu('added')}>
                                                    <span className="font-bold text-gray-500 whitespace-nowrap">{formatDate(t.allotment_date)}</span>
                                                </td>
                                            )}
                                            {isVisible('in_time') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 text-center align-top" style={cellStyle('in_time')} onContextMenu={onCellContextMenu('in_time')}>
                                                    <span className="font-bold text-blue-700 whitespace-nowrap">{formatTime(t.check_in_time)}</span>
                                                </td>
                                            )}
                                            {isVisible('out_time') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 text-center align-top" style={cellStyle('out_time')} onContextMenu={onCellContextMenu('out_time')}>
                                                    <span className="font-bold text-emerald-700 whitespace-nowrap">{formatTime(t.check_out_time)}</span>
                                                </td>
                                            )}
                                            {isVisible('remark') && (
                                                <td className="px-2 py-1.5 border-r border-gray-200 align-top" style={cellStyle('remark')} onContextMenu={onCellContextMenu('remark')}>
                                                    <p className="line-clamp-2 leading-tight italic text-gray-500 text-[10px]" title={t.remark}>"{t.remark || '-'}"</p>
                                                </td>
                                            )}
                                            <td className="px-2 py-1.5 align-middle text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    {(isAdmin || canForceCheckinVisit(t)) && (
                                                         <button
                                                             onClick={() => handleToggleForceCheckin(t)}
                                                             className={`h-6 w-6 rounded border transition-colors flex items-center justify-center shadow-sm ${
                                                                 t.force_checkin_allowed
                                                                     ? 'bg-red-50 border-red-200 text-red-600'
                                                                     : 'bg-gray-50 border-gray-200 text-gray-400 opacity-50'
                                                             }`}
                                                             title={t.force_checkin_allowed ? "Shield ON" : "Shield OFF"}
                                                         >
                                                             {t.force_checkin_allowed ? <ShieldAlert size={12} /> : <Shield size={12} />}
                                                         </button>
                                                    )}
                                                    {canCheckinVisit(t) && (
                                                        !t.check_in_date ? (
                                                            <button onClick={() => handleCheckIn(t)} disabled={checkInBusyId === t.id} className="h-6 px-2 bg-blue-600 text-white rounded text-[9px] font-black uppercase tracking-widest hover:bg-blue-700 shadow-sm active:scale-95 transition-all inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed">{checkInBusyId === t.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'IN'}</button>
                                                        ) : (!t.check_out_time && t.status === 'In Progress') ? (
                                                            <button onClick={() => handleCheckOut(t)} className="h-6 px-2 bg-emerald-600 text-white rounded text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-sm active:scale-95 transition-all">OUT</button>
                                                        ) : null
                                                    )}
                                                    {canEditVisit(t) && (
                                                        <button onClick={() => openEditModal(t)} className="h-6 w-6 rounded border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-all flex items-center justify-center bg-white shadow-sm">
                                                            <Edit2 size={12} />
                                                        </button>
                                                    )}
                                                    {canDeleteVisit(t) && (
                                                        <button onClick={() => handleDelete(t)} className="h-6 w-6 rounded border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-400 transition-all flex items-center justify-center bg-white shadow-sm">
                                                            <Trash2 size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-4 py-1.5 border-t border-gray-300 bg-gray-100 text-[9px] font-black text-gray-500 uppercase tracking-widest flex items-center justify-between">
                        <span>Active Dataset: {filtered.length} Entries</span>
                        <span className="opacity-50 font-normal">Grid Density v2.0 (Optimized)</span>
                    </div>
                </div>
            </div>
        </>


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
                                        <div className="font-bold text-gray-900 px-2 py-0.5 bg-blue-50 text-blue-700 rounded w-fit">{viewTask?.status || 'Pending'}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Check-in Time</div>
                                        <div className="font-medium text-gray-900">{formatTime(viewTask?.check_in_time)}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs text-gray-500">Check-out Time</div>
                                        <div className="font-medium text-gray-900">{formatTime(viewTask?.check_out_time)}</div>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-gray-500">Requirement / Activity</div>
                                    <div className="font-medium text-gray-900 bg-gray-50 p-3 rounded-lg text-sm border border-gray-100">{viewTask?.requirement_name}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-gray-500">Remark / Notes</div>
                                    <div className="font-medium text-gray-900 bg-gray-50 p-3 rounded-lg text-sm border border-gray-100 whitespace-pre-wrap">{viewTask?.remark || 'No remark'}</div>
                                </div>
                                {viewTask?.status === 'Completed' && (
                                    <div className="space-y-3 pt-2 bg-blue-50/30 p-4 rounded-2xl border border-blue-100">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600">Completion Details</h4>
                                        <div className="grid grid-cols-2 gap-y-3 text-xs">
                                            {(viewTask as any).business_type && (
                                                <>
                                                    <div>
                                                        <span className="block text-gray-400 font-bold uppercase text-[9px]">Business Type</span>
                                                        <span className="font-bold text-gray-700">{(viewTask as any).business_type}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-gray-400 font-bold uppercase text-[9px]">Response</span>
                                                        <span className="font-bold text-gray-700">{(viewTask as any).check_out_response}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
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
            {checkoutModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-24 md:pb-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b flex justify-between items-center flex-shrink-0">
                            <div>
                                <h3 className="text-xl font-black text-gray-900 uppercase tracking-tighter">Check Out</h3>
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">
                                    {checkoutModal?.task.customer_name}
                                </p>
                            </div>
                            <button onClick={() => setCheckoutModal(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <X className="h-6 w-6 text-gray-400" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="space-y-6">
                                {checkoutModal?.task.task_type === 'Connect' ? (
                                    <>
                                        <div>
                                            <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                                <div className="h-1.5 w-1.5 rounded-full bg-blue-600"></div>
                                                Business Tracking
                                            </h4>
                                            
                                            {/* Yes/No Checkboxes Section - 2 per row */}
                                            <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-gray-50 rounded-xl">
                                                <label className="flex items-center gap-3 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.e_invoice === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, e_invoice: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">E-Invoice</span>
                                                </label>
                                                <label className="flex items-center gap-3 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.e_way_bill === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, e_way_bill: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">E-Way Bill</span>
                                                </label>
                                                <label className="flex items-center gap-3 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.connected_banking === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, connected_banking: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">Connected Banking</span>
                                                </label>
                                                <label className="flex items-center gap-3 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.whatsapp_enabled === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, whatsapp_enabled: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">WhatsApp Enabled</span>
                                                </label>
                                                <label className="flex items-center gap-3 cursor-pointer group col-span-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={checkoutModal?.tally_slow === 'Yes'}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, tally_slow: e.target.checked ? 'Yes' : 'No' } : null)}
                                                        className="w-5 h-5 rounded border-2 border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">Tally Slow</span>
                                                </label>
                                            </div>

                                            {/* Dropdown Fields - 2 per row */}
                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Business Type <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.business_type || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, business_type: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Distribution">Distribution</option>
                                                        <option value="Retail">Retail</option>
                                                        <option value="Wholesale">Wholesale</option>
                                                        <option value="Manufacturing">Manufacturing</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Accounts Person <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.accounts_person_type || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, accounts_person_type: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Owner">Owner</option>
                                                        <option value="Accountant">Accountant</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Customisation <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.customisation || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, customisation: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Light">Light</option>
                                                        <option value="Heavy">Heavy</option>
                                                        <option value="None">None</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Customer Response <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.check_out_response || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, check_out_response: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Happy">Happy</option>
                                                        <option value="Not interested">Not interested</option>
                                                        <option value="Business Close">Business Close</option>
                                                        <option value="Align Other partner">Align Other partner</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">CA Person <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.ca_name || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, ca_name: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Available">Available</option>
                                                        <option value="Not Available">Not Available</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">IT Person <span className="text-red-500">*</span></label>
                                                    <select
                                                        value={checkoutModal?.it_person || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, it_person: e.target.value } : null)}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none"
                                                        required
                                                    >
                                                        <option value="">Select</option>
                                                        <option value="Available">Available</option>
                                                        <option value="Not Available">Not Available</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Text Fields */}
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Business Description <span className="text-red-500">*</span></label>
                                                    <textarea
                                                        value={checkoutModal?.business_description || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, business_description: e.target.value } : null)}
                                                        placeholder="e.g. Garment manufacturing, retail shop..."
                                                        rows={2}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none resize-none"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Customer Behaviour Details <span className="text-red-500">*</span></label>
                                                    <textarea
                                                        value={checkoutModal?.customer_behaviour || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, customer_behaviour: e.target.value } : null)}
                                                        rows={2}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none resize-none"
                                                        placeholder="e.g. Very positive, interested in customization..."
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Visit Remark <span className="text-red-500">*</span></label>
                                                    <textarea
                                                        value={checkoutModal?.remark || ''}
                                                        onChange={e => setCheckoutModal(prev => prev ? { ...prev, remark: e.target.value } : null)}
                                                        rows={2}
                                                        className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs transition-all outline-none resize-none"
                                                        placeholder="Enter visit completion details..."
                                                        required
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="py-2">
                                        <p className="text-sm text-gray-600 mb-4 font-medium italic">General task completion. Record any final notes below.</p>
                                        <div>
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Remark <span className="text-red-500">*</span></label>
                                            <textarea
                                                value={checkoutModal?.remark || ''}
                                                onChange={e => setCheckoutModal(prev => prev ? { ...prev, remark: e.target.value } : null)}
                                                rows={4}
                                                className="w-full mt-1 p-3 bg-gray-50 border-2 border-transparent focus:border-green-600 rounded-xl font-bold text-xs transition-all outline-none resize-none"
                                                placeholder="Enter completion details..."
                                                required
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 rounded-b-[2.5rem] flex-shrink-0">
                            <button
                                onClick={() => setCheckoutModal(null)}
                                disabled={checkOutSubmitting}
                                className="px-6 py-3 bg-white border-2 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmCheckOut}
                                disabled={checkOutSubmitting}
                                className="px-8 py-3 bg-green-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-green-700 shadow-xl shadow-green-600/20 active:scale-95 transition-all inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {checkOutSubmitting ? (<><RefreshCw className="w-4 h-4 animate-spin" />Submitting...</>) : 'Confirm Check Out'}
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

export default PendingVisits;