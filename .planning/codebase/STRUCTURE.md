# Project Structure

## Directory Layout

```
abscloud/
│
├── .planning/codebase/
│   ├── ARCHITECTURE.md                 # Architecture patterns and design
│   └── STRUCTURE.md                    # This file - directory and file reference
│
├── backend/                            # NestJS API Server
│   ├── src/
│   │   ├── controllers/                # HTTP route handlers (16 files)
│   │   │   ├── auth.controller.ts      # Login, 2FA, profile routes
│   │   │   ├── users.controller.ts     # User CRUD endpoints
│   │   │   ├── servers.controller.ts   # Cloud server management
│   │   │   ├── customers.controller.ts # Customer master endpoints
│   │   │   ├── mappings.controller.ts  # Server-customer linking
│   │   │   ├── activities.controller.ts# Billing transaction routes
│   │   │   ├── tdl.controller.ts       # Project management routes
│   │   │   ├── visits.controller.ts    # Field visit endpoints
│   │   │   ├── attendance.controller.ts# Check-in/out routes
│   │   │   ├── dashboard.controller.ts # KPI endpoints
│   │   │   ├── pincode.controller.ts   # Pincode lookup
│   │   │   ├── state.controller.ts     # State/region lookup
│   │   │   ├── admins.controller.ts    # Admin utilities
│   │   │   ├── debug.controller.ts     # Debug endpoints
│   │   │   ├── spa-fallback.controller.ts
│   │   │   └── index.ts                # Export barrel
│   │   │
│   │   ├── services/                   # Business logic (14 files)
│   │   │   ├── auth.service.ts         # Authentication (login, 2FA, JWT)
│   │   │   ├── users.service.ts        # User management & validation
│   │   │   ├── servers.service.ts      # Server inventory operations
│   │   │   ├── customers.service.ts    # Customer data management
│   │   │   ├── mappings.service.ts     # Server-customer link logic
│   │   │   ├── activities.service.ts   # Billing calculation (102 KB!)
│   │   │   ├── tdl.service.ts          # Project/task management (53 KB)
│   │   │   ├── visits.service.ts       # Visit scheduling logic
│   │   │   ├── attendance.service.ts   # Geolocation & attendance
│   │   │   ├── dashboard.service.ts    # KPI aggregation
│   │   │   ├── pincode.service.ts      # Pincode lookup
│   │   │   ├── state.service.ts        # State data
│   │   │   ├── audit.service.ts        # Action logging
│   │   │   ├── index.ts                # Export barrel
│   │   │   └── [KEY: Complex logic here]
│   │   │
│   │   ├── database/                   # DB initialization & migrations
│   │   │   ├── data-source.ts          # TypeORM config (DataSource)
│   │   │   ├── db.module.ts            # Database module
│   │   │   ├── db.service.ts           # Connection pool & query wrapper
│   │   │   └── migrations/             # 18+ TypeORM migration files
│   │   │       ├── 1***.ts             # Schema changes (sequential)
│   │   │       └── ...
│   │   │
│   │   ├── guards/                     # Request-level security
│   │   │   ├── jwt-auth.guard.ts       # JWT token validation
│   │   │   └── permissions.guard.ts    # Permission evaluation
│   │   │
│   │   ├── decorators/                 # Custom NestJS decorators
│   │   │   └── permissions.decorator.ts# @RequirePermission() decorator
│   │   │
│   │   ├── utils/                      # Helper functions
│   │   │   ├── crypto.util.ts          # Encryption/decryption
│   │   │   └── date.util.ts            # Date formatting (IST)
│   │   │
│   │   ├── scripts/                    # Utility scripts
│   │   │   └── ...
│   │   │
│   │   ├── app.module.ts               # Root NestJS module (imports all)
│   │   └── main.ts                     # Bootstrap: Helmet, CORS, Swagger
│   │
│   ├── dist/                           # Compiled output (TypeScript → JS)
│   ├── node_modules/                   # Dependencies
│   ├── uploads/                        # File storage directory
│   │
│   ├── ecosystem.config.js             # PM2 process configuration
│   ├── package.json                    # Backend dependencies (NestJS, MySQL2, JWT, etc.)
│   ├── package-lock.json               # Dependency lock
│   ├── tsconfig.json                   # TypeScript config
│   ├── nest-cli.json                   # NestJS CLI config
│   ├── Dockerfile                      # Docker build
│   └── .env.example                    # Environment template
│
├── frontend/                           # React SPA
│   ├── public/                         # Static assets
│   │   ├── index.html                  # HTML entry point
│   │   ├── favicon.ico
│   │   ├── manifest.json
│   │   └── robots.txt
│   │
│   ├── src/
│   │   ├── pages/                      # 22 page-level components
│   │   │   ├── Login.tsx               # Authentication page (2FA support)
│   │   │   ├── Dashboard.tsx           # KPI dashboard
│   │   │   ├── Servers.tsx             # Cloud server inventory
│   │   │   ├── CustomerList.tsx        # Customer master
│   │   │   ├── Mapping.tsx             # Server-customer linking UI
│   │   │   ├── Activities.tsx          # Billing transactions (largest: 135 KB)
│   │   │   ├── Customization.tsx       # TDL project master (68 KB)
│   │   │   ├── TaskManagement.tsx      # Task assignment & tracking
│   │   │   ├── TaskReport.tsx          # Task analytics (107 KB)
│   │   │   ├── PendingVisits.tsx       # Visit scheduling (74 KB)
│   │   │   ├── LastVisitReport.tsx     # Visit history (48 KB)
│   │   │   ├── Network.tsx             # Live location map (46 KB)
│   │   │   ├── ConnectMap.tsx          # Connectivity visualization (20 KB)
│   │   │   ├── AttendanceHistory.tsx   # Attendance logs (16 KB)
│   │   │   ├── Servers.tsx             # Server management (53 KB)
│   │   │   ├── Users.tsx               # User management (admin)
│   │   │   ├── Pincode.tsx             # Pincode master
│   │   │   ├── Profile.tsx             # User profile & 2FA setup
│   │   │   ├── Settings.tsx            # System settings
│   │   │   ├── AmcPublicView.tsx       # Public TDL project view (no auth)
│   │   │   ├── RequirementReport.tsx   # TDL requirements analytics
│   │   │   ├── Activity.tsx            # Activity wrapper
│   │   │   └── [KEY: Complex UI logic in these pages]
│   │   │
│   │   ├── components/                 # Reusable UI components
│   │   │   ├── Layout/
│   │   │   │   └── Layout.tsx          # Main app wrapper (26 KB)
│   │   │   │       # Contains: Navbar, Sidebar, Footer, Routes container
│   │   │   │
│   │   │   ├── Shared/
│   │   │   │   ├── FilterModal.tsx     # Generic filter UI
│   │   │   │   └── PaginationControls.tsx
│   │   │   │
│   │   │   ├── DateInput/
│   │   │   │   └── DateInput.tsx       # Custom date picker
│   │   │   │
│   │   │   ├── InfoButton/
│   │   │   │   └── InfoButton.tsx      # Tooltip helper
│   │   │   │
│   │   │   ├── Toast/
│   │   │   │   └── Toast.tsx           # Toast notifications
│   │   │   │
│   │   │   ├── PermissionGuard.tsx     # Permission wrapper
│   │   │   ├── ProtectedRoute.tsx      # Auth wrapper
│   │   │   └── SessionLockModal.tsx    # Session lock/unlock UI
│   │   │
│   │   ├── context/                    # State management providers
│   │   │   ├── AuthContext.tsx         # Auth + permissions (14 KB)
│   │   │   │   # Manages: login, logout, permissions, 2FA, session timeout
│   │   │   │   # Exports: user, isAuthenticated, canView(), canCreate(), etc.
│   │   │   │
│   │   │   └── DataContext.tsx         # Data cache (20 KB)
│   │   │       # Caches: servers, customers, mappings, activities
│   │   │       # Provides: helpers like getMappingByCustomer(), getTotalRevenue()
│   │   │
│   │   ├── services/
│   │   │   └── api.ts                  # API client (23 KB)
│   │   │       # Exports: authApi, serversApi, customersApi, ...
│   │   │       # Features: JWT injection, error handling, endpoint grouping
│   │   │
│   │   ├── utils/
│   │   │   ├── security.ts             # CSP, XSS protection
│   │   │   ├── dateUtils.ts            # Date formatting
│   │   │   └── ...
│   │   │
│   │   ├── App.tsx                     # Root component (route definitions)
│   │   ├── index.tsx                   # React DOM render
│   │   ├── index.css                   # Global styles
│   │   └── setupTests.ts               # Test configuration
│   │
│   ├── build/                          # Production build output
│   ├── node_modules/                   # Dependencies
│   ├── public/
│   │   └── ...
│   │
│   ├── package.json                    # Frontend dependencies (React, Redux, Tailwind, etc.)
│   ├── package-lock.json               # Dependency lock
│   ├── tsconfig.json                   # TypeScript config
│   ├── tailwind.config.js              # Tailwind CSS config
│   ├── nginx.conf                      # Nginx configuration
│   ├── Dockerfile                      # Docker build
│   └── .env.example                    # Environment template
│
├── .git/                               # Git repository
├── .gitignore                          # Git ignore rules
│
├── docker-compose.yml                  # Docker Compose (backend + frontend + ngrok)
├── ecosystem.config.js                 # Root PM2 config
├── .htaccess                           # Apache cPanel proxy rules
├── ARCHITECTURE.md                     # (Root) Architecture overview
│
├── package.json                        # Root package (minimal)
├── package-lock.json
│
└── ngrok.yml                           # Ngrok tunnel config
```

