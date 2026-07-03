// API Service - Connects frontend to backend
// Version 2.3 - Capacitor production support
console.log('%c[API SERVICE] v2.3 Initialized', 'color: blue; font-weight: bold;');
const host = window.location.hostname;
const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
const API_BASE = process.env.REACT_APP_API_URL || (
  isCapacitor
    ? 'https://cloud.abstechnologies.co.in/api'
    : (host === 'localhost' || host === '127.0.0.1')
      ? 'http://127.0.0.1:5000/api'
      : '/api'
);

// ── Debug Log System ──
const DEBUG_LOG_KEY = 'abs_debug_logs';
const MAX_LOGS = 30;
export const debugLog = (msg: string) => {
  try {
    const logs = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
    logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs));
  } catch {}
};
export const getDebugLogs = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]'); } catch { return []; }
};
export const clearDebugLogs = () => localStorage.removeItem(DEBUG_LOG_KEY);

debugLog(`API_BASE=${API_BASE} host=${host}`);

// Get auth token from localStorage (persists across refreshes)
export const getToken = (): string | null => {
  const tokenData = localStorage.getItem('abs_token_data');
  if (!tokenData) return null;

  try {
    const { token } = JSON.parse(tokenData);
    return token || null;
  } catch {
    localStorage.removeItem('abs_token_data');
    return null;
  }
};

// Update last activity timestamp
export const updateLastActivity = () => {
  const tokenData = localStorage.getItem('abs_token_data');
  if (tokenData) {
    try {
      const { token } = JSON.parse(tokenData);
      localStorage.setItem('abs_token_data', JSON.stringify({ token, lastActivity: Date.now() }));
    } catch {
      // Ignore errors
    }
  }
};

// Store token with timestamp
export const storeToken = (token: string) => {
  localStorage.setItem('abs_token_data', JSON.stringify({ token, lastActivity: Date.now() }));
};

// Clear token
export const clearToken = () => {
  localStorage.removeItem('abs_token_data');
  sessionStorage.removeItem('abs_token'); // Clean up old storage
};

// Custom API Error
export class ApiError extends Error {
  constructor(public message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic fetch wrapper with auth
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
  } catch (err: any) {
    debugLog(`FETCH FAIL ${endpoint} → ${err.message}`);
    throw err;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));

    // Auto-logout on session expiry (401) — except for login/auth endpoints
    if (response.status === 401 && !endpoint.includes('/auth/login')) {
      const currentPath = window.location.pathname;
      const onLoginPage = currentPath.toLowerCase().includes('/login');
      
      // Determine if this is a "soft" background request (e.g. state checks, active sessions)
      // These should NEVER trigger a redirect loop as they are often polled.
      const isSoftEndpoint =
        endpoint.includes('/sessions/active') ||
        endpoint.includes('/attendance/status') ||
        endpoint.includes('/tdl/connect/pending') ||
        endpoint.includes('/notifications/') ||
        endpoint.includes('/users'); // Often causes issues during initialization

      // Tracking log to help diagnose auth issues
      console.warn(`[AUTH TRACKER] 401 on ${endpoint} while on ${currentPath} (Soft Target: ${isSoftEndpoint})`);

      // Silent endpoints — never redirect on 401 (background polling)
      const isSilentEndpoint = endpoint.includes('/notifications/');

      if (onLoginPage || endpoint.includes('/auth/login')) {
        // We are already trying to log in. Don't interrupt with redirects.
        console.info('[AUTH TRACKER] 401 suppressed (Currently on login page or attempting login).');
      } else if (isSilentEndpoint) {
        // Background polling — don't redirect (user may be mid-task), but
        // clear the dead token so we stop hammering the server with it.
        // When the server nightly cron wipes cloud_user_sessions at 23:50,
        // this is what stops the APK from spamming 401s all night.
        console.warn(`[AUTH TRACKER] 401 on silent endpoint ${endpoint}. Clearing stale token.`);
        clearToken();
      } else if (isSoftEndpoint || endpoint.includes('/me')) {
        // These are background calls. If they fail, we should probably check if we need to logout.
        // Actually, if /me fails on the dashboard, it's a critical session failure.
        console.error(`[AUTH TRACKER] Session failure on ${endpoint}. Redirecting.`);
        clearToken();
        window.location.replace('/login');
      } else {
        // Critical app call failed 401. Logout immediately.
        console.error('[AUTH TRACKER] Critical 401. Redirecting to login.');
        clearToken();
        window.location.replace('/login');
      }
    }

    throw new ApiError(error.message || `HTTP ${response.status}`, response.status);
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (email: string, password: string, otp?: string, secret?: string) => {
    // 'mobile' gets the shorter 8h inactivity TTL; 'web' gets 24h.
    const device_type = (window as any).Capacitor?.isNativePlatform?.() ? 'mobile' : 'web';
    return fetchApi<{
      success: boolean;
      message: string;
      token: string;
      user: any;
      require_2fa?: boolean;
      setup_2fa?: boolean;
      secret?: string;
      otpauthUrl?: string
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, otp, secret, device_type }),
    });
  },

  checkHealth: () => fetchApi<any>('/auth/health'),

  getProfile: () => fetchApi<any>('/auth/me'),

  generate2FA: () => fetchApi<{ secret: string; otpauthUrl: string }>('/auth/2fa/generate', { method: 'POST' }),

  enable2FA: (token: string, secret: string) => fetchApi<{ success: boolean; message: string }>('/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ token, secret }),
  }),

  disable2FA: () => fetchApi<{ success: boolean; message: string }>('/auth/2fa/disable', { method: 'POST' }),

  changePassword: (currentPass: string, newPass: string, otp: string) =>
    fetchApi<{ success: boolean; message: string }>('/auth/profile/password', {
      method: 'POST',
      body: JSON.stringify({ currentPass, newPass, otp }),
    }),

  getActiveSessions: () =>
    fetchApi<{ count: number; sessions: any[] }>('/auth/sessions/active'),

  logout: () =>
    fetchApi<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  unlockSession: (otp: string) =>
    fetchApi<{ success: boolean; message: string }>('/auth/session/unlock', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    }),
};

