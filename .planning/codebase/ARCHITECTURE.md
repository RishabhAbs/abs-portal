# Architecture

## Pattern

**Full-Stack Monolithic SPA with Microservices-ready Design**

ABS Cloud follows a **layered monolithic architecture** with clear separation of concerns:
- **Frontend**: React 19 SPA with routing and context-based state management
- **Backend**: NestJS REST API with modular service-based architecture
- **Database**: Centralized MySQL 8 with raw queries (no full ORM)

The design allows for future migration to microservices by keeping modules independent with separate service files.

---

## Layers

### Frontend Layers (React)

```
┌─────────────────────────────────────────┐
│  Pages (22 Components)                  │
│  - High-level features                  │
│  - Route-based organization             │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Components (UI)                        │
│  - Shared UI (FilterModal, Pagination)  │
│  - Layout (Navbar, Sidebar, Footer)     │
│  - Specialized (DateInput, InfoButton)  │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Context Providers (State)              │
│  - AuthContext (identity + permissions) │
│  - DataContext (cached API data)        │
│  - ToastProvider (notifications)        │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Services (API Client)                  │
│  - api.ts (fetch wrapper + endpoints)   │
│  - authApi, serversApi, etc.            │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Utils                                  │
│  - Security helpers                     │
│  - Date utilities                       │
│  - Format helpers                       │
└─────────────────────────────────────────┘
```

### Backend Layers (NestJS)

```
┌────────────────────────────────────────┐
│  Controllers (HTTP)                    │
│  - Route handlers                      │
│  - Input validation                    │
│  - Call services                       │
└────────────────┬───────────────────────┘
                 │
         ┌───────▼────────┐
         │ Guards/Pipes   │
         │  - JwtAuthGuard│
         │  - Permissions │
         └───────┬────────┘
                 │
┌────────────────▼───────────────────────┐
│  Services (Business Logic)             │
│  - Core application logic              │
│  - Database queries via DbService      │
│  - Data transformation                 │
└────────────────┬───────────────────────┘
                 │
┌────────────────▼───────────────────────┐
│  Database Service (DbService)          │
│  - Connection pooling                  │
│  - Query execution wrapper             │
│  - Transaction management              │
└────────────────┬───────────────────────┘
                 │
┌────────────────▼───────────────────────┐
│  MySQL 8 Database                      │
│  - 13+ tables                          │
│  - Raw SQL queries (mysql2/promise)    │
└────────────────────────────────────────┘
```

---

## Data Flow

### Request-Response Lifecycle

```
1. Frontend (React Component)
   ├─ User interaction (form submit, button click)
   └─ Calls API function from api.ts

2. API Client (api.ts)
   ├─ Adds JWT token from localStorage
   ├─ Makes fetch request
   └─ Returns JSON response

3. HTTP Request
   └─ POST /api/endpoint with Authorization: Bearer <token>

4. NestJS Server
   ├─ main.ts: Applies global middleware (helmet, compression, CORS)
   ├─ Router: Matches route to controller method
   └─ Controller execution:
      ├─ JwtAuthGuard: Validates token, loads user
      ├─ PermissionsGuard: Checks @RequirePermission() decorator
      ├─ Controller method: Validates DTO, calls service
      └─ Service: Executes business logic

5. Database Interaction
   ├─ Service calls: this.db.query(), this.db.execute(), this.db.withTransaction()
   ├─ DbService: Manages connection pool, executes prepared statements
   └─ MySQL: Returns rows/results

6. Response
   ├─ Service returns data to controller
   ├─ Controller returns JSON response
   ├─ NestJS: Serializes response
   └─ HTTP 200/400/401/403/500 + JSON body

7. Frontend (React)
   ├─ Promise resolves with response
   ├─ Component updates state
   ├─ Context updates (DataContext, Redux)
   └─ Component re-renders
```

### Authentication Flow

```
Login Request
    ↓
POST /api/auth/login { email, password, otp?, secret? }
    ↓
AuthService.login()
    ├─ Validate password with bcryptjs
    ├─ Check 2FA if enabled
    │  └─ Verify TOTP with speakeasy
    ├─ Generate JWT token
    ├─ Create session in cloud_user_sessions
    └─ Return { success, token, user }
    ↓
Frontend
    ├─ Store token in localStorage
    ├─ Store user in AuthContext
    └─ Redirect to dashboard
```

### Protected Endpoint Flow