---

## Key Locations

### Backend Structure

**Controllers**: `backend/src/controllers/`
- 16 files mapping HTTP routes to service methods
- All decorated with `@Controller('api/...')` for REST endpoints
- Use `@UseGuards(JwtAuthGuard, PermissionsGuard)` for protection
- Validation via DTOs and class-validator

**Services**: `backend/src/services/`
- 14 files containing business logic
- All decorated with `@Injectable()` for DI
- Interact with database via `DbService`
- Handle calculations, validations, transformations
- Largest files: activities.service.ts (102KB), tdl.service.ts (53KB)

**Database**: `backend/src/database/`
- `db.service.ts` - Connection pool, query wrapper, error handling
- `data-source.ts` - TypeORM DataSource config
- `db.module.ts` - DI module registration
- `migrations/` - 18+ TypeORM migration files for schema versioning

**Guards**: `backend/src/guards/`
- `jwt-auth.guard.ts` - Token validation, user loading
- `permissions.guard.ts` - Permission evaluation via decorator

**Decorators**: `backend/src/decorators/`
- `permissions.decorator.ts` - `@RequirePermission('entity', 'action')`

**Entry Points**:
- `backend/src/main.ts` - Bootstrap, middleware setup, Swagger
- `backend/src/app.module.ts` - Module imports, global config