// Servers API
export const serversApi = {
  getAll: (page: number = 1, limit: number = 50, search: string = '', filters?: any) => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (search) params.append('search', search);
    
    if (filters) {
      if (filters.company) params.append('company', filters.company);
      if (filters.status && filters.status !== 'all') params.append('status', filters.status);
      if (filters.port) params.append('port', filters.port);
      if (filters.serverIp) params.append('server_ip', filters.serverIp);
      if (filters.customerIp) params.append('customer_ip', filters.customerIp);
      if (filters.adminUser) params.append('admin_username', filters.adminUser);
      if (filters.billing_mode && filters.billing_mode !== 'all') params.append('billing_mode', filters.billing_mode);
      if (filters.billing_cycle && filters.billing_cycle !== 'all') params.append('billing_cycle', filters.billing_cycle);
      if (filters.expiry_start) params.append('expiry_start', filters.expiry_start);
      if (filters.expiry_end) params.append('expiry_end', filters.expiry_end);
    }

    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/servers?${params.toString()}`);
  },
  search: (query: string) => fetchApi<{ success: boolean; data: any[] }>(`/servers?search=${encodeURIComponent(query)}&limit=20`),
  getDropdown: () => fetchApi<{ success: boolean; data: any[] }>('/servers/dropdown'),
  getById: (id: string) => fetchApi<{ success: boolean; data: any }>(`/servers/${id}`),
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/servers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchApi<{ success: boolean; data: any }>(`/servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/servers/${id}`, {
    method: 'DELETE',
  }),
};

// Admins API - Fetches from admin table for Group dropdown
export const adminsApi = {
  getAll: (search: string = '') => fetchApi<any[]>(`/admins?search=${encodeURIComponent(search)}`),
};

// User Mapping API (admin-only)
export const userMappingApi = {
  getLegacyAdmins: () => fetchApi<{ success: boolean; data: any[] }>('/customers/mapping/legacy-admins'),
  getCloudUsers: () => fetchApi<{ success: boolean; data: any[] }>('/customers/mapping/cloud-users'),
  getCustomersByAdmin: (adminId: number, page: number = 1, limit: number = 50, search: string = '') =>
    fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(
      `/customers/mapping/by-admin/${adminId}?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`
    ),
  applyMapping: (customerIds: number[], cloudGroupId?: string, subgroupId?: string) =>
    fetchApi<{ success: boolean; updated: number; message: string }>('/customers/mapping/apply', {
      method: 'POST',
      body: JSON.stringify({ customerIds, cloudGroupId, subgroupId }),
    }),
};

// Group Change API
export const resellersApi = {
  getAll: (search: string = '') =>
    fetchApi<{ success: boolean; data: any[] }>(`/resellers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  create: (data: { name: string; mobile?: string; email?: string; pan?: string; address?: string }) =>
    fetchApi<{ success: boolean; data: any; message: string }>('/resellers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: number, data: { name?: string; mobile?: string; email?: string; pan?: string; address?: string }) =>
    fetchApi<{ success: boolean; message: string }>(`/resellers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    fetchApi<{ success: boolean; message: string }>(`/resellers/${id}`, { method: 'DELETE' }),
};

export const groupChangeApi = {
  getUsers: () => fetchApi<{ success: boolean; data: any[] }>('/group-change/users'),
  getCustomers: (userId: string) => fetchApi<{ success: boolean; data: any[] }>(`/group-change/customers?userId=${userId}`),
  transfer: (customerIds: number[], toUserId: string) =>
    fetchApi<{ success: boolean; transferred: number; message: string }>('/group-change/transfer', {
      method: 'POST',
      body: JSON.stringify({ customerIds, toUserId }),
    }),
  getResellers: () => fetchApi<{ success: boolean; data: any[] }>('/group-change/resellers'),
  transferReseller: (customerIds: number[], toResellerId: number | null) =>
    fetchApi<{ success: boolean; transferred: number; message: string }>('/group-change/transfer-reseller', {
      method: 'POST',
      body: JSON.stringify({ customerIds, toResellerId }),
    }),
  getHistory: (page: number = 1, limit: number = 50, search: string = '') =>
    fetchApi<{ success: boolean; data: any[]; total: number }>(`/group-change/history?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
};

// Customers API
export const customersApi = {
  getAll: (page: number = 1, limit: number = 50, search: string = '', status: string = 'all', mappedOnly: boolean = false, aging: string = 'all', city: string = '', pincode: string = '', group: string = '', state: string = '', date_from: string = '', date_to: string = '', last_visit_person: string = '', sortBy: string = '', sortOrder: string = '', excludePendingVisits: boolean = false, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      search,
      status,
      mapped_only: mappedOnly.toString()
    });
    if (aging !== 'all') params.append('aging', aging);
    if (city) params.append('city', city);
    if (pincode) params.append('pincode', pincode);
    if (group) params.append('group', group);
    if (state) params.append('state', state);
    if (date_from) params.append('date_from', date_from);
    if (date_to) params.append('date_to', date_to);
    if (last_visit_person) params.append('last_visit_person', last_visit_person);
    if (sortBy) params.append('sortBy', sortBy);
    if (sortOrder) params.append('sortOrder', sortOrder);
    if (excludePendingVisits) params.append('exclude_pending_visits', 'true');
    // New per-column filters (passed through as a flat map). Empty values
    // are dropped so the backend can default-skip them.
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') params.append(k, String(v));
    }
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/customers?${params.toString()}`);
  },
  search: (query: string) => fetchApi<{ success: boolean; data: any[] }>(`/customers/autocomplete?q=${encodeURIComponent(query)}`),
  searchAllLedgers: (q: string) => fetchApi<{ success: boolean; data: any[] }>(`/customers/ledger-search?q=${encodeURIComponent(q)}`),
  searchDetail: (search: string, searchType: string) =>
    fetchApi<{ success: boolean; customers: any[] }>(`/customers/search-detail?search=${encodeURIComponent(search)}&search_type=${encodeURIComponent(searchType)}`),
  createContact: (customerId: number, data: { contact_person: string; mobile_no: string; primary_contact: string }) =>
    fetchApi<{ success: boolean; data: any; message: string }>(`/customers/${customerId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateContactMapping: (customerId: number, contactId: number, data: { status?: string; primary_contact?: string }) =>
    fetchApi<{ success: boolean; message: string }>(`/customers/${customerId}/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  mapCompany: (customerId: number, targetCustomerId: number) =>
    fetchApi<{ success: boolean; message: string }>(`/customers/${customerId}/map-company`, {
      method: 'POST',
      body: JSON.stringify({ targetCustomerId }),
    }),
  getDropdown: () => fetchApi<{ success: boolean; data: any[] }>('/customers/dropdown'),
  getInactive: (opts: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: 'ASC' | 'DESC' }) => {
    const q = new URLSearchParams();
    if (opts.search) q.set('search', opts.search);
    q.set('page', String(opts.page || 1));
    q.set('limit', String(opts.limit || 50));
    if (opts.sortBy) q.set('sortBy', opts.sortBy);
    if (opts.sortOrder) q.set('sortOrder', opts.sortOrder);
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(
      `/customers/inactive?${q.toString()}`,
    );
  },
  reactivate: (id: number) =>
    fetchApi<{ success: boolean; message: string }>(`/customers/${id}/reactivate`, { method: 'POST' }),
  getHistory: (
    customerId: number,
    opts: { type: 'call' | 'visit' | 'service'; search?: string; date_from?: string; date_to?: string; page?: number; limit?: number },
  ) => {
    const q = new URLSearchParams();
    q.set('type', opts.type);
    if (opts.search) q.set('search', opts.search);
    if (opts.date_from) q.set('date_from', opts.date_from);
    if (opts.date_to) q.set('date_to', opts.date_to);
    q.set('page', String(opts.page || 1));
    q.set('limit', String(opts.limit || 20));
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(
      `/customers/${customerId}/history?${q.toString()}`,
    );
  },
  getById: (id: string) => fetchApi<{ success: boolean; data: any }>(`/customers/${id}`),
  getOpeningBills: (id: string) => fetchApi<{ success: boolean; data: { customer: any; bills: any[]; total: number } }>(`/customers/${id}/opening-bills`),
  saveOpeningBills: (id: string, bills: Array<{ bill_name: string; bill_date?: string | null; amount: number; ref_type?: 'Bill' | 'On Account' }>) =>
    fetchApi<{ success: boolean; message: string }>(`/customers/${id}/opening-bills`, {
      method: 'PUT',
      body: JSON.stringify({ bills }),
    }),
  create: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchApi<{ success: boolean; data: any }>(`/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/customers/${id}`, {
    method: 'DELETE',
  }),
  getResellers: () => fetchApi<{ success: boolean; data: any[] }>('/customers/resellers'),
};

// Visits API
export const visitsApi = {
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/visits/create', { method: 'POST', body: JSON.stringify(data) }),
  getPending: (userName: string) => fetchApi<any[]>(`/visits/pending?user_name=${encodeURIComponent(userName)}`),
  getAll: (page: number = 1, limit: number = 20, filters?: any, sortBy?: string, sortOrder?: string) => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (filters?.status) params.append('status', filters.status);
    if (filters?.user_name) params.append('user_name', filters.user_name);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (sortBy) params.append('sortBy', sortBy);
    if (sortOrder) params.append('sortOrder', sortOrder);
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/visits/all?${params.toString()}`);
  },
  pause: (id: number) => fetchApi<{ success: boolean }>('/visits/pause', { method: 'POST', body: JSON.stringify({ id }) }),
  resume: (id: number) => fetchApi<{ success: boolean }>('/visits/resume', { method: 'POST', body: JSON.stringify({ id }) }),
  complete: (data: any) => fetchApi<{ success: boolean }>('/visits/complete', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi(`/visits/${id}`, { method: 'DELETE' }),
  update: (data: any) => fetchApi<{ success: boolean }>('/visits/update', { method: 'POST', body: JSON.stringify(data) }),
  toggleForceCheckin: (id: number, allowed: boolean) => fetchApi<{ success: boolean }>('/visits/force-checkin', { method: 'POST', body: JSON.stringify({ id, allowed }) }),
  uploadRecording: async (id: number, blob: Blob, ext: string) => {
    const form = new FormData();
    form.append('recording', blob, `visit-${id}${ext}`);
    const token = getToken();
    const base = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
    const r = await fetch(`${base}/api/visits/${id}/recording`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { success: false, raw: text }; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${json?.message || text}`);
    return json as { success: boolean; path?: string };
  },
  getRecordingUrl: (id: number, recordingPath?: string) => {
    if (recordingPath) {
      const base = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      return `${base}/uploads/${recordingPath}`;
    }
    return `/api/visits/${id}/recording`;
  },
};

// Customer Calls API
export const callsApi = {
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/calls/create', { method: 'POST', body: JSON.stringify(data) }),
  getAll: (page: number = 1, limit: number = 20, filters?: any, sortBy?: string, sortOrder?: string) => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.user_name) params.append('user_name', filters.user_name);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (sortBy) params.append('sortBy', sortBy);
    if (sortOrder) params.append('sortOrder', sortOrder);
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/calls?${params.toString()}`);
  },
  getById: (id: number) => fetchApi<{ success: boolean; data: any }>(`/calls/${id}`),
};

// Mappings API
export const mappingsApi = {
  getAll: (page: number = 1, limit: number = 50, serverId?: string, search: string = '', filters?: any, sort?: any) => {
    let url = `/mappings?page=${page}&limit=${limit}`;
    if (serverId) url += `&server_id=${serverId}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    
    // Filters
    if (filters?.status) url += `&status=${filters.status}`;
    if (filters?.billing_mode) url += `&billing_mode=${filters.billing_mode}`;
    if (filters?.billing_cycle) url += `&billing_cycle=${filters.billing_cycle}`;
    if (filters?.expiry_start) url += `&expiry_start=${filters.expiry_start}`;
    if (filters?.expiry_end) url += `&expiry_end=${filters.expiry_end}`;
    if (filters?.mapped_at_start) url += `&mapped_at_start=${filters.mapped_at_start}`;
    if (filters?.mapped_at_end) url += `&mapped_at_end=${filters.mapped_at_end}`;
    if (filters?.company) url += `&company=${encodeURIComponent(filters.company)}`;
    if (filters?.customer_ip) url += `&customer_ip=${encodeURIComponent(filters.customer_ip)}`;
    if (filters?.serial_no) url += `&serial_no=${encodeURIComponent(filters.serial_no)}`;
    if (filters?.min_rate) url += `&min_rate=${filters.min_rate}`;
    if (filters?.max_rate) url += `&max_rate=${filters.max_rate}`;

    // Sort
    if (sort?.field) {
      url += `&sortBy=${sort.field}`;
      if (sort.dir) url += `&sortDir=${sort.dir}`;
    }

    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(url);
  },
  getById: (id: string) => fetchApi<{ success: boolean; data: any }>(`/mappings/${id}`),
  getByCustomer: (customerId: string) => fetchApi<{ success: boolean; data: any }>(`/mappings/customer/${customerId}`),
  getAllByCustomer: (customerId: string) => fetchApi<{ success: boolean; data: any[] }>(`/mappings/customer/${customerId}/all`),
  getByServer: (serverId: string) => fetchApi<{ success: boolean; data: any[] }>(`/mappings?server_id=${serverId}`),
  getUnmapped: () => fetchApi<{ success: boolean; data: any[] }>('/mappings/unmapped-customers'),
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/mappings', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchApi<{ success: boolean; data: any }>(`/mappings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/mappings/${id}`, {
    method: 'DELETE',
  }),
};

// Activities API
export const activitiesApi = {
  getAll: (filters?: any, page: number = 1, limit: number = 50, search: string = '') => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (search) params.append('search', search);
    if (filters?.activity_type) params.append('activity_type', filters.activity_type);
    if (filters?.bill_type) params.append('bill_type', filters.bill_type);
    if (filters?.customer_id) params.append('customer_id', filters.customer_id);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);
    if (filters?.record_nature) params.append('record_nature', filters.record_nature);
    if (filters?.server_name) params.append('server_name', filters.server_name);
    if (filters?.billing_cycle) params.append('billing_cycle', filters.billing_cycle);
    if (filters?.billing_mode) params.append('billing_mode', filters.billing_mode);
    if (filters?.min_amount !== undefined && filters?.min_amount !== '') params.append('min_amount', filters.min_amount.toString());
    if (filters?.max_amount !== undefined && filters?.max_amount !== '') params.append('max_amount', filters.max_amount.toString());
    return fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/activities?${params.toString()}`);
  },
  getById: (id: string) => fetchApi<{ success: boolean; data: any }>(`/activities/${id}`),
  getByCustomer: (customerId: string) => fetchApi<{ success: boolean; data: any[] }>(`/activities/customer/${customerId}`),
  getStats: (filters?: any, search: string = '') => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (filters?.activity_type) params.append('activity_type', filters.activity_type);
    if (filters?.bill_type) params.append('bill_type', filters.bill_type);
    if (filters?.customer_id) params.append('customer_id', filters.customer_id);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);
    if (filters?.record_nature) params.append('record_nature', filters.record_nature);
    if (filters?.server_name) params.append('server_name', filters.server_name);
    if (filters?.billing_cycle) params.append('billing_cycle', filters.billing_cycle);
    if (filters?.billing_mode) params.append('billing_mode', filters.billing_mode);
    if (filters?.min_amount !== undefined && filters?.min_amount !== '') params.append('min_amount', filters.min_amount.toString());
    if (filters?.max_amount !== undefined && filters?.max_amount !== '') params.append('max_amount', filters.max_amount.toString());
    return fetchApi<{ success: boolean; data: {
      new: { count: number; units_total: number; amount_total: number };
      renewal: { count: number; units_total: number; amount_total: number };
      user_increase: { count: number; units_total: number; amount_total: number };
      user_decrease: { count: number; units_total: number; amount_total: number };
    } }>(`/activities/stats?${params.toString()}`);
  },
  getRevenueSummary: () => fetchApi<{ success: boolean; data: any }>('/activities/revenue'),
  getRenewalDefaults: (id: string, type: 'customer' | 'server', serverName?: string) => fetchApi<{ success: boolean; data: any }>(`/activities/renewal-defaults?id=${id}&type=${type}${serverName ? `&server_name=${encodeURIComponent(serverName)}` : ''}`),
  // New calculation endpoint - moves calculations to backend
  calculate: (data: {
    activity_type: 'New' | 'Renewal' | 'User';
    bill_type: 'Tax Invoice' | 'Credit Note';
    billing_units: number;
    purchase_units?: number;
    last_bill_rate: number;
    purchase_rate?: number;
    billing_cycle: 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';
    activity_date?: string;
    start_from?: string;
    new_expiry_date?: string;
    customer_id?: string;
    billing_mode?: 'day_to_day' | 'month_to_month';
    custom_period?: boolean;
    purchase_billing_mode?: 'day_to_day' | 'month_to_month';
    purchase_cycle?: string;
    purchase_start_from?: string;
    purchase_expiry?: string;
  }) => fetchApi<{
    success: boolean;
    data: {
      bill_amount: number;
      purchase_amount: number;
      date_diff_months: number;
      date_diff_days: number;
      date_diff_label: string;
      purchase_date_diff_months: number;
      purchase_date_diff_days: number;
      purchase_date_diff_label: string;
      new_expiry_date: string | null;
      formula_breakdown: string;
    }
  }>('/activities/calculate', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getTotalUsers: (customerId: string) => fetchApi<{ success: boolean; data: { total_users: number } }>(`/activities/customer/${customerId}/total-users`),
  getLastExpiry: (customerId: string) => fetchApi<{ success: boolean; data: { last_expiry_date: string | null } }>(`/activities/customer/${customerId}/last-expiry`),
  getPendingByCustomer: (customerId: string) => fetchApi<{ success: boolean; data: any[] }>(`/activities/customer/${customerId}/pending`),
  getPendingPurchaseByCustomer: (customerId: string) => fetchApi<{ success: boolean; data: any[] }>(`/activities/customer/${customerId}/pending-purchase`),
  markBilled: (activityIds: string[], opts: { voucherId?: number; voucherNo?: string }) => fetchApi<{ success: boolean; updated: number }>('/activities/mark-billed', {
    method: 'POST',
    body: JSON.stringify({ activity_ids: activityIds, voucher_id: opts.voucherId, voucher_no: opts.voucherNo }),
  }),

  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/activities', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchApi<{ success: boolean; data: any }>(`/activities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/activities/${id}`, {
    method: 'DELETE',
  }),
  // Bulk generate activities for selected servers (P.U - Purchase Units)
  generateForServers: (serverIds: string[], purchaseRate?: number) =>
    fetchApi<{
      success: boolean;
      data: {
        created: any[];
        skipped: { server_id: string; reason: string }[];
      };
      message: string;
    }>('/activities/generate-for-servers', {
      method: 'POST',
      body: JSON.stringify({ server_ids: serverIds, purchase_rate: purchaseRate }),
    }),
  // Bulk generate renewal activities for selected customers (B.U - Billing Units)
  bulkCustomerRenewal: (customerIds: string[], activityDate?: string) =>
    fetchApi<{
      success: boolean;
      data: {
        created: any[];
        skipped: { customer_id: string; customer_name: string; reason: string }[];
      };
      message: string;
    }>('/activities/bulk-customer-renewal', {
      method: 'POST',
      body: JSON.stringify({ customer_ids: customerIds, activity_date: activityDate }),
    }),
};

