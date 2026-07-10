import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, X, IndianRupee, Calendar, FileText, Calculator, ChevronDown, Search, RefreshCw, Filter, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useData, Activity } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { activitiesApi, customersApi, serversApi, mappingsApi, vchTypeApi } from '../services/api';
import { formatDate, toLocalDateString, getISTDateParts, getDaysInMonth, getSafeISTDate } from '../utils/dateUtils';
import { calculateNextActivityConfig } from '../utils/renewalUtils';
import PaginationControls from '../components/Shared/PaginationControls';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';
import { DateInput } from '../components/DateInput';
import { useColumnPermissions } from '../hooks/useColumnPermissions';

interface ActivitiesProps {
  viewMode?: 'sales' | 'purchase';
}

// Local interface for form state to allow empty strings during input
interface ActivityFormState extends Omit<Activity, 'id' | 'billing_units' | 'purchase_units' | 'last_bill_rate' | 'purchase_rate' | 'bill_amount' | 'purchase_amount'> {
  billing_units: number | string;
  purchase_units: number | string;
  last_bill_rate: number | string;
  purchase_rate: number | string;
  bill_amount: number | string;
  purchase_amount: number | string;
  // Purchase specific fields
  purchase_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly' | null;
  server_id?: string; // Explicit Server ID for multi-server customers
}