### Frontend Structure

**Pages**: `frontend/src/pages/`
- 22 route-based components
- Each handles a specific feature area
- Largest files: Activities (135KB), TaskReport (107KB), PendingVisits (74KB)
- Use DataContext and AuthContext for state

**Components**: `frontend/src/components/`
- Reusable UI elements
- Layout: Navbar, Sidebar, Footer
- Shared: FilterModal, PaginationControls
- Specialized: DateInput, InfoButton
- Auth: PermissionGuard, ProtectedRoute, SessionLockModal

**Context**: `frontend/src/context/`
- `AuthContext.tsx` - User, permissions, login/logout, 2FA
- `DataContext.tsx` - Cached servers, customers, mappings, activities

**Services**: `frontend/src/services/`
- `api.ts` - Single API client with JWT injection, error handling

**Entry Points**:
- `frontend/src/index.tsx` - React root render
- `frontend/src/App.tsx` - Router and route definitions

---

## Naming Conventions

### Backend Files

| Pattern | Example | Purpose |
|---------|---------|---------|
| `*.controller.ts` | `users.controller.ts` | HTTP route handlers |
| `*.service.ts` | `users.service.ts` | Business logic |
| `*.guard.ts` | `jwt-auth.guard.ts` | Request middleware |
| `*.decorator.ts` | `permissions.decorator.ts` | Custom NestJS decorators |
| `*.module.ts` | `app.module.ts` | DI module definitions |
| `*.util.ts` | `crypto.util.ts` | Utility functions |

### Frontend Files

| Pattern | Example | Purpose |
|---------|---------|---------|
| `*.tsx` (Pages) | `Dashboard.tsx` | Route-level components |
| `*.tsx` (Components) | `Layout.tsx` | Reusable UI |
| `*.ts` (Services) | `api.ts` | Data/API layer |
| `*.tsx` (Context) | `AuthContext.tsx` | State providers |
| `*.css` | `index.css` | Global styles |

### Naming Style

- **Backend**:
  - camelCase for files: `authService.ts`, `jwtAuthGuard.ts`
  - PascalCase for classes: `AuthService`, `JwtAuthGuard`