// Users API
export const usersApi = {
  getBasic: () => fetchApi<{ success: boolean; data: any[] }>('/users/basic'),
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/users'),
  getById: (id: string) => fetchApi<{ success: boolean; data: any }>(`/users/${id}`),
  create: (data: any) => fetchApi<{ success: boolean; data: any }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: any) => fetchApi<{ success: boolean; data: any }>(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  updatePassword: (id: string, password: string) => fetchApi<{ success: boolean }>(`/users/${id}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  }),
  updatePermissions: (id: string, permissions: any) => fetchApi<{ success: boolean; data: any }>(`/users/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  }),
  updateColumnPermissions: (id: string, column_permissions: any) => fetchApi<{ success: boolean; data: any }>(`/users/${id}/column-permissions`, {
    method: 'PUT',
    body: JSON.stringify({ column_permissions }),
  }),
  getNetwork: () => fetchApi<{ success: boolean; data: any[] }>('/users/network'),
  updateLocation: (lat: number, lng: number) => fetchApi<{ success: boolean }>('/users/location', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  }),
  reset2FA: (id: string) => fetchApi<{ success: boolean }>(`/users/${id}/2fa/reset`, {
    method: 'POST',
  }),
  generate2FA: (id: string) =>
    fetchApi<{ secret: string; otpauthUrl: string }>(`/users/${id}/2fa/generate`, {
      method: 'POST',
    }),
  enable2FA: (id: string, secret: string, token: string) =>
    fetchApi<{ success: boolean }>(`/users/${id}/2fa/enable`, {
      method: 'POST',
      body: JSON.stringify({ secret, token }),
    }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/users/${id}`, {
    method: 'DELETE',
  }),
  getLocationHistory: (id: string, date: string) => fetchApi<{ success: boolean; data: any[] }>(`/users/${id}/location-history?date=${date}`),
};

// Dashboard API
export const dashboardApi = {
  getStats: () => fetchApi<{ success: boolean; data: any }>('/dashboard/stats'),
  getOperationsSnapshot: () => fetchApi<{ success: boolean; data: {
    expiry: {
      old:        { our: { silver: number; gold: number; auditor: number; total: number }; other: { silver: number; gold: number; auditor: number; total: number } };
      this_month: { our: { silver: number; gold: number; auditor: number; total: number }; other: { silver: number; gold: number; auditor: number; total: number } };
      future:     { our: { silver: number; gold: number; auditor: number; total: number }; other: { silver: number; gold: number; auditor: number; total: number } };
    };
    movement: {
      onboard_new:        { silver: number; gold: number; auditor: number; total: number };
      onboard_from_other: { silver: number; gold: number; auditor: number; total: number };
      left:               { silver: number; gold: number; auditor: number; total: number };
    };
  } }>('/dashboard/operations-snapshot'),
  myPerformance: (user?: string, fy?: string) => {
    const q = new URLSearchParams();
    if (user) q.set('user', user);
    if (fy) q.set('fy', fy);
    return fetchApi<any>(`/dashboard/my-performance?${q.toString()}`);
  },
  getPendingUsers: () => fetchApi<any>('/dashboard/pending-users'),
  getPendingDetail: (type: string, user: string) =>
    fetchApi<any>(`/dashboard/pending-detail?type=${encodeURIComponent(type)}&user=${encodeURIComponent(user)}`),
  adminPerformance: (fy?: string) => {
    const q = new URLSearchParams();
    if (fy) q.set('fy', fy);
    return fetchApi<any>(`/dashboard/admin-performance${q.toString() ? `?${q.toString()}` : ''}`);
  },
};

// TDL API
export const tdlApi = {
  getAllCustomizations: () => fetchApi<any[]>('/tdl/customizations'),
  getCustomizationById: (id: string) => fetchApi<any>(`/tdl/customizations/${id}`),
  lookupByToken: (token: string) => fetchApi<any>(`/tdl/lookup/${token}`),
  getTaskHistory: (taskId: number) => fetchApi<any[]>(`/tdl/tasks/${taskId}/history`),
  manageTasks: (reqId: number | string | null, tasks: any[]) => fetchApi<any>(`/tdl/requirements/${reqId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(tasks),
  }),
  getConnectPending: (userName: string) => fetchApi<any[]>(`/tdl/connect/pending?user_name=${encodeURIComponent(userName)}`),
  deleteTask: (taskId: number) => fetchApi(`/tdl/tasks/${taskId}`, { method: 'DELETE' }),
  addTaskUpdate: (taskId: number, data: { remark?: string; status?: string; next_date?: string }) =>
    fetchApi<any>(`/tdl/tasks/${taskId}/update`, { method: 'PUT', body: JSON.stringify(data) }),
  getTaskUpdates: (taskId: number) => fetchApi<any>(`/tdl/tasks/${taskId}/updates`),
};

