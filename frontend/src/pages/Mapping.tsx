import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, X, Search, ChevronDown, RefreshCw, Filter, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useData, Mapping, Server } from '../context/DataContext';
import PaginationControls from '../components/Shared/PaginationControls';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { formatDate, toLocalDateString } from '../utils/dateUtils';
import { calculateNextActivityConfig } from '../utils/renewalUtils';
import { activitiesApi, serversApi, customersApi, mappingsApi } from '../services/api';
import { useColumnPermissions } from '../hooks/useColumnPermissions';

const MappingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverIdParam, setServerIdParam] = useState(searchParams.get('server_id') || '');
  const { addMapping, updateMapping, deleteMapping, getServerById, getCustomerById, getUnmappedCustomers, isCustomerMapped, getLatestActivityByCustomerId, getTotalUsersByCustomerId, getTotalPurchaseUsersByCustomerId } = useData();
  // Note: statistics helpers like getTotalUsersByCustomerId rely on global activities which are now empty.
  // We might need to fetch these details from backend if they are zero.
  // Ideally, Mappings API should return these counts.

  const [localMappings, setLocalMappings] = useState<Mapping[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);

  const [localServers, setLocalServers] = useState<Server[]>([]);
  const [localCustomers, setLocalCustomers] = useState<any[]>([]);
  const [localActivities, setLocalActivities] = useState<any[]>([]);




  const { canCreate, canEdit, canDelete, canView, isAdmin } = useAuth();
  const { isVisible, cellStyle, onCellContextMenu } = useColumnPermissions('mappings');
  const { showSuccess, showError, showWarning } = useToast();

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  // Apply search function - only triggers when clicked or Enter pressed
  const applySearch = () => {
    setAppliedSearch(searchQuery);
    setPage(1);
  };

  // Clear search function
  const clearSearch = () => {
    setSearchQuery('');
    setAppliedSearch('');
    setPage(1);
  };

  // Handle Enter key in search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applySearch();
    }
  };

  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [serverSearch, setServerSearch] = useState('');
  const [showServerDropdown, setShowServerDropdown] = useState(false);
  const [form, setForm] = useState({
    server_id: '', customer_id: '', serial_no: '', status: 'Active' as Mapping['status']
  });

  // Advanced Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    status: 'all',
    billing_mode: 'all',
    billing_cycle: 'all',
    expiry_start: '',
    expiry_end: '',
    mapped_at_start: '',
    mapped_at_end: '',
    company: '',
    customer_ip: '',
    serial_no: '',
    min_rate: '',
    max_rate: ''
  });

  const filterConfig: FilterConfig[] = [
    { key: 'company', label: 'Company Name', type: 'text', placeholder: 'Search Company...' },
    { key: 'customer_ip', label: 'Customer IP', type: 'text', placeholder: 'Search IP...' },
    { key: 'serial_no', label: 'SOF No', type: 'text', placeholder: 'Search SOF No...' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }] },
    { key: 'billing_mode', label: 'Billing Mode', type: 'select', options: [{ value: 'day_to_day', label: 'Day to Day' }, { value: 'month_to_month', label: 'Month to Month' }] },
    { key: 'billing_cycle', label: 'Billing Cycle', type: 'select', options: [{ value: 'Monthly', label: 'Monthly' }, { value: 'Yearly', label: 'Yearly' }] },
    { key: 'min_rate', label: 'Min Rate', type: 'number', placeholder: 'Min ₹...' },
    { key: 'max_rate', label: 'Max Rate', type: 'number', placeholder: 'Max ₹...' },
    { key: 'mapped_at_start', label: 'Start From', type: 'date', className: 'col-span-1' },
    { key: 'mapped_at_end', label: 'Start To', type: 'date', className: 'col-span-1' },
    { key: 'expiry_start', label: 'Expiry From', type: 'date', className: 'col-span-1' },
    { key: 'expiry_end', label: 'Expiry To', type: 'date', className: 'col-span-1' },
  ];

  // Handle Export
  const handleExport = async () => {
    try {
      showSuccess('Exporting', 'Generating Excel file...');
      const { mappingsApi } = await import('../services/api');
      // Fetch ALL mappings (high limit) with current filters
      const res: any = await mappingsApi.getAll(1, 10000, undefined, appliedSearch, filters); 
      const allMappings: Mapping[] = res.data || [];

      // Format data for Excel
      const exportData = allMappings.map(m => {
        // Re-calculate derived values
        const legacyBInfo = getBillingInfo(m);
        const mappingRate = parseFloat(String((m as any).billing_rate || '0'));
        const bInfo = {
             expiry: (m as any).expiry_date || legacyBInfo.expiry,
             cycle: (m as any).billing_cycle || legacyBInfo.cycle,
             rate: mappingRate > 0 ? (m as any).billing_rate : legacyBInfo.rate
        };
        
        return {
          'Company': (m as any).customer_name,
          'Customer IP': (m as any).customer_ip || (m as any).server_ip,
          'Email': (m as any).customer_email,
          'Area': (m as any).customer_area,
          'Activation': '', // Not explicitly stored, maybe created_at?
          'Serial No': m.serial_no,
          'Billing Units': calcBillingUsersByMapping(m),
          'Expiry': bInfo.expiry ? formatDate(bInfo.expiry) : '',
          'Cycle': bInfo.cycle,
          'Rate': bInfo.rate,
          'Status': m.status,
          'Server': (m as any).server_ip, // Or server name
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mappings");
      XLSX.writeFile(wb, "Mappings.xlsx");
      
      showSuccess('Success', 'Export complete');
    } catch (err) {
      console.error(err);
      showError('Export Failed', 'Could not export mappings');
    }
  };

  // Selection mode for bulk renewal
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMappings, setSelectedMappings] = useState<Set<string>>(new Set());
  const [isRenewing, setIsRenewing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Selection handlers
  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectedMappings(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  const toggleMappingSelection = (mappingId: string) => {
    const newSelected = new Set(selectedMappings);
    if (newSelected.has(mappingId)) {
      newSelected.delete(mappingId);
    } else {
      newSelected.add(mappingId);
    }
    setSelectedMappings(newSelected);
  };

  const selectAllVisible = () => {
    const newSelected = new Set(filteredMappings.map(m => m.id));
    setSelectedMappings(newSelected);
  };

  const clearSelection = () => {
    setSelectedMappings(new Set());
  };

  // Bulk renewal handler
  const handleBulkRenewal = async () => {
    if (selectedMappings.size === 0) {
      showWarning('No Selection', 'Please select at least one mapping');
      return;
    }

    setIsRenewing(true);
    setProgress({ current: 0, total: 100 }); 

    try {
      const mappingIds = Array.from(selectedMappings);
      const activityDate = toLocalDateString();

      // Ensure API supports mappingIds (we updated backend to expect this)
      const res = await activitiesApi.bulkCustomerRenewal(mappingIds, activityDate);

      if (res.success) {
        const { created, skipped } = res.data;

        if (created.length > 0) {
          showSuccess('Renewal Complete', `Successfully created ${created.length} renewal activities.`);
        }

        if (skipped.length > 0) {
          const skippedMsg = skipped.map((s: any) => `${s.customer_name}: ${s.reason}`).join('\n');
          alert(`Skipped ${skipped.length} items:\n${skippedMsg}`);
        }

        setSelectedMappings(new Set());
        setSelectionMode(false);
        fetchMappings(); // Refresh
      } else {
        throw new Error(res.message || 'Bulk renewal failed');
      }
    } catch (err: any) {
      showError('Error', err.message || 'Failed to process bulk renewal');
    } finally {
      setIsRenewing(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const canAdd = canCreate('mappings');
  const canEditMapping = canEdit('mappings');
  const canDel = canDelete('mappings');
  const unmapped = getUnmappedCustomers();

  // Fetch Mappings
  const fetchMappings = async () => {
    setLoading(true);
    try {
      // Use static mappingApi
      const res: any = await mappingsApi.getAll(page, limit, serverIdParam || undefined, appliedSearch, filters);
      setLocalMappings(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      showError('Error', 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Activities for B.U./P.U. calculations
  const fetchActivities = async () => {
    // Only fetch if empty or if needed - avoiding runaway loop
    if (localActivities.length > 0) return; 
    
    try {
      const res = await activitiesApi.getAll({}, 1, 1000); 
      setLocalActivities(res.data || []);
    } catch (err: any) {
      console.error('Activities fetch error:', err);
    }
  };

  // Local helper: Calculate Billing Units for a customer
  // Logic: Find the last New/Renewal activity to establish base units, 
  // then add all User activity changes that occurred after that base activity.
  // Local helper: Calculate Billing Units for a Mapping (Server Specific)
  const calcBillingUsersByMapping = (mapping: Mapping): number => {
    const custIp = String((mapping as any).customer_ip || '').toLowerCase();
    const srvIp = String((mapping as any).server_ip || '').toLowerCase();
    const custId = String(mapping.customer_id);

    const relevantActivities = localActivities
      .filter(a => {
        if (!a || a.record_nature !== 'Sales') return false;

        // Check if Activity belongs to this Customer (ID, customer_domain_ip, or Name)
        const actCustName = String(a.customer_name || '').toLowerCase();
        const mapCustName = String((mapping as any).customer_name || '').toLowerCase();
        const actCustDomainIp = String(a.customer_domain_ip || '');

        const matchesCustomer =
          (String(a.customer_id) === custId) ||
          (actCustDomainIp === custId) ||
          (actCustName && mapCustName && actCustName === mapCustName);

        if (!matchesCustomer) return false;

        // Check matching Server: activity.server_name should match mapping's customer_ip or server_ip
        const actSrv = String(a.server_name || '').toLowerCase();
        if (!actSrv) return false;

        const matchesServer =
          actSrv === custIp ||
          actSrv === srvIp ||
          custIp.includes(actSrv) ||
          actSrv.includes(custIp);

        return matchesServer;
      })
      .sort((a, b) => a.activity_date.localeCompare(b.activity_date));

    if (relevantActivities.length === 0) return 0;

    // Find the last New or Renewal activity
    const baseActivities = relevantActivities.filter(a => a.activity_type === 'New' || a.activity_type === 'Renewal');
    const lastBase = baseActivities.length > 0 ? baseActivities[baseActivities.length - 1] : null;

    let baseUnits = 0;
    let baseDate = '';

    if (lastBase) {
      baseUnits = Number(lastBase.billing_units) || 0;
      baseDate = lastBase.activity_date || '';
    }

    // Sum all User activities that occurred ON or AFTER the base
    const userChanges = relevantActivities
      .filter(a => a.activity_type === 'User' && a.activity_date >= baseDate)
      .reduce((sum, a) => sum + (Number(a.billing_units) || 0), 0);

    return baseUnits + userChanges;
  };

  // Local helper: Calculate Purchase Units for a customer
  // Logic: Find the last New/Renewal activity to establish base units, 
  // then add all User activity changes that occurred after that base activity.
  const calcPurchaseUsers = (customerId: string): number => {
    const cid = String(customerId);
    const customerActivities = localActivities
      .filter(a => a && (String(a.customer_domain_ip) === cid || String(a.customer_id) === cid) && a.record_nature === 'Purchase')
      .sort((a, b) => a.activity_date.localeCompare(b.activity_date));

    if (customerActivities.length === 0) return 0;

    // Find the last New or Renewal activity (this establishes the base)
    const baseActivities = customerActivities.filter(a => a.activity_type === 'New' || a.activity_type === 'Renewal');
    const lastBase = baseActivities.length > 0 ? baseActivities[baseActivities.length - 1] : null;

    let baseUnits = 0;
    let baseDate = '';

    if (lastBase) {
      baseUnits = Number(lastBase.purchase_units) || 0;
      baseDate = lastBase.activity_date || '';
    }

    // Sum all User activities that occurred ON or AFTER the base activity date
    const userChanges = customerActivities
      .filter(a => a.activity_type === 'User' && a.activity_date >= baseDate)
      .reduce((sum, a) => sum + (Number(a.purchase_units) || 0), 0);

    return baseUnits + userChanges;
  };

  // Local helper: Calculate Purchase Units for a server by looking up matching activities
  const calcPurchaseUsersByServerId = (serverId: string): number => {
    const server = localServers.find(s => s.id === serverId);
    if (!server) return 0;

    const custIp = String(server.customer_ip || '');
    const srvIp = String(server.server_ip || '');

    const serverActivities = localActivities
      .filter(a => a && a.record_nature === 'Purchase' && (String(a.server_name) === custIp || String(a.server_name) === srvIp))
      .sort((a, b) => a.activity_date.localeCompare(b.activity_date));

    if (serverActivities.length === 0) return 0;

    // Find the last New or Renewal activity (this establishes the base)
    const baseActivities = serverActivities.filter(a => a.activity_type === 'New' || a.activity_type === 'Renewal');
    const lastBase = baseActivities.length > 0 ? baseActivities[baseActivities.length - 1] : null;

    let baseUnits = 0;
    let baseDate = '';

    if (lastBase) {
      baseUnits = Number(lastBase.purchase_units) || 0;
      baseDate = lastBase.activity_date || '';
    }

    // Sum all User activities that occurred ON or AFTER the base activity date
    const userChanges = serverActivities
      .filter(a => a.activity_type === 'User' && a.activity_date >= baseDate)
      .reduce((sum, a) => sum + (Number(a.purchase_units) || 0), 0);

    return baseUnits + userChanges;
  };

  // Local helper: Get latest Billing info (Expiry, Cycle, Rate)
  // Local helper: Get latest Billing info (Expiry, Cycle, Rate) for a Mapping
  const getBillingInfo = (mapping: Mapping) => {
    const custIp = String((mapping as any).customer_ip || '').toLowerCase();
    const srvIp = String((mapping as any).server_ip || '').toLowerCase();
    const custId = String(mapping.customer_id);

    // Find latest New/Renewal Sales activity for this customer + server
    const billingActivity = localActivities
      .filter(a => {
        if (!a || a.record_nature !== 'Sales') return false;
        if (a.activity_type !== 'New' && a.activity_type !== 'Renewal') return false;

        // Match customer by ID, customer_domain_ip, or name
        const actCustDomainIp = String(a.customer_domain_ip || '');
        const matchesCustomer =
          (String(a.customer_id) === custId) ||
          (actCustDomainIp === custId) ||
          (String(a.customer_name || '').toLowerCase() === String((mapping as any).customer_name || '').toLowerCase());

        if (!matchesCustomer) return false;

        // Match server: activity.server_name should match mapping's customer_ip or server_ip
        const actSrv = String(a.server_name || '').toLowerCase();
        if (!actSrv) return false;

        const matchesServer =
          actSrv === custIp ||
          actSrv === srvIp ||
          custIp.includes(actSrv) ||
          actSrv.includes(custIp);

        return matchesServer;
      })
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date))[0];

    // DEBUG: Logs removed for production
    // if (custIp.includes('22109') || srvIp.includes('22109')) { ... }

    return {
      expiry: billingActivity?.new_expiry_date,
      cycle: billingActivity?.billing_cycle,
      rate: billingActivity?.last_bill_rate || billingActivity?.purchase_rate || billingActivity?.billing_rate || 0
    };
  };

  useEffect(() => {
    const fromUrl = searchParams.get('server_id') || '';
    if (fromUrl !== serverIdParam) {
      setServerIdParam(fromUrl);
      setPage(1);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchMappings();
    if (canView('activities')) fetchActivities();
  }, [page, appliedSearch, filters, serverIdParam]);

  // Search servers when user types 3+ characters
  useEffect(() => {
    if (serverSearch.length < 4) {
      setLocalServers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        // Use search parameter to fetch matching servers
        const res = await serversApi.search(serverSearch);
        setLocalServers(res.data || []);
      } catch (err) {
        console.error('Failed to search servers:', err);
      }
    }, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [serverSearch]);

  // Search customers when user types 2+ characters
  useEffect(() => {
    if (customerSearch.length < 4) {
      setLocalCustomers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await customersApi.search(customerSearch);
        setLocalCustomers(res.data || []);
      } catch (err) {
        console.error('Failed to search customers:', err);
      }
    }, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const filteredMappings = localMappings; // Backend handles filtering ideally, or we accept we only see page.

  const openAdd = () => {
    setEditing(null);
    setForm({ server_id: '', customer_id: '', serial_no: '', status: 'Active' });
    setCustomerSearch('');
    setServerSearch('');
    setShowModal(true);
  };

  const openEditMapping = (m: Mapping) => {
    setEditing(m);
    setForm({ ...m });
    // Use joined data from mapping object instead of context lookup
    setCustomerSearch((m as any).customer_name || '');
    setServerSearch((m as any).customer_ip || (m as any).server_ip || '');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.server_id || !form.customer_id || !form.serial_no) {
      showError('Error', 'All fields required');
      return;
    }
    try {
      const { mappingsApi } = await import('../services/api');
      if (editing) {
        await mappingsApi.update(editing.id, form);
        showSuccess('Updated', 'Mapping updated');
      } else {
        await mappingsApi.create(form);
        showSuccess('Added', 'Mapping created');
      }
      setShowModal(false);
      fetchMappings(); // Refresh
    } catch (err: any) {
      showError('Error', err.message || 'Failed to save mapping');
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMapping(deleteId);
      showSuccess('Deleted', 'Mapping removed');
      await fetchMappings(); // Refresh table data
    } catch (err: any) {
      showError('Error', err.message || 'Failed to delete mapping');
    } finally {
      setDeleteId(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  // Use localCustomers from API search results
  // When editing, include the current customer even if not in search results
  const availableCustomers = editing
    ? [...localCustomers, localCustomers.find((c: any) => c.id === editing.customer_id)].filter((c, i, arr) => c && arr.findIndex((x: any) => x?.id === c?.id) === i)
    : localCustomers;

  // No need for additional filtering - API already searched
  const filteredAvailableCustomers = availableCustomers.filter((c: any) => c);

  const handleCustomerSelect = (customerId: string) => {
    const customer = localCustomers.find((c: any) => c.id === customerId);
    if (customer) {
      setForm(prev => ({ ...prev, customer_id: customerId }));
      setCustomerSearch(customer.company);
      setShowCustomerDropdown(false);
    }
  };

  const handleCustomerClick = (customerId: string) => {
    if (!customerId) return;
    navigate(`/cloud/activity/billing?customer_id=${customerId}`);
  };

  const handleServerClick = (ip: string) => {
    // Plain text now, function kept for internal consistency if needed or removed
    return;
  };

  const activeServers = localServers.filter((s: Server) => s.status === 'Active');
  const filteredServers = activeServers.filter((s: Server) =>
  (s.company?.toLowerCase().includes(serverSearch.toLowerCase()) ||
    s.customer_ip?.toLowerCase().includes(serverSearch.toLowerCase()) ||
    s.server_ip.toLowerCase().includes(serverSearch.toLowerCase()))
  );

  const handleServerSelect = (serverId: string) => {
    const server = localServers.find((s: Server) => s.id === serverId);
    if (server) {
      setForm(prev => ({ ...prev, server_id: serverId }));
      setServerSearch(server.customer_ip || server.server_ip);
      setShowServerDropdown(false);
    }
  };

  const totalUsersInMappings = 0; // Stats disabled for pagination
  const avgRate = 0;

  return (
    <div className="w-full space-y-4 pb-16 md:pb-0 px-2">
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900 w-full md:w-auto">Mappings</h1>

        <div className="flex gap-2 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-1 md:w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search (Enter)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none h-10"
            />
          </div>
          {appliedSearch && (
            <button
              onClick={clearSearch}
              className="px-2 h-10 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 flex items-center justify-center transition-colors"
              title="Clear Search"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowFilters(true)}
              className={`flex items-center justify-center gap-2 px-3 h-10 border rounded-lg hover:bg-gray-50 transition-colors shadow-sm ${Object.values(filters).some(f => f && f !== 'all') ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white text-gray-700'}`}
              title="Filters"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden lg:inline">Filters</span>
            </button>

            {canView('mappings') && (
              <button
                onClick={handleExport}
                className="flex items-center justify-center gap-2 px-3 h-10 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                title="Export"
              >
                <Download className="h-4 w-4" />
                <span className="hidden lg:inline">Export</span>
              </button>
            )}

            <div className="w-px h-6 bg-gray-200 mx-1 hidden md:block" />

            {selectionMode ? (
              <div className="flex gap-2">
                {selectedMappings.size > 0 && canCreate('activities') && (
                  <button
                    onClick={handleBulkRenewal}
                    disabled={isRenewing}
                    className="flex items-center justify-center gap-2 px-4 h-10 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRenewing ? 'animate-spin' : ''}`} />
                    <span>Renew ({selectedMappings.size})</span>
                  </button>
                )}
                <button
                  onClick={toggleSelectionMode}
                  className="px-4 h-10 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center"
                >
                  <span className="hidden md:inline">Cancel</span>
                  <X className="h-4 w-4 md:hidden" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {canCreate('activities') && (
                <button
                  onClick={toggleSelectionMode}
                  className="flex items-center justify-center gap-2 px-3 h-10 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  title="Bulk Renewal"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span className="hidden lg:inline">Bulk Renewal</span>
                </button>
                )}
                {canAdd && (
                  <button
                    onClick={openAdd}
                    className="flex items-center justify-center gap-2 px-3 h-10 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                    title="Add Mapping"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden lg:inline">Add Mapping</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tags / Chips */}
      {Object.entries(filters).some(([_, v]) => v && v !== '' && v !== 'all') && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider ml-1">Active Filters:</span>
          {Object.entries(filters).map(([key, value]) => {
            if (!value || value === '' || value === 'all') return null;
            
            // Format labels
            const labelMap: any = {
              status: 'Status',
              billing_mode: 'Mode',
              billing_cycle: 'Cycle',
              expiry_start: 'Expiry From',
              expiry_end: 'Expiry To',
              mapped_at_start: 'Start From',
              mapped_at_end: 'Start To',
              company: 'Company',
              customer_ip: 'IP',
              serial_no: 'SOF No',
              min_rate: 'Min ₹',
              max_rate: 'Max ₹'
            };

            return (
              <div key={key} className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-2.5 py-1 rounded-full text-xs font-medium shadow-sm">
                <span className="text-gray-400">{labelMap[key] || key}:</span>
                <span>{value}</span>
                <button 
                  onClick={() => {
                    const newFilters = { ...filters, [key]: (key === 'status' || key === 'billing_mode' || key === 'billing_cycle') ? 'all' : '' };
                    setFilters(newFilters);
                    setPage(1);
                  }} 
                  className="hover:bg-gray-100 rounded-full p-0.5 ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
            setFilters({
                status: 'all', billing_mode: 'all', billing_cycle: 'all',
                expiry_start: '', expiry_end: '', mapped_at_start: '', mapped_at_end: '',
                company: '', customer_ip: '', serial_no: '', min_rate: '', max_rate: ''
              });
              setServerIdParam(''); // Clear server filter
              setPage(1);
            }}
            className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded-lg transition-colors ml-1"
          >
            Clear All
          </button>
        </div>
      )}

      {serverIdParam && !Object.entries(filters).some(([_, v]) => v && v !== '' && v !== 'all') && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider ml-1">Filtered by Server ID: {serverIdParam}</span>
          <button
            onClick={() => { setServerIdParam(''); setPage(1); }}
            className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded-lg transition-colors ml-auto"
          >
            Clear Server Filter
          </button>
        </div>
      )}

      <PaginationControls
        currentPage={page}
        totalPages={Math.ceil(total / limit)}
        onPageChange={setPage}
        loading={loading}
        totalItems={total}
        itemsPerPage={limit}
        className="rounded-t-xl border-x border-t"
      />

      {/* Filter Modal */}
      <FilterModal
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        config={filterConfig}
        currentFilters={filters}
        onApply={(newFilters: any) => { 
          console.log('[MappingPage] Applying Filters:', newFilters);
          // Sanitize 'all' values
          const sanitized: any = {};
          for (const [key, value] of Object.entries(newFilters)) {
            const v = value as string;
            sanitized[key] = (v === 'all' || v === 'All') ? '' : v;
          }
          setFilters(prev => ({ ...prev, ...sanitized })); 
          setPage(1); 
        }}
        onReset={() => { 
          console.log('[MappingPage] Resetting Filters');
          setFilters({ 
            status: 'all', 
            billing_mode: 'all', 
            billing_cycle: 'all', 
            expiry_start: '', 
            expiry_end: '',
            mapped_at_start: '',
            mapped_at_end: '',
            company: '',
            customer_ip: '',
            serial_no: '',
            min_rate: '',
            max_rate: ''
          }); 
          setPage(1); 
          setShowFilters(false);
        }}
      />

      {/* Mobile Cards (Simplified Grid Layout) */}
      <div className="space-y-3 md:hidden">
        {filteredMappings.map(m => {
          // Use joined data from mapping object - backend returns customer_name, customer_ip, server_ip, etc.
          const server = { customer_ip: (m as any).customer_ip, server_ip: (m as any).server_ip };
          const customer = { company: (m as any).customer_name, email: (m as any).customer_email, area: (m as any).customer_area };
          
          const legacyBInfo = getBillingInfo(m);
          const mappingRate = parseFloat(String((m as any).billing_rate || '0'));
          
          const bInfo = {
               expiry: (m as any).expiry_date || legacyBInfo.expiry,
               cycle: (m as any).billing_cycle || legacyBInfo.cycle,
               rate: mappingRate > 0 ? (m as any).billing_rate : legacyBInfo.rate
          };

          const isSelected = selectedMappings.has(m.id);
          const bu = calcBillingUsersByMapping(m);

          return (
            <div key={m.id} className={`bg-white rounded-lg border overflow-hidden ${isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'}`}>

              {/* Row 1: Customer Name + B.U + Edit */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleMappingSelection(m.id)}
                    className="w-5 h-5 rounded border-gray-300 accent-blue-600 flex-shrink-0"
                  />
                )}
                <span
                  className="font-bold text-gray-900 text-base truncate cursor-pointer hover:text-blue-600 active:text-blue-800"
                  onClick={(e) => { e.stopPropagation(); handleCustomerClick(m.customer_id); }}
                >
                  {customer?.company || '-'}
                </span>
                <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                  <span className="font-bold text-blue-600 text-lg" title="Billing Units">{bu}</span>
                  {canEditMapping && !selectionMode && (
                    <button onClick={(e) => { e.stopPropagation(); openEditMapping(m); }} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-bold uppercase transition-colors">
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Customer IP | Cycle */}
              <div className="flex items-center px-3 py-2 text-sm border-b border-gray-50">
                <span className="text-gray-500">IP :</span>
                <span className="font-semibold text-gray-900 ml-1 truncate">{server?.customer_ip || server?.server_ip || '—'}</span>
                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                <span className="text-gray-500 flex-shrink-0">Cycle :</span>
                <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{(m as any).effective_cycle || bInfo.cycle || '—'}</span>
              </div>

              {/* Row 3: Expiry | Rate */}
              <div className="flex items-center px-3 py-2 text-sm">
                <span className="text-gray-500">Expiry :</span>
                <span className="font-semibold text-gray-900 ml-1">{formatDate((m as any).effective_expiry || bInfo.expiry)}</span>
                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                <span className="text-gray-500 flex-shrink-0">Rate :</span>
                <span className="font-semibold text-green-700 ml-1 flex-shrink-0">₹{(m as any).effective_rate || bInfo.rate}</span>
              </div>
            </div>
          );
        })}
        {filteredMappings.length === 0 && (
          <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
            {loading ? 'Loading...' : 'No mappings found.'}
          </div>
        )}
      </div>

      {/* Desktop Table - Basic Format with Borders */}
      <div className="hidden md:block overflow-x-auto border border-gray-300 rounded shadow-sm">
        <table className="w-full text-sm border-collapse table-fixed">
          <colgroup>
            {selectionMode && <col className="w-[35px]" />}
            <col className="w-[15%]" />
            <col className="w-[12%]" />
            <col className="w-[15%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[5%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[8%]" />
            {!selectionMode && <col className="w-[8%]" />}
          </colgroup>
          <thead>
            <tr className="bg-gray-100">
              {selectionMode && (
                <th className="text-center px-2 py-2 border border-gray-300">
                  <input
                    type="checkbox"
                    checked={selectedMappings.size === filteredMappings.length && filteredMappings.length > 0}
                    onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                </th>
              )}
              {isVisible('company') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Company</th>}
              {isVisible('customer_ip') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Customer IP</th>}
              {isVisible('email') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Email</th>}
              {isVisible('activation') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Activation</th>}
              {isVisible('serial_no') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Serial No</th>}
              {isVisible('bu') && <th className="px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-center text-xs">B.U.</th>}
              {isVisible('expiry') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Expiry</th>}
              {isVisible('cycle') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Cycle</th>}
              {isVisible('rate') && <th className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Rate</th>}
              {!selectionMode && (canEditMapping || canDel) && <th className="text-center px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredMappings.map((m) => {
              // Use joined data from mapping object - backend returns customer_name, customer_ip, server_ip, etc.
              const server = { customer_ip: (m as any).customer_ip, server_ip: (m as any).server_ip };
              const customer = { company: (m as any).customer_name, email: (m as any).customer_email, area: (m as any).customer_area };
              
              // Fix Content Precedence: Backend provides 'effective' fields with all fallbacks
              const legacyBInfo = getBillingInfo(m);
              const mappingRate = parseFloat(String((m as any).effective_rate !== undefined ? (m as any).effective_rate : (m as any).billing_rate || '0'));
              
              const bInfo = {
                  expiry: (m as any).effective_expiry || (m as any).expiry_date || legacyBInfo.expiry,
                  cycle: (m as any).effective_cycle || (m as any).billing_cycle || legacyBInfo.cycle,
                  rate: mappingRate > 0 ? mappingRate : legacyBInfo.rate
              };
              
              const isSelected = selectedMappings.has(m.id);
              return (
                <tr
                  key={m.id}
                  className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                  onClick={() => selectionMode && toggleMappingSelection(m.id)}
                >
                  {selectionMode && (
                    <td className="px-2 py-2 text-center border border-gray-300" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMappingSelection(m.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </td>
                  )}
                  {/* Use data from mapping object directly - backend joins customer/server details */}
                  {isVisible('company') && <td
                    className="px-2 py-1.5 border border-gray-300 font-medium truncate cursor-pointer hover:text-blue-600 hover:bg-gray-100 text-xs"
                    style={cellStyle('company')}
                    onContextMenu={onCellContextMenu('company')}
                    onClick={(e) => { e.stopPropagation(); handleCustomerClick(m.customer_id); }}
                  >
                    {(m as any).customer_name || customer?.company || '-'}
                  </td>}
                  {isVisible('customer_ip') && <td className="px-2 py-1.5 border border-gray-300 text-xs truncate" style={cellStyle('customer_ip')} onContextMenu={onCellContextMenu('customer_ip')}>
                    {(m as any).customer_ip || server?.customer_ip || '-'}
                  </td>}
                  {isVisible('email') && <td className="px-2 py-1.5 border border-gray-300 truncate text-xs" style={cellStyle('email')} onContextMenu={onCellContextMenu('email')} title={(m as any).customer_email || ''}>{(m as any).customer_email || customer?.email || '-'}</td>}
                  {/* Area removed */}
                  {isVisible('activation') && <td className="px-2 py-1.5 border border-gray-300 text-xs" style={cellStyle('activation')} onContextMenu={onCellContextMenu('activation')}>{formatDate(m.mapped_at)}</td>}
                  {isVisible('serial_no') && <td className="px-2 py-1.5 border border-gray-300 truncate text-xs" style={cellStyle('serial_no')} onContextMenu={onCellContextMenu('serial_no')}>{m.serial_no || '-'}</td>}
                  {isVisible('bu') && <td className="px-2 py-1.5 border border-gray-300 text-center font-semibold text-blue-600 text-xs" style={cellStyle('bu')} onContextMenu={onCellContextMenu('bu')}>{calcBillingUsersByMapping(m)}</td>}
                  {/* PU removed */}
                  {isVisible('expiry') && <td className="px-2 py-1.5 border border-gray-300 text-xs" style={cellStyle('expiry')} onContextMenu={onCellContextMenu('expiry')}>{formatDate(bInfo.expiry)}</td>}
                  {isVisible('cycle') && <td className="px-2 py-1.5 border border-gray-300 text-xs truncate" style={cellStyle('cycle')} onContextMenu={onCellContextMenu('cycle')}>{bInfo.cycle || '-'}</td>}
                  {isVisible('rate') && <td className="px-2 py-1.5 border border-gray-300 text-xs" style={cellStyle('rate')} onContextMenu={onCellContextMenu('rate')}>₹{bInfo.rate}</td>}
                  {!selectionMode && (canEditMapping || canDel) && (
                    <td className="px-2 py-1.5 border border-gray-300">
                      <div className="flex items-center justify-center gap-2">
                        {canEditMapping && (
                          <button onClick={(e) => { e.stopPropagation(); openEditMapping(m); }} className="text-blue-600 hover:text-blue-800">
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {canDel && (
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }} className="text-red-600 hover:text-red-800">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {filteredMappings.length === 0 && (
              <tr>
                <td colSpan={selectionMode ? 13 : 12} className="px-3 py-8 text-center text-gray-500 border border-gray-300">
                  {loading ? 'Loading...' : 'No mappings found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>



      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {editing ? 'Edit Mapping' : 'Add Mapping'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <div className="space-y-4">
                {/* Server Search */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer IP <span className="text-gray-400">*</span></label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={serverSearch}
                      onChange={e => {
                        setServerSearch(e.target.value);
                        setShowServerDropdown(true);
                        if (!e.target.value) {
                          setForm(prev => ({ ...prev, server_id: '' }));
                        }
                      }}
                      onFocus={() => setShowServerDropdown(true)}
                      placeholder="Type 3+ chars to search..."
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
                    />
                  </div>
                  {showServerDropdown && serverSearch && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredServers.length > 0 ? (
                        filteredServers.slice(0, 10).map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleServerSelect(s.id)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b last:border-b-0"
                          >
                            <div className="font-medium text-sm text-gray-900">{s.customer_ip || s.server_ip}</div>
                            <div className="text-xs text-gray-500">{s.company || s.server_ip}</div>
                          </button>
                        ))
                      ) : serverSearch.length < 3 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">Type at least 3 characters...</div>
                      ) : (
                        <div className="px-3 py-2 text-sm text-gray-500">No servers found for "{serverSearch}"</div>
                      )}
                    </div>
                  )}
                  {form.server_id && (
                    <p className="text-xs text-green-600 mt-1 font-medium">✓ Selected: {serverSearch}</p>
                  )}
                </div>

                {/* Customer Search */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-gray-400">*</span></label>
                  {editing ? (
                    <>
                      <input
                        value={customerSearch}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                      />
                      <p className="text-xs text-gray-400 mt-1 italic">Cannot change customer of an existing mapping</p>
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          value={customerSearch}
                          onChange={e => {
                            setCustomerSearch(e.target.value);
                            setShowCustomerDropdown(true);
                            if (!e.target.value) {
                              setForm(prev => ({ ...prev, customer_id: '' }));
                            }
                          }}
                          onFocus={() => setShowCustomerDropdown(true)}
                          placeholder="Type 3+ chars to search..."
                          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
                        />
                      </div>
                      {showCustomerDropdown && customerSearch && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredAvailableCustomers.length > 0 ? (
                            filteredAvailableCustomers.slice(0, 10).map(c => c && (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleCustomerSelect(c.id)}
                                className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b last:border-b-0"
                              >
                                <div className="font-medium text-sm text-gray-900">{c.company || 'Unknown'}</div>
                                <div className="text-xs text-gray-500">ID: {c.id}</div>
                              </button>
                            ))
                          ) : customerSearch.length < 2 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">Type at least 2 characters...</div>
                          ) : (
                            <div className="px-3 py-2 text-sm text-gray-500">No customers found for "{customerSearch}"</div>
                          )}
                        </div>
                      )}
                      {form.customer_id && (
                        <p className="text-xs text-green-600 mt-1 font-medium">✓ Selected: {customerSearch}</p>
                      )}
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Serial No */}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Serial No *</label>
                    <input
                      value={form.serial_no}
                      onChange={e => setForm({ ...form, serial_no: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
                      placeholder="SN-001"
                    />
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Status</label>
                    <div className="relative">
                      <select
                        value={form.status}
                        onChange={e => setForm({ ...form, status: e.target.value as Mapping['status'] })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none appearance-none bg-white"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 mt-auto">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 bg-gray-50 text-gray-700 font-medium rounded-lg text-sm hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 bg-red-600 text-white font-medium rounded-lg text-sm hover:bg-red-700 transition-colors shadow-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <Trash2 className="h-6 w-6" />
                <h3 className="text-lg font-bold">Delete Mapping?</h3>
              </div>
              <p className="text-gray-600 mb-6">Are you sure you want to delete this mapping? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteId(null)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors font-medium shadow-sm"
                >
                  Delete Mapping
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bulk Renewal Progress Modal */}
      {isRenewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 transform transition-all animate-in fade-in zoom-in-95">
            <div className="flex flex-col items-center">
              <RefreshCw className="h-10 w-10 text-blue-500 animate-spin mb-4" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">Bulk Renewal In Progress</h3>
              <p className="text-gray-500 text-sm mb-6 text-center">
                Processing customer {progress.current} of {progress.total}
              </p>

              <div className="w-full bg-gray-100 rounded-full h-2.5 mb-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
              <div className="text-xs text-right w-full text-gray-400 font-medium">
                {Math.round((progress.current / progress.total) * 100)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MappingPage;