```
Authenticated Request
    ↓
Authorization: Bearer <JWT>
    ↓
JwtAuthGuard
    ├─ Extract token from header
    ├─ Verify JWT signature
    ├─ Fetch full user from database
    └─ Attach user to request.user
    ↓
PermissionsGuard (@RequirePermission('entity', 'action'))
    ├─ Check if user is admin → bypass
    ├─ Check user.permissions[entity][action]
    └─ Allow or throw 403 Forbidden
    ↓
Controller Method Executes
```

---

## Key Abstractions

### Core Interfaces & Types

**Frontend**

```typescript
// User with permissions
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  permissions: UserPermissions;
  is_two_fa_enabled?: boolean;
}

interface UserPermissions {
  servers: { view, create, edit, delete };
  customers_our: { view, create, edit, delete };
  mappings: { view, create, edit, delete };
  // ... etc for other entities
}

// Data entities cached in DataContext
interface Server { id, server_ip, port, status, ... }
interface Customer { id, company, email, address, ... }
interface Mapping { id, server_id, customer_id, serial_no, ... }
interface Activity { id, customer_name, activity_type, bill_amount, ... }
```

**Backend**

```typescript
// NestJS Module Pattern
@Module({
  imports: [DbModule, ConfigModule],
  controllers: [SomeController],
  providers: [SomeService, ...],
})
export class SomeModule {}

// Service Pattern
@Injectable()
export class SomeService {
  constructor(private db: DbService) {}

  async findAll(): Promise<Entity[]> {
    return this.db.query<Entity>('SELECT * FROM table', []);
  }
}

// Controller Pattern
@Controller('api/some')
export class SomeController {
  constructor(private service: SomeService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('entity', 'view')
  async getAll() {
    return this.service.findAll();
  }
}
```

### Permission System

```typescript
// Stored in cloud_users.permissions (JSON)
type EntityPermission = {
  view: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
};

// Evaluated in PermissionsGuard
if (user.role === 'admin') {
  // Admins bypass all checks
  return true;
}

// Regular users checked against permissions object
const canDo = user.permissions[entity]?.[action] === true;
```

### Error Handling Pattern

```typescript
// Backend: DbService handles errors
private handleError(error: any, sql: string) {
  return {
    code: error.code,
    message: error.message,
    solution: this.getSolution(error.code)
  };
}

// Frontend: ApiError custom class
export class ApiError extends Error {
  constructor(public message: string, public status: number) {
    super(message);
  }
}

// Usage: try/catch or .catch() with ApiError check
```

---

## Entry Points

### Backend Entry Points

- **`backend/src/main.ts`** - NestJS bootstrap
  - Creates app instance
  - Enables middleware (Helmet, compression, CORS)
  - Sets up Swagger docs at `/api/docs`
  - Configures global error handler
  - Listens on PORT (default 5000)

- **`backend/src/app.module.ts`** - Root module
  - Imports all feature modules
  - Configures JWT
  - Registers services and controllers
  - Imports database module

- **`backend/src/database/db.module.ts`** - Database initialization
  - Initializes MySQL pool
  - Provides DbService
  - Manages connections

### Frontend Entry Points

- **`frontend/src/index.tsx`** - React DOM root
  - Renders React app into #root element
  - Initializes performance monitoring

- **`frontend/src/App.tsx`** - Root component
  - Sets up Router and Routes
  - Wraps with context providers (ToastProvider, AuthProvider, DataProvider)
  - Defines all route structure
  - Implements ProtectedRoute wrapper for authentication

- **`frontend/src/pages/Login.tsx`** - Authentication entry
  - Login form with 2FA support
  - OTP input and setup flows
  - Session management

---

## Module Map

### Backend Modules

**AuthModule** (`src/services/auth.service.ts` + `src/controllers/auth.controller.ts`)
- Login with email/password
- 2FA (TOTP) setup, enable, disable
- Password change with 2FA
- Session management
- User profile retrieval

**UsersModule** (`src/services/users.service.ts` + `src/controllers/users.controller.ts`)
- User CRUD operations
- Permission management
- Password hashing (bcryptjs)
- 2FA secret storage
- User validation

**ServersModule** (`src/services/servers.service.ts` + `src/controllers/servers.controller.ts`)
- Cloud server inventory management
- Server IP, port, credentials (encrypted)
- Status tracking (Active/Inactive/Maintenance)
- Purchase vs billing rates
- Server expiry date tracking

**CustomersModule** (`src/services/customers.service.ts` + `src/controllers/customers.controller.ts`)
- Customer master records
- Two categories: "Our Customers" (active) vs "Not Our Customers" (prospects)
- Contact info, address, GST
- Aging calculation (days since last activity)
- Last visit tracking

