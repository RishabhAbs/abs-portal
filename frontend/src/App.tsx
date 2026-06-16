import React, { useEffect, useState } from 'react'; // Trigger Rebuild
import { getDebugLogs, clearDebugLogs } from './services/api';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { AuthProvider } from './context/AuthContext';
import { requestAppPermissions } from './utils/requestPermissions';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './components/Toast/Toast';
import ProtectedRoute from './components/ProtectedRoute';
import PermissionGuard from './components/PermissionGuard';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import Customers from './pages/CustomerList';
import InactiveCustomers from './pages/InactiveCustomers';
import GroupChangeReport from './pages/GroupChangeReport';
import Reseller from './pages/Reseller';
import Mapping from './pages/Mapping';
import Users from './pages/Users';
import Activity from './pages/Activity';
import Pincode from './pages/Pincode';

import TaskManagement from './pages/TaskManagement';
import TaskReport from './pages/TaskReport';
import PendingVisits from './pages/PendingVisits';
import LastVisitReport from './pages/LastVisitReport';
import ConnectMap from './pages/ConnectMap';
import CallReport from './pages/CallReport';
import ExpiryRenewPage from './pages/ExpiryRenewPage';

import CustomerSearch from './pages/CustomerSearch';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import AmcPublicView from './pages/AmcPublicView';
import Network from './pages/Network';
import AttendanceHistory from './pages/AttendanceHistory';
import MonthlyAttendanceDetail from './pages/MonthlyAttendanceDetail';
import ServiceCalls from './pages/ServiceCalls';
import ServiceFollowUp from './pages/ServiceFollowUp';
import LeadReport from './pages/LeadReport';
import LeadRequirementsReport from './pages/LeadRequirementsReport';

import MyRequirements from './pages/MyRequirements';
import Vouchers from './pages/Vouchers';
import Daybook from './pages/Daybook';
import PendingReview from './pages/PendingReview';
import OutstandingReport from './pages/OutstandingReport';
import LedgerReport from './pages/LedgerReport';
import SalesRegister from './pages/SalesRegister';
import GroupSummary from './pages/GroupSummary';
import StockSummary from './pages/StockSummary';
import UserWiseOutstanding from './pages/UserWiseOutstanding';
import PrintVoucher from './pages/PrintVoucher';
import BillReport from './pages/BillReport';
import PaymentReport from './pages/PaymentReport';
import Items from './pages/Items';
import LedgerGroup from './pages/LedgerGroup';
import ItemGroup from './pages/ItemGroup';
import ItemCategory from './pages/ItemCategory';
import OtherLedger from './pages/OtherLedger';
import VchType from './pages/VchType';
import TargetSetup from './pages/TargetSetup';
import TdlExpiry from './pages/TdlExpiry';
import TdlBilling from './pages/TdlBilling';
import ServerMonitor from './pages/ServerMonitor';
import { initSecurityProtections } from './utils/security';

// Initialize security protections on app load
initSecurityProtections();

// Hardware back button: on Android/Capacitor, default behavior exits the app.
// Route through React Router instead so back goes to the previous screen.
const BackButtonHandler: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    let listener: any = null;
    CapApp.addListener('backButton', ({ canGoBack }) => {
      // Capacitor's canGoBack reflects the WebView's history stack. When true,
      // navigate back; when we're at the stack root, exit the app.
      if (canGoBack || window.history.length > 1) {
        navigate(-1);
      } else {
        CapApp.exitApp();
      }
    }).then((l: any) => { listener = l; }).catch(() => {});
    return () => { try { listener?.remove?.(); } catch {} };
  }, [navigate]);
  return null;
};

