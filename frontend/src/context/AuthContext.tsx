import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { authApi, usersApi, updateLastActivity, storeToken, clearToken } from '../services/api';
import { subscribeToPush, unsubscribeFromPush, isPushSupported } from '../services/pushNotifications';
import { startNotificationService, stopNotificationService } from '../services/notificationBridge';

// Types
export type UserRole = 'admin' | 'user';
export type EntityType = 'servers' | 'customers_our' | 'customers_not_our' | 'customer_search' | 'mappings' | 'users' | 'activities' | 'tdl' | 'pincodes' | 'visits_our' | 'visits_not_our' | 'tasks' | 'service_calls' | 'leads' | 'service_followup' | 'expiry_renew_our' | 'expiry_renew_not_our' | 'call_report' | 'my_requirements' | 'items' | 'ledger_groups' | 'other_ledgers' | 'vch_types' | 'targets' | 'vouchers' | 'reports_outstanding' | 'reports_ledger' | 'reports_daybook' | 'reports_sales_register' | 'reports_group_summary' | 'reports_stock_summary' | 'reports_user_outstanding' | 'resellers' | 'group_change' | 'server_monitor';

export interface UserPermissions {
  servers: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; bulk_renewal: boolean };
  customers_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  customers_not_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  customer_search: { view: boolean; copy: boolean; edit: boolean; view_all_groups: boolean };
  mappings: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; bulk_renewal: boolean };
  users: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  activities: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
  tdl: { view: boolean; create: boolean; edit: boolean; delete: boolean; add_requirement: boolean; delete_requirement: boolean; add_task: boolean };
  pincodes: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  visits_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; force_checkin: boolean; pause: boolean };
  visits_not_our: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; force_checkin: boolean; pause: boolean };
  tasks: { view: boolean; create: boolean; edit: boolean; delete: boolean; checkin: boolean; view_history: boolean };
  // view_updates: gates the notes/remarks/history feed on each service call.
  // Without it, the user sees the row but not the update trail.
  service_calls: { view: boolean; create: boolean; take: boolean; close: boolean; transfer: boolean; cancel: boolean; view_all: boolean; view_updates: boolean };
  leads: { view: boolean; create: boolean; take: boolean; close: boolean; transfer: boolean; cancel: boolean; view_all: boolean };
  service_followup: { view: boolean; confirm: boolean; reopen: boolean };
  expiry_renew_our: { view: boolean; copy: boolean; view_all_groups: boolean };
  expiry_renew_not_our: { view: boolean; copy: boolean; view_all_groups: boolean };
  call_report: { view: boolean };
  my_requirements?: { cloud: boolean; tally: boolean; tdl: boolean; webapp: boolean };
  // Masters — items + groups + categories + flavours all gate on `items`
  items: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  ledger_groups: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  other_ledgers: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  vch_types: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  targets: { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean };
  // Reseller master + Group/Reseller Change. `resellers.edit` also gates
  // the reseller field on customer forms.
  resellers: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  group_change: { view: boolean; edit_group: boolean; edit_reseller: boolean };
  // Voucher entry — separate from `activities` so non-admin accountants can
  // be granted voucher permissions without the broader module-admin perm.
  // `check` lets the user mark a voucher as Checked. Once checked, only admins
  // can edit/delete it.
  vouchers: { view: boolean; create: boolean; edit: boolean; delete: boolean; check: boolean; allowed_vch_parent_ids: number[]; allowed_ledger_group_ids: number[] };
  // Each financial report has its own CRUD set. `edit` opens a voucher
  // for review (drilldown); `update` saves changes; `delete` removes the
  // underlying voucher.
  reports_outstanding:      { view: boolean };
  reports_ledger:           { view: boolean };
  reports_daybook:          { view: boolean };
  reports_sales_register:   { view: boolean };
  reports_group_summary:    { view: boolean };
  reports_stock_summary:    { view: boolean };
  reports_user_outstanding: { view: boolean };
  server_monitor: { view: boolean; edit: boolean };
}