- **Frontend**:
  - PascalCase for component files: `Dashboard.tsx`, `FilterModal.tsx`
  - camelCase for utility files: `api.ts`, `dateUtils.ts`

---

## Important Files

### Backend Core

| File | Size | Purpose |
|------|------|---------|
| `backend/src/main.ts` | ~80 lines | Bootstrap, middleware setup, error handler |
| `backend/src/app.module.ts` | ~80 lines | Module imports, DI configuration |
| `backend/src/database/db.service.ts` | ~200 lines | Connection pool, query wrapper |
| `backend/src/services/auth.service.ts` | ~150 lines | Login, 2FA, JWT generation |
| `backend/src/services/users.service.ts` | ~200 lines | User CRUD, password hashing |
| `backend/src/services/activities.service.ts` | 102 KB | Billing logic (largest) |
| `backend/src/services/tdl.service.ts` | 53 KB | Project/task management |
| `backend/src/guards/jwt-auth.guard.ts` | ~45 lines | Token validation |
| `backend/src/guards/permissions.guard.ts` | ~40 lines | Permission checking |

### Frontend Core

| File | Size | Purpose |
|------|------|---------|
| `frontend/src/App.tsx` | ~100 lines | Route definitions |
| `frontend/src/index.tsx` | ~20 lines | React root |
| `frontend/src/context/AuthContext.tsx` | 14 KB | Auth state, 2FA, permissions |
| `frontend/src/context/DataContext.tsx` | 20 KB | Data cache, helpers |
| `frontend/src/services/api.ts` | 23 KB | API client, endpoints |
| `frontend/src/components/Layout/Layout.tsx` | 26 KB | Main app structure |
| `frontend/src/pages/Activities.tsx` | 135 KB | Billing UI (largest) |
| `frontend/src/pages/TaskReport.tsx` | 107 KB | Task analytics |
| `frontend/src/pages/PendingVisits.tsx` | 74 KB | Visit scheduling |

### Configuration

| File | Purpose |
|------|---------|
| `backend/package.json` | NestJS, TypeORM, JWT, MySQL2, bcryptjs |
| `frontend/package.json` | React, Redux, Tailwind, Leaflet, Recharts |
| `backend/tsconfig.json` | TypeScript compiler options |
| `frontend/tsconfig.json` | TypeScript compiler options |
| `docker-compose.yml` | Multi-container setup |
| `ecosystem.config.js` | PM2 process management |
| `.htaccess` | Apache cPanel proxy rules |

### Database

| File | Purpose |
|------|---------|
| `backend/src/database/data-source.ts` | MySQL connection config |
| `backend/src/database/db.module.ts` | Database DI setup |
| `backend/src/database/db.service.ts` | Query executor, pool manager |
| `backend/src/database/migrations/` | Schema change history |

---

## Module Dependencies

### Backend Dependencies (in use)