const Activities: React.FC<ActivitiesProps> = ({ viewMode = 'sales' }) => {
  const { getServerById, getServerByCustomerId, getTotalRevenue, isLoading, getTotalPurchaseUsersByServerId } = useData();
  // Removed global 'customers', 'servers', and 'mappings' - now using local search state and API calls

  // Read URL query params for initial filter
  const [searchParams] = useSearchParams();
  const initialCustomerId = searchParams.get('customer_id') || '';
  const initialSearchText = searchParams.get('search_text') || '';

  const [localActivities, setLocalActivities] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const { canCreate, canEdit, canDelete, canView, isAdmin } = useAuth();
  const { isVisible, cellStyle, onCellContextMenu } = useColumnPermissions('activities');
  const { showSuccess, showError, showConfirm } = useToast();

  // Local state for searchable dropdowns (fetched from API)
  const [localCustomers, setLocalCustomers] = useState<any[]>([]);
  const [localServers, setLocalServers] = useState<any[]>([]);
  const [customerServers, setCustomerServers] = useState<any[]>([]); // Servers mapped to selected customer

  const [showModal, setShowModal] = useState(false);
  // Default activeTab based on viewMode
  const [activeTab, setActiveTab] = useState<'Sales' | 'Purchase'>(viewMode === 'sales' ? 'Sales' : 'Purchase');

  // Sync activeTab if viewMode changes
  useEffect(() => {
    setActiveTab(viewMode === 'sales' ? 'Sales' : 'Purchase');
  }, [viewMode]);

  // Build initial filter state — if customer_id is in the URL, include it immediately
  // so the very first backend fetch is already filtered (no race condition)
  const defaultFilters = {
    customer: '',
    customerId: initialCustomerId,
    server: '',
    activityType: '',
    billType: '',
    cycle: '',
    mode: '',
    dateFrom: '',
    dateTo: '',
    minAmount: '',
    maxAmount: '',
    searchText: initialSearchText
  };

  // Applied filters - these are sent to the backend (only updated when Apply is clicked)
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);

  // Pending filters - what user types in the filter popup (NOT sent to backend until Apply)
  const [pendingFilters, setPendingFilters] = useState(defaultFilters);

  // Filter popup state
  const [showFilterPopup, setShowFilterPopup] = useState(false);

  // Fetch Activities - Uses ONLY appliedFilters (not pending)
  const fetchActivities = async (filtersToUse = appliedFilters) => {
    setLoading(true);
    try {
      const { activitiesApi } = await import('../services/api');

      const backendFilters: any = {
        record_nature: activeTab
      };
      
      // Map applied filters to backend parameters
      if (filtersToUse.customerId) backendFilters.customer_id = filtersToUse.customerId;
      if (filtersToUse.activityType) backendFilters.activity_type = filtersToUse.activityType;
      if (filtersToUse.billType) backendFilters.bill_type = filtersToUse.billType;
      if (filtersToUse.dateFrom) backendFilters.start_date = filtersToUse.dateFrom;
      if (filtersToUse.dateTo) backendFilters.end_date = filtersToUse.dateTo;
      if (filtersToUse.server) backendFilters.server_name = filtersToUse.server;
      if (filtersToUse.cycle) backendFilters.billing_cycle = filtersToUse.cycle;
      if (filtersToUse.mode) backendFilters.billing_mode = filtersToUse.mode;
      if (filtersToUse.minAmount) backendFilters.min_amount = filtersToUse.minAmount;
      if (filtersToUse.maxAmount) backendFilters.max_amount = filtersToUse.maxAmount;

      // Search text goes as search parameter
      // Don't send customer name as search text if we already have a customer_id filter (exact match)
      const searchText = filtersToUse.searchText || (filtersToUse.customerId ? '' : filtersToUse.customer) || '';

      const res: any = await activitiesApi.getAll(backendFilters, page, limit, searchText);
      setLocalActivities(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('[Activities] Failed to load:', err);
      showError('Error', 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  // Buckets returned by GET /activities/stats. Honors the same filter set as
  // findAll, so the cards mirror exactly what the user has filtered to. Each
  // bucket carries the bill count, total billing units (unit-count agnostic of
  // sign — abs() in SQL), and total amount.
  const emptyStats = { count: 0, units_total: 0, amount_total: 0 };
  const [stats, setStats] = useState<{
    new: typeof emptyStats; renewal: typeof emptyStats;
    user_increase: typeof emptyStats; user_decrease: typeof emptyStats;
  }>({ new: emptyStats, renewal: emptyStats, user_increase: emptyStats, user_decrease: emptyStats });

  const fetchStats = useCallback(async (filtersToUse = appliedFilters) => {
    try {
      const backendFilters: any = { record_nature: activeTab };
      if (filtersToUse.customerId) backendFilters.customer_id = filtersToUse.customerId;
      if (filtersToUse.activityType) backendFilters.activity_type = filtersToUse.activityType;
      if (filtersToUse.billType) backendFilters.bill_type = filtersToUse.billType;
      if (filtersToUse.dateFrom) backendFilters.start_date = filtersToUse.dateFrom;
      if (filtersToUse.dateTo) backendFilters.end_date = filtersToUse.dateTo;
      if (filtersToUse.server) backendFilters.server_name = filtersToUse.server;
      if (filtersToUse.cycle) backendFilters.billing_cycle = filtersToUse.cycle;
      if (filtersToUse.mode) backendFilters.billing_mode = filtersToUse.mode;
      if (filtersToUse.minAmount) backendFilters.min_amount = filtersToUse.minAmount;
      if (filtersToUse.maxAmount) backendFilters.max_amount = filtersToUse.maxAmount;
      const searchText = filtersToUse.searchText || (filtersToUse.customerId ? '' : filtersToUse.customer) || '';
      const res: any = await activitiesApi.getStats(backendFilters, searchText);
      if (res?.success && res.data) setStats(res.data);
    } catch (err) {
      console.error('[Activities] Failed to load stats:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Only fetch on page change or tab change - NOT on filter typing
  useEffect(() => {
    fetchActivities();
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeTab]);

  // Handle initial customer_id from URL query params — only fetch customer NAME for display
  // (The actual filtering is already handled by initializing appliedFilters with customerId above)
  useEffect(() => {
    if (initialCustomerId) {
      const loadCustomerName = async () => {
        try {
          const { customersApi } = await import('../services/api');
          const res = await customersApi.getById(initialCustomerId);
          const customerName = res?.data?.company || initialCustomerId;
          // Update only the display name in filters (customerId is already set)
          setPendingFilters(prev => ({ ...prev, customer: customerName }));
          setAppliedFilters(prev => ({ ...prev, customer: customerName }));
        } catch (err) {
          // If fetch fails, just show the ID
          setPendingFilters(prev => ({ ...prev, customer: `Customer #${initialCustomerId}` }));
          setAppliedFilters(prev => ({ ...prev, customer: `Customer #${initialCustomerId}` }));
        }
      };
      loadCustomerName();
    }
  }, [initialCustomerId]);

  // Apply Filters - copies pending to applied and triggers fetch
  const applyFilters = () => {
    const newApplied = { ...pendingFilters };
    setAppliedFilters(newApplied);
    setPage(1); // Reset to first page
    setShowFilterPopup(false);
    // Fetch with new filters immediately
    fetchActivities(newApplied);
    fetchStats(newApplied);
  };

  // Reset Filters - clears both pending and applied
  const resetFilters = () => {
    const emptyFilters = {
      customer: '',
      customerId: '',
      server: '',
      activityType: '',
      billType: '',
      cycle: '',
      mode: '',
      dateFrom: '',
      dateTo: '',
      minAmount: '',
      maxAmount: '',
      searchText: ''
    };
    setPendingFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
    setShowFilterPopup(false);
    // Fetch with empty filters
    fetchActivities(emptyFilters);
    fetchStats(emptyFilters);
  };

  // Clear single filter - removes from both pending and applied, then refetches
  const clearFilter = (filterKey: keyof typeof appliedFilters) => {
    const newApplied = { ...appliedFilters, [filterKey]: '' };
    const newPending = { ...pendingFilters, [filterKey]: '' };
    if (filterKey === 'customer') {
      newApplied.customerId = '';
      newPending.customerId = '';
    }
    setPendingFilters(newPending);
    setAppliedFilters(newApplied);
    setPage(1);
    fetchActivities(newApplied);
    fetchStats(newApplied);
  };

  // Check if there are any active filters (from applied, not pending)
  const hasActiveFilters = appliedFilters.customer || appliedFilters.server || appliedFilters.activityType || appliedFilters.billType || appliedFilters.cycle || appliedFilters.mode || appliedFilters.dateFrom || appliedFilters.dateTo || appliedFilters.minAmount || appliedFilters.maxAmount || appliedFilters.searchText;

  // Use localActivities directly since filtering is done on backend
  const filteredActivities = localActivities;

  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [renewMode, setRenewMode] = useState<'billing' | 'purchase' | null>(null);

  // Voucher type for the auto-created voucher. Bill Type picks the family:
  //   Tax Invoice → Sales children,      default "Cloud Billing"
  //   Credit Note → Credit Note children, default "Cloud CN"
  const [salesVchTypes, setSalesVchTypes] = useState<{ id: number; name: string }[]>([]);
  const [creditVchTypes, setCreditVchTypes] = useState<{ id: number; name: string }[]>([]);
  const [voucherTypeId, setVoucherTypeId] = useState<number | ''>('');
  useEffect(() => {
    vchTypeApi.getAll()
      .then(res => {
        if (!res.success) return;
        const all = res.data || [];
        // Whole family, not just direct children — a type filed under
        // Cloud Billing (itself under Sales) still counts as Sales-family.
        const familyOf = (rootName: string) => {
          const root = all.find((t: any) => t.name?.toLowerCase() === rootName);
          if (!root) return [];
          const byId = new Map(all.map((x: any) => [x.id, x]));
          const inFamily = (t: any) => {
            let cur: any = t;
            for (let hops = 0; cur && hops < 20; hops++) {
              if (cur.id === root.id) return true;
              if (cur.parent_id === cur.id || cur.parent_id == null) return false;
              cur = byId.get(cur.parent_id);
            }
            return false;
          };
          return all.filter((t: any) => t.id !== root.id && inFamily(t) && Number(t.active) !== 0);
        };
        setSalesVchTypes(familyOf('sales'));
        setCreditVchTypes(familyOf('credit note'));
      })
      .catch(() => { /* dropdown just stays hidden */ });
  }, []);
  const [serverSearch, setServerSearch] = useState('');
  const [showServerDropdown, setShowServerDropdown] = useState(false);
  const [currentPlanDetails, setCurrentPlanDetails] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  // showFilters removed - now using FilterModal component

  // Handle Export
  const handleExport = async () => {
    try {
      showSuccess('Exporting', 'Generating Excel file...');
      const { activitiesApi } = await import('../services/api');
      
      const backendFilters: any = {
        record_nature: activeTab
      };
      
      // Use applied filters for export
      if (appliedFilters.customerId) backendFilters.customer_id = appliedFilters.customerId;
      if (appliedFilters.activityType) backendFilters.activity_type = appliedFilters.activityType;
      if (appliedFilters.billType) backendFilters.bill_type = appliedFilters.billType;
      if (appliedFilters.dateFrom) backendFilters.start_date = appliedFilters.dateFrom;
      if (appliedFilters.dateTo) backendFilters.end_date = appliedFilters.dateTo;
      if (appliedFilters.server) backendFilters.server_name = appliedFilters.server;
      if (appliedFilters.cycle) backendFilters.billing_cycle = appliedFilters.cycle;
      if (appliedFilters.mode) backendFilters.billing_mode = appliedFilters.mode;
      if (appliedFilters.minAmount) backendFilters.min_amount = appliedFilters.minAmount;
      if (appliedFilters.maxAmount) backendFilters.max_amount = appliedFilters.maxAmount;

      const searchText = appliedFilters.searchText || (appliedFilters.customerId ? '' : appliedFilters.customer) || '';

      // Fetch ALL matching activities (high limit)
      const res: any = await activitiesApi.getAll(backendFilters, 1, 10000, searchText);
      const allActivities: Activity[] = res.data || [];

      // Format data for Excel
      const exportData = allActivities.map(a => ({
        'Activity Date': formatDate(a.activity_date),
        'Company': a.customer_name,
        'Server': a.server_name,
        'Activity Type': a.activity_type,
        'Bill Type': a.bill_type,
        'Structure': activeTab === 'Sales' ? a.billing_cycle : a.billing_cycle, // Shared field usage
        'Mode': activeTab === 'Sales' ? (a as any).billing_mode : (a as any).billing_mode,
        'Last Bill Rate': activeTab === 'Sales' ? a.last_bill_rate : 0,
        'Billing Units': activeTab === 'Sales' ? a.billing_units : 0,
        'Bill Amount': activeTab === 'Sales' ? a.bill_amount : 0,
        'Purchase Rate': activeTab === 'Purchase' ? a.purchase_rate : 0,
        'Purchase Units': activeTab === 'Purchase' ? a.purchase_units : 0,
        'Purchase Amount': activeTab === 'Purchase' ? a.purchase_amount : 0,
        'Bill No': a.bill_no,
        'Bill Date': a.bill_date ? formatDate(a.bill_date) : '',
        'Start From': a.start_from ? formatDate(a.start_from) : '',
        'Expiry Date': a.new_expiry_date ? formatDate(a.new_expiry_date) : '',
        'SOF No': a.sof_no
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeTab);
      XLSX.writeFile(wb, `Activities_${activeTab}.xlsx`);
      
      showSuccess('Success', 'Export complete');
    } catch (err) {
      console.error(err);
      showError('Export Failed', 'Could not export activities');
    }
  };

  // Search customers when user types 3+ characters
  useEffect(() => {
    if (customerSearch.length < 3) {
      setLocalCustomers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await customersApi.getAll(1, 50, customerSearch, 'all', true);
        // Fix: Deduplicate by ID to prevent dropdown duplicates
        const uniqueCustomers = res.data ? Array.from(new Map(res.data.map((c: any) => [c.id, c])).values()) : [];
        setLocalCustomers(uniqueCustomers);
      } catch (err: any) {
        // A silently-swallowed failure here reads as "No customers found",
        // which sends the user hunting a data problem when it's usually an
        // expired session. Say what actually happened.
        const msg = String(err?.message || '');
        if (/unauthoriz|expired|401/i.test(msg)) {
          showError('Session expired', 'Your login has expired — please log out and log in again.');
        } else {
          showError('Search failed', msg || 'Could not search customers');
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch, showError]);

  // Search servers when user types 3+ characters
  useEffect(() => {
    if (serverSearch.length < 4) {
      setLocalServers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await serversApi.search(serverSearch);
        setLocalServers(res.data || []);
      } catch (err) {
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [serverSearch]);

  const [form, setForm] = useState<ActivityFormState>({
    customer_name: '', customer_domain_ip: '', server_name: '', sof_no: '', activity_date: '',
    activity_type: 'New', bill_type: 'Tax Invoice', billing_units: '', purchase_units: '',
    last_bill_rate: '', purchase_rate: '', billing_cycle: 'Yearly',
    old_expiry_date: '', bill_no: '', bill_date: '',
    start_from: '', new_expiry_date: '',
    date_diff_months: 0, date_diff_days: 0, date_diff_label: '', bill_amount: 0, purchase_amount: 0,
    is_sales: true, is_purchase: true,
    billing_mode: 'day_to_day' as 'day_to_day' | 'month_to_month',
    // Independent Billing Type
    billing_activity_type: 'New' as 'New' | 'Renewal' | 'User',

    // Purchase Fields
    purchase_activity_type: 'New' as 'New' | 'Renewal' | 'User',
    purchase_billing_mode: 'day_to_day' as 'day_to_day' | 'month_to_month',
    custom_period: false,
    server_ip: '', mapped_customer_ip: '',
    purchase_cycle: 'Yearly' as 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly',
    purchase_start_from: '',
    purchase_expiry: '',
    purchase_date_diff_months: 0,
    purchase_date_diff_days: 0,
    server_id: '',
  });

  const [availableActivityTypes, setAvailableActivityTypes] = useState<string[]>(['New', 'User']);

  // Which voucher-type family the auto-voucher dropdown offers follows the
  // Bill Type: Tax Invoice → Sales children, Credit Note → Credit Note children.
  const activeVchTypes = form.bill_type === 'Credit Note' ? creditVchTypes : salesVchTypes;
  useEffect(() => {
    if (!showModal || editing) return;
    const def = form.bill_type === 'Credit Note'
      ? (creditVchTypes.find(t => t.name.toLowerCase() === 'cloud cn') ?? creditVchTypes[0])
      : (salesVchTypes.find(t => t.name.toLowerCase() === 'cloud billing')
        ?? salesVchTypes.find(t => t.name.toLowerCase() === 'tax invoice'));
    setVoucherTypeId(def?.id ?? '');
  }, [showModal, editing, salesVchTypes, creditVchTypes, form.bill_type]);

  const canAdd = canCreate('activities');
  const canEditActivity = canEdit('activities');
  const canDel = canDelete('activities');

  // On a RENEW, a non-admin may only adjust Rate / Cycle / Mode — everything
  // else (units, dates, bill type, voucher type, SOF) is auto-computed from
  // the running plan and locked, so they can't accidentally break the math.
  // Admins keep full control. Class helper greys out the locked inputs.
  const renewLocked = !!renewMode && !isAdmin();
  const lockCls = renewLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : '';

  // Helper to check if a customer is mapped (async API call)
  const [customerMappingStatus, setCustomerMappingStatus] = useState<Map<string, boolean>>(new Map());

  const checkCustomerMapped = async (customerId: string): Promise<boolean> => {
    // Check cache first
    if (customerMappingStatus.has(customerId)) {
      return customerMappingStatus.get(customerId) || false;
    }
    try {
      const res = await mappingsApi.getByCustomer(customerId);
      const isMapped = !!(res.success && res.data);
      setCustomerMappingStatus(prev => new Map(prev).set(customerId, isMapped));
      return isMapped;
    } catch {
      return false;
    }
  };

  // Sync helper for display (uses cached status)
  const isCustomerMapped = (customerId: string): boolean => {
    return customerMappingStatus.get(customerId) || false;
  };

  const [formulaBreakdown, setFormulaBreakdown] = useState('');

  const calculateFromBackend = useCallback(async () => {
    const isSales = !!form.is_sales;
    const isPurchase = !!form.is_purchase;

    if (!isSales && !isPurchase) return;

    // Check if any units/rates are present to avoid overhead if both are zero
    const hasSalesData = isSales && (Number(form.billing_units) !== 0 || Number(form.last_bill_rate) !== 0);
    const hasPurchaseData = isPurchase && (Number(form.purchase_units) !== 0 || Number(form.purchase_rate) !== 0);

    if (!hasSalesData && !hasPurchaseData) return;

    try {
      const apiPayload = {
        activity_type: form.activity_type,
        bill_type: form.bill_type,
        billing_units: isSales ? (Number(form.billing_units) || 0) : 0,
        purchase_units: isPurchase ? (Number(form.purchase_units) || 0) : 0,
        last_bill_rate: isSales ? (Number(form.last_bill_rate) || 0) : 0,
        purchase_rate: isPurchase ? (Number(form.purchase_rate) || 0) : 0,
        billing_cycle: form.billing_cycle,
        activity_date: form.activity_date,
        start_from: form.start_from,
        new_expiry_date: form.new_expiry_date,
        customer_id: form.customer_domain_ip,
        billing_mode: form.billing_mode,
        custom_period: form.custom_period,
        purchase_billing_mode: form.purchase_billing_mode,
        purchase_cycle: form.purchase_cycle,
        purchase_start_from: form.purchase_start_from,
        purchase_expiry: form.purchase_expiry,
      };
      
      console.log('DEBUG: FE sending payload', apiPayload);

      const result = await activitiesApi.calculate(apiPayload as any);
      console.log('DEBUG: FE calculate response', result);

      if (result.success && result.data) {
        setForm(prev => ({
          ...prev,
          bill_amount: isSales ? result.data.bill_amount : 0,
          purchase_amount: isPurchase ? result.data.purchase_amount : 0,
          date_diff_months: result.data.date_diff_months,
          date_diff_days: result.data.date_diff_days,
          date_diff_label: result.data.date_diff_label,
          purchase_date_diff_months: result.data.purchase_date_diff_months,
          purchase_date_diff_days: result.data.purchase_date_diff_days,
          purchase_date_diff_label: result.data.purchase_date_diff_label,
          // Always trust backend for expiry date logic (User co-terminus, M2M, D2D)
          ...(result.data.new_expiry_date
            ? { new_expiry_date: result.data.new_expiry_date }
            : {}),
        }));
        setFormulaBreakdown(result.data.formula_breakdown);
      }
    } catch (err) {
    }
  }, [
    form.activity_type, form.bill_type, form.billing_units, form.purchase_units,
    form.last_bill_rate, form.purchase_rate, form.billing_cycle, form.activity_date,
    form.start_from, form.new_expiry_date, form.customer_domain_ip, form.billing_mode,
    form.purchase_billing_mode, form.purchase_cycle,
    form.purchase_start_from, form.purchase_expiry,
    form.is_sales, form.is_purchase
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      calculateFromBackend();
    }, 300);
    return () => clearTimeout(timer);
  }, [calculateFromBackend]);

  useEffect(() => {
    if (form.customer_domain_ip && form.activity_date) {
      updateAvailableTypes(form.customer_domain_ip, form.activity_date);
      checkAndSetUserType();
    }
  }, [form.customer_domain_ip, form.activity_date, currentPlanDetails]);

  const checkAndSetUserType = () => {

    // Only strictly automate if NOT in Renew Mode (Manual overrides preferred there)
    if (renewMode) {
      return;
    }

    if (currentPlanDetails && currentPlanDetails.current_plan_start && currentPlanDetails.current_plan_expiry) {
      const dateStr = form.activity_date;
      const startStr = currentPlanDetails.current_plan_start;
      const expiryStr = currentPlanDetails.current_plan_expiry;

      // Helper to parse "dd/mm/yyyy" to comparable number yyyymmdd
      const parseDate = (d: string) => {
        if (!d) return 0;
        const parts = d.split('/');
        if (parts.length !== 3) return 0;
        const [day, month, year] = parts.map(Number);
        return year * 10000 + month * 100 + day;
      };

      const dateNum = parseDate(dateStr);
      const startNum = parseDate(startStr);
      const expiryNum = parseDate(expiryStr);


      // Check Overlap: In between Start and Expiry (Inclusive)
      if (dateNum >= startNum && dateNum <= expiryNum) {
        // Auto-Select 'User'
        if (form.activity_type !== 'User') {
          // Fetch latest rate/expiry defaults immediately
          const planExpiry = currentPlanDetails.current_plan_expiry;
          const serverExpiry = currentPlanDetails.server_expiry;
          const planRate = currentPlanDetails.rate;
          const serverRate = (localServers.find(s => s.server_ip === currentPlanDetails.server_ip)?.purchase_rate);

          setForm(prev => ({
            ...prev,
            activity_type: 'User',
            billing_activity_type: 'User',
            purchase_activity_type: 'User',
            // Hide/Nullify Cycles/Modes
            billing_cycle: '' as any,
            billing_mode: '' as any,
            purchase_cycle: '' as any,
            purchase_billing_mode: '' as any,
            // Set Expiry Matching
            new_expiry_date: planExpiry,
            purchase_expiry: serverExpiry || prev.purchase_expiry,
            // Preserve Rates from Defaults
            last_bill_rate: planRate !== undefined ? planRate : prev.last_bill_rate,
            purchase_rate: serverRate !== undefined ? serverRate : prev.purchase_rate
          }));
          setAvailableActivityTypes(['New', 'User']);
        }
      } else {
        // Outside range -> 'New'
        if (form.activity_type === 'User') {
          // Reset to New defaults
          const { year, month, day } = getISTDateParts(dateStr);
          // Recalculate expiry for New type (basic default)
          const lastDay = getDaysInMonth(year, month);
          const defaultExpiry = toLocalDateString(getSafeISTDate(year, month, lastDay));

          setForm(prev => ({
            ...prev,
            activity_type: 'New',
            billing_activity_type: 'New',
            purchase_activity_type: 'New',
            // Restore defaults or keep what was there? 
            // Best to reset to day_to_day/Yearly or whatever was default
            billing_cycle: 'Yearly',
            billing_mode: 'day_to_day',
            new_expiry_date: defaultExpiry // Basic reset
          }));
          setAvailableActivityTypes(['New', 'User']);
        }
      }
    }
  };

  const openAdd = () => {
    setEditing(null);
    setRenewMode(null); // Reset renew mode when opening Add
    const today = toLocalDateString();
    setForm({
      customer_name: '', customer_domain_ip: '', server_name: '', sof_no: '', activity_date: today,
      activity_type: 'New',
      bill_type: 'Tax Invoice',
      billing_units: '', purchase_units: '', // No prefill 0
      last_bill_rate: '', purchase_rate: '', // No prefill 0
      billing_cycle: 'Yearly',
      old_expiry_date: '', bill_no: '', bill_date: '',
      start_from: today, new_expiry_date: '',
      date_diff_months: 0, date_diff_days: 0,
      date_diff_label: '',
      bill_amount: '', purchase_amount: '', // No prefill 0
      is_sales: activeTab === 'Sales',
      is_purchase: activeTab === 'Purchase',
      billing_mode: 'day_to_day',
      purchase_billing_mode: 'day_to_day',
      server_ip: '', mapped_customer_ip: '',
      purchase_cycle: 'Yearly',
      purchase_start_from: today,
      purchase_expiry: '',
      purchase_date_diff_months: 0,
      purchase_date_diff_days: 0,
    });
    setCustomerSearch('');
    setShowModal(true);
  };

  const handleOpenRenew = () => {
    setEditing(null);
    const mode = activeTab === 'Purchase' ? 'purchase' : 'billing';
    setRenewMode(mode as any);
    const today = toLocalDateString();
    setForm({
      customer_name: '', customer_domain_ip: '', server_name: '', sof_no: '',
      activity_date: today,
      activity_type: 'Renewal',
      bill_type: 'Tax Invoice',
      billing_units: '', purchase_units: '',
      last_bill_rate: '', purchase_rate: '',
      billing_cycle: 'Yearly',
      old_expiry_date: '', bill_no: '', bill_date: '',
      start_from: today, new_expiry_date: '',
      date_diff_months: 0, date_diff_days: 0,
      date_diff_label: '',
      bill_amount: '', purchase_amount: '',
      // Strict Mode Separation for Renewal
      is_sales: mode === 'billing',
      is_purchase: mode === 'purchase',
      billing_mode: 'day_to_day',
      purchase_billing_mode: 'day_to_day',
      server_ip: '', mapped_customer_ip: '',
      purchase_cycle: 'Yearly',
      purchase_start_from: today,
      purchase_expiry: '',
      purchase_date_diff_months: 0,
      purchase_date_diff_days: 0,
      // For Renewals, explicitly set internal types
      billing_activity_type: 'New',
      purchase_activity_type: 'Renewal'
    });
    setCustomerSearch('');
    setShowModal(true);
  };

  const openEditActivity = async (a: Activity) => {
    const server = null;

    // Fetch Mappings for this customer to enable Server Selection Dropdown in Edit Mode
    const cId = a.customer_id || a.customer_domain_ip;
    if (cId) {
      try {
        setCustomerServers([]); // Clear previous
        const mappingRes = await mappingsApi.getAllByCustomer(cId);
        if (mappingRes.success && mappingRes.data) {
          setCustomerServers(mappingRes.data);
        }
      } catch (e) { console.error('Error fetching mappings for edit', e); }
    }

    // Find sibling if grouped
    let sibling: Activity | undefined;
    if (a.group_id) {
      sibling = localActivities.find(act => act.group_id === a.group_id && act.id !== a.id);
    }

    // Determine which activity is Sales and which is Purchase
    const isSalesRecord = a.record_nature === 'Sales' || !a.record_nature;
    const salesActivity = isSalesRecord ? a : sibling;
    const purchaseActivity = isSalesRecord ? sibling : a;

    // Base form data with common customer info
    // Use fallbacks for customer_domain_ip since it could be in different fields
    const formData: any = {
      customer_name: a.customer_name || '',
      customer_domain_ip: a.customer_domain_ip || a.customer_id || '',
      customer_id: a.customer_id || a.customer_domain_ip || '',
      server_name: a.server_name || '',
      sof_no: a.sof_no || '',
      activity_date: a.activity_date,
      bill_no: a.bill_no || '',
      bill_date: a.bill_date || '',
      group_id: a.group_id,
      is_sales: !!salesActivity,
      is_purchase: !!purchaseActivity,
      server_ip: (a as any).mapped_server_ip || (a as any).server_ip || '',
      mapped_customer_ip: (a as any).mapped_customer_ip || (a as any).customer_ip || '',
      server_id: (a as any).server_id || ''
    };

    // Populate Sales/Billing fields from Sales activity
    if (salesActivity) {
      formData.billing_units = salesActivity.billing_units;
      formData.last_bill_rate = salesActivity.last_bill_rate;
      formData.bill_amount = salesActivity.bill_amount;
      formData.billing_activity_type = salesActivity.activity_type;
      formData.activity_type = salesActivity.activity_type;
      formData.billing_cycle = salesActivity.billing_cycle;
      formData.billing_mode = (salesActivity as any).billing_mode || 'day_to_day';
      formData.start_from = salesActivity.start_from;
      formData.new_expiry_date = salesActivity.new_expiry_date;
      formData.date_diff_months = salesActivity.date_diff_months;
      formData.date_diff_days = salesActivity.date_diff_days;
      formData.bill_type = salesActivity.bill_type;
    } else {
      // Default values when no Sales activity
      formData.billing_units = 0;
      formData.last_bill_rate = 0;
      formData.bill_amount = 0;
      formData.billing_mode = 'day_to_day';
      // Use the main activity's cycle as fallback
      formData.billing_cycle = a.billing_cycle || 'Yearly';
      formData.activity_type = a.activity_type;
    }

    // Populate Purchase fields from Purchase activity
    if (purchaseActivity) {
      formData.purchase_units = purchaseActivity.purchase_units;
      formData.purchase_rate = purchaseActivity.purchase_rate;
      formData.purchase_amount = purchaseActivity.purchase_amount;
      formData.purchase_activity_type = purchaseActivity.activity_type;
      formData.purchase_cycle = purchaseActivity.billing_cycle;
      formData.purchase_billing_mode = (purchaseActivity as any).billing_mode || 'day_to_day';
      formData.purchase_start_from = purchaseActivity.start_from;
      formData.purchase_expiry = purchaseActivity.new_expiry_date;
      formData.purchase_date_diff_months = purchaseActivity.date_diff_months;
      formData.purchase_date_diff_days = purchaseActivity.date_diff_days;
    } else {
      // Default values when no Purchase activity
      formData.purchase_units = 0;
      formData.purchase_rate = 0;
      formData.purchase_amount = 0;
      formData.purchase_billing_mode = 'day_to_day';
    }

    setEditing(a);
    setForm(formData);

    // Set RenewMode state for Edit to show correct UI
    if (formData.is_purchase && !formData.is_sales) {
      setRenewMode('purchase');
      setServerSearch(a.server_name || '');
    } else {
      // For Billing or Mixed, ensure Customer Name is set
      setRenewMode(formData.is_sales && !formData.is_purchase ? 'billing' : null);

      let initialCustomerName = a.customer_name || '';
      // Fallback: Lookup by ID if name is missing (common with joined queries or loose objects)
      if (!initialCustomerName && (a.customer_id || a.customer_domain_ip)) {
        const found = localCustomers.find(c => c.id === a.customer_id || c.id === a.customer_domain_ip);
        if (found) initialCustomerName = found.company;
      }
      setCustomerSearch(initialCustomerName);
      // Ensure form state also has the name
      setForm(prev => ({ ...prev, customer_name: initialCustomerName }));
    }

    setShowModal(true);
  };

  // Helper: Parse date string (YYYY-MM-DD or DD/MM/YYYY) for sorting
  const parseSortDate = (d: string | null | undefined) => {
    if (!d) return 0;
    if (d.includes('/')) {
      const [day, month, year] = d.split('/').map(Number);
      return new Date(year, month - 1, day).getTime();
    }
    return new Date(d).getTime();
  };

  // Helper: Get running plan expiry for a customer (BILLING)
  const getRunningPlanExpiry = (customerId: string, serverIp?: string) => {
    const customer = localCustomers.find((c: any) => c.id === customerId);
    const legacyId = customer?.customerid;

    const relevant = localActivities
      .filter(a => (a.customer_domain_ip === customerId || a.customer_id === customerId || (legacyId && (a.customer_domain_ip === legacyId || a.customer_id === legacyId))) && (a.activity_type === 'New' || a.activity_type === 'Renewal'))
      .filter(a => !serverIp || a.server_name === serverIp || a.server_ip === serverIp)
      .sort((a, b) => parseSortDate(a.new_expiry_date) - parseSortDate(b.new_expiry_date));
    const last = relevant.pop();
    return last ? last.new_expiry_date : '';
  };

  // Helper: Get running PURCHASE expiry for a customer (from server's server_expiry field)
  const getRunningPurchaseExpiry = (customerId: string, serverIp?: string) => {
    const customer = localCustomers.find((c: any) => c.id === customerId);
    const legacyId = customer?.customerid;

    // Note: Can't do sync mapping lookup - just use activities fallback

    // Fallback: Get from last New/Renewal activity's purchase_expiry
    const relevant = localActivities
      .filter(a => (a.customer_domain_ip === customerId || a.customer_id === customerId || (legacyId && (a.customer_domain_ip === legacyId || a.customer_id === legacyId))) && (a.activity_type === 'New' || a.activity_type === 'Renewal'))
      .filter(a => !serverIp || a.server_name === serverIp || a.server_ip === serverIp)
      .sort((a, b) => parseSortDate((a as any).purchase_expiry) - parseSortDate((b as any).purchase_expiry));
    const last = relevant.pop();
    return last ? (last as any).purchase_expiry : '';
  };

  // Helper: Get running plan details (Start + Expiry)
  const getRunningPlanDetails = (customerId: string, serverIp?: string) => {
    const customer = localCustomers.find((c: any) => c.id === customerId);
    const legacyId = customer?.customerid;

    const relevant = localActivities
      .filter(a => (a.customer_domain_ip === customerId || a.customer_id === customerId || (legacyId && (a.customer_domain_ip === legacyId || a.customer_id === legacyId))) && (a.activity_type === 'New' || a.activity_type === 'Renewal'))
      .filter(a => !serverIp || a.server_name === serverIp || a.server_ip === serverIp)
      .sort((a, b) => parseSortDate(a.new_expiry_date) - parseSortDate(b.new_expiry_date));

    const last = relevant.pop();
    if (!last) return null;
    return {
      start: last.start_from || last.activity_date,
      expiry: last.new_expiry_date
    };
  };

  const updateAvailableTypes = (customerId: string, checkDate: string = toLocalDateString()) => {
    // Always allow all types for manual selection
    const types = ['New', 'User'];
    setAvailableActivityTypes(types);
    return types;
  };

  const handleActivityTypeChange = (type: Activity['activity_type']) => {
    let newExpiry = form.new_expiry_date;
    let startFrom = form.start_from || form.activity_date;
    const newMode = form.billing_mode; // Keep existing mode logic

    // Force Tax Invoice if not User
    const isUser = type === 'User';
    const newBillType = isUser ? form.bill_type : 'Tax Invoice';
    const newBillingUnits = Math.abs(Number(form.billing_units) || 0); // Reset to positive when switching types/modes potential

    // Calculate SEPARATE expiries for Billing and Purchase
    let purchaseExpiry = form.new_expiry_date;
    let purchaseStartFrom = form.start_from || form.activity_date;

    if (type === 'User') {
      // For User type, fetch the existing plan expiry (co-terminus)
      const planExpiry = getRunningPlanExpiry(form.customer_domain_ip, form.server_ip || form.server_name);
      const { year, month } = getISTDateParts(form.activity_date);
      const lastDay = getDaysInMonth(year, month);
      const endOfMonthExpiry = toLocalDateString(getSafeISTDate(year, month, lastDay));

      // Calculate purchase expiry based on mode
      if ((form as any).purchase_billing_mode === 'month_to_month') {
        purchaseExpiry = endOfMonthExpiry;
      } else {
        purchaseExpiry = planExpiry || form.purchase_expiry || endOfMonthExpiry;
      }

      // Calculate billing expiry: use plan expiry if exists, otherwise end of month
      if (form.billing_mode === 'month_to_month') {
        newExpiry = planExpiry || endOfMonthExpiry;
      } else {
        newExpiry = planExpiry || endOfMonthExpiry;
      }

      startFrom = form.activity_date;
      purchaseStartFrom = form.activity_date;
    } else if (type === 'New' || type === 'Renewal') {
      const baseDate = form.start_from || form.activity_date;
      const { year, month, day } = getISTDateParts(baseDate);

      // Get cycle months for Billing
      const billingCycleMonths = form.billing_cycle === 'Monthly' ? 1
        : form.billing_cycle === 'Quarterly' ? 3
          : form.billing_cycle === 'Half-Yearly' ? 6 : 12;

      // Get cycle months for Purchase (from form, which comes from server)
      const purchaseCycle = (form as any).purchase_cycle || 'Yearly';
      const purchaseCycleMonths = purchaseCycle === 'Monthly' ? 1
        : purchaseCycle === 'Quarterly' ? 3
          : purchaseCycle === 'Half-Yearly' ? 6 : 12;

      // BILLING: Calculate expiry based on billing_mode and billing_cycle
      if (form.billing_mode === 'month_to_month') {
        const lastDay = getDaysInMonth(year, month);
        newExpiry = toLocalDateString(getSafeISTDate(year, month, lastDay));
      } else {
        let targetYear = year;
        let targetMonth = month + billingCycleMonths;
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
        const maxDays = getDaysInMonth(targetYear, targetMonth);
        const targetDay = Math.min(day, maxDays);
        newExpiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
      }

      // PURCHASE: Calculate expiry based on purchase_billing_mode and purchase_cycle
      if ((form as any).purchase_billing_mode === 'month_to_month') {
        const lastDay = getDaysInMonth(year, month);
        purchaseExpiry = toLocalDateString(getSafeISTDate(year, month, lastDay));
      } else {
        let targetYear = year;
        let targetMonth = month + purchaseCycleMonths;
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
        const maxDays = getDaysInMonth(targetYear, targetMonth);
        const targetDay = Math.min(day, maxDays);
        purchaseExpiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
      }

      startFrom = form.activity_date;
      purchaseStartFrom = form.activity_date;
    }

    // For User type, get rate and expiry from customer's LAST New/Renewal activity
    let userTypeRate = form.last_bill_rate;
    let userTypePurchaseRate = form.purchase_rate;
    let userTypeExpiry = newExpiry;
    let userTypePurchaseExpiry = purchaseExpiry;

    if (type === 'User') {
      const customer = localCustomers.find((c: any) => c.id === form.customer_domain_ip);
      const legacyId = customer?.customerid;

      // Find last New/Renewal activity for this customer
      const lastNewRenewal = localActivities
        .filter(a => (a.customer_domain_ip === form.customer_domain_ip || a.customer_id === form.customer_domain_ip || (legacyId && (a.customer_domain_ip === legacyId || a.customer_id === legacyId))) && (a.activity_type === 'New' || a.activity_type === 'Renewal'))
        .sort((a, b) => (a.new_expiry_date || '').localeCompare(b.new_expiry_date || ''))
        .pop();

      if (lastNewRenewal) {
        userTypeRate = lastNewRenewal.last_bill_rate || form.last_bill_rate;
        userTypePurchaseRate = lastNewRenewal.purchase_rate || form.purchase_rate;
        userTypeExpiry = lastNewRenewal.new_expiry_date || newExpiry;
        userTypePurchaseExpiry = (lastNewRenewal as any).purchase_expiry || purchaseExpiry;
      }
    }

    setForm(prev => ({
      ...prev,
      activity_type: type,
      billing_activity_type: type,
      start_from: startFrom,
      new_expiry_date: type === 'User' ? userTypeExpiry : newExpiry,
      purchase_start_from: purchaseStartFrom,
      purchase_expiry: type === 'User' ? userTypePurchaseExpiry : purchaseExpiry,
      bill_type: newBillType,
      billing_units: newBillType === 'Tax Invoice' ? newBillingUnits : -newBillingUnits,
      // For User type, auto-fetch rate from customer's existing data
      ...(type === 'User' ? {
        last_bill_rate: userTypeRate,
        purchase_rate: userTypePurchaseRate,
      } : {}),
    } as any));
  };

  const handleBillingCycleChange = (cycle: Activity['billing_cycle']) => {
    setForm(prev => {
      const updated = { ...prev, billing_cycle: cycle };
      const baseDate = updated.start_from || updated.activity_date;

      if (updated.activity_type === 'New' || updated.activity_type === 'Renewal') {
        const { year, month, day } = getISTDateParts(baseDate);

        // Always calculate based on Cycle
        if (updated.billing_mode === 'month_to_month') {
          // M2M: End of CURRENT month
          const lastDay = getDaysInMonth(year, month);
          updated.new_expiry_date = toLocalDateString(getSafeISTDate(year, month, lastDay));
        } else {
          // D2D: Add Cycle Months
          const cycleMonths = cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Half-Yearly' ? 6 : 12;
          let targetYear = year;
          let targetMonth = month + cycleMonths;
          while (targetMonth > 11) {
            targetYear += 1;
            targetMonth -= 12;
          }
          const maxDays = getDaysInMonth(targetYear, targetMonth);
          const targetDay = Math.min(day, maxDays);
          updated.new_expiry_date = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
        }
      }
      return updated;
    });
  };


  const handlePurchaseBillingModeChange = (mode: 'day_to_day' | 'month_to_month') => {
    setForm(prev => {
      const updated = { ...prev, purchase_billing_mode: mode };
      const pType = updated.purchase_activity_type || 'New';
      const baseDate = updated.purchase_start_from || updated.activity_date;

      if (pType === 'New' || pType === 'Renewal') {
        const { year, month, day } = getISTDateParts(baseDate);
        const cycle = updated.purchase_cycle || 'Yearly';

        if (mode === 'month_to_month') {
          const lastDay = getDaysInMonth(year, month);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(year, month, lastDay));
        } else {
          // D2D
          const cycleMonths = cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Half-Yearly' ? 6 : 12;
          let targetYear = year;
          let targetMonth = month + cycleMonths;
          while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
          const maxDays = getDaysInMonth(targetYear, targetMonth);
          const targetDay = Math.min(day, maxDays);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
        }
      }
      return updated;
    });
  };

  const handleBillingModeChange = (mode: 'day_to_day' | 'month_to_month') => {
    setForm(prev => {
      const updated = { ...prev, billing_mode: mode };
      const baseDate = updated.start_from || updated.activity_date;

      if (updated.activity_type === 'New' || updated.activity_type === 'Renewal' || updated.activity_type === 'User') {
        const { year, month, day } = getISTDateParts(baseDate);
        const cycleMonths = updated.billing_cycle === 'Monthly' ? 1 : updated.billing_cycle === 'Quarterly' ? 3 : updated.billing_cycle === 'Half-Yearly' ? 6 : 12;

        if (mode === 'month_to_month') {
          // M2M Logic
          if (updated.activity_type === 'User') {
            // Keep existing expiry for User
            updated.new_expiry_date = prev.new_expiry_date;
          } else {
            // Standard M2M (End of Current Month)
            const lastDay = getDaysInMonth(year, month);
            updated.new_expiry_date = toLocalDateString(getSafeISTDate(year, month, lastDay));
          }
        } else {
          // D2D: Add Cycle Months
          let targetYear = year;
          let targetMonth = month + cycleMonths;
          while (targetMonth > 11) {
            targetYear += 1;
            targetMonth -= 12;
          }
          const maxDays = getDaysInMonth(targetYear, targetMonth);
          const targetDay = Math.min(day, maxDays);
          updated.new_expiry_date = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
        }
      }
      return updated;
    });
  };

  const handleStartDateChange = (startDate: string) => {
    setForm(prev => {
      const updated = { ...prev, start_from: startDate };
      const bType = updated.billing_activity_type || updated.activity_type;

      if (bType === 'New' || bType === 'Renewal' || bType === 'User') {
        const { year, month, day } = getISTDateParts(startDate);
        const cycleMonths = updated.billing_cycle === 'Monthly' ? 1 : updated.billing_cycle === 'Quarterly' ? 3 : updated.billing_cycle === 'Half-Yearly' ? 6 : 12;

        if (updated.billing_mode === 'month_to_month') {
          // M2M Logic
          if (bType === 'User') {
            // Keep existing expiry for User
            updated.new_expiry_date = prev.new_expiry_date;
          } else {
            const lastDay = getDaysInMonth(year, month);
            updated.new_expiry_date = toLocalDateString(getSafeISTDate(year, month, lastDay));
          }
        } else {
          // D2D Logic
          if (bType === 'User') {
            // Keep existing expiry for User
             updated.new_expiry_date = prev.new_expiry_date;
          } else {
             // D2D: Add Cycle Months
             let targetYear = year;
             let targetMonth = month + cycleMonths;
             while (targetMonth > 11) {
               targetYear += 1;
               targetMonth -= 12;
             }
             const maxDays = getDaysInMonth(targetYear, targetMonth);
             const targetDay = Math.min(day, maxDays);
             updated.new_expiry_date = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
          }
        }
      }
      return updated;
    });
  };

  // Purchase-specific handlers for independent Purchase section
  const handlePurchaseStartDateChange = (startDate: string) => {
    setForm(prev => {
      const updated: any = { ...prev, purchase_start_from: startDate };
      const pType = updated.purchase_activity_type || 'New';

      if (pType === 'New' || pType === 'Renewal') {
        const { year, month, day } = getISTDateParts(startDate);

        // Always calculate based on Cycle
        if (updated.purchase_billing_mode === 'month_to_month') {
          // M2M: End of Start Date's Month
          const lastDay = getDaysInMonth(year, month);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(year, month, lastDay));
        } else {
          // D2D: Start Date + Cycle Months
          const cycleMonths = updated.purchase_cycle === 'Monthly' ? 1
            : updated.purchase_cycle === 'Quarterly' ? 3
              : updated.purchase_cycle === 'Half-Yearly' ? 6
                : 12;

          let targetYear = year;
          let targetMonth = month + cycleMonths;
          while (targetMonth > 11) {
            targetYear += 1;
            targetMonth -= 12;
          }
          const maxDays = getDaysInMonth(targetYear, targetMonth);
          const targetDay = Math.min(day, maxDays);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
        }
      } else if (pType === 'User') {
        // For User type, use the existing PURCHASE expiry (from server's New/Renewal)
        const purchaseExpiry = getRunningPurchaseExpiry(prev.customer_domain_ip, prev.server_ip || prev.server_name);
        if (purchaseExpiry) {
          updated.purchase_expiry = purchaseExpiry;
        }
      }
      return updated;
    });
  };

  // Handle Purchase Activity Type change independently
  const handlePurchaseTypeChange = (type: 'New' | 'Renewal' | 'User') => {
    setForm(prev => {
      const updated: any = { ...prev, purchase_activity_type: type };
      const baseDate = updated.purchase_start_from || updated.activity_date;
      const { year, month, day } = getISTDateParts(baseDate);

      if (type === 'User') {
        // For User type, use the existing PURCHASE expiry (from server's New/Renewal)
        const purchaseExpiry = getRunningPurchaseExpiry(prev.customer_domain_ip, prev.server_ip || prev.server_name);
        if (purchaseExpiry) {
          updated.purchase_expiry = purchaseExpiry;
        }
      } else {
        // For New/Renewal, calculate based on cycle and mode
        const purchaseCycle = updated.purchase_cycle || 'Yearly';
        const cycleMonths = purchaseCycle === 'Monthly' ? 1
          : purchaseCycle === 'Quarterly' ? 3
            : purchaseCycle === 'Half-Yearly' ? 6 : 12;

        if (updated.purchase_billing_mode === 'month_to_month') {
          // M2M: End of Cycle Month
          // Target Month = Start Month + (Cycle Months-1)
          let targetYear = year;
          let targetMonth = month + (cycleMonths - 1);
          while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
          const lastDay = getDaysInMonth(targetYear, targetMonth);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, lastDay));
        } else {
          // D2D: Add cycle months
          let targetYear = year;
          let targetMonth = month + cycleMonths;
          while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
          const maxDays = getDaysInMonth(targetYear, targetMonth);
          const targetDay = Math.min(day, maxDays);
          updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
        }
      }
      return updated;
    });
  };

  const handlePurchaseCycleChange = (cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly') => {
    setForm(prev => {
      const updated: any = { ...prev, purchase_cycle: cycle };
      // Recalculate expiry based on new cycle for purchase
      const baseDate = updated.purchase_start_from || updated.activity_date;
      const { year, month, day } = getISTDateParts(baseDate);

      if (updated.purchase_billing_mode === 'month_to_month') {
        // M2M: End of Cycle Month
        const cycleMonths = cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Half-Yearly' ? 6 : 12;
        let targetYear = year;
        let targetMonth = month + (cycleMonths - 1);
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
        const lastDay = getDaysInMonth(targetYear, targetMonth);
        updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, lastDay));
      } else {
        // D2D: Start Date + Cycle Months
        const cycleMonths = cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Half-Yearly' ? 6 : 12;
        let targetYear = year;
        let targetMonth = month + cycleMonths;
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }
        const maxDays = getDaysInMonth(targetYear, targetMonth);
        const targetDay = Math.min(day, maxDays);
        updated.purchase_expiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
      }
      return updated;
    });
  };

  const handleRenewServerSelect = (server: any) => {
    // 1. Set Start Date -> Server Expiry + 1 Day
    // User Requirement: "start date is the +1 day with last expiry"
    // 1. Fetch Config
    const rate = server.purchase_rate || 0;
    const units = getTotalPurchaseUsersByServerId(server.id);
    const cycle = server.billing_cycle || 'Yearly';
    const mode = (server.billing_mode || 'day_to_day') as any;

    // 2. Calculate Renewal Config
    const config = calculateNextActivityConfig(
      server.server_expiry || null,
      cycle,
      mode,
      0, // Bill Rate not used for server
      0, // Bill Units not used for server
      rate,
      units
    );

    const startFrom = config.start_from;
    const expiry = config.new_expiry_date;

    // 4. Set Form
    setForm(prev => ({
      ...prev,
      customer_name: (server as any).mapped_customer_name || server.company || '',
      customer_domain_ip: (server as any).mapped_customer_id || '',
      customer_id: (server as any).mapped_customer_id || '',
      server_name: server.customer_ip || server.server_ip,
      server_ip: server.server_ip,
      mapped_customer_ip: server.customer_ip || '',
      activity_date: toLocalDateString(), // Current Date
      start_from: startFrom,
      purchase_start_from: startFrom,
      purchase_expiry: expiry, // Set calculated expiry
      purchase_rate: rate,
      purchase_units: units,
      purchase_cycle: cycle,
      purchase_billing_mode: mode,
      is_purchase: true, // Ensure flags are set for Purchase Renewal
      is_sales: false
    }));
    setServerSearch(server.customer_ip || server.server_ip);
    setShowServerDropdown(false);
  };


  // Accepts the picked customer OBJECT when available — resolving by name
  // alone breaks for duplicate company names (two customers, same name,
  // only one mapped): the lookup could land on the unmapped twin and the
  // renewal died with "not mapped to any server".
  const handleCustomerChange = async (customerName: string, picked?: any) => {
    const customer = picked ?? localCustomers.find((c: any) => c.company === customerName);
    if (customer) {
      // 1. Fetch Mapping
      let mapping: any = null;
      try {
        const res = await mappingsApi.getByCustomer(customer.id);
        if (res.success && res.data) {
          mapping = res.data;
        }
      } catch (err) {
        console.error('Failed to fetch mapping:', err);
      }

      if (!mapping) {
        // Fallback check from getAllMappings
        try {
          const allRes = await mappingsApi.getAllByCustomer(customer.id);
          if (allRes.success && allRes.data && allRes.data.length > 0) {
            mapping = allRes.data[0];
          }
        } catch (e) {}
      }

      if (!mapping) {
        showError('Error', 'This customer is not mapped to any server. Please map them first.');
        setCustomerSearch('');
        setShowCustomerDropdown(false);
        return;
      }

      // 2. Fetch Server Details & Determine multi-server context FIRST
      let apiDefaults: any = null;
      let server: any = null;

      // FETCH ALL SERVERS FOR THIS CUSTOMER (For Dropdown)
      let isMultiServerPending = false; // True when multi-server and user hasn't picked yet
      try {
        const allMappingsRes = await mappingsApi.getAllByCustomer(customer.id);
        if (allMappingsRes.success && allMappingsRes.data) {
          const mappings = allMappingsRes.data;
          setCustomerServers(mappings);

          let autoSelectMapping = null;

          // Check if search term matches a specific server
          if (customerSearch && mappings.length > 0) {
            const searchTerm = customerSearch.toLowerCase().trim();
            autoSelectMapping = mappings.find((m: any) =>
              (m.server_ip && m.server_ip.toLowerCase().includes(searchTerm)) ||
              (m.customer_ip && m.customer_ip.toLowerCase().includes(searchTerm)) ||
              (m.serial_no && m.serial_no.toLowerCase().includes(searchTerm))
            );
          }

          // Fallback: If only one server, auto-select it
          if (!autoSelectMapping && mappings.length === 1) {
            autoSelectMapping = mappings[0];
          }

          if (autoSelectMapping) {
            mapping = autoSelectMapping;

            // Fetch full server details for rates/modes
            if (autoSelectMapping.server_id) {
              try {
                const sRes = await serversApi.getById(autoSelectMapping.server_id);
                if (sRes.success) server = sRes.data;
              } catch (e) { console.error('Error fetching server details', e); }
            }
          } else if (mappings.length > 1) {
            // Multiple servers, none auto-selected — user must pick from dropdown
            isMultiServerPending = true;
          }
        } else {
          setCustomerServers([]);
        }
      } catch (err) {
        console.error('Failed to fetch customer servers:', err);
        setCustomerServers([]);
      }

      // Only fetch server details for single-server or auto-selected case
      if (!isMultiServerPending && !server && mapping && mapping.server_id) {
        try {
          const sRes = await serversApi.getById(mapping.server_id);
          if (sRes.success) {
            server = sRes.data;
          } else {
            console.error('Failed to fetch server details:', (sRes as any).message || 'Unknown error');
          }
        } catch (e) {
          console.error('Error fetching server details:', e);
        }
      }

      // 3. Fetch API Renewal Defaults ONLY when we know which server (skip for multi-server pending)
      if (!isMultiServerPending) {
        const serverNameForApi = server?.customer_ip || mapping?.customer_ip || server?.server_ip || '';
        try {
          const res = await activitiesApi.getRenewalDefaults(customer.id, 'customer', serverNameForApi || undefined);
          if (res.success && res.data) {
            apiDefaults = res.data;
            setCurrentPlanDetails(apiDefaults);
          }
        } catch (err) {
          console.error('Failed to fetch renewal defaults:', err);
        }
      } else {
        // Multi-server: clear plan details so billing total doesn't show stale data
        setCurrentPlanDetails(null);
      }

      // 4. Prepare Merged Defaults (API > Local Fallback)

      // 4. Prepare Merged Defaults (API > Local Fallback)
      const mergedDefaults = apiDefaults || {
        start_date: toLocalDateString(),
        cycle: 'Yearly',
        mode: 'day_to_day',
        rate: 0,
        billing_units: mapping.billed_users || 0,
        units: mapping.billed_users || 0
      };

      // 5. Calculate Rates and Modes

      const serverName = server?.customer_ip || server?.server_ip || '';
      const serverIp = server?.server_ip || '';
      const mappedCustomerIp = server?.customer_ip || '';

      // 5. Calculate Rates and Modes
      const serverPurchaseRate = (renewMode === 'purchase' && mergedDefaults.rate) ? mergedDefaults.rate : (server?.purchase_rate || 0);

      const lastAct = localActivities.find(a => a.customer_domain_ip === customer.id || a.customer_id === customer.id);
      let lastRate = 0;
      if (renewMode === 'billing' && mergedDefaults.rate) lastRate = mergedDefaults.rate;
      else if (lastAct?.last_bill_rate) lastRate = lastAct.last_bill_rate;

      const defaultsBillingMode = (renewMode === 'billing' ? mergedDefaults.mode : (server?.billing_mode || 'day_to_day'));
      const defaultsBillingCycle = (renewMode === 'billing' ? mergedDefaults.cycle : (server?.billing_cycle || 'Yearly'));

      const defaultsPurchaseMode = (renewMode === 'purchase' ? mergedDefaults.mode : (server?.billing_mode || 'day_to_day'));
      const defaultsPurchaseCycle = (renewMode === 'purchase' ? mergedDefaults.cycle : (server?.billing_cycle || 'Yearly'));

      // Use last_expiry directly as start date ("renew start date is the expiry from last activity")
      const defaultDate = apiDefaults?.last_expiry || mergedDefaults.start_date || form.activity_date || toLocalDateString();

      // 6. Types and Defaults
      // 6. Types and Defaults

      // Determine activity type based on plan dates
      let availableTypes = ['New'];
      let autoSelectedType: Activity['activity_type'] = 'New';

      if (apiDefaults?.current_plan_start && apiDefaults?.current_plan_expiry) {
        // Helper to parse "dd/mm/yyyy" to comparable number yyyymmdd
        const parseDate = (d: string) => {
          if (!d) return 0;
          const parts = d.split('/');
          if (parts.length !== 3) return 0;
          const [day, month, year] = parts.map(Number);
          return year * 10000 + month * 100 + day;
        };

        const checkDateNum = parseDate(defaultDate);
        const startNum = parseDate(apiDefaults.current_plan_start);
        const expiryNum = parseDate(apiDefaults.current_plan_expiry);

        if (checkDateNum >= startNum && checkDateNum <= expiryNum) {
          availableTypes = ['New', 'User'];
          if (!renewMode) autoSelectedType = 'User'; // Auto-select User if not renewing
        } else {
          availableTypes = ['New'];
        }
      } else {
        // Fallback to local check if API defaults missing plan info but we want to be safe
        // But updateAvailableTypes logic below will handle the UI state primarily.
        // Here we just set initial form state.
        availableTypes = ['New'];
      }

      // Override if user manually forced (we will update available types state below)
      // Actually, we should sync this logic.

      // Update the available types state immediately
      setAvailableActivityTypes(availableTypes);

      const defaultType = renewMode ? 'Renewal' : autoSelectedType;

      setForm(prev => ({
        ...prev,
        customer_name: customerName,
        customer_domain_ip: customer.id,
        activity_type: defaultType,
        billing_activity_type: defaultType,
        purchase_activity_type: defaultType,
        activity_date: isMultiServerPending ? toLocalDateString() : defaultDate,

        // For multi-server pending: clear server-specific fields — user must pick from dropdown
        ...(isMultiServerPending ? {
          server_name: '',
          server_ip: '',
          mapped_customer_ip: '',
          server_id: '',
          last_bill_rate: '',
          purchase_rate: '',
          billing_units: '',
          purchase_units: '',
          billing_mode: 'day_to_day' as any,
          purchase_billing_mode: 'day_to_day' as any,
          billing_cycle: 'Yearly' as any,
          purchase_cycle: 'Yearly' as any,
          start_from: toLocalDateString(),
          purchase_start_from: toLocalDateString(),
          new_expiry_date: '',
          purchase_expiry: '',
          old_expiry_date: '',
          sof_no: '',
        } : {
          purchase_rate: serverPurchaseRate || '',
          last_bill_rate: lastRate || '',
          billing_units: defaultType === 'User' ? '' : ((renewMode === 'billing' ? mergedDefaults.units : (mapping?.billed_users || ''))),
          purchase_units: defaultType === 'User' ? '' : ((renewMode === 'purchase' ? mergedDefaults.units : (mapping?.purchase_users || ''))),
          server_name: serverName,
          sof_no: '',
          billing_mode: defaultType === 'User' ? defaultsBillingMode : defaultsBillingMode,
          purchase_billing_mode: defaultType === 'User' ? defaultsPurchaseMode : defaultsPurchaseMode,
          billing_cycle: defaultType === 'User' ? defaultsBillingCycle : defaultsBillingCycle,
          purchase_cycle: defaultType === 'User' ? defaultsPurchaseCycle : defaultsPurchaseCycle,
          server_ip: serverIp,
          mapped_customer_ip: mappedCustomerIp,
          server_id: mapping?.server_id || '',

          ...(defaultType === 'User' ? (() => {
            return {
              new_expiry_date: apiDefaults?.current_plan_expiry || prev.new_expiry_date || '',
              purchase_expiry: apiDefaults?.server_expiry || prev.purchase_expiry || '',
              start_from: defaultDate,
              purchase_start_from: defaultDate,
              last_bill_rate: apiDefaults?.rate || lastRate || '',
              purchase_rate: serverPurchaseRate || ''
            };
          })() : (() => {
            const { year, month, day } = getISTDateParts(defaultDate);

            let billingExp = '';
            const bCycleMonths = defaultsBillingCycle === 'Monthly' ? 1 : defaultsBillingCycle === 'Quarterly' ? 3 : defaultsBillingCycle === 'Half-Yearly' ? 6 : 12;
            if (defaultsBillingMode === 'month_to_month') {
              billingExp = toLocalDateString(getSafeISTDate(year, month, getDaysInMonth(year, month)));
            } else {
              let tY = year, tM = month + bCycleMonths;
              while (tM > 11) { tY += 1; tM -= 12; }
              billingExp = toLocalDateString(getSafeISTDate(tY, tM, Math.min(day, getDaysInMonth(tY, tM))));
            }

            let purchaseExp = '';
            const pCycleMonths = defaultsPurchaseCycle === 'Monthly' ? 1 : defaultsPurchaseCycle === 'Quarterly' ? 3 : defaultsPurchaseCycle === 'Half-Yearly' ? 6 : 12;
            if (defaultsPurchaseMode === 'month_to_month') {
              purchaseExp = toLocalDateString(getSafeISTDate(year, month, getDaysInMonth(year, month)));
            } else {
              let tY = year, tM = month + pCycleMonths;
              while (tM > 11) { tY += 1; tM -= 12; }
              purchaseExp = toLocalDateString(getSafeISTDate(tY, tM, Math.min(day, getDaysInMonth(tY, tM))));
            }

            return {
              new_expiry_date: billingExp,
              purchase_expiry: purchaseExp,
              start_from: defaultDate,
              purchase_start_from: defaultDate
            };
          })())
        })
      }));
      setCustomerSearch(customerName);
      setCustomerSearch(customerName);
      setShowCustomerDropdown(false);
    }
  };

  const handleServerSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sId = e.target.value;
    const selectedMapping = customerServers.find(s => s.server_id === sId);
    if (!selectedMapping) return;

    const serverName = selectedMapping.customer_ip || selectedMapping.server_ip || '';

    // 2. Fetch server-specific renewal defaults (passing server_name for filtering)
    try {
      const customerId = form.customer_domain_ip || (form as any).customer_id;
      let apiDefaults: any = null;
      if (customerId) {
        try {
          // Pass serverName so backend filters last activity by this specific server
          const res = await activitiesApi.getRenewalDefaults(customerId, 'customer', serverName);
          if (res.success && res.data) {
            apiDefaults = res.data;
            setCurrentPlanDetails(res.data);
          }
        } catch (e) { console.error('Error fetching server-specific renewal defaults', e); }
      }

      // 3. Priority: API defaults (server-specific last activity) > mapping > fallback
      const billingRate = apiDefaults?.rate || selectedMapping.billing_rate || 0;
      const billingUnits = apiDefaults?.units || selectedMapping.billed_users || 0;
      const billingCycle = apiDefaults?.cycle || selectedMapping.billing_cycle || 'Yearly';
      const billingMode = apiDefaults?.mode || selectedMapping.billing_mode || 'day_to_day';
      const purchaseRate = selectedMapping.purchase_rate || 0;
      const purchaseUnits = selectedMapping.purchase_users || 0;

      // 4. Start date = last activity expiry for this server
      const startFrom = apiDefaults?.last_expiry || selectedMapping.expiry_date || toLocalDateString();

      // 5. Calculate expiry based on cycle - ONLY IF NOT 'User'
      // If 'User', we should rely on the API's reported current_plan_expiry
      let expiryDate = '';
      if (form.activity_type === 'User') {
         expiryDate = apiDefaults?.current_plan_expiry || startFrom;
      } else {
        const { year, month, day } = getISTDateParts(startFrom);
        const cycleMonths = billingCycle === 'Monthly' ? 1 : billingCycle === 'Quarterly' ? 3 : billingCycle === 'Half-Yearly' ? 6 : 12;
        if (billingMode === 'month_to_month') {
          expiryDate = toLocalDateString(getSafeISTDate(year, month, getDaysInMonth(year, month)));
        } else {
          let tY = year, tM = month + cycleMonths;
          while (tM > 11) { tY += 1; tM -= 12; }
          expiryDate = toLocalDateString(getSafeISTDate(tY, tM, Math.min(day, getDaysInMonth(tY, tM))));
        }
      }

      // 6. Update form with server-specific details
      setForm(prev => ({
        ...prev,
        server_id: sId,
        server_name: serverName,
        server_ip: selectedMapping.server_ip || '',
        mapped_customer_ip: selectedMapping.customer_ip || '',
        last_bill_rate: billingRate,
        billing_units: billingUnits,
        billing_cycle: billingCycle,
        billing_mode: billingMode,
        purchase_rate: purchaseRate,
        purchase_units: purchaseUnits,
        purchase_cycle: billingCycle,
        purchase_billing_mode: billingMode,
        start_from: startFrom,
        purchase_start_from: startFrom,
        new_expiry_date: expiryDate,
        purchase_expiry: expiryDate,
        old_expiry_date: apiDefaults?.last_expiry || selectedMapping.expiry_date || '',
      }));
    } catch (err) {
      console.error('Error auto-filling server details:', err);
    }
  };

  const handleSave = async () => {
    if (saving || isSavingRef.current) return; // Prevent double submission
    isSavingRef.current = true;
    // 1. Strict Validation
    // Skip customer validation for Server-Centric Purchase Renewal
    if (renewMode !== 'purchase') {
      if (!form.customer_name || !form.customer_domain_ip) { showError('Error', 'Please select a valid mapped customer'); return; }
    }

    if (!form.activity_date) { showError('Error', 'Activity Date is required'); return; }
    if (form.is_sales && !form.start_from) { showError('Error', 'Billing Start Date is required'); return; }
    if (form.is_purchase && !form.purchase_start_from) { showError('Error', 'Purchase Start Date is required'); return; }

    // Strict Expiry Check - Mandatory for ALL types now
    if (!form.new_expiry_date) { showError('Error', 'Expiry Date is required'); return; }

    const safeForm: Omit<Activity, 'id'> = {
      ...form,
      // STRICT SEPARATION: If Purchase Renewal, zero out Billing fields. If Billing Renewal, zero out Purchase fields.
      billing_units: renewMode === 'purchase' ? 0 : (Number(form.billing_units) || 0),
      last_bill_rate: renewMode === 'purchase' ? 0 : (Number(form.last_bill_rate) || 0),
      bill_amount: renewMode === 'purchase' ? 0 : (Number(form.bill_amount) || 0),

      purchase_units: renewMode === 'billing' ? 0 : (Number(form.purchase_units) || 0),
      purchase_rate: renewMode === 'billing' ? 0 : (Number(form.purchase_rate) || 0),
      purchase_amount: renewMode === 'billing' ? 0 : (Number(form.purchase_amount) || 0),

      // Ensure flags are mutually exclusive if in renew mode
      is_sales: renewMode === 'purchase' ? false : form.is_sales,
      is_purchase: renewMode === 'billing' ? false : form.is_purchase,
    };

    setSaving(true);
    try {
      if (editing) {
        await activitiesApi.update(editing.id, safeForm);
        showSuccess('Updated', 'Activity updated successfully');
      } else {
        const res: any = await activitiesApi.create({
          ...safeForm,
          // Which Sales-family voucher type the auto-invoice should use
          voucher_type_id: voucherTypeId || undefined,
        } as any);
        const created = res?.data;
        if (created?.auto_invoice_created) {
          showSuccess('Added', `Activity created — invoice ${created.voucher_no || ''} auto-generated`.trim());
        } else if (created?.auto_invoice_error) {
          showSuccess('Added', 'Activity created, but the auto-invoice failed — bill it manually.');
          showError('Auto-invoice failed', created.auto_invoice_error);
        } else {
          showSuccess('Added', 'Activity created successfully');
        }
      }
      setShowModal(false);
      fetchActivities(); // Refresh list
    } catch (err: any) {
      showError('Error', err.message || 'Failed to save activity');
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await activitiesApi.delete(deleteId);
      showSuccess('Deleted', 'Activity deleted');
      fetchActivities();
    } catch (err) {
      showError('Error', 'Failed to delete activity');
    } finally {
      setDeleteId(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const typeColor = (t: string) =>
    t === 'New' ? 'bg-green-100 text-green-700' :
      t === 'Renewal' ? 'bg-blue-100 text-blue-700' :
        'bg-orange-100 text-orange-700';

  const formatCurrency = (amt: number | string) => {
    const num = Number(amt) || 0;
    const formatted = Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return num < 0 ? `-₹${formatted} ` : `₹${formatted} `;
  };

  const formatCurrencyShort = (amt: any) => {
    const num = Math.abs(Number(amt) || 0);
    const sign = (Number(amt) || 0) < 0 ? '-' : '';
    if (num >= 100000) return `${sign}₹${(num / 100000).toFixed(1)} L`;
    if (num >= 1000) return `${sign}₹${(num / 1000).toFixed(1)} K`;
    return `${sign}₹${num.toFixed(2)} `;
  };

  // Get server company by customer_ip (used for Purchase Activity display)
  const getServerCompanyByCustomerIP = (customerIP: string): string => {
    if (!customerIP) return '-';
    const server = localServers.find((s: any) => s.customer_ip === customerIP);
    return server?.company || '-';
  };

  const totalPages = Math.ceil(total / limit);

  // Stats Calculations (Note: Currently based on local page data or should use separate API)
  const totalRevenue = localActivities.reduce((sum: number, a: any) => sum + Number((viewMode === 'purchase' ? (a.purchase_amount || 0) : (a.bill_amount || 0))), 0);
  const totalUnits = localActivities.reduce((sum: number, a: any) => sum + Number((viewMode === 'purchase' ? (a.purchase_units || 0) : (a.billing_units || 0))), 0);
  const activityCount = total; // Real total from backend

  const handleExportCSV = () => {
    const headers = ['Activity No', 'Customer', 'Server', 'SOF No', 'Date', 'Type', 'Bill Type', 'Start', 'Expiry', 'Units', 'Rate', 'Amount'];
    const rows = filteredActivities.map(a => [
      a.display_id || '-',
      viewMode === 'purchase' ? (a.server_name || '-') : a.customer_name,
      viewMode === 'purchase' ? getServerCompanyByCustomerIP(a.server_name) : (a.server_name || '-'),
      a.sof_no || '-',
      formatDate(a.activity_date),
      a.activity_type,
      a.bill_type || '-',
      formatDate(a.start_from),
      formatDate(a.new_expiry_date),
      viewMode === 'purchase' ? a.purchase_units : a.billing_units,
      viewMode === 'purchase' ? a.purchase_rate : a.last_bill_rate,
      viewMode === 'purchase' ? a.purchase_amount : a.bill_amount
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((r: any[]) => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `localActivities_export_${toLocalDateString()}.csv`;
    link.click();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <Trash2 className="h-6 w-6" />
                <h3 className="text-lg font-bold">Delete Activity?</h3>
              </div>
              <p className="text-gray-600 mb-6">Are you sure you want to delete this activity? This action cannot be undone.</p>
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
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Activities</h1>
            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${viewMode === 'purchase' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
              {viewMode === 'purchase' ? 'PURCHASE' : 'BILLING'}
            </span>
          </div>
          <p className="hidden md:block text-gray-500 text-sm">{activityCount} entries • {viewMode === 'purchase' ? 'Server purchases and renewals' : 'Customer billing and renewals'}</p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
          <button onClick={() => fetchActivities()} disabled={loading} className="hidden md:flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50" title="Refresh Data">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> <span>{loading ? 'Loading...' : 'Refresh'}</span>
          </button>
          {canView('activities') && (
            <button onClick={handleExportCSV} className="hidden md:flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors" title="Download CSV">
              <FileText className="h-4 w-4" /> <span>Export</span>
            </button>
          )}
          <button
            onClick={() => setShowFilterPopup(true)}
            className={`flex items-center gap-1.5 px-3 py-2 md:px-4 text-sm rounded-lg hover:shadow-sm transition-colors ${
              hasActiveFilters 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">Filter</span>
            {hasActiveFilters && (
              <span className="bg-white text-red-600 text-xs px-1.5 py-0.5 rounded-full font-bold">
                {[appliedFilters.customer, appliedFilters.server, appliedFilters.activityType, appliedFilters.billType, appliedFilters.cycle, appliedFilters.mode, appliedFilters.dateFrom, appliedFilters.dateTo, appliedFilters.minAmount, appliedFilters.maxAmount, appliedFilters.searchText].filter(Boolean).length}
              </span>
            )}
          </button>
          {/* Export Button - only needs view permission */}
          {canView('activities') && (
            <button
                onClick={handleExport}
                className="flex items-center justify-center gap-2 w-10 md:w-auto md:px-4 h-10 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                title="Export to Excel"
              >
                <Download className="h-4 w-4" />
                <span className="hidden md:inline">Export</span>
              </button>
          )}
          {canAdd && (
            <>
              <button onClick={handleOpenRenew} className="flex items-center gap-1.5 px-3 py-2 md:px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm">
                <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Renew</span>
              </button>
              <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 md:px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm text-sm">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Chips */}
      {hasActiveFilters && (
        <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-blue-700">Active Filters:</span>
            {appliedFilters.customer && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Customer: {appliedFilters.customer}</span>
                <button onClick={() => clearFilter('customer')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.server && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Server: {appliedFilters.server}</span>
                <button onClick={() => clearFilter('server')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.activityType && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Type: {appliedFilters.activityType}</span>
                <button onClick={() => clearFilter('activityType')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {/* Additional filter chips */}
            {appliedFilters.billType && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Bill Type: {appliedFilters.billType}</span>
                <button onClick={() => clearFilter('billType')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.cycle && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Cycle: {appliedFilters.cycle}</span>
                <button onClick={() => clearFilter('cycle')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.dateFrom && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>From: {appliedFilters.dateFrom}</span>
                <button onClick={() => clearFilter('dateFrom')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.dateTo && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>To: {appliedFilters.dateTo}</span>
                <button onClick={() => clearFilter('dateTo')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {appliedFilters.searchText && (
              <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                <span>Search: "{appliedFilters.searchText}"</span>
                <button onClick={() => clearFilter('searchText')} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <button
              onClick={resetFilters}
              className="ml-2 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Clear All
            </button>
          </div>
        </div>
      )}

      {/* Activity-bucket cards — driven by date / filter selection. New &
          Renewal use raw type buckets; the User type is split by bill_type
          (Credit Note → decrease, else increase). The "Total Billing Users"
          line shows the aggregate billing_units (or purchase_units on the
          Purchase tab) — already SUM(ABS(...)) on the backend, so a Credit
          Note of -3 contributes 3 to user_decrease. */}
      {(() => {
        const isPurchaseTab = activeTab === 'Purchase';
        const cards = [
          { key: 'new',           label: 'New',           accent: 'border-blue-300 bg-blue-50',     accentText: 'text-blue-700',    bucket: stats.new },
          { key: 'renewal',       label: 'Renew',         accent: 'border-emerald-300 bg-emerald-50', accentText: 'text-emerald-700', bucket: stats.renewal },
          { key: 'user_increase', label: 'User Increase', accent: 'border-indigo-300 bg-indigo-50', accentText: 'text-indigo-700', bucket: stats.user_increase },
          { key: 'user_decrease', label: 'User Decrease', accent: 'border-rose-300 bg-rose-50',     accentText: 'text-rose-700',    bucket: stats.user_decrease },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {cards.map(c => (
              <div key={c.key} className={`border ${c.accent} rounded-lg px-3 py-2.5 shadow-sm`}>
                <div className={`text-[11px] font-bold uppercase tracking-wide ${c.accentText}`}>{c.label}</div>
                <div className="mt-1 space-y-0.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Total {isPurchaseTab ? 'Purchases' : 'Bills'}</span>
                    <span className="font-bold text-gray-800 tabular-nums">{c.bucket.count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">{isPurchaseTab ? 'Total Purchase Users' : 'Total Billing Users'}</span>
                    <span className="font-bold text-gray-800 tabular-nums">{Number(c.bucket.units_total).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Total Amount</span>
                    <span className="font-bold text-gray-800 tabular-nums">
                      ₹{Number(c.bucket.amount_total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* FilterModal */}
      <FilterModal
        isOpen={showFilterPopup}
        onClose={() => setShowFilterPopup(false)}
        title="Filter Activities"
        config={[
          { key: 'customer', label: 'Customer', type: 'text', placeholder: 'Search customer...' },
          { key: 'server', label: 'Server', type: 'text', placeholder: 'Search server IP...' },
          { key: 'activityType', label: 'Activity Type', type: 'select', options: [
            { value: 'New', label: 'New' },
            { value: 'Renewal', label: 'Renew' },
            { value: 'User', label: 'User' },
          ] },
          { key: 'billType', label: 'Bill Type', type: 'select', options: [
            { value: 'Tax Invoice', label: 'Tax Invoice' },
            { value: 'Credit Note', label: 'Credit Note' },
          ] },
          { key: 'cycle', label: 'Billing Cycle', type: 'select', options: [
            { value: 'Monthly', label: 'Monthly' },
            { value: 'Quarterly', label: 'Quarterly' },
            { value: 'Half-Yearly', label: 'Half-Yearly' },
            { value: 'Yearly', label: 'Yearly' },
          ] },
          { key: 'mode', label: 'Billing Mode', type: 'select', options: [
            { value: 'day_to_day', label: 'Day to Day' },
            { value: 'month_to_month', label: 'Month to Month' },
          ] },
          { key: 'dateFrom', label: 'From Date', type: 'date' },
          { key: 'dateTo', label: 'To Date', type: 'date' },
          { key: 'minAmount', label: 'Min Amount', type: 'number' },
          { key: 'maxAmount', label: 'Max Amount', type: 'number' },
        ] as FilterConfig[]}
        currentFilters={appliedFilters}
        onApply={(filters) => {
          // Sanitize 'all' default values from FilterModal selects to empty strings
          const sanitized: Record<string, any> = {};
          for (const [key, value] of Object.entries(filters)) {
            sanitized[key] = value === 'all' ? '' : value;
          }
          const newApplied = { ...appliedFilters, ...sanitized };
          setAppliedFilters(newApplied);
          setPendingFilters(newApplied);
          setPage(1);
          fetchActivities(newApplied);
          fetchStats(newApplied);
        }}
        onReset={() => {
          resetFilters();
        }}
      />

      {/* Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* Mobile Cards (New Grid Layout) */}
        <div className="space-y-3 md:hidden">
          {filteredActivities.map(a => (
            <div key={a.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">

              {/* Row 1: Customer/Server Name + Amount + Edit */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                <span className="font-bold text-gray-900 text-base truncate">
                  {viewMode === 'purchase' ? (a.server_name || '-') : a.customer_name}
                </span>
                <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                  <span className={`font-bold text-lg ${(viewMode === 'purchase' ? a.purchase_amount : a.bill_amount) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {viewMode === 'purchase' ? formatCurrency(a.purchase_amount) : formatCurrency(a.bill_amount)}
                  </span>
                  {canEditActivity && (
                    <button onClick={() => openEditActivity(a)} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-bold uppercase transition-colors">
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Date | Type | Cycle */}
              <div className="flex items-center px-3 py-2 text-sm border-b border-gray-50">
                <span className="text-gray-500">Date :</span>
                <span className="font-semibold text-gray-900 ml-1">{formatDate(a.activity_date)}</span>
                <span className="text-gray-300 mx-2">|</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold uppercase ${typeColor(a.activity_type)}`}>{a.activity_type === 'Renewal' ? 'Renew' : a.activity_type}</span>
                <span className="text-gray-300 mx-2">|</span>
                <span className="font-semibold text-gray-900 flex-shrink-0">{a.activity_type === 'User' ? '-' : a.billing_cycle}</span>
              </div>

              {/* Row 3: Users | Rate | Period */}
              <div className="flex items-center px-3 py-2 text-sm">
                <span className="text-gray-500">Users :</span>
                <span className="font-semibold text-gray-900 ml-1">{viewMode === 'purchase' ? a.purchase_units : a.billing_units}</span>
                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                <span className="text-gray-500 flex-shrink-0">Rate :</span>
                <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{viewMode === 'purchase' ? a.purchase_rate : a.last_bill_rate}</span>
                <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                <span className="text-gray-400 text-xs flex-shrink-0 truncate">{formatDate(a.start_from)} → {formatDate(a.new_expiry_date)}</span>
              </div>
            </div>
          ))}
          {localActivities.length === 0 && (
            <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
              {isLoading ? 'Loading...' : 'No activities found.'}
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto border border-gray-300 rounded shadow-sm">
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[6%]" /><col className="w-[7%]" /><col className="w-[4%]" /><col className="w-[6%]" /><col className="w-[6%]" /><col className="w-[5%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[5%]" /><col className="w-[7%]" /><col className="w-[8%]" /><col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="bg-gray-100 uppercase text-xs tracking-wider text-gray-700">
                {isVisible('customer') && <th className="text-left px-2 py-2 font-semibold border border-gray-300 truncate">{viewMode === 'purchase' ? 'IP Interface' : 'Customer'}</th>}
                {isVisible('server_ip') && <th className="text-left px-2 py-2 font-semibold border border-gray-300 truncate">{viewMode === 'purchase' ? 'Server' : 'Server IP'}</th>}
                {isVisible('sof_no') && <th className="text-left px-2 py-2 font-semibold border border-gray-300 truncate">SOF No.</th>}
                {isVisible('date') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Date</th>}
                {isVisible('type') && <th className="text-center px-2 py-2 font-semibold border border-gray-300">Type</th>}
                {isVisible('bill_type') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Bill Type</th>}
                {isVisible('cycle') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Cycle</th>}
                {isVisible('mode') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Mode</th>}
                {isVisible('start') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Start</th>}
                {isVisible('expiry') && <th className="text-left px-2 py-2 font-semibold border border-gray-300">Expiry</th>}
                {isVisible('users') && <th className="text-right px-2 py-2 font-semibold border border-gray-300">Users</th>}
                {isVisible('rate') && <th className="text-right px-2 py-2 font-semibold border border-gray-300">{viewMode === 'purchase' ? 'P.Rate' : 'Rate'}</th>}
                {isVisible('amount') && <th className="text-left px-2 py-2 font-semibold border border-gray-300 truncate">Amount</th>}
                {isVisible('voucher_no') && <th className="text-left px-2 py-2 font-semibold border border-gray-300 truncate">Voucher No.</th>}
                <th className="text-center px-2 py-2 font-semibold border border-gray-300">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredActivities.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 border-b border-gray-300 text-[13px]">
                  {isVisible('customer') && <td className="px-2 py-1 border border-gray-200 truncate font-medium text-gray-900" style={cellStyle('customer')} onContextMenu={onCellContextMenu('customer')} title={viewMode === 'purchase' ? (a.server_name || '-') : a.customer_name}>{viewMode === 'purchase' ? (a.server_name || '-') : (a.customer_name || localCustomers.find(c => c.id === a.customer_id || c.id === a.customer_domain_ip)?.company || '-')}</td>}
                  {isVisible('server_ip') && <td className="px-2 py-1 border border-gray-200 truncate text-gray-500" style={cellStyle('server_ip')} onContextMenu={onCellContextMenu('server_ip')} title={viewMode === 'purchase' ? ((a as any).mapped_server_company || getServerCompanyByCustomerIP(a.server_name)) : (a.mapped_server_ip || a.server_ip || a.server_name)}>{viewMode === 'purchase' ? ((a as any).mapped_server_company || getServerCompanyByCustomerIP(a.server_name) || '-') : (a.mapped_server_ip || a.server_ip || a.server_name || '-')}</td>}
                  {isVisible('sof_no') && <td className="px-2 py-1 border border-gray-200 truncate" style={cellStyle('sof_no')} onContextMenu={onCellContextMenu('sof_no')} title={a.sof_no}>{a.sof_no || '-'}</td>}
                  {isVisible('date') && <td className="px-2 py-1 border border-gray-200 whitespace-nowrap" style={cellStyle('date')} onContextMenu={onCellContextMenu('date')}>{formatDate(a.activity_date)}</td>}
                  {isVisible('type') && <td className="px-2 py-1 border border-gray-200 text-center font-semibold text-xs text-gray-700 uppercase" style={cellStyle('type')} onContextMenu={onCellContextMenu('type')}>
                    {a.activity_type === 'Renewal' ? 'Renew' : a.activity_type}
                  </td>}
                  {isVisible('bill_type') && <td className="px-2 py-1 border border-gray-200 truncate max-w-[80px]" style={cellStyle('bill_type')} onContextMenu={onCellContextMenu('bill_type')} title={a.bill_type}>{a.bill_type || '-'}</td>}
                  {isVisible('cycle') && <td className="px-2 py-1 border border-gray-200 truncate" style={cellStyle('cycle')} onContextMenu={onCellContextMenu('cycle')}>{a.activity_type === 'User' ? '-' : a.billing_cycle}</td>}
                  {isVisible('mode') && <td className="px-2 py-1 border border-gray-200 truncate" style={cellStyle('mode')} onContextMenu={onCellContextMenu('mode')}>
                    {a.activity_type === 'User' ? '-' : (a.billing_mode === 'month_to_month' ? 'M2M' : 'D2D')}
                  </td>}
                  {isVisible('start') && <td className="px-2 py-1 border border-gray-200 whitespace-nowrap" style={cellStyle('start')} onContextMenu={onCellContextMenu('start')}>{formatDate(a.start_from)}</td>}
                  {isVisible('expiry') && <td className="px-2 py-1 border border-gray-200 whitespace-nowrap" style={cellStyle('expiry')} onContextMenu={onCellContextMenu('expiry')}>{formatDate(a.new_expiry_date)}</td>}
                  {isVisible('users') && <td className="px-2 py-1 border border-gray-200 text-right font-mono text-gray-700" style={cellStyle('users')} onContextMenu={onCellContextMenu('users')}>{viewMode === 'purchase' ? a.purchase_units : a.billing_units}</td>}
                  {isVisible('rate') && <td className="px-2 py-1 border border-gray-200 text-right font-mono text-gray-700" style={cellStyle('rate')} onContextMenu={onCellContextMenu('rate')}>
                    {viewMode === 'purchase'
                      ? (a.purchase_rate ? `₹${Number(a.purchase_rate).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ` : '-')
                      : `₹${Number(a.last_bill_rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} `
                    }
                  </td>}
                  {isVisible('amount') && <td className={`px-2 py-1 border border-gray-200 text-right font-mono font-bold whitespace-nowrap ${a.bill_amount < 0 ? 'text-red-600' : 'text-emerald-700'} `} style={cellStyle('amount')} onContextMenu={onCellContextMenu('amount')}>
                    {viewMode === 'purchase' ? formatCurrency(a.purchase_amount) : formatCurrency(a.bill_amount)}
                  </td>}
                  {isVisible('voucher_no') && <td className="px-2 py-1 border border-gray-200 text-gray-600 truncate" style={cellStyle('voucher_no')} onContextMenu={onCellContextMenu('voucher_no')} title={(a as any).voucher_no || '—'}>
                    {(a as any).voucher_no
                      ? <span className="font-medium text-blue-700">{(a as any).voucher_no}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>}
                  <td className="px-2 py-1 border border-gray-200 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {(() => {
                        // Activity locked once a voucher has been linked to it.
                        // Edit/Delete must go through the voucher first to keep
                        // the bill and the activity consistent.
                        const billed = !!((a as any).voucher_id || (a as any).voucher_no);
                        const lockTitle = billed ? `Linked to voucher ${(a as any).voucher_no || '#'+(a as any).voucher_id} — open the voucher to change` : '';
                        return <>
                          {canEditActivity && (
                            <button
                              onClick={() => billed ? null : openEditActivity(a)}
                              disabled={billed}
                              title={billed ? lockTitle : 'Edit'}
                              className={`p-1 rounded transition-colors ${billed ? 'text-gray-300 cursor-not-allowed' : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'}`}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDel && (
                            <button
                              onClick={() => billed ? null : handleDelete(a.id)}
                              disabled={billed}
                              title={billed ? lockTitle : 'Delete'}
                              className={`p-1 rounded transition-colors ${billed ? 'text-gray-300 cursor-not-allowed' : 'text-red-600 hover:text-red-800 hover:bg-red-50'}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>;
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Unified Pagination Controls */}
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={total}
          itemsPerPage={limit}
          loading={loading}
          sticky={false}
          className="mt-4 rounded-b-xl border-x border-b border-gray-300"
        />

        {/* Close container div */}
      </div>

      {
        showModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center pt-4 md:p-6 transition-all backdrop-blur-sm">
            <div className={`bg-white w-full ${renewMode ? 'md:max-w-4xl' : 'md:max-w-7xl'} h-auto max-h-[85vh] md:max-h-[90vh] flex flex-col shadow-2xl transform transition-all ring-1 ring-black / 5 rounded-t-2xl md:rounded-2xl mx-0 md:mx-auto`}>
              <div className="flex items-center justify-between px-4 py-2 md:px-6 md:py-3 border-b border-gray-100 shrink-0 bg-white/80 backdrop-blur-md rounded-t-2xl sticky top-0 z-10 transition-all">
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-gray-900 tracking-tight">{editing ? 'Edit Activity' : (renewMode ? 'Renew Activity - ' + (renewMode === 'purchase' ? 'Purchase' : 'Billing') : 'Create New Activity')}</span>
                  <span className="text-[10px] text-gray-500 font-medium">Configure billing and purchase details</span>
                </div>
                <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"><X className="h-5 w-5" /></button>
              </div>
              {/* CONDITIONAL: Renewal vs Add Activity */}
              {renewMode ? (
                /* ===== RENEWAL UI (Compact) ===== */
                <>
                  <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50/50 space-y-5 custom-scrollbar">
                    {/* 1. Identity Section: Customer or Server Selection */}
                    <div className="grid grid-cols-1 gap-4">
                      {renewMode === 'purchase' ? (
                        /* Purchase Renewal: Server Search */
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Server Identity</label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Search className="h-4 w-4 text-gray-400" />
                            </div>
                            <input
                              type="text"
                              value={serverSearch}
                              onChange={(e) => {
                                setServerSearch(e.target.value);
                                setShowServerDropdown(true);
                              }}
                              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                              placeholder="Type 3+ chars to search..."
                              autoFocus
                            />
                            {showServerDropdown && serverSearch && (
                              <div className="absolute z-20 mt-1 w-full bg-white shadow-xl max-h-60 rounded-lg py-1 text-sm overflow-auto ring-1 ring-black/5 focus:outline-none">
                                {serverSearch.length < 3 ? (
                                  <div className="px-3 py-2 text-gray-500 text-center">Type at least 3 characters to search...</div>
                                ) : localServers.length > 0 ? (
                                  localServers.map((server: any) => (
                                    <div
                                      key={server.id}
                                      className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-50 transition-colors"
                                      onClick={() => handleRenewServerSelect(server)}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium text-gray-900 truncate">{server.server_ip}</span>
                                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{server.customer_ip}</span>
                                      </div>
                                      <div className="text-xs text-gray-400 mt-0.5">{server.company} | Rate: {server.purchase_rate} | Cycle: {server.billing_cycle}</div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="px-3 py-2 text-gray-500 text-center">No servers found for "{serverSearch}"</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Billing Renewal: Customer Search */
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Customer Identity</label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Search className="h-4 w-4 text-gray-400" />
                            </div>
                            <input
                              type="text"
                              value={customerSearch}
                              onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setShowCustomerDropdown(true);
                              }}
                              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                              placeholder="Search Customer..."
                              autoFocus={!form.customer_domain_ip}
                            />
                            {showCustomerDropdown && customerSearch && (
                              <div className="absolute z-20 mt-1 w-full bg-white shadow-xl max-h-60 rounded-lg py-1 text-sm overflow-auto ring-1 ring-black/5 focus:outline-none">
                                {customerSearch.length < 3 ? (
                                  <div className="px-3 py-2 text-gray-500 text-center">Type at least 3 characters to search...</div>
                                ) : localCustomers.length > 0 ? (
                                  localCustomers.map((customer: any) => (
                                    <div
                                      key={customer.id}
                                      className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-50 transition-colors"
                                      onClick={() => {
                                        setForm({ ...form, customer_name: customer.company, customer_domain_ip: customer.id });
                                        setCustomerSearch(customer.company);
                                        setShowCustomerDropdown(false);
                                        handleCustomerChange(customer.company, customer);
                                      }}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium text-gray-900 truncate">{customer.company}</span>
                                        <div className="flex gap-2">
                                          {Number(customer.is_mapped) ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Mapped</span>
                                          ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Unmapped</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-xs text-gray-400 mt-0.5">ID: {customer.id}</div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="px-3 py-2 text-gray-500 text-center">No customers found for "{customerSearch}"</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Server Selection (Dynamic for Renewal) */}
                    {renewMode === 'billing' && customerServers.length > 1 && (
                      <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 mt-2">
                        <label className="block text-xs font-bold text-yellow-800 uppercase mb-1">Select Server <span className="text-red-500">*</span></label>
                        <select
                          value={form.server_id || ''}
                          onChange={handleServerSelect}
                          className="w-full px-3 py-2 border border-yellow-300 rounded focus:ring-2 focus:ring-yellow-400 outline-none text-sm bg-white"
                        >
                          <option value="">-- Select Server --</option>
                          {customerServers.map((s: any) => (
                            <option key={s.server_id} value={s.server_id}>
                              {s.server_ip} ({s.customer_ip})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Server/Customer IP Display (Static Info) */}
                    {(form.server_ip || form.mapped_customer_ip) && (
                      <div className="flex items-center gap-8 px-4 py-3 bg-gray-50 border border-gray-100 rounded-lg mb-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Server IP</label>
                          <div className="text-sm font-bold text-gray-900 font-mono">{form.server_ip || '-'}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Customer IP</label>
                          <div className="text-sm font-bold text-gray-900 font-mono">{form.mapped_customer_ip || '-'}</div>
                        </div>
                      </div>
                    )}

                    {/* 2. General Details Row: Date | Bill Type | SOF */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Activity Date</label>
                        <DateInput
                          value={form.activity_date}
                          onChange={(date) => setForm({ ...form, activity_date: date })}
                          disabled={renewLocked}
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Bill Type</label>
                        <select
                          value={form.bill_type}
                          disabled={renewLocked}
                          onChange={e => setForm({ ...form, bill_type: e.target.value as any })}
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                        >
                          <option value="Tax Invoice">Tax Invoice</option>
                          <option value="Credit Note">Credit Note</option>
                        </select>
                        {!editing && activeVchTypes.length > 0 && (
                          <div className="mt-2">
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Voucher Type (auto-voucher)</label>
                            <select
                              value={voucherTypeId}
                              disabled={renewLocked}
                              onChange={e => setVoucherTypeId(Number(e.target.value) || '')}
                              className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                            >
                              {activeVchTypes.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">SOF Number (Optional)</label>
                        <input
                          type="text"
                          value={form.sof_no}
                          disabled={renewLocked}
                          onChange={e => setForm({ ...form, sof_no: e.target.value })}
                          placeholder="Enter SOF..."
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                        />
                      </div>
                    </div>
                    {renewLocked && (
                      <p className="text-[11px] text-amber-600 -mt-2">You can adjust <b>Rate</b>, <b>Cycle</b> and <b>Mode</b>. Other values are auto-set from the running plan.</p>
                    )}

                    {/* 3. Metrics Row: Type | Users | Rate */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
                        <div className="block w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-sm text-gray-700 font-medium select-none">
                          Renew
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Users</label>
                        <input
                          type="number"
                          value={renewMode === 'purchase' ? form.purchase_units : form.billing_units}
                          disabled={renewLocked}
                          onChange={e => {
                            const val = e.target.value;
                            renewMode === 'purchase'
                              ? setForm({ ...form, purchase_units: val })
                              : setForm({ ...form, billing_units: val })
                          }}
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono ${lockCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Rate (₹)</label>
                        <div className="relative rounded-md shadow-sm">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500 sm:text-sm">₹</span>
                          </div>
                          <input
                            type="number"
                            value={renewMode === 'purchase' ? form.purchase_rate : form.last_bill_rate}
                            onChange={e => {
                              const val = e.target.value;
                              renewMode === 'purchase'
                                ? setForm({ ...form, purchase_rate: val })
                                : setForm({ ...form, last_bill_rate: val })
                            }}
                            className="block w-full pl-7 border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 4. Configuration Row: Cycle | Mode */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Billing Mode</label>
                        <select
                          value={(renewMode === 'purchase' ? form.purchase_billing_mode : form.billing_mode) || 'day_to_day'}
                          onChange={e => {
                            const val = e.target.value as 'day_to_day' | 'month_to_month';
                            renewMode === 'purchase'
                              ? handlePurchaseBillingModeChange(val)
                              : handleBillingModeChange(val);
                          }}
                          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                          <option value="day_to_day">D2D (Full Cycle)</option>
                          <option value="month_to_month">M2M (Pro-Rata)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Billing Cycle</label>
                        <select
                          value={(renewMode === 'purchase' ? form.purchase_cycle : form.billing_cycle) || 'Yearly'}
                          onChange={e => {
                            const val = e.target.value as any;
                            renewMode === 'purchase'
                              ? handlePurchaseCycleChange(val)
                              : handleBillingCycleChange(val)
                          }}
                          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                          <option value="Monthly">Monthly</option>
                          <option value="Quarterly">Quarterly</option>
                          <option value="Half-Yearly">Half-Yearly</option>
                          <option value="Yearly">Yearly</option>
                        </select>
                      </div>
                    </div>

                    {/* 5. Period Row: Start | Expiry */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date</label>
                        <DateInput
                          value={(renewMode === 'purchase' ? form.purchase_start_from : form.start_from) || ''}
                          disabled={renewLocked}
                          onChange={date => {
                            renewMode === 'purchase'
                              ? handlePurchaseStartDateChange(date)
                              : handleStartDateChange(date)
                          }}
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Expiry Date</label>
                        <DateInput
                          value={(renewMode === 'purchase' ? form.purchase_expiry : form.new_expiry_date) || ''}
                          disabled={renewLocked}
                          onChange={date => {
                            renewMode === 'purchase'
                              ? setForm({ ...form, purchase_expiry: date })
                              : setForm({ ...form, new_expiry_date: date });
                          }}
                          className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${lockCls}`}
                        />
                      </div>
                    </div>

                    {/* 6. Summary Section */}
                    <div className={`mt-4 rounded-lg p-4 border ${renewMode === 'purchase' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'
                      } `}>
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className={`text-xs font-semibold uppercase tracking-wider ${renewMode === 'purchase' ? 'text-emerald-600' : 'text-blue-600'
                            } `}>
                            {renewMode === 'purchase' ? 'Purchase Total' : 'Billing Total'}
                          </span>
                          <span className="text-sm text-gray-600 mt-1">
                            {(renewMode === 'purchase' ? form.purchase_date_diff_label : form.date_diff_label) || '0 Months 0 Days'}
                          </span>
                        </div>
                        <div className={`text-2xl font-bold font-mono ${renewMode === 'purchase' ? 'text-emerald-700' : 'text-blue-700'
                          } `}>
                          {renewMode === 'purchase'
                            ? formatCurrency(form.purchase_amount)
                            : formatCurrency(form.bill_amount)
                          }
                        </div>
                      </div>
                    </div>

                  </div>
                  <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
                    <button
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || (renewMode === 'billing' ? !form.customer_domain_ip : (!form.server_ip && !editing))}
                      className={`px-6 py-2 text-sm font-bold text-white rounded-lg shadow-sm focus:outline - none focus:ring-2 focus:ring-offset-2 transition-all transform active:scale-95 ${renewMode === 'purchase'
                        ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500' // Purchase Green
                        : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'       // Billing Blue
                        } disabled:opacity-50 disabled:cursor-not - allowed`}
                    >
                      {saving ? 'Saving...' : (editing ? 'Update Activity' : 'Save Activity')}
                    </button>
                  </div>
                </>
              ) : (
                /* ===== ADD ACTIVITY UI (Original Full Form) ===== */
                <>
                  <div className="p-3 md:p-4 overflow-y-auto flex-1 space-y-2 md:space-y-3 custom-scrollbar bg-gray-50/50">
                    {/* Customer Search */}
                    <div className="relative">
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">Customer Name *</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input type="text" value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }} onFocus={() => setShowCustomerDropdown(true)} placeholder="Search mapped customer..." className="w-full pl-8 pr-2 py-1.5 border rounded-lg text-sm" />
                      </div>
                      {showCustomerDropdown && customerSearch && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {customerSearch.length < 3 ? (
                            <div className="px-3 py-2 text-gray-500 text-sm">Type at least 3 characters...</div>
                          ) : localCustomers.length > 0 ? (
                            localCustomers.slice(0, 5).map((c: any) => (
                              <button key={c.id} type="button" onClick={() => { setCustomerSearch(c.company); setShowCustomerDropdown(false); handleCustomerChange(c.company, c); }} className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b last:border-b-0 text-sm">{c.company}</button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-gray-500 text-sm">No customers found</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Server/Customer IP Display */}
                    {/* Server/Customer IP Display - Compact */}
                    {form.customer_domain_ip && form.server_ip && (
                      <div className="flex items-center gap-4 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-400 uppercase">Server IP:</span>
                          <span className="font-mono font-semibold text-gray-700">{form.server_ip}</span>
                        </div>
                        <div className="h-3 w-px bg-gray-300"></div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-400 uppercase">Customer IP:</span>
                          <span className="font-mono font-semibold text-gray-700">{form.mapped_customer_ip || '-'}</span>
                        </div>
                      </div>
                    )}

                    {/* Layout: Global + Billing + Purchase */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {/* GLOBAL FIELDS */}
                      <div className="md:col-span-2 space-y-1.5 bg-gray-50/50 p-2 rounded-xl border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">General Details</h3>
                          {!editing && (
                            <div className="flex gap-4">
                              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all select-none ${form.is_sales ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'} `}>
                                <input type="checkbox" checked={form.is_sales} onChange={e => setForm(prev => ({ ...prev, is_sales: e.target.checked }))} className="w-4 h-4 rounded text-blue-600" />
                                <span className="text-sm font-medium">Billing Activity</span>
                              </label>
                              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all select-none ${form.is_purchase ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'} `}>
                                <input type="checkbox" checked={form.is_purchase} onChange={e => setForm(prev => ({ ...prev, is_purchase: e.target.checked }))} className="w-4 h-4 rounded text-green-600" />
                                <span className="text-sm font-medium">Purchase Activity</span>
                              </label>
                            </div>
                          )}
                        </div>

                        {/* Server Selection (Dynamic) */}
                        {customerServers.length > 1 && (
                          <div className="bg-yellow-50 p-2 rounded-lg border border-yellow-100 mb-1.5">
                            <label className="block text-[10px] font-bold text-yellow-800 uppercase mb-0.5">Select Server <span className="text-red-500">*</span></label>
                            <select
                              value={form.server_id || ''}
                              onChange={handleServerSelect}
                              className="w-full px-2 py-1 border border-yellow-300 rounded focus:ring-2 focus:ring-yellow-400 outline-none text-xs bg-white"
                            >
                              <option value="">-- Select Server to Update --</option>
                              {customerServers.map((s: any) => (
                                <option key={s.server_id} value={s.server_id}>
                                  {s.server_ip} ({s.customer_ip}) - {s.serial_no || 'No Serial'}
                                </option>
                              ))}
                            </select>
                            <p className="text-[10px] text-yellow-700 mt-0.5">
                              This customer has multiple servers. Please select which one this activity applies to.
                            </p>
                          </div>
                        )}

                        {(() => {
                          const showVt = !editing && form.is_sales && activeVchTypes.length > 0;
                          // One row: Activity Date | Voucher Type | Bill Type | SOF —
                          // all controls share the same h-9 height so nothing wraps
                          // or looks mismatched.
                          const ctl = 'w-full px-2 bg-white border border-gray-200 rounded-lg text-sm h-9';
                          return (
                            <div className={`grid grid-cols-1 gap-2 ${showVt ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Activity Date</label><DateInput value={form.activity_date} onChange={val => setForm(prev => ({ ...prev, activity_date: val, start_from: val, purchase_start_from: val }))} className="w-full text-sm border-gray-300 rounded-lg h-9" /></div>
                              {showVt && (
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Voucher Type</label>
                                  <select value={voucherTypeId} onChange={e => setVoucherTypeId(Number(e.target.value) || '')} className={ctl}>
                                    {activeVchTypes.map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Bill Type</label><select value={form.bill_type} onChange={e => { const t = e.target.value as any; setForm(prev => ({ ...prev, bill_type: t, billing_units: t === 'Credit Note' ? -Math.abs(Number(prev.billing_units)) : Math.abs(Number(prev.billing_units)), purchase_units: t === 'Credit Note' ? -Math.abs(Number(prev.purchase_units)) : Math.abs(Number(prev.purchase_units)) })); }} className={ctl}><option>Tax Invoice</option><option>Credit Note</option></select></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">SOF No (Optional)</label><input type="text" value={form.sof_no} onChange={e => setForm({ ...form, sof_no: e.target.value })} placeholder="Enter SOF..." className={ctl} /></div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* BILLING ACTIVITY */}
                      {form.is_sales && (
                        <div className="space-y-1.5 p-2 rounded-xl border bg-white border-blue-100 shadow-lg shadow-blue-50 ring-1 ring-blue-50">
                          <div className="flex items-center gap-2 pb-1 border-b border-blue-50"><div className="p-1 bg-blue-50 rounded-lg text-blue-600"><Calculator size={14} /></div><h3 className="font-bold text-blue-900 uppercase text-[10px] tracking-wider">Billing Activity</h3></div>
                          <div className="grid grid-cols-12 gap-1.5">
                            <div className="col-span-12 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Type</label><select value={form.billing_activity_type || form.activity_type} onChange={e => { const v = e.target.value as any; setForm(prev => ({ ...prev, billing_activity_type: v, activity_type: v })); handleActivityTypeChange(v); }} className="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs md:text-sm h-8">{availableActivityTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                            <div className="col-span-6 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Users</label><input type="number" value={form.billing_units} onChange={e => { const v = Number(e.target.value); setForm({ ...form, billing_units: form.bill_type === 'Credit Note' ? -Math.abs(v) : Math.abs(v) }); }} className="w-full px-2 py-1 border border-gray-200 rounded-lg font-mono text-xs md:text-sm h-8" /></div>
                            <div className="col-span-6 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Rate</label><div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span><input type="number" value={form.last_bill_rate} onChange={e => setForm({ ...form, last_bill_rate: Number(e.target.value) })} className="w-full pl-5 pr-2 py-1 border border-gray-200 rounded-lg font-mono text-xs md:text-sm h-8" /></div></div>
                          </div>
                          {((form.billing_activity_type || form.activity_type) !== 'User') && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Mode</label><select value={form.billing_mode || ''} onChange={e => handleBillingModeChange(e.target.value as any)} className="w-full px-2 py-1 border border-blue-100 rounded-lg text-[10px] md:text-xs font-semibold text-blue-700 bg-blue-50/30 h-8"><option value="day_to_day">D2D (Full)</option><option value="month_to_month">M2M (Pro-Rata)</option></select></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Cycle</label><select value={form.billing_cycle || ''} onChange={e => handleBillingCycleChange(e.target.value as any)} className="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs md:text-sm h-8"><option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Half-Yearly">Half-Yearly</option><option value="Yearly">Yearly</option></select></div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-1.5">
                            <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Start</label><DateInput value={form.start_from} onChange={val => handleStartDateChange(val)} className="w-full py-1 text-xs md:text-sm h-8 border-gray-300 rounded-md" /></div>
                            <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Expiry</label><DateInput value={form.new_expiry_date} onChange={() => { }} disabled className="w-full py-1 text-xs md:text-sm h-8 border-gray-300 rounded-md" /></div>
                          </div>
                          <div className="p-1.5 bg-gradient-to-br from-blue-50 to-white rounded-lg border border-blue-100 flex justify-between items-center"><span className="text-blue-600/70 text-[10px] font-medium uppercase">{form.date_diff_label || '0 Mo 0 Days'}</span><span className="font-bold text-blue-700 text-sm md:text-lg">{formatCurrency(form.bill_amount)}</span></div>
                        </div>
                      )}

                      {/* PURCHASE ACTIVITY */}
                      {form.is_purchase && (
                        <div className="space-y-1.5 p-2 rounded-xl border bg-white border-green-100 shadow-lg shadow-green-50 ring-1 ring-green-50">
                          <div className="flex items-center gap-2 pb-1 border-b border-green-50"><div className="p-1 bg-green-50 rounded-lg text-green-600"><IndianRupee size={14} /></div><h3 className="font-bold text-green-900 uppercase text-[10px] tracking-wider">Purchase Activity</h3></div>
                          <div className="grid grid-cols-12 gap-1.5">
                            <div className="col-span-12 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Type</label><select value={form.purchase_activity_type || 'New'} onChange={e => setForm({ ...form, purchase_activity_type: e.target.value as any })} className="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs md:text-sm h-8">{availableActivityTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                            <div className="col-span-6 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Users</label><input type="number" value={form.purchase_units} onChange={e => { const v = Number(e.target.value); setForm({ ...form, purchase_units: form.bill_type === 'Credit Note' ? -Math.abs(v) : Math.abs(v) }); }} className="w-full px-2 py-1 border border-gray-200 rounded-lg font-mono text-xs md:text-sm h-8" /></div>
                            <div className="col-span-6 md:col-span-4"><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Rate</label><div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span><input type="number" disabled value={form.purchase_rate} className="w-full pl-5 pr-2 py-1 border border-gray-200 rounded-lg font-mono text-xs md:text-sm bg-gray-50 text-gray-400 cursor-not-allowed h-8" /></div></div>
                          </div>
                          {(form.purchase_activity_type !== 'User') && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Mode</label><div className="w-full px-2 py-1 border border-green-100 rounded-lg bg-green-50/30 text-[10px] md:text-xs font-semibold text-green-700 h-8 flex items-center">{form.purchase_billing_mode === 'month_to_month' ? 'M2M (Pro-Rata)' : 'D2D (Full)'}</div></div>
                              <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Cycle</label><select value={form.purchase_cycle || ''} onChange={e => handlePurchaseCycleChange(e.target.value as any)} className="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs md:text-sm bg-gray-50 text-gray-500 h-8"><option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Half-Yearly">Half-Yearly</option><option value="Yearly">Yearly</option></select></div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-1.5">
                            <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Start</label><DateInput value={form.purchase_start_from || ''} onChange={val => handlePurchaseStartDateChange(val)} className="w-full py-1 text-xs md:text-sm h-8 border-gray-300 rounded-md" /></div>
                            <div><label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase">Expiry</label><DateInput value={form.purchase_expiry || ''} onChange={() => { }} disabled className="w-full py-1 text-xs md:text-sm h-8 border-gray-300 rounded-md" /></div>
                          </div>
                          <div className="p-1.5 bg-gradient-to-br from-green-50 to-white rounded-lg border border-green-100 flex justify-between items-center"><span className="text-green-600/70 text-[10px] font-medium uppercase">{form.purchase_date_diff_label || '0 Mo 0 Days'}</span><span className="font-bold text-green-700 text-sm md:text-lg">{formatCurrency(form.purchase_amount)}</span></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer for Add Activity */}
                  <div className="flex gap-3 px-4 py-3 border-t shrink-0">
                    <button onClick={() => setShowModal(false)} disabled={saving} className="flex-1 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className={`flex-1 py-2 text-white rounded-lg text-sm font-medium transition-colors ${saving ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}>
                      {saving ? 'Saving...' : 'Save Activity'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Activities;