// Pincode API
export const statesApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/states'),
};

export const pincodeApi = {
  getAll: (page: number = 1, limit: number = 50, search: string = '') => fetchApi<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(`/pincodes?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
  lookup: (code: string) => fetchApi<{ city: string; state: string }>(`/pincodes/lookup/${code}`),
  create: (data: any) => fetchApi<any>('/pincodes', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: number, data: any) => fetchApi<any>(`/pincodes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: number) => fetchApi<{ success: boolean }>(`/pincodes/${id}`, {
    method: 'DELETE',
  }),
};

// Service Calls API
export const serviceCallsApi = {
  getAll: (status?: string, search?: string, startDate?: string, endDate?: string, staff?: string, entryType?: string) => {
    let url = `/service-calls?status=${status || 'all'}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    if (staff) url += `&staff=${encodeURIComponent(staff)}`;
    if (entryType) url += `&entryType=${encodeURIComponent(entryType)}`;
    return fetchApi<{ success: boolean; data: any[]; total: number }>(url);
  },
  getStats: (startDate?: string, endDate?: string, staff?: string, entryType?: string) => {
    let url = '/service-calls/stats';
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (staff) params.append('staff', staff);
    if (entryType) params.append('entryType', entryType);

    if (params.toString()) url += `?${params.toString()}`;
    return fetchApi<{ success: boolean; data: { total: number; open: number; pending: number; closed: number; cancelled: number; my_pending: number; my_completed: number; my_cancelled: number } }>(url);
  },
  getFlavors: () => fetchApi<{ success: boolean; data: { id: number; name: string }[] }>('/service-calls/flavors'),
  lookupContact: (mobile: string) => fetchApi<{ success: boolean; found: boolean; contact: { id: number; contact_person: string; mobile_no: string } | null }>(`/service-calls/lookup/${mobile}`),
  lookupTallySerial: (serial: string) => fetchApi<{ success: boolean; data: { customer_id: number; customer_name: string; flavor: string; flavor_name: string; expire_date: string } }>(`/service-calls/lookup-tally/${serial}`),
  create: (data: {
    mobile_no: string;
    contact_person?: string;
    service_type?: string;
    remark?: string;
    assign_to?: string;
    flavor?: string;
    customer_id?: string | number;
    serial_number?: string;
    expire_date?: string;
    entry_type?: string;
    lead_type?: string;
  }) => fetchApi<{ success: boolean; data: any; message: string }>('/service-calls', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  take: (id: number) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/take`, {
    method: 'PUT',
    body: JSON.stringify({}),
  }),
  transfer: (id: number, assign_to: string) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/transfer`, {
    method: 'PUT',
    body: JSON.stringify({ assign_to }),
  }),
  confirm: (id: number, satisfaction_rating?: number) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/confirm`, {
    method: 'PUT',
    body: JSON.stringify({ satisfaction_rating }),
  }),
  reopen: (id: number, assignTo?: string) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/reopen`, {
    method: 'PUT',
    body: JSON.stringify({ assign_to: assignTo || null }),
  }),
  cancel: (id: number) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/cancel`, {
    method: 'PUT',
    body: JSON.stringify({}),
  }),
  getReportsUserWise: (startDate?: string, endDate?: string) => {
    let url = '/service-calls/reports/user-wise';
    const q: string[] = [];
    if (startDate) q.push(`startDate=${startDate}`);
    if (endDate) q.push(`endDate=${endDate}`);
    if (q.length > 0) url += `?${q.join('&')}`;
    return fetchApi<{ success: boolean; data: any[] }>(url);
  },
  getReportsDelays: (startDate?: string, endDate?: string) => {
    let url = '/service-calls/reports/delays';
    const q: string[] = [];
    if (startDate) q.push(`startDate=${startDate}`);
    if (endDate) q.push(`endDate=${endDate}`);
    if (q.length > 0) url += `?${q.join('&')}`;
    return fetchApi<{ success: boolean; data: any[] }>(url);
  },
  close: (id: number, data: {
    customer_id?: string | number;
    contact_person?: string;
    serial_number?: string;
    service_type?: string;
    remark?: string;
    expire_date?: string;
    flavor?: string;
    resolution_note?: string;
    assigned_developer?: string;
  }) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/close`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  join: (id: number, data: {
    customer_id?: number | null; contact_person?: string; serial_number?: string;
    service_type?: string; remark?: string; expire_date?: string; flavor?: string;
    assigned_developer?: string;
  }) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/join`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  getNotes: (id: number) => fetchApi<{ success: boolean; data: any[] }>(`/service-calls/${id}/notes`),
  addNote: (id: number, data: { note_type: string; content: string; assigned_to?: string; deadline?: string; next_update_date?: string }) => fetchApi<{ success: boolean; message: string }>(`/service-calls/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getMyCorrections: () => fetchApi<{ success: boolean; data: any[] }>('/service-calls/my-corrections'),
  updateNoteStatus: (noteId: number, status: string) => fetchApi<{ success: boolean; message: string }>(`/service-calls/notes/${noteId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }),
};

