# Testing

## Test Framework

### Backend Testing
- **Framework**: Jest (v29.7.0)
- **TypeScript Support**: ts-jest (v29.1.1)
- **NestJS Testing**: @nestjs/testing (v10.3.0)
- **Status**: Framework installed and configured, but no tests currently implemented

### Frontend Testing
- **Framework**: Jest via react-scripts
- **React Testing Library**: @testing-library/react (v16.3.1)
- **Jest DOM Matchers**: @testing-library/jest-dom (v6.9.1)
- **User Event Simulation**: @testing-library/user-event (v13.5.0)
- **Status**: Framework installed via create-react-app, minimal setup

## Test Structure

### Backend Jest Configuration
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "collectCoverageFrom": ["**/*.(t|j)s"],
  "coverageDirectory": "../coverage",
  "testEnvironment": "node"
}
```

**Key Points:**
- Test files must have `.spec.ts` extension
- Tests run from `src/` directory
- Coverage reports generated to `coverage/` directory at project root
- Uses Node test environment (no jsdom)

### Frontend Testing Setup
- **Setup File**: `frontend/src/setupTests.ts`
- **Configuration**: Extends `react-app` and `react-app/jest` ESLint configs
- **Library Imports**: Includes `@testing-library/jest-dom` for DOM assertions

### Test Organization Pattern
- No tests currently exist in the codebase
- When implemented, tests would be co-located with source files
- Expected pattern: `src/services/users.service.spec.ts` alongside `src/services/users.service.ts`

## Test Coverage

### Currently Tested
- **Nothing**: No test files exist in the codebase (confirmed via file search)
- Configuration exists but is not in use
- Framework and dependencies are installed but dormant

### Not Tested
- **Backend Controllers**: Authentication, activities, customers, servers, mappings, etc.
- **Backend Services**: User management, authorization, database operations
- **Backend Guards**: JWT validation, permissions checking
- **Backend Decorators**: Permission decorators and metadata handling
- **Frontend Components**: Pages, Layout, ProtectedRoute, Toast notifications
- **Frontend Context**: AuthContext, DataContext state management
- **Frontend Pages**: All page components (Activities, Dashboard, Servers, etc.)
- **Utilities**: Date utilities, renewal calculations, security functions
- **API Layer**: Frontend service/api module calls

## Running Tests

### Backend Tests
```bash
npm test                 # Run all tests once
npm run test:watch      # Run tests in watch mode
npm run test:cov        # Run tests with coverage report
```

**Test Output:**
- Console output shows pass/fail status
- Coverage report generated in `coverage/` directory
- Can open `coverage/lcov-report/index.html` in browser for coverage visualization

### Frontend Tests
```bash
npm test                 # Start interactive test runner (create-react-app)
npm run test -- --coverage  # Run with coverage report
```

**Test Output:**
- Interactive watch mode by default
- Can filter tests by filename
- Press 'a' to run all tests
- Press 'q' to quit

### CI/CD Considerations
- Backend: `npm test` can be called in CI pipeline
- Frontend: `CI=true npm test` for non-interactive mode in CI
- Coverage thresholds not currently defined

## Mocking Patterns

### Backend Mocking Strategy (If Implemented)
NestJS Testing module provides built-in mocking:

```typescript
// Example pattern (not currently used)
const module: TestingModule = await Test.createTestingModule({
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    {
      provide: DbService,
      useValue: {
        query: jest.fn(),
        execute: jest.fn(),
      },
    },
  ],
}).compile();

const service = module.get<ActivitiesService>(ActivitiesService);
```

**Expected Mocking Areas:**
- Database Service (`DbService`)
- External Services (Auth, Users, etc.)
- Configuration Service
- JWT Service

### Frontend Mocking Strategy (If Implemented)

**API Mocking:**
```typescript
// Mock structure not currently used
jest.mock('../services/api', () => ({
  activitiesApi: {
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));
```

**Context Mocking:**
```typescript
// Would mock useAuth, useData, useToast hooks
const mockAuth = {
  user: { id: '1', name: 'Test User', role: 'admin' },
  login: jest.fn(),
  logout: jest.fn(),
};
```

**Component Testing Pattern:**
- Render component with mocked context providers
- Use React Testing Library queries (`getByRole`, `getByText`, etc.)
- Fire user events with `userEvent`
- Assert on DOM state and function calls

### Database Mocking
When backend tests are implemented:
- Mock MySQL connections in DbService
- Return fixture data for predictable test results
- Test transaction rollback behavior with error injection
- Mock error scenarios (ECONNREFUSED, ENOTFOUND, etc.)

## Test Data & Fixtures

### Not Currently Used
- No fixture files exist
- No seeding strategy for test databases
- No mock data generators

### Future Pattern (If Implemented)
```typescript
// Example structure
const mockActivity = {
  id: 'uuid-123',
  customer_id: 'cust-456',
  activity_type: 'Renewal',
  bill_amount: 5000,
  activity_date: '2024-02-24',
  // ... other fields
};
```

## Coverage Goals

### Not Currently Defined
- No coverage threshold configuration
- No coverage reports exist
- No coverage trend tracking

### Recommendations When Implementing Tests
- **Target**: 80%+ overall coverage
- **Critical Paths**: 100% coverage for auth, permissions, and payment logic
- **Services**: 90%+ coverage for business logic
- **Controllers**: 70%+ coverage (depends on service mocking quality)
- **Utils**: 100% coverage for utility functions

## Integration Testing

### Not Currently Implemented
- No end-to-end test suite exists
- No Playwright, Cypress, or similar tools installed

### Future Pattern
- Backend integration tests: Full request/response with real database in test environment
- Frontend integration tests: Full user workflows with mocked API calls
- API tests: Verify request/response contracts

## Common Testing Issues & Solutions

### Issue: MySQL Connection in Tests
**Solution**: Mock DbService in test module
```typescript
// When implemented
{
  provide: DbService,
  useValue: {
    query: jest.fn().mockResolvedValue([...]),
    execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
  },
}
```

### Issue: JWT Token Validation
**Solution**: Mock JwtService or provide test token
```typescript
// When implemented
jest.mock('@nestjs/jwt', () => ({
  JwtService: jest.fn().mockImplementation(() => ({
    sign: jest.fn().mockReturnValue('test-token'),
    verify: jest.fn().mockReturnValue({ userId: '123' }),
  })),
}));
```

### Issue: Async Context Loading
**Solution**: Use `waitFor()` in React Testing Library
```typescript
// Example pattern
await waitFor(() => {
  expect(screen.getByText('Data Loaded')).toBeInTheDocument();
});
```

## Testing Checklist for New Features

- [ ] Unit tests for service methods
- [ ] Controller tests with guard verification
- [ ] Permission checks in guard tests
- [ ] Error handling and edge cases
- [ ] Frontend component rendering tests
- [ ] Context hook tests
- [ ] API call mocking validation
- [ ] User interaction tests
- [ ] Load/loading state tests
- [ ] Error state and toast notification tests

## Performance Testing Notes

### Not Currently Implemented
- No load testing tools (JMeter, k6, etc.)
- No performance benchmarks
- No memory leak detection tests

### Relevant for Future
- Database query performance (long-running transactions)
- Large activity dataset pagination
- File export (XLSX) performance with large datasets
- Context rerenders and React optimization

## Security Testing Notes

### Areas to Test (When Implementing)
- JWT token validation and expiration
- Permission boundary testing (user shouldn't access other user's data)
- SQL injection prevention (prepared statements)
- Password hashing and comparison
- 2FA TOTP validation
- CORS configuration
- Helmet security headers
- Input validation and sanitization
