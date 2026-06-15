import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { serversApi, customersApi, mappingsApi, activitiesApi } from '../services/api';
import { toLocalDateString } from '../utils/dateUtils';

// Types
export interface Server {
  id: string;
  server_ip: string;
  sof_no: string;
  port: string;
  customer_ip: string;
  admin_username: string;
  admin_password: string;
  admin_password_enc?: string;
  status: 'Active' | 'Inactive' | 'Maintenance';
  company: string;
  purchase_rate: number;
  purchase_units?: number; // Cached P.U. for the whole server
  billing_mode?: 'day_to_day' | 'month_to_month';
  billing_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
  server_expiry?: string | null;
  created_at?: string;
  updated_at?: string;
  customer_count?: number;
  ping_test?: number;
}

export interface Customer {
  id: string; // Domain IP (mapped from customerid)
  internal_id?: number; // Legacy ID (PK) - Master ID
  customerid?: string; // Legacy field
  group: number | null;  // References admin.id (existing column)
  group_name?: string;  // Joined from admin table
  cloud_group_id?: string | null;  // Primary cloud user handler
  subgroupid?: string | null;  // Sub user handler
  company: string;
  email: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  gstin: string | null;
  pincode: string | null;
  area: string | null;
  state: string | null;
  remark: string | null;
  status: 'Active' | 'Inactive' | 'Suspended';
  created_at?: string;
  is_mapped?: boolean | number; // 0 or 1 from backend
  resellerid?: number | null;
  reseller_name?: string | null;
}

export interface Mapping {
  id: string;
  server_id: string;
  customer_id: string;
  serial_no: string;
  billed_users?: number; // Cached B.U.
  purchase_users?: number; // Cached P.U.
  status: 'Active' | 'Inactive';
  mapped_at?: string;
  server_ip?: string;
  customer_name?: string;
}

export interface Activity {
  id: string;
  display_id?: string; // Optional for old records compatibility
  customer_name: string;
  customer_domain_ip: string;
  customer_id?: string;
  server_name: string;
  sof_no: string;
  activity_date: string;
  activity_type: 'User' | 'Renewal' | 'New';
  bill_type: 'Tax Invoice' | 'Credit Note';
  billing_units: number;
  purchase_units: number;
  last_bill_rate: number;
  purchase_rate: number;
  billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly' | null;
  old_expiry_date: string;
  bill_no: string;
  bill_date: string;
  start_from: string;
  new_expiry_date: string;
  date_diff_months: number;
  date_diff_days: number;
  date_diff_label?: string;
  bill_amount: number;
  purchase_amount: number;
  record_nature?: 'Sales' | 'Purchase';
  group_id?: string | null;
  // For UI/Creation only
  is_sales?: boolean;
  is_purchase?: boolean;
  billing_mode?: 'day_to_day' | 'month_to_month' | null;
  purchase_billing_mode?: 'day_to_day' | 'month_to_month' | null;
  custom_period?: boolean;
  server_ip?: string;
  mapped_server_ip?: string;
  mapped_customer_ip?: string;
  // Purchase-specific fields (independent from Billing)
  purchase_cycle?: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly' | null;
  purchase_start_from?: string;
  purchase_expiry?: string;
  purchase_date_diff_months?: number;
  purchase_date_diff_days?: number;
  purchase_date_diff_label?: string;

  // Independent Types
  billing_activity_type?: 'New' | 'Renewal' | 'User';
  purchase_activity_type?: 'New' | 'Renewal' | 'User';

  created_at?: string;
}

// Calculate bill amount
export const calculateBillAmount = (
  activityType: Activity['activity_type'],
  billingUnits: number,
  lastBillRate: number,
  billingCycle: Activity['billing_cycle'],
  dateDiffMonths: number,
  dateDiffDays: number,
  billType: Activity['bill_type']
): number => {
  let amount = 0;

  if (activityType === 'Renewal' || activityType === 'New') {
    // New/Renewal: Users × Rate × Cycle_Months
    const cycleMonths = billingCycle === 'Monthly' ? 1 :
      billingCycle === 'Quarterly' ? 3 :
        billingCycle === 'Half-Yearly' ? 6 : 12;
    amount = billingUnits * lastBillRate * cycleMonths;
  } else {
    // User type: (Rate/30) × Users × Total_Days
    // Where Total_Days = (Months × 30) + Days
    const dailyRate = lastBillRate / 30;
    const totalDays = (dateDiffMonths * 30) + dateDiffDays;
    amount = Math.round(dailyRate * billingUnits * totalDays);
  }

  if (billType === 'Credit Note') {
    return -Math.abs(amount);
  }

  return amount;
};

