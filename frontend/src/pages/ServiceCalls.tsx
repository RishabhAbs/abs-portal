import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Plus, RefreshCw, PhoneCall, CheckCircle, X, Trash2, ArrowRightLeft, Calendar, Filter, Download, Building2, AlertCircle, FileSpreadsheet, ArrowUpDown, Star, ChevronDown, Clock, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import { serviceCallsApi, customersApi, usersApi, tallyApi, adminsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import SwipeableCard from '../components/Shared/SwipeableCard';
import { useSwipeTabs } from '../hooks/useSwipeTabs';
import CustomerNameLink from '../components/CustomerNameLink';

type StatusFilter = 'all' | 'Open' | 'In Progress' | 'pending' | 'my_completed' | 'Closed' | 'Cancelled' | 'my_cancelled';
const SERVICE_TYPES = ['Cloud', 'Tally', 'TDL', 'Web/App'] as const;

interface ServiceCallsProps {
  segment: 'pending' | 'completed' | 'canceled';
}

const ServiceCalls: React.FC<ServiceCallsProps> = ({ segment }) => {
  const { user, isAdmin, canCreate, canCheckPermission } = useAuth();
  const location = useLocation();
  const incomingSearch = (location.state as any)?.customerSearch || '';

  // Clear location state after consuming to prevent stale filters on back-navigation
  useEffect(() => {
    if (incomingSearch) window.history.replaceState({}, document.title);
  }, []);

  const canAdd      = canCreate('service_calls');
  const canTake     = canCheckPermission('service_calls', 'take');
  const canClose    = canCheckPermission('service_calls', 'close');
  const canCancel   = canCheckPermission('service_calls', 'cancel');
  const canTransfer = canCheckPermission('service_calls', 'transfer');
  const canViewAll  = isAdmin() || canCheckPermission('service_calls', 'view_all');
  // view_updates gates the notes/remarks history feed. Fall through to
  // view_all and admin so the existing power users keep their access.
  const canViewUpdates = isAdmin() || canCheckPermission('service_calls', 'view_updates') || canViewAll;

  // ── Data State ───────────────────────────────────────────────────────────────
  const [serviceCalls, setServiceCalls]   = useState<any[]>([]);
  const [customers,    setCustomers]      = useState<any[]>([]);
  const [cloudUsers,   setCloudUsers]     = useState<any[]>([]);
  const [flavors,      setFlavors]        = useState<{ id: number; name: string }[]>([]);
  const [loading,      setLoading]        = useState(true);
  const [error,        setError]          = useState<string | null>(null);
  const [stats,        setStats]          = useState({ total: 0, open: 0, pending: 0, closed: 0, cancelled: 0, my_pending: 0, my_completed: 0, my_cancelled: 0 });
  
  const [serialStatus, setSerialStatus] = useState<'idle' | 'searching' | 'found' | 'not-found'>('idle');
  const [showAddCustomerInline, setShowAddCustomerInline] = useState(false);
  
  const [resellers, setResellers] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [createCustomerForm, setCreateCustomerForm] = useState({
    company: '', group: '', reseller: '', status: 'Active', btype: '166',
    email: '', gstin: '', person: '', mobile: '',
    address1: '', address2: '', address3: '',
    pincode: '', area: '', state: '', remarks: ''
  });
  const [resellerSearch, setResellerSearch] = useState('');
  const [showResellerDrop, setShowResellerDrop] = useState(false);

  // ── Filters ──────────────────────────────────────────────────────────────────
  // Non-admin users default to 'Open' (unallotted) so they see work available to pick up
  const defaultStatus: StatusFilter = segment === 'pending' ? 'Open'
    : segment === 'completed' ? (canViewAll ? 'Closed' : 'my_completed')
    : (canViewAll ? 'Cancelled' : 'my_cancelled');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(incomingSearch ? 'all' : defaultStatus);

  // Reset filter when segment changes
  useEffect(() => {
    if (!incomingSearch) {
      const newDefault: StatusFilter = segment === 'pending' ? 'Open'
        : segment === 'completed' ? (canViewAll ? 'Closed' : 'my_completed')
        : (canViewAll ? 'Cancelled' : 'my_cancelled');
      setStatusFilter(newDefault);
    }
  }, [segment]);
  const [searchQuery,  setSearchQuery]  = useState(incomingSearch);
  const [activeSearch, setActiveSearch] = useState(incomingSearch);
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [staffFilter,  setStaffFilter]  = useState(() => canViewAll ? '' : (user?.name || ''));
  const [typeFilter,   setTypeFilter]   = useState('');
  const [showFilter,   setShowFilter]   = useState(false);

  // ── Page Tabs ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'board' | 'analytics'>('board');
  const [expandedCalls, setExpandedCalls] = useState<number[]>([]);

  // ── Analytics ────────────────────────────────────────────────────────────────
  const [userWiseData,       setUserWiseData]       = useState<any[]>([]);
  const [delayData,          setDelayData]           = useState<any[]>([]);
  const [analyticsTab,       setAnalyticsTab]        = useState<'users' | 'delays'>('users');
  const [analyticsLoading,   setAnalyticsLoading]   = useState(false);

  // ── Sorting ──────────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 inline-block ml-1 opacity-20 group-hover:opacity-50 transition-opacity" />;
    return sortDir === 'asc' 
      ? <ArrowUpDown className="h-3 w-3 inline-block ml-1 text-blue-500" />
      : <ArrowUpDown className="h-3 w-3 inline-block ml-1 text-blue-500 rotate-180" />;
  };

  const displayServiceCalls = React.useMemo(() => {
    let list = [...serviceCalls];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => 
        (c.customer_name || '').toLowerCase().includes(q) ||
        (c.mobile_no || '').toLowerCase().includes(q) ||
        (c.serial_number || '').toLowerCase().includes(q) ||
        (c.service_type || '').toLowerCase().includes(q) ||
        (c.flavor_name || '').toLowerCase().includes(q) ||
        (c.taken_by || '').toLowerCase().includes(q)
      );
    }

    if (typeFilter) list = list.filter(c => c.service_type === typeFilter);

    list.sort((a, b) => {
      let valA: any = ''; let valB: any = '';
      switch (sortField) {
        case 'created_at':
          valA = new Date(a.created_at).getTime(); valB = new Date(b.created_at).getTime(); break;
        case 'customer_name':
          valA = (a.customer_name || '').toLowerCase(); valB = (b.customer_name || '').toLowerCase(); break;
        case 'service_type':
          valA = (a.service_type || '').toLowerCase(); valB = (b.service_type || '').toLowerCase(); break;
        case 'flavor_name':
          valA = (a.flavor_name || '').toLowerCase(); valB = (b.flavor_name || '').toLowerCase(); break;
        case 'taken_by':
          valA = (a.taken_by || '').toLowerCase(); valB = (b.taken_by || '').toLowerCase(); break;
        case 'status':
          valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
        default:
          valA = a[sortField]; valB = b[sortField];
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [serviceCalls, sortField, sortDir, typeFilter]);

  // ── Pagination ──
  const ITEMS_PER_PAGE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(displayServiceCalls.length / ITEMS_PER_PAGE);
  const paginatedCalls = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return displayServiceCalls.slice(start, start + ITEMS_PER_PAGE);
  }, [displayServiceCalls, currentPage]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [statusFilter, activeSearch, startDate, endDate, staffFilter]);

  // ── Add Modal ────────────────────────────────────────────────────────────────
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [addLoading,    setAddLoading]    = useState(false);
  const [addForm, setAddForm] = useState({
    mobile_no: '', contact_person: '', service_type: '', remark: '',
    customer_id: null as string | number | null, customer_search: '',
    serial_number: '', expire_date: '', flavor: '', assign_to: '',
    entry_type: 'Service' as const,
  });
  const [addCustomerDropdown, setAddCustomerDropdown] = useState(false);
  const [assignChecked,        setAssignChecked]       = useState(false);
  const [isNameAutoFilled,     setIsNameAutoFilled]    = useState(false);

  // ── Close Modal ───────────────────────────────────────────────────────────────
  const [showCloseModal,  setShowCloseModal]  = useState(false);
  const [closeTarget,     setCloseTarget]     = useState<any>(null);
  // When true, the close/transfer modal renders read-only — opened via the
  // "View Updates" button by users with view_updates perm but without
  // close/transfer rights on this specific call. Only the updates timeline
  // (and Add Update if they have that perm) stays interactive.
  const [readOnlyView,    setReadOnlyView]    = useState(false);
  const [closeLoading,    setCloseLoading]    = useState(false);
  const [showTransferMode, setShowTransferMode] = useState(false);
  const [transferToUser,   setTransferToUser]  = useState('');
  const [transferLoading,  setTransferLoading] = useState(false);
  const [closeForm, setCloseForm] = useState({
    customer_id: null as string | number | null, customer_search: '',
    contact_person: '', serial_number: '', service_type: '',
    remark: '', flavor: '', expire_date: '',
  });
  const [closeCustomerDropdown, setCloseCustomerDropdown] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [contactLocked, setContactLocked] = useState(false);

  const [takeLoadingId, setTakeLoadingId] = useState<number | null>(null);

  // Update / history state — posts progress notes without closing the call
  const [updateText, setUpdateText] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [saveDetailsLoading, setSaveDetailsLoading] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);

  // Follow-up state removed — now navigates to separate page

  // ─── Data Fetching ────────────────────────────────────────────────────────────
  const fetchServiceCalls = async () => {
    setLoading(true); setError(null);
    try {
      const res = await serviceCallsApi.getAll(statusFilter, activeSearch, startDate, endDate, staffFilter, 'Service');
      setServiceCalls(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load service calls');
      setServiceCalls([]);
    } finally {
      setLoading(false);
    }
    // Fetch stats separately — failure here should not crash the table
    try {
      const statsRes = await serviceCallsApi.getStats(startDate, endDate, staffFilter, 'Service');
      setStats(statsRes.data || { total: 0, open: 0, pending: 0, closed: 0, cancelled: 0, my_pending: 0, my_completed: 0, my_cancelled: 0 });
    } catch { /* stats failure is non-critical */ }
  };

  const fetchAdmins = async () => {
    try {
      const res = await adminsApi.getAll();
      setAdmins(res || []);
    } catch { /* ignore non-critical failure */ }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const s = startDate || new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];
      const e = endDate   || new Date().toISOString().split('T')[0];
      const [ur, dr] = await Promise.all([
        serviceCallsApi.getReportsUserWise(s, e),
        serviceCallsApi.getReportsDelays(s, e),
      ]);
      setUserWiseData(ur.data || []);
      setDelayData(dr.data || []);
    } catch { /* ignore */ }
    finally { setAnalyticsLoading(false); }
  };

  useEffect(() => { if (activeTab === 'board') fetchServiceCalls();
    fetchAdmins();
  }, [statusFilter, activeSearch, startDate, endDate, staffFilter, activeTab]);
  useEffect(() => { if (activeTab === 'analytics') fetchAnalytics();    }, [activeTab, startDate, endDate]);

  useEffect(() => {
    const load = async () => {
      // Each API call is independent — a 403 on customers should not stop users/flavors from loading
      const [custResult, usersResult, flavorsResult, resellerResult] = await Promise.allSettled([
        customersApi.getDropdown(),
        usersApi.getBasic(),
        serviceCallsApi.getFlavors(),
        customersApi.getResellers(),
      ]);
      
      if (custResult.status === 'fulfilled')    setCustomers(custResult.value.data || []);
      if (usersResult.status === 'fulfilled')   setCloudUsers(usersResult.value.data || []);
      if (flavorsResult.status === 'fulfilled') setFlavors(flavorsResult.value.data || []);
      if (resellerResult.status === 'fulfilled') setResellers(resellerResult.value.data || []);
    };
    load();
  }, [statusFilter]);

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const filteredAddCustomers = customers.filter(c =>
    addForm.customer_search.length >= 3 &&
    (c.company?.toLowerCase().includes(addForm.customer_search.toLowerCase()) || String(c.id).includes(addForm.customer_search))
  );
  const filteredCloseCustomers = customers.filter(c =>
    closeForm.customer_search.length >= 3 &&
    (c.company?.toLowerCase().includes(closeForm.customer_search.toLowerCase()) || String(c.id).includes(closeForm.customer_search))
  );

  const getTimeAgo = (d: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24);
    if (days > 0) return `${days}d`;
    if (h > 0)    return `${h}h`;
    if (m > 0)    return `${m}m`;
    return 'now';
  };

  const statusColor = (s: string) => {
    if (s === 'Open')        return 'bg-blue-50 text-blue-700 border-blue-200';
    if (s === 'In Progress') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (s === 'Closed')      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'Confirmed')   return 'bg-teal-50 text-teal-700 border-teal-200';
    return 'bg-purple-50 text-purple-700 border-purple-200';
  };

  const exportToExcel = () => {
    const rows = serviceCalls.map((sc, i) => ({
      'Sr': i+1, 'Mobile': sc.mobile_no, 'Customer': sc.customer_name || 'Walk-in',
      'Contact': sc.contact_person || '-', 'S/N': sc.serial_number || '-',
      'Type': sc.service_type || '-', 'Flavor': sc.flavor_name || '-',
      'Status': sc.status, 'Handled By': sc.taken_by || '-',
      'Created': new Date(sc.created_at).toLocaleString(),
      'Closed': sc.closed_at ? new Date(sc.closed_at).toLocaleString() : '-',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Service Calls');
    XLSX.writeFile(wb, `ServiceCalls_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (addLoading || !addForm.mobile_no.trim()) return;
    setAddLoading(true);
    try {
      await serviceCallsApi.create({
        mobile_no:      addForm.mobile_no,
        contact_person: addForm.contact_person || undefined,
        service_type:   addForm.service_type   || undefined,
        remark:         addForm.remark         || undefined,
        customer_id:    addForm.customer_id    || undefined,
        serial_number:  addForm.serial_number  || undefined,
        expire_date:    addForm.expire_date    || undefined,
        flavor:         addForm.flavor         || undefined,
        assign_to:      assignChecked && addForm.assign_to ? addForm.assign_to : undefined,
        entry_type:     'Service',
      });
      setShowAddModal(false);
      setAddForm({ mobile_no:'', contact_person:'', service_type:'', remark:'', customer_id:null, customer_search:'', serial_number:'', expire_date:'', flavor:'', assign_to:'', entry_type:'Service' });
      await fetchServiceCalls();
      setAssignChecked(false);
      setIsNameAutoFilled(false);
    } catch (e: any) {
      alert(e.message || 'Failed to create');
    } finally {
      setAddLoading(false);
    }
  };

  const refreshCurrentTab = async () => {
    await fetchServiceCalls();
  };

  const handleTake = async (id: number) => {
    if (takeLoadingId !== null) return;
    console.log('[Take] Initiating for ID:', id);
    setTakeLoadingId(id);
    try {
      const res = await serviceCallsApi.take(id);
      console.log('[Take] Success:', res);
      await refreshCurrentTab();
    } catch (e: any) {
      console.error('[Take] Failed:', e);
      if (e.message?.toLowerCase().includes('not in open status')) {
        await refreshCurrentTab();
      }
      alert(e.message || 'Failed'); 
    }
    finally { setTakeLoadingId(null); }
  };

  const openCloseModal = async (sc: any, viewOnly = false) => {
    setCloseTarget(sc);
    setReadOnlyView(viewOnly);
    setContactLocked(false);
    setShowTransferMode(false);
    setTransferToUser('');
    const cust = customers.find(c => c.id === sc.customer_id);
    setCloseForm({
      customer_id: sc.customer_id || null,
      customer_search: cust?.company || '',
      contact_person: sc.contact_person || '',
      serial_number: sc.serial_number || '',
      service_type: sc.service_type || '',
      remark: sc.remark || '',
      flavor: sc.flavor || '',
      expire_date: sc.expire_date?.split('T')[0] || '',
    });
    setSerialStatus(sc.serial_number ? 'found' : 'idle');
    setShowCustomerSearch(false);
    setShowAddCustomerInline(false);
    setShowCloseModal(true);
    setUpdateText('');
    loadNotes(sc.id);
    try {
      const res = await serviceCallsApi.lookupContact(sc.mobile_no);
      if (res.found && res.contact?.contact_person) {
        setCloseForm(prev => ({ ...prev, contact_person: res.contact!.contact_person }));
        setContactLocked(true);
      }
    } catch { /* ignore */ }
  };

  const handleSerialLookup = async (serial: string) => {
    if (serial.length !== 9) {
      setSerialStatus('idle');
      return;
    }
    setSerialStatus('searching');
    try {
      const res = await serviceCallsApi.lookupTallySerial(serial);
      if (res.success && res.data) {
        setCloseForm((prev: any) => ({
          ...prev,
          customer_id: res.data.customer_id || prev.customer_id,
          customer_search: res.data.customer_name || prev.customer_search,
          flavor: res.data.flavor ? String(res.data.flavor) : prev.flavor,
          expire_date: res.data.expire_date?.split('T')[0] || prev.expire_date,
        }));
        // Serial exists but no customer mapped yet → let user map it
        setSerialStatus(res.data.customer_id ? 'found' : 'not-found');
        if (res.data.customer_id) {
          setShowAddCustomerInline(false);
          setShowCustomerSearch(false);
        }
      } else {
        setSerialStatus('not-found');
      }
    } catch { 
      setSerialStatus('not-found');
    }
  };

  const handleClose = async () => {
    if (closeLoading || !closeTarget) return;

    // 1. If we are creating a new customer inline, do that first!
    let finalCustomerId = closeForm.customer_id;
    
    if (showAddCustomerInline) {
      // Validate customer fields
      const required = [
        { key: 'company', label: 'Company Name' },
        { key: 'group',   label: 'User Group' },
        { key: 'status',  label: 'Customer Status' },
        { key: 'btype',   label: 'Business Type' },
        { key: 'email',   label: 'Email Address' },
        { key: 'person',  label: 'Contact Person' },
        { key: 'mobile',  label: 'Phone Number' },
        { key: 'address1',label: 'Address Line 1' },
        { key: 'address2',label: 'Address Line 2' },
        { key: 'pincode', label: 'Pincode' },
        { key: 'area',    label: 'City' },
        { key: 'state',   label: 'State' },
      ];

      for (const f of required) {
        const val = (createCustomerForm as any)[f.key];
        if (!val || !val.trim()) {
          alert(`${f.label} is required.`);
          return;
        }
      }

      if (createCustomerForm.pincode.length !== 6) {
        alert('Pincode must be exactly 6 digits.');
        return;
      }

      setCloseLoading(true);
      try {
        const cleanName = createCustomerForm.company.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
        const custId = `${cleanName}.abstechnologies.co.in`;

        const res = await customersApi.create({
          ...createCustomerForm,
          customerid: custId,
          group: createCustomerForm.group || (user?.id ? parseInt(String(user.id).replace('USR', '')) || 3 : 3),
          btype: createCustomerForm.btype ? Number(createCustomerForm.btype) : 166
        });

        if (res.success && res.data) {
          finalCustomerId = res.data.id;
        } else {
          alert(res.message || 'Failed to create customer');
          setCloseLoading(false);
          return;
        }
      } catch (e: any) {
        alert(e.message || 'Failed to create customer');
        setCloseLoading(false);
        return;
      }
    }

    // 2. Validate 9-digit serial number if provided
    if (closeForm.serial_number && closeForm.serial_number.length !== 9) {
      alert('Serial number must be exactly 9 digits.');
      setCloseLoading(false);
      return;
    }

    setCloseLoading(true);
    try {
      // 3. If serial was not found or just created, map it
      if ((serialStatus === 'not-found' || showAddCustomerInline) && finalCustomerId) {
        await tallyApi.upsertDetail({
          serial:       closeForm.serial_number,
          customer_id:  finalCustomerId,
          flavor:       closeForm.flavor,
          expire_date:  closeForm.expire_date,
        });
      }

      // 4. Close the service call
      await serviceCallsApi.close(closeTarget.id, {
        customer_id:     finalCustomerId          || undefined,
        contact_person:  closeForm.contact_person || undefined,
        serial_number:   closeForm.serial_number  || undefined,
        service_type:    closeForm.service_type   || undefined,
        remark:          closeForm.remark         || undefined,
        flavor:          closeForm.flavor         || undefined,
        expire_date:     closeForm.expire_date    || undefined,
      });

      setShowCloseModal(false);
      setCloseTarget(null);
      setShowAddCustomerInline(false);
      await refreshCurrentTab();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already closed')) {
        await refreshCurrentTab();
      }
      alert(e.message || 'Failed'); 
    }
    finally { setCloseLoading(false); }
  };

  // Load update history for this call. No-op for users without the
  // service_calls.view_updates permission — backend rejects them anyway,
  // but we skip the call to avoid a 403 toast on every open.
  const loadNotes = async (callId: number) => {
    if (!canViewUpdates) { setNotes([]); return; }
    setNotesLoading(true);
    try {
      const res = await serviceCallsApi.getNotes(callId);
      setNotes(Array.isArray(res?.data) ? res.data : []);
    } catch { setNotes([]); }
    finally { setNotesLoading(false); }
  };

  // Save customer/service details without closing — uses /join endpoint
  const handleSaveDetails = async () => {
    if (!closeTarget || saveDetailsLoading) return;
    setSaveDetailsLoading(true);
    try {
      await serviceCallsApi.join(closeTarget.id, {
        customer_id:    (closeForm.customer_id as any) || undefined,
        contact_person: closeForm.contact_person || undefined,
        serial_number:  closeForm.serial_number  || undefined,
        service_type:   closeForm.service_type   || undefined,
        remark:         closeForm.remark         || undefined,
        flavor:         closeForm.flavor         || undefined,
        expire_date:    closeForm.expire_date    || undefined,
      });
      await refreshCurrentTab();
      alert('Details saved.');
    } catch (e: any) {
      alert(e.message || 'Failed to save details');
    } finally { setSaveDetailsLoading(false); }
  };

  // Post a progress update (added to lead_notes, appears in the timeline)
  const handleAddUpdate = async () => {
    const text = updateText.trim();
    if (!closeTarget || !text || updateLoading) return;
    setUpdateLoading(true);
    try {
      await serviceCallsApi.addNote(closeTarget.id, { note_type: 'Update', content: text });
      setUpdateText('');
      await loadNotes(closeTarget.id);
    } catch (e: any) {
      alert(e.message || 'Failed to post update');
    } finally { setUpdateLoading(false); }
  };

  const handleTransfer = async () => {
    if (transferLoading || !transferToUser || !closeTarget) return;
    setTransferLoading(true);
    try {
      await serviceCallsApi.transfer(closeTarget.id, transferToUser);
      setShowCloseModal(false);
      setShowTransferMode(false);
      setTransferToUser('');
      await refreshCurrentTab();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already closed')) {
        await refreshCurrentTab();
      }
      alert(e.message || 'Failed'); 
    }
    finally { setTransferLoading(false); }
  };

  const handleCancel = async (id: number) => {
    if (!window.confirm('Cancel this service call?')) return;
    try {
      await serviceCallsApi.cancel(id);
      await refreshCurrentTab();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already closed')) {
        await refreshCurrentTab();
      }
      alert(e.message || 'Failed'); 
    }
  };

  // Follow-up is now on a separate page — no navigation needed here

  // ─── Status Tabs ──────────────────────────────────────────────────────────────
  // Tabs only shown for 'pending' segment: Unalloted + Pending
  // Completed and Canceled segments show their data directly (no tabs)
  const tabs: { id: StatusFilter; label: string; count: number }[] = segment === 'pending' ? [
    { id: 'Open', label: 'Unalloted', count: stats.open },
    ...(canViewAll
      ? [{ id: 'In Progress' as StatusFilter, label: 'Pending', count: stats.pending }]
      : [{ id: 'pending' as StatusFilter, label: 'Pending', count: stats.my_pending }]
    ),
  ] : [];

  const tabIds = useMemo(() => tabs.map(t => t.id), [tabs]);
  const swipeHandlers = useSwipeTabs(tabIds, statusFilter, setStatusFilter);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden font-sans">

      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">{segment === 'pending' ? 'Service Pending' : segment === 'completed' ? 'Service Completed' : 'Service Canceled'}</h1>
          {canViewAll && (
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="">All Handlers</option>
              {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="">All Types</option>
            <option value="Tally">Tally</option>
            <option value="Cloud">Cloud</option>
            <option value="TDL">TDL</option>
            <option value="Web/App">Web/App</option>
            <option value="Hardware">Hardware</option>
          </select>
          {canViewAll && (staffFilter || typeFilter) && (
            <button onClick={() => { setStaffFilter(''); setTypeFilter(''); }} className="text-xs text-red-500 hover:underline">Clear</button>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 w-auto">
          {/* Search — desktop only */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search mobile, name, S/N..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setActiveSearch(searchQuery); }}
              className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-md w-48 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:w-56 transition-all"
            />
          </div>
          <button onClick={() => setActiveSearch(searchQuery)} className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-semibold rounded-md hover:bg-blue-100 transition-colors shrink-0">
            Search
          </button>
          {activeSearch && (
            <button onClick={() => { setActiveSearch(''); setSearchQuery(''); }} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors shrink-0" title="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button onClick={() => activeTab === 'board' ? fetchServiceCalls() : fetchAnalytics()} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={exportToExcel} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button onClick={() => setShowFilter(!showFilter)} className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium transition-colors ${showFilter ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <Filter className="h-3.5 w-3.5" />
          </button>
          {segment === 'pending' && canAdd && (
            <button
              onClick={() => {
                setAddForm({
                  mobile_no:'', contact_person:'', service_type:'', remark:'',
                  customer_id:null, customer_search:'', serial_number:'', expire_date:'',
                  flavor:'', assign_to: user?.name || '',
                  entry_type: 'Service',
                });
                setAssignChecked(true);
                setIsNameAutoFilled(false);
                setShowAddModal(true);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Call
            </button>
          )}
        </div>
      </div>

      {/* ── Filter Bar (Date + Staff only) ───────────────────────────── */}
      {showFilter && (
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 shrink-0">
          {canViewAll && (
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} className="w-full sm:w-auto pl-2 pr-6 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none">
              <option value="">All Staff</option>
              {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}

          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-1 sm:flex-none py-1.5 px-2 border border-gray-200 rounded-md text-xs focus:outline-none min-w-0" />
            <span>–</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 sm:flex-none py-1.5 px-2 border border-gray-200 rounded-md text-xs focus:outline-none min-w-0" />
          </div>

          {(staffFilter || startDate || endDate) && (
            <button onClick={() => { setStaffFilter(''); setStartDate(''); setEndDate(''); }} className="text-xs text-red-500 hover:underline self-start sm:self-auto">Clear filters</button>
          )}
        </div>
      )}

      {/* ── Status Tabs (Service only) ──────────────────────────────────── */}
      {activeTab === 'board' && (
        <div className="bg-white border-b border-gray-200 px-2 sm:px-6 flex items-center gap-0 shrink-0 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setStatusFilter(t.id)}
              className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                statusFilter === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400'
              }`}
            >
              {t.label}
              <span className={`px-1.5 py-0.5 rounded-full text-sm font-semibold ${statusFilter === t.id ? 'bg-gray-200 text-gray-900' : 'bg-gray-100 text-gray-500'}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0" {...swipeHandlers}>

        {/* ── Board Tab ── */}
        {activeTab === 'board' && (
          <div className="bg-white">
            {error && (
              <div className="flex items-center gap-2 px-6 py-2 bg-red-50 text-red-600 text-xs border-b border-red-100">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </div>
            )}
            <table className="hidden md:table w-full border-collapse bg-white">
              <thead className="bg-[#f8f9fa] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                <tr>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase w-10">Sr</th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('customer_name')}>
                    Customer <SortIcon field="customer_name" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('mobile_no')}>
                    Mobile <SortIcon field="mobile_no" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('serial_number')}>
                    S/N <SortIcon field="serial_number" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('service_type')}>
                    Type <SortIcon field="service_type" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('flavor_name')}>
                    Flavor <SortIcon field="flavor_name" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('taken_by')}>
                    Handled By <SortIcon field="taken_by" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Transferred</th>
                  <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('status')}>
                    Status <SortIcon field="status" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 transition-colors group" onClick={() => toggleSort('created_at')}>
                    Age <SortIcon field="created_at" />
                  </th>
                  <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Remark</th>
                  <th className="px-2 py-1.5 border border-gray-200 text-right text-xs font-semibold text-gray-600 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={11} className="px-6 py-12 text-center text-sm text-gray-400">Loading...</td></tr>
                ) : displayServiceCalls.length === 0 ? (
                  <tr><td colSpan={11} className="px-6 py-12 text-center text-sm text-gray-400">No service calls found</td></tr>
                ) : paginatedCalls.map((call, i) => (
                  <tr key={call.id} className="hover:bg-blue-50/50 transition-colors group">
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-500 font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + i + 1}</td>
                    <td className="px-4 py-2 border border-gray-200">
                      <div className="flex items-center gap-1.5">
                        {(call as any).source === 'website' && <span className="text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full shrink-0">WEB</span>}
                        <span className="text-xs font-bold text-gray-800">
                          {call.customer_name
                            ? <CustomerNameLink customerId={(call as any).customer_id} name={call.customer_name} />
                            : (call as any).company_name
                              ? <span>{(call as any).company_name}</span>
                              : <span className="text-gray-400 italic">Walk-in</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-600 font-mono">{call.mobile_no}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-500 font-mono">{call.serial_number || <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-600">{call.service_type || <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-600 font-semibold">{call.flavor_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 font-medium">{call.taken_by || <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs">
                      {call.transferred_by ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-gray-400 text-xs">{call.transferred_by}</span>
                          <ArrowRightLeft className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                          <span className="text-amber-700 font-medium text-xs">{call.taken_by}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${statusColor(call.status)}`}>
                        {call.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-500 font-medium">{getTimeAgo(call.created_at)}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-600 max-w-[150px] truncate" title={call.remark || ''}>{call.remark || <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {call.status === 'Open' && canTake && (
                          <button onClick={() => handleTake(call.id)} title="Take" disabled={takeLoadingId === call.id}
                            className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors">
                            <PhoneCall className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {call.status === 'In Progress' && (call.taken_by === user?.name || isAdmin()) && canClose && (
                          <button onClick={() => openCloseModal(call)} title="Close"
                            className="p-1 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors">
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* View Updates — open the modal in read-only mode
                            for users who can view updates but aren't the
                            assignee on this specific call. Hidden when the
                            Close button is already shown so we don't have
                            two different ways to open the same modal. */}
                        {canViewUpdates
                          && !(call.status === 'In Progress' && (call.taken_by === user?.name || isAdmin()) && canClose)
                          && (
                          <button onClick={() => openCloseModal(call, true)} title="View updates"
                            className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canTransfer && call.status !== 'Closed' && call.status !== 'Confirmed' && call.status !== 'Cancelled' && (
                          <button onClick={() => { setCloseTarget(call); setShowTransferMode(true); setShowCloseModal(true); }} title="Transfer"
                            className="p-1 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors">
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {call.status !== 'Closed' && call.status !== 'Cancelled' && call.status !== 'Confirmed' && canCancel && (
                          <button onClick={() => handleCancel(call.id)} title="Cancel"
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Follow-up is now on a separate page — no button needed here */}
                        {call.status === 'Confirmed' && (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Confirmed</span>
                            {call.satisfaction_rating > 0 && (
                              <div className="flex items-center gap-0.5 mt-1">
                                {[...Array(5)].map((_, idx) => (
                                  <Star key={idx} className={`h-3 w-3 ${idx < call.satisfaction_rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {/* ── Mobile View (Expandable Full-Width Rows) ── */}
            <div className="md:hidden p-3 space-y-2.5 bg-gray-50/50">
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
              ) : displayServiceCalls.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">No service calls found</div>
              ) : paginatedCalls.map((call) => {
                const isExpanded = expandedCalls.includes(call.id);

                const swipeActions = [
                  ...(segment === 'pending' && call.status === 'Open' && canTake ? [{ label: 'Take', color: 'bg-blue-500', onClick: () => handleTake(call.id) }] : []),
                  ...(segment === 'pending' && call.status === 'In Progress' && (call.taken_by === user?.name || isAdmin()) && canClose ? [{ label: 'Close', color: 'bg-emerald-500', onClick: () => openCloseModal(call) }] : []),
                  ...(canViewUpdates && !(segment === 'pending' && call.status === 'In Progress' && (call.taken_by === user?.name || isAdmin()) && canClose)
                    ? [{ label: 'View', color: 'bg-slate-500', onClick: () => openCloseModal(call, true) }] : []),
                  ...(segment === 'pending' && canTransfer && call.status !== 'Closed' && call.status !== 'Confirmed' && call.status !== 'Cancelled' ? [{ label: 'Transfer', color: 'bg-amber-500', onClick: () => { setCloseTarget(call); setShowTransferMode(true); setShowCloseModal(true); } }] : []),
                  ...(segment === 'pending' && call.status !== 'Closed' && call.status !== 'Cancelled' && call.status !== 'Confirmed' && canCancel ? [{ label: 'Cancel', color: 'bg-red-500', onClick: () => handleCancel(call.id) }] : []),
                ];

                return (
                  <SwipeableCard key={call.id} actions={swipeActions}>
                    <div className="bg-white p-2 rounded-xl border-2 border-gray-300 shadow-sm relative">
                      {/* Chevron - only for extra info */}
                      {(call.serial_number || call.transferred_by || call.flavor_name || (call.status === 'Confirmed' && call.satisfaction_rating > 0)) && (
                        <button
                          className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 active:bg-gray-200 z-10"
                          onClick={(e) => { e.stopPropagation(); setExpandedCalls(prev =>
                            prev.includes(call.id) ? prev.filter(id => id !== call.id) : [...prev, call.id]
                          ); }}
                        >
                          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      )}

                      {/* Card body */}
                      <div className="cursor-pointer active:bg-gray-50 select-none">
                        {/* Row 1: Company Name | Time */}
                        <div className="flex items-center justify-between gap-2 border-b-2 border-gray-200 pb-[3px] mb-[3px]">
                          <div className="text-[22px] text-gray-900 truncate flex-1 flex items-center gap-1.5">
                            {(call as any).source === 'website' && <span className="text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full shrink-0">WEB</span>}
                            {call.customer_name
                              ? <CustomerNameLink customerId={(call as any).customer_id} name={call.customer_name} />
                              : (call as any).company_name
                                ? <span>{(call as any).company_name}</span>
                                : <span className="italic">Walk-in</span>}
                          </div>
                          <span className="text-[22px] text-gray-900 shrink-0">{getTimeAgo(call.created_at)}</span>
                        </div>

                        {/* Info Grid */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden text-[22px] text-gray-900 leading-tight">
                          <div className="flex border-b border-gray-200">
                            <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">Mobile</div>
                            <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">
                              <a href={`tel:${call.mobile_no}`} onClick={e => e.stopPropagation()}>{call.mobile_no}</a>
                            </div>
                          </div>
                          <div className="flex">
                            <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">{call.service_type || 'N/A'}</div>
                            <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">{call.remark || '—'}</div>
                          </div>
                        </div>

                        {/* Status | Handler */}
                        <div className="mt-[3px] flex items-center gap-1 text-[22px] text-gray-900">
                          <span>Status:</span>
                          <span>{call.status === 'In Progress' ? 'Pending' : call.status}</span>
                          <span className="mx-1 text-gray-300">|</span>
                          <span>Handler:</span>
                          <span className="truncate">{call.taken_by || 'Unassigned'}</span>
                        </div>
                      </div>

                      {/* Expanded: serial, transfer, rating */}
                      {isExpanded && (
                        <div className="mt-1.5 pt-1.5 border-t border-gray-100 text-[20px] text-gray-900 space-y-0.5">
                          {call.flavor_name && <div>Flavor: <span>{call.flavor_name}</span></div>}
                          {call.serial_number && <div>Serial: <span>{call.serial_number}</span></div>}
                          {call.transferred_by && <div>Transferred: <span>{call.transferred_by} → {call.taken_by}</span></div>}
                          {call.status === 'Confirmed' && call.satisfaction_rating > 0 && (
                            <div className="flex items-center gap-1">Rating:
                              {[...Array(5)].map((_, idx) => (
                                <Star key={idx} className={`h-4 w-4 ${idx < call.satisfaction_rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </SwipeableCard>
                );
              })}
            </div>

            {/* Floating Action Button (FAB) for Mobile Add Call — pending only */}
            {segment === 'pending' && canAdd && (
              <button
                onClick={() => {
                  setAddForm({
                    mobile_no: '', contact_person: '', service_type: 'Tally', remark: '',
                    customer_id: null, customer_search: '',
                    serial_number: '', expire_date: '', flavor: '', assign_to: '',
                    entry_type: 'Service',
                  });
                  setIsNameAutoFilled(false);
                  setShowAddModal(true);
                }}
                className="md:hidden fixed bottom-20 right-5 z-40 p-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"
              >
                <Plus className="h-5 w-5 stroke-[2.5]" />
              </button>
            )}

            {/* Pagination */}
            {displayServiceCalls.length > ITEMS_PER_PAGE && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalItems={displayServiceCalls.length}
                itemsPerPage={ITEMS_PER_PAGE}
                loading={loading}
                sticky={false}
              />
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {activeTab === 'analytics' && (
          <div className="p-6 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center border-b border-gray-100 px-4">
                <button onClick={() => setAnalyticsTab('users')} className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${analyticsTab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Staff Performance</button>
                <button onClick={() => setAnalyticsTab('delays')} className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${analyticsTab === 'delays' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Delay Report</button>
                <div className="flex-1" />
                <button onClick={exportToExcel} className="flex items-center gap-1.5 my-2 px-3 py-1.5 bg-white border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />Export
                </button>
              </div>

              {analyticsLoading ? (
                <div className="py-12 text-center text-sm text-gray-400">Loading analytics...</div>
              ) : analyticsTab === 'users' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse border border-gray-200">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200">Staff Member</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200 text-center">Total</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200 text-center">Closed</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {userWiseData.length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-gray-400 italic text-xs">No data for this period</td></tr>
                      ) : userWiseData.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="px-5 py-2.5 border-r border-gray-100 font-semibold text-gray-700">{r.user_name}</td>
                          <td className="px-5 py-2.5 border-r border-gray-100 text-center font-bold text-gray-900">{r.total}</td>
                          <td className="px-5 py-2.5 border-r border-gray-100 text-center text-emerald-600 font-bold">{r.closed}</td>
                          <td className="px-5 py-2.5 border-r border-gray-100">
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-gray-100 h-1.5 rounded-full"><div className="bg-emerald-500 h-full rounded-full" style={{ width: `${Math.round(r.closed/(r.total||1)*100)}%` }} /></div>
                              <span className="text-sm font-bold text-gray-500">{Math.round(r.closed/(r.total||1)*100)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse border border-gray-200">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200">Customer</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200">Staff</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 border-r border-gray-200 text-center">Response</th>
                        <th className="px-5 py-2 text-sm font-bold uppercase tracking-wide text-gray-500 text-center">Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {delayData.length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-gray-400 italic text-xs">No data for this period</td></tr>
                      ) : delayData.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="px-5 py-2.5 font-semibold text-gray-700">{r.customer_name || r.mobile_no}</td>
                          <td className="px-5 py-2.5 text-gray-600">{r.taken_by || '—'}</td>
                          <td className="px-5 py-2.5 text-center">
                            <span className={`font-bold ${r.response_delay_mins > 60 ? 'text-red-500' : 'text-gray-700'}`}>
                              {r.response_delay_mins > 60 ? `${Math.floor(r.response_delay_mins/60)}h${r.response_delay_mins%60}m` : `${r.response_delay_mins}m`}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-center font-bold text-gray-700">
                            {r.resolution_delay_mins ? `${Math.floor(r.resolution_delay_mins/60)}h${r.resolution_delay_mins%60}m` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          ADD SERVICE MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Add Service Call</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-full"><X className="h-4 w-4 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Row 1: Mobile + Service Type */}
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Mobile No. <span className="text-red-500">*</span></label>
                  <input type="tel" value={addForm.mobile_no}
                    onChange={e => {
                      const v = e.target.value;
                      setAddForm(p => ({...p, mobile_no: v}));
                    }}
                    placeholder="Enter 10-digit mobile"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Service Type</label>
                  <select value={addForm.service_type} onChange={e => setAddForm(p => ({...p, service_type: e.target.value}))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                    <option value="">Select type...</option>
                    {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>



              {/* Row 5: Remark */}
              <div>
                <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Remark</label>
                <textarea rows={2} value={addForm.remark} onChange={e => setAddForm(p => ({...p, remark: e.target.value}))}
                  placeholder="Optional remark about this service request..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                />
              </div>

              {/* Row 6: Assign */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={assignChecked} onChange={e => setAssignChecked(e.target.checked)} className="rounded border-gray-300 text-blue-600" />
                  <span className="text-xs font-medium text-gray-700">Assign to someone (Handled By)</span>
                </label>
                {assignChecked && (
                  <select value={addForm.assign_to} onChange={e => setAddForm(p => ({...p, assign_to: e.target.value}))}
                    className="mt-2 w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                    <option value="">Select person...</option>
                    {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
              <button onClick={handleAdd} disabled={addLoading || !addForm.mobile_no}
                className="px-6 py-2 text-white text-xs font-semibold rounded-md disabled:opacity-50 transition-colors shadow-sm bg-blue-600 hover:bg-blue-700">
                {addLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          CLOSE / TRANSFER MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showCloseModal && closeTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); }}>
          <div className={`bg-white rounded-xl shadow-xl w-full transition-all duration-300 ${showAddCustomerInline ? 'max-w-4xl' : 'max-w-lg'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {readOnlyView ? 'Service Call Updates' : (showTransferMode ? 'Transfer Service Call' : 'Close Service Call')}
                  {readOnlyView && <span className="ml-2 text-xs font-normal text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">View only</span>}
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">{closeTarget.mobile_no} • Handled by: {closeTarget.taken_by || 'Unassigned'}</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin() && !readOnlyView && (
                  <button onClick={() => setShowTransferMode(!showTransferMode)} className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${showTransferMode ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    <ArrowRightLeft className="h-3 w-3" /> Switch
                  </button>
                )}
                <button onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); }} className="p-1 hover:bg-gray-100 rounded-full"><X className="h-4 w-4 text-gray-400" /></button>
              </div>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Transfer Mode (hidden in read-only view) */}
              {!readOnlyView && showTransferMode && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                  <select value={transferToUser} onChange={e => setTransferToUser(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-amber-200 rounded-md focus:outline-none bg-white appearance-none">
                    <option value="">Select new assignee...</option>
                    {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                  <button onClick={handleTransfer} disabled={!transferToUser || transferLoading}
                    className="px-4 py-2 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 disabled:opacity-50">
                    {transferLoading ? '...' : 'Assign'}
                  </button>
                </div>
              )}

              {/* --- ONLY SHOW CLOSE FIELDS IF NOT TRANSFERRING ---
                   `fieldset disabled` short-circuits every editable control
                   in read-only view so the user can read but not modify the
                   service details. The Updates section below sits OUTSIDE
                   this fieldset, so posting an update still works. */}
              {!showTransferMode && (
                <fieldset disabled={readOnlyView} className="space-y-4 disabled:opacity-95">
                  {/* Customer (Full Row) - Only show if customer is found/mapped or user manually requested search */}
                  {(closeForm.customer_id || showCustomerSearch) && (
                    <div className="relative animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Customer Name</label>
                      
                      {!showCustomerSearch && closeForm.customer_id ? (
                        <div className="flex items-center justify-between p-2.5 bg-blue-50/50 border border-blue-100 rounded-md group/cust">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-blue-500" />
                            <span className="text-sm font-medium text-blue-900">{closeForm.customer_search}</span>
                          </div>
                          <button 
                            onClick={() => setShowCustomerSearch(true)}
                            className="text-sm font-bold text-blue-600 uppercase hover:underline"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="relative group/search">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 group-focus-within/search:text-blue-500 transition-colors" />
                          <input type="text" value={closeForm.customer_search}
                            id="customer-search-input"
                            onChange={e => { setCloseForm(p => ({...p, customer_search: e.target.value, customer_id: null})); setCloseCustomerDropdown(true); }}
                            onClick={() => setCloseCustomerDropdown(true)}
                            placeholder="Type 3+ chars to search..."
                            className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all font-medium"
                          />
                          <RefreshCw className={`absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-300 transition-transform ${closeCustomerDropdown ? 'rotate-180 text-blue-400' : ''}`} />
                          
                          {closeForm.customer_id && (
                            <button 
                              onClick={() => setShowCustomerSearch(false)}
                              className="absolute right-8 top-1/2 -translate-y-1/2 px-2 py-1 text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      )}

                      {showCustomerSearch && closeCustomerDropdown && filteredCloseCustomers.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-xl max-h-48 overflow-y-auto ring-1 ring-black ring-opacity-5 font-sans">
                          {filteredCloseCustomers.map(c => (
                            <button key={c.id} onClick={() => { setCloseForm(p => ({...p, customer_id: c.id, customer_search: c.company})); setCloseCustomerDropdown(false); setShowCustomerSearch(false); }}
                              className="w-full text-left px-3 py-2.5 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0 transition-colors">
                              <div className="font-semibold text-gray-800">{c.company}</div>
                              <div className="text-sm text-gray-400">ID: {c.id}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Service Type | Serial Number (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Service Type</label>
                      <select value={closeForm.service_type} onChange={e => setCloseForm(p => ({...p, service_type: e.target.value}))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                        <option value="">—</option>
                        {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Serial Number (9 Digits)</label>
                      <input type="text" value={closeForm.serial_number} 
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
                          setCloseForm(p => ({...p, serial_number: v}));
                          if (v.length === 9) {
                            handleSerialLookup(v);
                          } else {
                            // Clear customer/flavor/expiry when serial is changed to non-9-digit
                            setSerialStatus('idle');
                            setCloseForm(p => ({
                              ...p,
                              serial_number: v,
                              customer_id: null,
                              customer_search: '',
                              flavor: '',
                              expire_date: '',
                            }));
                            setContactLocked(false);
                            setShowCustomerSearch(false);
                            setShowAddCustomerInline(false);
                          }
                        }}
                        placeholder="9-digit serial"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>



                  {/* Expiry Date | Flavor (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Expiry Date</label>
                      <input type="date" value={closeForm.expire_date} onChange={e => setCloseForm(p => ({...p, expire_date: e.target.value}))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Flavor</label>
                      <select value={closeForm.flavor} onChange={e => setCloseForm(p => ({...p, flavor: e.target.value}))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                        <option value="">Select flavor...</option>
                        {flavors.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Name | Number (2 cols) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">
                        Name {contactLocked && <span className="text-emerald-500 normal-case font-normal">✓ auto</span>}
                      </label>
                      <input type="text" value={closeForm.contact_person} onChange={e => !contactLocked && setCloseForm(p => ({...p, contact_person: e.target.value}))}
                        readOnly={contactLocked}
                        placeholder="Contact person"
                        className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 ${contactLocked ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Number</label>
                      <input type="text" value={closeTarget.mobile_no} readOnly 
                        className="w-full px-3 py-2 text-sm border border-gray-100 rounded-md bg-gray-50 text-gray-400" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Remark</label>
                    <textarea rows={3} value={closeForm.remark} onChange={e => setCloseForm(p => ({...p, remark: e.target.value}))}
                      placeholder="Note about the service call..."
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                    />
                  </div>

                  {serialStatus === 'not-found' && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 shadow-inner animate-in zoom-in-95 duration-200">
                      <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold mb-2.5">
                        <AlertCircle className="h-4 w-4" />
                        Serial not found. How would you like to proceed?
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            setCloseCustomerDropdown(true);
                            setShowCustomerSearch(true);
                            setShowAddCustomerInline(false);
                            setTimeout(() => {
                              const el = document.getElementById('customer-search-input');
                              if (el) el.focus();
                            }, 50);
                          }}
                          className="flex-1 py-2 bg-white border border-amber-200 text-amber-700 text-sm font-bold uppercase rounded hover:bg-amber-100 transition-colors shadow-sm"
                        >
                          Map Existing
                        </button>
                        <button 
                          onClick={() => {
                            setCreateCustomerForm(prev => ({ 
                              ...prev, 
                              mobile: closeTarget.mobile_no,
                              person: closeForm.contact_person,
                              group: '83'
                            }));
                            setShowAddCustomerInline(true);
                            setShowCustomerSearch(false);
                          }}
                          className="flex-1 py-2 bg-amber-600 text-white text-sm font-bold uppercase rounded hover:bg-amber-700 transition-colors shadow-sm"
                        >
                          Create Customer
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ─── INLINE CUSTOMER FORM ─── */}
                  {showAddCustomerInline && (
                    <div className="mt-6 pt-6 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-blue-50 rounded-md">
                          <Building2 className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">New Customer Details</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Company Name *</label>
                          <input type="text" value={createCustomerForm.company} onChange={e => setCreateCustomerForm(p => ({...p, company: e.target.value}))}
                            placeholder="Full Company Name" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-500" />
                        </div>
                        
                        {/* User Group is hidden as it is pre-decided */}
                        <div className="hidden">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">User Group (Auto) *</label>
                          <select value={createCustomerForm.group} disabled className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-50 text-gray-500">
                             <option value="">Auto assigned...</option>
                             {cloudUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </div>

                        {/* Status and Business Type are hidden as they have pre-decided defaults */}
                        <div className="hidden">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Status *</label>
                          <select value={createCustomerForm.status} onChange={e => setCreateCustomerForm(p => ({...p, status: e.target.value}))}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white">
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Not Our Customer">Not Our Customer</option>
                          </select>
                        </div>

                        <div className="hidden">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Business Type *</label>
                          <select value={createCustomerForm.btype} onChange={e => setCreateCustomerForm(p => ({...p, btype: e.target.value}))}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white">
                            <option value="166">Corporate</option>
                            <option value="653">Retailer</option>
                            <option value="74">Govt</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">GST IN <span className="text-gray-300 normal-case">(Optional)</span></label>
                          <input type="text" value={createCustomerForm.gstin} onChange={e => setCreateCustomerForm(p => ({...p, gstin: e.target.value.toUpperCase()}))}
                            placeholder="GST Number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md uppercase" />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Email Address *</label>
                          <input type="email" value={createCustomerForm.email} onChange={e => setCreateCustomerForm(p => ({...p, email: e.target.value}))}
                            placeholder="example@email.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md" />
                        </div>

                        <div>
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Pincode *</label>
                          <input type="text" value={createCustomerForm.pincode} 
                            onChange={async e => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                              setCreateCustomerForm(p => ({...p, pincode: v, area: '', state: ''}));
                              if (v.length === 6) {
                                try {
                                  const { pincodeApi: pa } = await import('../services/api');
                                  const res = await pa.lookup(v);
                                  if (res.city) {
                                    setCreateCustomerForm(p => ({ ...p, area: res.city, state: res.state }));
                                  }
                                } catch {}
                              }
                            }}
                            placeholder="6 digits" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md" />
                        </div>

                        <div className="md:col-span-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Address Line 1 *</label>
                            <input type="text" value={createCustomerForm.address1} onChange={e => setCreateCustomerForm(p => ({...p, address1: e.target.value}))}
                              placeholder="Building/Floor" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md" />
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Address Line 2 *</label>
                            <input type="text" value={createCustomerForm.address2} onChange={e => setCreateCustomerForm(p => ({...p, address2: e.target.value}))}
                              placeholder="Street/Area" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md" />
                          </div>
                        </div>

                        <div className="md:col-span-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-bold text-gray-400 uppercase mb-1">City (Auto)</label>
                            <input type="text" value={createCustomerForm.area} readOnly className="w-full px-3 py-2 text-sm border border-gray-100 rounded-md bg-gray-50 text-gray-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-400 uppercase mb-1">State (Auto)</label>
                            <input type="text" value={createCustomerForm.state} readOnly className="w-full px-3 py-2 text-sm border border-gray-100 rounded-md bg-gray-50 text-gray-500" />
                          </div>
                        </div>

                        <div className="md:col-span-3">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Internal Remarks</label>
                          <textarea rows={1} value={createCustomerForm.remarks} onChange={e => setCreateCustomerForm(p => ({...p, remarks: e.target.value}))}
                            placeholder="Optional notes for this customer..." className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md resize-none" />
                        </div>
                      </div>
                    </div>
                  )}
                </fieldset>
              )}

              {/* ── Update / Timeline — not shown during transfer ────────────── */}
              {!showTransferMode && (
                <div className="pt-4 mt-4 border-t border-gray-100">
                  <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Post an Update</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={updateText}
                      onChange={e => setUpdateText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && updateText.trim()) { e.preventDefault(); handleAddUpdate(); } }}
                      placeholder="What happened on this service today?"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      onClick={handleAddUpdate}
                      disabled={updateLoading || !updateText.trim()}
                      className="px-3 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm whitespace-nowrap"
                    >
                      {updateLoading ? 'Posting...' : 'Add Update'}
                    </button>
                  </div>

                  {/* Timeline of past updates */}
                  <div className="mt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                      Updates History {notes.length > 0 && <span className="text-gray-500 font-semibold">({notes.length})</span>}
                    </div>
                    {notesLoading ? (
                      <div className="text-xs text-gray-400 italic">Loading history...</div>
                    ) : notes.length === 0 ? (
                      <div className="text-xs text-gray-400 italic">No updates yet — post one above.</div>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {notes.map((n: any) => (
                          <div key={n.id} className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-md">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold uppercase text-blue-600">
                                {n.note_type || 'note'}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {n.created_by ? `${n.created_by} · ` : ''}
                                {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                              </span>
                            </div>
                            <div className="text-xs text-gray-800 mt-0.5 whitespace-pre-wrap">{n.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl flex-wrap">
              <button onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); }} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
                {readOnlyView ? 'Close' : 'Cancel'}
              </button>
              {!readOnlyView && !showTransferMode && (
                <button
                  onClick={handleSaveDetails}
                  disabled={saveDetailsLoading || showAddCustomerInline}
                  className="px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                  title="Save customer and service details without closing the call"
                >
                  {saveDetailsLoading ? 'Saving...' : 'Save Details'}
                </button>
              )}
              {!readOnlyView && !showTransferMode && (
                <button
                  onClick={handleClose}
                  disabled={closeLoading || !closeForm.serial_number || (!closeForm.customer_id && !showAddCustomerInline)}
                  className="px-6 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {closeLoading ? 'Processing...' : showAddCustomerInline ? 'Submit & Map Serial' : 'Close Service'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default ServiceCalls;