// Billing API
export const billingApi = {
  // Bills
  createBill: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/billing/bills', { method: 'POST', body: JSON.stringify(data) }),
  getBills: (params: { bill_type?: string; bill_status?: string; pay_status?: string; search?: string; startDate?: string; endDate?: string; reseller?: boolean; no_follow?: boolean; today?: boolean; after_today?: boolean }) => {
    const q = new URLSearchParams();
    if (params.bill_type) q.append('bill_type', params.bill_type);
    if (params.bill_status) q.append('bill_status', params.bill_status);
    if (params.pay_status) q.append('pay_status', params.pay_status);
    if (params.search) q.append('search', params.search);
    if (params.startDate) q.append('startDate', params.startDate);
    if (params.endDate) q.append('endDate', params.endDate);
    if (params.reseller) q.append('reseller', 'true');
    if (params.no_follow) q.append('no_follow', 'true');
    if (params.today) q.append('today', 'true');
    if (params.after_today) q.append('after_today', 'true');
    return fetchApi<{ success: boolean; data: any[] }>(`/billing/bills?${q.toString()}`);
  },
  getBill: (id: number) => fetchApi<{ success: boolean; data: any }>(`/billing/bills/${id}`),
  updateBill: (id: number, data: any) => fetchApi<{ success: boolean; message: string }>(`/billing/bills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateBillStatus: (id: number, data: any) => fetchApi<{ success: boolean; message: string }>(`/billing/bills/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),
  incrementFollowup: (id: number) => fetchApi<{ success: boolean; message: string }>(`/billing/bills/${id}/followup`, { method: 'PUT', body: JSON.stringify({}) }),
  // Payments
  addPayment: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/billing/payments', { method: 'POST', body: JSON.stringify(data) }),
  getPayments: (params: { status?: string; search?: string; startDate?: string; endDate?: string; payment_complete?: string }) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    if (params.search) q.append('search', params.search);
    if (params.startDate) q.append('startDate', params.startDate);
    if (params.endDate) q.append('endDate', params.endDate);
    if (params.payment_complete) q.append('payment_complete', params.payment_complete);
    return fetchApi<{ success: boolean; data: any[] }>(`/billing/payments?${q.toString()}`);
  },
  updatePayment: (id: number, data: any) => fetchApi<{ success: boolean; message: string }>(`/billing/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Lookups
  getBillingCompanies: () => fetchApi<{ success: boolean; data: any[] }>('/billing/billing-companies'),
  getBillingCompanyItems: (companyId: number) => fetchApi<{ success: boolean; data: any[] }>(`/billing/billing-companies/${companyId}/items`),
  getProducts: () => fetchApi<{ success: boolean; data: any[] }>('/billing/products'),
  getTallyItemTypes: () => fetchApi<{ success: boolean; data: any[] }>('/billing/tally-item-types'),
};

export const ledgerGroupApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/ledger-groups'),
  create: (data: { name: string; parent_id?: number | null }) => fetchApi<{ success: boolean; data: any; message: string }>('/ledger-groups', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; parent_id?: number | null }) => fetchApi<{ success: boolean; message: string }>(`/ledger-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi<{ success: boolean; message: string }>(`/ledger-groups/${id}`, { method: 'DELETE' }),
};

