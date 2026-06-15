# Code Conventions

## Code Style

### Indentation & Formatting
- **Spaces**: 2 spaces for indentation (configured in ESLint/Prettier)
- **Line Length**: No strict limit enforced, but code is generally readable
- **Semicolons**: Required (semicolon style enforced)
- **Quotes**: Single quotes in TypeScript/JavaScript, double quotes for JSX attributes
- **Formatting Tool**: Prettier is configured (`prettier --write "src/**/*.ts"`)
- **Linting**: ESLint with TypeScript support (`eslint "{src,apps,libs,test}/**/*.ts" --fix`)

### File Organization
- **Backend src structure**: Controllers, Services, Guards, Decorators, Utils, Database modules
- **Frontend src structure**: Pages, Components, Context, Services, Utils
- **Import organization**: External imports first, then internal imports
- **Index files**: Used for barrel exports (e.g., `services/index.ts`, `controllers/index.ts`)

## Naming Patterns

### Files
- **Controllers**: `*.controller.ts` (e.g., `activities.controller.ts`, `auth.controller.ts`)
- **Services**: `*.service.ts` (e.g., `users.service.ts`, `activities.service.ts`)
- **Guards**: `*.guard.ts` (e.g., `jwt-auth.guard.ts`, `permissions.guard.ts`)
- **Decorators**: `*.decorator.ts` (e.g., `permissions.decorator.ts`)
- **Utils**: `*.util.ts` (e.g., `date.util.ts`, `crypto.util.ts`)
- **React Components**: `ComponentName.tsx` or `ComponentName/index.tsx` (PascalCase with TSX extension)
- **React Pages**: `PageName.tsx` (e.g., `Activities.tsx`, `Dashboard.tsx`)
- **React Utilities**: `camelCase.ts` (e.g., `dateUtils.ts`, `renewalUtils.ts`)
- **Test Files**: Not currently used, but convention would be `*.spec.ts` or `*.test.ts`

### Classes
- **Services**: PascalCase + `Service` suffix (e.g., `UsersService`, `ActivitiesService`)
- **Controllers**: PascalCase + `Controller` suffix (e.g., `AuthController`, `ActivitiesController`)
- **Guards**: PascalCase + `Guard` suffix (e.g., `JwtAuthGuard`, `PermissionsGuard`)
- **Data Classes/DTOs**: PascalCase + optional `Dto` suffix (e.g., `LoginDto`, `CalculationRequest`)

### Functions
- **Async Functions**: Regular camelCase naming, prefixed with async keyword
- **Utility Functions**: camelCase (e.g., `getISTDateString()`, `getDaysInMonth()`)
- **React Components**: PascalCase for component functions (e.g., `ActivitiesController`, `ProtectedRoute`)
- **Context Hooks**: `use` prefix (e.g., `useAuth()`, `useData()`, `useToast()`)

### Variables
- **Constants**: UPPER_SNAKE_CASE (e.g., `SESSION_TIMEOUT`, `JWT_EXPIRES_IN`)
- **Regular variables**: camelCase (e.g., `localActivities`, `appliedFilters`)
- **State variables**: camelCase (e.g., `showModal`, `isLoading`)
- **React Props**: camelCase (e.g., `viewMode`, `allowedRoles`)
- **Database field references**: snake_case (e.g., `customer_id`, `server_name`, `billing_units`)

### Database Tables
- **Table Names**: lowercase + snake_case plural or descriptive (e.g., `cloud_users`, `activities`, `servers`)
- **Column Names**: lowercase + snake_case (e.g., `customer_id`, `server_ip`, `sof_no`, `created_at`, `updated_at`)
- **Primary Keys**: Typically `id` (UUID v4 for primary keys)
- **Foreign Keys**: `{table_singular}_id` (e.g., `customer_id`, `server_id`, `user_id`)
- **Timestamps**: `created_at`, `updated_at` in DATETIME format (IST timezone)

### API Routes
- **Base Path**: `/api/` prefix (e.g., `/api/activities`, `/api/servers`, `/api/auth`)
- **Resource Routes**: RESTful pattern with resource name (e.g., `/api/activities`, `/api/users/:id`)
- **Query Parameters**: snake_case (e.g., `?customer_id=123`, `?start_date=2024-01-01`)
- **Sub-resources**: RESTful nested pattern (e.g., `/api/activities/customer/:customerId`)
- **Action routes**: Use verbs for non-CRUD operations (e.g., `/api/activities/generate-for-servers`)

## Common Patterns

### Dependency Injection (Backend)
- NestJS dependency injection pattern using constructor parameters
- Services are injected into controllers and other services
- Global modules (e.g., `DbModule`) exported globally for app-wide availability
- Example: `constructor(private authService: AuthService, private db: DbService) {}`

### Async/Await
- Async/await is used throughout for promise handling
- Try-catch blocks for error handling in services and controllers
- Transaction support: `db.withTransaction()` for database operations
- Never uses old Promise `.then()` chains (fully async/await based)

### Database Access
- **Raw SQL with Parameterized Queries**: Uses `mysql2/promise` for direct SQL execution
- **Query Methods**:
  - `db.query<T>(sql, params)` - SELECT queries returning array
  - `db.queryOne<T>(sql, params)` - SELECT returning single row or null
  - `db.execute(sql, params)` - INSERT/UPDATE/DELETE returning result info
  - `db.withTransaction(operation)` - Wraps operation in MySQL transaction
- **Connection Management**: Pool-based connection management with IST timezone configuration
- **Prepared Statements**: All queries use parameterized statements to prevent SQL injection
- **Error Handling**: Custom error handler that extracts code, message, and provides solutions

