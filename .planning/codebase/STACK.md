# Tech Stack

## Languages & Runtime
- **Node.js** (v14+) - Backend runtime
- **TypeScript** 5.9.3 - Backend source language
- **TypeScript** 4.9.5 - Frontend source language
- **JavaScript** (ES2021) - Target output for Node.js
- **HTML5/CSS3/JavaScript** - Frontend rendering

## Frameworks
- **NestJS** 10.3.0 - Backend framework for APIs and business logic
- **React** 19.2.3 - Frontend UI framework
- **React Router DOM** 7.12.0 - Frontend routing and navigation
- **React Redux** 9.2.0 - State management in frontend
- **Redux Toolkit** 2.11.2 - Redux utilities and patterns

## Key Dependencies

### Backend

#### Core Framework
- **@nestjs/common** 10.3.0 - Core NestJS framework
- **@nestjs/core** 10.3.0 - NestJS kernel
- **@nestjs/platform-express** 10.3.0 - Express adapter for NestJS
- **@nestjs/cli** 10.2.1 - CLI tools for NestJS development

#### Database & ORM
- **typeorm** 0.3.19 - ORM for database operations
- **@nestjs/typeorm** 10.0.1 - TypeORM integration for NestJS
- **mysql2** 3.17.1 - MySQL database driver with promise support

#### Authentication & Security
- **@nestjs/jwt** 10.2.0 - JWT authentication module
- **@nestjs/passport** 10.0.3 - Passport authentication framework
- **passport** 0.7.0 - Passport authentication strategies
- **passport-jwt** 4.0.1 - JWT Passport strategy
- **bcryptjs** 2.4.3 - Password hashing
- **bcrypt** 6.0.0 - Alternative password hashing library
- **speakeasy** 2.0.0 - Two-factor authentication (TOTP) generation and verification

#### API & Utilities
- **@nestjs/swagger** 7.1.17 - Swagger/OpenAPI documentation
- **@nestjs/serve-static** 4.0.2 - Static file serving
- **@nestjs/config** 3.1.1 - Configuration management using environment variables
- **@nestjs/schedule** 6.1.1 - Cron jobs and task scheduling

#### Data Processing & Validation
- **class-validator** 0.14.0 - DTO validation decorators
- **class-transformer** 0.5.1 - DTO transformation and serialization
- **uuid** 9.0.1 - Unique ID generation
- **xlsx** 0.18.5 - Excel file parsing and generation

#### Security Headers & Compression
- **helmet** 8.1.0 - HTTP security headers
- **compression** 1.8.1 - GZIP compression middleware

#### Utilities
- **rxjs** 7.8.1 - Reactive programming library
- **reflect-metadata** 0.2.1 - Reflection metadata for decorators
- **dotenv** (implied) - Environment variable loading

### Frontend

#### Core UI
- **react** 19.2.3 - React library
- **react-dom** 19.2.3 - React DOM rendering
- **react-scripts** 5.0.1 - Build and development scripts (Create React App)

#### Routing & Navigation
- **react-router-dom** 7.12.0 - Client-side routing

#### State Management
- **@reduxjs/toolkit** 2.11.2 - Redux state management
- **react-redux** 9.2.0 - React bindings for Redux

#### Maps & Geolocation
- **leaflet** 1.9.4 - JavaScript mapping library
- **react-leaflet** 5.0.0 - React component wrapper for Leaflet
- **leaflet-routing-machine** 3.2.12 - Routing and directions for maps
- **@types/leaflet** 1.9.21 - TypeScript definitions for Leaflet
- **@types/leaflet-routing-machine** 3.2.9 - TypeScript definitions for routing

#### UI Components & Styling
- **tailwindcss** 3.4.19 - Utility-first CSS framework
- **@tailwindcss/forms** 0.5.11 - Form styling plugin for Tailwind
- **lucide-react** 0.562.0 - Icon library for React
- **recharts** 3.6.0 - React chart library for data visualization

#### Data Processing
- **qrcode** 1.5.4 - QR code generation
- **xlsx** 0.18.5 - Excel file parsing (also in backend)

#### CSS Processing
- **postcss** 8.5.6 - CSS transformation tool
- **autoprefixer** 10.4.23 - Vendor prefix automation

#### Development & Testing
- **@testing-library/react** 16.3.1 - React component testing utilities
- **@testing-library/dom** 10.4.1 - DOM testing utilities
- **@testing-library/jest-dom** 6.9.1 - Jest matchers for DOM
- **@testing-library/user-event** 13.5.0 - User interaction simulation
- **web-vitals** 2.1.4 - Web performance metrics

## Build & Dev Tools

### Backend
- **ts-node** 10.9.2 - TypeScript execution for Node.js
- **ts-loader** 9.5.1 - Webpack TypeScript loader
- **ts-jest** 29.1.1 - Jest transformer for TypeScript
- **jest** 29.7.0 - Testing framework
- **prettier** 3.1.1 - Code formatter
- **eslint** 8.56.0 - Linting tool
- **@typescript-eslint/parser** 6.15.0 - TypeScript parser for ESLint
- **@typescript-eslint/eslint-plugin** 6.15.0 - TypeScript ESLint rules
- **eslint-config-prettier** 9.1.0 - Prettier ESLint config
- **eslint-plugin-prettier** 5.1.2 - Prettier ESLint plugin
- **nest build** - NestJS CLI build command
- **typeorm-ts-node-commonjs** - TypeORM CLI with TypeScript support

### Frontend
- **react-scripts** 5.0.1 - Create React App scripts

### Shared
- **typescript** - TypeScript compiler

## Configuration Files

- `.env` / `.env.example` - Environment variables for backend (database, JWT, encryption keys)
- `backend/ecosystem.config.js` - PM2 process manager configuration for production
- `backend/nest-cli.json` - NestJS CLI configuration
- `backend/tsconfig.json` - TypeScript compiler configuration (backend)
- `backend/package.json` - Backend dependencies and scripts
- `frontend/package.json` - Frontend dependencies and scripts
- `frontend/tsconfig.json` - TypeScript compiler configuration (frontend)
- `frontend/tailwind.config.js` - Tailwind CSS customization
- `frontend/postcss.config.js` - PostCSS plugin configuration
- `backend/src/database/data-source.ts` - TypeORM data source configuration for MySQL

## Database Configuration

- **MySQL** 8.0+ - Database engine
- **Host**: localhost (configurable via DB_HOST)
- **Port**: 3306 or 3307 (configurable via DB_PORT)
- **Database**: abs_cloud (configurable via DB_DATABASE)
- **Connection Pool**: 50 concurrent connections (configurable via DB_CONNECTION_LIMIT)
- **Timezone**: IST (Indian Standard Time, UTC+05:30)

## API Documentation
- **Swagger/OpenAPI** - Auto-generated API documentation at `/api/docs`
