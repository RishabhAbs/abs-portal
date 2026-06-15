
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, User, Menu, X, Home, Server, UserCog, Link2, Building2, FileText, Cloud, Layers, ChevronDown, MapPin, Clock, Calendar, Users as UsersIcon, Search, PhoneCall, LayoutGrid, Receipt, CheckCircle, Bell, BarChart2, AlertCircle, Activity } from 'lucide-react';
import { useAuth, EntityType } from '../../context/AuthContext';
import { usersApi, attendanceApi } from '../../services/api';
import { useToast } from '../Toast/Toast';
import { useNotifications } from '../../hooks/useNotifications';
import SessionLockModal from '../SessionLockModal';

interface NavItem {
  label: string;
  path: string;
  entity?: EntityType | EntityType[]; // Use entity check if available
  adminOnly?: boolean; // Fallback to admin check
  icon: React.ReactNode;
  children?: NavItem[];
}

const Layout: React.FC = () => {
  const { user, logout, canView, isAdmin, isSessionLocked, unlockSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAccountsSheet, setShowAccountsSheet] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const [mobileSubExpanded, setMobileSubExpanded] = useState<string | null>(null);
  const [pendingConnectCount, setPendingConnectCount] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications(!!user);
  const isCapacitor = !!(window as any).Capacitor;



  React.useEffect(() => {
    const fetchPendingTasks = async () => {
      const tokenData = localStorage.getItem('abs_token_data');
      if (!tokenData || !user?.name) return;
      try {
        const { token } = JSON.parse(tokenData);
        if (!token) return;
        const response = await fetch(`/api/tdl/connect/pending?user_name=${encodeURIComponent(user.name)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          const valid = data.filter((t: any) => t.customer_lat && t.customer_lng);
          setPendingConnectCount(valid.length);
        }
      } catch (e) {
        // Silently ignore auth errors during initial load
      }
    };
    fetchPendingTasks();
  }, [user?.name]);

  // Location Tracking
  React.useEffect(() => {
    if (!user) return;

    const trackLocation = async () => {
      // Check attendance status first
      try {
        const { status } = await attendanceApi.getStatus();
        if (status !== 'Checked In') {
          return; // Stop tracking if not checked in
        }

        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              // Only send if accuracy is reasonable (< 500m) to avoid wildly wrong cell tower positions
              if (position.coords.accuracy > 500) return;
              try {
                await usersApi.updateLocation(position.coords.latitude, position.coords.longitude);
              } catch (error) {
                console.error('Failed to update location', error);
              }
            },
            () => {}, // Silently fail — better no location than a wrong one
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
          );
        }
      } catch (error) {
        console.error('Failed to check attendance status', error);
      }
    };

    // Initial track
    trackLocation();

    // Interval track (120s / 2mins)
    const intervalId = setInterval(trackLocation, 120 * 1000);

    return () => clearInterval(intervalId);
  }, [user]);

  // Cloud sub-nav items
  const cloudItems: NavItem[] = [
    { label: 'Server', path: '/cloud/servers', entity: 'servers', icon: <Server className="h-4 w-4" /> },
    { label: 'Mapping', path: '/cloud/mapping', entity: 'mappings', icon: <Link2 className="h-4 w-4" /> },
    { label: 'Server Monitor', path: '/cloud/monitor', entity: 'mappings', icon: <Activity className="h-4 w-4" /> },
    { label: 'Billing Activity', path: '/cloud/activity/billing', entity: 'activities', icon: <FileText className="h-4 w-4" /> },
    { label: 'Purchase Activity', path: '/cloud/activity/purchase', entity: 'activities', icon: <FileText className="h-4 w-4" /> },
  ];

  // Top level structure with children — reorganized into logical groups
  const navStructure: NavItem[] = user?.is_two_fa_enabled ? [
    { label: 'Home', path: '/', icon: <Home className="h-5 w-5" /> },
    { label: 'Search', path: '/search', entity: 'customer_search', icon: <Search className="h-5 w-5" /> },
    {
      label: 'CRM',
      path: '#',
      icon: <Building2 className="h-5 w-5" />,
      children: [
        {
          label: 'Masters',
          path: '#',
          icon: <Layers className="h-4 w-4" />,
          children: [
            { label: 'OC', path: '/customers?type=our', entity: 'customers_our', icon: <User className="h-4 w-4" /> },
            { label: 'NOC', path: '/customers?type=not_our', entity: 'customers_not_our', icon: <UserCog className="h-4 w-4" /> },
            { label: 'Inactive Customers', path: '/customers/inactive', adminOnly: true, icon: <X className="h-4 w-4" /> },
            { label: 'Pin Code', path: '/pincodes', entity: 'pincodes', icon: <MapPin className="h-4 w-4" /> },
            { label: 'Group Change', path: '/group-change', entity: 'group_change', icon: <UsersIcon className="h-4 w-4" /> },
            { label: 'Reseller', path: '/resellers', entity: 'resellers', icon: <UsersIcon className="h-4 w-4" /> },
            { label: 'Vch Types', path: '/billing/vch-types', entity: 'vch_types' as EntityType, icon: <FileText className="h-4 w-4" /> },
          ]
        },
        {
          label: 'Item',
          path: '#',
          icon: <Receipt className="h-4 w-4" />,
          children: [
            { label: 'Items', path: '/billing/items', entity: 'items' as EntityType, icon: <Receipt className="h-4 w-4" /> },
            { label: 'Item Group', path: '/billing/item-groups', entity: 'items' as EntityType, icon: <Layers className="h-4 w-4" /> },
            { label: 'Item Categories', path: '/billing/item-categories', entity: 'items' as EntityType, icon: <Layers className="h-4 w-4" /> },
          ]
        },
        {
          label: 'Ledger',
          path: '#',
          icon: <FileText className="h-4 w-4" />,
          children: [
            { label: 'Ledger Group', path: '/billing/ledger-groups', entity: 'ledger_groups' as EntityType, icon: <FileText className="h-4 w-4" /> },
            { label: 'Other Ledger', path: '/billing/other-ledgers', entity: 'other_ledgers' as EntityType, icon: <FileText className="h-4 w-4" /> },
          ]
        },
        { label: 'Tasks', path: '/task-report', entity: 'tasks', icon: <FileText className="h-4 w-4" /> },
        { label: 'Our Expiry Renew', path: '/tally/expiry/our', entity: 'expiry_renew_our', icon: <Clock className="h-4 w-4" /> },
        { label: 'Not Our Expiry Renew', path: '/tally/expiry/not-our', entity: 'expiry_renew_not_our', icon: <Clock className="h-4 w-4" /> },
      ]
    },
    {
      label: 'Service',
      path: '#',
      icon: <PhoneCall className="h-5 w-5" />,
      children: [
        { label: 'Pending', path: '/service/pending', entity: 'service_calls' as EntityType, icon: <PhoneCall className="h-4 w-4" /> },
        { label: 'Completed', path: '/service/completed', entity: 'service_calls' as EntityType, icon: <CheckCircle className="h-4 w-4" /> },
        { label: 'Canceled', path: '/service/canceled', entity: 'service_calls' as EntityType, icon: <X className="h-4 w-4" /> },
        { label: 'Follow-up', path: '/service/followup', entity: 'service_followup' as EntityType, icon: <FileText className="h-4 w-4" /> },
      ]
    },
    {
      label: 'Lead',
      path: '#',
      icon: <UsersIcon className="h-5 w-5" />,
      children: [
        { label: 'Pending', path: '/lead/pending', entity: 'leads' as EntityType, icon: <Clock className="h-4 w-4" /> },
        { label: 'My Requirements', path: '/lead/my-requirements', entity: 'my_requirements' as EntityType, icon: <FileText className="h-4 w-4" /> },
        { label: 'Requirements Report', path: '/lead/requirements-report', entity: 'tdl' as EntityType, icon: <Layers className="h-4 w-4" /> },
        { label: 'Closed', path: '/lead/closed', entity: 'leads' as EntityType, icon: <CheckCircle className="h-4 w-4" /> },
        { label: 'Cancelled', path: '/lead/cancelled', entity: 'leads' as EntityType, icon: <X className="h-4 w-4" /> },
      ]
    },
    {
      label: 'Voucher',
      path: '#',
      entity: 'vouchers' as EntityType,
      icon: <Receipt className="h-5 w-5" />,
      children: [
        { label: 'New / Edit Voucher', path: '/billing/vouchers', entity: 'vouchers' as EntityType, icon: <Receipt className="h-4 w-4" /> },
        { label: 'Print Voucher',      path: '/billing/print-voucher', entity: ['vouchers', 'reports_daybook'] as EntityType[], icon: <FileText className="h-4 w-4" /> },
      ],
    },
    {
      label: 'Reports',
      path: '#',
      icon: <BarChart2 className="h-5 w-5" />,
      children: [
        { label: 'Outstanding Report',   path: '/reports/outstanding',      entity: 'reports_outstanding' as EntityType,      icon: <FileText className="h-4 w-4" /> },
        { label: 'User-wise Outstanding',path: '/reports/user-outstanding', entity: ['reports_user_outstanding', 'reports_outstanding'] as EntityType[], icon: <UsersIcon className="h-4 w-4" /> },
        { label: 'Ledger Report',        path: '/reports/ledger',           entity: 'reports_ledger' as EntityType,           icon: <FileText className="h-4 w-4" /> },
        { label: 'Day Book',             path: '/billing/daybook',          entity: 'reports_daybook' as EntityType,          icon: <FileText className="h-4 w-4" /> },
        { label: 'Pending Review',       path: '/billing/pending-review',   entity: ['reports_daybook', 'vouchers'] as EntityType[], icon: <CheckCircle className="h-4 w-4" /> },
        { label: 'Sales Register',       path: '/reports/sales-register',   entity: ['reports_sales_register', 'reports_daybook'] as EntityType[], icon: <Receipt className="h-4 w-4" /> },
        { label: 'Group Summary',        path: '/reports/group-summary',    entity: ['reports_group_summary', 'reports_daybook'] as EntityType[], icon: <Layers className="h-4 w-4" /> },
        { label: 'Stock Summary',        path: '/reports/stock-summary',    entity: ['reports_stock_summary', 'reports_daybook'] as EntityType[], icon: <BarChart2 className="h-4 w-4" /> },
        { label: 'Call Report',          path: '/visit/call-report',        entity: 'call_report' as EntityType,              icon: <PhoneCall className="h-4 w-4" /> },
        { label: 'Task',                 path: '/task-report',              entity: 'tasks' as EntityType,                    icon: <FileText className="h-4 w-4" /> },
        {
          label: 'Expiry Report',
          path: '#',
          icon: <Clock className="h-4 w-4" />,
          children: [
            { label: 'OC',  path: '/tally/expiry/our',     entity: 'expiry_renew_our' as EntityType,     icon: <User className="h-4 w-4" /> },
            { label: 'NOC', path: '/tally/expiry/not-our', entity: 'expiry_renew_not_our' as EntityType, icon: <UserCog className="h-4 w-4" /> },
          ]
        },
      ]
    },
    {
      label: 'Visit',
      path: '#',
      icon: <MapPin className="h-5 w-5" />,
      children: [
        {
          label: 'Our Customer',
          path: '#',
          entity: 'visits_our',
          icon: <User className="h-4 w-4" />,
          children: [
            { label: 'OC Visits', path: '/visit/oc-report', entity: 'visits_our', icon: <FileText className="h-4 w-4" /> },
            { label: 'OC Pending Visits', path: '/visit/oc-pending', entity: 'visits_our', icon: <Clock className="h-4 w-4" /> }
          ]
        },
        {
          label: 'Not Our Customer',
          path: '#',
          entity: 'visits_not_our',
          icon: <UserCog className="h-4 w-4" />,
          children: [
            { label: 'NOC Visits', path: '/visit/noc-report', entity: 'visits_not_our', icon: <FileText className="h-4 w-4" /> },
            { label: 'NOC Pending Visits', path: '/visit/noc-pending', entity: 'visits_not_our', icon: <Clock className="h-4 w-4" /> }
          ]
        }
      ]
    },
    {
      label: 'TDL',
      path: '#',
      entity: 'tdl' as EntityType,
      icon: <Layers className="h-5 w-5" />,
      children: [
        { label: 'TDL Expiry', path: '/tdl/expiry', entity: 'tdl' as EntityType, icon: <Layers className="h-4 w-4" /> },
        { label: 'Billing Activity', path: '/tdl/billing', entity: 'tdl' as EntityType, icon: <FileText className="h-4 w-4" /> },
      ],
    },
    {
      label: 'Cloud',
      path: '/cloud/servers',
      icon: <Cloud className="h-5 w-5" />,
      children: cloudItems
    },
    {
      label: 'User',
      path: '#',
      icon: <UsersIcon className="h-5 w-5" />,
      children: [
        { label: 'Profile', path: '/profile', icon: <User className="h-4 w-4" /> },
        { label: 'Users', path: '/users', adminOnly: true, icon: <UserCog className="h-4 w-4" /> },
        { label: 'Network', path: '/network', adminOnly: true, icon: <MapPin className="h-4 w-4" /> },
        { label: 'Attendance', path: '/attendance', adminOnly: true, icon: <Calendar className="h-4 w-4" /> },
        { label: 'Targets', path: '/targets', entity: 'targets' as EntityType, icon: <BarChart2 className="h-4 w-4" /> },
      ]
    },
  ] : [];

  // Recursive Filter Function
  const filterNavItems = (items: NavItem[]): NavItem[] => {
    return items
      .filter(item => {
        // Admin always sees everything marked adminOnly
        if (item.adminOnly && isAdmin()) return true;
        // Check Entity Permission
        if (item.entity) {
          const entities = Array.isArray(item.entity) ? item.entity : [item.entity];
          const hasAccess = entities.some(e => canView(e));
          if (!hasAccess) return false;
        }
        // Check Admin Permission
        if (item.adminOnly && !isAdmin()) return false;
        return true;
      })
      .map(item => {
        // 3. Process Children Recursively
        if (item.children) {
          const filteredChildren = filterNavItems(item.children);
          
          // If item has no direct path (is just a group header) and no visible children, hide it
          if ((item.path === '#' || item.children.length > 0) && filteredChildren.length === 0) {
            return null;
          }
          
          return { ...item, children: filteredChildren };
        }
        return item;
      })
      .filter(Boolean) as NavItem[]; // Remove nulls
  };

  const visibleNav = filterNavItems(navStructure);

  // Capacitor mobile bottom nav — limited to 5 core pages
  const mobileBottomNav: NavItem[] = [
    { label: 'Home', path: '/', icon: <Home className="h-5 w-5" /> },
    { label: 'Search', path: '/search', entity: 'customer_search' as EntityType, icon: <Search className="h-5 w-5" /> },
    { label: 'Task', path: '/task-report', entity: 'tasks' as EntityType, icon: <FileText className="h-5 w-5" /> },
    { label: 'Service', path: '/service/pending', entity: 'service_calls' as EntityType, icon: <PhoneCall className="h-5 w-5" /> },
    { label: 'Lead', path: '/lead/pending', entity: 'leads' as EntityType, icon: <UsersIcon className="h-5 w-5" /> },
  ];
  const visibleMobileNav = filterNavItems(mobileBottomNav);

  // Combine all items for mobile menu logic
  const allMobileItems = [...visibleNav];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleMobileExpand = (label: string) => {
    setMobileExpanded(mobileExpanded === label ? null : label);
  };

  const toggleMobileSubExpand = (label: string) => {
    setMobileSubExpanded(mobileSubExpanded === label ? null : label);
  };

  const checkActive = (path: string) => {
    const [pathname, search] = path.split('?');
    if (path === '/') return location.pathname === '/';
    if (path === '#') return false;

    // Use exact match to prevent /service matching /service/followup
    if (location.pathname !== pathname) return false;

    // Search param match (if any)
    if (search) {
      const currentParams = new URLSearchParams(location.search);
      const linkParams = new URLSearchParams(search);
      for (const [key, val] of Array.from(linkParams.entries())) {
        if (currentParams.get(key) !== val) return false;
      }
    }
    return true;
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-16 md:pb-0">
      {/* Session Lock Modal */}
      {isSessionLocked && (
        <SessionLockModal
          onUnlock={unlockSession}
          onLogout={handleLogout}
        />
      )}

      <header className="bg-white text-gray-800 shadow-sm border-b border-gray-200 fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center justify-between px-2 md:px-3 h-14 md:h-16">
          <div className="flex items-center gap-3 xl:gap-6 min-w-0 flex-1">
            <img src="/logo.png" alt="ABS" className="h-8 md:h-9 w-auto flex-shrink-0" />
            <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1 flex-1 min-w-0">
              {visibleNav.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isChildActive = hasChildren && item.children?.some(child => location.pathname.startsWith(child.path.split('?')[0]));
                const isActive = item.path === '/' ? location.pathname === '/' : (location.pathname.startsWith(item.path.split('?')[0]) || isChildActive);

                return (
                  <div key={item.label} className="relative group">
                    {/* Parent Item */}
                    {hasChildren ? (
                      <button
                        className={`flex items-center gap-1 px-1.5 xl:px-2.5 py-2 text-xs xl:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${isChildActive ? 'text-red-600 bg-red-50' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                        <ChevronDown className="h-3 w-3 mt-0.5 opacity-50" />
                      </button>
                    ) : (
                      <NavLink
                        to={item.path}
                        end={item.path === '/'}
                        className={({ isActive: linkActive }) =>
                          `flex items-center gap-1 px-1.5 xl:px-2.5 py-2 text-xs xl:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${(isActive || linkActive)
                            ? 'bg-red-50 text-red-600'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                          }`
                        }
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </NavLink>
                    )}

                    {hasChildren && (
                      <div className="absolute left-0 top-full pt-1 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-in-out transform origin-top-left z-50">
                        <div className="bg-white rounded-lg shadow-xl border border-gray-100 py-1">
                          {item.children?.map((child) => (
                            <div key={child.label} className="relative group/sub">
                              {child.children ? (
                                <>
                                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                                    <div className="flex items-center gap-2">
                                      {child.icon}
                                      <span>{child.label}</span>
                                    </div>
                                    <ChevronDown className="h-3 w-3 -rotate-90 text-gray-400" />
                                  </div>
                                  
                                  {/* Level 3 Mockup / Actual Submenu */}
                                  <div className="absolute left-full top-0 ml-0.5 w-48 hidden group-hover/sub:block z-50">
                                     <div className="bg-white rounded-lg shadow-xl border border-gray-100 py-1">
                                        {child.children.map(subChild => (
                                          <NavLink
                                            key={subChild.path}
                                            to={subChild.path}
                                            className={({ isActive }) =>
                                              `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${isActive
                                                ? 'bg-red-50 text-red-600 font-medium'
                                                : 'text-gray-700 hover:bg-gray-50'
                                              }`
                                            }
                                          >
                                            {subChild.icon}
                                            <span>{subChild.label}</span>
                                          </NavLink>
                                        ))}
                                     </div>
                                  </div>
                                </>
                              ) : (
                                <NavLink
                                  to={child.path}
                                  className={() =>
                                    `flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${checkActive(child.path)
                                      ? 'bg-red-50 text-red-600 font-medium'
                                      : 'text-gray-700 hover:bg-gray-50'
                                    }`
                                  }
                                >
                                  {child.icon}
                                  <span>{child.label}</span>
                                </NavLink>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="hidden md:flex items-center gap-1 mr-1 flex-shrink-0">
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700 transition-colors relative"
                title="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifDropdown(false)} />
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                      <span className="text-sm font-bold text-gray-800">Notifications</span>
                      {unreadCount > 0 && (
                        <button onClick={() => { markAllRead(); setShowNotifDropdown(false); }} className="text-xs text-blue-600 hover:underline font-medium">
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">No new notifications</div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            className="px-4 py-3 border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                            onClick={() => { markRead([n.id]); navigate(n.url || '/service/pending'); setShowNotifDropdown(false); }}
                          >
                            <div className="text-sm font-semibold text-gray-800">{n.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>
                            <div className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="p-2 hover:bg-red-50 rounded-full text-gray-400 hover:text-red-600 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>

          <div className="flex md:hidden items-center gap-2">
            {/* Mobile Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors relative"
              >
                <Bell className="h-6 w-6" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifDropdown(false)} />
                  <div className="fixed right-2 top-14 w-[calc(100vw-16px)] max-w-sm bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                      <span className="text-sm font-bold text-gray-800">Notifications</span>
                      {unreadCount > 0 && (
                        <button onClick={() => { markAllRead(); setShowNotifDropdown(false); }} className="text-xs text-blue-600 hover:underline font-medium">
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">No new notifications</div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            className="px-4 py-3 border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                            onClick={() => { markRead([n.id]); navigate(n.url || '/service/pending'); setShowNotifDropdown(false); }}
                          >
                            <div className="text-sm font-semibold text-gray-800">{n.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>
                            <div className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Mobile Profile Toggle */}
            <NavLink to="/profile" className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <User className="h-6 w-6" />
            </NavLink>
            </div>
        </div>
      </header>

      {/* Mobile Drawer (Side Menu) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Content */}
          <div className="absolute right-0 top-0 bottom-0 w-[80%] max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* User Info Header */}
            <div className="p-5 bg-gradient-to-br from-red-600 to-red-700 text-white shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-lg font-bold">
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold text-lg leading-tight">{user?.name}</div>
                    <div className="text-xs text-red-100 opacity-90">{user?.role?.toLowerCase() === 'admin' ? 'Administrator' : 'User'}</div>
                  </div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Mobile Attendance - Moved to Dashboard */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
               <NavLink to="/" onClick={() => setMobileMenuOpen(false)} className="bg-white border border-gray-200 w-full py-2 rounded-lg flex items-center justify-center gap-2 text-sm text-gray-700 hover:bg-gray-50">
                  <Clock className="h-4 w-4 text-blue-600"/> Go to Dashboard for Attendance
               </NavLink>
            </div>

            {/* Navigation List */}
            <div className="flex-1 overflow-y-auto py-2">
              <nav className="px-3 space-y-1">
                {allMobileItems.map(item => {
                  const hasChildren = item.children && item.children.length > 0;
                  const isExpanded = mobileExpanded === item.label;

                  if (hasChildren) {
                    return (
                      <div key={item.label} className="overflow-hidden rounded-lg">
                        <button
                          onClick={() => toggleMobileExpand(item.label)}
                          className="w-full flex items-center justify-between px-4 py-3 text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                        >
                          <div className="flex items-center gap-3">
                            {item.icon}
                            {item.label}
                          </div>
                          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Expanded Submenu */}
                        <div className={`bg-gray-50 transition-all duration-200 ${isExpanded ? 'max-h-[1200px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
                          <div className="px-4 py-2 space-y-1">
                            {item.children?.map(child => (
                              child.children ? (
                                // Nested (3rd level)
                                <div key={child.label} className="rounded-lg overflow-hidden">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleMobileSubExpand(child.label); }}
                                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md"
                                  >
                                    <div className="flex items-center gap-2">
                                      {child.icon}
                                      {child.label}
                                    </div>
                                    <ChevronDown className={`h-3 w-3 transition-transform ${mobileSubExpanded === child.label ? 'rotate-180' : ''}`} />
                                  </button>
                                  <div className={`${mobileSubExpanded === child.label ? 'block' : 'hidden'} pl-4 border-l-2 border-gray-200 ml-2 mt-1 space-y-1`}>
                                    {child.children.map(sub => (
                                      <NavLink
                                        key={sub.path}
                                        to={sub.path}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={() => `flex items-center gap-2 px-3 py-2 text-sm rounded-md ${checkActive(sub.path) ? 'text-red-600 font-medium bg-red-50' : 'text-gray-500'}`}
                                      >
                                        {sub.icon}
                                        {sub.label}
                                      </NavLink>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <NavLink
                                  key={child.label}
                                  to={child.path}
                                  onClick={() => setMobileMenuOpen(false)}
                                  className={() => `flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${checkActive(child.path) ? 'text-red-600 font-medium bg-red-50' : 'text-gray-600 hover:bg-gray-100'}`}
                                >
                                  {child.icon}
                                  {child.label}
                                </NavLink>
                              )
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <NavLink
                        key={item.label}
                        to={item.path}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActive ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-100' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {item.icon}
                        {item.label}
                      </NavLink>
                    );
                  }
                })}
              </nav>
            </div>

            {/* Logout Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 hover:text-red-600 hover:border-red-200 transition-all shadow-sm"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content — pt-14/16 offsets the fixed header so content doesn't hide behind it */}
      <main className="w-full p-0 md:p-1 pt-14 md:pt-16 animate-in fade-in duration-500">
        <Outlet />
      </main>

      {/* Accounts bottom sheet */}
      {showAccountsSheet && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAccountsSheet(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
               style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
              <span className="text-base font-bold text-gray-800">Accounts</span>
              <button onClick={() => setShowAccountsSheet(false)} className="p-1 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            {/* Create Voucher */}
            <div className="px-4 pt-3 pb-2">
              <NavLink to="/billing/vouchers" onClick={() => setShowAccountsSheet(false)}
                className="flex items-center gap-3 bg-blue-600 text-white rounded-xl px-4 py-3.5 font-semibold text-sm active:bg-blue-700">
                <Receipt className="h-5 w-5" />
                New Voucher
              </NavLink>
            </div>
            {/* Reports */}
            <div className="px-4 pb-2 pt-1">
              <p className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-2 px-1">Reports</p>
              <div className="space-y-1">
                {[
                  { label: 'Outstanding Report',    path: '/reports/outstanding',      entity: 'reports_outstanding' as any,   icon: <FileText className="h-4 w-4" /> },
                  { label: 'User-wise Outstanding', path: '/reports/user-outstanding', entity: 'reports_user_outstanding' as any, icon: <UsersIcon className="h-4 w-4" /> },
                  { label: 'Ledger Report',         path: '/reports/ledger',           entity: 'reports_ledger' as any,        icon: <FileText className="h-4 w-4" /> },
                  { label: 'Day Book',              path: '/billing/daybook',          entity: 'reports_daybook' as any,       icon: <FileText className="h-4 w-4" /> },
                  { label: 'Sales Register',        path: '/reports/sales-register',   entity: 'reports_sales_register' as any, icon: <Receipt className="h-4 w-4" /> },
                  { label: 'Group Summary',         path: '/reports/group-summary',    entity: 'reports_group_summary' as any, icon: <Layers className="h-4 w-4" /> },
                  { label: 'Stock Summary',         path: '/reports/stock-summary',    entity: 'reports_stock_summary' as any, icon: <BarChart2 className="h-4 w-4" /> },
                  { label: 'Bill Report',           path: '/billing/bill-report',      entity: 'reports_daybook' as any,       icon: <FileText className="h-4 w-4" /> },
                  { label: 'Payment Report',        path: '/billing/payment-report',   entity: 'reports_daybook' as any,       icon: <FileText className="h-4 w-4" /> },
                ].filter(r => canView(r.entity)).map(r => (
                  <NavLink key={r.path} to={r.path} onClick={() => setShowAccountsSheet(false)}
                    className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-red-50 text-red-600 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                    {r.icon}
                    {r.label}
                  </NavLink>
                ))}
              </div>
            </div>
            {/* More — open full menu */}
            <div className="px-4 pb-4 pt-1 border-t border-gray-100 mt-2">
              <button onClick={() => { setShowAccountsSheet(false); setMobileMenuOpen(true); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-500 hover:text-gray-700">
                <Menu className="h-4 w-4" /> Full Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar — always visible on small screens */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] z-50 md:hidden"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-around h-16">
          {visibleMobileNav.map(item => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path.split('?')[0]);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                  isActive ? 'text-red-600' : 'text-gray-400 active:text-gray-600'
                }`}
              >
                <div className={`${isActive ? 'bg-red-50 rounded-full p-1.5' : 'p-1.5'}`}>
                  {item.icon}
                </div>
                <span className={`text-[10px] mt-0.5 ${isActive ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
              </NavLink>
            );
          })}
          {/* Accounts button — replaces Menu */}
          <button
            onClick={() => setShowAccountsSheet(true)}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              showAccountsSheet ? 'text-blue-600' : 'text-gray-400 active:text-gray-600'
            }`}
          >
            <div className={`${showAccountsSheet ? 'bg-blue-50 rounded-full p-1.5' : 'p-1.5'}`}>
              <LayoutGrid className="h-5 w-5" />
            </div>
            <span className="text-[10px] mt-0.5 font-medium">Accounts</span>
          </button>
        </div>
      </nav>

    </div>
  );
};

export default Layout;