// Calculate date difference
export const calculateDateDiff = (startDate: string, endDate: string): { months: number; days: number } => {
  if (!startDate || !endDate) return { months: 0, days: 0 };

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end <= start) return { months: 0, days: 0 };

  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());

  let tempDate = new Date(start);
  tempDate.setMonth(tempDate.getMonth() + months);

  if (tempDate > end) {
    months--;
    tempDate = new Date(start);
    tempDate.setMonth(tempDate.getMonth() + months);
  }

  const days = Math.floor((end.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));

  return { months, days };
};

// Determine default activity type
export const determineDefaultActivityType = (
  customerId: string,
  activities: Activity[]
): Activity['activity_type'] => {
  const customerActivities = activities.filter(
    a => a.customer_domain_ip === customerId || a.customer_id === customerId
  );

  if (customerActivities.length === 0) {
    return 'New';
  }

  return 'User';
};

// Calculate expiry date based on activity type and billing cycle
export const calculateExpiryDate = (
  activityType: Activity['activity_type'],
  activityDate: string,
  customerId: string,
  activities: Activity[],
  billingCycle?: Activity['billing_cycle']
): string => {
  if (!activityDate) return '';

  // For New and Renewal: Calculate based on billing cycle
  if (activityType === 'New' || activityType === 'Renewal') {
    const date = new Date(activityDate);
    const cycle = billingCycle || 'Quarterly'; // Default to Quarterly

    switch (cycle) {
      case 'Monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'Quarterly':
        date.setMonth(date.getMonth() + 3);
        break;
      case 'Half-Yearly':
        date.setMonth(date.getMonth() + 6);
        break;
      case 'Yearly':
        date.setMonth(date.getMonth() + 12);
        break;
      default:
        date.setMonth(date.getMonth() + 3);
    }
    return toLocalDateString(date);
  }

  // For User type: Don't auto-calculate, let user enter manually
  // But pre-fill with last known expiry if available
  if (activityType === 'User') {
    const customerActivities = activities
      .filter(a => a.customer_domain_ip === customerId || a.customer_id === customerId)
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date));

    if (customerActivities.length > 0 && customerActivities[0].new_expiry_date) {
      return customerActivities[0].new_expiry_date;
    }
  }

  return '';
};

// Validate old expiry date
export const validateOldExpiryDate = (
  activityType: Activity['activity_type'],
  oldExpiryDate: string,
  newExpiryDate: string
): { valid: boolean; error?: string } => {
  if (activityType !== 'Renewal') {
    return { valid: true };
  }

  if (!oldExpiryDate) {
    return { valid: true };
  }

  if (oldExpiryDate >= newExpiryDate) {
    return {
      valid: false,
      error: 'Old expiry date must be before new expiry date'
    };
  }

  return { valid: true };
};

// Context Type
interface DataContextType {
  servers: Server[];
  customers: Customer[];
  mappings: Mapping[];
  activities: Activity[];
  isLoading: boolean;
  error: string | null;

  // Load data
  loadData: () => Promise<void>;

  // Server CRUD
  addServer: (server: Partial<Server>) => Promise<void>;
  updateServer: (id: string, server: Partial<Server>) => Promise<void>;
  deleteServer: (id: string) => Promise<boolean>;

  // Customer CRUD
  addCustomer: (customer: Partial<Customer>) => Promise<void>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<boolean>;

  // Mapping CRUD
  addMapping: (mapping: Partial<Mapping>) => Promise<void>;
  updateMapping: (id: string, mapping: Partial<Mapping>) => Promise<void>;
  deleteMapping: (id: string) => Promise<void>;

  // Activity CRUD
  addActivity: (activity: Partial<Activity>) => Promise<void>;
  updateActivity: (id: string, activity: Partial<Activity>) => Promise<void>;
  deleteActivity: (id: string) => Promise<void>;

