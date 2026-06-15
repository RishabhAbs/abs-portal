import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Phone,
  Mail,
  Hash,
  Building2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  PhoneCall,
  MapPin,
  Wrench,
  UserPlus,
  X,
  User,
  Users as UsersIcon,
  Tag,
  Cloud,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { customersApi, tallyApi, adminsApi, resellersApi } from "../services/api";
import { useColumnPermissions } from '../hooks/useColumnPermissions';
import { useToast } from '../components/Toast/Toast';
import { useSwipeTabs } from '../hooks/useSwipeTabs';

interface SearchResult {
  id: number;
  details?: any;
  contacts?: any[];
  mappedCompanies?: any[];
  tallyDetails?: any[];
  cloudDetails?: any[];
  cloudMappings?: any[];
  activities?: any[];
  visits?: any[];
  serviceCalls?: any[];
}

// Re-usable pagination component
const Pagination: React.FC<{
  page: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
}> = ({ page, total, perPage, onChange }) => {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-100 text-xs">
      <span className="text-gray-400">
        Showing {Math.min((page - 1) * perPage + 1, total)} to{" "}
        {Math.min(page * perPage, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .slice(Math.max(0, page - 3), page + 2)
          .map((p) => (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`px-1.5 py-0.5 rounded text-xs ${p === page ? "bg-blue-600 text-white" : "hover:bg-gray-100 text-gray-600"}`}
            >
              {p}
            </button>
          ))}
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

const PER_PAGE = 5;

const CustomerSearch: React.FC = () => {
  const { canView, isAdmin, canCheckPermission, canEdit } = useAuth();
  // Sub-permissions for the Update Customer Details modal:
  // - User Group is editable by admin or anyone with group_change.edit_group
  // - Reseller is editable by admin or anyone with resellers.edit
  const canEditGroup = isAdmin() || canCheckPermission('group_change', 'edit_group');
  const canEditReseller = isAdmin() || canEdit('resellers');
  const colPermsSearch = useColumnPermissions('customer_search');
  const colPermsContacts = useColumnPermissions('customer_search_contacts');
  const colPermsMapped = useColumnPermissions('customer_search_mapped');
  const colPermsTally = useColumnPermissions('customer_search_tally');
  const colPermsCloud = useColumnPermissions('customer_search_cloud');

  const [searchType, setSearchType] = useState<string>("mobile");
  const [searchValue, setSearchValue] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDropdown, setCustomerDropdown] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null,
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<SearchResult | null>(
    null,
  );

  // Pagination state per section
  const [contactsPage, setContactsPage] = useState(1);
  const [tallyPage, setTallyPage] = useState(1);
  const [cloudPage, setCloudPage] = useState(1);
  const [mappingsPage, setMappingsPage] = useState(1);
  const [activitiesPage, setActivitiesPage] = useState(1);
  const [visitsPage, setVisitsPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showContactModal, setShowContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ contact_person: '', mobile_no: '', primary_contact: 'No' });
  const [contactSaving, setContactSaving] = useState(false);

  const [toggleContactModal, setToggleContactModal] = useState<{ open: boolean, contact: any }>({ open: false, contact: null });
  const [historyPopup, setHistoryPopup] = useState<{ open: boolean; type: 'call' | 'visit' | 'service' | null }>({ open: false, type: null });
  // Mobile-only: active tab in the customer profile view (defaults to Customer Details)
  const MOBILE_TABS = ['details', 'contacts', 'tally', 'mapped', 'cloud'] as const;
  type MobileTab = typeof MOBILE_TABS[number];
  const [mobileSection, setMobileSection] = useState<MobileTab>('details');
  const swipeHandlers = useSwipeTabs(MOBILE_TABS, mobileSection, setMobileSection);

  // Clear in-tab search when switching tabs
  useEffect(() => { setTabSearchQuery(''); setTabSearchOpen(false); }, [mobileSection]);

  // Detail popup for a single tally serial (mobile only)
  const [tallyDetailPopup, setTallyDetailPopup] = useState<any | null>(null);
  // Detail popup for a single cloud server mapping (mobile only)
  const [cloudDetailPopup, setCloudDetailPopup] = useState<any | null>(null);
  // In-tab search (mobile only)
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [tabSearchQuery, setTabSearchQuery] = useState('');
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLimit] = useState(20);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapCompanyModal, setMapCompanyModal] = useState(false);
  const [targetCustomerId, setTargetCustomerId] = useState<number | null>(null);
  const [updateProfileModal, setUpdateProfileModal] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({
    company: '',
    gstin: '',
    pincode: '',
    email: '',
    btype: 1, // 1 Corporate, 2 Individual
    group: '',
    area: '',
    city: '',
    state: '',
    address1: '',
    address2: '',
    address3: '',
    resellerid: null as number | null,
  });

  // Resellers list for the dropdown (only fetched if user can pick one)
  const [resellers, setResellers] = useState<any[]>([]);
  useEffect(() => {
    if (!canEditReseller) return;
    resellersApi.getAll()
      .then(res => setResellers(res.data || []))
      .catch(() => {/* leave dropdown empty if API not yet available */});
  }, [canEditReseller]);

  // Searchable reseller dropdown state
  const [resellerSearch, setResellerSearch] = useState('');
  const [showResellerDropdown, setShowResellerDropdown] = useState(false);
  const resellerDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (resellerDropdownRef.current && !resellerDropdownRef.current.contains(e.target as Node))
        setShowResellerDropdown(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const [mapCompanySearch, setMapCompanySearch] = useState('');
  const [mapCompanySuggestions, setMapCompanySuggestions] = useState<any[]>([]);
  const [mapCompanySuggestLoading, setMapCompanySuggestLoading] = useState(false);
  const [showMapDropdown, setShowMapDropdown] = useState(false);

  useEffect(() => {
    if (mapCompanySearch.length < 4) {
      setMapCompanySuggestions([]);
      setShowMapDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setMapCompanySuggestLoading(true);
      try {
        const res = await customersApi.search(mapCompanySearch);
        setMapCompanySuggestions(res.data || []);
        setShowMapDropdown(true);
      } catch {
        setMapCompanySuggestions([]);
      } finally {
        setMapCompanySuggestLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mapCompanySearch]);

  useEffect(() => {
    if (updateProfileModal) {
      adminsApi.getAll().then((res: any) => setGroups(res)).catch(() => setGroups([]));
    }
  }, [updateProfileModal]);

  const [tallyModal, setTallyModal] = useState<{ open: boolean, type: 'add' | 'update', data: any }>({ open: false, type: 'add', data: null });
  const [tallyForm, setTallyForm] = useState({
    serial: '',
    expire_date: '',
    flavor: '',
    renewal: '',
    tally_status: 'Our Tally',
    active_status: 'Active',
    reason: '',
    partner: ''
  });

  const handleToggleContact = async (field: 'status' | 'primary_contact' | 'contact_person', value: string) => {
    if (!toggleContactModal.contact) return;
    try {
      const cid = toggleContactModal.contact.customer_id || selectedProfile!.id;
      await customersApi.updateContactMapping(cid, toggleContactModal.contact.id, { [field]: value });
      showSuccess('Success', 'Contact updated');
      setToggleContactModal(m => ({ ...m, contact: { ...m.contact, [field]: value } }));
      const res = await customersApi.searchDetail(String(selectedProfile!.id), 'id');
      const c = res.customers || [];
      if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile!.id) || c[0]);
    } catch (e) {
      console.error('Toggle Contact Error:', e);
      showError('Error', 'Failed to update contact');
    }
  };

  const handleMapCompany = async () => {
    if (!targetCustomerId) return;
    try {
      await customersApi.mapCompany(selectedProfile!.id, targetCustomerId);
      showSuccess('Success', 'Company mapped');
      setMapCompanyModal(false);
      setTargetCustomerId(null);
      setMapCompanySearch('');
      const res = await customersApi.searchDetail(String(selectedProfile!.id), 'id');
      const c = res.customers || [];
      if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile!.id) || c[0]);
    } catch (e) {
      console.error('Map Company Error:', e);
      showError('Error', 'Failed to map company');
    }
  };

  const handleSyncSerial = async (serial: string) => {
    if (!serial) return;
    try {
      const res: any = await tallyApi.syncSerial(serial);
      if (res.success) {
        const changes = res.changes || [];
        if (changes.length === 0) {
          showSuccess('Tally API', res.message || 'Already up to date — no changes');
        } else {
          const summary = changes.map((c: any) => `${c.field}: ${c.old ?? '—'} → ${c.new ?? '—'}`).join('; ');
          showSuccess(`Updated ${changes.length} field(s)`, summary);
        }
        const r = await customersApi.searchDetail(String(selectedProfile!.id), 'id');
        const c = r.customers || [];
        if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile!.id) || c[0]);
      } else {
        showError('Tally API', res.message || 'Sync failed');
      }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to sync serial');
    }
  };

  const handleUpsertTally = async () => {
    try {
      await tallyApi.upsertDetail({
        serial: tallyForm.serial,
        customer_id: selectedProfile!.id,
        flavor: tallyForm.flavor,
        expire_date: tallyForm.expire_date,
        tally_status: tallyForm.tally_status,
        active_status: tallyForm.active_status,
        renewal: tallyForm.renewal,
        reason: tallyForm.reason,
        partner: tallyForm.partner
      });
      showSuccess('Success', tallyModal.type === 'add' ? 'Tally added' : 'Tally updated');
      setTallyModal({ open: false, type: 'add', data: null });
      const res = await customersApi.searchDetail(String(selectedProfile!.id), 'id');
      const c = res.customers || [];
      if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile!.id) || c[0]);
    } catch (e) {
      console.error('Upsert Tally Error:', e);
      showError('Error', 'Failed to save Tally details');
    }
  };

  const dropdownRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    if (location.state?.customerId) {
      const cid = location.state.customerId;
      setLoading(true);
      setSearched(true);
      resetPages();
      customersApi.searchDetail(String(cid), "id")
        .then(res => {
          const c = res.customers || [];
          setResults(c);
          if (c.length > 0) {
            const target = c.find((cust: any) => cust.id === cid) || c[0];
            setSelectedProfile(target);
          }
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
        
      window.history.replaceState({}, document.title);
      return;
    }

    // Reset state whenever the route receives a new navigation event (like clicking "CRM > Search" in the navbar)
    setSearched(false);
    setSearchValue('');
    setSelectedProfile(null);
    setResults([]);
    resetPages();
    setSelectedCustomerId(null);
    setCustomerSearch('');
  }, [location.key]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      )
        setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [dropdownLoading, setDropdownLoading] = useState(false);

  // Fetch paginated/filtered history when popup is open or filters change
  useEffect(() => {
    if (!historyPopup.open || !historyPopup.type || !selectedProfile?.id) return;
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(async () => {
      setHistoryLoading(true);
      try {
        const res = await customersApi.getHistory(selectedProfile.id, {
          type: historyPopup.type!,
          search: historySearch || undefined,
          date_from: historyDateFrom || undefined,
          date_to: historyDateTo || undefined,
          page: historyPage,
          limit: historyLimit,
        });
        setHistoryData(res.data || []);
        setHistoryTotal(res.total || 0);
      } catch (e: any) {
        showError('Error', e?.message || 'Failed to load history');
        setHistoryData([]);
        setHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    }, 250);
    return () => { if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current); };
  }, [historyPopup.open, historyPopup.type, selectedProfile?.id, historySearch, historyDateFrom, historyDateTo, historyPage, historyLimit, showError]);

  // Reset filters/page when popup opens or type changes
  useEffect(() => {
    if (historyPopup.open) {
      setHistoryPage(1);
      setHistorySearch('');
      setHistoryDateFrom('');
      setHistoryDateTo('');
    }
  }, [historyPopup.open, historyPopup.type]);

  useEffect(() => {
    if (customerSearch.length < 4) {
      setCustomerDropdown([]);
      setShowDropdown(false);
      if (customerSearch.length > 0) {
        setSearched(false);
        setResults([]);
        setSelectedProfile(null);
      }
      return;
    }
    const timer = setTimeout(async () => {
      setDropdownLoading(true);
      try {
        const res = await customersApi.search(customerSearch);
        let suggestions = res.data || [];
        // Sort by best match: starts with query first, then contains
        const q = customerSearch.toLowerCase();
        suggestions.sort((a: any, b: any) => {
          const aName = (a.company || '').toLowerCase();
          const bName = (b.company || '').toLowerCase();
          const aStarts = aName.startsWith(q) ? 0 : 1;
          const bStarts = bName.startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return aName.indexOf(q) - bName.indexOf(q);
        });
        setCustomerDropdown(suggestions.slice(0, 8));
        setShowDropdown(suggestions.length > 0);
      } catch (err) {
        console.error('Customer search failed:', err);
        setCustomerDropdown([]);
      } finally {
        setDropdownLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const resetPages = () => {
    setContactsPage(1);
    setTallyPage(1);
    setCloudPage(1);
    setMappingsPage(1);
    setActivitiesPage(1);
    setVisitsPage(1);
  };

  const handleSearch = async () => {
    if (!searchValue.trim()) return;
    setLoading(true);
    setSearched(true);
    setSelectedProfile(null);
    resetPages();
    try {
      const res = await customersApi.searchDetail(searchValue, searchType);
      const c = res.customers || [];
      setResults(c);
      if (c.length === 1) setSelectedProfile(c[0]);
    } catch {
      setResults([]);
    }
    setLoading(false);
  };

  const handleCustomerSearch = async (id?: number) => {
    const cid = id || selectedCustomerId;
    // If no ID selected but user typed a name, search by company name
    if (!cid) {
      if (customerSearch.trim()) {
        setLoading(true);
        setSearched(true);
        setShowDropdown(false);
        setSelectedProfile(null);
        resetPages();
        try {
          const res = await customersApi.searchDetail(customerSearch.trim(), "company");
          const c = res.customers || [];
          setResults(c);
        } catch {
          setResults([]);
        }
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setSearched(true);
    setShowDropdown(false);
    setSelectedProfile(null);
    resetPages();
    try {
      const res = await customersApi.searchDetail(String(cid), "id");
      const c = res.customers || [];
      setResults(c);
    } catch {
      setResults([]);
    }
    setLoading(false);
  };

  const selectCustomer = (c: any) => {
    setSelectedCustomerId(c.id);
    setCustomerSearch(c.company);
    setShowDropdown(false);
    // Search by ID to get this customer + all its mapped companies in the result
    setTimeout(async () => {
      setLoading(true);
      setSearched(true);
      setSelectedProfile(null);
      resetPages();
      try {
        const res = await customersApi.searchDetail(String(c.id), "id");
        const customers = res.customers || [];
        setResults(customers);
        if (customers.length === 1) setSelectedProfile(customers[0]);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 0);
  };

  const openProfile = (customer: SearchResult) => {
    setSelectedProfile(customer);
    resetPages();
  };
  const backToList = () => setSelectedProfile(null);
  const backToSearch = () => {
    setSelectedProfile(null);
    setResults([]);
    setSearched(false);
    setSearchValue("");
    setCustomerSearch("");
    setSelectedCustomerId(null);
  };

  const searchTypeOptions = [
    { value: "mobile", label: "Phone Number" },
    { value: "serial", label: "Serial Number" },
    { value: "email", label: "Email" },
  ];

  const fmtDate = (d: any) =>
    d ? new Date(d).toLocaleDateString("en-IN") : "-";

  const paginate = (arr: any[] | undefined, page: number) => {
    if (!arr) return [];
    return arr.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  };

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    // Check for explicit "copy" permission for customer_search
    if (!canCheckPermission('customer_search', 'copy')) {
      showError('Permission Denied', 'You do not have permission to copy this data');
      return;
    }
    
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const CopyableText: React.FC<{ text: any; id: string; className?: string }> = ({ text, id, className = "" }) => {
    const { canCheckPermission } = useAuth();
    const canCopy = canCheckPermission('customer_search', 'copy');
    const isCopied = copiedId === id;
    
    if (!text) return <span>-</span>;
    
    // If no copy permission, just show the text without hover/click effects
    if (!canCopy) return <span className={className}>{text}</span>;

    return (
      <div className={`group flex items-center gap-2 ${className}`}>
        <span className="truncate">{text}</span>
        <button 
          onClick={(e) => { e.stopPropagation(); handleCopy(String(text), id); }}
          className="p-1 rounded hover:bg-gray-100 flex items-center justify-center"
          title="Click to copy"
        >
          {isCopied ? (
            <span className="text-[10px] font-bold text-green-600">Copied!</span>
          ) : (
            <Copy className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-600 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      </div>
    );
  };

  // ====== PROFILE VIEW ======
  if (selectedProfile) {
    const det = selectedProfile.details;
    const contacts = selectedProfile.contacts || [];
    const tally = selectedProfile.tallyDetails || [];
    const cloud = selectedProfile.cloudDetails || [];
    const mappings = selectedProfile.cloudMappings || [];
    const mapped = selectedProfile.mappedCompanies || [];
    const activities = selectedProfile.activities || [];
    const visits = selectedProfile.visits || [];

    return (
      <div className="p-3 md:p-5 max-w-[1400px] mx-auto space-y-3" {...swipeHandlers}>
        <div className="flex items-center gap-3">
          {results.length > 1 ? (
            <button onClick={backToList} className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-xs font-medium">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Results
            </button>
          ) : (
            <button onClick={backToSearch} className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-xs font-medium">
              <ArrowLeft className="h-3.5 w-3.5" /> New Search
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <h1 className="text-lg md:text-xl font-bold text-gray-800 truncate flex-1 min-w-0">
            {det?.company || `Customer #${selectedProfile.id}`}
          </h1>
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {(isAdmin() || canView('visits_our' as any) || canView('visits_not_our' as any)) && (
              <button
                onClick={() => setHistoryPopup({ open: true, type: 'call' })}
                title={`Last Connect (${(visits.filter((v: any) => v.visit_type === 'Call')).length})`}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Last Connect</span>
                <span>({(visits.filter((v: any) => v.visit_type === 'Call')).length})</span>
              </button>
            )}
            {(isAdmin() || canView('visits_our' as any) || canView('visits_not_our' as any)) && (
              <button
                onClick={() => setHistoryPopup({ open: true, type: 'visit' })}
                title={`Last Visit (${(visits.filter((v: any) => v.visit_type === 'Visit')).length})`}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-xs font-medium rounded-md border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                <MapPin className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Last Visit</span>
                <span>({(visits.filter((v: any) => v.visit_type === 'Visit')).length})</span>
              </button>
            )}
            {(isAdmin() || canView('service_calls' as any)) && (
              <button
                onClick={() => setHistoryPopup({ open: true, type: 'service' })}
                title={`Service Call (${(selectedProfile?.serviceCalls || []).length})`}
                className="flex items-center gap-1 px-2 md:px-3 py-1.5 text-xs font-medium rounded-md border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Service Call</span>
                <span>({(selectedProfile?.serviceCalls || []).length})</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Mobile-only: horizontal tab bar — 5 tabs equal width + search icon ── */}
        <div className="md:hidden -mx-3 bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="flex items-stretch w-full">
            {([
              { key: 'details',  label: 'Details'  },
              { key: 'contacts', label: 'Contacts' },
              { key: 'tally',    label: 'Tally'    },
              { key: 'mapped',   label: 'Mapping'  },
              { key: 'cloud',    label: 'Cloud'    },
            ] as const).map(t => {
              const active = mobileSection === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setMobileSection(t.key as MobileTab)}
                  className={`flex-1 flex items-center justify-center px-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors min-w-0 ${
                    active
                      ? 'text-blue-700 border-blue-600 bg-blue-50/40'
                      : 'text-gray-500 border-transparent active:bg-gray-50'
                  }`}
                >
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
            {mobileSection !== 'details' && (
              <button
                onClick={() => { setTabSearchOpen(o => !o); if (tabSearchOpen) setTabSearchQuery(''); }}
                aria-label="Search in tab"
                className={`shrink-0 flex items-center justify-center w-10 border-b-2 transition-colors ${
                  tabSearchOpen ? 'text-blue-700 border-blue-600 bg-blue-50/40' : 'text-gray-500 border-transparent active:bg-gray-50'
                }`}
              >
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>
          {tabSearchOpen && mobileSection !== 'details' && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={tabSearchQuery}
                  onChange={e => setTabSearchQuery(e.target.value)}
                  placeholder={
                    mobileSection === 'contacts' ? 'Search name or mobile...'
                    : mobileSection === 'tally'  ? 'Search serial, flavor, status...'
                    : mobileSection === 'mapped' ? 'Search company, GSTIN, area...'
                    : mobileSection === 'cloud'  ? 'Search IP, serial, customer IP...'
                    : 'Search...'
                  }
                  autoFocus
                  className="w-full pl-8 pr-8 py-1.5 text-[13px] border border-gray-300 rounded focus:ring-1 focus:ring-blue-200 outline-none bg-white"
                />
                {tabSearchQuery && (
                  <button onClick={() => setTabSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded">
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Customer Details + Contacts ── */}
        <div className={`${
          (mobileSection === 'details' || mobileSection === 'contacts') ? 'grid grid-cols-1' :
          'hidden md:grid'
        } lg:grid-cols-5 gap-3`}>
          {/* Customer Details - wider */}
          {det && (
            <div className={`${mobileSection === 'details' ? 'block' : 'hidden md:block'} lg:col-span-3 border border-gray-200 rounded bg-white`}>
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
                <span>Customer Details</span>
                <button 
                  onClick={() => {
                    setProfileForm({
                      company: det.company || '',
                      gstin: det.gstin || '',
                      pincode: det.pincode || '',
                      email: det.email || '',
                      btype: det.btype || 1,
                      group: det.group || '',
                      area: det.area || '',
                      city: det.city || '',
                      state: det.state_original_id || det.state || '',
                      address1: det.address1 || '',
                      address2: det.address2 || '',
                      address3: det.address3 || '',
                      resellerid: det.resellerid ?? null,
                    });
                    setResellerSearch('');
                    setUpdateProfileModal(true);
                  }} 
                  className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 text-[10px] font-medium transition-colors"
                >
                  Update Details
                </button>
              </div>
              {/* Mobile: grouped, compact detail view */}
              <div className="md:hidden p-2 space-y-2 bg-gray-50">
                {/* Company hero */}
                <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Company</div>
                  <div className="text-[15px] font-bold text-gray-900 leading-tight">{det.company || '-'}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    {det.status && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${det.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {det.status}
                      </span>
                    )}
                    {det.btype === 1 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">Corporate</span>}
                    {det.btype === 2 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">Individual</span>}
                    {det.grade && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">Grade: {det.grade}</span>}
                    {det.group_name && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">{det.group_name}</span>}
                  </div>
                </div>

                {/* Contact group */}
                {(det.mobile || det.email || det.person) && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-2.5 py-1 bg-blue-50 border-b border-blue-100 text-[10px] font-bold uppercase tracking-wider text-blue-700">Contact</div>
                    <div className="divide-y divide-gray-100">
                      {det.person && (
                        <div className="flex items-center px-2.5 py-1.5">
                          <UserPlus className="h-3.5 w-3.5 text-gray-400 shrink-0 mr-2" />
                          <span className="text-[12px] text-gray-900 font-medium truncate">{det.person}</span>
                        </div>
                      )}
                      {det.mobile && (
                        <a href={`tel:${det.mobile}`} className="flex items-center px-2.5 py-1.5 active:bg-blue-50">
                          <Phone className="h-3.5 w-3.5 text-blue-500 shrink-0 mr-2" />
                          <span className="text-[13px] text-blue-700 font-mono font-semibold">{det.mobile}</span>
                        </a>
                      )}
                      {det.email && (
                        <a href={`mailto:${det.email}`} className="flex items-center px-2.5 py-1.5 active:bg-blue-50">
                          <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0 mr-2" />
                          <span className="text-[12px] text-blue-700 truncate">{det.email}</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Address group */}
                {(det.address1 || det.address2 || det.address3 || det.city || det.area || det.state || det.pincode) && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-2.5 py-1 bg-emerald-50 border-b border-emerald-100 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Address</div>
                    <div className="px-2.5 py-1.5 space-y-1">
                      {[det.address1, det.address2, det.address3].filter(Boolean).length > 0 && (
                        <div className="flex items-start gap-2">
                          <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                          <span className="text-[12px] text-gray-900 leading-snug">{[det.address1, det.address2, det.address3].filter(Boolean).join(', ')}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] pl-5">
                        {(det.city || det.area) && <span><span className="text-gray-400">City:</span> <span className="text-gray-800 font-medium">{det.city || det.area}</span></span>}
                        {det.state && <span><span className="text-gray-400">State:</span> <span className="text-gray-800 font-medium">{det.state}</span></span>}
                        {det.pincode && <span><span className="text-gray-400">PIN:</span> <span className="text-gray-800 font-mono font-medium">{det.pincode}</span></span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Business / Tax group */}
                {(det.gstin || det.tally) && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-2.5 py-1 bg-violet-50 border-b border-violet-100 text-[10px] font-bold uppercase tracking-wider text-violet-700">Business</div>
                    <div className="divide-y divide-gray-100">
                      {det.gstin && (
                        <div className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-gray-500">GSTIN</span>
                          <span className="text-[12px] font-mono font-semibold text-gray-900 truncate">{det.gstin}</span>
                        </div>
                      )}
                      {det.tally && (
                        <div className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-gray-500">Tally</span>
                          <span className="text-[12px] text-gray-900 font-medium">{det.tally}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Remarks */}
                {det.remarks && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 mb-1">Remarks</div>
                    <div className="text-[13px] text-gray-800 leading-snug">{det.remarks}</div>
                  </div>
                )}
              </div>

              {/* Desktop: existing grid */}
              <div className="hidden md:grid p-3 grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                <div>
                  <span className="text-gray-400">Company</span>
                  <CopyableText text={det.company} id="det-company" className="font-medium text-gray-800" />
                </div>
                <div>
                  <span className="text-gray-400">User Group</span>
                  <CopyableText text={det.group_name} id="det-group" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Reseller</span>
                  <CopyableText text={(det as any).reseller_name} id="det-reseller" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Status</span>
                  <CopyableText text={det.status} id="det-status" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Business Type</span>
                  <CopyableText
                    text={det.btype === 1 ? "Corporate" : det.btype === 2 ? "Individual" : null}
                    id="det-btype"
                    className="text-gray-700"
                  />
                </div>
                <div>
                  <span className="text-gray-400">Email</span>
                  <CopyableText text={det.email} id="det-email" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">GSTIN</span>
                  <CopyableText text={det.gstin} id="det-gstin" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Mobile</span>
                  <CopyableText text={det.mobile} id="det-mobile" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Contact Person</span>
                  <CopyableText text={det.person} id="det-person" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Pincode</span>
                  <CopyableText text={det.pincode} id="det-pincode" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">City</span>
                  <CopyableText text={det.city || det.area} id="det-city" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">State</span>
                  <CopyableText text={det.state} id="det-state" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Address</span>
                  <CopyableText
                    text={[det.address1, det.address2, det.address3].filter(Boolean).join(", ")}
                    id="det-address"
                    className="text-gray-700"
                  />
                </div>
                <div>
                  <span className="text-gray-400">Remarks</span>
                  <CopyableText text={det.remarks} id="det-remarks" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Grade</span>
                  <CopyableText text={det.grade} id="det-grade" className="text-gray-700" />
                </div>
                <div>
                  <span className="text-gray-400">Tally</span>
                  <CopyableText text={det.tally} id="det-tally" className="text-gray-700" />
                </div>
              </div>
            </div>
          )}

          {/* Customer Contacts */}
          <div className={`${mobileSection === 'contacts' ? 'block' : 'hidden md:block'} lg:col-span-2 border border-gray-200 rounded bg-white`}>
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
              <span>
                Customer Contacts{" "}
                <span className="font-normal text-gray-400">
                  ({contacts.filter((c: any) => c.status === 'Active').length})
                </span>
              </span>
              <button
                onClick={() => { setContactForm({ contact_person: '', mobile_no: '', primary_contact: 'No' }); setShowContactModal(true); }}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <UserPlus className="h-3 w-3" /> Add Contact
              </button>
            </div>

            {/* Mobile: clean 2×2 contact card */}
            <div className="md:hidden p-2.5 space-y-2 bg-gray-50/40">
              {(() => {
                const q = tabSearchQuery.trim().toLowerCase();
                const filtered = contacts.filter((c: any) => c.status === 'Active').filter((c: any) =>
                  !q || (c.contact_person || '').toLowerCase().includes(q) || (c.mobile_no || '').toLowerCase().includes(q) || (c.customer_name || '').toLowerCase().includes(q)
                );
                if (filtered.length === 0) return (<div className="px-3 py-6 text-center text-gray-400 text-[13px]">{q ? 'No matches' : 'No active contacts'}</div>);
                return paginate(filtered, contactsPage).map((c: any, i: number) => (
                  <div
                    key={c.id || i}
                    onClick={() => setToggleContactModal({ open: true, contact: c })}
                    className="bg-white border border-gray-200 rounded-lg shadow-sm px-3.5 py-2.5 active:bg-blue-50 active:scale-[0.99] transition-transform cursor-pointer relative"
                  >
                    {c.primary_contact === 'Yes' && (
                      <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-amber-500" title="Primary">★</span>
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-bold text-gray-900 truncate">{c.contact_person || '-'}</span>
                      <span className="text-[14px] font-mono text-gray-700 shrink-0">
                        {c.mobile_no ? <a href={`tel:${c.mobile_no}`} onClick={e => e.stopPropagation()}>{c.mobile_no}</a> : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 mt-0.5">
                      <span className="text-[12px] text-gray-500">{c.status || '-'}</span>
                      <span className="text-[12px] text-gray-500 truncate text-right">{c.customer_name || '-'}</span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    {colPermsContacts.isVisible('person') && <th className="px-2 py-1.5 text-left font-medium">
                      Person
                    </th>}
                    {colPermsContacts.isVisible('phone') && <th className="px-2 py-1.5 text-left font-medium">Phone</th>}
                    {colPermsContacts.isVisible('primary') && <th className="px-2 py-1.5 text-left font-medium">
                      Primary
                    </th>}
                    {colPermsContacts.isVisible('status') && <th className="px-2 py-1.5 text-left font-medium">
                      Status
                    </th>}
                    {colPermsContacts.isVisible('company') && <th className="px-2 py-1.5 text-left font-medium">
                      Company
                    </th>}
                  </tr>
                </thead>
                <tbody>
                  {contacts.filter((c: any) => c.status === 'Active').length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-3 text-center text-gray-400"
                      >
                        No active contacts
                      </td>
                    </tr>
                  ) : (
                    paginate(contacts.filter((c: any) => c.status === 'Active'), contactsPage).map(
                      (c: any, i: number) => (
                        <tr
                          key={c.id || i}
                          className="border-t border-gray-50 hover:bg-gray-50"
                        >
                          <td className="px-2 py-1.5 text-gray-400">
                            {(contactsPage - 1) * PER_PAGE + i + 1}
                          </td>
                          {colPermsContacts.isVisible('person') && <td className="px-2 py-1.5 font-medium text-gray-800" style={colPermsContacts.cellStyle('person')} onContextMenu={colPermsContacts.onCellContextMenu('person')}>
                            <CopyableText text={c.contact_person} id={`contact-person-${i}`} />
                          </td>}
                          {colPermsContacts.isVisible('phone') && <td className="px-2 py-1.5 cursor-pointer hover:bg-blue-50/50" onClick={() => setToggleContactModal({ open: true, contact: c })} style={colPermsContacts.cellStyle('phone')} onContextMenu={colPermsContacts.onCellContextMenu('phone')}>
                            <CopyableText text={c.mobile_no} id={`contact-phone-${i}`} />
                          </td>}
                          {colPermsContacts.isVisible('primary') && <td className="px-2 py-1.5" style={colPermsContacts.cellStyle('primary')} onContextMenu={colPermsContacts.onCellContextMenu('primary')}>
                            {c.primary_contact === "Yes" ? (
                              <span className="text-blue-600 font-medium">
                                Yes
                              </span>
                            ) : (
                              "No"
                            )}
                          </td>}
                          {colPermsContacts.isVisible('status') && <td className="px-2 py-1.5" style={colPermsContacts.cellStyle('status')} onContextMenu={colPermsContacts.onCellContextMenu('status')}>
                            <span
                              className={
                                c.status === "Active"
                                  ? "text-green-600"
                                  : "text-red-500"
                              }
                            >
                              {c.status || "-"}
                            </span>
                          </td>}
                          {colPermsContacts.isVisible('company') && <td className="px-2 py-1.5 text-gray-500 truncate max-w-[100px]" style={colPermsContacts.cellStyle('company')} onContextMenu={colPermsContacts.onCellContextMenu('company')}>
                            {c.customer_name || "-"}
                          </td>}
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={contactsPage}
              total={contacts.filter((c: any) => c.status === 'Active').length}
              perPage={PER_PAGE}
              onChange={setContactsPage}
            />
          </div>
        </div>

        {/* ── Mapped Companies ── */}
        {selectedProfile && (
          <div className={`${mobileSection === 'mapped' ? 'block' : 'hidden md:block'} border border-gray-200 rounded bg-white`}>
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex justify-between items-center">
              <div>
                Mapped Companies{" "}
                <span className="font-normal text-gray-400">
                  ({mapped.length} linked)
                </span>
              </div>
              <button 
                onClick={() => setMapCompanyModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-[10px]"
              >
                Map New
              </button>
            </div>

            {/* Mobile: each mapped company as a card */}
            <div className="md:hidden p-2 space-y-1.5 bg-gray-50/50">
              {(() => {
                const q = tabSearchQuery.trim().toLowerCase();
                const filtered = mapped.filter((mc: any) =>
                  !q || (mc.company || '').toLowerCase().includes(q) || (mc.gstin || '').toLowerCase().includes(q) || (mc.area || mc.city || '').toLowerCase().includes(q) || (mc.state || '').toLowerCase().includes(q)
                );
                if (filtered.length === 0) return (<div className="px-3 py-6 text-center text-gray-400 text-[13px]">{q ? 'No matches' : 'No mapped companies'}</div>);
                return filtered.map((mc: any, i: number) => (
                <div
                  key={mc.id || i}
                  onClick={() => handleCustomerSearch(mc.id)}
                  className="bg-white border border-gray-200 rounded-md px-2.5 py-2 active:bg-blue-50 cursor-pointer"
                >
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <div className="text-[14px] font-bold text-gray-900 truncate">{mc.company || '-'}</div>
                    <div className="text-[11px] font-semibold text-gray-700 text-right">{mc.status || '-'}</div>
                    <div className="text-[11px] font-mono text-gray-700 truncate">{mc.gstin || '-'}</div>
                    <div className="text-[11px] text-gray-700 truncate text-right">{mc.area || mc.city || mc.state || '-'}</div>
                  </div>
                </div>
              ));
              })()}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    {colPermsMapped.isVisible('company') && <th className="px-2 py-1.5 text-left font-medium">
                      Company
                    </th>}
                    {colPermsMapped.isVisible('group') && <th className="px-2 py-1.5 text-left font-medium">Group</th>}
                    {colPermsMapped.isVisible('status') && <th className="px-2 py-1.5 text-left font-medium">
                      Status
                    </th>}
                    {colPermsMapped.isVisible('type') && <th className="px-2 py-1.5 text-left font-medium">Type</th>}
                    {colPermsMapped.isVisible('email') && <th className="px-2 py-1.5 text-left font-medium">Email</th>}
                    {colPermsMapped.isVisible('gstin') && <th className="px-2 py-1.5 text-left font-medium">GSTIN</th>}
                    {colPermsMapped.isVisible('pincode') && <th className="px-2 py-1.5 text-left font-medium">
                      Pincode
                    </th>}
                    {colPermsMapped.isVisible('city') && <th className="px-2 py-1.5 text-left font-medium">City</th>}
                    {colPermsMapped.isVisible('state') && <th className="px-2 py-1.5 text-left font-medium">State</th>}
                    <th className="px-2 py-1.5 text-left font-medium">
                      Mapping
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mapped.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-3 text-center text-gray-400">
                        No mapped companies
                      </td>
                    </tr>
                  ) : mapped.map((mc: any, i: number) => (
                    <tr
                      key={mc.id || i}
                      className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer"
                      onClick={() => handleCustomerSearch(mc.id)}
                    >
                      {colPermsMapped.isVisible('company') && <td className="px-2 py-1.5 font-medium text-blue-600" style={colPermsMapped.cellStyle('company')} onContextMenu={colPermsMapped.onCellContextMenu('company')}>
                        {mc.company || "-"}
                      </td>}
                      {colPermsMapped.isVisible('group') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('group')} onContextMenu={colPermsMapped.onCellContextMenu('group')}>{mc.group_name || "-"}</td>}
                      {colPermsMapped.isVisible('status') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('status')} onContextMenu={colPermsMapped.onCellContextMenu('status')}>
                        <span
                          className={
                            mc.status === "Active"
                              ? "text-green-600"
                              : "text-gray-500"
                          }
                        >
                          {mc.status || "-"}
                        </span>
                      </td>}
                      {colPermsMapped.isVisible('type') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('type')} onContextMenu={colPermsMapped.onCellContextMenu('type')}>
                        {mc.btype === 1 ? "Corp" : mc.btype === 2 ? "Ind" : "-"}
                      </td>}
                      {colPermsMapped.isVisible('email') && <td className="px-2 py-1.5 truncate max-w-[140px]" style={colPermsMapped.cellStyle('email')} onContextMenu={colPermsMapped.onCellContextMenu('email')}>
                        {mc.email || "-"}
                      </td>}
                      {colPermsMapped.isVisible('gstin') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('gstin')} onContextMenu={colPermsMapped.onCellContextMenu('gstin')}>{mc.gstin || "-"}</td>}
                      {colPermsMapped.isVisible('pincode') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('pincode')} onContextMenu={colPermsMapped.onCellContextMenu('pincode')}>{mc.pincode || "-"}</td>}
                      {colPermsMapped.isVisible('city') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('city')} onContextMenu={colPermsMapped.onCellContextMenu('city')}>{mc.city || "-"}</td>}
                      {colPermsMapped.isVisible('state') && <td className="px-2 py-1.5" style={colPermsMapped.cellStyle('state')} onContextMenu={colPermsMapped.onCellContextMenu('state')}>{mc.state || "-"}</td>}
                      <td className="px-2 py-1.5">
                        <span
                          className={`text-xs ${mc.mapping_status === "Primary" ? "text-blue-600 font-medium" : "text-orange-600"}`}
                        >
                          {mc.mapping_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tally Details ── */}
        {selectedProfile && (
          <div className={`${mobileSection === 'tally' ? 'block' : 'hidden md:block'} border border-gray-200 rounded bg-white`}>
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex justify-between items-center">
              <div>
                Tally Details{" "}
                <span className="font-normal text-gray-400">
                  ({tally.length})
                </span>
              </div>
              <button 
                onClick={() => {
                  setTallyForm({ serial: '', expire_date: '', flavor: '', renewal: '', tally_status: 'Our Tally', active_status: 'Active', reason: '', partner: '' });
                  setTallyModal({ open: true, type: 'add', data: null });
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-[10px]"
              >
                Add Tally
              </button>
            </div>

            {/* Mobile: each tally as a card */}
            <div className="md:hidden p-2 space-y-1.5 bg-gray-50/50">
              {(() => {
                const q = tabSearchQuery.trim().toLowerCase();
                const filtered = tally.filter((t: any) =>
                  !q || (t.tallyserial || '').toLowerCase().includes(q) || (t.flavor_name || t.tallyflavor || '').toLowerCase().includes(q) || (t.tally_status || '').toLowerCase().includes(q) || (t.active_status || '').toLowerCase().includes(q)
                );
                if (filtered.length === 0) return (<div className="px-3 py-6 text-center text-gray-400 text-[13px]">{q ? 'No matches' : 'No Tally details'}</div>);
                return paginate(filtered, tallyPage).map((t: any, i: number) => (
                <div
                  key={t.id || i}
                  onClick={() => setTallyDetailPopup(t)}
                  className="bg-white border border-gray-200 rounded-md px-2.5 py-2 active:bg-blue-50 cursor-pointer"
                >
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <div className="text-[14px] font-mono font-bold text-gray-900 truncate" onClick={e => e.stopPropagation()}>
                      <CopyableText text={t.tallyserial} id={`m-tally-serial-${i}`} />
                    </div>
                    <div className="text-[14px] text-gray-700 truncate text-right">{fmtDate(t.expiry_date)}</div>
                    <div className="text-[11px] font-semibold text-gray-700">
                      {t.active_status || '-'} · {t.tally_status || '-'}
                    </div>
                    <div className="text-[11px] text-gray-700 truncate text-right">{t.flavor_name || t.tallyflavor || '-'}</div>
                  </div>
                  {(isAdmin() || t.tallyserial) && (
                    <div className="flex items-center gap-1.5 mt-1.5" onClick={e => e.stopPropagation()}>
                      {isAdmin() && t.tally_status !== 'Our Tally' && (
                        <button
                          onClick={() => {
                            setTallyForm({
                              serial: t.tallyserial || '',
                              expire_date: t.expiry_date ? String(t.expiry_date).split('T')[0] : '',
                              flavor: t.tallyflavor || '',
                              renewal: t.renewal || '',
                              tally_status: t.tally_status || 'Our Tally',
                              active_status: t.active_status || 'Active',
                              reason: t.reason || '',
                              partner: t.partner || ''
                            });
                            setTallyModal({ open: true, type: 'update', data: t });
                          }}
                          className="bg-blue-600 active:bg-blue-700 text-white px-2.5 py-1 rounded text-[11px] font-semibold"
                        >Update</button>
                      )}
                      {t.tallyserial && (
                        <button
                          onClick={() => handleSyncSerial(t.tallyserial)}
                          className="bg-violet-600 active:bg-violet-700 text-white px-2.5 py-1 rounded text-[11px] font-semibold"
                        >Tally API</button>
                      )}
                    </div>
                  )}
                </div>
              ));
              })()}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    {colPermsTally.isVisible('tally_serial') && <th className="px-2 py-1.5 text-left font-medium">
                      Tally Serial
                    </th>}
                    {colPermsTally.isVisible('expiry') && <th className="px-2 py-1.5 text-left font-medium">
                      Expiry
                    </th>}
                    {colPermsTally.isVisible('active') && <th className="px-2 py-1.5 text-left font-medium">
                      Active
                    </th>}
                    {colPermsTally.isVisible('status') && <th className="px-2 py-1.5 text-left font-medium">
                      Status
                    </th>}
                    {colPermsTally.isVisible('flavor') && <th className="px-2 py-1.5 text-left font-medium">
                      Flavor
                    </th>}
                    {colPermsTally.isVisible('release') && <th className="px-2 py-1.5 text-left font-medium">
                      Release
                    </th>}
                    {colPermsTally.isVisible('renewal') && <th className="px-2 py-1.5 text-left font-medium">
                      Renewal
                    </th>}
                    {colPermsTally.isVisible('mau') && <th className="px-2 py-1.5 text-left font-medium">MAU</th>}
                    {colPermsTally.isVisible('qau') && <th className="px-2 py-1.5 text-left font-medium">QAU</th>}
                    {colPermsTally.isVisible('remark') && <th className="px-2 py-1.5 text-left font-medium">
                      Remark
                    </th>}
                    <th className="px-2 py-1.5 text-left font-medium">
                      Company
                    </th>
                    <th className="px-2 py-1.5 text-center font-medium">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tally.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-3 text-center text-gray-400">
                        No Tally details
                      </td>
                    </tr>
                  ) : paginate(tally, tallyPage).map((t: any, i: number) => (
                    <tr
                      key={t.id || i}
                      className="border-t border-gray-50 hover:bg-gray-50"
                    >
                      <td className="px-2 py-1.5 text-gray-400">
                        {(tallyPage - 1) * PER_PAGE + i + 1}
                      </td>
                      {colPermsTally.isVisible('tally_serial') && <td className="px-2 py-1.5 font-mono" style={colPermsTally.cellStyle('tally_serial')} onContextMenu={colPermsTally.onCellContextMenu('tally_serial')}>
                        <CopyableText text={t.tallyserial} id={`tally-serial-${i}`} />
                      </td>}
                      {colPermsTally.isVisible('expiry') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('expiry')} onContextMenu={colPermsTally.onCellContextMenu('expiry')}>{fmtDate(t.expiry_date)}</td>}
                      {colPermsTally.isVisible('active') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('active')} onContextMenu={colPermsTally.onCellContextMenu('active')}>
                        <span
                          className={
                            (t.active_status || "").includes("Active")
                              ? "text-green-600"
                              : "text-red-500"
                          }
                        >
                          {t.active_status || "-"}
                        </span>
                      </td>}
                      {colPermsTally.isVisible('status') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('status')} onContextMenu={colPermsTally.onCellContextMenu('status')}>{t.tally_status || "-"}</td>}
                      {colPermsTally.isVisible('flavor') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('flavor')} onContextMenu={colPermsTally.onCellContextMenu('flavor')}>{t.flavor_name || t.tallyflavor || "-"}</td>}
                      {colPermsTally.isVisible('release') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('release')} onContextMenu={colPermsTally.onCellContextMenu('release')}>{t.tallyrelease || "-"}</td>}
                      {colPermsTally.isVisible('renewal') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('renewal')} onContextMenu={colPermsTally.onCellContextMenu('renewal')}>{t.renewal || "-"}</td>}
                      {colPermsTally.isVisible('mau') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('mau')} onContextMenu={colPermsTally.onCellContextMenu('mau')}>{t.mau || "-"}</td>}
                      {colPermsTally.isVisible('qau') && <td className="px-2 py-1.5" style={colPermsTally.cellStyle('qau')} onContextMenu={colPermsTally.onCellContextMenu('qau')}>{t.qau || "-"}</td>}
                      {colPermsTally.isVisible('remark') && <td className="px-2 py-1.5 max-w-[120px] truncate" style={colPermsTally.cellStyle('remark')} onContextMenu={colPermsTally.onCellContextMenu('remark')}>
                        {t.remark || "-"}
                      </td>}
                      <td className="px-2 py-1.5 text-gray-500">
                        {t.customer_name || "-"}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Update button — admin-only AND only for Not Our Tally serials.
                              Our Tally serials are managed via the Tally API only (source of truth). */}
                          {isAdmin() && t.tally_status !== 'Our Tally' && (
                            <button
                              onClick={() => {
                                setTallyForm({
                                  serial: t.tallyserial || '',
                                  expire_date: t.expiry_date ? String(t.expiry_date).split('T')[0] : '',
                                  flavor: t.tallyflavor || '',
                                  renewal: t.renewal || '',
                                  tally_status: t.tally_status || 'Our Tally',
                                  active_status: t.active_status || 'Active',
                                  reason: t.reason || '',
                                  partner: t.partner || ''
                                });
                                setTallyModal({ open: true, type: 'update', data: t });
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-[10px]"
                            >
                              Update
                            </button>
                          )}
                          {t.tallyserial && (
                            <button
                              onClick={() => handleSyncSerial(t.tallyserial)}
                              className="bg-violet-600 hover:bg-violet-700 text-white px-2 py-0.5 rounded text-[10px]"
                              title="Fetch latest expiry/edition from Tally API"
                            >
                              Tally API
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={tallyPage}
              total={tally.length}
              perPage={PER_PAGE}
              onChange={setTallyPage}
            />
          </div>
        )}

        {/* ── Cloud Server Mappings ── */}
        {mappings.length > 0 && (
          <div className={`${mobileSection === 'cloud' ? 'block' : 'hidden md:block'} border border-gray-200 rounded bg-white`}>
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
              Cloud Server Mappings{" "}
              <span className="font-normal text-gray-400">
                ({mappings.length})
              </span>
            </div>

            {/* Mobile: clean 2×2 cloud mapping card; tap = full detail popup */}
            <div className="md:hidden p-2.5 space-y-2 bg-gray-50/40">
              {(() => {
                const q = tabSearchQuery.trim().toLowerCase();
                const filteredMappings = mappings.filter((cm: any) =>
                  !q || (cm.server_ip || '').toLowerCase().includes(q) || (cm.customer_ip || '').toLowerCase().includes(q) || (cm.serial_no || '').toLowerCase().includes(q) || (cm.admin_username || '').toLowerCase().includes(q)
                );
                if (filteredMappings.length === 0) return (<div className="px-3 py-6 text-center text-gray-400 text-[13px]">{q ? 'No matches' : 'No cloud mappings'}</div>);
                return paginate(filteredMappings, mappingsPage).map((cm: any, i: number) => {
                  const ipBase = String(cm.server_ip || '').replace(/:\d+$/, '') || '-';
                  const portVal = cm.port || (String(cm.server_ip || '').match(/:(\d+)$/)?.[1] ?? '');
                  const ipPort = portVal ? `${ipBase}:${portVal}` : ipBase;
                  return (
                    <div
                      key={cm.id || i}
                      onClick={() => setCloudDetailPopup(cm)}
                      className="bg-white border border-gray-200 rounded-lg shadow-sm px-3.5 py-2.5 active:bg-blue-50 active:scale-[0.99] transition-transform cursor-pointer"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[15px] font-mono font-bold text-gray-900 truncate">{cm.serial_no || '-'}</span>
                        <span className="text-[13px] font-mono text-gray-700 break-all text-right">{ipPort}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 mt-0.5">
                        <span className="text-[12px] text-gray-500">{cm.status || '-'} · {cm.billed_users ?? 0}u · {cm.billing_cycle || '-'}</span>
                        <span className="text-[12px] font-mono text-gray-500 shrink-0">{fmtDate(cm.expiry_date) || '-'}</span>
                      </div>
                      {isAdmin() && (cm.admin_username || cm.admin_password) && (
                        <div className="flex items-center justify-between gap-3 mt-1.5 pt-1.5 border-t border-gray-100 text-[12px]">
                          <span className="font-mono text-gray-700 truncate flex items-center gap-1.5 min-w-0">
                            <span className="text-gray-400 shrink-0">User</span>
                            <span className="font-semibold text-gray-800 truncate">{cm.admin_username || '-'}</span>
                            {canCheckPermission('customer_search', 'copy') && cm.admin_username && (
                              <button onClick={e => { e.stopPropagation(); handleCopy(cm.admin_username, `m-User-${i}`); }} className="p-0.5 -my-0.5 shrink-0"><Copy className="w-3 h-3 text-gray-400" /></button>
                            )}
                          </span>
                          <span className="font-mono text-gray-700 flex items-center gap-1.5 shrink-0">
                            <span className="text-gray-400">Pwd</span>
                            <span className="font-semibold tracking-widest">••••</span>
                            {canCheckPermission('customer_search', 'copy') && cm.admin_password && (
                              <button onClick={e => { e.stopPropagation(); handleCopy(cm.admin_password, `m-Pwd-${i}`); }} className="p-0.5 -my-0.5 shrink-0"><Copy className="w-3 h-3 text-gray-400" /></button>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Server IP
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Customer IP
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Port
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Serial
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Users</th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Status
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Cycle</th>
                    <th className="px-2 py-1.5 text-left font-medium">Rate</th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Expiry
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Company
                    </th>
                    {isAdmin() && (
                      <th className="px-2 py-1.5 text-center font-medium border-l border-gray-200">
                        Credentials
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginate(mappings, mappingsPage).map(
                    (cm: any, i: number) => (
                      <tr
                        key={cm.id || i}
                        className="border-t border-gray-50 hover:bg-gray-50"
                      >
                        <td className="px-2 py-1.5 text-gray-400">
                          {(mappingsPage - 1) * PER_PAGE + i + 1}
                        </td>
                        <td className="px-2 py-1.5 font-mono cursor-pointer hover:bg-blue-50 text-blue-600 hover:underline" title="View Billing Activity" onClick={() => navigate(`/cloud/activity/billing?search_text=${cm.server_ip}`)}>
                          <CopyableText text={cm.server_ip} id={`cloud-server-ip-${i}`} />
                        </td>
                        <td className="px-2 py-1.5 font-mono cursor-pointer hover:bg-blue-50 text-blue-600 hover:underline" title="View Billing Activity" onClick={() => navigate(`/cloud/activity/billing?search_text=${cm.customer_ip}`)}>
                          <CopyableText text={cm.customer_ip} id={`cloud-customer-ip-${i}`} />
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          <CopyableText text={cm.port} id={`cloud-port-${i}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <CopyableText text={cm.serial_no} id={`cloud-serial-${i}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          {cm.billed_users ?? "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              cm.status === "Active"
                                ? "text-green-600"
                                : "text-red-500"
                            }
                          >
                            {cm.status || "-"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {cm.billing_cycle || "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          {cm.billing_rate != null
                            ? `₹${Number(cm.billing_rate).toLocaleString("en-IN")}`
                            : "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          {fmtDate(cm.expiry_date)}
                        </td>
                        <td className="px-2 py-1.5 text-gray-500">
                          {cm.customer_name || cm.server_company || "-"}
                        </td>
                        <td className="px-2 py-1.5 text-xs border-l border-gray-100 bg-gray-50/50">
                          <div className="flex flex-col gap-1 items-center min-w-[120px]">
                            <div className="flex items-center justify-between w-full bg-white border border-gray-200 rounded px-1.5 py-0.5">
                              <span className="font-mono text-gray-600 truncate">
                                {cm.admin_username || "-"}
                              </span>
                              {canCheckPermission('customer_search', 'copy') && (
                                <button
                                  onClick={() =>
                                    handleCopy(cm.admin_username, `Username-${i}`)
                                  }
                                  className="p-0.5 text-gray-400 hover:text-blue-600 ml-1"
                                  title="Copy Username"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between w-full bg-white border border-gray-200 rounded px-1.5 py-0.5">
                              <span className="font-mono text-gray-600 truncate">
                                {cm.admin_password ? "••••••••" : "-"}
                              </span>
                              {cm.admin_password && canCheckPermission('customer_search', 'copy') && (
                                <button
                                  onClick={() =>
                                    handleCopy(cm.admin_password, `Password-${i}`)
                                  }
                                  className="p-0.5 text-gray-400 hover:text-blue-600 ml-1"
                                  title="Copy Password"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={mappingsPage}
              total={mappings.length}
              perPage={PER_PAGE}
              onChange={setMappingsPage}
            />
          </div>
        )}


        {/* ── Visits ── */}
        {visits.length > 0 && (
          <div className="border border-gray-200 rounded bg-white">
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
              Recent Visits{" "}
              <span className="font-normal text-gray-400">
                ({visits.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    <th className="px-2 py-1.5 text-left font-medium">Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">Visitor</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2 py-1.5 text-left font-medium">In Time</th>
                    <th className="px-2 py-1.5 text-left font-medium">Out Time</th>
                    <th className="px-2 py-1.5 text-left font-medium">Company</th>
                    <th className="px-2 py-1.5 text-left font-medium">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(visits, visitsPage).map((v: any, i: number) => (
                    <tr key={v.id || i} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-gray-400">{(visitsPage - 1) * PER_PAGE + i + 1}</td>
                      <td className="px-2 py-1.5">{fmtDate(v.scheduled_date)}</td>
                      <td className="px-2 py-1.5 font-medium">{v.user_name}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${v.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{v.check_in_time ? new Date(v.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "-"}</td>
                      <td className="px-2 py-1.5">{v.check_out_time ? new Date(v.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "-"}</td>
                      <td className="px-2 py-1.5 text-gray-400 italic">{v.customer_name || "-"}</td>
                      <td className="px-2 py-1.5 max-w-[200px] truncate" title={v.check_out_remark || v.remark}>{v.check_out_remark || v.remark || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={visitsPage}
              total={visits.length}
              perPage={PER_PAGE}
              onChange={setVisitsPage}
            />
          </div>
        )}

        {/* ── Tally Serial Detail Popup (mobile-friendly) ── */}
        {tallyDetailPopup && (() => {
          const t = tallyDetailPopup;
          const fields: { label: string; value: any; mono?: boolean; color?: string }[] = [
            { label: 'Tally Serial', value: t.tallyserial, mono: true },
            { label: 'Expiry Date',  value: fmtDate(t.expiry_date) },
            { label: 'Active',       value: t.active_status },
            { label: 'Status',       value: t.tally_status },
            { label: 'Flavor',       value: t.flavor_name || t.tallyflavor },
            { label: 'Release',      value: t.tallyrelease },
            { label: 'Renewal',      value: t.renewal },
            { label: 'MAU',          value: t.mau },
            { label: 'QAU',          value: t.qau },
            { label: 'Partner',      value: t.partner },
            { label: 'Reason',       value: t.reason },
            { label: 'Remark',       value: t.remark },
            { label: 'Company',      value: t.customer_name },
            // Tally API enriched fields (when synced)
            { label: 'API Edition',     value: t.tally_api_edition },
            { label: 'API Org',         value: t.tally_api_org },
            { label: 'API Email',       value: t.tally_api_email },
            { label: 'API Mobile',      value: t.tally_api_mobile, mono: true },
            { label: 'API Activation',  value: fmtDate(t.tally_api_activation) },
            { label: 'API Last Synced', value: t.tally_api_checked_at ? new Date(t.tally_api_checked_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : null },
          ].filter(f => f.value !== null && f.value !== undefined && f.value !== '' && f.value !== '-');

          return (
            <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4" onClick={() => setTallyDetailPopup(null)}>
              <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2 bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600 mb-0.5">Tally Serial</div>
                    <div className="text-[16px] font-mono font-bold text-gray-900 break-all">{t.tallyserial || '-'}</div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                        {t.active_status || '-'}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">{t.tally_status || '-'}</span>
                      {(t.flavor_name || t.tallyflavor) && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">{t.flavor_name || t.tallyflavor}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setTallyDetailPopup(null)} className="p-1 hover:bg-white/50 rounded shrink-0">
                    <X className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                {/* Body — all fields */}
                <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
                  {fields.map((f, idx) => (
                    <div key={idx} className="flex items-start px-4 py-2 gap-3">
                      <span className="text-[11px] text-gray-500 w-[35%] shrink-0 leading-tight pt-0.5">{f.label}</span>
                      <span className={`flex-1 text-[13px] ${f.color || 'text-gray-900'} ${f.mono ? 'font-mono' : ''} break-words`}>
                        {String(f.value)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Footer actions */}
                <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 bg-gray-50">
                  {t.tallyserial && (
                    <button
                      onClick={() => { handleSyncSerial(t.tallyserial); setTallyDetailPopup(null); }}
                      className="flex-1 bg-violet-600 active:bg-violet-700 text-white px-3 py-2 rounded text-[13px] font-semibold"
                    >
                      Tally API Sync
                    </button>
                  )}
                  {isAdmin() && t.tally_status !== 'Our Tally' && (
                    <button
                      onClick={() => {
                        setTallyForm({
                          serial: t.tallyserial || '',
                          expire_date: t.expiry_date ? String(t.expiry_date).split('T')[0] : '',
                          flavor: t.tallyflavor || '',
                          renewal: t.renewal || '',
                          tally_status: t.tally_status || 'Our Tally',
                          active_status: t.active_status || 'Active',
                          reason: t.reason || '',
                          partner: t.partner || ''
                        });
                        setTallyModal({ open: true, type: 'update', data: t });
                        setTallyDetailPopup(null);
                      }}
                      className="flex-1 bg-blue-600 active:bg-blue-700 text-white px-3 py-2 rounded text-[13px] font-semibold"
                    >
                      Update
                    </button>
                  )}
                  <button onClick={() => setTallyDetailPopup(null)} className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded text-[13px]">Close</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Cloud Server Mapping Detail Popup (mobile-friendly) ── */}
        {cloudDetailPopup && (() => {
          const cm = cloudDetailPopup;
          const fields: { label: string; value: any; mono?: boolean; copy?: 'user' | 'pwd' }[] = [
            { label: 'Serial No.',    value: cm.serial_no, mono: true },
            { label: 'Server IP',     value: cm.server_ip, mono: true },
            { label: 'Customer IP',   value: cm.customer_ip, mono: true },
            { label: 'Port',          value: cm.port, mono: true },
            { label: 'Status',        value: cm.status },
            { label: 'Users',         value: cm.billed_users },
            { label: 'Cycle',         value: cm.billing_cycle },
            { label: 'Rate',          value: cm.billing_rate != null ? `₹${Number(cm.billing_rate).toLocaleString('en-IN')}` : null },
            { label: 'Expiry',        value: fmtDate(cm.expiry_date) },
            { label: 'Mapped At',     value: fmtDate(cm.mapped_at || cm.created_at) },
            { label: 'Company',       value: cm.customer_name || cm.server_company },
            ...(isAdmin() ? [
              { label: 'Username',    value: cm.admin_username, mono: true, copy: 'user' as const },
              { label: 'Password',    value: cm.admin_password ? '••••••••' : null, mono: true, copy: 'pwd' as const },
            ] : []),
          ].filter(f => f.value !== null && f.value !== undefined && f.value !== '' && f.value !== '-');

          return (
            <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4" onClick={() => setCloudDetailPopup(null)}>
              <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2 bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600 mb-0.5">Cloud Mapping</div>
                    <div className="text-[16px] font-mono font-bold text-gray-900 break-all">{cm.serial_no || '-'}</div>
                  </div>
                  <button onClick={() => setCloudDetailPopup(null)} className="p-1 hover:bg-white/50 rounded shrink-0">
                    <X className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
                  {fields.map((f, idx) => (
                    <div key={idx} className="flex items-start px-4 py-2 gap-3">
                      <span className="text-[11px] text-gray-500 w-[35%] shrink-0 leading-tight pt-0.5">{f.label}</span>
                      <span className={`flex-1 text-[13px] text-gray-900 ${f.mono ? 'font-mono' : ''} break-words flex items-center gap-2`}>
                        <span className="flex-1 break-all">{String(f.value)}</span>
                        {f.copy === 'user' && cm.admin_username && canCheckPermission('customer_search', 'copy') && (
                          <button onClick={() => handleCopy(cm.admin_username, 'cloud-detail-user')} className="p-1 shrink-0"><Copy className="w-3.5 h-3.5 text-gray-400" /></button>
                        )}
                        {f.copy === 'pwd' && cm.admin_password && canCheckPermission('customer_search', 'copy') && (
                          <button onClick={() => handleCopy(cm.admin_password, 'cloud-detail-pwd')} className="p-1 shrink-0"><Copy className="w-3.5 h-3.5 text-gray-400" /></button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
                  <button onClick={() => setCloudDetailPopup(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-[13px]">Close</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── History Popup (Last Connect / Last Visit / Service Call) ── */}
        {historyPopup.open && historyPopup.type && (() => {
          const titleMap = { call: 'Last Connect History', visit: 'Last Visit History', service: 'Service Call History' };
          const headerBg = { call: 'bg-blue-50', visit: 'bg-green-50', service: 'bg-orange-50' };
          const headerText = { call: 'text-blue-800', visit: 'text-green-800', service: 'text-orange-800' };
          const totalPages = Math.max(1, Math.ceil(historyTotal / historyLimit));
          const isService = historyPopup.type === 'service';

          const fmtDateTime = (v: any) => v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-';

          return (
            <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-stretch md:items-center justify-center md:p-4" onClick={() => setHistoryPopup({ open: false, type: null })}>
              <div className="bg-white md:rounded-lg shadow-2xl max-w-4xl w-full h-full md:h-auto md:max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={`px-3 md:px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-2 ${headerBg[historyPopup.type]}`}>
                  <h3 className={`text-sm font-bold ${headerText[historyPopup.type]} flex-1 min-w-0 break-words`}>
                    {titleMap[historyPopup.type]} — <span className="block md:inline">{det?.company}</span>
                  </h3>
                  <button onClick={() => setHistoryPopup({ open: false, type: null })} className="p-1 hover:bg-white/50 rounded shrink-0">
                    <X className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                {/* Filters — stack on mobile, inline on desktop */}
                <div className="px-3 md:px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
                  <div className="relative w-full md:flex-1 md:min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={e => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                      placeholder={isService ? 'Search remark, person, taken by...' : 'Search user, remark, status...'}
                      className="w-full pl-8 pr-2 py-2 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-200 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <input
                      type="date"
                      value={historyDateFrom}
                      onChange={e => { setHistoryDateFrom(e.target.value); setHistoryPage(1); }}
                      className="flex-1 md:flex-none px-2 py-2 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-200 outline-none"
                      title="From date"
                    />
                    <span className="text-xs text-gray-400 shrink-0">to</span>
                    <input
                      type="date"
                      value={historyDateTo}
                      onChange={e => { setHistoryDateTo(e.target.value); setHistoryPage(1); }}
                      className="flex-1 md:flex-none px-2 py-2 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-200 outline-none"
                      title="To date"
                    />
                    {(historySearch || historyDateFrom || historyDateTo) && (
                      <button
                        onClick={() => { setHistorySearch(''); setHistoryDateFrom(''); setHistoryDateTo(''); setHistoryPage(1); }}
                        className="px-2 py-2 text-xs text-gray-600 hover:bg-gray-200 rounded shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 relative">
                  {historyLoading && (
                    <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center">
                      <div className="animate-spin h-6 w-6 border-b-2 border-blue-500 rounded-full" />
                    </div>
                  )}
                  {!historyLoading && historyData.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">No records found.</div>
                  ) : (
                    <>
                      {/* MOBILE — card list */}
                      <div className="md:hidden divide-y divide-gray-100 bg-gray-50/30">
                        {historyData.map((r: any) => (
                          <div key={r.id} className="bg-white px-3 py-2.5">
                            {isService ? (
                              <>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="text-[13px] font-bold text-gray-900 truncate flex-1">
                                    {r.contact_person || '—'}
                                  </div>
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.status === 'Closed' || r.status === 'Confirmed' ? 'bg-green-100 text-green-700' : r.status === 'Open' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {r.status || '-'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[12px] text-gray-600 mb-1">
                                  {r.mobile_no && <a href={`tel:${r.mobile_no}`} className="font-mono text-blue-600">{r.mobile_no}</a>}
                                  {r.created_at && <span className="text-gray-400">· {fmtDate(r.created_at)}</span>}
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                                  {(r.service_type || r.entry_type) && <span><span className="text-gray-400">Type:</span> {r.service_type || r.entry_type}</span>}
                                  {r.taken_by && <span><span className="text-gray-400">By:</span> {r.taken_by}</span>}
                                </div>
                                {r.remark && (
                                  <div className="text-[12px] text-gray-700 mt-1 leading-snug">
                                    <span className="text-gray-400">Remark:</span> {r.remark}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="text-[13px] font-bold text-gray-900 truncate flex-1">
                                    {r.user_name || '—'}
                                  </div>
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.status === 'Completed' ? 'bg-green-100 text-green-700' : r.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {r.status || '-'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-gray-500 mb-1">
                                  {r.scheduled_date ? fmtDate(r.scheduled_date) : (r.check_out_time ? fmtDate(r.check_out_time) : '-')}
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                                  {r.check_in_time && <span><span className="text-gray-400">In:</span> {fmtDateTime(r.check_in_time)}</span>}
                                  {r.check_out_time && <span><span className="text-gray-400">Out:</span> {fmtDateTime(r.check_out_time)}</span>}
                                </div>
                                {r.check_out_remark && (
                                  <div className="text-[12px] text-gray-700 mt-1 leading-snug">
                                    <span className="text-gray-400">Remark:</span> {r.check_out_remark}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* DESKTOP — table */}
                      <div className="hidden md:block">
                        {isService ? (
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr className="text-gray-500">
                                <th className="px-3 py-2 text-left font-medium">Date</th>
                                <th className="px-3 py-2 text-left font-medium">Service Type</th>
                                <th className="px-3 py-2 text-left font-medium">Status</th>
                                <th className="px-3 py-2 text-left font-medium">Person</th>
                                <th className="px-3 py-2 text-left font-medium">Mobile</th>
                                <th className="px-3 py-2 text-left font-medium">Taken By</th>
                                <th className="px-3 py-2 text-left font-medium">Remark</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {historyData.map((r: any) => (
                                <tr key={r.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 whitespace-nowrap">{r.created_at ? fmtDate(r.created_at) : '-'}</td>
                                  <td className="px-3 py-2">{r.service_type || r.entry_type || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.status === 'Closed' || r.status === 'Confirmed' ? 'bg-green-100 text-green-700' : r.status === 'Open' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{r.status || '-'}</span>
                                  </td>
                                  <td className="px-3 py-2">{r.contact_person || '-'}</td>
                                  <td className="px-3 py-2 font-mono">{r.mobile_no || '-'}</td>
                                  <td className="px-3 py-2">{r.taken_by || '-'}</td>
                                  <td className="px-3 py-2 max-w-[220px] truncate" title={r.remark || ''}>{r.remark || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr className="text-gray-500">
                                <th className="px-3 py-2 text-left font-medium">Date</th>
                                <th className="px-3 py-2 text-left font-medium">User</th>
                                <th className="px-3 py-2 text-left font-medium">Status</th>
                                <th className="px-3 py-2 text-left font-medium">Check-In</th>
                                <th className="px-3 py-2 text-left font-medium">Check-Out</th>
                                <th className="px-3 py-2 text-left font-medium">Remark</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {historyData.map((r: any) => (
                                <tr key={r.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 whitespace-nowrap">{r.scheduled_date ? fmtDate(r.scheduled_date) : (r.check_out_time ? fmtDate(r.check_out_time) : '-')}</td>
                                  <td className="px-3 py-2">{r.user_name || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.status === 'Completed' ? 'bg-green-100 text-green-700' : r.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{r.status || '-'}</span>
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.check_in_time)}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.check_out_time)}</td>
                                  <td className="px-3 py-2 max-w-[220px] truncate" title={r.check_out_remark || ''}>{r.check_out_remark || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Footer with pagination */}
                <div className="px-3 md:px-4 py-2.5 border-t border-gray-100 flex flex-col sm:flex-row sm:justify-between sm:items-center text-xs gap-2">
                  <span className="text-gray-500 text-center sm:text-left">
                    {historyTotal === 0 ? '0 records' : `Showing ${(historyPage - 1) * historyLimit + 1}–${Math.min(historyPage * historyLimit, historyTotal)} of ${historyTotal}`}
                  </span>
                  <div className="flex items-center gap-1 justify-center sm:justify-end">
                    <button
                      onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                      disabled={historyPage <= 1 || historyLoading}
                      className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span className="px-2 text-gray-600">Page {historyPage} / {totalPages}</span>
                    <button
                      onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                      disabled={historyPage >= totalPages || historyLoading}
                      className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                    >
                      Next
                    </button>
                    <button onClick={() => setHistoryPopup({ open: false, type: null })} className="ml-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">Close</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Create Contact Modal ── */}
        {/* ── Update Customer Details Modal ── */}
      {updateProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-lg w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Update Customer Details</h3>
              <button 
                onClick={() => setUpdateProfileModal(false)}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setProfileSaving(true);
              try {
                // User Group + Reseller live on the Group / Reseller Change page
                // and are intentionally NOT editable from this modal — only the
                // basic customer details + address. Admin still gets full set
                // minus those two; non-admin gets address only.
                const payload: any = isAdmin()
                  ? {
                      company: profileForm.company,
                      email: profileForm.email,
                      gstin: profileForm.gstin,
                      pincode: profileForm.pincode,
                      city: profileForm.city,
                      btype: profileForm.btype,
                      address1: profileForm.address1,
                      address2: profileForm.address2,
                      address3: profileForm.address3,
                    }
                  : {
                      address1: profileForm.address1,
                      address2: profileForm.address2,
                      address3: profileForm.address3,
                    };
                await customersApi.update(String(selectedProfile.id), payload);
                showSuccess('Success', isAdmin() ? 'Customer updated successfully' : 'Address updated successfully');
                setUpdateProfileModal(false);
                // Refresh profile data
                const res = await customersApi.searchDetail(String(selectedProfile.id), 'id');
                const c = res.customers || [];
                setResults(c);
                if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile.id) || c[0]);
              } catch (err: any) {
                showError('Error', err.message || 'Failed to update customer details');
              } finally {
                setProfileSaving(false);
              }
            }}>
              <div className="p-4 grid grid-cols-2 gap-3 text-xs">
                {/* Company — admin editable, non-admin read-only */}
                <div className="col-span-2">
                  <label className="block text-gray-500 mb-1">Company Name {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <input type="text" value={profileForm.company} onChange={(e) => isAdmin() && setProfileForm({...profileForm, company: e.target.value})} readOnly={!isAdmin()} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`} />
                </div>
                <div>
                  <label className="block text-gray-500 mb-1">Email {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <input type="email" value={profileForm.email} onChange={(e) => isAdmin() && setProfileForm({...profileForm, email: e.target.value})} readOnly={!isAdmin()} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`} />
                </div>
                <div>
                  <label className="block text-gray-500 mb-1">GSTIN {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <input type="text" value={profileForm.gstin} onChange={(e) => isAdmin() && setProfileForm({...profileForm, gstin: e.target.value})} readOnly={!isAdmin()} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`} />
                </div>
                <div>
                  <label className="block text-gray-500 mb-1">Pincode {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <input type="text" value={profileForm.pincode} onChange={(e) => isAdmin() && setProfileForm({...profileForm, pincode: e.target.value})} readOnly={!isAdmin()} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`} />
                </div>
                <div>
                  <label className="block text-gray-500 mb-1">City {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <input type="text" value={profileForm.city} onChange={(e) => isAdmin() && setProfileForm({...profileForm, city: e.target.value})} readOnly={!isAdmin()} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`} />
                </div>

                {/* Address Lines 1, 2, 3 — always editable */}
                <div className="col-span-2 pt-1">
                  <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wide mb-1.5">Address (editable)</div>
                </div>
                <div className="col-span-2">
                  <label className="block text-gray-700 font-medium mb-1">Address Line 1</label>
                  <input type="text" value={profileForm.address1} onChange={(e) => setProfileForm({...profileForm, address1: e.target.value})} className="w-full px-2 py-1.5 border border-blue-300 rounded focus:border-blue-500 focus:outline-none" placeholder="Building / Floor" autoFocus />
                </div>
                <div className="col-span-2">
                  <label className="block text-gray-700 font-medium mb-1">Address Line 2</label>
                  <input type="text" value={profileForm.address2} onChange={(e) => setProfileForm({...profileForm, address2: e.target.value})} className="w-full px-2 py-1.5 border border-blue-300 rounded focus:border-blue-500 focus:outline-none" placeholder="Street / Area" />
                </div>
                <div className="col-span-2">
                  <label className="block text-gray-700 font-medium mb-1">Address Line 3</label>
                  <input type="text" value={profileForm.address3} onChange={(e) => setProfileForm({...profileForm, address3: e.target.value})} className="w-full px-2 py-1.5 border border-blue-300 rounded focus:border-blue-500 focus:outline-none" placeholder="Landmark / Etc" />
                </div>

                {/* Business Type — admin only */}
                <div className="col-span-2">
                  <label className="block text-gray-500 mb-1">Business Type {!isAdmin() && <span className="text-gray-400 text-[10px]">(read-only)</span>}</label>
                  <select value={profileForm.btype} onChange={(e) => isAdmin() && setProfileForm({...profileForm, btype: Number(e.target.value)})} disabled={!isAdmin()} className={`w-full px-2 py-1.5 border rounded ${isAdmin() ? 'border-gray-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed'}`}>
                    <option value={1}>Corporate</option>
                    <option value={2}>Individual</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
                <button type="button" onClick={() => setUpdateProfileModal(false)} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={profileSaving || !profileForm.company.trim()} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

                   {/* Existing overlay */}
                   {showContactModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowContactModal(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-800">Add New Contact</h3>
                <button onClick={() => setShowContactModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contact Person *</label>
                  <input
                    type="text"
                    value={contactForm.contact_person}
                    onChange={(e) => setContactForm(f => ({ ...f, contact_person: e.target.value }))}
                    placeholder="Enter name"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mobile Number *</label>
                  <input
                    type="text"
                    value={contactForm.mobile_no}
                    onChange={(e) => setContactForm(f => ({ ...f, mobile_no: e.target.value }))}
                    placeholder="Enter mobile number"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="primary_contact"
                    checked={contactForm.primary_contact === 'Yes'}
                    onChange={(e) => setContactForm(f => ({ ...f, primary_contact: e.target.checked ? 'Yes' : 'No' }))}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="primary_contact" className="text-xs text-gray-600">Set as Primary Contact</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
                <button
                  onClick={() => setShowContactModal(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  disabled={contactSaving || !contactForm.contact_person.trim() || !contactForm.mobile_no.trim()}
                  onClick={async () => {
                    setContactSaving(true);
                    try {
                      await customersApi.createContact(selectedProfile.id, contactForm);
                      showSuccess('Success', 'Contact created successfully');
                      setShowContactModal(false);
                      // Refresh profile data
                      const res = await customersApi.searchDetail(String(selectedProfile.id), 'id');
                      const c = res.customers || [];
                      setResults(c);
                      if (c.length > 0) setSelectedProfile(c.find((cu: any) => cu.id === selectedProfile.id) || c[0]);
                    } catch {
                      showError('Error', 'Failed to create contact');
                    } finally {
                      setContactSaving(false);
                    }
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {contactSaving ? 'Saving...' : 'Save Contact'}
                </button>
              </div>
            </div>
          </div>
        )}
      {/* ── Toggle Contact Modal ── */}
      {toggleContactModal.open && toggleContactModal.contact && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Update Contact ({toggleContactModal.contact.mobile_no})</h3>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-600">Contact Person</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={toggleContactModal.contact.contact_person || ''}
                    onChange={e => setToggleContactModal(m => ({ ...m, contact: { ...m.contact, contact_person: e.target.value } }))}
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder="Enter person name"
                  />
                  <button
                    onClick={() => handleToggleContact('contact_person', toggleContactModal.contact.contact_person)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 font-medium"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Status</span>
                <div className="flex border border-gray-300 rounded overflow-hidden text-xs">
                  <button
                    onClick={() => handleToggleContact('status', 'Active')}
                    className={`px-3 py-1 ${toggleContactModal.contact.status === 'Active' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Active</button>
                  <button
                    onClick={() => handleToggleContact('status', 'Inactive')}
                    className={`px-3 py-1 ${toggleContactModal.contact.status === 'Inactive' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Inactive</button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Primary Contact</span>
                <div className="flex border border-gray-300 rounded overflow-hidden text-xs">
                  <button 
                    onClick={() => handleToggleContact('primary_contact', 'Yes')}
                    className={`px-3 py-1 ${toggleContactModal.contact.primary_contact === 'Yes' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Yes</button>
                  <button 
                    onClick={() => handleToggleContact('primary_contact', 'No')}
                    className={`px-3 py-1 ${toggleContactModal.contact.primary_contact !== 'Yes' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >No</button>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button 
                onClick={() => setToggleContactModal({ open: false, contact: null })}
                className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
              >Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Map New Company Modal ── */}
      {mapCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleMapCompany(); }} className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Map New Company</h3>
            <p className="text-xs text-gray-500 mb-2">Search for the target company to link</p>
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search Company Name..." 
                value={mapCompanySearch} 
                onChange={e => setMapCompanySearch(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-blue-500"
              />
              {mapCompanySuggestLoading && (
                <div className="absolute right-2 top-1.5">
                  <span className="animate-spin h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full inline-block"></span>
                </div>
              )}
              {showMapDropdown && mapCompanySuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto mt-1">
                  {mapCompanySuggestions.map((c: any) => (
                    <div 
                      key={c.id} 
                      onClick={() => {
                        setTargetCustomerId(c.id);
                        setMapCompanySearch(c.company);
                        setShowMapDropdown(false);
                      }}
                      className="px-2 py-1.5 text-xs hover:bg-gray-100 cursor-pointer border-b border-gray-50 last:border-0"
                    >
                      <div className="font-medium text-gray-800">{c.company}</div>
                      {c.mobile && <div className="text-gray-400 text-[10px]">{c.mobile}</div>}
                    </div>
                  ))}
                </div>
              )}
              {showMapDropdown && mapCompanySuggestions.length === 0 && mapCompanySearch.length >= 3 && !mapCompanySuggestLoading && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg p-2 text-center text-xs text-gray-400 mt-1">
                  No results found
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button 
                type="button"
                onClick={() => setMapCompanyModal(false)}
                className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
              >Cancel</button>
              <button 
                type="submit"
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
              >Map</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tally Modal ── */}
      {tallyModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleUpsertTally(); }} className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">{tallyModal.type === 'add' ? 'Add Tally' : 'Update Tally'}</h3>
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-gray-600 mb-1">Tally Serial</label>
                <input type="text" value={tallyForm.serial} onChange={e => setTallyForm({...tallyForm, serial: e.target.value})} className="w-full border rounded px-2 py-1" required />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Expiry Date</label>
                <input type="date" value={tallyForm.expire_date} onChange={e => setTallyForm({...tallyForm, expire_date: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Flavor</label>
                <input type="text" value={tallyForm.flavor} onChange={e => setTallyForm({...tallyForm, flavor: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Renewal Frequency</label>
                <input type="text" value={tallyForm.renewal} onChange={e => setTallyForm({...tallyForm, renewal: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Partner</label>
                <input type="text" value={tallyForm.partner} onChange={e => setTallyForm({...tallyForm, partner: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Tally Status</label>
                <select value={tallyForm.tally_status} onChange={e => setTallyForm({...tallyForm, tally_status: e.target.value})} className="w-full border rounded px-2 py-1">
                  <option value="Our Tally">Our Tally</option>
                  <option value="Not Our Tally">Not Our Tally</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Active Status</label>
                <select value={tallyForm.active_status} onChange={e => setTallyForm({...tallyForm, active_status: e.target.value})} className="w-full border rounded px-2 py-1">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setTallyModal({ open: false, type: 'add', data: null })} className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded">Cancel</button>
              <button type="submit" className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded">{tallyModal.type === 'add' ? 'Add' : 'Update'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
  }

  // ====== LIST VIEW ======
  return (
    <div className="p-3 md:p-5 max-w-[1400px] mx-auto">
      <h1 className="text-lg font-bold text-gray-800 mb-4">Customer Search</h1>

      <div className="bg-white rounded-lg border border-gray-200 mb-6 shadow-sm">
        {/* Row 1 */}
        <div className="flex flex-col md:flex-row items-center p-3 md:p-4 border-b border-gray-100 gap-2 md:gap-4">
          <label className="text-xs md:text-sm font-semibold text-gray-600 w-full md:w-[220px]">
            Search Customer
          </label>
          <div className="flex flex-1 gap-2 md:gap-3 w-full">
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              className="border border-gray-300 rounded-md px-2 md:px-3 py-2 text-xs md:text-sm bg-white min-w-[120px] md:min-w-[160px] focus:ring-2 focus:ring-blue-100 outline-none text-gray-700"
            >
              {searchTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={`Enter ${searchTypeOptions.find((o) => o.value === searchType)?.label}...`}
              className="flex-1 min-w-0 border border-gray-300 rounded-md px-2 md:px-3 py-2 text-xs md:text-sm focus:ring-2 focus:ring-blue-100 outline-none placeholder:text-gray-400"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !searchValue.trim()}
              className="bg-blue-400 hover:bg-blue-500 text-white px-4 md:px-6 py-2 rounded-md text-xs md:text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors shrink-0"
            >
              <Search className="h-4 w-4" /> Search
            </button>
          </div>
        </div>

        {/* Row 2 */}
        <div className="flex flex-col md:flex-row items-center p-3 md:p-4 gap-2 md:gap-4">
          <label className="text-xs md:text-sm font-semibold text-gray-600 w-full md:w-[220px]">
            Search By Customer
          </label>
          <div className="flex flex-1 w-full relative" ref={dropdownRef}>
            <div className="relative flex-1">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setSelectedCustomerId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setShowDropdown(false);
                    handleCustomerSearch();
                  }
                }}
                placeholder="Type 4+ characters to search..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 outline-none placeholder:text-gray-400"
              />
              {dropdownLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                </div>
              )}
              {showDropdown && customerDropdown.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                  {customerDropdown.map((c: any) => (
                    <div
                      key={c.id}
                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0"
                      onClick={() => selectCustomer(c)}
                    >
                      <div className="text-sm font-medium text-gray-900">{c.company}</div>
                      <div className="text-xs text-gray-500 flex gap-3">
                        {c.person && <span>{c.person}</span>}
                        {c.mobile && <span>{c.mobile}</span>}
                        {c.city && <span>{c.city}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => handleCustomerSearch()}
              disabled={loading || !customerSearch.trim()}
              className="ml-2 bg-blue-400 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-xs md:text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors shrink-0"
            >
              <Search className="h-4 w-4" /> Search
            </button>
          </div>
        </div>
      </div>

      {customerSearch.length > 0 && customerSearch.length < 4 && !loading && !searched && !selectedProfile && (
        <div className="text-center py-8 text-gray-400">
          <Search className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Type at least 4 characters to search</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-gray-400 text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
          Searching...
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Building2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No customers found</p>
        </div>
      )}

      {!loading && results.length >= 1 && !selectedProfile && (
        <div className="bg-white rounded border border-gray-200">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
            {results.length} Customer{results.length !== 1 ? 's' : ''} Found
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {results.map((r, i) => {
              const d = r.details;
              return (
                <div
                  key={r.id}
                  className="px-3 py-3 active:bg-blue-50 cursor-pointer"
                  onClick={() => openProfile(r)}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="font-medium text-blue-600 text-sm truncate flex-1">
                      {d?.company || `#${r.id}`}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${d?.status === 'Active' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                      {d?.status || '-'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 space-y-0.5">
                    {d?.person && <div className="truncate"><span className="text-gray-400">Person:</span> {d.person}</div>}
                    {d?.mobile && <div className="font-mono"><span className="text-gray-400 font-sans">Mobile:</span> {d.mobile}</div>}
                    {d?.email && <div className="truncate"><span className="text-gray-400">Email:</span> {d.email}</div>}
                    {(d?.area || d?.city) && <div className="truncate"><span className="text-gray-400">City:</span> {d?.area || d?.city}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="px-2 py-1.5 text-left font-medium">#</th>
                  <th className="px-2 py-1.5 text-left font-medium">Company</th>
                  <th className="px-2 py-1.5 text-left font-medium">Person</th>
                  <th className="px-2 py-1.5 text-left font-medium">Mobile</th>
                  <th className="px-2 py-1.5 text-left font-medium">Email</th>
                  <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  <th className="px-2 py-1.5 text-left font-medium">City</th>
                  <th className="px-2 py-1.5 text-center font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const d = r.details;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer"
                      onClick={() => openProfile(r)}
                    >
                      <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="px-2 py-1.5 font-medium text-blue-600">
                        <CopyableText text={d?.company} id={`list-company-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <CopyableText text={d?.person} id={`list-person-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <CopyableText text={d?.mobile} id={`list-mobile-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <CopyableText text={d?.email} id={`list-email-${i}`} />
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={
                            d?.status === "Active"
                              ? "text-green-600"
                              : "text-gray-500"
                          }
                        >
                          {d?.status || "-"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {d?.area || d?.city || "-"}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs">
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* ── Toggle Contact Modal ── */}
      {toggleContactModal.open && toggleContactModal.contact && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Update Contact ({toggleContactModal.contact.mobile_no})</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Status</span>
                <div className="flex border border-gray-300 rounded overflow-hidden text-xs">
                  <button
                    onClick={() => handleToggleContact('status', 'Active')}
                    className={`px-3 py-1 ${toggleContactModal.contact.status === 'Active' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Active</button>
                  <button
                    onClick={() => handleToggleContact('status', 'Inactive')}
                    className={`px-3 py-1 ${toggleContactModal.contact.status === 'Inactive' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Inactive</button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Primary Contact</span>
                <div className="flex border border-gray-300 rounded overflow-hidden text-xs">
                  <button 
                    onClick={() => handleToggleContact('primary_contact', 'Yes')}
                    className={`px-3 py-1 ${toggleContactModal.contact.primary_contact === 'Yes' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >Yes</button>
                  <button 
                    onClick={() => handleToggleContact('primary_contact', 'No')}
                    className={`px-3 py-1 ${toggleContactModal.contact.primary_contact !== 'Yes' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >No</button>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button 
                onClick={() => setToggleContactModal({ open: false, contact: null })}
                className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
              >Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Map New Company Modal ── */}
      {mapCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleMapCompany(); }} className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Map New Company</h3>
            <p className="text-xs text-gray-500 mb-3">Enter target company ID to link</p>
            <input 
              type="number" 
              placeholder="Enter Customer ID to link" 
              value={targetCustomerId || ''} 
              onChange={e => setTargetCustomerId(parseInt(e.target.value) || null)}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-blue-500"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button 
                type="button"
                onClick={() => setMapCompanyModal(false)}
                className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-300"
              >Cancel</button>
              <button 
                type="submit"
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
              >Map</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tally Modal ── */}
      {tallyModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleUpsertTally(); }} className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">{tallyModal.type === 'add' ? 'Add Tally' : 'Update Tally'}</h3>
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-gray-600 mb-1">Tally Serial</label>
                <input type="text" value={tallyForm.serial} onChange={e => setTallyForm({...tallyForm, serial: e.target.value})} className="w-full border rounded px-2 py-1" required />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Expiry Date</label>
                <input type="date" value={tallyForm.expire_date} onChange={e => setTallyForm({...tallyForm, expire_date: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Flavor</label>
                <input type="text" value={tallyForm.flavor} onChange={e => setTallyForm({...tallyForm, flavor: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Renewal Frequency</label>
                <input type="text" value={tallyForm.renewal} onChange={e => setTallyForm({...tallyForm, renewal: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Partner</label>
                <input type="text" value={tallyForm.partner} onChange={e => setTallyForm({...tallyForm, partner: e.target.value})} className="w-full border rounded px-2 py-1" />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Tally Status</label>
                <select value={tallyForm.tally_status} onChange={e => setTallyForm({...tallyForm, tally_status: e.target.value})} className="w-full border rounded px-2 py-1">
                  <option value="Our Tally">Our Tally</option>
                  <option value="Not Our Tally">Not Our Tally</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-600 mb-1">Active Status</label>
                <select value={tallyForm.active_status} onChange={e => setTallyForm({...tallyForm, active_status: e.target.value})} className="w-full border rounded px-2 py-1">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setTallyModal({ open: false, type: 'add', data: null })} className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded">Cancel</button>
              <button type="submit" className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded">{tallyModal.type === 'add' ? 'Add' : 'Update'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

export default CustomerSearch;
