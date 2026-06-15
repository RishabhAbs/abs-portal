import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, X, Search, Users, Phone, Mail, MapPin, Filter, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useData, Customer } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { adminsApi, customersApi, usersApi, resellersApi } from '../services/api';
import PaginationControls from '../components/Shared/PaginationControls';
import FilterModal, { FilterConfig } from '../components/Shared/FilterModal';

const CustomerList: React.FC = () => {
    const { addCustomer, updateCustomer, deleteCustomer } = useData();
    const { canCreate, canEdit, canDelete, canView, isAdmin } = useAuth();
    const { showSuccess, showError } = useToast();
    const [admins, setAdmins] = useState<any[]>([]);
    const [cloudUsers, setCloudUsers] = useState<any[]>([]);
    const [resellers, setResellers] = useState<any[]>([]);
    // Only users with resellers.edit can choose / change a customer's reseller.
    // Everyone else sees the field as a read-only display of whatever's saved.
    const canEditReseller = canEdit('resellers');
    // Searchable reseller dropdown state — native <select> doesn't filter and
    // the master has 80+ entries which makes scrolling unfriendly.
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

    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState<Customer | null>(null);

    const canSeeOur = canView('customers_our');
    const canSeeOthers = canView('customers_not_our');

    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('type') === 'not_our' ? 'not_our' : 'our';

    // Correction: If user can only see one, force them to that tab
    useEffect(() => {
        if (!canSeeOur && canSeeOthers && activeTab === 'our') {
            setSearchParams({ type: 'not_our' });
        } else if (canSeeOur && !canSeeOthers && activeTab === 'not_our') {
            setSearchParams({ type: 'our' });
        }
    }, [canSeeOur, canSeeOthers, activeTab, setSearchParams]);

    const currentPermissionModule = activeTab === 'our' ? 'customers_our' : 'customers_not_our';
    const canAdd = canCreate(currentPermissionModule as any);
    const canEditCustomer = canEdit(currentPermissionModule as any);
    const canDel = canDelete(currentPermissionModule as any);



    const [form, setForm] = useState<any>({});
    const [errors, setErrors] = useState<any>({});

    // Pagination State
    const [localCustomers, setLocalCustomers] = useState<any[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [limit] = useState(20);
    const [loading, setLoading] = useState(false);

    // Sorting — click any column header to toggle ASC/DESC. Default ASC by
    // company. Same key on second click flips direction; new key resets to ASC.
    const [sortBy, setSortBy] = useState<string>('company');
    const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
    const handleSort = (key: string) => {
        if (sortBy === key) {
            setSortOrder(prev => (prev === 'ASC' ? 'DESC' : 'ASC'));
        } else {
            setSortBy(key);
            setSortOrder('ASC');
        }
        setPage(1);
    };
    const sortIcon = (key: string) => {
        if (sortBy !== key) return <ChevronsUpDown className="inline-block ml-1 h-3 w-3 text-gray-400" />;
        return sortOrder === 'ASC'
            ? <ChevronUp   className="inline-block ml-1 h-3 w-3 text-blue-600" />
            : <ChevronDown className="inline-block ml-1 h-3 w-3 text-blue-600" />;
    };
    
    // Search keyword now lives inside appliedFilters.search — old dedicated
    // state is gone since the standalone search bar was removed.

    // Applied Filters. Page auto-loads paginated 20/page on mount; filters
    // refine the result. Heavy load is solved by the small page size, not
    // by gating the fetch.
    const [showFilterPopup, setShowFilterPopup] = useState(false);
    const [appliedFilters, setAppliedFilters] = useState({
        search: '',          // fuzzy: company / mobile / email
        customer: '',        // company name (substring)
        contact: '',         // contact person
        phone: '',
        email: '',
        gstin: '',
        city: '',
        area: '',
        pincode: '',
        state: '',
        group: '',
        reseller: '',
        active_status: '',
        min_lic: '',         // total_licenses >=
        min_active: '',      // active_licenses >=
        min_not_ours: '',    // not_ours_licenses >=
        aging: '',
        lastVisitPerson: '',
        dateFrom: '',
        dateTo: ''
    });

    const hasActiveFilters = Object.values(appliedFilters).some(v => v);

    // Reset all filters back to empty and forget the "filters applied" flag —
    // returns the page to its initial empty-state hint.
    const clearSearch = () => {
        setAppliedFilters({
            search: '', customer: '', contact: '', phone: '', email: '',
            gstin: '', city: '', area: '', pincode: '', state: '',
            group: '', reseller: '', active_status: '',
            min_lic: '', min_active: '', min_not_ours: '',
            aging: '', lastVisitPerson: '', dateFrom: '', dateTo: ''
        });
        setPage(1);
    };

    // Load Customers
    const showErrorRef = useRef(showError);
    showErrorRef.current = showError;

    const fetchCustomers = useCallback(async () => {
        setLoading(true);
        try {
            const statusFilter = activeTab === 'our' ? 'Active' : 'Others';

            const res: any = await customersApi.getAll(
                page, limit, appliedFilters.search, statusFilter, false,
                appliedFilters.aging, appliedFilters.city, appliedFilters.pincode,
                appliedFilters.group, appliedFilters.state,
                appliedFilters.dateFrom, appliedFilters.dateTo, appliedFilters.lastVisitPerson,
                sortBy, sortOrder,
                false,
                {
                    customer:       appliedFilters.customer,
                    contact:        appliedFilters.contact,
                    phone:          appliedFilters.phone,
                    email:          appliedFilters.email,
                    area:           appliedFilters.area,
                    gstin:          appliedFilters.gstin,
                    reseller:       appliedFilters.reseller,
                    active_status:  appliedFilters.active_status,
                    min_lic:        appliedFilters.min_lic,
                    min_active:     appliedFilters.min_active,
                    min_not_ours:   appliedFilters.min_not_ours,
                },
            );

            setLocalCustomers(res.data || []);
            setTotal(res.total || 0);
        } catch (err: any) {
            console.error('Failed to load customers:', err);
            showErrorRef.current('Error', err?.message || 'Failed to load customers');
        } finally {
            setLoading(false);
        }
    }, [page, limit, activeTab, appliedFilters, sortBy, sortOrder]);

    useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

    // Load Admins for Group dropdown
    useEffect(() => {
        const loadAdmins = async () => {
            try {
                const res = await adminsApi.getAll();
                setAdmins(res || []);
            } catch (err) {
                console.error('Failed to load admins:', err);
            }
        };
        loadAdmins();
    }, []);

    // Load resellers (only when the current user can pick one — saves a
    // network call for users who'll never see the field).
    useEffect(() => {
        if (!canEditReseller) return;
        resellersApi.getAll()
            .then(res => setResellers(res.data || []))
            .catch(() => {/* dropdown stays empty; field still renders read-only */});
    }, [canEditReseller]);

    // Load Cloud Users for handler dropdown
    useEffect(() => {
        const loadCloudUsers = async () => {
            try {
                const res = await usersApi.getAll();
                setCloudUsers(res.data || []);
            } catch (err) {
                console.error('Failed to load cloud users:', err);
            }
        };
        loadCloudUsers();
    }, []);

    if (!canSeeOur && !canSeeOthers) {
        return <div className="p-8 text-center text-gray-500">Access Denied</div>;
    }

    // Handlers
    const handleInputChange = (field: string, value: any) => {
        let newValue = value;
        if (typeof value === 'string' && value.length > 0 && ['company', 'address1', 'address2', 'address3'].includes(field)) {
            newValue = value.charAt(0).toUpperCase() + value.slice(1);
        }
        if (field === 'gstin') newValue = String(value).toUpperCase();

        setForm({ ...form, [field]: newValue });
        if (errors[field]) setErrors({ ...errors, [field]: null as any });
    };

    const openAdd = () => {
        setEditing(null);
        setErrors({});
        setForm({
            id: '', group: null, cloud_group_id: '', company: '', email: '',
            address1: '', address2: '', address3: '',
            gstin: '', pincode: '', area: '', state: '',
            remark: '', status: 'Active', active_status: 'Active',
            person: '', mobile: '', designation: '', whatsapp: '', tally: '', btype: '', grade: '',
            resellerid: null,
        });
        setShowModal(true);
    };

    const openEditCustomer = (c: any) => {
        setEditing(c);
        setErrors({});
        setForm({
            id: c.id,
            group: c.group || null,
            cloud_group_id: c.cloud_group_id || '',
            company: c.company,
            email: c.email || '',
            address1: c.address1 || '',
            address2: c.address2 || '',
            address3: c.address3 || '',
            gstin: c.gstin || '',
            pincode: c.pincode || '',
            area: c.area || '',
            state: c.state || '',
            remark: c.remark || '',
            status: c.status,
            active_status: c.active_status || 'Active',
            person: c.person || '',
            mobile: c.mobile || '',
            designation: c.designation || '',
            whatsapp: c.whatsapp || '',
            tally: c.tally || '',
            btype: c.btype || '',
            grade: c.grade || '',
            resellerid: c.resellerid ?? null,
        });
        setShowModal(true);
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!form.company.trim()) newErrors.company = 'Company name is required';

        if (!form.email.trim()) newErrors.email = 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = 'Invalid Email Format';

        if (!form.gstin.trim()) newErrors.gstin = 'GSTIN is required';
        else if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(form.gstin)) newErrors.gstin = 'Invalid GSTIN Format (e.g. 29ABCDE1234F1Z5)';

        if (!form.pincode || form.pincode.length !== 6) newErrors.pincode = 'Valid 6-digit Pincode required';

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = async () => {
        if (!validate()) {
            showError('Validation', 'Please fix form errors');
            return;
        }

        let saveData: any = { ...form };
        if (!editing && !saveData.id) {
            const cleanName = saveData.company.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
            saveData.id = `${cleanName}.abstechnologies.co.in`;
        }
        if (!saveData.id) saveData.id = `cust-${Date.now()}`;

        const { area, state, ...dataToSave } = saveData;

        try {
            if (editing) {
                const { id, ...updateData } = dataToSave;
                // Non-admin: only send address1/2/3 — strip everything else.
                // Reseller can flow through if the user has resellers.edit
                // (admins always get it via the broader admin payload).
                let payload: any = isAdmin() ? updateData : {
                    address1: form.address1,
                    address2: form.address2,
                    address3: form.address3,
                };
                if (!isAdmin() && canEditReseller && form.resellerid !== editing.resellerid) {
                    payload.resellerid = form.resellerid;
                }
                // Belt-and-suspenders: drop resellerid from any payload coming
                // from a user without resellers.edit, even if the form had it.
                if (!canEditReseller) delete payload.resellerid;
                await updateCustomer(editing.id, payload);
                showSuccess('Updated', isAdmin() ? 'Customer updated' : 'Address updated');
            } else {
                if (!canEditReseller) delete (dataToSave as any).resellerid;
                await addCustomer(dataToSave);
                showSuccess('Added', 'Customer added');
            }
            setShowModal(false);
            fetchCustomers();
        } catch (err: any) { showError('Error', err.message); }
    };

    const handleDelete = async (id: string) => {
        // Two-stage confirm — customer delete cascades through mappings,
        // visits, calls, activities, etc., so a casual click shouldn't trigger it.
        const target = localCustomers.find(c => String(c.id) === String(id));
        const name = target?.company || `customer #${id}`;
        if (!window.confirm(`Delete "${name}"? This removes the customer and all linked data (visits, mappings, activities).`)) return;
        if (!window.confirm('This cannot be undone. Continue?')) return;
        try {
            await deleteCustomer(id);
            showSuccess('Deleted', 'Customer removed');
            fetchCustomers();
        } catch (err) { showError('Error', 'Failed to delete'); }
    }

    return (
        <div className="space-y-3 md:space-y-4 pb-20 md:pb-0">
            {/* Stats removed/simplified to avoid confusion since list is filtered? 
                Actually user asked to 'show the data according to page'.
                Stats widgets are currently hardcoded "300". 
                Maybe I should hide them or make them dynamic based on total?
                User just said "show the data". I'll keep UI simple.
            */}



            {/* Action Bar — search lives inside Filter modal now (was a header
                input that auto-loaded 7000+ customers; we now defer all
                fetches until the user clicks Apply). */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-3 mt-2">
                <h1 className="text-lg md:text-2xl font-bold text-gray-900 w-full md:w-auto hidden md:block">
                    {activeTab === 'our' ? 'Our Customers' : 'Not Our Customers'}
                </h1>
                <div className="flex gap-2 w-full md:w-auto justify-end">
                    <button
                        onClick={() => setShowFilterPopup(true)}
                        className={`px-3 h-10 rounded-lg flex items-center gap-2 transition-colors ${
                            hasActiveFilters ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                        title="Search / Filter"
                    >
                        <Filter className="h-4 w-4" />
                        <span className="text-sm font-medium">{hasActiveFilters ? 'Filters Active' : 'Search / Filter'}</span>
                    </button>
                    {hasActiveFilters && (
                        <button
                            onClick={clearSearch}
                            className="bg-gray-100 text-gray-600 px-3 h-10 rounded-lg hover:bg-gray-200 flex items-center gap-1.5 flex-shrink-0"
                            title="Reset"
                        >
                            <RefreshCw className="h-4 w-4" />
                            <span className="text-sm hidden md:inline">Reset</span>
                        </button>
                    )}
                    {canAdd && (
                        <button onClick={openAdd} className="bg-red-600 text-white w-10 md:w-auto md:px-3 h-10 rounded-lg text-sm font-medium hover:bg-red-700 flex items-center justify-center gap-2 flex-shrink-0">
                            <Plus className="h-5 w-5" /> <span className="hidden md:inline">Add New</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Mobile Pagination */}
            <div className="md:hidden">
                <PaginationControls
                    currentPage={page}
                    totalPages={Math.ceil(total / limit)}
                    onPageChange={setPage}
                    loading={loading}
                    totalItems={total}
                    itemsPerPage={limit}
                    className="rounded-lg border bg-gray-50 mb-3"
                />
            </div>

            {/* Mobile View: High Density Cards */}
            <div className="md:hidden space-y-3">
                {localCustomers.map((c) => (
                    <div key={c.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">

                        {/* Row 1: Company Name + Status + Actions */}
                        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                            <span className="font-bold text-gray-900 text-base truncate">{c.company}</span>
                            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.status === 'Active' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                                    {c.status}
                                </span>
                                {canEditCustomer && <button onClick={() => openEditCustomer(c)} className="text-blue-600"><Edit2 className="h-4 w-4" /></button>}
                                {canDel && <button onClick={() => handleDelete(c.id)} className="text-red-600"><Trash2 className="h-4 w-4" /></button>}
                            </div>
                        </div>

                        {/* Row 2: Contact | Phone */}
                        <div className="flex items-center px-3 py-2 text-sm border-b border-gray-50">
                            <span className="text-gray-500">Contact :</span>
                            <span className="font-semibold text-gray-900 ml-1 truncate">{c.person || '—'}</span>
                            <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                            <span className="text-gray-500 flex-shrink-0">Phone :</span>
                            <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{c.mobile || '—'}</span>
                        </div>

                        {/* Row 3: Area | State */}
                        <div className="flex items-center px-3 py-2 text-sm">
                            <span className="text-gray-500">Area :</span>
                            <span className="font-semibold text-gray-900 ml-1 truncate">{c.area || c.city || '—'}</span>
                            <span className="text-gray-300 mx-2 flex-shrink-0">|</span>
                            <span className="text-gray-500 flex-shrink-0">State :</span>
                            <span className="font-semibold text-gray-900 ml-1 flex-shrink-0">{c.state || '—'}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Content - Desktop Table */}
            <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200">
                
                {/* Pagination (Top) */}
                <PaginationControls
                    currentPage={page}
                    totalPages={Math.ceil(total / limit)}
                    onPageChange={setPage}
                    loading={loading}
                    totalItems={total}
                    itemsPerPage={limit}
                    className="rounded-t-lg border-b bg-gray-50"
                />

                <div className="overflow-x-auto border border-gray-300 rounded shadow-sm">
                    <table className="w-full text-sm border-collapse table-fixed">
                        <colgroup>
                            <col className="w-[10%]" /><col className="w-[6%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[10%]" /><col className="w-[5%]" /><col className="w-[7%]" /><col className="w-[6%]" /><col className="w-[9%]" /><col className="w-[4%]" /><col className="w-[4%]" /><col className="w-[4%]" /><col className="w-[6%]" /><col className="w-[8%]" />
                        </colgroup>
                        <thead>
                            <tr className="bg-gray-100">
                                <th onClick={() => handleSort('company')}  className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Customer{sortIcon('company')}</th>
                                <th onClick={() => handleSort('group')}    className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Group{sortIcon('group')}</th>
                                <th onClick={() => handleSort('reseller')} className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Reseller{sortIcon('reseller')}</th>
                                <th onClick={() => handleSort('contact')}  className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Contact{sortIcon('contact')}</th>
                                <th onClick={() => handleSort('phone')}    className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Phone{sortIcon('phone')}</th>
                                <th onClick={() => handleSort('email')}    className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Email{sortIcon('email')}</th>
                                <th onClick={() => handleSort('pincode')}  className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Pincode{sortIcon('pincode')}</th>
                                <th onClick={() => handleSort('area')}     className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Area{sortIcon('area')}</th>
                                <th onClick={() => handleSort('state')}    className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">State{sortIcon('state')}</th>
                                <th onClick={() => handleSort('gstin')}    className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">GSTIn{sortIcon('gstin')}</th>
                                <th className="text-center px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Lic</th>
                                <th className="text-center px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Active</th>
                                <th className="text-center px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Not Ours</th>
                                <th onClick={() => handleSort('status')}   className="text-left px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs cursor-pointer hover:bg-gray-200 select-none">Status{sortIcon('status')}</th>
                                <th className="text-center px-2 py-1.5 font-semibold text-gray-700 border border-gray-300 text-xs">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {localCustomers.map((c) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                    <td className="px-2 py-1.5 border border-gray-300 font-medium text-xs truncate">
                                        <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => openEditCustomer(c)}>{c.company}</span>
                                    </td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 text-xs truncate">{c.group_name || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 text-xs truncate" title={c.reseller_name || ''}>{c.reseller_name || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 text-xs truncate">{c.person || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 font-mono text-xs">{c.mobile || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-blue-600 truncate text-xs">{c.email || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 font-mono text-xs">{c.pincode || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 truncate text-xs" title={c.area || ''}>{c.area || c.city || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 text-xs truncate">{c.state || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-gray-600 font-mono text-xs truncate">{c.gstin || '-'}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-center font-bold text-gray-700 text-xs">{c.total_licenses ?? 0}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-center font-bold text-green-600 text-xs">{c.active_licenses ?? 0}</td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-center font-bold text-gray-400 text-xs">{(c as any).not_ours_licenses ?? 0}</td>
                                    <td className="px-2 py-1.5 border border-gray-300">
                                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${c.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                            }`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 border border-gray-300 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            {canEditCustomer && (
                                                <button onClick={() => openEditCustomer(c)} className="text-blue-600 hover:text-blue-800">
                                                    <Edit2 className="h-4 w-4" />
                                                </button>
                                            )}
                                            {canDel && (
                                                <button onClick={() => handleDelete(c.id)} className="text-red-600 hover:text-red-800">
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {loading && localCustomers.length === 0 && (
                                <tr>
                                    <td colSpan={15} className="text-center py-8 text-gray-400 border border-gray-300">
                                        Loading customers…
                                    </td>
                                </tr>
                            )}
                            {!loading && localCustomers.length === 0 && (
                                <tr>
                                    <td colSpan={15} className="text-center py-8 text-gray-500 border border-gray-300">
                                        {hasActiveFilters ? 'No customers match your filters.' : 'No customers found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>


            </div>

            {/* User Modal - Simplified as per user request (Responsive P-0 / P-4) */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-0 md:p-4">
                    <div className="bg-white w-full h-full md:h-auto md:max-w-lg md:rounded-xl shadow-xl flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-bold text-gray-900">{editing ? 'Edit Customer' : 'Add Customer'}</h3>
                            <button onClick={() => setShowModal(false)}><X className="h-5 w-5 text-gray-400 hover:text-gray-600" /></button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-4">
                            {/* Company Name */}
                            <div>
                                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Company Name <span className="text-red-500">*</span> {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                <input
                                    value={form.company}
                                    onChange={e => handleInputChange('company', e.target.value)}
                                    readOnly={!isAdmin() && !!editing}
                                    disabled={!isAdmin() && !!editing}
                                    className={`w-full border rounded-lg p-2.5 text-sm outline-none ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300' : `focus:ring-2 focus:ring-blue-100 ${errors.company ? 'border-red-500' : 'border-gray-300'}`}`}
                                    placeholder="e.g. Acme Corp"
                                />
                                {errors.company && <p className="text-xs text-red-500 mt-1">{errors.company}</p>}
                            </div>

                            {/* Reseller — only users with resellers.edit can change it.
                                Everyone else still sees the saved value as a read-only chip
                                so they know who the reseller is. */}
                            <div>
                                <label className="block text-xs font-bold text-gray-600 uppercase mb-1">
                                    Reseller {!canEditReseller && <span className="text-gray-400 normal-case font-normal">(read-only — needs Reseller permission)</span>}
                                </label>
                                {canEditReseller ? (
                                    <div ref={resellerDropdownRef} className="relative">
                                        {(() => {
                                            const selectedName = form.resellerid
                                                ? (resellers.find((r: any) => Number(r.id) === Number(form.resellerid))?.name || '')
                                                : '';
                                            const inputValue = showResellerDropdown ? resellerSearch : selectedName;
                                            const filtered = resellers.filter((r: any) =>
                                                !resellerSearch || (r.name || '').toLowerCase().includes(resellerSearch.toLowerCase())
                                            );
                                            return (
                                                <>
                                                    <input
                                                        value={inputValue}
                                                        onChange={e => { setResellerSearch(e.target.value); setShowResellerDropdown(true); }}
                                                        onFocus={() => { setShowResellerDropdown(true); setResellerSearch(''); }}
                                                        placeholder="Search reseller… (or pick None)"
                                                        className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                                                        autoComplete="off" />
                                                    {showResellerDropdown && (
                                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
                                                            <div onClick={() => { setForm({ ...form, resellerid: null }); setResellerSearch(''); setShowResellerDropdown(false); }}
                                                                className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-100 italic text-gray-500">
                                                                — None —
                                                            </div>
                                                            {filtered.length === 0 ? (
                                                                <div className="px-3 py-2 text-sm text-gray-400">No resellers match</div>
                                                            ) : filtered.map((r: any) => (
                                                                <div key={r.id}
                                                                    onClick={() => { setForm({ ...form, resellerid: Number(r.id) }); setResellerSearch(''); setShowResellerDropdown(false); }}
                                                                    className={`px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0 ${Number(form.resellerid) === Number(r.id) ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
                                                                    {r.name}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                ) : (
                                    <input
                                        value={editing?.reseller_name || (form.resellerid ? `#${form.resellerid}` : '')}
                                        readOnly
                                        placeholder="No reseller assigned"
                                        className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
                                )}
                            </div>

                            {/* Handler (Cloud User) | Email */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Handler (User) {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                    <select value={form.cloud_group_id || ''} onChange={e => setForm({ ...form, cloud_group_id: e.target.value || null })} disabled={!isAdmin() && !!editing} className={`w-full border border-gray-300 rounded-lg p-2 text-sm ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white'}`}>
                                        <option value="">-- Select --</option>
                                        {cloudUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Email <span className="text-red-500">*</span> {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                    <input
                                        value={form.email}
                                        onChange={e => handleInputChange('email', e.target.value)}
                                        readOnly={!isAdmin() && !!editing}
                                        disabled={!isAdmin() && !!editing}
                                        className={`w-full border rounded-lg p-2 text-sm outline-none ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300' : (errors.email ? 'border-red-500' : 'border-gray-300')}`}
                                        placeholder="Email Address"
                                    />
                                    {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                                </div>
                            </div>

                            {/* Address Lines — always editable */}
                            <div className="space-y-3">
                                {!isAdmin() && editing && (
                                    <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Address (editable)</div>
                                )}
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Address Line 1</label>
                                    <input value={form.address1} onChange={e => handleInputChange('address1', e.target.value)} className={`w-full border rounded-lg p-2 text-sm ${(!isAdmin() && editing) ? 'border-blue-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300'}`} placeholder="Building/Floor" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Address Line 2</label>
                                    <input value={form.address2} onChange={e => handleInputChange('address2', e.target.value)} className={`w-full border rounded-lg p-2 text-sm ${(!isAdmin() && editing) ? 'border-blue-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300'}`} placeholder="Street/Area" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Address Line 3</label>
                                    <input value={form.address3} onChange={e => handleInputChange('address3', e.target.value)} className={`w-full border rounded-lg p-2 text-sm ${(!isAdmin() && editing) ? 'border-blue-300 focus:border-blue-500 focus:outline-none' : 'border-gray-300'}`} placeholder="Landmark/Etc" />
                                </div>
                            </div>

                            {/* GSTIN | PinCode */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">GSTIN <span className="text-red-500">*</span> {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                    <input
                                        value={form.gstin}
                                        onChange={e => handleInputChange('gstin', e.target.value)}
                                        readOnly={!isAdmin() && !!editing}
                                        disabled={!isAdmin() && !!editing}
                                        className={`w-full border rounded-lg p-2 text-sm outline-none ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300' : (errors.gstin ? 'border-red-500' : 'border-gray-300')}`}
                                        placeholder="GST Number"
                                    />
                                    {errors.gstin && <p className="text-xs text-red-500 mt-1">{errors.gstin}</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">PinCode <span className="text-red-500">*</span> {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                    <div className="relative">
                                        <input value={form.pincode}
                                            onChange={async e => {
                                                if (!isAdmin() && editing) return;
                                                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                                handleInputChange('pincode', val);
                                                if (val.length === 6) {
                                                    try {
                                                        const { pincodeApi } = await import('../services/api');
                                                        const res = await pincodeApi.lookup(val);
                                                        if (res.city) setForm((PREV: any) => ({ ...PREV, area: res.city, state: res.state }));
                                                    } catch (e) { }
                                                }
                                            }}
                                            readOnly={!isAdmin() && !!editing}
                                            disabled={!isAdmin() && !!editing}
                                            className={`w-full border rounded-lg p-2 text-sm pl-8 outline-none ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300' : (errors.pincode ? 'border-red-500' : 'border-gray-300')}`}
                                            placeholder="6 digits"
                                        />
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                                    </div>
                                    {errors.pincode && <p className="text-xs text-red-500 mt-1">{errors.pincode}</p>}
                                </div>
                            </div>

                            {/* Area | State */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Area {!isAdmin() && editing && <span className="text-gray-400 normal-case font-normal">(read-only)</span>}</label>
                                    <input value={form.area} onChange={e => handleInputChange('area', e.target.value)} readOnly={!isAdmin() && !!editing} disabled={!isAdmin() && !!editing} className={`w-full border rounded-lg p-2 text-sm ${(!isAdmin() && editing) ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-300' : 'border-gray-300'}`} placeholder="City/Area" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">State</label>
                                    <input value={form.state} readOnly className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-gray-50 text-gray-500" />
                                </div>
                            </div>

                            {/* Customer Status (admin only) — Active / Inactive */}
                            {isAdmin() && editing && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Customer Status</label>
                                    <div className="flex border border-gray-300 rounded-lg overflow-hidden text-sm w-fit">
                                        <button
                                            type="button"
                                            onClick={() => setForm({ ...form, active_status: 'Active' })}
                                            className={`px-4 py-1.5 font-medium transition-colors ${(form.active_status || 'Active') === 'Active' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                        >Active</button>
                                        <button
                                            type="button"
                                            onClick={() => setForm({ ...form, active_status: 'Inactive' })}
                                            className={`px-4 py-1.5 font-medium transition-colors ${form.active_status === 'Inactive' ? 'bg-red-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                        >Inactive</button>
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100 mt-4">
                                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Cancel</button>
                                <button onClick={handleSave} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium shadow-sm">Save Changes</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <FilterModal
                isOpen={showFilterPopup}
                onClose={() => setShowFilterPopup(false)}
                title="Search / Filter Customers"
                config={[
                    // Quick fuzzy search across company/mobile/email
                    { key: 'search',    label: 'Search (anywhere)',     type: 'text',   placeholder: 'Company / Mobile / Email…', className: 'md:col-span-2 lg:col-span-3' },

                    // Column-specific filters — match the visible table headers
                    { key: 'customer',  label: 'Customer',              type: 'text',   placeholder: 'Company name…' },
                    { key: 'group',     label: 'Group (Handler)',       type: 'select', options: cloudUsers.map(u => ({ value: u.name, label: u.name })) },
                    { key: 'reseller',  label: 'Reseller',              type: 'select', options: resellers.map((r: any) => ({ value: String(r.id), label: r.name })) },

                    { key: 'contact',   label: 'Contact (Person)',      type: 'text',   placeholder: 'e.g. Rakesh' },
                    { key: 'phone',     label: 'Phone',                 type: 'text',   placeholder: '10-digit mobile' },
                    { key: 'email',     label: 'Email',                 type: 'text',   placeholder: 'name@example.com' },

                    { key: 'pincode',   label: 'Pincode',               type: 'text',   placeholder: 'e.g. 560001' },
                    { key: 'area',      label: 'Area',                  type: 'text',   placeholder: 'e.g. Guwahati' },
                    { key: 'city',      label: 'City',                  type: 'text',   placeholder: 'e.g. Bangalore' },

                    { key: 'state',     label: 'State',                 type: 'text',   placeholder: 'e.g. Karnataka' },
                    { key: 'gstin',     label: 'GSTIN',                 type: 'text',   placeholder: '15-char GSTIN' },
                    { key: 'active_status', label: 'Status',            type: 'select', options: [
                        { value: 'Active',   label: 'Active' },
                        { value: 'Inactive', label: 'Inactive' },
                    ]},

                    // License count thresholds
                    { key: 'min_lic',       label: 'Lic ≥',             type: 'number', placeholder: 'Min total licenses' },
                    { key: 'min_active',    label: 'Active ≥',          type: 'number', placeholder: 'Min active licenses' },
                    { key: 'min_not_ours',  label: 'Not Ours ≥',        type: 'number', placeholder: 'Min not-ours' },

                    // Visit / aging
                    { key: 'aging',     label: 'Aging (Days Since Visit)', type: 'select', options: [
                        { value: '30',  label: '> 30 Days' },
                        { value: '60',  label: '> 60 Days' },
                        { value: '90',  label: '> 90 Days' },
                        { value: '180', label: '> 180 Days' },
                    ]},
                    { key: 'lastVisitPerson', label: 'Last Visit By',   type: 'text',   placeholder: 'Person Name' },
                    { key: 'dateFrom',  label: 'Last Visit From',       type: 'date' },
                    { key: 'dateTo',    label: 'Last Visit To',         type: 'date' },
                ]}
                currentFilters={appliedFilters}
                onApply={(filters) => {
                    // Sanitize ('all' is the FilterModal "no filter" placeholder)
                    const sanitized: any = {};
                    for (const [key, value] of Object.entries(filters)) {
                        sanitized[key] = value === 'all' ? '' : value;
                    }
                    setAppliedFilters(prev => ({ ...prev, ...sanitized }));
                    setPage(1);
                    setShowFilterPopup(false);
                }}
                onReset={() => {
                    clearSearch();
                    setShowFilterPopup(false);
                }}
            />
        </div>
    );
};

export default CustomerList;