### Error Handling (Backend)
- NestJS built-in exceptions: `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `ConflictException`
- Custom error responses include `success` boolean, `statusCode`, `message`, and error details
- Global error filter in `main.ts` handles all exceptions uniformly
- Error handler removes SQL details from responses (security)
- Fallback status code 500 for unexpected errors
- Timestamp included in error responses using IST time format

### Error Handling (Frontend)
- Try-catch blocks for API calls
- Toast notifications for user feedback (custom `useToast()` hook)
- Context-based error state management
- Loading states prevent race conditions

### API Response Format
**Success Response:**
```typescript
{
  success: true,
  data: T,
  message?: string,
  ...rest // Additional fields depending on endpoint
}
```

**Error Response:**
```typescript
{
  success: false,
  statusCode: number,
  message: string,
  error?: {
    code: string,
    solution: string
  },
  timestamp: string,
  path: string
}
```

**Paginated Response:**
```typescript
{
  success: true,
  data: T[],
  total: number,
  page: number,
  limit: number
}
```

### State Management (Frontend)

**React Context API**:
- Multiple context providers: `AuthContext`, `DataContext`, `ToastContext`
- Context providers wrap the entire app in `App.tsx`
- Custom hooks for consuming context: `useAuth()`, `useData()`, `useToast()`

**Auth Context**:
- Manages user authentication state, permissions, and user CRUD
- Handles login/logout, JWT token storage in localStorage
- Session timeout tracking (30 minutes, currently disabled for auto-logout)
- User permission checks: `canView()`, `canCreate()`, `canEdit()`, `canDelete()`

**Data Context**:
- Manages server, customer, mapping, and activity data
- Lazy-loads data via API calls on component mount
- Provides helper functions for data lookups and calculations
- Caching mechanism to reduce redundant API calls

**Component State**:
- Local state with `useState()` for form inputs and UI state
- Derived state calculations for filtering and pagination
- `useEffect()` for side effects and data loading
- `useCallback()` for memoized event handlers and functions

### Timezone Management
- All database timestamps use IST (Indian Standard Time, UTC+05:30)
- Database connection set to timezone '+05:30'
- Date utility functions handle IST conversions: `getISTDateString()`, `getISTComponents()`, `addISTMonths()`, `addISTDays()`
- Frontend displays dates in local format using custom date utilities
- Date calculations account for month/year boundaries

### Authentication & Authorization
- **JWT-based Authentication**: JWT tokens stored in localStorage with metadata
- **Two-Factor Authentication**:
  - TOTP-based (speakeasy library for verification)
  - Mandatory for admin accounts
  - Optional for regular users
  - QR code generation for authenticator setup
- **Permission System**:
  - Two levels: admin (full access) and user (permission-based)
  - Entity-based permissions (servers, customers, mappings, activities, etc.)
  - Action-based permissions (view, create, edit, delete)
  - Decorator-based permission enforcement: `@RequirePermission(entity, action)`

### Guard Pattern (Backend)
- **JwtAuthGuard**: Validates JWT token and attaches user to request
- **PermissionsGuard**: Checks entity/action permissions from decorator metadata
- Guards applied at controller level using `@UseGuards()`
- Admin role automatically bypasses permission checks

## Database Access Patterns

### Transaction Example
```typescript
await this.db.withTransaction(async (conn) => {
  // Execute operations within transaction
  const result = await this.db.execute(sql, params, conn);
  // Auto-commit on success, auto-rollback on error
});
```

### Query Patterns
```typescript
// SELECT multiple rows
const rows = await this.db.query<ActivityRow>('SELECT * FROM activities WHERE customer_id = ?', [customerId]);

// SELECT single row
const row = await this.db.queryOne<ActivityRow>('SELECT * FROM activities WHERE id = ?', [id]);

// INSERT/UPDATE/DELETE
const result = await this.db.execute('INSERT INTO activities (...) VALUES (...)', params);
// result.insertId, result.affectedRows, result.changedRows available
```

### Prepared Statements
- Always use `?` placeholders for values
- Pass params array as second argument
- Prevents SQL injection automatically

## Testing Infrastructure

### Jest Configuration (Backend)
- Test regex: `.*\.spec\.ts$`
- Root directory: `src/`
- Coverage directory: `../coverage/`
- Transform: TypeScript via ts-jest
- Test environment: Node
- Scripts: `npm test`, `npm run test:watch`, `npm run test:cov`

### No Active Tests
- No test files currently in codebase
- Test infrastructure configured but not in use
- Testing pattern would follow NestJS Testing module convention if implemented
- Frontend includes testing library dependencies but no active tests

## Frontend UI Framework
- **CSS Framework**: Tailwind CSS for utility-based styling
- **Icons**: lucide-react for consistent iconography
- **Charts**: recharts for data visualization
- **Data Export**: XLSX (xlsx library) for Excel export functionality
- **Maps**: Leaflet and react-leaflet for mapping features
- **Form Inputs**: Custom components like DateInput with validation

## Decorators (Backend)
- `@Controller()` - Define route base path
- `@Get()`, `@Post()`, `@Put()`, `@Delete()` - HTTP methods
- `@Body()`, `@Param()`, `@Query()` - Parameter decorators
- `@UseGuards()` - Apply guards to route
- `@RequirePermission()` - Custom decorator for permission requirements
- `@ApiTags()`, `@ApiOperation()`, `@ApiBearerAuth()` - Swagger documentation

## Import Organization
1. NestJS/React core imports
2. Third-party library imports
3. Local service imports
4. Utility/helper imports
5. Type/interface imports
