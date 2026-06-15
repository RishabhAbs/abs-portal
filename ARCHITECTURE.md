# ABS Cloud — Architecture Document

## Overview

**ABS Cloud** is a full-stack cloud infrastructure management platform built for IT service companies. It manages cloud servers, customer billing, task management, employee attendance, and field visits — all with role-based access control and 2FA security.

**Core purpose:** Give IT service providers a single dashboard to track their cloud server inventory, bill customers, manage TDL (project customization) work, and monitor field staff.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript |
| Routing | React Router v7 |
| State | Redux Toolkit + Context API |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Maps | Leaflet + Leaflet-Routing-Machine |
| Icons | Lucide React |
| Backend | NestJS 10 (Node.js) |
| Language | TypeScript (both ends) |
| Database | MySQL 8 (`abs_cloud`) |
| ORM | TypeORM (configured) + raw MySQL2 queries |
| Auth | JWT (24h) + TOTP 2FA (Speakeasy) |
| Password | bcryptjs |
| API Docs | Swagger |
| Process Mgr | PM2 (ecosystem.config.js) |
| Containers | Docker + docker-compose |
| Web Server | Nginx (Docker) / Apache (cPanel) |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                       │
│                                                                   │
│  AuthContext ──── DataContext ──── Redux Store                   │
│       │                │                │                        │
│  Login/2FA      Servers/Customers    Global UI State             │
│                 Mappings/Activities                               │
│                                                                   │
│  22 Pages  ←──  api.ts (Axios)  ──→  Categorized API calls      │
└─────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS / JSON
                           │ /api/*
┌─────────────────────────▼───────────────────────────────────────┐
│                     NestJS Backend (:5000 / :3001)               │
│                                                                   │
│  main.ts                                                          │
│   └─ app.module.ts                                                │
│        ├─ AuthModule         (JWT + Passport + 2FA)              │
│        ├─ UsersModule        (User CRUD + Permissions)           │
│        ├─ ServersModule      (Cloud server inventory)            │
│        ├─ CustomersModule    (Customer records)                  │
│        ├─ MappingsModule     (Server ↔ Customer links)          │
│        ├─ ActivitiesModule   (Billing transactions)              │
│        ├─ TdlModule          (Project/task management)           │
│        ├─ VisitsModule       (Field visit scheduling)            │
│        ├─ AttendanceModule   (Geolocation check-in/out)         │
│        ├─ DashboardModule    (KPI aggregations)                  │
│        └─ ...PincodesModule, StatesModule, AuditModule           │
│                                                                   │
│  Guards: JwtAuthGuard → PermissionsGuard                         │
└─────────────────────────┬───────────────────────────────────────┘
                           │ MySQL2
┌─────────────────────────▼───────────────────────────────────────┐
│                     MySQL 8 (`abs_cloud`)                        │
│                                                                   │
│   cloud_users      cloud_servers      customer                   │
│   cloud_mappings   cloud_activities   cloud_visits               │
│   cloud_tdl_master cloud_tdl_requirements cloud_tdl_tasks        │
│   cloud_attendance_log  cloud_user_sessions  pincodes            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
abscloud/
├── backend/
│   ├── src/
│   │   ├── controllers/        # HTTP route handlers (16 files)
│   │   ├── services/           # Business logic (14 files)
│   │   ├── database/           # DB connection + 18+ migrations
│   │   ├── guards/             # JwtAuthGuard, PermissionsGuard
│   │   ├── decorators/         # @RequirePermission(), @GetUser()
│   │   ├── utils/              # Encryption, date helpers
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── ecosystem.config.js     # PM2 process config
│   ├── Dockerfile
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── pages/              # 22 page-level components
│   │   ├── components/         # Shared UI components
│   │   ├── context/
│   │   │   ├── AuthContext.tsx  # Auth state + permissions
│   │   │   └── DataContext.tsx  # Cached API data
│   │   ├── services/
│   │   │   └── api.ts          # All API calls (categorized)
│   │   ├── App.tsx             # Route definitions
│   │   └── index.tsx
│   ├── tailwind.config.js
│   ├── nginx.conf
│   └── Dockerfile
│
├── docker-compose.yml          # backend + frontend + ngrok
├── ecosystem.config.js         # Root PM2
└── .htaccess                   # Apache cPanel proxy rules
```

---

## Frontend Architecture

### State Management

Two complementary approaches are used:

**AuthContext** (session + identity)
- Stores the logged-in user object with all permissions
- Exposes `canView()`, `canCreate()`, `canEdit()`, `canDelete()` helpers
- Handles 2FA flow, session unlock, and 30-minute timeout

**DataContext** (data cache)
- Caches servers, customers, mappings, and activities after first fetch
- Provides helper methods like `getMappingByCustomer()`, `getTotalRevenue()`
- Prevents redundant API calls across page navigations

**Redux Toolkit**
- Used for global UI state (modals, filters, notifications)

### Page Map

| Page | Route | Key Feature |
|------|-------|-------------|
| Login | `/login` | Email + password + optional 2FA TOTP |
| Dashboard | `/` | KPIs, quick stats, attendance status |
| Servers | `/servers` | Cloud server inventory, expiry tracking |
| CustomerList | `/customers` | Our vs not-our customers, aging, filters |
| Mapping | `/mapping` | Link servers to customers with serial numbers |
| Activities | `/activities` | Billing transactions (sales/purchase/credit) |
| Users | `/users` | User management (admin only) |
| Customization | `/tdl` | TDL project management (3-level hierarchy) |
| TaskManagement | `/tasks` | Task assignment and status tracking |
| TaskReport | `/task-report` | Task analytics |
| PendingVisits | `/visits` | Field visit scheduling and management |
| LastVisitReport | `/visit-report` | Historical visit records |
| Network | `/network` | Live user location map view |
| AttendanceHistory | `/attendance` | Employee attendance logs |
| Pincode | `/pincodes` | Pincode master management |
| Profile | `/profile` | Personal settings, 2FA setup, password |
| AmcPublicView | `/amc/:token` | Public TDL project view (no auth) |
| ConnectMap | `/connect-map` | Connectivity visualization |
| RequirementReport | `/req-report` | TDL requirements analytics |

### API Client (`api.ts`)

All HTTP calls go through a single Axios instance with:
- Automatic JWT token injection from localStorage
- 401 handling → redirect to login
- Named export groups: `authApi`, `serversApi`, `customersApi`, `mappingsApi`, `activitiesApi`, `usersApi`, `tasksApi`, `visitsApi`, `attendanceApi`

---

## Backend Architecture

### Request Lifecycle

```
HTTP Request
    │
    ▼
main.ts (Helmet, CORS, Compression, Global prefix /api)
    │
    ▼
NestJS Router → Controller method
    │
    ├─ JwtAuthGuard       ← Validates Bearer token, attaches user
    ├─ PermissionsGuard   ← Checks @RequirePermission() decorator
    │
    ▼
Controller (validates input, calls service)
    │
    ▼
Service (business logic, raw MySQL2 queries)
    │
    ▼
MySQL via DatabaseService (connection pool)
    │
    ▼
JSON response
```

### Module Overview

**AuthModule**
- `POST /api/auth/login` — validates password (bcrypt), checks 2FA, issues JWT, creates session
- `POST /api/auth/2fa/*` — TOTP secret generation, enable/disable
- `GET /api/auth/me` — returns user profile
- `POST /api/auth/logout` — invalidates session

**ServersModule**
- Manages cloud server records (IP, port, credentials, expiry, billing mode)
- Server passwords stored encrypted
- Tracks purchase rate vs billing rate

**CustomersModule**
- Two categories: "Our Customers" (active cloud users) and "Not Our Customers" (prospects)
- Tracks aging (days since last purchase), last visit person/date
- Supports group assignment, GST, full address with pincode

**MappingsModule**
- Join entity linking one server to many customers
- Stores serial number, billed users count, purchase users count
- `GET /api/mappings/unmapped-customers` — find customers not yet on any server

**ActivitiesModule** (largest service — billing core)
- Records every billing transaction: sale, purchase, credit note
- Billing cycles: Monthly, Quarterly, Half-Yearly, Yearly
- `GET /api/activities/renewal-defaults` — smart defaults for renewal entries
- `GET /api/activities/revenue` — aggregated revenue summary

**TdlModule** (TDL = Task Definition List / project customizations)
- Three-level hierarchy:
  1. `cloud_tdl_master` — Project/customization record
  2. `cloud_tdl_requirements` — Individual requirements with amounts
  3. `cloud_tdl_tasks` — Developer tasks per requirement
- Public read via `GET /api/tdl/lookup/:token` (no auth needed)
- File attachment support

**VisitsModule**
- Schedule and track customer visits and calls
- Filter by "Our Customers" vs general
- Status: Pending → Completed

**AttendanceModule**
- GPS-based check-in/check-out
- Detects if user is inside or outside office boundary
- Stores complete attendance history per user

**DashboardModule**
- Aggregates KPIs: active servers, active customers, monthly revenue, pending tasks

---

## Database Schema (Key Tables)

```sql
-- Users
cloud_users (id, name, email, password_hash, role ENUM('admin','user'),
             status, permissions JSON, two_fa_secret, is_two_fa_enabled,
             created_at, updated_at)

-- Sessions
cloud_user_sessions (id, user_id, token, created_at, expires_at)

-- Cloud infrastructure
cloud_servers (id, server_ip, sof_no, port, customer_ip,
               admin_username, admin_password_enc, status,
               company, purchase_rate, billing_mode,
               billing_cycle, server_expiry)

-- Customers
customer (id, company, group, customerid, address1, address2, address3,
          pincode, area, state, city, gstin, email, mobile, person,
          remarks, status, date, grade, aging_days,
          lastvisitdate, lastvisitperson)

-- Server ↔ Customer links
cloud_mappings (id, server_id, customer_id, serial_no, status,
                mapped_at, billed_users, purchase_users)

-- Billing transactions
cloud_activities (id, customer_id, customer_name, server_name, sof_no,
                  activity_date, activity_type, bill_type,
                  billing_units, purchase_units, last_bill_rate,
                  purchase_rate, billing_cycle,
                  old_expiry_date, bill_amount, purchase_amount)

-- TDL project management
cloud_tdl_master (id, customer_id, customer_name, person_name,
                  phone_no, status, priority, description,
                  handled_by, total_amount, project_name,
                  expiry_date, created_at, updated_at)

cloud_tdl_requirements (id, tdl_id, requirement, amount, attachment,
                        development_days, dev_status, req_status)

cloud_tdl_tasks (id, req_id, user_name, task_type, allotment_date,
                 deadline, completion_date, status, remark)

-- Attendance
cloud_attendance_log (id, user_id, check_in_time, check_out_time,
                      check_in_lat, check_in_lng, check_out_lat,
                      check_out_lng, location_tag, date)

-- Field visits
cloud_visits (id, customer_id, customer_name, assigned_to,
              visit_type, status, scheduled_date, completed_date,
              remarks, created_by, created_at)
```

### Schema Evolution

18+ migration files in `backend/src/database/migrations/` manage schema changes sequentially via TypeORM migrations.

---

## Security Architecture

### Authentication Flow

```
1. POST /api/auth/login  { email, password }
        │
        ▼
2. bcryptjs.compare(password, hash)
        │
        ▼
3. If 2FA enabled → client must send TOTP code
4.     speakeasy.totp.verify(secret, token)
        │
        ▼
5. jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '24h' })
6. Store session row in cloud_user_sessions
        │
        ▼
7. Return { access_token, user }
```

### Authorization (per request)

```
Authorization: Bearer <token>
        │
JwtAuthGuard: jwt.verify(token) → fetch user row → attach to request
        │
PermissionsGuard: read @RequirePermission('servers', 'edit')
                  → check user.permissions.servers.edit === true
        │
Controller executes (or returns 403)
```

### Permission Object (per user)

```json
{
  "servers":           { "view": true,  "create": false, "edit": false, "delete": false },
  "customers_our":     { "view": true,  "create": false, "edit": false, "delete": false },
  "customers_not_our": { "view": true,  "create": false, "edit": false, "delete": false },
  "mappings":          { "view": true,  "create": false, "edit": false, "delete": false },
  "users":             { "view": false, "create": false, "edit": false, "delete": false },
  "activities":        { "view": true,  "create": false, "edit": false, "delete": false },
  "tdl":               { "view": false, "create": false, "edit": false, "delete": false },
  "tasks":             { "view": true,  "view_history": false },
  "visits_our":        { "view": true,  "create": false },
  "visits_not_our":    { "view": true,  "create": false },
  "pincodes":          { "view": false }
}
```

Admins bypass all permission checks. Non-admins are limited by this JSON object stored in `cloud_users.permissions`.

---

## Business Logic Highlights

### Billing Calculation

```
bill_amount = billing_units × last_bill_rate × cycle_months
purchase_amount = purchase_units × purchase_rate × cycle_months

cycle_months:
  Monthly      → 1
  Quarterly    → 3
  Half-Yearly  → 6
  Yearly       → 12
```

Renewal defaults are auto-calculated from the customer's last activity record, so operators don't manually re-enter rates.

### TDL Project Lifecycle

```
Quotation → In Progress → Implementation → Testing → Completed
                                                  ↘ On Hold
```

Each project has requirements, each requirement has tasks assigned to developers with deadlines.

### Customer Aging

`aging_days` in the `customer` table tracks how many days since the last billing activity. This drives "at-risk" customer identification on the dashboard.

### Attendance & Geofencing

On check-in, the device GPS coordinates are compared against configured office boundaries. The result (`Inside` / `Outside`) is stored as `location_tag` for HR reporting.

---

## Deployment

### Docker (Recommended)

```yaml
# docker-compose.yml
services:
  backend:   nestjs → port 3001
  frontend:  nginx  → port 3000 (proxies /api → backend:3001)
  ngrok:     tunnel → port 4040
```

### cPanel / Shared Hosting (.htaccess)

```apache
# Proxy API calls to local Node process
RewriteRule ^api/(.*)$ http://localhost:5000/api/$1 [P,L]

# SPA fallback
RewriteRule ^ /index.html [L]
```

### Environment Variables

**Backend** (`.env`)
```
PORT=5000
JWT_SECRET=<strong-secret>
JWT_EXPIRES_IN=24h
DB_HOST=localhost
DB_PORT=3307
DB_USERNAME=root
DB_PASSWORD=<password>
DB_DATABASE=abs_cloud
ENCRYPTION_KEY=<strong-key>
```

**Frontend** (`.env`)
```
REACT_APP_ENABLE_SECURITY=true
```

### PM2 (Direct Node)

```js
// ecosystem.config.js
module.exports = {
  apps: [{ name: 'abscloud-backend', script: 'dist/main.js', port: 5000 }]
}
```

---

## Data Flow Examples

### Adding a Billing Activity

```
Activities page
  → user fills form (customer, server, units, rate, cycle)
  → activitiesApi.create(payload)
  → POST /api/activities
  → JwtAuthGuard + PermissionsGuard('activities', 'create')
  → ActivitiesController.create()
  → ActivitiesService.create()
     → calculates bill_amount, purchase_amount
     → INSERT into cloud_activities
     → updates customer.aging_days
  → returns created record
  → DataContext refreshes activities cache
  → UI re-renders table
```

### Employee Check-In

```
Dashboard (mobile browser)
  → navigator.geolocation.getCurrentPosition()
  → attendanceApi.checkIn({ lat, lng })
  → POST /api/attendance/check-in
  → AttendanceService.checkIn()
     → compares coords to office polygon
     → sets location_tag = 'Inside' | 'Outside'
     → INSERT into cloud_attendance_log
  → returns { status: 'checked-in', location_tag }
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Raw MySQL2 queries in services (vs full ORM) | Allows complex joins and performance tuning without ORM overhead |
| Two context providers (Auth + Data) | Clear separation: identity vs cached data |
| JSON permissions column | Flexible without schema changes when adding new modules |
| 2FA optional per user | Allows gradual rollout; admins can enforce per-user |
| Public TDL view via token | Customers can see project status without an account |
| Single `api.ts` client | One place to update auth headers, base URL, error handling |
| Separate billing_units vs purchase_units | Tracks what was billed to customer vs what was paid to vendor |

---

## Known Constraints

- CORS is open (`*`) — should be restricted in production to the actual frontend origin
- `JWT_SECRET` and `ENCRYPTION_KEY` in `.env` use placeholder values — must be changed before production deployment
- TypeORM entity definitions exist but most database interaction uses raw SQL queries in services
- No API rate limiting middleware is currently configured
- Database runs on non-standard port 3307 (local dev); production may differ
