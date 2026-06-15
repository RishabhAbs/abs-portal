# External Integrations

## Database

### MySQL
- **Type**: Relational Database
- **Driver**: mysql2/promise (v3.17.1)
- **ORM**: TypeORM (v0.3.19)
- **Connection**:
  - Host: `process.env.DB_HOST` (default: localhost)
  - Port: `process.env.DB_PORT` (default: 3306)
  - Username: `process.env.DB_USERNAME` (default: root)
  - Password: `process.env.DB_PASSWORD` (default: password)
  - Database: `process.env.DB_DATABASE` (default: abs_cloud)
- **Connection Pool**: 50 concurrent connections (configurable via `DB_CONNECTION_LIMIT`)
- **Timezone**: IST (Indian Standard Time, UTC+05:30)
- **Services**: All backend services connect through `DbService` for queries and transactions
- **Configuration**: `backend/src/database/data-source.ts`

### Tables
- **users** - System users and authentication
- **servers** - Cloud server information
- **customers** - Customer/client information
- **mappings** - Server-to-customer relationships
- **activities** - Billing and revenue transactions
- **tdl_customizations** - Task/TDL customization templates
- **tasks** - Individual tasks within customizations
- **visits** - Customer visit records
- **pincodes** - Postal code reference data
- **states** - State reference data
- **cloud_user_sessions** - User session tracking for active session management
- **attendance_log** - Employee attendance tracking with geolocation
- And others (see migration files for complete schema)

## Authentication

### JWT (JSON Web Token)
- **Library**: @nestjs/jwt (v10.2.0)
- **Secret**: `process.env.JWT_SECRET` (change in production)
- **Expiration**: `process.env.JWT_EXPIRES_IN` (default: 24h)
- **Implementation**:
  - Backend: `src/services/auth.service.ts`
  - Frontend: `src/services/api.ts`
- **Token Storage**: localStorage (`abs_token_data` key with timestamp)
- **Bearer Token**: Format `Authorization: Bearer {token}`
- **Guard**: `JwtAuthGuard` validates token on protected routes

### Two-Factor Authentication (2FA)
- **Library**: speakeasy (v2.0.0)
- **Type**: TOTP (Time-based One-Time Password)
- **Encoding**: Base32
- **Window**: 2 steps (allows 1 step before/after for clock drift)
- **Features**:
  - Mandatory for admin users (forced on first login)
  - Optional for regular users
  - QR code generation for 2FA setup
  - Session locking and unlock via OTP
- **Database**: 2FA secrets stored in `users` table
- **Implementation**: `src/services/auth.service.ts`

### Password Hashing
- **Library**: bcryptjs (v2.4.3) or bcrypt (v6.0.0)
- **Salt Rounds**: 12
- **Password Comparison**: Used on login validation
- **Services**: `src/services/users.service.ts`

### Passport Authentication Framework
- **Library**: @nestjs/passport (v10.0.3), passport (v0.7.0)
- **Strategies**: JWT strategy via passport-jwt (v4.0.1)
- **Note**: Custom JWT guard implementation used instead of passport middleware

## External APIs

### Backend API Endpoints (Exposed)
The backend exposes RESTful API endpoints consumed by the frontend:

#### Authentication Routes
- `POST /api/auth/login` - User login with optional OTP
- `GET /api/auth/me` - Get authenticated user profile
- `POST /api/auth/2fa/generate` - Generate 2FA secret
- `POST /api/auth/2fa/enable` - Enable 2FA for user
- `POST /api/auth/2fa/disable` - Disable 2FA
- `POST /api/auth/profile/password` - Change password
- `GET /api/auth/sessions/active` - Get active user sessions
- `POST /api/auth/logout` - User logout
- `POST /api/auth/session/unlock` - Unlock session with OTP

#### Cloud Management Routes
- `GET /api/servers` - List servers with pagination and filters
- `GET /api/servers/dropdown` - Server dropdown data
- `GET /api/servers/:id` - Get server by ID
- `POST /api/servers` - Create server
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Delete server
- `GET /api/mappings` - List server-customer mappings
- `GET /api/mappings/:id` - Get mapping by ID
- `POST /api/mappings` - Create mapping
- `PUT /api/mappings/:id` - Update mapping
- `DELETE /api/mappings/:id` - Delete mapping
- `GET /api/activities` - List billing activities
- `POST /api/activities` - Create activity
- `POST /api/activities/calculate` - Calculate billing amounts
- `POST /api/activities/generate-for-servers` - Bulk generate activities
- `POST /api/activities/bulk-customer-renewal` - Bulk customer renewal

#### Customer Management Routes
- `GET /api/customers` - List customers with filters
- `GET /api/customers/dropdown` - Customer dropdown
- `GET /api/customers/:id` - Get customer by ID
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer

#### User Management Routes
- `GET /api/users` - List all users (admin only)
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user (admin only)
- `PUT /api/users/:id` - Update user (admin only)
- `PUT /api/users/:id/permissions` - Update user permissions
- `DELETE /api/users/:id` - Delete user
- `POST /api/users/:id/2fa/reset` - Reset 2FA for user
- `GET /api/users/network` - Get user location network