export const vchTypeApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/vchtypes'),
  create: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/vchtypes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => fetchApi<{ success: boolean; message: string }>(`/vchtypes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi<{ success: boolean; message: string }>(`/vchtypes/${id}`, { method: 'DELETE' }),
};

export const otherLedgerApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/other-ledgers'),
  create: (data: { company: string; ledgergroup: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) => fetchApi<{ success: boolean; data: any; message: string }>('/other-ledgers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { company?: string; ledgergroup?: number; opening_balance?: number; opening_balance_type?: string; billbybill?: string }) => fetchApi<{ success: boolean; message: string }>(`/other-ledgers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi<{ success: boolean; message: string }>(`/other-ledgers/${id}`, { method: 'DELETE' }),
};

export const itemsApi = {
  getAll: () => fetchApi<{ success: boolean; data: any[] }>('/items'),
  getFlavours: () => fetchApi<{ success: boolean; data: { id: number; name: string }[] }>('/items/flavours'),
  create: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/items', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => fetchApi<{ success: boolean; message: string }>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => fetchApi<{ success: boolean; message: string }>(`/items/${id}`, { method: 'DELETE' }),
  getCategories: () => fetchApi<{ success: boolean; data: any[] }>('/items/categories'),
  createCategory: (name: string, parent_id?: number | null, target_unit?: string) => fetchApi<{ success: boolean; data: any }>('/items/categories', { method: 'POST', body: JSON.stringify({ name, parent_id, target_unit }) }),
  updateCategory: (id: number, name: string, parent_id?: number | null, target_unit?: string) => fetchApi<{ success: boolean }>(`/items/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name, parent_id, target_unit }) }),
  deleteCategory: (id: number) => fetchApi<{ success: boolean }>(`/items/categories/${id}`, { method: 'DELETE' }),
  getOpeningBatches: (id: number) => fetchApi<{ success: boolean; data: any[] }>(`/items/${id}/opening-batches`),
  saveOpeningBatches: (id: number, batches: any[]) => fetchApi<{ success: boolean }>(`/items/${id}/opening-batches`, { method: 'POST', body: JSON.stringify({ batches }) }),
  getGroups: () => fetchApi<{ success: boolean; data: any[] }>('/items/groups'),
  createGroup: (name: string, parent_id?: number | null) => fetchApi<{ success: boolean; data: any }>('/items/groups', { method: 'POST', body: JSON.stringify({ name, parent_id }) }),
  updateGroup: (id: number, name: string, parent_id?: number | null) => fetchApi<{ success: boolean }>(`/items/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name, parent_id }) }),
  deleteGroup: (id: number) => fetchApi<{ success: boolean }>(`/items/groups/${id}`, { method: 'DELETE' }),
};

