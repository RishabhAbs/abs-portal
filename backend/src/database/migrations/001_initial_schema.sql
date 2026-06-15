-- ============================================================
-- ABS Technologies Cloud Management System
-- Database Schema v1.0
-- ============================================================
-- This schema matches DATABASE_DESIGN.md
-- Run this file to create all tables from scratch
-- ============================================================

CREATE DATABASE IF NOT EXISTS abs_cloud;
USE abs_cloud;

-- ============================================================
-- 1. USERS TABLE
-- Stores system users and authentication data
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY,                    -- Format: USR001, USR002...
  name VARCHAR(100) NOT NULL,                    -- Full name
  email VARCHAR(100) NOT NULL UNIQUE,            -- Login email
  password_hash VARCHAR(255) NOT NULL,           -- Bcrypt hashed password
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('active', 'inactive') DEFAULT 'active',
  permissions JSON NOT NULL,                     -- Permission object (see design doc)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_status (status)
);

-- ============================================================
-- 2. SERVERS TABLE
-- Stores cloud server information
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(20) PRIMARY KEY,                    -- Format: SRV001, SRV002...
  server_ip VARCHAR(100) NOT NULL,               -- Server IP/hostname
  sof_no VARCHAR(20),                            -- SOF reference number
  port VARCHAR(10) NOT NULL,                     -- Connection port
  customer_ip VARCHAR(100),                      -- Customer-facing IP
  admin_username VARCHAR(50),                    -- Admin login
  admin_password_enc VARCHAR(255),               -- Encrypted password
  status ENUM('Active', 'Inactive', 'Maintenance') DEFAULT 'Active',
  company VARCHAR(100),                          -- Provider company
  purchase_rate DECIMAL(10,2),                   -- Monthly cost
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_status (status),
  INDEX idx_sof_no (sof_no)
);

-- ============================================================
-- 3. CUSTOMERS TABLE
-- Stores customer/client information
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(100) PRIMARY KEY,                   -- Domain IP (e.g., customer.abs.co.in)
  name VARCHAR(150) NOT NULL,                    -- Company name
  email VARCHAR(100),                            -- Contact email
  address VARCHAR(255),                          -- Physical address
  gstin VARCHAR(20),                             -- GST number
  pincode VARCHAR(10),                           -- Postal code
  area VARCHAR(100),                             -- Area/locality
  state VARCHAR(50),                             -- State
  status ENUM('Active', 'Inactive', 'Suspended') DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_name (name),
  INDEX idx_status (status),
  INDEX idx_state (state)
);

-- ============================================================
-- 4. MAPPINGS TABLE
-- Links servers to customers
-- Relationship: One server → Many customers, One customer → One server
-- ============================================================
CREATE TABLE IF NOT EXISTS mappings (
  id VARCHAR(20) PRIMARY KEY,                    -- Format: MAP001, MAP002...
  server_id VARCHAR(20) NOT NULL,                -- References servers.id (can repeat)
  customer_id VARCHAR(100) NOT NULL UNIQUE,      -- References customers.id (UNIQUE = 1 customer per server only)
  serial_no VARCHAR(50),                         -- License serial number
  status ENUM('Active', 'Inactive') DEFAULT 'Active',
  mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  
  INDEX idx_server_id (server_id),
  INDEX idx_status (status)
);

-- ============================================================
-- 5. ACTIVITIES TABLE
-- Stores billing and revenue transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(20) PRIMARY KEY,                    -- Format: ACT001, ACT002...
  customer_id VARCHAR(100),                      -- References customers.id
  customer_name VARCHAR(150) NOT NULL,           -- Denormalized for reports
  server_name VARCHAR(100),                      -- Server reference
  sof_no VARCHAR(20),                            -- SOF reference
  activity_date DATE NOT NULL,                   -- Transaction date
  activity_type ENUM('New', 'Renewal', 'User') NOT NULL,
  bill_type ENUM('Tax Invoice', 'Credit Note') NOT NULL,
  billing_units INT DEFAULT 0,                   -- Number of users billed
  purchase_units INT DEFAULT 0,                  -- Number of users purchased
  last_bill_rate DECIMAL(10,2),                  -- Rate per user/month
  billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') NOT NULL,
  old_expiry_date DATE,                          -- Previous expiry (for renewals)
  start_from DATE,                               -- Billing period start
  new_expiry_date DATE,                          -- New expiry date
  date_diff_months INT DEFAULT 0,                -- Calculated months
  date_diff_days INT DEFAULT 0,                  -- Calculated remaining days
  bill_amount DECIMAL(12,2) NOT NULL,            -- Final amount (negative for credits)
  remark TEXT,                                   -- Notes
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  
  INDEX idx_customer_id (customer_id),
  INDEX idx_activity_date (activity_date),
  INDEX idx_activity_type (activity_type),
  INDEX idx_bill_type (bill_type),
  INDEX idx_billing_cycle (billing_cycle)
);

-- ============================================================
-- DEFAULT DATA
-- ============================================================

-- Default admin user (password: admin123)
-- Password hash generated with bcrypt, cost factor 12
INSERT INTO users (id, name, email, password_hash, role, status, permissions) VALUES
('USR001', 'Admin', 'admin@abs.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYWWQRAQHKGe', 'admin', 'active', 
'{"servers":{"view":true,"create":true,"edit":true,"delete":true},"customers":{"view":true,"create":true,"edit":true,"delete":true},"mappings":{"view":true,"create":true,"edit":true,"delete":true},"users":{"view":true,"create":true,"edit":true,"delete":true}}')
ON DUPLICATE KEY UPDATE id=id;

-- ============================================================
-- HELPFUL QUERIES (for reference)
-- ============================================================

-- Get server with customer count:
-- SELECT s.*, COUNT(m.id) as customer_count
-- FROM servers s
-- LEFT JOIN mappings m ON s.id = m.server_id
-- GROUP BY s.id;

-- Get unmapped customers:
-- SELECT c.* FROM customers c
-- LEFT JOIN mappings m ON c.id = m.customer_id
-- WHERE m.id IS NULL;

-- Get total revenue:
-- SELECT SUM(bill_amount) as total FROM activities;

-- Get revenue by activity type:
-- SELECT activity_type, SUM(bill_amount) as total
-- FROM activities
-- GROUP BY activity_type;