#### Visit & Attendance Routes
- `POST /api/visits/create` - Create visit record
- `GET /api/visits/pending` - Get pending visits
- `POST /api/visits/complete` - Mark visit complete
- `POST /api/attendance/checkin` - Employee check-in
- `POST /api/attendance/checkout` - Employee check-out
- `GET /api/attendance/status` - Get current attendance status
- `GET /api/attendance/report` - Daily attendance report

#### TDL (Task/Delivery Log) Routes
- `GET /api/tdl/customizations` - List TDL customizations
- `POST /api/tdl/customizations` - Create TDL customization
- `GET /api/tdl/customizations/:id` - Get customization by ID
- `POST /api/tdl/customizations/:id` - Update customization
- `DELETE /api/tdl/customizations/:id` - Delete customization
- `POST /api/tdl/upload` - Upload file attachments (multipart form-data)
- `GET /api/tdl/lookup/:token` - Public lookup by token
- `GET /api/tdl/loader/:token` - Load TDL data for public view

#### Reference Data Routes
- `GET /api/states` - List all states
- `GET /api/pincodes` - List pincodes with pagination
- `POST /api/pincodes` - Create pincode
- `GET /api/pincodes/lookup/:code` - Lookup city/state by pincode

#### Dashboard Routes
- `GET /api/dashboard/stats` - Dashboard statistics

### Frontend API Communication
- **Method**: Fetch API (native browser)
- **Base URL**:
  - Development: `http://localhost:5000/api`
  - Production: `/api` (Apache reverse proxy)
- **Authorization**: Bearer token in `Authorization` header
- **Content-Type**: application/json
- **Error Handling**: Custom `ApiError` class with HTTP status codes
- **Token Management**: Automatic token retrieval from localStorage
- **Activity Tracking**: Automatic `lastActivity` timestamp update on API calls
- **Implementation**: `frontend/src/services/api.ts`

## File Storage

### Backend Upload Directory
- **Location**: `backend/uploads` directory
- **Served via**: NestJS `ServeStaticModule` at `/uploads` endpoint
- **Use Cases**:
  - TDL/task attachment storage (via `/api/tdl/upload`)
  - File uploads accessible to authenticated users
- **Configuration**: `backend/src/app.module.ts`
- **Deployment Note**: In split deployment (Apache + separate backend), uploads served directly by backend

### Encryption
- **Encryption Key**: `process.env.ENCRYPTION_KEY` (configurable via .env)
- **Use**: Sensitive data encryption (e.g., server admin passwords)
- **Type**: Not specified in code, likely AES or similar symmetric encryption
- **Services**: Used in servers.service.ts for sensitive fields

## Security & Access Control

### CORS Configuration
- **Origin**: `process.env.CORS_ORIGIN` (default: true = all origins)
- **Credentials**: true (allows cookies/auth headers)
- **Implementation**: NestJS enableCors() in app bootstrap

### Security Headers
- **Helmet**: helmet (v8.1.0) middleware for HTTP security headers
  - Protects against common vulnerabilities (XSS, clickjacking, etc.)

### Response Compression
- **Compression**: compression (v1.8.1) middleware for GZIP compression
- **Performance**: Reduces response payload size

### Global Error Handling
- **Location**: `backend/src/main.ts`
- **Features**:
  - Status code resolution
  - Database error handling with user-friendly messages
  - Secure error responses (no SQL leaks)
  - ISO timestamp formatting

## Session Management

### Active Session Tracking
- **Storage**: Database (`cloud_user_sessions` table)
- **Tracking**: Login time and last activity timestamp
- **Timeout**: 30 minutes inactivity threshold
- **Endpoints**:
  - `GET /api/auth/sessions/active` - View active sessions
  - `DELETE /api/auth/session/:id` - Terminate session
  - Session auto-creation on login
  - Session tracking on API requests

## Process Management

### Production Deployment
- **Manager**: PM2 (via ecosystem.config.js)
- **Process Name**: abs-cloud-backend
- **Script**: `dist/main.js` (compiled NestJS output)
- **Environment**:
  - NODE_ENV: production
  - PORT: 3001
  - JWT_SECRET: configurable
  - JWT_EXPIRES_IN: 24h

## Scheduling & Cron Jobs

### Task Scheduler
- **Library**: @nestjs/schedule (v6.1.1)
- **Purpose**: Background tasks and periodic jobs (implementation details in individual services)
- **Not Exposed**: Internal scheduling, not directly called by frontend

## Build & Deployment

### Build Process
- **Backend**: NestJS CLI build to `dist/` directory
- **Frontend**: Create React App build to browser-optimized output
- **Scripts**:
  - `npm run build` (backend/frontend)
  - `npm run start:prod` (backend production)

### API Documentation
- **Swagger/OpenAPI**: Auto-generated at `/api/docs`
- **Library**: @nestjs/swagger (v7.1.17)
- **Bearer Auth**: Built-in JWT bearer token documentation