export const vouchersApi = {
  create: (data: any) => fetchApi<{ success: boolean; data: any; message: string }>('/vouchers', { method: 'POST', body: JSON.stringify(data) }),
  getPendingRefs: (customerId: number, direction?: 'Dr' | 'Cr', excludeVchId?: number) =>
    fetchApi<{ success: boolean; data: { billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[] }>(`/vouchers/pending-refs?customer_id=${customerId}${direction ? `&direction=${direction}` : ''}${excludeVchId ? `&exclude_vch_id=${excludeVchId}` : ''}`),
  getSerials: (customerId: number, flavourId?: number) =>
    fetchApi<{ success: boolean; data: string[] }>(`/vouchers/serials?customer_id=${customerId}${flavourId ? `&flavour_id=${flavourId}` : ''}`),
  getAll: (params: { page?: number; limit?: number; vch_type?: string; search?: string; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params.page) q.append('page', String(params.page));
    if (params.limit) q.append('limit', String(params.limit));
    if (params.vch_type) q.append('vch_type', params.vch_type);
    if (params.search) q.append('search', params.search);
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to) q.append('date_to', params.date_to);
    return fetchApi<{ success: boolean; data: any[]; total: number }>(`/vouchers?${q.toString()}`);
  },
  getById: (id: number) => fetchApi<{ success: boolean; data: any }>(`/vouchers/${id}`),
  getDaybook: (params: string | { date?: string; date_from?: string; date_to?: string }) => {
    // Backwards-compatible: a string still means single-date.
    if (typeof params === 'string') {
      return fetchApi<{ success: boolean; data: any[] }>(`/vouchers/daybook?date=${params}`);
    }
    const q = new URLSearchParams();
    if (params.date)      q.append('date', params.date);
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    return fetchApi<{ success: boolean; data: any[] }>(`/vouchers/daybook?${q.toString()}`);
  },
  getLedger: (params: { ledger_id: number; date_from?: string; date_to?: string; search?: string }) => {
    const q = new URLSearchParams();
    q.append('ledger_id', String(params.ledger_id));
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.search)    q.append('search', params.search);
    return fetchApi<{
      success: boolean;
      data: {
        ledger: { id: number; company: string } | null;
        opening: number;
        closing: number;
        totalDebit: number;
        totalCredit: number;
        rows: any[];
      };
    }>(`/vouchers/ledger?${q.toString()}`);
  },
  getSalesRegister: (params: { date_from?: string; date_to?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.search)    q.append('search', params.search);
    return fetchApi<{ success: boolean; data: { rows: any[]; totals: any } }>(`/vouchers/sales-register?${q.toString()}`);
  },
  getSalesRegisterMonthly: (params: { date_from?: string; date_to?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    return fetchApi<{ success: boolean; data: { rows: any[]; totals: any } }>(`/vouchers/sales-register/monthly?${q.toString()}`);
  },
  getGroupSummary: (params: { date_from?: string; date_to?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.search)    q.append('search', params.search);
    return fetchApi<{ success: boolean; data: { rows: any[]; totals: any } }>(`/vouchers/group-summary?${q.toString()}`);
  },
  getGroupLedgers: (groupId: number, params: { date_from?: string; date_to?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.search)    q.append('search', params.search);
    return fetchApi<{ success: boolean; data: { group: { id: number; name: string }; rows: any[]; totals: any } }>(`/vouchers/group-summary/${groupId}/ledgers?${q.toString()}`);
  },
  getUserWiseOutstanding: (params: { as_of?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.as_of) q.append('as_of', params.as_of);
    if (params.search) q.append('search', params.search);
    return fetchApi<{ success: boolean; data: { rows: any[]; totals: any; asOf: string | null } }>(`/vouchers/user-wise-outstanding?${q.toString()}`);
  },
  getStockSummary: (params: { date_from?: string; date_to?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.search)    q.append('search', params.search);
    return fetchApi<{ success: boolean; data: { rows: any[]; totals: any } }>(`/vouchers/stock-summary?${q.toString()}`);
  },
  getOutstanding: (params: {
    as_of?: string;
    date_from?: string;
    date_to?: string;
    bill_name?: string;
    search?: string;
    side?: 'receivable' | 'payable' | 'all';
  } = {}) => {
    const q = new URLSearchParams();
    if (params.as_of)     q.append('as_of', params.as_of);
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to)   q.append('date_to', params.date_to);
    if (params.bill_name) q.append('bill_name', params.bill_name);
    if (params.search)    q.append('search', params.search);
    if (params.side)      q.append('side', params.side);
    return fetchApi<{ success: boolean; data: { bills: any[]; totalReceivable: number; totalPayable: number; asOf: string | null } }>(`/vouchers/outstanding?${q.toString()}`);
  },
  deleteVoucher: (id: number) => fetchApi<{ success: boolean }>(`/vouchers/${id}`, { method: 'DELETE' }),
  update: (id: number, data: any) => fetchApi<{ success: boolean; data: any; message: string }>(`/vouchers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getNextNo: (vchTypeId: number, forDate?: string) => fetchApi<{ success: boolean; data: string }>(`/vouchers/next-no?vch_type_id=${vchTypeId}${forDate ? `&for_date=${forDate}` : ''}`),
  markChecked:   (id: number) => fetchApi<{ success: boolean; message: string }>(`/vouchers/${id}/check`,   { method: 'POST' }),
  markUnchecked: (id: number) => fetchApi<{ success: boolean; message: string }>(`/vouchers/${id}/uncheck`, { method: 'POST' }),
};

export const attendanceApi = {
  checkIn: (lat: number, lng: number) => fetchApi<{ success: boolean; message: string; office: string }>('/attendance/checkin', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  }),
  checkOut: (lat: number, lng: number) => fetchApi<{ success: boolean; message: string }>('/attendance/checkout', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  }),
  getStatus: () => fetchApi<{ status: string; checkin?: string; checkout?: string }>('/attendance/status'),
  getDailyReport: (date: string) => fetchApi<any[]>(`/attendance/report?date=${date}`),
  getUserHistory: (userId: string, from: string, to: string) => fetchApi<any[]>(`/attendance/history/${userId}?from=${from}&to=${to}`),
  forceCheckIn: (data: any) => fetchApi<{ success: boolean; message: string }>('/attendance/force-checkin', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  forceCheckOut: (data: any) => fetchApi<{ success: boolean; message: string }>('/attendance/force-checkout', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getHolidays: () => fetchApi<any[]>('/attendance/holidays'),
  addHoliday: (date: string, description: string) => fetchApi<{ success: boolean; message: string }>('/attendance/holidays', {
    method: 'POST',
    body: JSON.stringify({ date, description }),
  }),
  bulkAddHolidays: (holidays: { date: string; description: string }[]) => fetchApi<{ success: boolean; message: string }>('/attendance/holidays/bulk', {
    method: 'POST',
    body: JSON.stringify({ holidays }),
  }),
  removeHoliday: (date: string) => fetchApi<{ success: boolean; message: string }>('/attendance/holidays/remove', {
    method: 'POST',
    body: JSON.stringify({ date }),
  }),
  getMyMonthlyStats: (month: number, year: number) => fetchApi<any>(`/attendance/my-monthly-stats?month=${month}&year=${year}`),
  getMonthlyExport: (month: number, year: number) => fetchApi<any>(`/attendance/monthly-export?month=${month}&year=${year}`),
};

export const tallyApi = {
  getExpiryReport: (params: {
    customer_type?: 'our' | 'not_our';
    expiry_status?: string;
    search?: string;
    page?: number;
    limit?: number;
    date_from?: string;
    date_to?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.customer_type) q.append('customer_type', params.customer_type);
    if (params.expiry_status) q.append('expiry_status', params.expiry_status);
    if (params.search) q.append('search', params.search);
    if (params.page) q.append('page', params.page.toString());
    if (params.limit) q.append('limit', params.limit.toString());
    if (params.date_from) q.append('date_from', params.date_from);
    if (params.date_to) q.append('date_to', params.date_to);
    return fetchApi<{
      data: any[];
      total: number;
      allCount: number;
      statusCounts: Record<string, number>;
      page: number;
      limit: number;
    }>(`/tally/expiry-report?${q.toString()}`);

  },
  updateRenewalCall: (data: any) => fetchApi<{ success: boolean }>('/tally/renewal-call', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  upsertDetail: (data: any) => fetchApi<{ success: boolean }>('/tally/upsert-detail', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  syncSerial: (serial: string) => fetchApi<{ success: boolean; data?: any; message?: string }>('/tally/sync-serial', {
    method: 'POST',
    body: JSON.stringify({ serial }),
  }),
};

const api = {
  auth: authApi,
  servers: serversApi,
  customers: customersApi,
  mappings: mappingsApi,
  activities: activitiesApi,
  users: usersApi,
  dashboard: dashboardApi,
  tdl: tdlApi,
  attendance: attendanceApi,
  // methods directly on default export for backward compat if any? 
  get: (url: string) => fetchApi(url),
  post: (url: string, data: any) => fetchApi(url, { method: 'POST', body: JSON.stringify(data) }),
  put: (url: string, data: any) => fetchApi(url, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (url: string) => fetchApi(url, { method: 'DELETE' }),
};

// ── Lead Requirements API ──
export const leadRequirementsApi = {
  getLeadDetail: (id: number) =>
    fetchApi<any>(`/lead-requirements/lead/${id}`),
  getRequirements: (leadId: number, status?: string) =>
    fetchApi<any>(`/lead-requirements/lead/${leadId}/requirements${status ? `?status=${status}` : ''}`),
  addRequirement: (leadId: number, data: { description: string; assigned_to?: string; priority?: string; deadline?: string; amount?: number }) =>
    fetchApi<any>(`/lead-requirements/lead/${leadId}/requirements`, { method: 'POST', body: JSON.stringify(data) }),
  updateRequirement: (reqId: number, data: { status?: string; stage?: string; remark?: string; next_followup_date?: string }) =>
    fetchApi<any>(`/lead-requirements/requirements/${reqId}`, { method: 'PUT', body: JSON.stringify(data) }),
  completeRequirement: (reqId: number, data: { remark?: string; action: string; transfer_to?: string }) =>
    fetchApi<any>(`/lead-requirements/requirements/${reqId}/complete`, { method: 'PUT', body: JSON.stringify(data) }),
  transferRequirement: (reqId: number, data: { transfer_to: string; remark?: string }) =>
    fetchApi<any>(`/lead-requirements/requirements/${reqId}/transfer`, { method: 'PUT', body: JSON.stringify(data) }),
  updateRequirementStatus: (reqId: number, status: string) =>
    fetchApi<any>(`/lead-requirements/requirements/${reqId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  getRequirementUpdates: (reqId: number) =>
    fetchApi<any>(`/lead-requirements/requirements/${reqId}/updates`),
  getFollowups: (leadId: number) =>
    fetchApi<any>(`/lead-requirements/lead/${leadId}/followups`),
  addFollowup: (leadId: number, data: { content: string; followup_date?: string }) =>
    fetchApi<any>(`/lead-requirements/lead/${leadId}/followups`, { method: 'POST', body: JSON.stringify(data) }),
  markFollowupDone: (followupId: number) =>
    fetchApi<any>(`/lead-requirements/followups/${followupId}/done`, { method: 'PUT' }),
  getMyRequirements: () =>
    fetchApi<any>('/lead-requirements/my-requirements'),
  getRequirementsReport: (params: { search?: string; staff?: string; status?: string; priority?: string; startDate?: string; endDate?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, String(v)); });
    return fetchApi<any>(`/lead-requirements/report/requirements?${q.toString()}`);
  },
  getCorrectionReport: (params: { search?: string; staff?: string; updateType?: string; startDate?: string; endDate?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, String(v)); });
    return fetchApi<any>(`/lead-requirements/report/corrections?${q.toString()}`);
  },
};