**MappingsModule** (`src/services/mappings.service.ts` + `src/controllers/mappings.controller.ts`)
- Link servers to customers (many-to-many)
- Serial number per mapping
- Billed users vs purchase users count
- Unmapped customer finder

**ActivitiesModule** (`src/services/activities.service.ts` + `src/controllers/activities.controller.ts`)
- Billing transactions (Sale, Purchase, Credit Note)
- Bill amount calculation
- Billing cycles (Monthly/Quarterly/Half-Yearly/Yearly)
- Revenue aggregation
- Renewal defaults helper

**TdlModule** (`src/services/tdl.service.ts` + `src/controllers/tdl.controller.ts`)
- Task Definition List (project customizations)
- Three-level hierarchy: Master → Requirements → Tasks
- File attachments
- Public access via token (no auth)
- Project status tracking (Quotation → Completed)

**VisitsModule** (`src/services/visits.service.ts` + `src/controllers/visits.controller.ts`)
- Field visit scheduling
- Status tracking (Pending/Completed)
- Assignment to staff
- Visit types and remarks

**AttendanceModule** (`src/services/attendance.service.ts` + `src/controllers/attendance.controller.ts`)
- GPS-based check-in/check-out
- Geofencing (Inside/Outside office)
- Attendance history logs

**DashboardModule** (`src/services/dashboard.service.ts` + `src/controllers/dashboard.controller.ts`)
- KPI aggregations
- Active servers count
- Active customers count
- Monthly revenue
- Pending tasks count

**PincodeModule** (`src/services/pincode.service.ts` + `src/controllers/pincode.controller.ts`)
- Pincode master data
- Area lookup

**StateModule** (`src/services/state.service.ts` + `src/controllers/state.controller.ts`)
- State/region master data

**AuditModule** (`src/services/audit.service.ts`)
- User action logging (login, logout, CRUD operations)
- IP address tracking
- User agent tracking

### Frontend Pages (22 Components)

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Authentication with 2FA |
| Dashboard | `/` | KPIs, stats, quick actions |
| Servers | `/cloud/servers` | Cloud server inventory |
| CustomerList | `/customers` | Customer master |
| Mapping | `/cloud/mapping` | Server ↔ Customer linking |
| Activities | `/cloud/activity` | Billing transactions |
| Users | `/users` | User management (admin) |
| Customization | `/tdl` | Project/TDL management |
| TaskManagement | `/tdl/tasks/:tdlId/:reqId` | Task assignment |
| TaskReport | `/task-report` | Task analytics |
| PendingVisits | `/pending-visits` | Field visit scheduling |
| LastVisitReport | `/visit-report` | Visit history |
| Network | `/network` | Live location map |
| AttendanceHistory | `/attendance` | Employee attendance |
| Pincode | `/pincodes` | Pincode master |
| Profile | `/profile` | User settings, 2FA |
| AmcPublicView | `/tdl/amc/:token` | Public project view |
| ConnectMap | `/connect-map` | Connectivity map |
| RequirementReport | `/req-report` | TDL requirements |
| Activity (legacy) | `/activity` | Billing (redirect) |
| Settings | `/settings` | System settings |
| AttendanceHistory | `/attendance` | Attendance tracking |

---

## Frontend Architecture

### State Management Strategy

**AuthContext** - Identity & Session
- Manages logged-in user (name, email, role, permissions)
- Provides permission checkers: `canView()`, `canCreate()`, `canEdit()`, `canDelete()`
- Handles login/logout flow
- Manages 30-minute session timeout
- Stores JWT in localStorage with timestamp

**DataContext** - Data Cache
- Caches servers, customers, mappings, activities after first fetch
- Provides helper methods:
  - `getMappingByCustomer(customerId)`
  - `getServerById(serverId)`
  - `getTotalRevenue()`
- Updates on mutations (create/update/delete)
- Prevents redundant API calls

**ToastProvider** - Notifications
- Global toast/notification management
- Shows success, error, info messages

### Component Hierarchy

```
App
├── Router
│   ├── Routes
│   │   ├── /login → Login page
│   │   ├── /tdl/amc/:token → AmcPublicView (no auth)
│   │   └── ProtectedRoute
│   │       └── Layout (main structure)
│   │           ├── Navbar
│   │           ├── Sidebar
│   │           ├── MainContent (routes)
│   │           └── Footer
│   │
│   └── Context Providers
│       ├── ToastProvider
│       ├── AuthProvider (AuthContext)
│       └── DataProvider (DataContext)
```

