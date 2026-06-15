import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, RefreshCw, PhoneCall, CheckCircle, X, ArrowRightLeft, Building2, Users, Briefcase, Clock, MessageSquare, Eye, Edit3, AlertCircle, Filter, Calendar, ChevronDown, MoreHorizontal } from 'lucide-react';
import { serviceCallsApi, usersApi, customersApi, leadRequirementsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PaginationControls from '../components/Shared/PaginationControls';
import SwipeableCard from '../components/Shared/SwipeableCard';
import { useSwipeTabs } from '../hooks/useSwipeTabs';

type StatusFilter = 'Open' | 'In Progress' | 'Closed' | 'Cancelled';
const LEAD_TYPES = ['Cloud', 'Tally', 'TDL', 'Web/App'] as const;

interface LeadReportProps {
  segment?: 'pending' | 'closed' | 'cancelled';
}

const LeadReport: React.FC<LeadReportProps> = ({ segment = 'pending' }) => {
  const navigate = useNavigate();
  const { user, isAdmin, canCreate, canCheckPermission } = useAuth();

  const canAdd      = canCreate('leads');
  const canTake     = canCheckPermission('leads', 'take');
  const canClose    = canCheckPermission('leads', 'close');
  const canTransfer = canCheckPermission('leads', 'transfer');
  const canViewAll  = isAdmin() || canCheckPermission('leads', 'view_all');

  // ── Lead Data ──
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  // Non-admin users default to 'Open' (unallotted leads) so they see work available to pick up
  const defaultStatus: StatusFilter = segment === 'pending' ? 'Open'
    : segment === 'closed' ? 'Closed' : 'Cancelled';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(defaultStatus);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Reset filter when segment changes
  useEffect(() => {
    const newDefault: StatusFilter = segment === 'pending' ? 'Open'
      : segment === 'closed' ? 'Closed' : 'Cancelled';
    setStatusFilter(newDefault);
  }, [segment]);
  const [staffFilter, setStaffFilter] = useState(() => canViewAll ? '' : (user?.name || ''));
  const [typeFilter, setTypeFilter] = useState('');
  const [cloudUsers, setCloudUsers] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, open: 0, pending: 0, closed: 0, cancelled: 0 });
  const [showFilter, setShowFilter] = useState(false);

  // ── Per-row Action menu (desktop). One row open at a time. We close on
  //   outside-click and on scroll so the popup doesn't drift away from
  //   its trigger when the user scrolls the table. ──
  const [openActionMenuId, setOpenActionMenuId] = useState<string | number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openActionMenuId === null) return;
    const onDown = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setOpenActionMenuId(null);
      }
    };
    const onScroll = () => setOpenActionMenuId(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [openActionMenuId]);

  // ── Pagination ──
  const ITEMS_PER_PAGE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const filteredLeads = useMemo(() => typeFilter ? leads.filter(l => l.lead_type === typeFilter) : leads, [leads, typeFilter]);
  const totalPages = Math.ceil(filteredLeads.length / ITEMS_PER_PAGE);
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLeads.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredLeads, currentPage]);

  // ── Add Modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addForm, setAddForm] = useState({
    mobile_no: '', contact_person: '', remark: '',
    lead_type: '' as string, assign_to: '',
  });
  const [assignChecked, setAssignChecked] = useState(false);

  // ── Close/Transfer/Join Modal ──
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<any>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [showTransferMode, setShowTransferMode] = useState(false);
  const [showJoinMode, setShowJoinMode] = useState(false);
  const [transferToUser, setTransferToUser] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [closeForm, setCloseForm] = useState({
    customer_id: null as string | number | null, customer_search: '',
    contact_person: '', service_type: '',
    remark: '',
    assigned_developer: '',
  });
  const [customerAutocomplete, setCustomerAutocomplete] = useState<any[]>([]);
  const [customerAutocompleteLoading, setCustomerAutocompleteLoading] = useState(false);
  const [closeCustomerDropdown, setCloseCustomerDropdown] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [contactLocked, setContactLocked] = useState(false);
  const [showAddCustomerInline, setShowAddCustomerInline] = useState(false);
  const [createCustomerForm, setCreateCustomerForm] = useState({
    company: '', group: '', reseller: '', status: 'Active', btype: '166',
    email: '', gstin: '', person: '', mobile: '',
    address1: '', address2: '', address3: '',
    pincode: '', area: '', state: '', remarks: ''
  });

  const [takeLoadingId, setTakeLoadingId] = useState<number | null>(null);
  const [expandedLeads, setExpandedLeads] = useState<number[]>([]);

  // ── Reference Data ──
  const [customers, setCustomers] = useState<any[]>([]);

  // ── Details Modal (Add Remark/Requirement only) ──
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<any>(null);
  const [detailsNotes, setDetailsNotes] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [newNoteType, setNewNoteType] = useState<'Remark' | 'Requirement' | 'Correction' | 'Update'>('Remark');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteAssignTo, setNoteAssignTo] = useState('');
  const [addNoteLoading, setAddNoteLoading] = useState(false);
  const [reqForm, setReqForm] = useState({ description: '', deadline: '', amount: '' });
  const [correctionDeadline, setCorrectionDeadline] = useState('');
  const [updateNextDate, setUpdateNextDate] = useState('');
  const [updateStage, setUpdateStage] = useState('Pending');

  // ── View Lead (popup modal) ──
  const [viewTarget, setViewTarget] = useState<any>(null);
  const [viewNotes, setViewNotes] = useState<Record<number, any[]>>({});
  const [viewReqs, setViewReqs] = useState<Record<number, any[]>>({});
  const [viewNotesLoading, setViewNotesLoading] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<'Requirement' | 'Correction' | 'Update'>('Requirement');
  const viewTabSwipe = useSwipeTabs(['Requirement', 'Correction', 'Update'] as const, viewTab, setViewTab);
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Data Fetching ──
  const fetchLeads = async () => {
    setLoading(true);
    try {
      const [res, statsRes] = await Promise.all([
        serviceCallsApi.getAll(statusFilter, activeSearch || undefined, startDate, endDate, staffFilter, 'Lead'),
        serviceCallsApi.getStats(startDate, endDate, staffFilter, 'Lead'),
      ]);
      setLeads(res.data || []);
      if (statsRes?.data) setStats(statsRes.data);
    } catch { setLeads([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLeads(); setCurrentPage(1); }, [statusFilter, activeSearch, startDate, endDate, staffFilter]);

  useEffect(() => {
    (async () => {
      const [usersRes, custRes] = await Promise.allSettled([
        // getBasic is unguarded (no permission required) and now includes
        // `permissions.my_requirements` so the Developer dropdown can filter by
        // lead_type. Earlier we used getAll() — that hits a guarded endpoint and
        // silently empties the dropdown for non-admins, breaking every Transfer /
        // assign flow on this page.
        usersApi.getBasic(),
        customersApi.getDropdown(),
      ]);
      if (usersRes.status === 'fulfilled') setCloudUsers(Array.isArray(usersRes.value) ? usersRes.value : usersRes.value?.data || []);
      if (custRes.status === 'fulfilled') setCustomers(Array.isArray(custRes.value) ? custRes.value : custRes.value?.data || []);
    })();
  }, []);

  // Autocomplete customer search via API
  useEffect(() => {
    if (closeForm.customer_search.length < 4 || closeForm.customer_id) {
      setCustomerAutocomplete([]);
      return;
    }
    const timer = setTimeout(async () => {
      setCustomerAutocompleteLoading(true);
      try {
        const res = await customersApi.search(closeForm.customer_search);
        setCustomerAutocomplete(res.data || []);
      } catch { setCustomerAutocomplete([]); }
      finally { setCustomerAutocompleteLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [closeForm.customer_search, closeForm.customer_id]);

  // ── Helpers ──
  const getTimeAgo = (d: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24);
    if (days > 0) return `${days}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return 'now';
  };

  const statusColor = (s: string) => {
    if (s === 'Open') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (s === 'In Progress') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (s === 'Closed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'Confirmed') return 'bg-teal-50 text-teal-700 border-teal-200';
    return 'bg-purple-50 text-purple-700 border-purple-200';
  };

  // ── Handlers ──
  const handleAdd = async () => {
    if (addLoading || !addForm.mobile_no.trim() || !addForm.lead_type) return;
    setAddLoading(true);
    try {
      await serviceCallsApi.create({
        mobile_no: addForm.mobile_no,
        contact_person: addForm.contact_person || undefined,
        service_type: addForm.lead_type || undefined,
        remark: addForm.remark || undefined,
        assign_to: assignChecked && addForm.assign_to ? addForm.assign_to : undefined,
        entry_type: 'Lead',
        lead_type: addForm.lead_type || undefined,
      });
      setShowAddModal(false);
      setAddForm({ mobile_no: '', contact_person: '', remark: '', lead_type: '', assign_to: '' });
      setAssignChecked(false);
      fetchLeads();
    } catch (e: any) { alert(e.message || 'Failed to create'); }
    finally { setAddLoading(false); }
  };

  const handleTake = async (id: number) => {
    if (takeLoadingId !== null) return;
    setTakeLoadingId(id);
    try {
      await serviceCallsApi.take(id);
      await fetchLeads();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('not in open status')) await fetchLeads();
      alert(e.message || 'Failed');
    }
    finally { setTakeLoadingId(null); }
  };

  const handleCancel = async (id: number) => {
    // Two-stage confirm so a single mis-click can't cancel a running lead.
    if (!window.confirm('Cancel this lead? This will move it to Cancelled status and remove it from the active queue.')) return;
    if (!window.confirm('This action cannot be undone from the UI. Continue?')) return;
    try {
      await serviceCallsApi.cancel(id);
      await fetchLeads();
    } catch (e: any) { alert(e.message || 'Failed to cancel'); }
  };

  // Lead "Complete" no longer closes directly — leads can only reach Closed via
  // (a) voucher creation, or (b) Cancel. This navigates the user into the
  // voucher form with ?lead_id=X — Vouchers.tsx prefills customer + remark from
  // the lead and, on save, the backend auto-closes the lead with closed_via='Billing'.
  const handleMarkComplete = (lead: any) => {
    if (!lead?.id) return;
    if (!lead.customer_id) {
      alert('This lead has no linked customer. Use the Close/Join flow to map a customer first, then Complete.');
      return;
    }
    navigate(`/billing/vouchers/new?lead_id=${lead.id}`);
  };

  const openCloseModal = async (lead: any) => {
    setCloseTarget(lead);
    setContactLocked(false);
    setShowTransferMode(false);
    setTransferToUser('');
    const cust = customers.find(c => c.id === lead.customer_id);
    setCloseForm({
      customer_id: lead.customer_id || null,
      customer_search: cust?.company || '',
      contact_person: lead.contact_person || '',
      service_type: lead.service_type || lead.lead_type || '',
      remark: lead.remark || '',
      assigned_developer: lead.assigned_developer || '',
    });
    setShowCustomerSearch(false);
    setShowAddCustomerInline(false);
    setShowCloseModal(true);
    try {
      const res = await serviceCallsApi.lookupContact(lead.mobile_no);
      if (res.found && res.contact?.contact_person) {
        setCloseForm(prev => ({ ...prev, contact_person: res.contact!.contact_person }));
        setContactLocked(true);
      }
    } catch { /* ignore */ }
  };

  const handleClose = async () => {
    if (closeLoading || !closeTarget) return;

    let finalCustomerId = closeForm.customer_id;

    if (showAddCustomerInline) {
      const required = [
        { key: 'company', label: 'Company Name' }, { key: 'email', label: 'Email' },
        { key: 'address1', label: 'Address Line 1' }, { key: 'address2', label: 'Address Line 2' },
        { key: 'pincode', label: 'Pincode' }, { key: 'area', label: 'City' }, { key: 'state', label: 'State' },
      ];
      for (const f of required) {
        if (!(createCustomerForm as any)[f.key]?.trim()) { alert(`${f.label} is required.`); return; }
      }
      if (createCustomerForm.pincode.length !== 6) { alert('Pincode must be exactly 6 digits.'); return; }

      setCloseLoading(true);
      try {
        const cleanName = createCustomerForm.company.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
        const custId = `${cleanName}.abstechnologies.co.in`;
        const res = await customersApi.create({
          ...createCustomerForm, customerid: custId,
          group: createCustomerForm.group || (user?.id ? parseInt(String(user.id).replace('USR', '')) || 3 : 3),
          btype: createCustomerForm.btype ? Number(createCustomerForm.btype) : 166,
          person: createCustomerForm.person || closeForm.contact_person,
          mobile: createCustomerForm.mobile || closeTarget.mobile_no,
          status: createCustomerForm.status || 'Active',
        });
        if (res.success && res.data) { finalCustomerId = res.data.id; }
        else { alert(res.message || 'Failed to create customer'); setCloseLoading(false); return; }
      } catch (e: any) { alert(e.message || 'Failed to create customer'); setCloseLoading(false); return; }
    }

    setCloseLoading(true);
    try {
      await serviceCallsApi.close(closeTarget.id, {
        customer_id: finalCustomerId || undefined,
        contact_person: closeForm.contact_person || undefined,
        service_type: closeForm.service_type || undefined,
        remark: closeForm.remark || undefined,
        assigned_developer: closeForm.assigned_developer || undefined,
      });
      setShowCloseModal(false);
      setCloseTarget(null);
      setShowAddCustomerInline(false);
      await fetchLeads();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already closed')) await fetchLeads();
      alert(e.message || 'Failed');
    }
    finally { setCloseLoading(false); }
  };

  const openJoinModal = async (lead: any) => {
    setCloseTarget(lead);
    setContactLocked(false);
    setShowTransferMode(false);
    setShowJoinMode(true);
    setTransferToUser('');
    const cust = customers.find(c => c.id === lead.customer_id);
    setCloseForm({
      customer_id: lead.customer_id || null,
      customer_search: cust?.company || '',
      contact_person: lead.contact_person || '',
      service_type: lead.service_type || lead.lead_type || '',
      remark: lead.remark || '',
      assigned_developer: lead.assigned_developer || '',
    });
    setShowCustomerSearch(false);
    setShowAddCustomerInline(false);
    setShowCloseModal(true);
    try {
      const res = await serviceCallsApi.lookupContact(lead.mobile_no);
      if (res.found && res.contact?.contact_person) {
        setCloseForm(prev => ({ ...prev, contact_person: res.contact!.contact_person }));
        setContactLocked(true);
      }
    } catch { /* ignore */ }
  };

  const handleJoin = async () => {
    if (closeLoading || !closeTarget) return;

    let finalCustomerId = closeForm.customer_id;

    if (showAddCustomerInline) {
      const required = [
        { key: 'company', label: 'Company Name' }, { key: 'email', label: 'Email' },
        { key: 'address1', label: 'Address Line 1' }, { key: 'address2', label: 'Address Line 2' },
        { key: 'pincode', label: 'Pincode' }, { key: 'area', label: 'City' }, { key: 'state', label: 'State' },
      ];
      for (const f of required) {
        if (!(createCustomerForm as any)[f.key]?.trim()) { alert(`${f.label} is required.`); return; }
      }
      if (createCustomerForm.pincode.length !== 6) { alert('Pincode must be exactly 6 digits.'); return; }

      setCloseLoading(true);
      try {
        const cleanName = createCustomerForm.company.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
        const custId = `${cleanName}.abstechnologies.co.in`;
        const res = await customersApi.create({
          ...createCustomerForm, customerid: custId,
          group: createCustomerForm.group || (user?.id ? parseInt(String(user.id).replace('USR', '')) || 3 : 3),
          btype: createCustomerForm.btype ? Number(createCustomerForm.btype) : 166,
          person: createCustomerForm.person || closeForm.contact_person,
          mobile: createCustomerForm.mobile || closeTarget.mobile_no,
          status: createCustomerForm.status || 'Active',
        });
        if (res.success && res.data) { finalCustomerId = res.data.id; }
        else { alert(res.message || 'Failed to create customer'); setCloseLoading(false); return; }
      } catch (e: any) { alert(e.message || 'Failed to create customer'); setCloseLoading(false); return; }
    }

    setCloseLoading(true);
    try {
      await serviceCallsApi.join(closeTarget.id, {
        customer_id: finalCustomerId ? Number(finalCustomerId) : undefined,
        contact_person: closeForm.contact_person || undefined,
        service_type: closeForm.service_type || undefined,
        remark: closeForm.remark || undefined,
        assigned_developer: closeForm.assigned_developer || undefined,
      });
      setShowCloseModal(false);
      setCloseTarget(null);
      setShowJoinMode(false);
      setShowAddCustomerInline(false);
      await fetchLeads();
    } catch (e: any) {
      alert(e.message || 'Failed to join lead');
    }
    finally { setCloseLoading(false); }
  };

  const handleTransfer = async () => {
    if (transferLoading || !transferToUser || !closeTarget) return;
    setTransferLoading(true);
    try {
      await serviceCallsApi.transfer(closeTarget.id, transferToUser);
      setShowCloseModal(false);
      setShowTransferMode(false);
      setTransferToUser('');
      await fetchLeads();
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('already closed')) await fetchLeads();
      alert(e.message || 'Failed');
    }
    finally { setTransferLoading(false); }
  };

  // ── View Lead (popup modal) ──
  const handleViewLead = async (lead: any) => {
    setViewTarget(lead);
    setViewTab('Requirement');
    setShowAddForm(false);
    setNewNoteContent('');
    setReqForm({ description: '', deadline: '', amount: '' });
    setViewNotesLoading(lead.id);
    try {
      const [notesRes, reqsRes] = await Promise.allSettled([
        serviceCallsApi.getNotes(lead.id),
        leadRequirementsApi.getRequirements(lead.id),
      ]);
      const notes = notesRes.status === 'fulfilled' ? (Array.isArray(notesRes.value) ? notesRes.value : notesRes.value?.data || []) : [];
      const reqs = reqsRes.status === 'fulfilled' ? (Array.isArray(reqsRes.value) ? reqsRes.value : reqsRes.value?.data || []) : [];
      setViewNotes(prev => ({ ...prev, [lead.id]: notes }));
      setViewReqs(prev => ({ ...prev, [lead.id]: reqs }));
    } catch {
      setViewNotes(prev => ({ ...prev, [lead.id]: [] }));
      setViewReqs(prev => ({ ...prev, [lead.id]: [] }));
    } finally { setViewNotesLoading(null); }
  };

  // ── Edit Lead Modal (add remark/requirement only) ──
  const openDetailsModal = async (lead: any) => {
    setDetailsTarget(lead);
    setShowDetailsModal(true);
    setNewNoteType('Remark');
    setNewNoteContent('');
  };

  const handleAddNote = async () => {
    if (addNoteLoading || !detailsTarget) return;
    if (newNoteType === 'Requirement') {
      if (!reqForm.description.trim()) { alert('Description is required'); return; }
      setAddNoteLoading(true);
      try {
        await leadRequirementsApi.addRequirement(detailsTarget.id, {
          description: reqForm.description,
          deadline: reqForm.deadline || undefined,
          amount: reqForm.amount ? parseFloat(reqForm.amount) : undefined,
        });
        setReqForm({ description: '', deadline: '', amount: '' });
        setShowDetailsModal(false);
        alert('Requirement added!');
      } catch (e: any) { alert(e.message || 'Failed to add requirement'); }
      finally { setAddNoteLoading(false); }
      return;
    }
    if (!newNoteContent.trim()) return;
    setAddNoteLoading(true);
    try {
      await serviceCallsApi.addNote(detailsTarget.id, { note_type: newNoteType, content: newNoteContent });
      setNewNoteContent('');
      const res = await serviceCallsApi.getNotes(detailsTarget.id);
      const notes = Array.isArray(res) ? res : res?.data || [];
      setViewNotes(prev => ({ ...prev, [detailsTarget.id]: notes }));
    } catch (e: any) { alert(e.message || 'Failed to add note'); }
    finally { setAddNoteLoading(false); }
  };

  const handleViewAddNote = async () => {
    if (addNoteLoading || !viewTarget) return;
    if (viewTab === 'Requirement') {
      if (!reqForm.description.trim()) return;
      setAddNoteLoading(true);
      try {
        await leadRequirementsApi.addRequirement(viewTarget.id, {
          description: reqForm.description,
          deadline: reqForm.deadline || undefined,
          amount: reqForm.amount ? parseFloat(reqForm.amount) : undefined,
        });
        setReqForm({ description: '', deadline: '', amount: '' });
        setShowAddForm(false);
        const res = await leadRequirementsApi.getRequirements(viewTarget.id);
        setViewReqs(prev => ({ ...prev, [viewTarget.id]: Array.isArray(res) ? res : res?.data || [] }));
      } catch (e: any) { alert(e.message || 'Failed'); }
      finally { setAddNoteLoading(false); }
      return;
    }
    if (!newNoteContent.trim()) return;
    setAddNoteLoading(true);
    try {
      const noteData: any = { note_type: viewTab, content: newNoteContent };
      if (viewTab === 'Correction') {
        if (noteAssignTo) noteData.assigned_to = noteAssignTo;
        if (correctionDeadline) noteData.deadline = correctionDeadline;
      }
      if (viewTab === 'Update') {
        if (updateNextDate) noteData.next_update_date = updateNextDate;
        if (updateStage) noteData.stage = updateStage;
      }
      await serviceCallsApi.addNote(viewTarget.id, noteData);
      setNewNoteContent('');
      setNoteAssignTo('');
      setCorrectionDeadline('');
      setUpdateNextDate('');
      setUpdateStage('Pending');
      setShowAddForm(false);
      const res = await serviceCallsApi.getNotes(viewTarget.id);
      setViewNotes(prev => ({ ...prev, [viewTarget.id]: Array.isArray(res) ? res : res?.data || [] }));
    } catch (e: any) { alert(e.message || 'Failed'); }
    finally { setAddNoteLoading(false); }
  };

  // ── Render ──
  return (
    <div className="flex flex-col h-[calc(100dvh-120px)] md:h-[calc(100dvh-64px)] bg-gray-50 overflow-hidden font-sans">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-sm sm:text-[24px] font-bold text-gray-900 tracking-tight">{segment === 'pending' ? 'Lead Pending' : segment === 'closed' ? 'Lead Closed' : 'Lead Cancelled'}</h1>
          {filteredLeads.length > 0 && (
            <span className="px-2.5 py-1 rounded-full text-sm font-semibold bg-purple-100 text-purple-600">{filteredLeads.length} results</span>
          )}
          {/* ── Inline Filters ── */}
          {canViewAll && (
            <select
              value={staffFilter}
              onChange={e => setStaffFilter(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
            >
              <option value="">All Handlers</option>
              {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
          >
            <option value="">All Types</option>
            {LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {canViewAll && (staffFilter || typeFilter) && (
            <button onClick={() => { setStaffFilter(''); setTypeFilter(''); }} className="text-xs text-red-500 hover:underline">Clear</button>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2">
          {/* Search — desktop only */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setActiveSearch(searchQuery); }}
              placeholder="Search leads..."
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md w-48 focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 focus:w-56 transition-all"
            />
          </div>
          <button onClick={() => setActiveSearch(searchQuery)} className="px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-600 text-xs font-semibold rounded-md hover:bg-purple-100 transition-colors">
            Search
          </button>
          {activeSearch && (
            <button onClick={() => { setActiveSearch(''); setSearchQuery(''); }} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <button onClick={fetchLeads} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={() => setShowFilter(!showFilter)} className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium transition-colors ${showFilter ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <Filter className="h-3.5 w-3.5" />
            Filter
          </button>
          {canAdd && segment === 'pending' && (
            <button onClick={() => setShowAddModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-md hover:bg-purple-700 transition-colors shadow-sm">
              <Plus className="h-3.5 w-3.5" /> Add Lead
            </button>
          )}
        </div>
      </div>

      {/* ── Filter Bar (Date + Staff) ── */}
      {showFilter && (
        <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex flex-wrap items-center gap-3 shrink-0">
          {isAdmin() && (
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} className="pl-2 pr-6 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none">
              <option value="">All Staff</option>
              {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Calendar className="h-3.5 w-3.5" />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="py-1.5 px-2 border border-gray-200 rounded-md text-xs focus:outline-none" />
            <span>–</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="py-1.5 px-2 border border-gray-200 rounded-md text-xs focus:outline-none" />
          </div>
          {(staffFilter || startDate || endDate) && (
            <button onClick={() => { setStaffFilter(''); setStartDate(''); setEndDate(''); }} className="text-xs text-red-500 hover:underline">Clear filters</button>
          )}
        </div>
      )}

      {/* ── Status Filter Tabs (only for pending segment) ── */}
      {segment === 'pending' && (
        <div className="bg-white border-b border-gray-200 px-6 flex items-center gap-0 shrink-0">
          {([
            { id: 'Open' as StatusFilter, label: 'Unalloted' },
            { id: 'In Progress' as StatusFilter, label: 'Pending' },
          ]).map(t => (
            <button key={t.id} onClick={() => setStatusFilter(t.id)}
              className={`flex items-center justify-center gap-2 flex-1 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                statusFilter === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto">
        <div className="bg-white">
          {/* Desktop Table — fixed layout with explicit widths so the wide
              Company / Remark columns absorb leftover space and the small
              metadata columns (Mobile, Type, Status, Age, Action) stay tight. */}
          <table className="hidden md:table w-full table-fixed border-collapse bg-white">
            <colgroup>
              <col className="w-10" />              {/* Sr */}
              <col />                                {/* Company — flex */}
              <col className="w-[140px]" />          {/* Contact */}
              <col className="w-[110px]" />          {/* Mobile */}
              <col className="w-[120px]" />          {/* Handled By */}
              <col className="w-[70px]" />           {/* Type */}
              <col />                                {/* Remark — flex */}
              <col className="w-[70px]" />           {/* Last */}
              <col className="w-[70px]" />           {/* Next */}
              <col className="w-[100px]" />          {/* Status */}
              <col className="w-[55px]" />           {/* Age */}
              <col className="w-[80px]" />           {/* Action — single dropdown */}
            </colgroup>
            <thead className="bg-[#f8f9fa] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
              <tr>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Sr</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Company</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Contact</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Mobile</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Handled By</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Type</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase">Remark</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Last</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Next</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center text-xs font-semibold text-gray-600 uppercase">Age</th>
                <th className="px-2 py-1.5 border border-gray-200 text-right text-xs font-semibold text-gray-600 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={12} className="px-6 py-12 text-center text-sm text-gray-400">Loading leads...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={12} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-400">No leads found</p>
                    <p className="text-xs text-gray-300">Try a different search or create a new lead</p>
                  </div>
                </td></tr>
              ) : paginatedLeads.map((lead, i) => (
                <tr key={lead.id} className="hover:bg-blue-50/30 transition-colors group"
                >
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700">{(currentPage - 1) * ITEMS_PER_PAGE + i + 1}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 truncate" title={lead.customer_name || (lead as any).company_name || ''}>
                      <span className="flex items-center gap-1">
                        {(lead as any).source === 'website' && <span className="text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full shrink-0">WEB</span>}
                        {lead.customer_name || (lead as any).company_name || <span className="text-gray-400">Walk-in</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 truncate" title={lead.contact_person || ''}>{lead.contact_person || <span className="text-gray-400">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 whitespace-nowrap">{lead.mobile_no}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 truncate" title={lead.taken_by || ''}>{lead.taken_by || <span className="text-gray-400">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-700 whitespace-nowrap">{lead.lead_type || <span className="text-gray-400">—</span>}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-xs text-gray-700 truncate" title={(lead as any).latest_update_remark || lead.remark || ''}>
                      {(lead as any).latest_update_remark || lead.remark || <span className="text-gray-400">—</span>}
                    </td>
                    {(() => {
                      const fmtShort = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
                      const updAt = (lead as any).latest_update_at;
                      const nextAt = (lead as any).latest_update_next_date;
                      return (<>
                        <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-700 whitespace-nowrap">
                          {updAt ? fmtShort(updAt) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-700 whitespace-nowrap">
                          {nextAt ? fmtShort(nextAt) : <span className="text-gray-400">—</span>}
                        </td>
                      </>);
                    })()}
                    <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-700 whitespace-nowrap">
                      {(() => {
                        const stage = (lead as any).latest_update_stage;
                        const showStage = stage && (lead.status === 'In Progress' || lead.status === 'Open');
                        return showStage ? stage : lead.status;
                      })()}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-center text-xs text-gray-700 whitespace-nowrap">{getTimeAgo(lead.created_at)}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                      {(() => {
                        // Build the action list once per row, then render either
                        // a single trigger + popup, or nothing at all.
                        type Item = { label: string; icon: React.ReactNode; onClick: () => void; tone: 'blue'|'emerald'|'red'|'purple'|'amber'|'gray'; disabled?: boolean };
                        const items: Item[] = [];
                        if (lead.status === 'Open') {
                          if (canTake) items.push({ label: 'Pick Lead', icon: <PhoneCall className="h-3.5 w-3.5" />, tone: 'blue', onClick: () => handleTake(lead.id), disabled: takeLoadingId === lead.id });
                          items.push({ label: 'Cancel Lead', icon: <X className="h-3.5 w-3.5" />, tone: 'red', onClick: () => handleCancel(lead.id) });
                        } else if (lead.status === 'In Progress' && lead.customer_id) {
                          items.push({ label: 'View Lead', icon: <Eye className="h-3.5 w-3.5" />, tone: 'purple', onClick: () => handleViewLead(lead) });
                          items.push({ label: 'Mark Complete', icon: <CheckCircle className="h-3.5 w-3.5" />, tone: 'emerald', onClick: () => handleMarkComplete(lead) });
                          if (canTransfer) items.push({ label: 'Transfer Lead', icon: <ArrowRightLeft className="h-3.5 w-3.5" />, tone: 'amber', onClick: () => { setCloseTarget(lead); setShowTransferMode(true); setShowCloseModal(true); } });
                          // Cancel running (joined) leads — same flow as the unjoined branch.
                          // handleCancel already gates on window.confirm so accidental clicks
                          // can be reverted out of.
                          items.push({ label: 'Cancel Lead', icon: <X className="h-3.5 w-3.5" />, tone: 'red', onClick: () => handleCancel(lead.id) });
                        } else if (lead.status === 'In Progress' && !lead.customer_id) {
                          items.push({ label: 'View Lead', icon: <Eye className="h-3.5 w-3.5" />, tone: 'purple', onClick: () => handleViewLead(lead) });
                          items.push({ label: 'Lead Joint', icon: <CheckCircle className="h-3.5 w-3.5" />, tone: 'emerald', onClick: () => openJoinModal(lead) });
                          items.push({ label: 'Cancel Lead', icon: <X className="h-3.5 w-3.5" />, tone: 'red', onClick: () => handleCancel(lead.id) });
                          if (canTransfer) items.push({ label: 'Transfer Lead', icon: <ArrowRightLeft className="h-3.5 w-3.5" />, tone: 'amber', onClick: () => { setCloseTarget(lead); setShowTransferMode(true); setShowCloseModal(true); } });
                        } else if (lead.status === 'Closed') {
                          items.push({ label: 'View Lead', icon: <Eye className="h-3.5 w-3.5" />, tone: 'purple', onClick: () => handleViewLead(lead) });
                        } else if (lead.status === 'Cancelled' && (lead.remark || lead.resolution_note)) {
                          items.push({ label: 'View Lead', icon: <Eye className="h-3.5 w-3.5" />, tone: 'gray', onClick: () => handleViewLead(lead) });
                        }
                        if (items.length === 0) return <span className="text-gray-300">—</span>;

                        const isOpen = openActionMenuId === lead.id;
                        const toneText: Record<Item['tone'], string> = {
                          blue: 'text-blue-700 hover:bg-blue-50',
                          emerald: 'text-emerald-700 hover:bg-emerald-50',
                          red: 'text-red-700 hover:bg-red-50',
                          purple: 'text-purple-700 hover:bg-purple-50',
                          amber: 'text-amber-700 hover:bg-amber-50',
                          gray: 'text-gray-700 hover:bg-gray-50',
                        };
                        return (
                          <div className="relative inline-block" ref={isOpen ? actionMenuRef : undefined}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(isOpen ? null : lead.id); }}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded transition-colors ${isOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                              aria-haspopup="menu"
                              aria-expanded={isOpen}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span>Action</span>
                            </button>
                            {isOpen && (
                              <div role="menu"
                                className="absolute right-0 top-full mt-1 z-30 min-w-[160px] bg-white border border-gray-200 rounded-md shadow-lg py-1"
                              >
                                {items.map((it, idx) => (
                                  <button
                                    key={idx}
                                    role="menuitem"
                                    disabled={it.disabled}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenActionMenuId(null);
                                      it.onClick();
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs ${toneText[it.tone]} disabled:opacity-50 disabled:cursor-not-allowed`}
                                  >
                                    {it.icon}
                                    <span>{it.label}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile Lead Cards */}
          <div className="md:hidden p-3 space-y-2.5 bg-gray-50/50">
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-400">Loading leads...</div>
            ) : leads.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No leads found</div>
            ) : paginatedLeads.map(lead => {
              const isExpanded = expandedLeads.includes(lead.id);
              const swipeActions = [
                ...(lead.status === 'Open' && canTake ? [{ label: 'Pick', color: 'bg-blue-500', onClick: () => handleTake(lead.id) }] : []),
                ...(lead.status === 'Open' ? [{ label: 'Cancel', color: 'bg-red-500', onClick: () => handleCancel(lead.id) }] : []),
                ...(lead.status === 'In Progress' && lead.customer_id ? [
                  { label: 'View', color: 'bg-purple-500', onClick: () => handleViewLead(lead) },
                  { label: 'Complete', color: 'bg-emerald-500', onClick: () => handleMarkComplete(lead) },
                  ...(canTransfer ? [{ label: 'Transfer', color: 'bg-amber-500', onClick: () => { setCloseTarget(lead); setShowTransferMode(true); setShowCloseModal(true); } }] : []),
                ] : []),
                ...(lead.status === 'In Progress' && !lead.customer_id ? [
                  { label: 'Joint', color: 'bg-emerald-500', onClick: () => openJoinModal(lead) },
                  { label: 'Cancel', color: 'bg-red-500', onClick: () => handleCancel(lead.id) },
                  ...(canTransfer ? [{ label: 'Transfer', color: 'bg-amber-500', onClick: () => { setCloseTarget(lead); setShowTransferMode(true); setShowCloseModal(true); } }] : []),
                ] : []),
                ...(lead.status === 'Closed' || (lead.status === 'Cancelled' && (lead.remark || lead.resolution_note)) ? [
                  { label: 'View', color: 'bg-purple-500', onClick: () => handleViewLead(lead) },
                ] : []),
              ];

              const hasExtra = !!(lead.serial_number || lead.transferred_by);
              return (
                <SwipeableCard key={lead.id} actions={swipeActions}>
                  <div className="bg-white p-2 rounded-xl border-2 border-gray-300 shadow-sm relative">
                    {/* Chevron - only shown when there's extra info */}
                    {hasExtra && (
                      <button
                        className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 active:bg-gray-200 z-10"
                        onClick={(e) => { e.stopPropagation(); setExpandedLeads(prev =>
                          prev.includes(lead.id) ? prev.filter(id => id !== lead.id) : [...prev, lead.id]
                        ); }}
                      >
                        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}

                    {/* Card body - click opens lead */}
                    <div className={`cursor-pointer active:bg-gray-50 select-none ${hasExtra ? 'pr-7' : ''}`} onClick={() => handleViewLead(lead)}>
                      {/* Row 1: Company Name | Time */}
                      <div className="flex items-center justify-between gap-2 pb-[3px] mb-[3px] border-b-2 border-gray-200">
                        <div className="text-[22px] text-gray-900 truncate flex-1 flex items-center gap-1.5">
                          {(lead as any).source === 'website' && <span className="text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full shrink-0">WEB</span>}
                          {lead.customer_name || (lead as any).company_name || <span className="italic">Walk-in</span>}
                        </div>
                        <span className="text-[22px] text-gray-900 shrink-0">{getTimeAgo(lead.created_at)}</span>
                      </div>

                      {/* Info Grid with borders */}
                      <div className="border border-gray-200 rounded-lg overflow-hidden text-[22px] text-gray-900 leading-tight">
                        {/* Lead Contact | Phone */}
                        <div className="flex border-b border-gray-200">
                          <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">Lead Contact</div>
                          <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">
                            <a href={`tel:${lead.mobile_no}`} onClick={e => e.stopPropagation()}>{lead.mobile_no}</a>
                          </div>
                        </div>
                        {/* Type | Remark (latest update or fallback) */}
                        <div className="flex border-b border-gray-200">
                          <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">{lead.lead_type || 'N/A'}</div>
                          <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200">{(lead as any).latest_update_remark || lead.remark || '—'}</div>
                        </div>
                        {/* Last Update | Next Date — only if a stage update exists */}
                        {((lead as any).latest_update_at || (lead as any).latest_update_next_date) && (
                          <div className="flex">
                            <div className="w-[42%] bg-gray-50 px-2 py-[3px] shrink-0 truncate">Last / Next</div>
                            <div className="flex-1 px-2 py-[3px] truncate border-l border-gray-200 text-[18px]">
                              <span>{(lead as any).latest_update_at ? new Date((lead as any).latest_update_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
                              <span className="text-gray-400 mx-1">/</span>
                              <span>{(lead as any).latest_update_next_date ? new Date((lead as any).latest_update_next_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Status | Handler — Status reflects latest update stage when active */}
                      <div className="mt-[3px] flex items-center gap-1 text-[22px] text-gray-900 min-w-0 overflow-hidden">
                        <span className="shrink-0">Status:</span>
                        <span className="truncate min-w-0">{(() => {
                          const stage = (lead as any).latest_update_stage;
                          const isActive = lead.status === 'In Progress' || lead.status === 'Open';
                          if (isActive && stage) return stage;
                          return lead.status === 'In Progress' ? 'Pending' : lead.status;
                        })()}</span>
                        <span className="mx-1 text-gray-300 shrink-0">|</span>
                        <span className="shrink-0">Handler:</span>
                        <span className="truncate min-w-0">{lead.taken_by || 'Unassigned'}</span>
                      </div>
                    </div>

                    {/* Expanded Details - only serial/transfer extra info */}
                    {isExpanded && hasExtra && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-1 text-xs text-gray-700">
                        {lead.serial_number && (
                          <div><span className="text-gray-400">Serial:</span> <span className="font-medium">{lead.serial_number}</span></div>
                        )}
                        {lead.transferred_by && (
                          <div><span className="text-gray-400">Transferred:</span> <span className="font-medium">{lead.transferred_by} → {lead.taken_by}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                </SwipeableCard>
              );
            })}
          </div>
        </div>

        {/* Pagination */}
        {leads.length > ITEMS_PER_PAGE && (
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={leads.length}
            itemsPerPage={ITEMS_PER_PAGE}
            loading={loading}
            sticky={false}
          />
        )}
      </div>

      {/* ══ ADD LEAD MODAL ══ */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Add Lead</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-full"><X className="h-4 w-4 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Mobile + Lead Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Mobile No. <span className="text-red-500">*</span></label>
                  <input type="tel" value={addForm.mobile_no}
                    onChange={e => setAddForm(p => ({ ...p, mobile_no: e.target.value }))}
                    placeholder="Enter 10-digit mobile"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Lead Type <span className="text-red-500">*</span></label>
                  <select value={addForm.lead_type} onChange={e => setAddForm(p => ({ ...p, lead_type: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-100 appearance-none">
                    <option value="">Select type...</option>
                    {LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Details */}
              <div>
                <label className="block text-sm font-bold text-gray-500 uppercase mb-1">
                  Remark
                </label>
                <textarea rows={3} value={addForm.remark} onChange={e => setAddForm(p => ({ ...p, remark: e.target.value }))}
                  placeholder="Enter remark or details..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-100 resize-none"
                />
              </div>

              {/* Assign */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={assignChecked} onChange={e => setAssignChecked(e.target.checked)} className="rounded border-gray-300 text-purple-600" />
                  <span className="text-xs font-medium text-gray-700">Assign to someone (Handled By)</span>
                </label>
                {assignChecked && (
                  <select value={addForm.assign_to} onChange={e => setAddForm(p => ({ ...p, assign_to: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-100 appearance-none">
                    <option value="">Select person...</option>
                    {cloudUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
              <button onClick={handleAdd} disabled={addLoading || !addForm.mobile_no || !addForm.lead_type}
                className="px-6 py-2 bg-purple-600 text-white text-xs font-semibold rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors shadow-sm">
                {addLoading ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ CLOSE / TRANSFER MODAL ══ */}
      {showCloseModal && closeTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); setShowJoinMode(false); }}>
          <div className={`bg-white rounded-xl shadow-xl w-full transition-all duration-300 ${showAddCustomerInline ? 'max-w-4xl' : 'max-w-lg'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">{showTransferMode ? 'Transfer Lead' : showJoinMode ? 'Lead Joint' : 'Close Lead'}</h2>
                <p className="text-sm text-gray-400 mt-0.5">{closeTarget.mobile_no} • Handled by: {closeTarget.taken_by || 'Unassigned'}</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin() && (
                  <button onClick={() => setShowTransferMode(!showTransferMode)} className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${showTransferMode ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    <ArrowRightLeft className="h-3 w-3" /> Switch
                  </button>
                )}
                <button onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); setShowJoinMode(false); }} className="p-1 hover:bg-gray-100 rounded-full"><X className="h-4 w-4 text-gray-400" /></button>
              </div>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {showTransferMode && (
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

              {!showTransferMode && (
                <>
                  {/* Customer Search */}
                  <div className="relative">
                    <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Customer Name</label>
                    {closeForm.customer_id && !showCustomerSearch ? (
                      <div className="flex items-center justify-between p-2.5 bg-blue-50/50 border border-blue-100 rounded-md">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium text-blue-900">{closeForm.customer_search}</span>
                        </div>
                        <button onClick={() => { setShowCustomerSearch(true); setCloseForm(p => ({...p, customer_id: null, customer_search: ''})); }} className="text-sm font-bold text-blue-600 uppercase hover:underline">Change</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input type="text" value={closeForm.customer_search} id="lead-customer-search"
                          onChange={e => { setCloseForm(p => ({...p, customer_search: e.target.value, customer_id: null})); setCloseCustomerDropdown(true); setShowAddCustomerInline(false); }}
                          placeholder="Type 3+ chars to search customer..."
                          className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 font-medium"
                        />
                        {customerAutocompleteLoading && (
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                          </div>
                        )}
                      </div>
                    )}
                    {closeCustomerDropdown && !closeForm.customer_id && closeForm.customer_search.length >= 3 && (
                      <>
                        {customerAutocomplete.length > 0 && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-xl max-h-48 overflow-y-auto">
                            {customerAutocomplete.map((c: any) => (
                              <button key={c.id} onClick={() => { setCloseForm(p => ({...p, customer_id: c.id, customer_search: c.company})); setCloseCustomerDropdown(false); setShowCustomerSearch(false); setShowAddCustomerInline(false); }}
                                className="w-full text-left px-3 py-2.5 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0">
                                <div className="font-semibold text-gray-800">{c.company}</div>
                                <div className="text-[10px] text-gray-400 flex gap-2">
                                  {c.person && <span>{c.person}</span>}
                                  {c.mobile && <span>{c.mobile}</span>}
                                  {c.city && <span>{c.city}</span>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {!customerAutocompleteLoading && customerAutocomplete.length === 0 && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-xl p-3">
                            <p className="text-xs text-gray-500 mb-2">No customer found for "{closeForm.customer_search}"</p>
                            <button onClick={() => {
                              setCreateCustomerForm(prev => ({ ...prev, company: closeForm.customer_search, mobile: closeTarget?.mobile_no || '', person: closeForm.contact_person, group: '' }));
                              setShowAddCustomerInline(true); setCloseCustomerDropdown(false); }}
                              className="w-full py-2 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700">
                              + Create Customer
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Lead Type */}
                  <div>
                    <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Lead Type</label>
                    <select value={closeForm.service_type} onChange={e => setCloseForm(p => ({...p, service_type: e.target.value, assigned_developer: ''}))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none">
                      <option value="">—</option>
                      {LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  {/* Developer — filtered by my_requirements permission matching lead_type.
                      Lead type → permission key: Cloud→cloud, Tally→tally, TDL→tdl, Web/App→webapp.
                      Admins always appear regardless of their my_requirements flags. */}
                  <div>
                    <label className="block text-sm font-bold text-gray-500 uppercase mb-1">
                      Developer {!closeForm.service_type && <span className="text-gray-300 normal-case font-normal">(pick Lead Type first)</span>}
                    </label>
                    {(() => {
                      const leadKey = (() => {
                        const t = (closeForm.service_type || '').toLowerCase();
                        if (t === 'cloud') return 'cloud';
                        if (t === 'tally') return 'tally';
                        if (t === 'tdl')   return 'tdl';
                        if (t === 'web/app' || t === 'webapp' || t === 'web' || t === 'app') return 'webapp';
                        return null;
                      })();
                      const eligible = leadKey
                        ? cloudUsers.filter(u =>
                            u?.status !== 'inactive' &&
                            (u?.role === 'admin' || u?.permissions?.my_requirements?.[leadKey] === true)
                          )
                        : [];
                      return (
                        <select
                          value={closeForm.assigned_developer}
                          onChange={e => setCloseForm(p => ({ ...p, assigned_developer: e.target.value }))}
                          disabled={!leadKey}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 appearance-none disabled:bg-gray-50 disabled:text-gray-400"
                        >
                          <option value="">{leadKey ? (eligible.length ? 'Select developer…' : 'No matching developer — grant my_requirements permission') : '—'}</option>
                          {eligible.map(u => <option key={u.id} value={u.name}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
                        </select>
                      );
                    })()}
                  </div>

                  {/* Name | Number */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">
                        Name {contactLocked && <span className="text-emerald-500 normal-case font-normal">✓ auto</span>}
                      </label>
                      <input type="text" value={closeForm.contact_person} onChange={e => !contactLocked && setCloseForm(p => ({...p, contact_person: e.target.value}))}
                        readOnly={contactLocked} placeholder="Contact person"
                        className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 ${contactLocked ? 'bg-gray-50 text-gray-500' : ''}`} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Number</label>
                      <input type="text" value={closeTarget.mobile_no} readOnly className="w-full px-3 py-2 text-sm border border-gray-100 rounded-md bg-gray-50 text-gray-400" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Remark</label>
                    <textarea rows={3} value={closeForm.remark} onChange={e => setCloseForm(p => ({...p, remark: e.target.value}))}
                      placeholder="Note about how this lead was resolved..."
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-100 resize-none" />
                  </div>


                  {/* Inline Customer Form */}
                  {showAddCustomerInline && (
                    <div className="mt-6 pt-6 border-t border-gray-100">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-blue-50 rounded-md"><Building2 className="h-3.5 w-3.5 text-blue-600" /></div>
                        <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">New Customer Details</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-400 uppercase mb-1">Company Name *</label>
                          <input type="text" value={createCustomerForm.company} onChange={e => setCreateCustomerForm(p => ({...p, company: e.target.value}))}
                            placeholder="Full Company Name" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-500" />
                        </div>
                        <div className="hidden">
                          <select value={createCustomerForm.group} disabled className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-50">
                            <option value="">Auto assigned...</option>
                            {cloudUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </div>
                        <div className="hidden">
                          <select value={createCustomerForm.status} onChange={e => setCreateCustomerForm(p => ({...p, status: e.target.value}))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md">
                            <option value="Active">Active</option><option value="Inactive">Inactive</option>
                          </select>
                        </div>
                        <div className="hidden">
                          <select value={createCustomerForm.btype} onChange={e => setCreateCustomerForm(p => ({...p, btype: e.target.value}))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md">
                            <option value="166">Corporate</option><option value="653">Retailer</option><option value="74">Govt</option>
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
                                  if (res.city) setCreateCustomerForm(p => ({ ...p, area: res.city, state: res.state }));
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
                            placeholder="Optional notes..." className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md resize-none" />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button onClick={() => { setShowCloseModal(false); setShowAddCustomerInline(false); setShowJoinMode(false); }} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
              {!showTransferMode && (
                <button onClick={showJoinMode ? handleJoin : handleClose}
                  disabled={closeLoading || (!closeForm.customer_id && !showAddCustomerInline)}
                  className="px-6 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm">
                  {closeLoading ? 'Processing...' : showAddCustomerInline ? 'Submit & Map Serial' : showJoinMode ? 'Join Lead' : 'Close Lead'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ VIEW LEAD MODAL ══ */}
      {viewTarget && (() => {
        const allNotes = viewNotes[viewTarget.id] || [];
        const reqs = viewReqs[viewTarget.id] || [];
        const correctionNotes = allNotes.filter((n: any) => n.note_type === 'Correction');
        const updateNotes = allNotes.filter((n: any) => n.note_type === 'Update');
        const tabCounts = {
          Requirement: reqs.length,
          Correction: correctionNotes.length,
          Update: updateNotes.length,
        };
        return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-0 md:p-4" onClick={() => setViewTarget(null)}>
          <div className="bg-white md:rounded-xl shadow-xl w-full h-full md:h-auto md:max-w-3xl md:max-h-[80vh] flex flex-col relative" onClick={e => e.stopPropagation()}>
            {/* Header - Company name + status pills + close */}
            {(() => {
              // Header status reflects the latest Update note's stage when the lead is
              // active; falls back to the service_call lifecycle status otherwise.
              const notesNow = viewNotes[viewTarget.id] || [];
              const lastUpdateStage = notesNow.find((n: any) => n.note_type === 'Update' && n.stage)?.stage;
              const isActive = viewTarget.status === 'In Progress' || viewTarget.status === 'Open';
              const hdrStatus = isActive && lastUpdateStage ? lastUpdateStage
                : viewTarget.status === 'In Progress' ? 'Pending' : viewTarget.status;
              const hdrStatusColor =
                hdrStatus === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                hdrStatus === 'Cancelled' || hdrStatus === 'Closed' ? 'bg-gray-50 text-gray-700 border-gray-200' :
                'bg-amber-50 text-amber-700 border-amber-200';
              return (
                <div className="px-5 py-4 border-b border-gray-200 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <h2 className="text-sm font-bold text-gray-900 tracking-tight truncate max-w-[140px]" title={viewTarget.customer_name || 'Walk-in'}>
                        {viewTarget.customer_name || 'Walk-in'}
                      </h2>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${hdrStatusColor}`}>
                        {hdrStatus}
                      </span>
                      {viewTarget.lead_type && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border bg-indigo-50 text-indigo-700 border-indigo-200 truncate max-w-[80px]" title={viewTarget.lead_type}>
                          {viewTarget.lead_type}
                        </span>
                      )}
                    </div>
                    <button onClick={() => setViewTarget(null)} className="shrink-0 p-1.5 hover:bg-gray-100 rounded-full"><X className="h-6 w-6 text-gray-400" /></button>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable content: Customer detail (scrolls) → sticky Tabs → Tab content */}
            <div className="flex-1 overflow-y-auto pb-20" {...viewTabSwipe}>
              {/* Customer detail card - clean grid layout */}
              {(() => {
                const notes = viewNotes[viewTarget.id] || [];
                const updates = notes.filter((n: any) => n.note_type === 'Update');
                const lastUpdate = updates[0] || null;
                const nextUpdate = updates.find((n: any) => n.next_update_date);

                const fields: { label: string; value: any; full?: boolean; href?: string }[] = [
                  { label: 'Type', value: viewTarget.lead_type },
                  { label: 'Person', value: viewTarget.contact_person },
                  { label: 'Mobile', value: viewTarget.mobile_no, href: viewTarget.mobile_no ? `tel:${viewTarget.mobile_no}` : undefined },
                  { label: 'Serial No.', value: viewTarget.serial_number },
                  { label: 'Flavour', value: viewTarget.flavor_name || viewTarget.flavor },
                  { label: 'Handler', value: viewTarget.taken_by || 'Unassigned' },
                  { label: 'Age', value: getTimeAgo(viewTarget.created_at) },
                  lastUpdate && { label: 'Last Update', value: new Date(lastUpdate.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
                  nextUpdate?.next_update_date && { label: 'Next Date', value: new Date(nextUpdate.next_update_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) },
                ].filter((f): f is { label: string; value: any; href?: string } => Boolean(f && f.value));

                return (
                  <div className="border-b border-gray-200 bg-white">
                    {/* Info grid - 2 columns, key : value inline */}
                    <div className="grid grid-cols-2">
                      {fields.filter(f => f.label !== 'Type').map((f, i) => (
                        <div key={i} className="flex items-baseline gap-1.5 border-b border-r border-gray-100 px-3 py-1 min-w-0 last:border-r-0 odd:border-r even:border-r-0">
                          <span className="text-[11px] font-semibold text-gray-500 shrink-0">{f.label}:</span>
                          {f.href ? (
                            <a href={f.href} className="text-[13px] font-bold text-gray-900 truncate min-w-0" title={String(f.value)}>{f.value}</a>
                          ) : (
                            <span className="text-[13px] font-bold text-gray-900 truncate min-w-0" title={String(f.value)}>{f.value}</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Remark - full width */}
                    {viewTarget.remark && (
                      <div className="bg-blue-50/70 border-t border-blue-100 px-3 py-1.5">
                        <span className="text-[11px] font-semibold text-blue-600 mr-1.5">Remark:</span>
                        <span className="text-[13px] text-gray-900 whitespace-pre-wrap">{viewTarget.remark}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Sticky Tabs - lock to top of scroll area as user scrolls */}
              <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm">
                {(['Requirement', 'Correction', 'Update'] as const).map(tab => (
                  <button key={tab} onClick={() => { setViewTab(tab); setShowAddForm(false); }}
                    className={`flex-1 py-3.5 text-sm font-semibold text-center transition-colors relative ${
                      viewTab === tab ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
                    }`}>
                    {tab}{tabCounts[tab] > 0 ? ` (${tabCounts[tab]})` : ''}
                    {viewTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="px-4 py-3">
              {viewNotesLoading === viewTarget.id ? (
                <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
              ) : viewTab === 'Requirement' ? (
                reqs.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-400">No requirements yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {reqs.map((req: any) => {
                      const isCompleted = req.status === 'Completed';
                      const isInProgress = req.status === 'In Progress';
                      const borderColor = isCompleted ? 'border-l-emerald-400' : isInProgress ? 'border-l-blue-500' : 'border-l-gray-300';
                      const isOverdue = req.deadline && !isCompleted && new Date(req.deadline) < new Date();

                      const refreshReqs = async () => {
                        const res = await leadRequirementsApi.getRequirements(viewTarget.id);
                        setViewReqs(prev => ({ ...prev, [viewTarget.id]: Array.isArray(res) ? res : res?.data || [] }));
                      };

                      return (
                        <div key={req.id} className={`border border-gray-200 border-l-4 ${borderColor} rounded-xl overflow-hidden ${isCompleted ? 'opacity-60' : ''}`}>
                          <div className="px-4 py-2.5">
                            {/* Row 1: Description + Priority */}
                            <div className="flex items-start justify-between gap-3">
                              <div className={`text-[16px] font-medium leading-snug flex-1 ${isCompleted ? 'line-through text-gray-400' : 'text-gray-900'}`}>{req.description}</div>
                              {req.priority && (
                                <span className="shrink-0 px-2 py-0.5 rounded-full text-[16px] font-bold uppercase bg-gray-100 text-gray-900">{req.priority}</span>
                              )}
                            </div>

                            {/* Row 2: Meta info */}
                            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[16px]">
                              {req.assigned_to && (
                                <span className="text-gray-900 font-medium">{req.assigned_to}</span>
                              )}
                              {req.deadline && (
                                <span className={isOverdue ? 'text-red-600 font-bold' : 'text-gray-500'}>
                                  {isOverdue ? 'Overdue: ' : 'Due: '}{new Date(req.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </span>
                              )}
                              {req.amount != null && req.amount !== '' && Number(req.amount) > 0 && (
                                <span className="text-emerald-700 font-bold">₹{Number(req.amount).toLocaleString('en-IN')}</span>
                              )}
                              {isCompleted && <span className="text-gray-900 font-medium">Done</span>}
                            </div>
                          </div>

                          {/* Action buttons */}
                          {!isCompleted && (
                            <div className="flex border-t border-gray-100">
                              <button onClick={async () => {
                                try { await leadRequirementsApi.updateRequirementStatus(req.id, 'Completed'); await refreshReqs(); } catch {}
                              }} className="flex-1 py-2 text-[16px] font-semibold text-emerald-600 bg-emerald-50/50 hover:bg-emerald-50 active:bg-emerald-100 transition-colors text-center">
                                Complete
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                (() => {
                  if (viewTab === 'Correction') {
                    const refreshNotes = async () => {
                      const res = await serviceCallsApi.getNotes(viewTarget.id);
                      const notes = res.success ? res.data : [];
                      setViewNotes(prev => ({ ...prev, [viewTarget.id]: notes }));
                    };
                    return correctionNotes.length === 0 ? (
                      <div className="py-8 text-center text-sm text-gray-400">No corrections yet</div>
                    ) : (
                      <div className="space-y-1.5">
                        {correctionNotes.map((note: any, idx: number) => {
                          const status = note.status || 'Pending';
                          const isCompleted = status === 'Completed';
                          const isInProgress = status === 'In Progress';
                          const borderColor = isCompleted ? 'border-l-emerald-400' : isInProgress ? 'border-l-blue-500' : 'border-l-amber-400';
                          const isOverdue = note.deadline && !isCompleted && new Date(note.deadline) < new Date();
                          return (
                            <div key={note.id || idx} className={`border border-gray-200 border-l-4 ${borderColor} rounded-xl overflow-hidden ${isCompleted ? 'opacity-60' : ''}`}>
                              <div className="px-4 py-2.5">
                                {/* Row 1: Description */}
                                <div className={`text-[16px] font-medium leading-snug ${isCompleted ? 'line-through text-gray-400' : 'text-gray-900'}`}>{note.content}</div>

                                {/* Row 2: Meta info */}
                                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[16px]">
                                  {note.assigned_to && (
                                    <span className="text-gray-900 font-medium">{note.assigned_to}</span>
                                  )}
                                  {note.deadline && (
                                    <span className={isOverdue ? 'text-red-600 font-bold' : 'text-gray-500'}>
                                      {isOverdue ? 'Overdue: ' : 'Due: '}{new Date(note.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                    </span>
                                  )}
                                  {isCompleted && <span className="text-gray-900 font-medium">Done</span>}
                                </div>
                              </div>

                              {/* Action buttons */}
                              {!isCompleted && (
                                <div className="flex border-t border-gray-100">
                                  <button onClick={async () => {
                                    try { await serviceCallsApi.updateNoteStatus(note.id, 'Completed'); await refreshNotes(); } catch {}
                                  }} className="flex-1 py-2 text-[16px] font-semibold text-emerald-600 bg-emerald-50/50 hover:bg-emerald-50 active:bg-emerald-100 transition-colors text-center">
                                    Complete
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  // Update tab
                  return updateNotes.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400">No updates yet</div>
                  ) : (
                    <div className="space-y-1.5">
                      {updateNotes.map((note: any, idx: number) => (
                        <div key={note.id || idx} className="border border-l-4 border-l-indigo-400 border-gray-200 rounded-xl px-4 py-2.5">
                          <div className="text-[16px] text-gray-900 leading-snug">{note.content}</div>
                          <div className="flex items-center gap-2 mt-1.5 text-[16px] flex-wrap">
                            <span className="text-gray-400">Updated By :</span>
                            <span className="text-gray-900 font-medium">{note.created_by}</span>
                            <span className="text-gray-300">|</span>
                            <span className="text-gray-400">When :</span>
                            <span className="text-gray-900">{new Date(note.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                            {note.next_update_date && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span className="text-gray-400">Next :</span>
                                <span className="text-gray-900 font-semibold">{new Date(note.next_update_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}

              </div>
            </div>

            {/* Floating Add Button */}
            <button onClick={() => { setShowAddForm(true); setNewNoteContent(''); setReqForm({ description: '', deadline: '', amount: '' }); }}
              className="absolute bottom-20 md:bottom-4 right-4 w-14 h-14 bg-gray-900 text-white rounded-full shadow-lg hover:bg-gray-800 active:scale-95 transition-all flex items-center justify-center z-10">
              <Plus className="h-6 w-6" />
            </button>

            {/* Add Popup Modal */}
            {showAddForm && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-end md:items-center justify-center" onClick={() => setShowAddForm(false)}>
                <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md md:mx-4" onClick={e => e.stopPropagation()}>
                  {/* Popup Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <h3 className="text-base font-bold text-gray-900">Add {viewTab}</h3>
                      <p className="text-sm text-gray-400 mt-0.5">{viewTarget.customer_name || 'Walk-in'}</p>
                    </div>
                    <button onClick={() => setShowAddForm(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X className="h-5 w-5 text-gray-400" /></button>
                  </div>

                  {/* Popup Body */}
                  <div className="p-5 space-y-4">
                    {viewTab === 'Requirement' ? (
                      <>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Description</label>
                          <textarea rows={3} value={reqForm.description} onChange={e => setReqForm(p => ({ ...p, description: e.target.value }))}
                            placeholder="What needs to be done?"
                            autoFocus
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 resize-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Deadline</label>
                            <input type="date" value={reqForm.deadline} onChange={e => setReqForm(p => ({ ...p, deadline: e.target.value }))}
                              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white" />
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Amount</label>
                            <input type="number" value={reqForm.amount} onChange={e => setReqForm(p => ({ ...p, amount: e.target.value }))}
                              placeholder="0.00"
                              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white" />
                          </div>
                        </div>
                      </>
                    ) : viewTab === 'Correction' ? (
                      <>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Correction Detail</label>
                          <textarea rows={3} value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)}
                            placeholder="Describe the correction..."
                            autoFocus
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 resize-none" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Deadline</label>
                          <input type="date" value={correctionDeadline} onChange={e => setCorrectionDeadline(e.target.value)}
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white" />
                        </div>
                      </>
                    ) : (
                      /* Update tab */
                      <>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Remark</label>
                          <textarea rows={3} value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)}
                            placeholder="What is this update about?"
                            autoFocus
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 resize-none" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Update Type</label>
                          <select value={updateStage} onChange={e => setUpdateStage(e.target.value)}
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 bg-white">
                            {['Pending', 'Quotation', 'Advance Pending', 'Implementation', 'Billing', 'Customization', 'Followup'].map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-500 uppercase mb-1.5">Next Update Date</label>
                          <input type="date" value={updateNextDate} onChange={e => setUpdateNextDate(e.target.value)}
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white" />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Popup Footer */}
                  <div className="flex gap-3 px-5 py-4 pb-20 md:pb-4 border-t border-gray-100">
                    <button onClick={() => setShowAddForm(false)} className="flex-1 py-3 text-sm font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                    <button onClick={handleViewAddNote} disabled={addNoteLoading || (viewTab === 'Requirement' ? !reqForm.description.trim() : !newNoteContent.trim())}
                      className="flex-1 py-3 text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl disabled:opacity-50 transition-colors shadow-sm">
                      {addNoteLoading ? 'Adding...' : `Add ${viewTab}`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ══ EDIT LEAD MODAL (Add Remark/Requirement only) ══ */}
      {showDetailsModal && detailsTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowDetailsModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Lead</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {detailsTarget.mobile_no} &bull; {detailsTarget.customer_name || 'Walk-in'} &bull; {detailsTarget.lead_type || 'N/A'}
                </p>
              </div>
              <button onClick={() => setShowDetailsModal(false)} className="p-1 hover:bg-gray-100 rounded-full"><X className="h-4 w-4 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-500 uppercase">Type:</span>
                {(['Remark', 'Requirement'] as const).map(t => (
                  <button key={t} onClick={() => setNewNoteType(t)}
                    className={`px-3 py-1 text-sm font-semibold rounded-md border transition-all ${
                      newNoteType === t
                        ? t === 'Requirement' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'text-gray-400 border-gray-200 hover:border-gray-300'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>

              {newNoteType === 'Remark' ? (
                <textarea rows={3} value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)}
                  placeholder="Add remark..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-100 resize-none"
                />
              ) : (
                <>
                  <textarea rows={2} value={reqForm.description} onChange={e => setReqForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="What needs to be done?"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Deadline</label>
                      <input type="date" value={reqForm.deadline} onChange={e => setReqForm(p => ({ ...p, deadline: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-500 uppercase mb-1">Amount</label>
                      <input type="number" value={reqForm.amount} onChange={e => setReqForm(p => ({ ...p, amount: e.target.value }))}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none" />
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end">
                <button onClick={handleAddNote} disabled={addNoteLoading || (newNoteType === 'Remark' ? !newNoteContent.trim() : !reqForm.description.trim())}
                  className="px-5 py-2 bg-purple-600 text-white text-xs font-semibold rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors shadow-sm">
                  {addNoteLoading ? 'Saving...' : newNoteType === 'Requirement' ? 'Add Requirement' : 'Add Remark'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Floating Mobile Add Button ── */}
      {canAdd && segment === 'pending' && (
        <button onClick={() => setShowAddModal(true)}
          className="md:hidden fixed bottom-24 right-6 z-40 w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 transition-colors flex items-center justify-center">
          <Plus className="h-6 w-6" />
        </button>
      )}
    </div>
  );
};

export default LeadReport;