**Core Framework**
- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`

**Authentication**
- `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`
- `bcryptjs` - Password hashing
- `speakeasy` - TOTP 2FA generation

**Database**
- `mysql2` - MySQL driver
- `typeorm` - ORM (configured but mostly raw queries used)
- `@nestjs/typeorm` - TypeORM integration

**API & Docs**
- `@nestjs/swagger` - Swagger/OpenAPI documentation
- `reflect-metadata` - TypeScript metadata reflection

**Utilities**
- `@nestjs/config` - Environment variables
- `@nestjs/schedule` - Scheduled tasks
- `@nestjs/serve-static` - Static file serving
- `compression` - Response compression
- `helmet` - Security headers
- `qrcode` - QR code generation
- `uuid` - ID generation
- `xlsx` - Excel file handling

### Frontend Dependencies (in use)

**Core**
- `react`, `react-dom` - UI library
- `react-router-dom` - Routing
- `typescript` - Type safety

**State Management**
- `@reduxjs/toolkit` - Redux setup
- `react-redux` - Redux bindings

**Styling**
- `tailwindcss` - Utility-first CSS
- `@tailwindcss/forms` - Form components

**UI Components**
- `lucide-react` - Icons
- `recharts` - Charts/graphs
- `leaflet`, `react-leaflet` - Maps
- `leaflet-routing-machine` - Route calculation

**Data**
- `qrcode` - QR codes
- `xlsx` - Excel export

**Development**
- `react-scripts` - Build tool
- `@types/*` - TypeScript definitions

---

## Code Organization Principles

### Backend

1. **Modules over Monoliths**
   - Each feature (auth, servers, etc.) has separate controller + service
   - DbService provides shared data access
   - Guards provide shared security

2. **Service-First Logic**
   - Controllers validate input and delegate
   - Services handle business logic
   - DbService wraps all database access

3. **Guard Chains**
   - JwtAuthGuard always runs first (validates token)
   - PermissionsGuard checks decorators second
   - Allows optional permission checks

4. **Error Handling**
   - DbService.handleError() centralizes DB error responses
   - Global error handler in main.ts catches rest
   - Consistent error format: `{ success, statusCode, message, error }`

### Frontend

1. **Page-First Organization**
   - Pages correspond to routes
   - Each page is mostly self-contained
   - Shared UI in components/ folder

2. **Context for State**
   - AuthContext: who is logged in, what can they do
   - DataContext: what data is cached, helpers to access it
   - Components use useContext to access state

3. **API Client**
   - Single api.ts file
   - Organized by entity/resource groups
   - Consistent error handling
   - JWT token auto-injection

4. **Component Composition**
   - Layout wraps all pages (navigation, sidebar)
   - Pages import Shared components
   - Permission checks via PermissionGuard component

---

## Key Statistics

| Metric | Count |
|--------|-------|
| Backend Controllers | 16 |
| Backend Services | 14 |
| Frontend Pages | 22 |
| Database Migrations | 18+ |
| Total Backend Lines of Code | ~15,000+ |
| Total Frontend Lines of Code | ~20,000+ |
| Database Tables | 13+ |
| API Endpoints | 100+ |

---

## File Size Rankings

### Largest Backend Files
1. activities.service.ts - 102 KB (billing core)
2. tdl.service.ts - 53 KB (project management)
3. servers.service.ts - 11 KB
4. visits.service.ts - 21 KB
5. mappings.service.ts - 18 KB

### Largest Frontend Files
1. Activities.tsx - 135 KB (billing UI)
2. TaskReport.tsx - 107 KB (analytics)
3. PendingVisits.tsx - 74 KB (visit scheduling)
4. Customization.tsx - 68 KB (project master)
5. Mapping.tsx - 57 KB (server linking)

---

## Build & Deployment Structure

```
Backend Build Chain
Source: backend/src/**/*.ts
  ↓ TypeScript Compiler
Compiled: backend/dist/**/*.js
  ↓ Node.js Runtime
Running on: PORT 5000 (docker) or 3001 (local)

Frontend Build Chain
Source: frontend/src/**/*.tsx
  ↓ React Scripts / Webpack
Built: frontend/build/**/*
  ↓ Nginx Server
Served from: PORT 3000 (docker) or 3000 (local)

Deployment
Docker: docker-compose.yml orchestrates both
cPanel: .htaccess proxies /api to Node process
PM2: ecosystem.config.js manages Node process
```

---

## Environment & Configuration

### Backend Configuration Points
- `backend/.env` - Database, JWT, encryption keys
- `backend/package.json` - Dependencies
- `backend/tsconfig.json` - TypeScript options
- `backend/nest-cli.json` - NestJS CLI config
- `backend/ecosystem.config.js` - PM2 process
- `backend/Dockerfile` - Container build

### Frontend Configuration Points
- `frontend/.env` - API URL, security flags
- `frontend/package.json` - Dependencies
- `frontend/tsconfig.json` - TypeScript options
- `frontend/tailwind.config.js` - Tailwind styles
- `frontend/nginx.conf` - Reverse proxy config
- `frontend/Dockerfile` - Container build

### Root Configuration
- `docker-compose.yml` - Orchestrates services
- `ecosystem.config.js` - PM2 process management
- `.htaccess` - Apache proxy rules
- `.gitignore` - Git exclusions

---

## Database Schema Organization

**User Management Tables**
- `cloud_users` - User accounts with permissions
- `cloud_user_sessions` - Session tracking

**Inventory Tables**
- `cloud_servers` - Cloud server records
- `customer` - Customer master
- `cloud_mappings` - Server-customer links

**Operational Tables**
- `cloud_activities` - Billing transactions
- `cloud_tdl_master` - Project master
- `cloud_tdl_requirements` - Project requirements
- `cloud_tdl_tasks` - Developer tasks
- `cloud_visits` - Field visits
- `cloud_attendance_log` - Attendance logs

**Reference Tables**
- `pincodes` - Pincode master
- `states` - State/region master
