# ABS Cloud - Project Working Document

> **ABS Technologies Cloud Management System** - A full-stack web application for managing cloud servers, customers, billing, service calls, attendance, and field visits for ABS Technologies.

---

## 1. Project Overview

**What it does:** ABS Cloud is an internal business management platform used by ABS Technologies to manage their cloud service operations. It handles the entire lifecycle - from server/customer management, mapping customers to servers, billing & invoicing, field visits & attendance tracking, service call logging, and Tally integration for accounting.

**Who uses it:** ABS Technologies staff - admins (full access) and regular users (role-based permissions per module).

**Hosted on:** cPanel shared hosting with Apache (mod_proxy) + PM2 for the Node.js backend.

---

## 2. Tech Stack

| Layer        | Technology                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| **Frontend** | React 19 + TypeScript, React Router v7, Tailwind CSS, Lucide Icons, Recharts |
| **Backend**  | NestJS 10 (Node.js), TypeScript                                           |
| **Database** | MySQL (mysql2/promise - raw queries via connection pool)                   |
| **Auth**     | JWT (passport-jwt) + bcrypt, optional 2FA (speakeasy/TOTP)                |
| **API Docs** | Swagger (@nestjs/swagger) at `/api/docs`                                  |
| **State**    | React Context API (AuthContext + DataContext) - no Redux                   |
| **Styling**  | Tailwind CSS 3 + custom utility classes                                   |
| **Maps**     | Leaflet + React-Leaflet (field visit mapping)                             |
| **Excel**    | xlsx library (import/export on both frontend and backend)                  |
| **Deploy**   | PM2 (process manager), Apache .htaccess reverse proxy, Docker (optional)  |

---

## 3. Project Structure

```
abscloud/
├── backend/                    # NestJS API server
│   ├── src/
│   │   ├── main.ts             # Bootstrap - creates NestJS app, CORS, Swagger, Helmet, Compression
│   │   ├── app.module.ts       # Root module - registers all controllers, services, guards
│   │   ├── controllers/        # 16 REST API controllers
│   │   ├── services/           # 19 business logic services
│   │   ├── guards/             # JWT auth guard + Permissions guard
│   │   ├── decorators/         # @RequirePermission() custom decorator
│   │   ├── database/           # DbService (mysql2 pool), migrations
│   │   └── utils/              # Date utilities (IST timezone)
│   ├── migrations/             # 19 SQL migration files (000-019)
│   ├── scripts/                # One-off data migration/import scripts
│   ├── ecosystem.config.js     # PM2 production config
│   ├── package.json            # "abs-technologies-api" v1.0.0
│   └── .env                    # Environment config (DB, JWT, etc.)
│
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── App.tsx             # Router setup - all routes with PermissionGuard
│   │   ├── pages/              # 25+ page components
│   │   ├── components/         # Shared components (Layout, ProtectedRoute, PermissionGuard, Toast)
│   │   ├── context/            # AuthContext.tsx + DataContext.tsx
│   │   ├── services/           # api.ts - single file with ALL API functions
│   │   └── utils/              # security.ts, dateUtils.ts
│   ├── package.json            # React 19, Tailwind, Leaflet, Recharts
│   └── tailwind.config.js
│
├── .htaccess                   # Apache: proxy /api -> port 5000, SPA fallback
├── docker-compose.yml          # Optional Docker setup (backend + frontend + ngrok)
├── ecosystem.config.js         # Root PM2 config
└── working.md                  # This file
```

---