// Targets API
export const targetsApi = {
  get: (fy?: string, user?: string) => {
    const q = new URLSearchParams();
    if (fy) q.set('fy', fy);
    if (user) q.set('user', user);
    return fetchApi<any>(`/targets?${q.toString()}`);
  },
  save: (fy: string, rows: any[]) =>
    fetchApi<any>('/targets/save', { method: 'POST', body: JSON.stringify({ fy, rows }) }),
  adminCreate: (user_name: string, fy: string, rows: any[]) =>
    fetchApi<any>('/targets/admin', { method: 'POST', body: JSON.stringify({ user_name, fy, rows }) }),
  adminUpdate: (id: number, data: any) =>
    fetchApi<any>(`/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  approveAll: (user_name: string, fy: string) =>
    fetchApi<any>('/targets/approve-all', { method: 'POST', body: JSON.stringify({ user_name, fy }) }),
  delete: (id: number) =>
    fetchApi<any>(`/targets/${id}`, { method: 'DELETE' }),
  pendingCount: () =>
    fetchApi<any>('/targets/pending-count'),
  getUnitTypes: (fy?: string, user?: string) => {
    const q = new URLSearchParams();
    if (fy) q.set('fy', fy);
    if (user) q.set('user', user);
    return fetchApi<any>(`/targets/unit-types?${q.toString()}`);
  },
  saveUnitTypes: (user_name: string, fy: string, types: Record<string, string>) =>
    fetchApi<any>('/targets/unit-types', { method: 'POST', body: JSON.stringify({ user_name, fy, types }) }),
};

// TDL Expiry API
export const tdlBillingApi = {
  getAll: (page = 1, limit = 25, search = '') =>
    fetchApi<any>(`/tdl-billing?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
  getCustomers: (search = '') =>
    fetchApi<any>(`/tdl-billing/customers?search=${encodeURIComponent(search)}`),
  getTdlsByCustomer: (customerName: string) =>
    fetchApi<any>(`/tdl-billing/tdls/${encodeURIComponent(customerName)}`),
  prepare: (tdlExpiryId: number, cycle: string, startDate?: string) =>
    fetchApi<any>(`/tdl-billing/prepare/${tdlExpiryId}?cycle=${cycle}${startDate ? `&startDate=${startDate}` : ''}`),
  create: (data: any) =>
    fetchApi<any>('/tdl-billing', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    fetchApi<any>(`/tdl-billing/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetchApi<any>(`/tdl-billing/${id}`, { method: 'DELETE' }),
};

export const serverMonitorApi = {
  getAll: (search = '') => fetchApi<any>(`/server-monitor?search=${encodeURIComponent(search)}`),
  getStatuses: () => fetchApi<{ success: boolean; data: Record<string, 'up' | 'down' | 'unknown'> }>('/server-monitor/statuses'),
  getLogs: (ip: string, limit = 50) => fetchApi<any>(`/server-monitor/${encodeURIComponent(ip)}/logs?limit=${limit}`),
  sync: () => fetchApi<any>('/server-monitor/sync', { method: 'POST' }),
  checkNow: () => fetchApi<any>('/server-monitor/check-now', { method: 'POST' }),
  checkSingle: (ip: string) => fetchApi<any>(`/server-monitor/${encodeURIComponent(ip)}/check`, { method: 'POST' }),
  updatePort: (ip: string, port: number) => fetchApi<any>(`/server-monitor/${encodeURIComponent(ip)}/port`, { method: 'PATCH', body: JSON.stringify({ port }) }),
  setActive: (ip: string, isActive: boolean) => fetchApi<any>(`/server-monitor/${encodeURIComponent(ip)}/active`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
};

export const tdlExpiryApi = {
  getAll: (page = 1, limit = 25, search = '') =>
    fetchApi<any>(`/tdl-expiry?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
  create: (data: any) =>
    fetchApi<any>('/tdl-expiry', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    fetchApi<any>(`/tdl-expiry/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    fetchApi<any>(`/tdl-expiry/${id}`, { method: 'DELETE' }),
  setActive: (id: number, isActive: boolean) =>
    fetchApi<any>(`/tdl-expiry/${id}/active`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
  // Public URL for Tally to call — just returns the URL string, no fetch
  publicCheckUrl: (token: string) => `${API_BASE}/tdl-expiry/check/${token}`,
};

export default api;
