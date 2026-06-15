import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Eye, EyeOff, Search, Server, ChevronDown, RefreshCw, Copy, Filter, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useData, Server as ServerType } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { activitiesApi, serversApi } from '../services/api';
import PaginationControls from '../components/Shared/PaginationControls';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';
import { formatDate, toLocalDateString } from '../utils/dateUtils';
import { calculateNextActivityConfig } from '../utils/renewalUtils';
import { useColumnPermissions } from '../hooks/useColumnPermissions';

const Servers: React.FC = () => {
  const { getMappingsByServer, getTotalPurchaseUsersByServerId } = useData(); // Keep helpers if they rely on other data logic, but check if they work without global servers?
  // getMappingsByServer relies on mappings context. Mappings context is also empty now.
  // We need to fetch mappings count per server? 
  // The backend `findAll` for servers ALREADY returns `customer_count`. So we don't need `getMappingsByServer` for the count!
  // Same for `getTotalPurchaseUsersByServerId`? We might need to implement that logic in backend or fetch it.
  // Actually, let's look at `ServersService.findAll`: It returns `customer_count`.
  // It does NOT seem to return purchase units (P.U.). `getTotalPurchaseUsersByServerId` in context likely maps over activities.
  // If we want P.U. in the list, we might need a dedicated endpoint or include it in `findAll`.
  // For now, let's focus on the basic list and pagination.

  const { canCreate, canEdit, canDelete, canView, isAdmin } = useAuth();
  const { isVisible, cellStyle, onCellContextMenu } = useColumnPermissions('servers');
  const { showSuccess, showError, showWarning } = useToast();

  const [localServers, setLocalServers] = useState<ServerType[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ServerType | null>(null);
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  // Filter popup state
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  
  // Applied filters - these actually filter the data (only updated on Apply click)
  const [appliedFilters, setAppliedFilters] = useState({
    company: '',
    status: '',
    port: '',
    serverIp: '',
    customerIp: '',
    adminUser: '',
    billing_mode: '',
    billing_cycle: '',
    expiry_start: '',
    expiry_end: '',
    searchText: ''
  });
  
  // Pending filters state removed (handled internally by FilterModal)
  
  // Open filter popup
  const openFilterPopup = () => {
    setShowFilterPopup(true);
  };

  // Apply search function - only triggers backend call when clicked
  const applySearch = () => {
    setAppliedSearch(searchQuery);
    setPage(1);
  };

  // Clear search function
  const clearSearch = () => {
    setSearchQuery('');
    setAppliedSearch('');
    setAppliedFilters(prev => ({ ...prev, searchText: '' }));
    setPage(1);
  };

  // Handle Enter key in search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applySearch();
    }
  };

  // Handle Export
  const handleExport = async () => {
    try {
      showSuccess('Exporting', 'Generating Excel file...');
      // Static import used
      // Fetch ALL servers (high limit)
      const res: any = await serversApi.getAll(1, 10000, appliedSearch); 
      const allServers: ServerType[] = res.data || [];

      // Format data for Excel
      const exportData = allServers.map(s => ({
        'Server IP': s.server_ip,
        'SOF No': s.sof_no,
        'Company': s.company,
        'Port': s.port,
        'Customer IP': s.customer_ip,
        'Admin Username': s.admin_username,
        'Admin Password': s.admin_password, // Consider if passwords should be exported? Usually yes for Admin backup.
        'Status': s.status,
        'Billing Mode': s.billing_mode,
        'Billing Cycle': s.billing_cycle,
        'Expiry': s.server_expiry ? formatDate(s.server_expiry) : '',
        'Purchase Rate': s.purchase_rate,
        'Mapped Customers': s.customer_count || 0
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Servers");
      XLSX.writeFile(wb, "Servers.xlsx");
      
      showSuccess('Success', 'Export complete');
    } catch (err) {
      console.error(err);
      showError('Export Failed', 'Could not export servers');
    }
  };

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const [form, setForm] = useState({
    server_ip: '', sof_no: '', port: '', customer_ip: '', admin_username: '', admin_password: '',
    status: 'Active' as ServerType['status'], company: '', purchase_rate: 0,
    billing_mode: 'day_to_day' as 'day_to_day' | 'month_to_month',
    billing_cycle: 'Yearly' as ServerType['billing_cycle'],
    server_expiry: '',
    ping_test: false
  });

  const canAdd = canCreate('servers');
  const canEditServer = canEdit('servers');
  const canDel = canDelete('servers');

  // Fetch Servers
  const fetchServers = async () => {
    setLoading(true);
    try {
      // Static import used
      // Pass appliedFilters to the API
      // Note: search is also in appliedFilters.searchText (or passed separately as search arg)
      // The API now takes (page, limit, search, filters)
      const res: any = await serversApi.getAll(page, limit, appliedSearch, appliedFilters);
      setLocalServers(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      showError('Error', 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  };

  // State for local activities (for P.U. calculations)
  const [localActivities, setLocalActivities] = useState<any[]>([]);
  // State for local mappings (for Mapped count)
  const [localMappings, setLocalMappings] = useState<any[]>([]);

  // Fetch Activities for P.U. calculations
  const fetchActivities = async () => {
    try {
      const res = await activitiesApi.getAll({}, 1, 1000); // Fetch all for calculations - filters, page, limit
      setLocalActivities(res.data || []);
    } catch (err) {
    }
  };

  // Fetch Mappings for Mapped count
  const fetchMappings = async () => {
    try {
      const { mappingsApi } = await import('../services/api');
      const res = await mappingsApi.getAll(1, 1000); // Fetch all mappings
      setLocalMappings(res.data || []);
    } catch (err) {
    }
  };

  // Backend returns this natively as target count, avoids mapping limited front-store locally
  const calcMappedCount = (serverId: string): number => {
    const s = localServers.find(s => s.id === serverId);
    return s?.customer_count || 0;
  };

  // Local helper: Calculate Purchase Units for a server by looking up matchingactivities
  // Logic: Find the last New/Renewal activity to establish base units, 
  // then add all User activity changes that occurred after that base activity.
  const calcPurchaseUsersByServerId = (serverId: string): number => {
    // Get all Purchase activities where the server_name matches this server's customer_ip or server_ip
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

  // Local helper: Calculate Billing Units to display Total B.U for the server
  // Logic: Sum of calculateBillingUsers for all mapped customers
  const calcServerBU = (serverId: string): number => {
    // 1. Get all mappings for this server
    const mappings = localMappings.filter(m => m && String(m.server_id) === String(serverId));
    // 2. Sum B.U. for each mapped customer
    // We need 'calcBillingUsers' logic here. 
    // Logic from Mappings.tsx: Base (New/Renewal) + Sum(User Adjustments)
    return mappings.reduce((total, mapping) => {
      const cid = String(mapping.customer_id);
      const mapCustName = String(mapping.customer_name || '').toLowerCase();
      const customerActivities = localActivities
        .filter(a => {
          if (!a || a.record_nature !== 'Sales') return false;
          return (String(a.customer_id) === cid) ||
            (String(a.customer_domain_ip) === cid) ||
            (mapCustName && String(a.customer_name || '').toLowerCase() === mapCustName);
        })
        .sort((a, b) => a.activity_date.localeCompare(b.activity_date));

      if (customerActivities.length === 0) return total;

      const baseActivities = customerActivities.filter(a => a.activity_type === 'New' || a.activity_type === 'Renewal');
      const lastBase = baseActivities.length > 0 ? baseActivities[baseActivities.length - 1] : null;

      let baseUnits = 0;
      let baseDate = '';

      if (lastBase) {
        baseUnits = Number(lastBase.billing_units) || 0;
        baseDate = lastBase.activity_date || '';
      }

      const userChanges = customerActivities
        .filter(a => a.activity_type === 'User' && a.activity_date >= baseDate)
        .reduce((sum, a) => sum + (Number(a.billing_units) || 0), 0);

      return total + (baseUnits + userChanges);
    }, 0);
  };

  useEffect(() => {
    fetchServers();
  }, [page, appliedSearch, appliedFilters]); // Add appliedFilters dependency

  useEffect(() => {
    if (canView('activities')) fetchActivities();
    if (canView('mappings')) fetchMappings();
  }, [page, appliedSearch]);

  // Filtered servers - Backend now handles filtering, so we just use localServers
  const filteredServers = localServers;

  // Selection mode handlers
  const toggleSelectionMode = () => {
    if (selectionMode) {
      // Exiting selection mode - clear selections
      setSelectedServers(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  const toggleServerSelection = (serverId: string) => {
    const newSelected = new Set(selectedServers);
    if (newSelected.has(serverId)) {
      newSelected.delete(serverId);
    } else {
      newSelected.add(serverId);
    }
    setSelectedServers(newSelected);
  };

  const selectAllVisible = () => {
    const newSelected = new Set(filteredServers.map(s => s.id));
    setSelectedServers(newSelected);
  };

  const clearSelection = () => {
    setSelectedServers(new Set());
  };

  // Generate PURCHASE activity for selected servers (does NOT renew customers)
  const handleGenerateActivity = async () => {
    if (selectedServers.size === 0) {
      showWarning('No Selection', 'Please select at least one server');
      return;
    }

    setIsGenerating(true);
    const total = selectedServers.size;
    setProgress({ current: 0, total });
    const aggregatedResults: any = { created: [], skipped: [] };
    const serverIds = Array.from(selectedServers);

    for (let i = 0; i < serverIds.length; i++) {
      const id = serverIds[i];
      let serverIp = 'Unknown';
      try {
        const server = localServers.find(s => s.id === id);
        if (!server) throw new Error('Server not found');
        serverIp = server.customer_ip || server.server_ip;

        // 1. Get Context
        const rate = server.purchase_rate || 0;
        const units = calcPurchaseUsersByServerId(id); // Use local helper which is verified correct in table

        // 2. Calculate Config (Purchase)
        // For servers, we pass 0 for billing params.
        const config = calculateNextActivityConfig(
          server.server_expiry || null,
          server.billing_cycle || 'Yearly',
          (server.billing_mode || 'day_to_day') as any,
          0, 0, // Bill Rate/Units unused
          rate,
          units
        );

        // 3. Calculate Final Amounts (Backend Logic Access) - Purchase Only
        const calcPayload = {
          activity_type: 'Renewal',
          // Note: Use 'New' or 'Renewal' for calculation? 
          // Purchase Renewal usually behaves like a renewal.
          bill_type: 'Tax Invoice', // Dummy
          billing_units: 0,
          purchase_units: config.purchase_units,
          last_bill_rate: 0,
          purchase_rate: config.purchase_rate,
          billing_cycle: config.billing_cycle,
          // Important: Mapping server 'billing_mode' to api param.
          // But api.calculate might expect 'billing_mode' for sales and 'purchase_billing_mode' for purchase?
          // Let's check api.ts definition. 
          // It has `billing_mode` and `purchase_billing_mode`. 
          // Only `billing_mode` is mandatory? No, implicit.
          // For a server renewal (Record Nature = Purchase), we should set `purchase_billing_mode`.
          purchase_billing_mode: config.billing_mode,

          start_from: config.start_from,
          purchase_start_from: config.start_from, // Sync start dates
          new_expiry_date: config.new_expiry_date,
          purchase_expiry: config.new_expiry_date, // Sync expiry dates
          is_purchase: true
        };

        const calcResult = await activitiesApi.calculate(calcPayload as any);
        if (!calcResult.success) throw new Error('Calculation failed');

        // 4. Create Activity
        const payload = {
          // No customer_id for pure server purchase (unless we link it to a dummy? No, server name acts as customer)
          customer_name: server.company || `Server ${server.server_ip}`,
          customer_domain_ip: serverIp, // Added to prevent undefined bind param in backend lookup
          server_name: server.customer_ip || server.server_ip,
          server_ip: server.server_ip,

          activity_date: toLocalDateString(),
          activity_type: 'Renewal',
          bill_type: 'Tax Invoice', // Required field even if purchase?

          billing_units: 0,
          purchase_units: config.purchase_units,
          last_bill_rate: 0,
          purchase_rate: config.purchase_rate,

          billing_cycle: config.billing_cycle, // Shared cycle field?

          start_from: config.start_from,
          new_expiry_date: config.new_expiry_date,

          purchase_start_from: config.start_from,
          purchase_expiry: config.new_expiry_date,

          // Result from Calc
          date_diff_months: calcResult.data.purchase_date_diff_months || 0,
          date_diff_days: calcResult.data.purchase_date_diff_days || 0,
          bill_amount: 0,
          purchase_amount: calcResult.data.purchase_amount,

          record_nature: 'Purchase',
          billing_mode: config.billing_mode // Maybe needed for saving
        };

        await activitiesApi.create(payload as any);
        aggregatedResults.created.push({ id });

      } catch (err: any) {
        console.error(`Failed to process server ${id}`, err);
        aggregatedResults.skipped.push({ reason: `${serverIp}: ${err.message}` });
      }

      // Update Progress
      setProgress({ current: i + 1, total });
      await new Promise(r => setTimeout(r, 50));
    }

    const createdCount = aggregatedResults.created.length;
    const skippedCount = aggregatedResults.skipped.length;

    if (createdCount > 0) {
      showSuccess('Server Purchase Renewed', `Created ${createdCount} purchase activities`);
    }

    if (skippedCount > 0) {
      const skippedReasons = aggregatedResults.skipped.slice(0, 3).map((s: any) => s.reason).join(', ') + (skippedCount > 3 ? '...' : '');
      showWarning('Some Skipped', `${skippedCount} server(s) skipped: ${skippedReasons}`);
    }

    await fetchServers();
    setSelectedServers(new Set());
    setSelectionMode(false);
    setIsGenerating(false);
    setProgress({ current: 0, total: 0 });
  };

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (field: string, value: string) => {
    const newErrors = { ...errors };

    if (field === 'server_ip') {
      // Partial validation on current page
      const exists = localServers.some(s => s.server_ip === value && s.id !== editing?.id);
      if (exists) newErrors.server_ip = 'Server IP already exists (on this page)';
      else delete newErrors.server_ip;
    }

    if (field === 'customer_ip') {
      if (value) {
        const exists = localServers.some(s => s.customer_ip === value && s.id !== editing?.id);
        if (exists) newErrors.customer_ip = 'Customer IP already exists (on this page)';
        else delete newErrors.customer_ip;
      } else {
        delete newErrors.customer_ip;
      }
    }

    setErrors(newErrors);
  };

  const handleInputChange = (field: keyof typeof form, value: any) => {
    let newValue = value;

    // Auto-capitalize first letter for text fields
    if (typeof value === 'string' && value.length > 0 && ['company', 'sof_no', 'admin_username'].includes(field)) {
      newValue = value.charAt(0).toUpperCase() + value.slice(1);
    }

    setForm({ ...form, [field]: newValue });
    if (field === 'server_ip' || field === 'customer_ip') {
      validateField(field, newValue);
    }
  };

  // Filter functions


  const resetFilters = () => {
    setAppliedFilters({
      company: '', status: '', port: '', serverIp: '', customerIp: '', adminUser: '',
      billing_mode: '', billing_cycle: '', expiry_start: '', expiry_end: '', searchText: ''
    });
    setAppliedSearch('');
    setSearchQuery('');
    setPage(1);
  };

  const clearFilter = (filterKey: keyof typeof appliedFilters) => {
    setAppliedFilters(prev => ({ ...prev, [filterKey]: '' }));
  };

  const hasActiveFilters = appliedFilters.company || appliedFilters.status || appliedFilters.port || appliedFilters.serverIp || appliedFilters.customerIp || appliedFilters.adminUser || appliedFilters.searchText;

  const openAdd = () => {
    setEditing(null);
    setErrors({});
    setForm({
      server_ip: '', sof_no: '', port: '', customer_ip: '', admin_username: '', admin_password: '',
      status: 'Active', company: '', purchase_rate: 0, billing_mode: 'day_to_day', billing_cycle: 'Yearly',
      server_expiry: '', ping_test: false
    });
    setShowModal(true);
  };

  const openEditServer = (s: ServerType) => {
    setEditing(s);
    setErrors({});
    setForm({
      server_ip: s.server_ip, sof_no: s.sof_no, port: s.port, customer_ip: s.customer_ip,
      admin_username: s.admin_username, admin_password: s.admin_password,
      status: s.status, company: s.company, purchase_rate: s.purchase_rate,
      billing_mode: s.billing_mode || 'day_to_day',
      billing_cycle: s.billing_cycle || 'Yearly',
      server_expiry: s.server_expiry || '',
      ping_test: !!(s.ping_test)
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.server_ip || !form.port) {
      showError('Error', 'Server IP and Port required');
      return;
    }
    if (Object.keys(errors).length > 0) {
      showError('Error', 'Please fix validation errors');
      return;
    }
    try {
      if (editing) {
        await serversApi.update(editing.id, form);
        showSuccess('Updated', 'Server updated');
      } else {
        await serversApi.create(form);
        showSuccess('Added', 'Server added');
      }
      setShowModal(false);
      fetchServers(); // Refresh list
    } catch (err: any) {
      showError('Error', err.message || 'Failed to save server');
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await serversApi.delete(deleteId);
      showSuccess('Deleted', 'Server removed');
      fetchServers();
    } catch (err: any) {
      showError('Error', 'Failed to delete server: ' + err.message);
    } finally {
      setDeleteId(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showSuccess('Copied', `${label} copied to clipboard`);
  };



  return (
    <div className="space-y-4 pb-16 md:pb-0">
      {/* Action Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900 w-full md:w-auto">Servers</h1>

        <div className="flex gap-2 w-full md:w-auto items-center">
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
              onClick={openFilterPopup}
              className={`flex items-center justify-center gap-2 px-3 h-10 border rounded-lg hover:bg-gray-50 transition-colors shadow-sm ${Object.values(appliedFilters).some(f => f && f !== 'all') ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white text-gray-700'}`}
              title="Filters"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden lg:inline">Filters</span>
            </button>
            
            {canView('servers') && (
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

            {/* Buttons */}
            {selectionMode ? (
              <div className="flex gap-2">
                {selectedServers.size > 0 && canCreate('activities') && (
                  <button
                    onClick={handleGenerateActivity}
                    disabled={isGenerating}
                    className="flex items-center justify-center gap-2 px-4 h-10 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    <span>Renew ({selectedServers.size})</span>
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
                    title="Add Server"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden lg:inline">Add Server</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tags / Chips */}
      {Object.entries(appliedFilters).some(([_, v]) => v && v !== '' && v !== 'all') && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-xl">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider ml-1">Active Filters:</span>
          {Object.entries(appliedFilters).map(([key, value]) => {
            if (!value || value === '' || value === 'all') return null;
            
            // Format labels
            const labelMap: any = {
              status: 'Status',
              company: 'Company',
              port: 'Port',
              serverIp: 'Server IP',
              customerIp: 'Customer IP',
              adminUser: 'Admin',
              billing_mode: 'Mode',
              billing_cycle: 'Cycle',
              expiry_start: 'Expiry From',
              expiry_end: 'Expiry To',
              searchText: 'Search'
            };

            return (
              <div key={key} className="flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-2.5 py-1 rounded-full text-xs font-medium shadow-sm">
                <span className="text-gray-400">{labelMap[key as keyof typeof labelMap] || key}:</span>
                <span>{value}</span>
                <button 
                  onClick={() => clearFilter(key as keyof typeof appliedFilters)} 
                  className="hover:bg-gray-100 rounded-full p-0.5 ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            onClick={resetFilters}
            className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded-lg transition-colors ml-1"
          >
            Clear All
          </button>
        </div>
      )}



      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3 mb-4">
        {filteredServers.map((s) => {
          const isSelected = selectedServers.has(s.id);
          const puCount = calcPurchaseUsersByServerId(s.id);
          const buCount = calcServerBU(s.id);
          return (
            <div key={s.id} className={`bg-white rounded-lg border overflow-hidden ${isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'}`}>

              {/* Row 1: Server IP + B.U + P.U + Edit */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleServerSelection(s.id)}
                    className="w-5 h-5 rounded border-gray-300 accent-blue-600 flex-shrink-0"
                  />
                )}
                <span className="font-bold text-gray-900 text-base truncate">{s.server_ip || s.customer_ip}</span>
                <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                  <span className="font-bold text-blue-600 text-lg" title="Billing Units">{buCount}</span>
                  <span className="font-bold text-red-600 text-lg" title="Purchase Units">{puCount}</span>
                  {canEditServer && !selectionMode && (
                    <button onClick={() => openEditServer(s)} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-bold uppercase transition-colors">
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Company | SOF ID */}
              <div className="flex items-center px-3 py-2 text-sm border-b border-gray-50">
                <span className="text-gray-500">Company :</span>
                <span className="font-semibold text-gray-900 ml-1 truncate">{s.company || '—'}</span>
                <span className="text-gray-300 mx-2">|</span>
                <span className="text-gray-500 flex-shrink-0">SOF ID :</span>
                <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{s.sof_no || '—'}</span>
              </div>

              {/* Row 3: Customer IP | Port */}
              <div className="flex items-center px-3 py-2 text-sm">
                <span className="text-gray-500">Customer IP :</span>
                <span className="font-semibold text-gray-900 ml-1 truncate">{s.customer_ip || '—'}</span>
                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                <span className="text-gray-500 flex-shrink-0">Port :</span>
                <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{s.port || '—'}</span>
              </div>
            </div>
          );
        })}
        {filteredServers.length === 0 && (
          <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
            {loading ? 'Loading...' : 'No servers found.'}
          </div>
        )}
      </div>

      {/* Mobile Pagination (Top) */}
      <div className="lg:hidden mb-4">
        <PaginationControls
             currentPage={page}
             totalPages={Math.ceil(total / limit)}
             onPageChange={setPage}
             loading={loading}
             totalItems={total}
             itemsPerPage={limit}
             className="rounded-lg border bg-gray-50"
        />
      </div>

      {/* Desktop Table View - Hidden on mobile */}
      <div className="hidden lg:block bg-white border border-gray-300 rounded-lg shadow-sm">
        <PaginationControls
             currentPage={page}
             totalPages={Math.ceil(total / limit)}
             onPageChange={setPage}
             loading={loading}
             totalItems={total}
             itemsPerPage={limit}
             className="rounded-t-lg border-b bg-gray-50 mb-0"
        />
        <div className="overflow-x-auto">
         <table className="w-full text-sm border-collapse table-fixed">
          <colgroup>
            {selectionMode && <col className="w-[3%]" />}
            <col className="w-[6%]" /><col className="w-[5%]" /><col className="w-[12%]" /><col className="w-[14%]" /><col className="w-[5%]" /><col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[5%]" /><col className="w-[5%]" /><col className="w-[4%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[5%]" />
          </colgroup>
          <thead>
            <tr className="bg-gray-100">
              {selectionMode && (
                <th className="text-center px-1 py-1.5 border border-gray-300">
                  <input
                    type="checkbox"
                    checked={selectedServers.size === filteredServers.length && filteredServers.length > 0}
                    onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                </th>
              )}
              {isVisible('company') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">Company</th>}
              {isVisible('sof_id') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">SOF ID</th>}
              {isVisible('server_ip') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">Server IP</th>}
              {isVisible('customer_ip') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">Customer IP</th>}
              {isVisible('port') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 text-xs">Port</th>}
              {isVisible('admin') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">Admin</th>}
              {isVisible('password') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 truncate text-xs">Password</th>}
              {isVisible('mapped') && <th className="text-center px-2 py-1.5 font-semibold border border-gray-300 text-xs">Mapped</th>}
              {isVisible('bu') && <th className="text-center px-2 py-1.5 font-semibold border border-gray-300 text-xs">B.U.</th>}
              {isVisible('pu') && <th className="text-center px-2 py-1.5 font-semibold border border-gray-300 text-xs">P.U.</th>}
              {isVisible('rate') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 text-xs">Rate</th>}
              {isVisible('expiry') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 text-xs">Expiry</th>}
              {isVisible('created') && <th className="text-left px-2 py-1.5 font-semibold border border-gray-300 text-xs">Created</th>}
              <th className="text-center px-2 py-1.5 font-semibold border border-gray-300 text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredServers.map((s) => {
              const isSelected = selectedServers.has(s.id);
              return (
                <tr
                  key={s.id}
                  className={`hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                  onClick={() => selectionMode && toggleServerSelection(s.id)}
                >
                  {selectionMode && (
                    <td className="px-2 py-2 text-center border border-gray-300" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleServerSelection(s.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </td>
                  )}
                  {isVisible('company') && <td className="px-2 py-1.5 border border-gray-300 truncate font-medium text-xs" title={s.company} style={cellStyle('company')} onContextMenu={onCellContextMenu('company')}>
                    <a href={`/cloud/mapping?server_id=${s.id}`} className="text-blue-600 hover:underline">{s.company || '-'}</a>
                  </td>}
                  {isVisible('sof_id') && <td className="px-2 py-1.5 border border-gray-300 truncate text-xs" title={s.sof_no} style={cellStyle('sof_id')} onContextMenu={onCellContextMenu('sof_id')}>{s.sof_no || '-'}</td>}
                  {isVisible('server_ip') && <td className="px-2 py-1.5 border border-gray-300 truncate font-mono text-xs" style={cellStyle('server_ip')} onContextMenu={onCellContextMenu('server_ip')}>
                    <div className="flex items-center justify-between">
                      <span className="truncate mr-1" title={s.server_ip}>{s.server_ip}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopy(s.server_ip, 'Server IP'); }}
                        className="text-gray-400 hover:text-blue-500 transition-colors"
                        title="Copy IP"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </td>}
                  {isVisible('customer_ip') && <td className="px-2 py-1.5 border border-gray-300 truncate font-mono text-xs" style={cellStyle('customer_ip')} onContextMenu={onCellContextMenu('customer_ip')}>
                    <div className="flex items-center justify-between">
                      <span className="truncate mr-1" title={s.customer_ip}>{s.customer_ip || '-'}</span>
                      {s.customer_ip && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy(s.customer_ip!, 'Customer IP'); }}
                          className="text-gray-400 hover:text-blue-500 transition-colors"
                          title="Copy Customer IP"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>}
                  {isVisible('port') && <td className="px-2 py-1.5 border border-gray-300 text-xs" style={cellStyle('port')} onContextMenu={onCellContextMenu('port')}>{s.port}</td>}
                  {isVisible('admin') && <td className="px-2 py-1.5 border border-gray-300 truncate text-xs" style={cellStyle('admin')} onContextMenu={onCellContextMenu('admin')}>
                    <div className="flex items-center justify-between">
                      <span className="truncate mr-1" title={s.admin_username || ''}>{s.admin_username || '-'}</span>
                      {s.admin_username && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy(s.admin_username!, 'Username'); }}
                          className="text-gray-400 hover:text-blue-500 transition-colors"
                          title="Copy Username"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>}
                  {isVisible('password') && <td className="px-2 py-1.5 border border-gray-300 truncate text-xs" style={cellStyle('password')} onContextMenu={onCellContextMenu('password')}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">{showPwd[s.id] ? s.admin_password : '••••••'}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowPwd(p => ({ ...p, [s.id]: !p[s.id] })); }}
                        className="text-gray-400 hover:text-gray-600"
                        title={showPwd[s.id] ? "Hide" : "Show"}
                      >
                        {showPwd[s.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      {s.admin_password && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy(s.admin_password!, 'Password'); }}
                          className="text-gray-400 hover:text-blue-500"
                          title="Copy Password"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>}
                  {isVisible('mapped') && <td className="px-2 py-1.5 border border-gray-300 text-center text-xs" style={cellStyle('mapped')} onContextMenu={onCellContextMenu('mapped')}>{calcMappedCount(s.id)}</td>}
                  {isVisible('bu') && <td className="px-2 py-1.5 border border-gray-300 font-bold text-blue-600 text-center text-xs" style={cellStyle('bu')} onContextMenu={onCellContextMenu('bu')}>{calcServerBU(s.id)}</td>}
                  {isVisible('pu') && <td className="px-2 py-1.5 border border-gray-300 font-bold text-red-600 text-center text-xs" style={cellStyle('pu')} onContextMenu={onCellContextMenu('pu')}>{calcPurchaseUsersByServerId(s.id)}</td>}
                  {isVisible('rate') && <td className="px-2 py-1.5 border border-gray-300 text-xs" style={cellStyle('rate')} onContextMenu={onCellContextMenu('rate')}>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">₹{s.purchase_rate || '0.00'}</span>
                      <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${s.billing_mode === 'month_to_month' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.billing_mode === 'month_to_month' ? 'M2M' : 'D2D'}
                      </span>
                    </div>
                  </td>}
                  {isVisible('expiry') && <td className="px-2 py-1.5 border border-gray-300 text-xs text-gray-700 font-medium" style={cellStyle('expiry')} onContextMenu={onCellContextMenu('expiry')}>{formatDate(s.server_expiry)}</td>}
                  {isVisible('created') && <td className="px-2 py-1.5 border border-gray-300 text-xs text-gray-500" style={cellStyle('created')} onContextMenu={onCellContextMenu('created')}>{formatDate(s.created_at)}</td>}
                  <td className="px-2 py-1.5 border border-gray-300">
                    {!selectionMode && (
                      <div className="flex items-center gap-2">
                        {canEditServer && (
                          <button onClick={() => openEditServer(s)} className="text-blue-600 hover:text-blue-800">
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {canDel && (
                          <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:text-red-800">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredServers.length === 0 && (
              <tr>
                <td colSpan={selectionMode ? 13 : 12} className="px-3 py-8 text-center text-gray-500 border border-gray-300">
                  {loading ? 'Loading...' : 'No servers found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">{editing ? 'Edit Server' : 'Add Server'}</h3>
              <button onClick={() => setShowModal(false)}><X className="h-5 w-5 text-gray-400 hover:text-gray-600" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* Company */}
                 <div className="col-span-1 md:col-span-2">
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Company Name <span className="text-red-500">*</span></label>
                   <input 
                     value={form.company}
                     onChange={e => setForm({...form, company: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                     placeholder="Server Company/Provider"
                   />
                 </div>

                 {/* SOF No */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">SOF No <span className="text-red-500">*</span></label>
                   <input 
                     value={form.sof_no}
                     onChange={e => setForm({...form, sof_no: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                     placeholder="Required"
                   />
                 </div>

                 {/* Port */}
                  <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Port</label>
                   <input 
                     value={form.port}
                     onChange={e => setForm({...form, port: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                     placeholder="e.g. 3389"
                   />
                 </div>

                 {/* Server IP */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Server IP</label>
                   <input 
                     value={form.server_ip}
                     onChange={e => setForm({...form, server_ip: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                     placeholder="X.X.X.X"
                   />
                 </div>

                 {/* Customer IP */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Customer IP</label>
                   <input 
                     value={form.customer_ip}
                     onChange={e => setForm({...form, customer_ip: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                     placeholder="Optional"
                   />
                 </div>
                 
                 {/* Admin User */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Admin Username</label>
                   <input 
                     value={form.admin_username}
                     onChange={e => setForm({...form, admin_username: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                   />
                 </div>

                 {/* Admin Pass */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Admin Password</label>
                   <div className="relative">
                     <input 
                       type={showPwd['new'] ? "text" : "password"}
                       value={form.admin_password}
                       onChange={e => setForm({...form, admin_password: e.target.value})}
                       className="w-full border border-gray-300 rounded-lg p-2 text-sm pr-8"
                     />
                     <button 
                       type="button"
                       onClick={() => setShowPwd(p => ({...p, 'new': !p['new']}))}
                       className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600"
                     >
                       {showPwd['new'] ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                     </button>
                   </div>
                 </div>

                 {/* Purchase Rate */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Purchase Rate (₹)</label>
                   <input 
                     type="number"
                     value={form.purchase_rate}
                     onChange={e => setForm({...form, purchase_rate: parseFloat(e.target.value) || 0})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                   />
                 </div>

                 {/* Status */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                   <select 
                     value={form.status}
                     onChange={e => setForm({...form, status: e.target.value as any})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                   >
                     <option value="Active">Active</option>
                     <option value="Inactive">Inactive</option>
                   </select>
                 </div>
                 
                 {/* Billing Mode */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Billing Mode</label>
                   <select 
                     value={form.billing_mode}
                     onChange={e => setForm({...form, billing_mode: e.target.value as any})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                   >
                     <option value="day_to_day">Day to Day</option>
                     <option value="month_to_month">Month to Month</option>
                   </select>
                 </div>

                  {/* Billing Cycle */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Billing Cycle</label>
                   <select 
                     value={form.billing_cycle}
                     onChange={e => setForm({...form, billing_cycle: e.target.value as any})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                   >
                     <option value="Monthly">Monthly</option>
                     <option value="Quarterly">Quarterly</option>
                     <option value="Half-Yearly">Half-Yearly</option>
                     <option value="Yearly">Yearly</option>
                   </select>
                 </div>
                 
                 {/* Expiry */}
                 <div>
                   <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Expiry Date</label>
                   <input 
                     type="date"
                     value={form.server_expiry ? new Date(form.server_expiry).toISOString().split('T')[0] : ''}
                     onChange={e => setForm({...form, server_expiry: e.target.value})}
                     className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                   />
                 </div>

              </div>

              {/* Server Monitor toggle */}
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Include in Server Monitor</p>
                  <p className="text-xs text-gray-500 mt-0.5">Track uptime &amp; downtime for this server</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, ping_test: !f.ping_test }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${form.ping_test ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.ping_test ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 mt-4">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm">Save Server</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Popup - Standardized FilterModal */}
      <FilterModal
        isOpen={showFilterPopup}
        onClose={() => setShowFilterPopup(false)}
        title="Filter Servers"
        config={[
          { key: 'company', label: 'Company Name', type: 'text', placeholder: 'Search Company...' },
          { key: 'status', label: 'Status', type: 'select', options: [
             { value: 'Active', label: 'Active' },
             { value: 'Inactive', label: 'Inactive' }
          ]},
          { key: 'port', label: 'Port', type: 'text', placeholder: 'e.g. 3389' },
          { key: 'serverIp', label: 'Server IP', type: 'text', placeholder: 'Search Server IP...' },
          { key: 'customerIp', label: 'Customer IP', type: 'text', placeholder: 'Search Customer IP...' },
          { key: 'adminUser', label: 'Admin Username', type: 'text', placeholder: 'Search Username...' },
          { key: 'billing_mode', label: 'Billing Mode', type: 'select', options: [
             { value: 'day_to_day', label: 'Day to Day' },
             { value: 'month_to_month', label: 'Month to Month' }
          ]},
          { key: 'billing_cycle', label: 'Billing Cycle', type: 'select', options: [
             { value: 'Monthly', label: 'Monthly' },
             { value: 'Quarterly', label: 'Quarterly' },
             { value: 'Half-Yearly', label: 'Half-Yearly' },
             { value: 'Yearly', label: 'Yearly' }
          ]},
          { key: 'expiry_start', label: 'Expiry From', type: 'date' },
          { key: 'expiry_end', label: 'Expiry To', type: 'date' },
        ]}
        currentFilters={appliedFilters}
        onApply={(filters) => {
            // Sanitize 'all'
            const sanitized: any = {};
            for (const [key, value] of Object.entries(filters)) {
              sanitized[key] = value === 'all' ? '' : value;
            }
            setAppliedFilters(prev => ({ ...prev, ...sanitized }));
            setPage(1);
        }}
        onReset={resetFilters}
      />
    </div>
  );
};

export default Servers;