  // Helpers
  getServerById: (id: string) => Server | undefined;
  getCustomerById: (id: string) => Customer | undefined;
  getServerByCustomerId: (customerId: string) => Server | undefined;
  getMappingsByServer: (serverId: string) => Mapping[];
  getMappingByCustomer: (customerId: string) => Mapping | undefined;
  getUnmappedCustomers: () => Customer[];
  isCustomerMapped: (customerId: string) => boolean;
  getActivitiesByCustomer: (customerName: string) => Activity[];
  getTotalRevenue: () => number;
  getLatestActivityByCustomerId: (customerId: string) => Activity | null;
  getTotalUsersByCustomerId: (customerId: string) => number;
  getTotalPurchaseUsersByCustomerId: (customerId: string) => number;
  getTotalPurchaseUsersByServerId: (serverId: string) => number;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [servers, setServers] = useState<Server[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load data - MODIFIED: We no longer load all data globally to prevent crash.
  // Pages must fetch their own data.
  const loadData = useCallback(async () => {
  }, []);

  // Server CRUD
  const addServer = async (data: Partial<Server>) => {
    try {
      // Map frontend field names to backend
      const serverData = {
        server_ip: data.server_ip,
        sof_no: data.sof_no,
        port: data.port,
        customer_ip: data.customer_ip,
        admin_username: data.admin_username,
        admin_password_enc: data.admin_password,
        status: data.status,
        company: data.company,
        purchase_rate: data.purchase_rate,
        billing_mode: data.billing_mode,
      };
      await serversApi.create(serverData);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create server');
    }
  };

  const updateServer = async (id: string, data: Partial<Server>) => {
    try {
      const serverData = {
        ...data,
        admin_password_enc: data.admin_password,
      };
      await serversApi.update(id, serverData);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update server');
    }
  };

  const deleteServer = async (id: string): Promise<boolean> => {
    try {
      await serversApi.delete(id);
      await loadData();
      return true;
    } catch (err: any) {
      return false;
    }
  };

  // Customer CRUD
  const addCustomer = async (data: Partial<Customer>) => {
    try {
      await customersApi.create(data);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create customer');
    }
  };

  const updateCustomer = async (id: string, data: Partial<Customer>) => {
    try {
      await customersApi.update(id, data);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update customer');
    }
  };

  const deleteCustomer = async (id: string): Promise<boolean> => {
    try {
      await customersApi.delete(id);
      await loadData();
      return true;
    } catch (err: any) {
      return false;
    }
  };

  // Mapping CRUD
  const addMapping = async (data: Partial<Mapping>) => {
    try {
      await mappingsApi.create(data);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create mapping');
    }
  };

  const updateMapping = async (id: string, data: Partial<Mapping>) => {
    try {
      await mappingsApi.update(id, data);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update mapping');
    }
  };

  const deleteMapping = async (id: string) => {
    try {
      await mappingsApi.delete(id);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete mapping');
    }
  };

  // Activity CRUD
  const addActivity = async (data: Partial<Activity>) => {
    try {
      // Map frontend field names to backend
      const activityData = {
        ...data,
        customer_id: data.customer_domain_ip,
        // Crucial flags for backend to create records
        is_sales: data.is_sales,
        is_purchase: data.is_purchase,
        billing_mode: data.billing_mode,
      };
      await activitiesApi.create(activityData as any);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create activity');
    }
  };

  const updateActivity = async (id: string, data: Partial<Activity>) => {
    try {
      const activityData = {
        ...data,
        customer_id: data.customer_domain_ip,
      };
      await activitiesApi.update(id, activityData);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update activity');
    }
  };

  const deleteActivity = async (id: string) => {
    try {
      await activitiesApi.delete(id);
      await loadData();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete activity');
    }
  };

  // Helpers
  const getServerById = (id: string) => servers.find(s => s.id === id);
  const getCustomerById = (id: string) => customers.find(c => c.id === id);
  const getServerByCustomerId = (customerId: string) => {
    const mapping = mappings.find(m => m && m.customer_id === customerId);
    if (mapping) return servers.find(s => s.id === mapping.server_id);
    return undefined;
  };
  const getMappingsByServer = (serverId: string) => mappings.filter(m => m && m.server_id === serverId);
  const getMappingByCustomer = (customerId: string) => mappings.find(m => m && m.customer_id === customerId);
  const getUnmappedCustomers = () => customers.filter(c => !mappings.some(m => m && m.customer_id === c.id));
  const isCustomerMapped = (customerId: string) => mappings.some(m => m && m.customer_id === customerId);
  const getActivitiesByCustomer = (customerName: string) => activities.filter(a => a.customer_name === customerName);
  const getTotalRevenue = () => activities.reduce((sum, a) => sum + (Number(a.bill_amount) || 0), 0);

  // Get latest SALES activity for a customer (by customer_id/domain_ip)
  // Only Sales activities have valid billing rates (Purchase activities have last_bill_rate = 0)
  // Prioritize activities with non-zero rates
  const getLatestActivityByCustomerId = (customerId: string) => {
    const salesActivities = activities
      .filter(a => a && (a.customer_domain_ip === customerId || a.customer_id === customerId) && a.record_nature === 'Sales')
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date));