### Routing Structure

```typescript
// Main routes in App.tsx
/login                              - Public
/tdl/amc/:token                     - Public (TDL view)
/                                   - Protected (Dashboard)
  ├── profile                       - Profile settings
  ├── cloud/
  │   ├── servers                   - Server management
  │   ├── mapping                   - Server-customer links
  │   └── activity/
  │       ├── billing               - Sales activities
  │       └── purchase              - Purchase activities
  ├── tdl/
  │   ├── customization             - Project master
  │   └── tasks/:tdlId/:reqId       - Task management
  ├── visit/
  │   ├── last-visit-report         - Historical visits
  │   └── map                       - Connectivity map
  ├── task-report                   - Analytics
  ├── pending-visits                - Visit scheduling
  ├── customers                     - Customer master
  ├── pincodes                      - Pincode master
  ├── users                         - User management
  ├── network                       - Live location map
  ├── attendance                    - Attendance logs
  └── settings                      - System config
```

### API Client Pattern

**`frontend/src/services/api.ts`**
- Single fetch wrapper with:
  - Automatic JWT token injection from localStorage
  - Error handling with ApiError class
  - 401 handling (redirect to login)
  - Content-Type JSON header

- Organized API method groups:
  - `authApi` - Login, 2FA, profile
  - `serversApi` - CRUD + filtering
  - `customersApi` - CRUD + filtering
  - `mappingsApi` - Link/unlink + finder
  - `activitiesApi` - Transactions + aggregation
  - `usersApi` - User management
  - `tasksApi` - Task CRUD
  - `visitsApi` - Visit scheduling
  - `attendanceApi` - Check-in/out
  - `tdlApi` - Project management

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| React Context + Redux | Context for app state (auth, data), Redux for UI state (modals, filters) |
| JWT + TOTP 2FA | Stateless auth, secure for stateless APIs, TOTP for MFA |
| Raw MySQL queries | More control over performance vs ORM overhead; complex joins easier |
| Modular services | Easy to refactor into microservices; single responsibility |
| DbService wrapper | Centralized error handling, transaction management, prepared statements |
| JSON permissions column | Flexible without schema changes; easy to add new entities |
| PermissionsGuard | Reusable decorator-based permission checking |
| Single api.ts | One place for auth headers, base URL, error handling |
| localStorage for token | Persists across browser refreshes; susceptible to XSS (mitigated by CSP) |
| Separate billing_units vs purchase_units | Tracks what was billed to customer vs what was paid to vendor |

---

## Key Patterns

### Controller Pattern (NestJS)

```typescript
@Controller('api/resource')
@UseGuards(JwtAuthGuard)
export class ResourceController {
  constructor(private service: ResourceService) {}

  @Get()
  @RequirePermission('resource', 'view')
  async getAll(@Query() pagination: PaginationDto) {
    return this.service.findAll(pagination);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermission('resource', 'create')
  async create(@Body() dto: CreateDto) {
    return this.service.create(dto);
  }
}
```

### Service Pattern (NestJS)

```typescript
@Injectable()
export class ResourceService {
  constructor(private db: DbService) {}

  async findAll(filter?: any): Promise<Resource[]> {
    const sql = 'SELECT * FROM table WHERE status = ?';
    return this.db.query<Resource>(sql, ['Active']);
  }

  async create(data: CreateDto): Promise<Resource> {
    return this.db.withTransaction(async (conn) => {
      const result = await this.db.execute(
        'INSERT INTO table SET ?',
        [data],
        conn
      );
      return { id: result.insertId, ...data };
    });
  }
}
```

### Component Pattern (React)

```typescript
const MyPage: React.FC = () => {
  const { data, isLoading, error } = useContext(DataContext);
  const { canView } = useContext(AuthContext);

  if (!canView('entity')) return <PermissionDenied />;
  if (isLoading) return <Loading />;
  if (error) return <Error message={error} />;

  return (
    <div>
      <header>{/* ... */}</header>
      <table>{/* ... */}</table>
      <footer>{/* ... */}</footer>
    </div>
  );
};
```

### Guard Pattern (NestJS)

```typescript
// Use multiple guards
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('entity', 'action')
async protectedMethod() {}

// Guard checks:
// 1. JwtAuthGuard: Validates token, loads user
// 2. PermissionsGuard: Checks decorator, evaluates user.permissions
// 3. Method executes if both pass
```
