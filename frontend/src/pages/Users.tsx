import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Edit2, Trash2, X, Key, Check, ShieldCheck, ShieldOff, Search, 
  Users as UsersIcon, UserCheck, Shield, Cloud, Layers, MapPin, Hash, 
  Filter, ChevronDown, Smartphone, Loader, Copy, Eye, EyeOff 
} from 'lucide-react';
import { useAuth, User, UserPermissions, ColumnPermissions, ColumnPage, ALL_PAGE_COLUMNS, PAGE_DISPLAY_NAMES } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { adminsApi, vchTypeApi, ledgerGroupApi } from '../services/api';
import QRCode from 'qrcode';

const Users: React.FC = () => {
  const { users, addUser, updateUser, updateUserPassword, deleteUser, updateUserPermissions, updateUserColumnPermissions, resetTwoFactor, adminGenerate2FA, adminEnable2FA, isAdmin } = useAuth();
  const { showSuccess, showError, showWarning } = useToast();

  const [showModal, setShowModal] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [pwdUserId, setPwdUserId] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [form, setForm] = useState({ name: '', email: '', status: 'active' as User['status'], role: 'user' as 'admin' | 'user', tag: 'Inside' as 'Inside' | 'Outside', old_id: '' as string, sub_user_id: '' as string, ledger_group_id: '' as string });
  const [legacyAdmins, setLegacyAdmins] = useState<any[]>([]);

  useEffect(() => {
    adminsApi.getAll().then((res: any) => setLegacyAdmins(res.data || res || [])).catch(() => {});
    vchTypeApi.getAll().then((res: any) => {
      const all: any[] = res.data || res || [];
      setAvailableVchTypes(all.filter((t: any) => t.is_system === 1 || t.is_system === true));
    }).catch(() => {});
    ledgerGroupApi.getAll().then((res: any) => setAvailableLedgerGroups(((res.data || res || []) as any[]).filter((g: any) => Number(g.active) !== 0))).catch(() => {});
  }, []);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter state
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const [filters, setFilters] = useState({
    role: '',
    status: '',
    twoFaStatus: '',
    searchText: ''
  });

  // Delete & Reset 2FA Modals State
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reset2FAId, setReset2FAId] = useState<string | null>(null);

  // Permission State in Modal
  const defaultPerms: UserPermissions = {
    servers: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
    customers_our: { view: true, create: false, edit: false, delete: false, export: false },
    customers_not_our: { view: true, create: false, edit: false, delete: false, export: false },
    mappings: { view: true, create: false, edit: false, delete: false, export: false, bulk_renewal: false },
    users: { view: false, create: false, edit: false, delete: false },
    activities: { view: true, create: false, edit: false, delete: false, export: false },
    tdl: { view: false, create: false, edit: false, delete: false, add_requirement: false, delete_requirement: false, add_task: false },
    tasks: { view: true, create: true, edit: true, delete: false, checkin: true, view_history: false },
    visits_our: { view: true, create: true, edit: true, delete: false, checkin: true, force_checkin: false, pause: true },
    visits_not_our: { view: true, create: true, edit: true, delete: false, checkin: true, force_checkin: false, pause: true },
    customer_search: { view: true, copy: false, edit: false, view_all_groups: false },
    pincodes: { view: false, create: false, edit: false, delete: false },
    service_calls: { view: true, create: true, take: true, close: true, transfer: false, cancel: false, view_all: false, view_updates: false },
    leads: { view: true, create: true, take: true, close: true, transfer: false, cancel: false, view_all: false },
    service_followup: { view: false, confirm: false, reopen: false },
    expiry_renew_our: { view: true, copy: false, view_all_groups: false },
    expiry_renew_not_our: { view: true, copy: false, view_all_groups: false },
    call_report: { view: false },
    my_requirements: { cloud: false, tally: false, tdl: false, webapp: false },
    items: { view: false, create: false, edit: false, delete: false },
    ledger_groups: { view: false, create: false, edit: false, delete: false },
    other_ledgers: { view: false, create: false, edit: false, delete: false },
    vch_types: { view: false, create: false, edit: false, delete: false },
    targets: { view: false, create: false, edit: false, delete: false, approve: false },
    vouchers: { view: false, create: false, edit: false, delete: false, check: false, allowed_vch_parent_ids: [], allowed_ledger_group_ids: [] },
    reports_outstanding:      { view: false },
    reports_ledger:           { view: false },
    reports_daybook:          { view: false },
    reports_sales_register:   { view: false },
    reports_group_summary:    { view: false },
    reports_stock_summary:    { view: false },
    reports_user_outstanding: { view: false },
    reports_statistics: { view: false },
    reports_bill_payment: { view: false, create: false, edit: false, delete: false },
    resellers: { view: false, create: false, edit: false, delete: false },
    group_change: { view: false, edit_group: false, edit_reseller: false },
    group_transfer: { view: false, create: false, edit: false, delete: false },
    server_monitor: { view: false, create: false, edit: false, delete: false },
  };
  const [formPerms, setFormPerms] = useState<UserPermissions>(defaultPerms);

  // Column Permissions State
  const defaultColPerms: ColumnPermissions = Object.fromEntries(
    Object.keys(ALL_PAGE_COLUMNS).map(page => [page, { visible: ALL_PAGE_COLUMNS[page as ColumnPage].map(c => c.key), copyable: [] }])
  ) as unknown as ColumnPermissions;
  const [formColPerms, setFormColPerms] = useState<ColumnPermissions>(defaultColPerms);
  const [selectedColPage, setSelectedColPage] = useState<ColumnPage>('servers');
  const [showColPerms, setShowColPerms] = useState(false);

  // Voucher type & ledger group lists for granular permission UI
  const [availableVchTypes, setAvailableVchTypes] = useState<any[]>([]);
  const [availableLedgerGroups, setAvailableLedgerGroups] = useState<any[]>([]);
  const [vchTypeSearch, setVchTypeSearch] = useState('');
  const [ledgerGroupSearch, setLedgerGroupSearch] = useState('');

  // Admin 2FA Setup State
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupUser, setSetupUser] = useState<User | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [setupToken, setSetupToken] = useState('');

  // Stats
  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    with2FA: users.filter(u => u.is_two_fa_enabled).length,
    admins: users.filter(u => u.role?.toLowerCase() === 'admin').length
  }), [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    let result = users;

    // Role filter
    if (filters.role) {
      result = result.filter(u => u.role === filters.role);
    }

    // Status filter
    if (filters.status) {
      result = result.filter(u => u.status === filters.status);
    }

    // 2FA Status filter
    if (filters.twoFaStatus) {
      const twoFaEnabled = filters.twoFaStatus === 'enabled';
      result = result.filter(u => u.is_two_fa_enabled === twoFaEnabled);
    }

    // Search text filter
    const searchText = filters.searchText || searchQuery;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }

    return result;
  }, [users, filters, searchQuery]);

  if (!isAdmin()) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-400">
        <Shield className="h-12 w-12 mb-3" />
        <p className="font-medium">Access Denied</p>
        <p className="text-sm">Admin privileges required</p>
      </div>
    );
  }

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', email: '', status: 'active', role: 'user', tag: 'Inside', old_id: '', sub_user_id: '', ledger_group_id: '' });
    setFormPerms(defaultPerms);
    setFormColPerms(defaultColPerms);
    setShowColPerms(false);
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email, status: u.status, role: u.role, tag: u.tag || 'Inside', old_id: (u as any).old_id?.toString() || '', sub_user_id: (u as any).sub_user_id?.toString() || '', ledger_group_id: (u as any).ledger_group_id?.toString() || '' });
    // Load existing permissions or default if missing
    setFormPerms({
      servers: u.permissions?.servers || defaultPerms.servers,
      customers_our: u.permissions?.customers_our || defaultPerms.customers_our,
      customers_not_our: u.permissions?.customers_not_our || defaultPerms.customers_not_our,
      mappings: u.permissions?.mappings || defaultPerms.mappings,
      users: u.permissions?.users || defaultPerms.users,
      activities: u.permissions?.activities || defaultPerms.activities,
      tdl: u.permissions?.tdl || defaultPerms.tdl,
      pincodes: u.permissions?.pincodes || defaultPerms.pincodes,
      visits_our: u.permissions?.visits_our || defaultPerms.visits_our,
      visits_not_our: u.permissions?.visits_not_our || defaultPerms.visits_not_our,
      tasks: u.permissions?.tasks || defaultPerms.tasks,
      service_calls: u.permissions?.service_calls || defaultPerms.service_calls,
      service_followup: u.permissions?.service_followup || defaultPerms.service_followup,
      customer_search: { ...defaultPerms.customer_search, ...u.permissions?.customer_search },
      expiry_renew_our: { ...defaultPerms.expiry_renew_our, ...u.permissions?.expiry_renew_our },
      expiry_renew_not_our: { ...defaultPerms.expiry_renew_not_our, ...u.permissions?.expiry_renew_not_our },
      call_report: { ...defaultPerms.call_report, ...u.permissions?.call_report },
      leads: { ...defaultPerms.leads, ...u.permissions?.leads },
      my_requirements: {
        cloud: u.permissions?.my_requirements?.cloud ?? defaultPerms.my_requirements!.cloud,
        tally: u.permissions?.my_requirements?.tally ?? defaultPerms.my_requirements!.tally,
        tdl: u.permissions?.my_requirements?.tdl ?? defaultPerms.my_requirements!.tdl,
        webapp: u.permissions?.my_requirements?.webapp ?? defaultPerms.my_requirements!.webapp,
      },
      items: { ...defaultPerms.items, ...u.permissions?.items },
      ledger_groups: { ...defaultPerms.ledger_groups, ...u.permissions?.ledger_groups },
      other_ledgers: { ...defaultPerms.other_ledgers, ...u.permissions?.other_ledgers },
      vch_types: { ...defaultPerms.vch_types, ...u.permissions?.vch_types },
      targets: { ...defaultPerms.targets, ...u.permissions?.targets },
      vouchers: {
        ...defaultPerms.vouchers,
        ...u.permissions?.vouchers,
        allowed_vch_parent_ids: u.permissions?.vouchers?.allowed_vch_parent_ids ?? [],
        allowed_ledger_group_ids: u.permissions?.vouchers?.allowed_ledger_group_ids ?? [],
      },
      reports_outstanding:      { ...defaultPerms.reports_outstanding,      ...u.permissions?.reports_outstanding },
      reports_ledger:           { ...defaultPerms.reports_ledger,           ...u.permissions?.reports_ledger },
      reports_daybook:          { ...defaultPerms.reports_daybook,          ...u.permissions?.reports_daybook },
      reports_sales_register:   { ...defaultPerms.reports_sales_register,   ...u.permissions?.reports_sales_register },
      reports_group_summary:    { ...defaultPerms.reports_group_summary,    ...u.permissions?.reports_group_summary },
      reports_stock_summary:    { ...defaultPerms.reports_stock_summary,    ...u.permissions?.reports_stock_summary },
      reports_user_outstanding: { ...defaultPerms.reports_user_outstanding, ...u.permissions?.reports_user_outstanding },
      reports_statistics: { ...defaultPerms.reports_statistics, ...u.permissions?.reports_statistics },
      reports_bill_payment: { ...defaultPerms.reports_bill_payment,    ...u.permissions?.reports_bill_payment },
      resellers:           { ...defaultPerms.resellers,            ...u.permissions?.resellers },
      group_change:        { ...defaultPerms.group_change,         ...u.permissions?.group_change },
      group_transfer:      { ...defaultPerms.group_transfer,       ...u.permissions?.group_transfer },
      server_monitor:      { ...defaultPerms.server_monitor,       ...u.permissions?.server_monitor },
    });
    // Load column permissions
    if (u.column_permissions) {
      setFormColPerms(u.column_permissions);
    } else {
      setFormColPerms(defaultColPerms);
    }
    setShowColPerms(false);
    setShowModal(true);
  };

  const openPwd = (id: string) => {
    setPwdUserId(id);
    setNewPwd('');
    setShowPwdModal(true);
  };

  const toggleModalPerm = (module: keyof UserPermissions, action: string) => {
    setFormPerms(prev => {
      const modulePerms = { ...prev[module] } as any;
      const newValue = !modulePerms[action];
      
      // Update the target action
      modulePerms[action] = newValue;

      // Hierarchical Logic:
      if (action === 'view' && !newValue) {
        // If 'view' is disabled, disable ALL other actions in this module
        Object.keys(modulePerms).forEach(key => {
          modulePerms[key] = false;
        });
      } else if (action !== 'view' && newValue) {
        // If any sub-action is enabled, automatically enable 'view'
        modulePerms['view'] = true;
      }

      return {
        ...prev,
        [module]: modulePerms
      };
    });
  };

  const handleSave = async () => {
    if (!form.name || !form.email) {
      showError('Error', 'Name and Email required');
      return;
    }
    if (editing) {
      // Update User Details
      const r = await updateUser(editing.id, { ...form, old_id: form.old_id ? Number(form.old_id) : null, sub_user_id: form.sub_user_id || null, ledger_group_id: form.ledger_group_id ? Number(form.ledger_group_id) : null } as any);
      if (!r.success) { showError('Error', r.message); return; }

      // Update Permissions
      const p = await updateUserPermissions(editing.id, formPerms);
      if (!p.success) {
        showWarning('Partial Success', 'User updated but permissions failed');
      }

      // Update Column Permissions
      const cp = await updateUserColumnPermissions(editing.id, formColPerms);
      if (!cp.success) {
        showWarning('Partial Success', 'User updated but column permissions failed');
      } else if (p.success) {
        showSuccess('Updated', 'User, permissions and column permissions updated');
      }
    } else {
      // Create User with Permissions
      const r = await addUser({ ...form, old_id: form.old_id ? Number(form.old_id) : null, sub_user_id: form.sub_user_id || null, ledger_group_id: form.ledger_group_id ? Number(form.ledger_group_id) : null, permissions: formPerms, column_permissions: formColPerms } as any, 'password123');
      if (!r.success) { showError('Error', r.message); return; }
      showSuccess('Created', 'User created with default password: password123');
    }
    setShowModal(false);
  };

  const handlePwdSave = async () => {
    if (newPwd.length < 6) {
      showWarning('Error', 'Minimum 6 characters required');
      return;
    }
    await updateUserPassword(pwdUserId, newPwd);
    showSuccess('Updated', 'Password changed successfully');
    setShowPwdModal(false);
  };



  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      const r = await deleteUser(deleteId);
      if (!r.success) showError('Error', r.message);
      else showSuccess('Deleted', 'User removed');
    } catch (err: any) {
      showError('Error', err.message || 'Failed to delete');
    } finally {
      setDeleteId(null);
    }
  };

  const confirmReset2FA = async () => {
    if (!reset2FAId) return;
    try {
      const r = await resetTwoFactor(reset2FAId);
      if (!r.success) showError('Error', r.message);
      else showSuccess('Reset', '2FA has been reset');
    } catch (err: any) {
      showError('Error', err.message || 'Failed to reset 2FA');
    } finally {
      setReset2FAId(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const handleReset2FA = (id: string) => {
    setReset2FAId(id);
  };

  const handleSetup2FA = async (u: User) => {
    setSetupUser(u);
    setShowSetupModal(true);
    setIsGenerating(true);
    setQrCodeUrl('');
    setSetupSecret('');
    setSetupToken('');
    try {
      const result = await adminGenerate2FA(u.id);
      setSetupSecret(result.secret);
      const qrUrl = await QRCode.toDataURL(result.otpauthUrl);
      setQrCodeUrl(qrUrl);
    } catch (err) {
      showError('Error', 'Failed to generate 2FA');
      setShowSetupModal(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAdminEnable2FA = async () => {
    if (!setupUser) return;
    setIsActivating(true);
    try {
      const result = await adminEnable2FA(setupUser.id, setupSecret, setupToken);
      if (result.success) {
        showSuccess('Enabled', `2FA activated for ${setupUser.name}`);
        setShowSetupModal(false);
      } else {
        showError('Error', result.message);
      }
    } catch (err) {
      showError('Error', 'Failed to enable 2FA');
    } finally {
      setIsActivating(false);
    }
  };

  // Filter functions
  const applyFilters = () => {
    setFilters(prev => ({
      ...prev,
      searchText: searchQuery
    }));
    setShowFilterPopup(false);
  };

  const resetFilters = () => {
    setFilters({
      role: '',
      status: '',
      twoFaStatus: '',
      searchText: ''
    });
    setSearchQuery('');
    setShowFilterPopup(false);
  };

  const clearFilter = (filterKey: keyof typeof filters) => {
    setFilters(prev => ({ ...prev, [filterKey]: '' }));
  };

  const hasActiveFilters = filters.role || filters.status || filters.twoFaStatus || filters.searchText;

  // Individual feature buttons per module — each feature is its own toggle
  // Multiple buttons can map to the same permission key (they stay in sync)
  const moduleFeatures: { module: keyof UserPermissions; label: string; sectionHeader?: string; features: { name: string; action: string }[] }[] = [
    {
      module: 'servers', label: 'Servers', sectionHeader: 'Cloud & Servers',
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Export',     action: 'export' },
        { name: 'Add',        action: 'create' },
        { name: 'Bulk Renew', action: 'bulk_renewal' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Delete',     action: 'delete' },
      ]
    },
    {
      module: 'mappings', label: 'Mapping', sectionHeader: undefined,
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Export',     action: 'export' },
        { name: 'Add',        action: 'create' },
        { name: 'Bulk Renew', action: 'bulk_renewal' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Delete',     action: 'delete' },
      ]
    },
    {
      module: 'activities', label: 'Billing / Purchase Activity', sectionHeader: undefined,
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Export',     action: 'export' },
        { name: 'Create',     action: 'create' },
        { name: 'Renew',      action: 'create' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Delete',     action: 'delete' },
      ]
    },
    {
      module: 'customers_our', label: 'Our Customers', sectionHeader: 'Customers & CRM',
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Export',     action: 'export' },
        { name: 'Add',        action: 'create' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Delete',     action: 'delete' },
      ]
    },
    {
      module: 'customers_not_our', label: 'Not Our Customers',
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Export',     action: 'export' },
        { name: 'Add',        action: 'create' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Delete',     action: 'delete' },
      ]
    },
    {
      module: 'customer_search', label: 'Customer Search',
      features: [
        { name: 'View', action: 'view' },
        { name: 'Copy', action: 'copy' },
        { name: 'Edit', action: 'edit' },
        { name: 'View All Groups', action: 'view_all_groups' },
      ]
    },
    {
      module: 'tdl', label: 'TDL Customization', sectionHeader: 'TDL & Development',
      features: [
        { name: 'View',              action: 'view' },
        { name: 'Create',            action: 'create' },
        { name: 'Edit',              action: 'edit' },
        { name: 'Delete',            action: 'delete' },
        { name: 'Add Requirement',   action: 'add_requirement' },
        { name: 'Del Requirement',   action: 'delete_requirement' },
        { name: 'Add Task',          action: 'add_task' },
      ]
    },
    {
      module: 'server_monitor', label: 'Server Monitor', sectionHeader: undefined,
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit (Port/Active/Sync)', action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'tasks', label: 'Tasks', sectionHeader: 'Field Operations',
      features: [
        { name: 'View',       action: 'view' },
        { name: 'Add',        action: 'create' },
        { name: 'Edit',       action: 'edit' },
        { name: 'Check-In',   action: 'checkin' },
        { name: 'Delete',     action: 'delete' },
        { name: 'History',    action: 'view_history' },
      ]
    },
    {
      module: 'visits_our', label: 'OC Visits & Pending Visits',
      features: [
        { name: 'View',          action: 'view' },
        { name: 'Log Visit',     action: 'create' },
        { name: 'Edit',          action: 'edit' },
        { name: 'Check-In',      action: 'checkin' },
        { name: 'Force Check-In', action: 'force_checkin' },
        { name: 'Pause',         action: 'pause' },
        { name: 'Delete',        action: 'delete' },
      ]
    },
    {
      module: 'visits_not_our', label: 'NOC Visits & Pending Visits',
      features: [
        { name: 'View',          action: 'view' },
        { name: 'Log Visit',     action: 'create' },
        { name: 'Edit',          action: 'edit' },
        { name: 'Check-In',      action: 'checkin' },
        { name: 'Force Check-In', action: 'force_checkin' },
        { name: 'Pause',         action: 'pause' },
        { name: 'Delete',        action: 'delete' },
      ]
    },
    {
      module: 'service_calls', label: 'Service Calls',
      features: [
        { name: 'View',                     action: 'view' },
        { name: 'Add',                      action: 'create' },
        { name: 'Take',                     action: 'take' },
        { name: 'Close',                    action: 'close' },
        { name: 'Transfer',                 action: 'transfer' },
        { name: 'Cancel',                   action: 'cancel' },
        { name: 'View All Users\' Pending & Completed', action: 'view_all' },
        { name: 'View Service Updates (notes / history)', action: 'view_updates' },
      ]
    },
    {
      module: 'leads', label: 'Leads',
      features: [
        { name: 'View',                     action: 'view' },
        { name: 'Add',                      action: 'create' },
        { name: 'Take',                     action: 'take' },
        { name: 'Close',                    action: 'close' },
        { name: 'Transfer',                 action: 'transfer' },
        { name: 'Cancel',                   action: 'cancel' },
        { name: 'View All Users\' Pending & Completed', action: 'view_all' },
      ]
    },
    {
      module: 'my_requirements', label: 'My Requirements',
      features: [
        { name: 'Cloud',   action: 'cloud' },
        { name: 'Tally',   action: 'tally' },
        { name: 'TDL',     action: 'tdl' },
        { name: 'Web/App', action: 'webapp' },
      ]
    },
    {
      module: 'service_followup', label: 'Service Follow-up',
      features: [
        { name: 'View',    action: 'view' },
        { name: 'Confirm', action: 'confirm' },
        { name: 'Reopen',  action: 'reopen' },
      ]
    },
    // ── Accounting — Masters ──────────────────────────────────────────────────
    {
      module: 'items', label: 'Items / Groups / Categories', sectionHeader: 'Accounting — Masters',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'ledger_groups', label: 'Ledger Groups',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'other_ledgers', label: 'Other Ledgers',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'vch_types', label: 'Voucher Types',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    // ── Accounting — Vouchers & Targets ───────────────────────────────────────
    {
      module: 'vouchers', label: 'Vouchers (Sales / Purchase / Receipt / Payment)', sectionHeader: 'Accounting — Vouchers & Targets',
      features: [
        { name: 'View',          action: 'view' },
        { name: 'Create',        action: 'create' },
        { name: 'Edit',          action: 'edit' },
        { name: 'Delete',        action: 'delete' },
        { name: 'Mark Checked',  action: 'check' },
      ]
    },
    {
      module: 'targets', label: 'Targets',
      features: [
        { name: 'View',    action: 'view' },
        { name: 'Add',     action: 'create' },
        { name: 'Edit',    action: 'edit' },
        { name: 'Delete',  action: 'delete' },
        { name: 'Approve', action: 'approve' },
      ]
    },
    // ── Reports ───────────────────────────────────────────────────────────────
    {
      module: 'expiry_renew_our', label: 'Our Expiry Renew Report', sectionHeader: 'Reports',
      features: [
        { name: 'View',            action: 'view' },
        { name: 'Copy',            action: 'copy' },
        { name: 'View All Groups', action: 'view_all_groups' },
      ]
    },
    {
      module: 'expiry_renew_not_our', label: 'Not Our Expiry Renew Report',
      features: [
        { name: 'View',            action: 'view' },
        { name: 'Copy',            action: 'copy' },
        { name: 'View All Groups', action: 'view_all_groups' },
      ]
    },
    {
      module: 'call_report', label: 'Call Report',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_outstanding', label: 'Outstanding Report',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_ledger', label: 'Ledger Report',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_daybook', label: 'Day Book',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_sales_register', label: 'Sales Register',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_group_summary', label: 'Group Summary',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_stock_summary', label: 'Stock Summary',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_user_outstanding', label: 'User-wise Outstanding',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    {
      module: 'reports_bill_payment', label: 'Bill & Payment Reports',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'reports_statistics', label: 'Statistics',
      features: [
        { name: 'View', action: 'view' },
      ]
    },
    // ── Administration ────────────────────────────────────────────────────────
    {
      module: 'resellers', label: 'Resellers (Master)', sectionHeader: 'Administration',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'group_change', label: 'Group / Reseller Change',
      features: [
        { name: 'View',          action: 'view' },
        { name: 'Edit Group',    action: 'edit_group' },
        { name: 'Edit Reseller', action: 'edit_reseller' },
      ]
    },
    {
      module: 'group_transfer', label: 'Group Transfer (Ledger Group)',
      features: [
        { name: 'View',            action: 'view' },
        { name: 'Add',             action: 'create' },
        { name: 'Edit (Transfer)', action: 'edit' },
        { name: 'Delete',          action: 'delete' },
      ]
    },
    {
      module: 'pincodes', label: 'Pincodes',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
    {
      module: 'users', label: 'User Management',
      features: [
        { name: 'View',   action: 'view' },
        { name: 'Add',    action: 'create' },
        { name: 'Edit',   action: 'edit' },
        { name: 'Delete', action: 'delete' },
      ]
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
              <div className="text-xs text-gray-500 font-medium">Total Users</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-green-50 text-green-600 rounded-xl">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.active}</div>
              <div className="text-xs text-gray-500 font-medium">Active</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.with2FA}</div>
              <div className="text-xs text-gray-500 font-medium">2FA Enabled</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-xl">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.admins}</div>
              <div className="text-xs text-gray-500 font-medium">Admins</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilterPopup(true)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all shadow-sm ${
                hasActiveFilters 
                  ? 'bg-red-600 text-white hover:bg-red-700' 
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filter
              {hasActiveFilters && (
                <span className="bg-white text-red-600 text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {[filters.role, filters.status, filters.twoFaStatus, filters.searchText].filter(Boolean).length}
                </span>
              )}
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Add User
            </button>
          </div>
        </div>

        {/* Filter Chips */}
        {hasActiveFilters && (
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-blue-700">Active Filters:</span>
              {filters.role && (
                <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                  <span>Role: {filters.role}</span>
                  <button onClick={() => clearFilter('role')} className="hover:bg-blue-200 rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {filters.status && (
                <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                  <span>Status: {filters.status}</span>
                  <button onClick={() => clearFilter('status')} className="hover:bg-blue-200 rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {filters.twoFaStatus && (
                <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                  <span>2FA: {filters.twoFaStatus}</span>
                  <button onClick={() => clearFilter('twoFaStatus')} className="hover:bg-blue-200 rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {filters.searchText && (
                <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                  <span>Search: "{filters.searchText}"</span>
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

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Role</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-center">2FA</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-center">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm ${u.role?.toLowerCase() === 'admin' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{u.name}</div>
                        <div className="text-xs text-gray-500 truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit px-2 py-0.5 rounded text-xs font-bold uppercase ${u.role?.toLowerCase() === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role?.toLowerCase() === 'admin' ? 'System Admin' : u.role}
                      </span>
                      <span className={`inline-flex w-fit px-2 py-0.5 rounded text-[10px] font-bold border ${u.tag === 'Outside' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {u.tag || 'Inside'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.is_two_fa_enabled ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 border border-green-200 rounded text-xs font-bold">
                        <ShieldCheck className="h-3 w-3" /> ON
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded text-xs font-bold">
                        <ShieldOff className="h-3 w-3" /> OFF
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => openPwd(u.id)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Password">
                        <Key className="h-4 w-4" />
                      </button>
                      {u.is_two_fa_enabled ? (
                        <button onClick={() => handleReset2FA(u.id)} className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors" title="Reset 2FA">
                          <ShieldOff className="h-4 w-4" />
                        </button>
                      ) : (
                        <button onClick={() => handleSetup2FA(u)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Setup 2FA">
                          <ShieldCheck className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(u.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                    {searchQuery ? 'No users match your search' : 'No users found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal with Permissions */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50 flex-shrink-0">
              <h3 className="font-bold text-gray-900">{editing ? 'Edit User & Permissions' : 'Add New User'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-200 rounded-lg"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* User Details Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={form.role || 'user'}
                    onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Geofence Tag</label>
                  <div className="relative">
                    <select
                      value={form.tag || 'Inside'}
                      onChange={e => setForm({ ...form, tag: e.target.value as 'Inside' | 'Outside' })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none appearance-none bg-white"
                    >
                      <option value="Inside">Inside (Strict 50m)</option>
                      <option value="Outside">Outside (Flexible)</option>
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                  <select
                    value={form.old_id}
                    onChange={e => setForm({ ...form, old_id: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  >
                    <option value="">-- None --</option>
                    {legacyAdmins.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sub User</label>
                  <select
                    value={form.sub_user_id}
                    onChange={e => setForm({ ...form, sub_user_id: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  >
                    <option value="">-- None --</option>
                    {users.filter(u => editing ? u.id !== editing.id : true).map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ledger Group</label>
                  <select
                    value={form.ledger_group_id}
                    onChange={e => setForm({ ...form, ledger_group_id: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  >
                    <option value="">-- Not assigned (no ledger access) --</option>
                    <option value="0">All Ledgers</option>
                    {availableLedgerGroups.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">Not assigned = ledger reports are empty for this user. "All Ledgers" = sees everything (admins always do). A specific group = only ledgers under that group and its sub-groups.</p>
                </div>
              </div>

              {/* Permissions Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-red-600" />
                    Access Permissions
                  </h4>

                  {/* Role Presets */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">Quick Role:</span>
                    <select
                      className="text-xs border-gray-200 rounded-lg focus:ring-red-500 focus:border-red-500 py-1 pl-2 pr-8"
                      onChange={(e) => {
                        const role = e.target.value;
                        if (role === 'custom') return;

                        // Helper: set all boolean permissions on every entity
                        const setAllPerms = (val: boolean): UserPermissions => {
                          const result = {} as any;
                          for (const key of Object.keys(defaultPerms)) {
                            const entity = defaultPerms[key as keyof UserPermissions];
                            const newEntity = {} as any;
                            for (const action of Object.keys(entity || {})) {
                              const defVal = (entity as any)[action];
                              // Preserve array fields (like allowed_vch_parent_ids) — only toggle booleans
                              newEntity[action] = Array.isArray(defVal) ? defVal : val;
                            }
                            result[key] = newEntity;
                          }
                          return result as UserPermissions;
                        };

                        let newPerms = { ...defaultPerms };

                        if (role === 'super_admin') {
                          newPerms = setAllPerms(true);
                        } else if (role === 'manager') {
                          newPerms = setAllPerms(true);
                          // Remove delete from all
                          for (const key of Object.keys(newPerms)) {
                            (newPerms[key as keyof UserPermissions] as any).delete = false;
                          }
                          newPerms.users = { ...defaultPerms.users }; // no user mgmt
                        } else if (role === 'field_staff') {
                          newPerms = { ...defaultPerms };
                          newPerms.customers_our = { ...defaultPerms.customers_our, create: true, edit: true };
                          newPerms.customers_not_our = { ...defaultPerms.customers_not_our, create: true, edit: true };
                          newPerms.activities = { ...defaultPerms.activities, view: true, create: true, edit: true, delete: true };
                          newPerms.visits_our = { ...defaultPerms.visits_our, view: true, create: true, edit: true, checkin: true, pause: true };
                          newPerms.visits_not_our = { ...defaultPerms.visits_not_our, view: true, create: true, edit: true, checkin: true, pause: true };
                          newPerms.tasks = { ...defaultPerms.tasks, view: true, create: true, edit: true, checkin: true };
                          newPerms.service_calls = { ...defaultPerms.service_calls, view: true, create: true, take: true, close: true, transfer: true, cancel: true };
                          newPerms.leads = { ...defaultPerms.leads, view: true, create: true, take: true, close: true, transfer: true, cancel: true };
                          newPerms.users = { ...defaultPerms.users };
                        } else if (role === 'view_only') {
                          newPerms = setAllPerms(false);
                          // Enable view on every entity 
                          for (const key of Object.keys(newPerms)) {
                            (newPerms[key as keyof UserPermissions] as any).view = true;
                          }
                          newPerms.users = { ...defaultPerms.users }; // no user mgmt
                        }

                        setFormPerms(newPerms);
                      }}
                      defaultValue="custom"
                    >
                      <option value="custom">Custom / Select...</option>
                      <option value="super_admin">Full Access (Super Admin)</option>
                      <option value="manager">Manager (No Delete)</option>
                      <option value="field_staff">Field Staff (Activities & Customers)</option>
                      <option value="view_only">View Only</option>
                    </select>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                  {moduleFeatures.map(({ module: mod, label, features, sectionHeader }) => (
                    <React.Fragment key={mod}>
                      {sectionHeader && (
                        <div className="px-4 py-1.5 bg-gray-100 border-y border-gray-200 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{sectionHeader}</span>
                        </div>
                      )}
                      <div className="px-3 md:px-4 py-2.5 md:py-3 hover:bg-gray-50/50 transition-colors border-b border-gray-100 last:border-b-0">
                        <div className="font-medium text-xs md:text-sm text-gray-900 mb-1.5 md:mb-2">
                          {label}
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:flex md:flex-wrap gap-1 md:gap-1.5">
                          {features.map((feat, idx) => (
                            <button
                              key={`${feat.name}-${idx}`}
                              onClick={() => toggleModalPerm(mod, feat.action as any)}
                              className={`px-2 md:px-2.5 py-1 md:py-1.5 rounded-lg text-[9px] md:text-[10px] font-bold transition-all border whitespace-nowrap text-center ${(formPerms[mod] as any)[feat.action]
                                ? 'bg-red-50 text-red-600 border-red-200 shadow-sm'
                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                                }`}
                            >
                              {feat.name}
                            </button>
                          ))}
                        </div>
                        {mod === 'vouchers' && (
                          <div className="mt-3 space-y-3">
                            {/* Allowed Voucher Types */}
                            <div className="border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                                  Allowed Voucher Types
                                </span>
                                <span className="text-[9px] text-gray-400">
                                  {(() => { const a = (formPerms.vouchers as any).allowed_vch_parent_ids ?? []; return a.length === 0 ? 'all allowed' : `${a.length} selected`; })()}
                                </span>
                              </div>
                              <input
                                type="text"
                                placeholder="Search voucher types..."
                                value={vchTypeSearch}
                                onChange={e => setVchTypeSearch(e.target.value)}
                                className="w-full text-[10px] border border-gray-200 rounded-md px-2 py-1 mb-1.5 bg-white focus:outline-none focus:border-blue-300"
                              />
                              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                {availableVchTypes
                                  .filter((vt: any) => vt.name.toLowerCase().includes(vchTypeSearch.toLowerCase()))
                                  .map((vt: any) => {
                                    const allowed: number[] = (formPerms.vouchers as any).allowed_vch_parent_ids ?? [];
                                    const isOn = allowed.includes(vt.id);
                                    return (
                                      <button
                                        key={vt.id}
                                        type="button"
                                        onClick={() => setFormPerms(prev => {
                                          const cur: number[] = (prev.vouchers as any).allowed_vch_parent_ids ?? [];
                                          const next = isOn ? cur.filter((id: number) => id !== vt.id) : [...cur, vt.id];
                                          return { ...prev, vouchers: { ...prev.vouchers, allowed_vch_parent_ids: next } as any };
                                        })}
                                        className={`px-2 py-1 rounded-md text-[9px] md:text-[10px] font-semibold transition-all border whitespace-nowrap ${
                                          isOn ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                                        }`}
                                      >
                                        {vt.name}
                                      </button>
                                    );
                                  })}
                                {availableVchTypes.length === 0 && (
                                  <span className="text-[10px] text-gray-400 italic">Loading...</span>
                                )}
                                {availableVchTypes.length > 0 && availableVchTypes.filter((vt: any) => vt.name.toLowerCase().includes(vchTypeSearch.toLowerCase())).length === 0 && (
                                  <span className="text-[10px] text-gray-400 italic">No match</span>
                                )}
                              </div>
                            </div>
                            {/* Allowed Ledger Groups */}
                            <div className="border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                                  Allowed Ledger Groups
                                </span>
                                <span className="text-[9px] text-gray-400">
                                  {(() => { const a = (formPerms.vouchers as any).allowed_ledger_group_ids ?? []; return a.length === 0 ? 'all allowed' : `${a.length} selected`; })()}
                                </span>
                              </div>
                              <input
                                type="text"
                                placeholder="Search ledger groups..."
                                value={ledgerGroupSearch}
                                onChange={e => setLedgerGroupSearch(e.target.value)}
                                className="w-full text-[10px] border border-gray-200 rounded-md px-2 py-1 mb-1.5 bg-white focus:outline-none focus:border-purple-300"
                              />
                              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                                {availableLedgerGroups
                                  .filter((lg: any) => lg.name.toLowerCase().includes(ledgerGroupSearch.toLowerCase()))
                                  .map((lg: any) => {
                                    const allowed: number[] = (formPerms.vouchers as any).allowed_ledger_group_ids ?? [];
                                    const isOn = allowed.includes(lg.id);
                                    return (
                                      <button
                                        key={lg.id}
                                        type="button"
                                        onClick={() => setFormPerms(prev => {
                                          const cur: number[] = (prev.vouchers as any).allowed_ledger_group_ids ?? [];
                                          const next = isOn ? cur.filter((id: number) => id !== lg.id) : [...cur, lg.id];
                                          return { ...prev, vouchers: { ...prev.vouchers, allowed_ledger_group_ids: next } as any };
                                        })}
                                        className={`px-2 py-1 rounded-md text-[9px] md:text-[10px] font-semibold transition-all border whitespace-nowrap ${
                                          isOn ? 'bg-purple-600 text-white border-purple-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
                                        }`}
                                      >
                                        {lg.name}
                                      </button>
                                    );
                                  })}
                                {availableLedgerGroups.length === 0 && (
                                  <span className="text-[10px] text-gray-400 italic">Loading...</span>
                                )}
                                {availableLedgerGroups.length > 0 && availableLedgerGroups.filter((lg: any) => lg.name.toLowerCase().includes(ledgerGroupSearch.toLowerCase())).length === 0 && (
                                  <span className="text-[10px] text-gray-400 italic">No match</span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Column Permissions Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-600" />
                    Column Permissions
                  </h4>
                  <button
                    onClick={() => setShowColPerms(!showColPerms)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${showColPerms ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {showColPerms ? 'Hide Column Settings' : 'Show Column Settings'}
                  </button>
                </div>

                {showColPerms && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    {/* Page Selector */}
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-gray-500">Page:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(PAGE_DISPLAY_NAMES) as ColumnPage[]).map(page => (
                            <button
                              key={page}
                              onClick={() => setSelectedColPage(page)}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                                selectedColPage === page
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-white text-gray-500 border border-gray-200 hover:border-blue-300 hover:text-blue-600'
                              }`}
                            >
                              {PAGE_DISPLAY_NAMES[page]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="px-4 py-2 bg-gray-50/50 border-b border-gray-100 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quick:</span>
                      <button
                        onClick={() => {
                          const allCols = ALL_PAGE_COLUMNS[selectedColPage].map(c => c.key);
                          setFormColPerms(prev => ({ ...prev, [selectedColPage]: { ...prev[selectedColPage], visible: [...allCols] } }));
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100"
                      >
                        Show All
                      </button>
                      <button
                        onClick={() => {
                          setFormColPerms(prev => ({ ...prev, [selectedColPage]: { ...prev[selectedColPage], visible: [] } }));
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                      >
                        Hide All
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => {
                          const allCols = ALL_PAGE_COLUMNS[selectedColPage].map(c => c.key);
                          setFormColPerms(prev => ({ ...prev, [selectedColPage]: { ...prev[selectedColPage], copyable: [...allCols] } }));
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
                      >
                        Allow All Copy
                      </button>
                      <button
                        onClick={() => {
                          setFormColPerms(prev => ({ ...prev, [selectedColPage]: { ...prev[selectedColPage], copyable: [] } }));
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100"
                      >
                        Block All Copy
                      </button>
                    </div>

                    {/* Column Grid */}
                    <div className="px-4 py-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {ALL_PAGE_COLUMNS[selectedColPage].map(col => {
                          const pagePerms = formColPerms[selectedColPage];
                          const isVis = pagePerms?.visible?.includes(col.key) ?? true;
                          const isCopy = pagePerms?.copyable?.includes(col.key) ?? false;

                          return (
                            <div key={col.key} className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-all ${isVis ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                              <span className={`text-xs font-medium ${isVis ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                                {col.label}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {/* Visible Toggle */}
                                <button
                                  onClick={() => {
                                    setFormColPerms(prev => {
                                      const current = prev[selectedColPage];
                                      const visible = current.visible.includes(col.key)
                                        ? current.visible.filter(k => k !== col.key)
                                        : [...current.visible, col.key];
                                      // If hiding, also remove from copyable
                                      const copyable = visible.includes(col.key) ? current.copyable : current.copyable.filter(k => k !== col.key);
                                      return { ...prev, [selectedColPage]: { visible, copyable } };
                                    });
                                  }}
                                  className={`p-1 rounded transition-all ${isVis ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                  title={isVis ? 'Visible - Click to hide' : 'Hidden - Click to show'}
                                >
                                  {isVis ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                </button>
                                {/* Copy Toggle */}
                                <button
                                  onClick={() => {
                                    if (!isVis) return; // Can't enable copy on hidden column
                                    setFormColPerms(prev => {
                                      const current = prev[selectedColPage];
                                      const copyable = current.copyable.includes(col.key)
                                        ? current.copyable.filter(k => k !== col.key)
                                        : [...current.copyable, col.key];
                                      return { ...prev, [selectedColPage]: { ...current, copyable } };
                                    });
                                  }}
                                  disabled={!isVis}
                                  className={`p-1 rounded transition-all ${isCopy && isVis ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'} ${!isVis ? 'opacity-30 cursor-not-allowed' : ''}`}
                                  title={isCopy ? 'Copy allowed - Click to block' : 'Copy blocked - Click to allow'}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <div className="p-0.5 bg-green-100 text-green-700 rounded"><Eye className="h-3 w-3" /></div>
                        <span className="text-[10px] text-gray-500">Visible</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="p-0.5 bg-gray-100 text-gray-400 rounded"><EyeOff className="h-3 w-3" /></div>
                        <span className="text-[10px] text-gray-500">Hidden</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="p-0.5 bg-blue-100 text-blue-700 rounded"><Copy className="h-3 w-3" /></div>
                        <span className="text-[10px] text-gray-500">Copy Allowed</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="p-0.5 bg-gray-100 text-gray-400 rounded"><Copy className="h-3 w-3" /></div>
                        <span className="text-[10px] text-gray-500">Copy Blocked</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!editing && (
                <p className="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-lg border border-blue-100">
                  New users are created with default password: <span className="font-mono font-bold">password123</span>
                </p>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
              <button onClick={handleSave} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 shadow-sm">{editing ? 'Save Changes' : 'Create User'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPwdModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Key className="h-5 w-5 text-gray-600" />
                Change Password
              </h3>
              <button onClick={() => setShowPwdModal(false)} className="p-1 hover:bg-gray-200 rounded-lg"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                placeholder="Minimum 6 characters"
              />
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button onClick={() => setShowPwdModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
              <button onClick={handlePwdSave} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700">Update Password</button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA Setup Modal */}
      {showSetupModal && setupUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <div className="flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2">
                  <Smartphone className="h-5 w-5" />
                  Setup 2FA for {setupUser.name}
                </h3>
                <button onClick={() => setShowSetupModal(false)} className="p-1 hover:bg-white/20 rounded-lg"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="p-6 text-center space-y-4">
              <p className="text-sm text-gray-600">
                Scan this QR code with Google Authenticator or share the secret key.
              </p>

              {qrCodeUrl ? (
                <div className="bg-white p-3 inline-block rounded-xl border-2 border-gray-100 shadow-sm">
                  <img src={qrCodeUrl} alt="QR Code" className="h-48 w-48 mx-auto" />
                </div>
              ) : (
                <div className="h-48 w-48 bg-gray-50 rounded-xl mx-auto flex items-center justify-center">
                  <Loader className="h-8 w-8 text-gray-300 animate-spin" />
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Secret Key</p>
                <div className="flex items-center justify-center gap-2 font-mono text-sm text-blue-600 tracking-wider break-all">
                  {setupSecret}
                  <button onClick={() => navigator.clipboard.writeText(setupSecret)} className="p-1 hover:bg-white rounded transition-colors text-gray-400 hover:text-blue-600 flex-shrink-0">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Enter 6-digit Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={setupToken}
                  onChange={e => setSetupToken(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2 text-center text-lg font-mono tracking-widest border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="000000"
                />
              </div>

            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button onClick={() => setShowSetupModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
              <button
                onClick={handleAdminEnable2FA}
                disabled={isActivating || !setupSecret || setupToken.length !== 6}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isActivating ? <Loader className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Verify & Activate
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-red-600">
                <Trash2 className="h-6 w-6" />
                <h3 className="text-lg font-bold">Delete User?</h3>
              </div>
              <p className="text-gray-600 mb-6">Are you sure you want to delete this user? This action cannot be undone.</p>
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
                  Delete User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset 2FA Confirmation Modal */}
      {reset2FAId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-orange-600">
                <ShieldOff className="h-6 w-6" />
                <h3 className="text-lg font-bold">Reset 2FA?</h3>
              </div>
              <p className="text-gray-600 mb-6">Are you sure you want to reset 2FA for this user? They will need to set up 2FA again.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setReset2FAId(null)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReset2FA}
                  className="px-4 py-2 bg-orange-600 text-white hover:bg-orange-700 rounded-lg transition-colors font-medium shadow-sm"
                >
                  Reset 2FA
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Popup */}
      {showFilterPopup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Filter className="h-5 w-5 text-red-600" />
                Filter Users
              </h3>
              <button onClick={() => setShowFilterPopup(false)} className="p-1 hover:bg-gray-200 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Role Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <select
                  value={filters.role}
                  onChange={e => setFilters(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                >
                  <option value="">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={filters.status}
                  onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* 2FA Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">2FA Status</label>
                <select
                  value={filters.twoFaStatus}
                  onChange={e => setFilters(prev => ({ ...prev, twoFaStatus: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                >
                  <option value="">All 2FA Status</option>
                  <option value="enabled">2FA Enabled</option>
                  <option value="disabled">2FA Disabled</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={resetFilters}
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                Reset
              </button>
              <button
                onClick={applyFilters}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