    // First try to find an activity with a non-zero rate (most recent with valid rate)
    const withRate = salesActivities.find(a => Number(a.last_bill_rate) > 0);
    if (withRate) return withRate;

    // Fall back to any Sales activity
    return salesActivities.length > 0 ? salesActivities[0] : null;
  };

  // Calculate total users for a customer (sum of all billing_units changes - only Sales records)
  // New type sets the base, User type adds/subtracts based on bill_type
  const getTotalUsersByCustomerId = (customerId: string): number => {
    const customerActivities = activities
      .filter(a => a && (a.customer_domain_ip === customerId || a.customer_id === customerId) && a.record_nature === 'Sales')
      .sort((a, b) => {
        const dateCompare = a.activity_date.localeCompare(b.activity_date);
        if (dateCompare !== 0) return dateCompare;
        const typeOrder: Record<string, number> = { 'New': 1, 'Renewal': 2, 'User': 3 };
        return (typeOrder[a.activity_type] || 99) - (typeOrder[b.activity_type] || 99);
      });

    if (customerActivities.length === 0) return 0;

    let totalUsers = 0;

    for (const activity of customerActivities) {
      const units = Number(activity.billing_units) || 0;
      if (activity.activity_type === 'New') {
        totalUsers = units;
      } else if (activity.activity_type === 'User') {
        if (activity.bill_type === 'Credit Note') {
          totalUsers -= Math.abs(units);
        } else {
          totalUsers += units;
        }
      } else if (activity.activity_type === 'Renewal') {
        totalUsers = units;
      }
    }

    return totalUsers;
  };

  // Calculate total purchase users for a customer (only Purchase records)
  const getTotalPurchaseUsersByCustomerId = (customerId: string): number => {
    const customerActivities = activities
      .filter(a => a && (a.customer_domain_ip === customerId || a.customer_id === customerId) && a.record_nature === 'Purchase')
      .sort((a, b) => {
        const dateCompare = a.activity_date.localeCompare(b.activity_date);
        if (dateCompare !== 0) return dateCompare;
        const typeOrder: Record<string, number> = { 'New': 1, 'Renewal': 2, 'User': 3 };
        return (typeOrder[a.activity_type] || 99) - (typeOrder[b.activity_type] || 99);
      });

    if (customerActivities.length === 0) return 0;

    let totalUsers = 0;

    for (const activity of customerActivities) {
      const units = Number(activity.purchase_units) || 0;
      if (activity.activity_type === 'New') {
        totalUsers = units;
      } else if (activity.activity_type === 'User') {
        if (activity.bill_type === 'Credit Note') {
          totalUsers -= Math.abs(units);
        } else {
          totalUsers += units;
        }
      } else if (activity.activity_type === 'Renewal') {
        totalUsers = units;
      }
    }
    return totalUsers;
  };

  // Calculate total purchase users for a server (sum of all mapped customers)
  const getTotalPurchaseUsersByServerId = (serverId: string): number => {
    const serverMappings = mappings.filter(m => m && m.server_id === serverId);
    return serverMappings.reduce((sum, m) => sum + getTotalPurchaseUsersByCustomerId(m.customer_id), 0);
  };

  return (
    <DataContext.Provider value={{
      servers, customers, mappings, activities, isLoading, error,
      loadData,
      addServer, updateServer, deleteServer,
      addCustomer, updateCustomer, deleteCustomer,
      addMapping, updateMapping, deleteMapping,
      addActivity, updateActivity, deleteActivity,
      getServerById, getCustomerById, getServerByCustomerId, getMappingsByServer, getMappingByCustomer, getUnmappedCustomers, isCustomerMapped,
      getActivitiesByCustomer, getTotalRevenue, getLatestActivityByCustomerId, getTotalUsersByCustomerId,
      getTotalPurchaseUsersByCustomerId, getTotalPurchaseUsersByServerId
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
};