// Column-level permissions
export interface PageColumnPermission {
  visible: string[];
  copyable: string[];
}

export interface ColumnPermissions {
  servers: PageColumnPermission;
  customer_search: PageColumnPermission;
  customer_search_contacts: PageColumnPermission;
  customer_search_mapped: PageColumnPermission;
  customer_search_tally: PageColumnPermission;
  customer_search_cloud: PageColumnPermission;
  mappings: PageColumnPermission;
  activities: PageColumnPermission;
  tasks_active: PageColumnPermission;
  tasks_completed: PageColumnPermission;
  pending_visits: PageColumnPermission;
  service_calls: PageColumnPermission;
  users: PageColumnPermission;
  customization: PageColumnPermission;
}

export type ColumnPage = keyof ColumnPermissions;

// All available columns per page (for admin UI)
export const ALL_PAGE_COLUMNS: Record<ColumnPage, { key: string; label: string }[]> = {
  servers: [
    { key: 'company', label: 'Company' }, { key: 'sof_id', label: 'SOF ID' }, { key: 'server_ip', label: 'Server IP' },
    { key: 'customer_ip', label: 'Customer IP' }, { key: 'port', label: 'Port' }, { key: 'admin', label: 'Admin' },
    { key: 'password', label: 'Password' }, { key: 'mapped', label: 'Mapped' }, { key: 'bu', label: 'B.U.' },
    { key: 'pu', label: 'P.U.' }, { key: 'rate', label: 'Rate' }, { key: 'expiry', label: 'Expiry' }, { key: 'created', label: 'Created' },
  ],
  customer_search: [
    { key: 'company', label: 'Company' }, { key: 'person', label: 'Person' }, { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'Email' }, { key: 'status', label: 'Status' }, { key: 'city', label: 'City' },
  ],
  customer_search_contacts: [
    { key: 'person', label: 'Person' }, { key: 'phone', label: 'Phone' }, { key: 'primary', label: 'Primary' },
    { key: 'status', label: 'Status' }, { key: 'company', label: 'Company' },
  ],
  customer_search_mapped: [
    { key: 'company', label: 'Company' }, { key: 'group', label: 'Group' }, { key: 'status', label: 'Status' },
    { key: 'type', label: 'Type' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN' },
    { key: 'pincode', label: 'Pincode' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' },
  ],
  customer_search_tally: [
    { key: 'tally_serial', label: 'Tally Serial' }, { key: 'expiry', label: 'Expiry' }, { key: 'active', label: 'Active' },
    { key: 'status', label: 'Status' }, { key: 'flavor', label: 'Flavor' }, { key: 'release', label: 'Release' },
    { key: 'renewal', label: 'Renewal' }, { key: 'mau', label: 'MAU' }, { key: 'qau', label: 'QAU' }, { key: 'remark', label: 'Remark' },
  ],
  customer_search_cloud: [
    { key: 'server_ip', label: 'Server IP' }, { key: 'customer_ip', label: 'Customer IP' }, { key: 'serial', label: 'Serial' },
    { key: 'users', label: 'Users' }, { key: 'status', label: 'Status' }, { key: 'cycle', label: 'Cycle' },
    { key: 'rate', label: 'Rate' }, { key: 'expiry', label: 'Expiry' }, { key: 'credentials', label: 'Credentials' },
  ],
  mappings: [
    { key: 'company', label: 'Company' }, { key: 'customer_ip', label: 'Customer IP' }, { key: 'email', label: 'Email' },
    { key: 'activation', label: 'Activation' }, { key: 'serial_no', label: 'Serial No' }, { key: 'bu', label: 'B.U.' },
    { key: 'expiry', label: 'Expiry' }, { key: 'cycle', label: 'Cycle' }, { key: 'rate', label: 'Rate' },
  ],
  activities: [
    { key: 'customer', label: 'Customer' }, { key: 'server_ip', label: 'Server IP' }, { key: 'sof_no', label: 'SOF No.' },
    { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'bill_type', label: 'Bill Type' },
    { key: 'cycle', label: 'Cycle' }, { key: 'mode', label: 'Mode' }, { key: 'start', label: 'Start' },
    { key: 'expiry', label: 'Expiry' }, { key: 'users', label: 'Users' }, { key: 'rate', label: 'Rate' }, { key: 'amount', label: 'Amount' },
    { key: 'voucher_no', label: 'Voucher No.' },
  ],
  tasks_active: [
    { key: 'customer', label: 'Customer' }, { key: 'type', label: 'Type' }, { key: 'staff', label: 'Staff' },
    { key: 'added', label: 'Added' }, { key: 'in_time', label: 'In Time' }, { key: 'out_time', label: 'Out Time' }, { key: 'remark', label: 'Remark' },
  ],
  tasks_completed: [
    { key: 'checkout_date', label: 'Checkout Date' }, { key: 'customer', label: 'Customer' }, { key: 'staff', label: 'Staff' },
    { key: 'type', label: 'Type' }, { key: 'in_time', label: 'In Time' }, { key: 'out_time', label: 'Out Time' }, { key: 'remark', label: 'Remark' },
    { key: 'response', label: 'Response' }, { key: 'loyalty', label: 'Loyalty' }, { key: 'biz_type', label: 'Biz Type' },
    { key: 'einvoice', label: 'E-Invoice' }, { key: 'acct_person', label: 'Acct Person' }, { key: 'it_person', label: 'IT Person' },
    { key: 'ca_name', label: 'CA Name' }, { key: 'eway_bill', label: 'E-Way Bill' }, { key: 'banking', label: 'Banking' },
    { key: 'whatsapp', label: 'Whatsapp' }, { key: 'custom', label: 'Custom' }, { key: 'tally_slow', label: 'Tally Slow' },
  ],
  pending_visits: [
    { key: 'customer', label: 'Customer' }, { key: 'staff', label: 'Staff' }, { key: 'added', label: 'Added' },
    { key: 'in_time', label: 'In Time' }, { key: 'out_time', label: 'Out Time' }, { key: 'remark', label: 'Remark' },
  ],
  service_calls: [
    { key: 'sr', label: 'Sr' }, { key: 'company', label: 'Company' }, { key: 'created_by', label: 'Created By' },
    { key: 'mobile', label: 'Mobile' }, { key: 'sn', label: 'SN' }, { key: 'type', label: 'Type' },
    { key: 'add_by', label: 'Add By' }, { key: 'handle_by', label: 'Handle By' }, { key: 'next_date', label: 'Next Date' },
    { key: 'status', label: 'Status' }, { key: 'complete_by', label: 'Complete By' }, { key: 'remark', label: 'Remark' },
  ],
  users: [
    { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'two_fa', label: '2FA' }, { key: 'status', label: 'Status' },
  ],
  customization: [
    { key: 'customer_name', label: 'Customer Name' }, { key: 'person_name', label: 'Person Name' }, { key: 'phone', label: 'Phone' },
    { key: 'handled_by', label: 'Handled By' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount' },
    { key: 'submission_date', label: 'Submission Date' }, { key: 'overdue_days', label: 'Overdue Days' },
  ],
};

// Page display names for admin UI
export const PAGE_DISPLAY_NAMES: Record<ColumnPage, string> = {
  servers: 'Servers',
  customer_search: 'Customer Search',
  customer_search_contacts: 'Search - Contacts',
  customer_search_mapped: 'Search - Mapped Companies',
  customer_search_tally: 'Search - Tally Details',
  customer_search_cloud: 'Search - Cloud Mappings',
  mappings: 'Mappings',
  activities: 'Activities',
  tasks_active: 'Tasks (Active)',
  tasks_completed: 'Tasks (Completed)',
  pending_visits: 'Pending Visits',
  service_calls: 'Service Calls',
  users: 'Users',
  customization: 'Customization',
};

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive';
  permissions: UserPermissions;
  column_permissions?: ColumnPermissions;
  created_at?: string;
  is_two_fa_enabled?: boolean;
  tag?: 'Inside' | 'Outside';
  old_id?: number | null;
  sub_user_id?: string | null;
  old_name?: string | null;
  sub_user_name?: string | null;
}

// Context Type
interface AuthContextType {
  user: User | null;
  users: User[];
  isAuthenticated: boolean;
  isLoading: boolean;

  // Auth
  login: (email: string, password: string, otp?: string, secret?: string) => Promise<{
    success: boolean;
    message: string;
    require_2fa?: boolean;
    setup_2fa?: boolean;
    secret?: string;
    otpauthUrl?: string;
  }>;
  logout: () => void;

  // Permission checks
  canView: (entity: EntityType) => boolean;
  canCreate: (entity: EntityType) => boolean;
  canEdit: (entity: EntityType) => boolean;
  canDelete: (entity: EntityType) => boolean;
  canViewHistory: (entity: EntityType) => boolean;
  canCheckPermission: (entity: EntityType, action: string) => boolean;
  isAdmin: () => boolean;

  // Column permission checks
  canViewColumn: (page: ColumnPage, column: string) => boolean;
  canCopyColumn: (page: ColumnPage, column: string) => boolean;
  getVisibleColumns: (page: ColumnPage) => string[];
  getCopyableColumns: (page: ColumnPage) => string[];

  // User CRUD (admin only)
  loadUsers: () => Promise<void>;
  addUser: (user: Omit<User, 'id' | 'created_at'>, password: string) => Promise<{ success: boolean; message: string }>;
  updateUser: (id: string, data: Partial<User>) => Promise<{ success: boolean; message: string }>;
  updateUserPassword: (id: string, newPassword: string) => Promise<void>;
  deleteUser: (id: string) => Promise<{ success: boolean; message: string }>;
  resetTwoFactor: (id: string) => Promise<{ success: boolean; message: string }>;
  adminGenerate2FA: (id: string) => Promise<{ secret: string; otpauthUrl: string }>;
  adminEnable2FA: (id: string, secret: string, token: string) => Promise<{ success: boolean; message: string }>;
  getUserById: (id: string) => User | undefined;
  updateUserPermissions: (id: string, permissions: UserPermissions) => Promise<{ success: boolean; message: string }>;
  updateUserColumnPermissions: (id: string, columnPermissions: ColumnPermissions) => Promise<{ success: boolean; message: string }>;

  // Session lock
  isSessionLocked: boolean;
  unlockSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Session lock state
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isCapacitor = typeof window !== 'undefined' && !!(window as any).Capacitor;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  // Capacitor app: no session timeout (logout only on checkout or 11:50 PM cron)
  const SESSION_TIMEOUT = isCapacitor ? 0 : (isMobile ? 8 * 60 * 60 * 1000 : 30 * 60 * 1000);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      // Migration: Clean up old sessionStorage token
      const oldToken = sessionStorage.getItem('abs_token');
      if (oldToken) {
        storeToken(oldToken);
        sessionStorage.removeItem('abs_token');
      }

      // Check localStorage token
      const tokenData = localStorage.getItem('abs_token_data');

      
      if (tokenData) {
        try {
          const { token, lastActivity } = JSON.parse(tokenData);

          if (!token) {
            console.log('[Auth] Token empty, clearing');
            clearToken();
            setIsLoading(false);
            return;
          }

          // Check if session expired while app was closed (skip for Capacitor app)
          const isCapApp = !!(window as any).Capacitor;
          if (!isCapApp) {
            const isMobileCheck = window.innerWidth < 768;
            const timeout = isMobileCheck ? 8 * 60 * 60 * 1000 : 30 * 60 * 1000;
            if (lastActivity && Date.now() - lastActivity > timeout) {
              console.log('[Auth] Session expired while app was closed');
              clearToken();
              setIsLoading(false);
              return;
            }
          }

          // Token exists and not expired, verify with backend
          const profile = await authApi.getProfile();

          setUser(profile);
          updateLastActivity(); // Refresh activity timestamp on successful load

          // Re-subscribe push on session restore (ensures token stays fresh)
          if (isPushSupported() && Notification.permission === 'granted') {
            subscribeToPush().catch(e => console.warn('[Push] Re-subscribe failed:', e));
          }

          // Restart native foreground notification service on session restore
          if (token) startNotificationService(token).catch(() => {});
        } catch (err: any) {
          console.log('[Auth] Backend validation failed:', err?.message);
          // Only clear token if explicit Unauthorized (401) or Forbidden (403)
          if (err?.status === 401 || err?.status === 403) {
            clearToken();
          } else {
             console.log('[Auth] Token preserved despite error (likely network/server issue)');
          }
        }
      }
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  // Load users when authenticated as admin
  const loadUsers = async () => {
    if (!user || user.role?.toLowerCase() !== 'admin') return;
    try {
      const response = await usersApi.getAll();
      setUsers(response.data);
    } catch (error) {
    }
  };

  // Auth functions
  const login = async (email: string, password: string, otp?: string, secret?: string): Promise<{
    success: boolean;
    message: string;
    require_2fa?: boolean;
    setup_2fa?: boolean;
    secret?: string;
    otpauthUrl?: string;
  }> => {
    try {
      const response = await authApi.login(email, password, otp, secret);

      // Handle 2FA Setup Response (before success check — setup returns success:false)
      if (response.setup_2fa) {
        return {
          success: false,
          message: response.message,
          setup_2fa: true,
          secret: response.secret,
          otpauthUrl: response.otpauthUrl
        };
      }

      if (response.success) {
        if (response.require_2fa) {
          return { success: true, message: '2FA code required', require_2fa: true };
        }
        // Store token with activity timestamp
        storeToken(response.token);

        setUser(response.user);

        // Subscribe to push notifications (fire-and-forget)
        if (isPushSupported()) {
          subscribeToPush().catch(e => console.warn('[Push] Auto-subscribe failed:', e));
        }

        // Start native foreground notification service (Capacitor only)
        startNotificationService(response.token).catch(() => {});

        return { success: true, message: 'Login successful' };
      }
      return { success: false, message: response.message || 'Login failed', require_2fa: response.require_2fa };
    } catch (error: any) {
      return { success: false, message: error.message || 'Login failed' };
    }
  };

  const logout = async () => {
    // Fire-and-forget native calls — never block logout
    unsubscribeFromPush().catch(() => {});
    stopNotificationService().catch(() => {});
    authApi.logout().catch(() => {});

    // Clear session timer
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }

    setIsSessionLocked(false);
    clearToken(); // Use centralized token cleanup
    setUser(null);
    setUsers([]);
  };

  // Session timeout logic — uses lastActivity timestamp instead of timers
  // This avoids premature logout when app is backgrounded on mobile
  const checkSessionExpiry = useCallback(() => {
    if (SESSION_TIMEOUT === 0) return; // Capacitor app: no session timeout
    const tokenData = localStorage.getItem('abs_token_data');
    if (!tokenData) return;
    try {
      const { lastActivity } = JSON.parse(tokenData);
      if (lastActivity && Date.now() - lastActivity > SESSION_TIMEOUT) {
        logout();
        alert('Session timed out due to inactivity.');
      }
    } catch { /* ignore parse errors */ }
  }, [SESSION_TIMEOUT]);

  const resetSessionTimer = useCallback(() => {
    if (user) {
      updateLastActivity();
    }
  }, [user]);

  // Unlock session (Legacy support - now just resets timer)
  const unlockSession = useCallback(() => {
    setIsSessionLocked(false);
    resetSessionTimer();
  }, [resetSessionTimer]);

  // Setup activity listeners & periodic check
  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetSessionTimer();

    // Check session expiry periodically (every 60s) and on visibility change
    const intervalId = setInterval(checkSessionExpiry, 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSessionExpiry();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Attach activity listeners
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    // Mark initial activity
    updateLastActivity();

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [user, resetSessionTimer, checkSessionExpiry]);

  // Permission checks
  const isAdmin = () => user?.role?.toLowerCase() === 'admin';

  const getPermissionKey = (entity: EntityType): keyof UserPermissions => {
    switch (entity) {
      case 'servers': return 'servers';
      case 'customers_our': return 'customers_our';
      case 'customers_not_our': return 'customers_not_our';
      case 'mappings': return 'mappings';
      case 'users': return 'users';
      case 'activities': return 'activities';
      case 'tdl': return 'tdl';
      case 'pincodes': return 'pincodes';
      case 'visits_our': return 'visits_our';
      case 'visits_not_our': return 'visits_not_our';
      case 'tasks': return 'tasks';
      case 'service_calls': return 'service_calls';
      case 'service_followup': return 'service_followup';
      case 'customer_search': return 'customer_search';
      case 'expiry_renew_our': return 'expiry_renew_our';
      case 'expiry_renew_not_our': return 'expiry_renew_not_our';
      case 'call_report': return 'call_report';
      case 'leads': return 'leads';
      case 'my_requirements': return 'my_requirements';
      case 'items': return 'items';
      case 'ledger_groups': return 'ledger_groups';
      case 'other_ledgers': return 'other_ledgers';
      case 'vch_types': return 'vch_types';
      case 'targets': return 'targets';
      case 'vouchers': return 'vouchers';
      case 'reports_outstanding':      return 'reports_outstanding';
      case 'reports_ledger':           return 'reports_ledger';
      case 'reports_daybook':          return 'reports_daybook';
      case 'reports_sales_register':   return 'reports_sales_register';
      case 'reports_group_summary':    return 'reports_group_summary';
      case 'reports_stock_summary':    return 'reports_stock_summary';
      case 'reports_user_outstanding': return 'reports_user_outstanding';
      case 'resellers': return 'resellers';
      case 'group_change': return 'group_change';
      default: return 'servers';
    }
  };

  const canView = (entity: EntityType): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    // For my_requirements, check if user has any lead type permission
    if (entity === 'my_requirements') {
      const p = user.permissions?.my_requirements;
      return p ? Object.values(p).some(v => v) : false;
    }
    return (user.permissions[getPermissionKey(entity)] as any)?.view ?? false;
  };

  const canCreate = (entity: EntityType): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    return (user.permissions[getPermissionKey(entity)] as any)?.create ?? false;
  };

  const canEdit = (entity: EntityType): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    return (user.permissions[getPermissionKey(entity)] as any)?.edit ?? false;
  };

  const canDelete = (entity: EntityType): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    return (user.permissions[getPermissionKey(entity)] as any)?.delete ?? false;
  };

  const canViewHistory = (entity: EntityType): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    return (user.permissions[getPermissionKey(entity)] as any)?.view_history ?? false;
  };

  const canCheckPermission = (entity: EntityType, action: string): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    return (user.permissions[getPermissionKey(entity)] as any)?.[action] ?? false;
  };

  // Column permission checks
  const canViewColumn = (page: ColumnPage, column: string): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    const pagePerms = user.column_permissions?.[page];
    if (!pagePerms || !Array.isArray(pagePerms.visible)) return true; // default: visible
    return pagePerms.visible.includes(column);
  };

  const canCopyColumn = (page: ColumnPage, column: string): boolean => {
    if (!user) return false;
    if (user.role?.toLowerCase() === 'admin') return true;
    const pagePerms = user.column_permissions?.[page];
    if (!pagePerms || !Array.isArray(pagePerms.copyable)) return false; // default: no copy
    return pagePerms.copyable.includes(column);
  };

  const getVisibleColumns = (page: ColumnPage): string[] => {
    if (!user) return [];
    if (user.role?.toLowerCase() === 'admin') return ALL_PAGE_COLUMNS[page].map(c => c.key);
    const pagePerms = user.column_permissions?.[page];
    if (!pagePerms || !Array.isArray(pagePerms.visible)) return ALL_PAGE_COLUMNS[page].map(c => c.key);
    return pagePerms.visible;
  };

  const getCopyableColumns = (page: ColumnPage): string[] => {
    if (!user) return [];
    if (user.role?.toLowerCase() === 'admin') return ALL_PAGE_COLUMNS[page].map(c => c.key);
    const pagePerms = user.column_permissions?.[page];
    if (!pagePerms || !Array.isArray(pagePerms.copyable)) return [];
    return pagePerms.copyable;
  };

  // User CRUD
  const addUser = async (data: Omit<User, 'id' | 'created_at'>, password: string): Promise<{ success: boolean; message: string }> => {
    if (!user || user.role?.toLowerCase() !== 'admin') return { success: false, message: 'Only admin can create users' };

    try {
      await usersApi.create({ ...data, password });
      await loadUsers();
      return { success: true, message: 'User created successfully' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to create user' };
    }
  };

  const updateUser = async (id: string, data: Partial<User>): Promise<{ success: boolean; message: string }> => {
    if (!user) return { success: false, message: 'Not authenticated' };

    try {
      const response = await usersApi.update(id, data);
      if (user.id === id) {
        setUser(response.data);
      }
      await loadUsers();
      return { success: true, message: 'User updated successfully' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update user' };
    }
  };

  const updateUserPassword = async (id: string, newPassword: string) => {
    if (!user || user.role?.toLowerCase() !== 'admin') return;
    try {
      await usersApi.updatePassword(id, newPassword);
    } catch (error) {
    }
  };

  const deleteUser = async (id: string): Promise<{ success: boolean; message: string }> => {
    if (!user || user.role?.toLowerCase() !== 'admin') return { success: false, message: 'Only admin can delete users' };
    if (id === user.id) return { success: false, message: 'Cannot delete yourself' };

    try {
      await usersApi.delete(id);
      await loadUsers();
      return { success: true, message: 'User deleted successfully' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to delete user' };
    }
  };

  const resetTwoFactor = async (id: string): Promise<{ success: boolean; message: string }> => {
    if (!user || user.role?.toLowerCase() !== 'admin') return { success: false, message: 'Only admin can reset 2FA' };
    try {
      await usersApi.reset2FA(id);
      await loadUsers();
      return { success: true, message: '2FA reset successfully' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to reset 2FA' };
    }
  };

  const adminGenerate2FA = async (id: string) => {
    return usersApi.generate2FA(id);
  };

  const adminEnable2FA = async (id: string, secret: string, token: string) => {
    try {
      await usersApi.enable2FA(id, secret, token);
      await loadUsers();
      return { success: true, message: '2FA enabled' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to enable 2FA' };
    }
  };

  const getUserById = (id: string) => users.find(u => u.id === id);

  const updateUserPermissions = async (id: string, permissions: UserPermissions): Promise<{ success: boolean; message: string }> => {
    if (!user || user.role?.toLowerCase() !== 'admin') return { success: false, message: 'Only admin can update permissions' };

    try {
      await usersApi.updatePermissions(id, permissions);
      await loadUsers();
      return { success: true, message: 'Permissions updated' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update permissions' };
    }
  };

  const updateUserColumnPermissions = async (id: string, columnPermissions: ColumnPermissions): Promise<{ success: boolean; message: string }> => {
    if (!user || user.role?.toLowerCase() !== 'admin') return { success: false, message: 'Only admin can update column permissions' };

    try {
      await usersApi.updateColumnPermissions(id, columnPermissions);
      await loadUsers();
      return { success: true, message: 'Column permissions updated' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update column permissions' };
    }
  };

  return (
    <AuthContext.Provider value={{
      user, users, isAuthenticated: !!user, isLoading,
      login, logout,
      canView, canCreate, canEdit, canDelete, canViewHistory, canCheckPermission, isAdmin,
      canViewColumn, canCopyColumn, getVisibleColumns, getCopyableColumns,
      loadUsers, addUser, updateUser, updateUserPassword, deleteUser, resetTwoFactor, adminGenerate2FA, adminEnable2FA, getUserById, updateUserPermissions, updateUserColumnPermissions,
      isSessionLocked, unlockSession
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