function App() {
  useEffect(() => {
    requestAppPermissions();
  }, []);

  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (showDebug) {
      const id = setInterval(() => setLogs(getDebugLogs()), 1000);
      return () => clearInterval(id);
    }
  }, [showDebug]);

  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          {/* Debug toggle - triple tap top-left corner */}
          <div className="fixed top-0 left-0 w-12 h-12 z-[9999]" onClick={() => { setShowDebug(v => !v); setLogs(getDebugLogs()); }} />
          {showDebug && (
            <div className="fixed top-12 left-2 right-2 z-[9999] bg-black/90 text-green-400 text-[11px] font-mono p-3 rounded-lg max-h-[60vh] overflow-y-auto shadow-2xl">
              <div className="flex justify-between items-center mb-2">
                <span className="text-white font-bold">DEBUG LOGS</span>
                <div className="flex gap-2">
                  <button onClick={() => { clearDebugLogs(); setLogs([]); }} className="text-red-400 text-[10px] px-2 py-0.5 border border-red-400 rounded">Clear</button>
                  <button onClick={() => setShowDebug(false)} className="text-white text-[10px] px-2 py-0.5 border border-white rounded">Close</button>
                </div>
              </div>
              {logs.length === 0 ? <div className="text-gray-500">No logs yet</div> : logs.map((l, i) => <div key={i} className="py-0.5 border-b border-gray-800">{l}</div>)}
            </div>
          )}
          <Router>
            <BackButtonHandler />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/tdl/amc/:token" element={<AmcPublicView />} />
              <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="profile" element={<Profile />} />

                {/* Cloud Module */}
                <Route path="cloud">
                  <Route index element={<Navigate to="servers" replace />} />
                  <Route path="servers" element={<PermissionGuard entity="servers"><Servers /></PermissionGuard>} />
                  <Route path="mapping" element={<PermissionGuard entity="mappings"><Mapping /></PermissionGuard>} />
                  <Route path="activity" element={<Navigate to="billing" replace />} />
                  <Route path="activity/billing" element={<PermissionGuard entity="activities"><Activity viewMode="sales" /></PermissionGuard>} />
                  <Route path="activity/purchase" element={<PermissionGuard entity="activities"><Activity viewMode="purchase" /></PermissionGuard>} />
                  <Route path="monitor" element={<PermissionGuard entity="mappings"><ServerMonitor /></PermissionGuard>} />
                </Route>

                {/* Legacy Redirects */}
                <Route path="servers" element={<Navigate to="/cloud/servers" replace />} />
                <Route path="mapping" element={<Navigate to="/cloud/mapping" replace />} />
                <Route path="activity" element={<Navigate to="/cloud/activity" replace />} />

                {/* TDL Module */}
                <Route path="tdl">
                  <Route index element={<Navigate to="expiry" replace />} />
                  <Route path="expiry" element={<PermissionGuard entity="tdl"><TdlExpiry /></PermissionGuard>} />
                  <Route path="billing" element={<PermissionGuard entity="tdl"><TdlBilling /></PermissionGuard>} />
                  <Route path="tasks/:tdlId/:reqId" element={<PermissionGuard entity="tasks"><TaskManagement /></PermissionGuard>} />
                </Route>

                {/* Visit Module */}
                <Route path="visit">
                  <Route index element={<Navigate to="oc-report" replace />} />
                  <Route path="oc-report" element={<PermissionGuard entity="visits_our"><LastVisitReport segment="our" /></PermissionGuard>} />
                  <Route path="noc-report" element={<PermissionGuard entity="visits_not_our"><LastVisitReport segment="not_our" /></PermissionGuard>} />
                  <Route path="oc-pending" element={<PermissionGuard entity="visits_our"><PendingVisits segment="our" /></PermissionGuard>} />
                  <Route path="noc-pending" element={<PermissionGuard entity="visits_not_our"><PendingVisits segment="not_our" /></PermissionGuard>} />
                  <Route path="map" element={<PermissionGuard entity={['visits_our', 'visits_not_our']}><ConnectMap /></PermissionGuard>} />
                  <Route path="call-report" element={<PermissionGuard entity="call_report"><CallReport /></PermissionGuard>} />
                </Route>

                {/* Tally Module */}
                <Route path="tally">
                  <Route path="expiry/our" element={<PermissionGuard entity="expiry_renew_our"><ExpiryRenewPage customerType="our" /></PermissionGuard>} />
                  <Route path="expiry/not-our" element={<PermissionGuard entity="expiry_renew_not_our"><ExpiryRenewPage customerType="not_our" /></PermissionGuard>} />
                </Route>

                {/* Common */}
                <Route path="task-report" element={<PermissionGuard entity="tasks"><TaskReport /></PermissionGuard>} />
                <Route path="search" element={<PermissionGuard entity="customer_search"><CustomerSearch /></PermissionGuard>} />
                <Route path="customers" element={<PermissionGuard entity={['customers_our', 'customers_not_our']}><Customers /></PermissionGuard>} />
                <Route path="customers/inactive" element={<PermissionGuard adminOnly><InactiveCustomers /></PermissionGuard>} />
                <Route path="group-change" element={<PermissionGuard entity="group_change"><GroupChangeReport /></PermissionGuard>} />
                <Route path="resellers" element={<PermissionGuard entity="resellers"><Reseller /></PermissionGuard>} />
                {/* Service Module */}
                <Route path="service">
                  <Route index element={<Navigate to="pending" replace />} />
                  <Route path="pending" element={<PermissionGuard entity="service_calls"><ServiceCalls segment="pending" /></PermissionGuard>} />
                  <Route path="completed" element={<PermissionGuard entity="service_calls"><ServiceCalls segment="completed" /></PermissionGuard>} />
                  <Route path="canceled" element={<PermissionGuard entity="service_calls"><ServiceCalls segment="canceled" /></PermissionGuard>} />
                  <Route path="followup" element={<PermissionGuard entity="service_followup"><ServiceFollowUp /></PermissionGuard>} />
                </Route>


                {/* Lead Module */}
                <Route path="lead">
                  <Route index element={<Navigate to="pending" replace />} />
                  <Route path="pending" element={<PermissionGuard entity="leads"><LeadReport segment="pending" /></PermissionGuard>} />
                  <Route path="closed" element={<PermissionGuard entity="leads"><LeadReport segment="closed" /></PermissionGuard>} />
                  <Route path="cancelled" element={<PermissionGuard entity="leads"><LeadReport segment="cancelled" /></PermissionGuard>} />
                  <Route path="my-requirements" element={<PermissionGuard entity="my_requirements"><MyRequirements /></PermissionGuard>} />
                  <Route path="requirements-report" element={<PermissionGuard entity="tdl"><LeadRequirementsReport /></PermissionGuard>} />
                </Route>

                {/* Billing Module */}
                <Route path="billing">
                  <Route index element={<Navigate to="vouchers" replace />} />
                  <Route path="vouchers" element={<PermissionGuard entity="vouchers"><Vouchers /></PermissionGuard>} />
                  <Route path="vouchers/new" element={<PermissionGuard entity="vouchers"><Vouchers /></PermissionGuard>} />
                  <Route path="vouchers/edit/:id" element={<PermissionGuard entity={['vouchers', 'reports_outstanding', 'reports_ledger', 'reports_daybook']}><Vouchers /></PermissionGuard>} />
                  <Route path="print-voucher" element={<PermissionGuard entity={['vouchers', 'reports_daybook']}><PrintVoucher /></PermissionGuard>} />
                  <Route path="print-voucher/:id" element={<PermissionGuard entity={['vouchers', 'reports_daybook']}><PrintVoucher /></PermissionGuard>} />
                  <Route path="daybook" element={<PermissionGuard entity="reports_daybook"><Daybook /></PermissionGuard>} />
                  <Route path="pending-review" element={<PermissionGuard entity={['reports_daybook', 'vouchers']}><PendingReview /></PermissionGuard>} />
                  <Route path="bill-report" element={<PermissionGuard entity="reports_daybook"><BillReport /></PermissionGuard>} />
                  <Route path="payment-report" element={<PermissionGuard entity="reports_daybook"><PaymentReport /></PermissionGuard>} />
                  <Route path="items" element={<PermissionGuard entity="items"><Items /></PermissionGuard>} />
                  <Route path="ledger-groups" element={<PermissionGuard entity="ledger_groups"><LedgerGroup /></PermissionGuard>} />
                  <Route path="item-groups" element={<PermissionGuard entity="items"><ItemGroup /></PermissionGuard>} />
                  <Route path="item-categories" element={<PermissionGuard entity="items"><ItemCategory /></PermissionGuard>} />
                  <Route path="other-ledgers" element={<PermissionGuard entity="other_ledgers"><OtherLedger /></PermissionGuard>} />
                  <Route path="vch-types" element={<PermissionGuard entity="vch_types"><VchType /></PermissionGuard>} />
                </Route>
                <Route path="reports">
                  <Route index element={<Navigate to="outstanding" replace />} />
                  <Route path="outstanding" element={<PermissionGuard entity="reports_outstanding"><OutstandingReport /></PermissionGuard>} />
                  <Route path="ledger" element={<PermissionGuard entity="reports_ledger"><LedgerReport /></PermissionGuard>} />
                  <Route path="sales-register" element={<PermissionGuard entity={['reports_sales_register', 'reports_daybook']}><SalesRegister /></PermissionGuard>} />
                  <Route path="group-summary" element={<PermissionGuard entity={['reports_group_summary', 'reports_daybook']}><GroupSummary /></PermissionGuard>} />
                  <Route path="stock-summary" element={<PermissionGuard entity={['reports_stock_summary', 'reports_daybook']}><StockSummary /></PermissionGuard>} />
                  <Route path="user-outstanding" element={<PermissionGuard entity={['reports_user_outstanding', 'reports_outstanding']}><UserWiseOutstanding /></PermissionGuard>} />
                </Route>
                <Route path="pincodes" element={<PermissionGuard entity="pincodes"><Pincode /></PermissionGuard>} />
                <Route path="users" element={<PermissionGuard entity="users" adminOnly><Users /></PermissionGuard>} />
                <Route path="network" element={<PermissionGuard adminOnly><Network /></PermissionGuard>} />
                <Route path="attendance" element={<AttendanceHistory />} />
                <Route path="attendance/monthly" element={<MonthlyAttendanceDetail />} />
                <Route path="targets" element={<PermissionGuard entity="targets"><TargetSetup /></PermissionGuard>} />
                <Route path="settings" element={<PermissionGuard adminOnly><Settings /></PermissionGuard>} />
              </Route>
            </Routes>
          </Router>
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