## 4. Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (React SPA)                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐                │
│  │AuthContext│  │DataContext │  │PermissionGuard│                │
│  │(JWT token)│  │(shared     │  │(entity-based  │                │
│  │(user/role)│  │ data cache)│  │ access control)│               │
│  └─────┬─────┘  └─────┬─────┘  └──────┬────────┘               │
│        └───────────────┼───────────────┘                        │
│                        ▼                                        │
│               api.ts (fetchApi wrapper)                         │
│         Bearer token auto-attached to all requests              │
│         Auto-logout on 401 (session expiry)                     │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP (fetch)
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                   APACHE (.htaccess)                            │
│         /api/* → proxy to http://127.0.0.1:5000/api/*          │
│         /* → serve index.html (SPA fallback)                   │
└────────────────────────┬───────────────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────────────┐
│                  NestJS BACKEND (port 5000)                     │
│                                                                │
│  Request → Helmet → Compression → CORS                         │
│    → Controller → JwtAuthGuard → PermissionsGuard              │
│      → Service (business logic) → DbService (MySQL pool)       │
│        → MySQL Database (absteqwc_absservice)                  │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. Authentication & Authorization

### Login Flow
1. User submits email + password to `POST /api/auth/login`
2. Backend verifies password with bcrypt, optionally validates 2FA OTP (speakeasy)
3. Returns JWT token (24h expiry) containing `{ sub: userId, sessionId }`
4. Frontend stores token in `localStorage` as `abs_token_data` with activity timestamp
5. All subsequent API calls include `Authorization: Bearer <token>`

### Guards (Backend)
- **JwtAuthGuard** (`jwt-auth.guard.ts`): Extracts & verifies JWT, fetches user from DB, checks user status (active), validates session ID. Attaches `req.user` with full permissions object.
- **PermissionsGuard** (`permissions.guard.ts`): Checks `@RequirePermission('entity', 'action')` decorator against `req.user.permissions`. Admins bypass all permission checks.

### Permissions Model
Granular JSON permissions stored per user in the `users` table:
```typescript
// Entity types:
'servers' | 'customers_our' | 'customers_not_our' | 'customer_search' |
'mappings' | 'users' | 'activities' | 'tdl' | 'pincodes' |
'visits_our' | 'visits_not_our' | 'tasks' | 'service_calls' |
'leads' | 'service_followup' | 'expiry_renew_our' | 'expiry_renew_not_our' | 'call_report'

// Each entity has: { view, create, edit, delete, export, ... }
```

### Frontend Guards
- **ProtectedRoute**: Redirects unauthenticated users to `/login`, shows loading while checking auth/data
- **PermissionGuard**: Wraps routes, checks `canView(entity)` from AuthContext. Hides pages user can't access.

### Session Features
- Session locking with 2FA unlock (`POST /api/auth/session/unlock`)
- Auto-logout on 401 responses
- Active session tracking
- Audit logging for login/logout events

---

## 6. Database

### Connection
- **DbService** (`db.service.ts`): MySQL2 connection pool (50 connections max)
- Timezone forced to IST (`+05:30`) on every connection
- Provides: `query()`, `queryOne()`, `execute()`, `withTransaction()`
- Raw SQL queries throughout (no ORM entities/repositories)

### Core Tables (from initial schema + migrations)
| Table              | Purpose                                          | Key Fields                                    |
| ------------------ | ------------------------------------------------ | --------------------------------------------- |
| `cloud_users`      | System users & auth                              | id (USR001), email, password_hash, role, permissions (JSON) |
| `cloud_servers`    | Cloud server inventory                           | id (SRV001), server_ip, port, company, purchase_rate, billing_mode, billing_cycle, server_expiry |
| `customer`         | Customer/client records                          | id (domain IP), name, gstin, address, city, state, pincode, status (Active/Inactive/Suspended), group |
| `cloud_mappings`   | Server-to-Customer links                         | server_id, customer_id (UNIQUE), serial_no    |
| `cloud_activities` | Billing/revenue transactions (legacy)            | customer_id, activity_type (New/Renewal/User), bill_amount |
| `admin`            | Admin/group table                                | id, name - used for customer grouping         |
| `attendance`       | Daily check-in/check-out with geolocation        | user_id, date, check_in_time, lat/lng         |
| `customer_visits`  | Field visit assignments & tracking               | customer_id, user_name, check_in/out, location |
| `service_calls`    | Service/support call log                         | mobile_no, service_type, assign_to, status    |
| `tdl_customizations` | TDL (To Do List) tasks & requirements          | customer_id, requirements, attachments        |
| `customer_calls`   | Phone call log per customer                      | customer_id, call_status, call_notes          |
| `audit_log`        | Security audit trail                             | user_id, action, resource, ip_address         |
| `bills`            | Invoice/credit note records                      | bill_no, customer, items, amounts, status     |
| `payments`         | Payment records linked to bills                  | bill_id, amount, payment_mode                 |
| `tally_details`    | Tally integration data (expiry/renewal tracking) | customer_id, expiry_date, renewal status      |
| `pincode`          | Pincode reference data                           | pincode, area, city, state                    |

### Migrations (19 files: 000-019)
Sequential SQL migrations in `backend/src/database/migrations/`. Key ones:
- `001`: Initial schema (users, servers, customers, mappings, activities)
- `005-006`: TDL customizations and fields
- `008-012`: Server billing fields (billing_mode, billing_cycle, server_expiry)
- `013`: Customer table refactoring
- `014`: Performance indexes
- `017`: User location tracking
- `018`: Tracking tables (visits, attendance)

---

## 7. Application Modules

### 7.1 Cloud Module (`/cloud/*`)

**Servers** (`/cloud/servers`)
- CRUD for cloud servers (IP, port, company, billing mode/cycle, expiry)
- Pagination, search, advanced filters (company, status, billing_cycle, expiry range)
- Customer count per server
- Backend: `ServersController` → `ServersService`

**Customers** (`/cloud/customers/*`)
- Split into "Our Customers" (Active) and "Not Our Customers" (Others)
- CRUD with advanced filtering (aging, city, pincode, group, state, date range, last visit person)
- Autocomplete search for cross-module usage
- Customer status management (Active/Inactive/Suspended)
- Excel export capability
- Backend: `CustomersController` → `CustomersService`

**Mapping** (`/cloud/mapping`)
- Links servers to customers (one customer = one server mapping)
- Bulk renewal capability
- Backend: `MappingsController` → `MappingsService`

**Billing** (`/cloud/billing/*`)
- Full invoice system: Bills, Credit Notes, Payments
- Bill creation with line items (products, quantities, rates, GST)
- Payment tracking (partial/complete)
- Follow-up count tracking
- Billing companies and products management
- Routes: `/cloud/billing` (CloudBill), `/cloud/bill-report` (BillReport), `/cloud/payment-report` (PaymentReport), `/cloud/tally-bill` (TallyBill)
- Backend: `BillingController` → `BillingService`

**Activities** (legacy billing - `/cloud/activity`)
- Now redirects to billing module
- Legacy transaction records (New/Renewal/User types)
- Backend: `ActivitiesController` → `ActivitiesService`

### 7.2 Service Module (`/service/*`)

**Service Calls** (`/service/calls`)
- Log and track service/support calls
- Fields: mobile_no, service_type, contact_person, serial_number, assign_to, remark
- Entry types: Service Call vs Lead
- Status management, staff filtering, date range queries
- Stats endpoint for dashboard widgets
- Backend: `ServiceCallsController` → `ServiceCallsService`

**Service Follow-Up** (`/service/follow-up`)
- Track follow-up actions on service calls
- Confirm/reopen flow

**Lead Report** (`/service/lead-report`)
- Filter and report on leads captured through service calls

### 7.3 Visit Module (`/visit/*`)

**Last Visit Report** (`/visit/oc-report`, `/visit/noc-report`)
- Separate views for "Our Customers" (OC) and "Not Our Customers" (NOC)
- Shows customer visit history with dates, staff, notes

**Pending Visits** (`/visit/oc-pending`, `/visit/noc-pending`)
- Lists assigned visits not yet completed
- Check-in/check-out with geolocation (force check-in option for admin)
- Combined view of visits + TDL connect tasks

**Connect Map** (`/visit/map`)
- Leaflet map view of customer visits/locations
- Visual field activity tracking

**Call Report** (`/visit/call-report`)
- Phone call logs per customer
- Call status tracking (connected, not answered, etc.)
- Backend: `CallsController` → `CallsService`

### 7.4 Tally Module (`/tally/*`)

**Expiry & Renewal** (`/tally/expiry/our`, `/tally/expiry/not-our`)
- Tally integration for tracking software expiry dates
- Renewal call tracking
- Upsert tally details per customer
- Backend: `TallyController` → `TallyService`

### 7.5 Attendance (`/attendance/*`)

**Attendance History** (`/attendance/history`)
- Daily check-in/check-out with geolocation (geofenced)
- Admin: force check-in/check-out for any user
- Monthly matrix export (Excel)
- User attendance history with location tracking
- Background location tracking while checked in (via Layout component)
- Backend: `AttendanceController` → `AttendanceService`

**Monthly Detail** (`/attendance/monthly/:userId/:year/:month`)
- Detailed monthly attendance breakdown per user

### 7.6 TDL - Task Management (`/tdl/*`)

**Customizations** (`/tdl/customizations`)
- TDL (Tally Definition Language) customization requests per customer
- Requirements management (add/delete requirements with comments)
- File upload for attachments (stored in `/uploads/tdl/`)
- Status tracking, public view via token-based link (`/tdl/amc/:token`)
- Backend: `TdlController` → `TdlService`

**Task Management** (`/tdl/tasks`)
- Task assignment and tracking
- Backend: Part of TDL + Visits service

**Task Report** (`/tdl/task-report`)
- Reporting on completed/pending tasks

### 7.7 Common Pages

| Route                  | Page Component         | Purpose                             |
| ---------------------- | ---------------------- | ----------------------------------- |
| `/`                    | Dashboard              | Stats overview (servers, customers, revenue, activities) |
| `/profile`             | Profile                | User profile management             |
| `/settings`            | Settings               | App settings (admin only)           |
| `/network`             | Network                | Network/connectivity status         |
| `/cloud/pincode`       | Pincode                | Pincode reference data management   |
| `/cloud/customer-search` | CustomerSearch       | Global customer search              |

### 7.8 Dashboard

- Aggregated stats via `DashboardService.getStats()`:
  - Server counts (total/active/inactive/maintenance)
  - Customer counts (total/active/inactive/suspended)
  - Mapping counts (total/active/unmapped)
  - User counts (total/active/inactive/admin/user)
  - Revenue stats (total/new/renewal/user revenue)
  - Recent activities

---

## 8. API Endpoints Summary

All endpoints are prefixed with `/api/` and require JWT auth unless noted.

| Controller       | Base Path            | Key Endpoints                                          |
| ---------------- | -------------------- | ------------------------------------------------------ |
| Auth             | `/api/auth`          | `GET /health`, `POST /login`, `GET /me`, `POST /logout`, `POST /2fa/*`, `GET /sessions/active` |
| Users            | `/api/users`         | CRUD, permissions management                           |
| Servers          | `/api/servers`       | CRUD, `/dropdown`, `/:id/customers`                    |
| Customers        | `/api/customers`     | CRUD, `/autocomplete`, `/dropdown`, pagination+filters |
| Mappings         | `/api/mappings`      | CRUD, bulk operations                                  |
| Activities       | `/api/activities`    | CRUD, `/renewal-defaults`, `/calculate`                |
| Dashboard        | `/api/dashboard`     | `GET /stats`                                           |
| Attendance       | `/api/attendance`    | `POST /checkin`, `/checkout`, `GET /status`, `/report`, `/monthly-export`, force ops |
| Visits           | `/api/visits`        | `POST /create`, `GET /pending`, `/completed`, `/update`, `/force-checkin` |
| Service Calls    | `/api/service-calls` | CRUD, `GET /stats`, status/assignment management       |
| TDL              | `/api/tdl`           | CRUD customizations, requirements, upload, public lookup |
| Calls            | `/api/calls`         | `POST /create`, `GET /` with filters                   |
| Billing          | `/api/billing`       | Bills CRUD, Payments CRUD, companies, products, tally-item-types |
| Tally            | `/api/tally`         | `GET /expiry-report`, `POST /renewal-call`, `POST /upsert-detail` |
| Pincode          | `/api/pincodes`      | Pincode lookup and management                          |
| State            | `/api/states`        | State reference data                                   |
| Admins           | `/api/admins`        | Admin/group management                                 |
| Debug            | `/api/debug`         | Debug endpoints (dev only)                             |

---

## 9. Frontend State Management

### AuthContext (`context/AuthContext.tsx`)
- Manages: `user`, `token`, `isAuthenticated`, `permissions`, `isSessionLocked`
- Provides: `login()`, `logout()`, `canView(entity)`, `canCreate(entity)`, `isAdmin()`
- Auto-refreshes user data via `GET /api/auth/me` on load
- Session lock/unlock with 2FA support

### DataContext (`context/DataContext.tsx`)
- Caches shared data: servers list, customers list, mappings, activities
- Types defined inline: `Server`, `Customer`, `Mapping`, `Activity`
- Provides: `loadData()`, `loadUsers()` with loading states
- Used by ProtectedRoute to pre-load data on auth

### API Service (`services/api.ts`)
- Single file containing ALL API functions organized by domain:
  - `authApi` - login, logout, me, 2FA
  - `usersApi` - CRUD, permissions
  - `serversApi` - CRUD, dropdown
  - `customersApi` - CRUD, autocomplete, dropdown
  - `mappingsApi` - CRUD, bulk
  - `activitiesApi` - CRUD, calculations
  - `dashboardApi` - stats
  - `attendanceApi` - check-in/out, reports
  - `visitsApi` - pending, completed, CRUD
  - `serviceCallsApi` - CRUD, stats
  - `tdlApi` - customizations, requirements, upload
  - `callsApi` - create, list
  - `billingApi` - bills, payments, lookups
  - `tallyApi` - expiry report, renewal calls
- Uses native `fetch()` with Bearer token auto-attached
- Auto-logout on 401 for non-auth endpoints

---

## 10. Security Features

### Backend
- **Helmet**: Security headers (CSP, HSTS, etc.)
- **Compression**: gzip response compression
- **Bcrypt**: Password hashing
- **JWT**: Stateless auth with 24h expiry
- **2FA**: Optional TOTP via speakeasy
- **Audit Logging**: Login/logout actions recorded with IP + user agent
- **Admin password encryption**: Stored encrypted, not plaintext
- **Global error filter**: Prevents SQL leak in error responses

### Frontend
- **DevTools detection**: Warns users when browser dev tools are opened (production only)
- **Right-click disabled**: Prevents casual context menu access
- **Text selection disabled**: Prevents casual copy
- **Keyboard shortcuts blocked**: Ctrl+U, Ctrl+Shift+I, F12 blocked
- **Console methods disabled**: In production, console.log/warn/error are no-ops

---

## 11. Deployment

### Production (cPanel)
1. **Backend**: `npm run build` → `dist/` → PM2 with `ecosystem.config.js`
   - Runs on port 5000 (internal)
   - PM2 config: 1 instance, 512MB memory limit, auto-restart
2. **Frontend**: `npm run build` → `build/` → deployed as static files in public_html
3. **Apache**: `.htaccess` proxies `/api/*` to port 5000, serves `index.html` for SPA routes

### Environment Variables
```
PORT=5000
JWT_SECRET=<secret>
JWT_EXPIRES_IN=24h
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=<user>
DB_PASSWORD=<pass>
DB_DATABASE=absteqwc_absservice
```

### PM2 Commands
```bash
pm2 start ecosystem.config.js    # Start
pm2 restart abs-backend           # Restart
pm2 logs abs-backend              # View logs
pm2 monit                         # Monitor
```

### Docker (Optional)
- `docker-compose.yml` defines: backend (port 3001), frontend (port 3000), ngrok (tunneling)
- Uses `host.docker.internal` for DB access

---

## 12. Key Design Decisions

1. **Raw SQL over ORM**: Despite TypeORM being installed, the app uses raw `mysql2` queries via `DbService` for all data access. This gives full SQL control but means no auto-migrations or entity validation.

2. **JSON Permissions**: User permissions are stored as a JSON column in the `users` table, not in separate permission/role tables. This simplifies queries but makes permission changes per-user.

3. **Single API Service File**: All frontend API calls live in one `api.ts` file (~1000+ lines). Centralized but large.

4. **Context API over Redux**: State management uses React Context (AuthContext + DataContext) instead of Redux. Sufficient for the app's complexity level.

5. **Customer Segmentation**: Customers are split into "Our Customers" (Active) and "Not Our Customers" (Others) throughout the entire system - separate permissions, separate routes, separate views.

6. **IST Timezone**: All dates are forced to Indian Standard Time (`+05:30`) at the DB connection level and in frontend formatting utilities.

7. **ID Format**: Entities use formatted string IDs (USR001, SRV001, MAP001) instead of auto-increment integers for the legacy tables. Newer tables use auto-increment.

---

## 13. Development Setup

```bash
# Backend
cd backend
cp .env.example .env              # Configure DB credentials
npm install
npm run start:dev                  # Starts on port 5000 with hot reload

# Frontend
cd frontend
npm install
npm start                          # Starts on port 3000, proxies /api to port 5000

# Access
# Frontend: http://localhost:3000
# Backend API: http://localhost:5000/api
# Swagger Docs: http://localhost:5000/api/docs
```

---

---

## 14. User Stories (by Priority)

### Legend
- **Must Have** - Core business functionality. Without these, the system has no value.
- **Ok to Have** - Enhances productivity and user experience. System works without them but feels incomplete.
- **Wow** - Delightful features that differentiate the product. Users don't expect these but love them.

---

### A. Authentication & User Management

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can create user accounts with email/password so that staff can access the system | Users |
| **Must Have** | As a **user**, I can login with email/password and receive a JWT token so that I can access protected features | Auth |
| **Must Have** | As an **admin**, I can assign granular permissions (view/create/edit/delete per module) to each user so that staff only sees what they need | Users |
| **Must Have** | As a **user**, my session auto-expires after 24 hours so that unattended devices are secure | Auth |
| **Ok to Have** | As a **user**, I can set up 2FA (TOTP) on my account so that even if my password leaks, my account stays safe | Auth |
| **Ok to Have** | As an **admin**, I can view active sessions count so that I know who is currently logged in | Auth |
| **Wow** | As a **user**, my session locks (not logs out) after inactivity and I can unlock with 2FA so that I don't lose my work context | Auth |
| **Wow** | As an **admin**, I can see full audit logs (login/logout with IP, user-agent, timestamps) so that I have a security trail | Audit |

---

### B. Cloud Server Management

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can add/edit/delete cloud servers (IP, port, company, SOF no) so that the server inventory is maintained | Servers |
| **Must Have** | As a **user**, I can view servers list with search and pagination so that I can find servers quickly | Servers |
| **Must Have** | As a **user**, I can see customer count per server so that I know server utilization | Servers |
| **Ok to Have** | As an **admin**, I can set billing mode (day-to-day/month-to-month), billing cycle (Monthly/Quarterly/Half-Yearly/Yearly), and expiry date per server so that billing is tracked at server level | Servers |
| **Ok to Have** | As a **user**, I can filter servers by company, status, billing cycle, and expiry date range so that I find exactly what I need | Servers |
| **Wow** | As a **user**, I can use lightweight dropdown APIs for server selection in other modules so that forms load instantly without full server data | Servers |

---

### C. Customer Management

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can add/edit/delete customers (name, email, GSTIN, address, city, state, pincode) so that the customer database is maintained | Customers |
| **Must Have** | As a **user**, I can view customers split as "Our Customers" (Active) and "Not Our Customers" (Others) so that I focus on the right segment | Customers |
| **Must Have** | As a **user**, I can search customers with pagination and sort by last visit date so that follow-up priority is clear | Customers |
| **Ok to Have** | As a **user**, I can filter customers by aging, city, pincode, group, state, and date range so that I can drill down into specific segments | Customers |
| **Ok to Have** | As a **user**, I can export customer lists to Excel so that I can share data offline | Customers |
| **Ok to Have** | As a **user**, I can use autocomplete search across all modules (activities, visits, service calls) so that I quickly find customers without leaving my current workflow | Customers |
| **Wow** | As a **user with only mapping/activity permissions**, I can still search customers (read-only) so that cross-module workflows don't break due to permission gaps | Customers |

---

### D. Server-Customer Mapping

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can map a customer to a server (with serial number) so that the customer-server relationship is tracked | Mappings |
| **Must Have** | As a **user**, I can view all mappings with server and customer details so that I see which customer is on which server | Mappings |
| **Must Have** | As a **user**, one customer can only be mapped to one server (UNIQUE constraint) so that data integrity is maintained | Mappings |
| **Ok to Have** | As an **admin**, I can do bulk renewal of mappings so that mass operations don't require one-by-one editing | Mappings |
| **Wow** | As a **user**, the dashboard shows unmapped active customer count so that I'm alerted when new customers haven't been assigned servers | Dashboard |

---

### E. Billing & Invoicing

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can create bills (Tax Invoice / Credit Note) with line items, quantities, rates, and GST so that invoicing is formalized | Billing |
| **Must Have** | As a **user**, I can view bills with filters (type, status, payment status, date range, search) so that I can track invoicing | Billing |
| **Must Have** | As an **admin**, I can record payments against bills (partial or full) so that collection is tracked | Billing |
| **Ok to Have** | As a **user**, I can see bill reports and payment reports as separate views so that finance gets clear summaries | Billing |
| **Ok to Have** | As a **user**, I can update bill status and track follow-up count so that overdue bills get attention | Billing |
| **Ok to Have** | As a **user**, I can see billing companies and products as managed lookup tables so that bill creation uses standardized values | Billing |
| **Wow** | As a **user**, the activity module auto-calculates bill amounts based on billing units, rates, and cycles so that I don't do manual math | Activities |

---

### F. Attendance & Location Tracking

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **user**, I can check-in and check-out with my current GPS location so that my attendance is recorded | Attendance |
| **Must Have** | As an **admin**, I can view daily attendance report showing who checked in/out, times, and locations so that I monitor field staff | Attendance |
| **Ok to Have** | As an **admin**, I can force check-in/check-out for a user (with manual time/location) so that missed entries can be corrected | Attendance |
| **Ok to Have** | As an **admin**, I can export monthly attendance matrix to Excel so that HR/payroll gets structured data | Attendance |
| **Ok to Have** | As a **user**, I can view my own attendance history month-by-month so that I can track my own records | Attendance |
| **Wow** | As a **user**, when I'm checked in, my GPS location is tracked in the background (via Layout component) so that my route/movement is logged automatically without manual effort | Attendance |

---

### G. Field Visits & Customer Connect

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can assign visits (Visit or Call type) to staff for specific customers so that field work is planned | Visits |
| **Must Have** | As a **user**, I can see my pending visits and check-in/check-out at customer locations so that visit completion is tracked | Visits |
| **Must Have** | As a **user**, I can view last visit report for Our Customers and Not Our Customers (separate views) so that follow-up gaps are visible | Visits |
| **Ok to Have** | As a **user**, I can see completed visits combined with TDL connect tasks (sorted by checkout time) so that all customer interactions are in one timeline | Visits |
| **Ok to Have** | As an **admin**, I can toggle force-checkin for visits so that staff can check in even outside geofence when needed | Visits |
| **Wow** | As a **user**, I can view all visits on a Leaflet map (Connect Map) so that field coverage is visualized geographically | Visits |

---

### H. Service Calls & Leads

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **user**, I can log service calls (mobile, service type, contact person, remark, assign to) so that support requests are tracked | Service Calls |
| **Must Have** | As a **user**, I can view/filter service calls by status, staff, date range, and entry type so that I can manage the queue | Service Calls |
| **Ok to Have** | As a **user**, I can see service call statistics (counts by status, staff workload) so that team performance is visible | Service Calls |
| **Ok to Have** | As a **user**, I can track leads separately from service calls (entry_type filter) so that sales pipeline is distinct from support | Service Calls |
| **Ok to Have** | As a **user**, I can do service follow-up (confirm/reopen) so that resolution is tracked to completion | Service Follow-Up |
| **Wow** | As a **user with limited permissions**, I can only see service calls assigned to me (not all) so that data is scoped to my responsibility | Service Calls |

---

### I. TDL (Task/Customization Management)

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As an **admin**, I can create TDL customization records per customer (with requirements, status) so that Tally customization work is tracked | TDL |
| **Must Have** | As a **user**, I can add/delete requirements (with comments) on a TDL record so that scope is captured granularly | TDL |
| **Ok to Have** | As a **user**, I can upload file attachments to TDL records so that reference documents are linked | TDL |
| **Ok to Have** | As a **user**, I can manage tasks (assignment, progress, completion) so that work is tracked to done | Tasks |
| **Wow** | As a **customer**, I can view my AMC/customization status via a public token-based link (`/tdl/amc/:token`) without logging in so that transparency is built-in | TDL |

---

### J. Tally Integration & Expiry Tracking

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **user**, I can view expiry reports filtered by customer type (our/not-our), expiry status, and date range so that renewals are proactively managed | Tally |
| **Ok to Have** | As a **user**, I can log renewal calls against expiring customers so that outreach is recorded | Tally |
| **Ok to Have** | As a **user**, I can upsert tally details (expiry date, renewal info) per customer so that Tally data stays current | Tally |
| **Wow** | As a **user**, the Tally Bill page integrates billing with Tally item types so that accounting entries flow from the same system | Billing + Tally |

---

### K. Phone Call Logging

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **user**, I can log phone calls to customers (status, notes, responses) so that communication history is captured | Calls |
| **Ok to Have** | As a **user**, I can view call reports with filters (user, date range, status) and sorting so that I can review call activity | Calls |
| **Wow** | As a **user**, call responses are stored as structured JSON so that future analytics/reporting on call outcomes is possible | Calls |

---

### L. Dashboard & Reporting

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **user**, I see a dashboard with server/customer/mapping/user/revenue counts so that I get a business snapshot at login | Dashboard |
| **Ok to Have** | As a **user**, I see recent activities on the dashboard so that I know what just happened | Dashboard |
| **Ok to Have** | As a **user**, revenue is broken down by type (New/Renewal/User) so that business growth patterns are visible | Dashboard |
| **Wow** | As an **admin**, I see unmapped customer count as a separate metric so that onboarding gaps are immediately visible | Dashboard |

---

### M. Security & UX

| Priority | Story | Module |
|----------|-------|--------|
| **Must Have** | As a **system**, all API responses strip SQL error details so that database internals are never leaked | Backend |
| **Must Have** | As a **system**, Helmet security headers are applied to all responses so that common web attacks are mitigated | Backend |
| **Ok to Have** | As a **system**, API docs are auto-generated via Swagger at `/api/docs` so that developers can explore endpoints interactively | Backend |
| **Ok to Have** | As a **system**, dates are consistently formatted in DD/MM/YYYY (IST) across frontend and backend so that Indian users see familiar formats | Utils |
| **Wow** | As a **system**, in production: right-click, text selection, keyboard shortcuts (F12, Ctrl+U, Ctrl+Shift+I), and console methods are disabled so that casual data extraction is prevented | Security |
| **Wow** | As a **system**, toast notifications provide non-blocking feedback for all CRUD operations so that users always know what happened | UX |

---

## 15. Development Workflow: code-review-graph + context-mode + GSD

### The Problem: Claude Credit Burn

Every time Claude reads your codebase, it consumes tokens. A single conversation that explores 10 files costs thousands of tokens. Multiply that by dozens of conversations per week, and credits burn fast.

### The Solution: Three Tools Working Together

```
┌─────────────────────────────────────────────────────────────────────┐
│                    YOUR CLAUDE CODE SESSION                         │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ code-review-graph │  │ context-mode │  │         GSD           │ │
│  │   (MCP Plugin)    │  │ (MCP Plugin) │  │   (Workflow Engine)   │ │
│  │                   │  │              │  │                       │ │
│  │ "What does this   │  │ "Run this    │  │ "Plan → Research →   │ │
│  │  code do? What    │  │  command but │  │  Execute → Verify    │ │
│  │  depends on it?"  │  │  don't flood │  │  in phases"          │ │
│  │                   │  │  context"    │  │                       │ │
│  │ Saves: ~8x tokens │  │ Saves: ~3-5x │  │ Saves: structured    │ │
│  │ on code reading   │  │ on cmd output│  │ work = fewer retries  │ │
│  └────────┬──────────┘  └──────┬───────┘  └───────────┬───────────┘ │
│           │                    │                      │             │
│           └────────────────────┼──────────────────────┘             │
│                                │                                    │
│                     ┌──────────▼──────────┐                         │
│                     │   Claude's Context   │                         │
│                     │      Window          │                         │
│                     │  (MINIMAL tokens     │                         │
│                     │   = LOW credit cost) │                         │
│                     └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

### What Each Tool Does

#### 1. code-review-graph - "The Codebase Brain"
- **What**: Parses your entire codebase into an AST-based knowledge graph (SQLite)
- **How it saves tokens**: Instead of Claude reading full files (500-2000 lines each), it queries the graph for just the function signatures, dependencies, and impact radius (~100 tokens per query vs ~2000 tokens per file read)
- **When it kicks in**: Every time Claude needs to understand code structure, find dependencies, check what a function does, or review changes
- **Key MCP tools it provides**:
  - `review_changes` - risk-scored code review without reading full files
  - `architecture_map` - understand module relationships without scanning directories
  - `debug_issue` - trace call chains and data flow without grep-ing everything
  - `pre_merge_check` - validate changes before committing

```bash
# Install
pip install code-review-graph
cd d:/cloud_backup/abscloud
code-review-graph install   # Auto-configures for Claude Code
```

#### 2. context-mode - "The Output Filter"
- **What**: Intercepts large command outputs (build logs, test results, git diffs) and stores them in a sandbox instead of dumping into Claude's context
- **How it saves tokens**: A `npm run build` output might be 500 lines. Without context-mode, all 500 lines enter context. With it, only a 10-line summary enters context, and Claude can search the full output if needed
- **When it kicks in**: Every `Bash` command, every `Read` of large files, every build/test output
- **Key tools**:
  - `ctx_batch_execute` - Run multiple commands, auto-index output, search in one call
  - `ctx_execute_file` - Read + analyze a file without loading it into context
  - `ctx_search` - Query previously indexed output

```
Already installed in your project via .claude-plugin/
```

#### 3. GSD (Get Shit Done) - "The Work Organizer"
- **What**: Structures development work into milestones → phases → tasks with research, planning, execution, and verification steps
- **How it saves tokens**: Without structure, Claude wanders - reads files it doesn't need, tries approaches that fail, backtracks. GSD forces a plan-first approach so each phase has clear scope, reducing wasted exploration
- **When it kicks in**: When starting new features, debugging complex issues, refactoring, or any multi-step work
- **Key commands**:
  - `/gsd:new-project` - Initialize project with roadmap
  - `/gsd:plan-phase` - Plan a specific phase before coding
  - `/gsd:execute-phase` - Execute with atomic commits
  - `/gsd:verify-work` - Validate against acceptance criteria

```
Already installed via ~/.claude/get-shit-done/
```

### How They Work Together (The Workflow)

```
Step 1: START NEW FEATURE
   └─ /gsd:plan-phase "Add notification system"
      └─ GSD spawns research agent
         └─ Research agent uses code-review-graph to understand
            existing architecture WITHOUT reading files
            (saves ~5000 tokens vs manual exploration)

Step 2: EXECUTE THE PLAN
   └─ /gsd:execute-phase
      └─ For each task in the plan:
         ├─ code-review-graph: "What functions touch this area?"
         │   (100 tokens instead of reading 3 files = 6000 tokens)
         ├─ Claude edits the code (normal Edit tool)
         ├─ context-mode: "Run tests, show me only failures"
         │   (50 token summary instead of 500 line test output)
         └─ GSD: atomic commit + move to next task

Step 3: VERIFY
   └─ /gsd:verify-work
      └─ code-review-graph: pre_merge_check
         (risk-scored review without re-reading all changed files)
```

### Credit Savings Estimate

| Action | Without Tools | With All 3 Tools | Savings |
|--------|--------------|-------------------|---------|
| Explore codebase (10 files) | ~20,000 tokens | ~1,000 tokens (graph queries) | **~20x** |
| Run build + read output | ~5,000 tokens | ~500 tokens (context-mode summary) | **~10x** |
| Plan feature (research phase) | ~15,000 tokens (wandering) | ~3,000 tokens (structured GSD) | **~5x** |
| Code review (5 changed files) | ~10,000 tokens | ~1,500 tokens (graph review) | **~7x** |
| **Typical conversation** | **~50,000 tokens** | **~6,000 tokens** | **~8x** |

### Quick Setup Checklist

```
[x] context-mode  - Already installed (MCP plugin active)
[x] GSD           - Already installed (skills available)
[ ] code-review-graph - Need to install (pip install code-review-graph)
```

### Daily Development Pattern

```bash
# Morning: Start work
/gsd:progress                     # See where you left off

# Feature work: Plan first, then execute
/gsd:plan-phase "feature name"    # Research + plan (uses graph)
/gsd:execute-phase                # Execute with atomic commits

# Quick fixes: Skip planning overhead
/gsd:quick "fix the bug in X"    # Fast path with GSD guarantees

# End of phase: Verify
/gsd:verify-work                  # UAT against acceptance criteria

# Refresh codebase understanding (after major changes)
/gsd:map-codebase                 # Update .planning/codebase/ docs
```

---

*Last updated: 2026-04-09*
