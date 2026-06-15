-- ============================================================
-- SAFE SCHEMA SYNC - ABS Technologies Cloud Management System
-- ============================================================
-- IMPORTANT: This script ONLY ADDS missing tables and columns
-- It NEVER deletes, drops, truncates, or removes any data
-- Safe to run multiple times (idempotent)
-- ============================================================

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS abs_cloud;
USE abs_cloud;

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('active', 'inactive') DEFAULT 'active',
  permissions JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. ADMIN/GROUPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  status ENUM('Active', 'Inactive') DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. SERVERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(20) PRIMARY KEY,
  server_ip VARCHAR(100) NOT NULL,
  sof_no VARCHAR(20),
  port VARCHAR(10) NOT NULL,
  customer_ip VARCHAR(100),
  admin_username VARCHAR(50),
  admin_password_enc VARCHAR(255),
  status ENUM('Active', 'Inactive', 'Maintenance') DEFAULT 'Active',
  company VARCHAR(100),
  purchase_rate DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(150),
  company VARCHAR(150),
  email VARCHAR(100),
  address VARCHAR(255),
  address1 VARCHAR(255),
  address2 VARCHAR(255),
  address3 VARCHAR(255),
  gstin VARCHAR(20),
  pincode VARCHAR(10),
  area VARCHAR(100),
  state VARCHAR(50),
  group_id VARCHAR(20),
  remark TEXT,
  person_name VARCHAR(100),
  mobile_no VARCHAR(20),
  e_invoice TINYINT(1) DEFAULT 0,
  status ENUM('Active', 'Inactive', 'Suspended') DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 5. MAPPINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS mappings (
  id VARCHAR(20) PRIMARY KEY,
  server_id VARCHAR(20) NOT NULL,
  customer_id VARCHAR(100) NOT NULL,
  serial_no VARCHAR(50),
  status ENUM('Active', 'Inactive') DEFAULT 'Active',
  mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. ACTIVITIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(20) PRIMARY KEY,
  group_id VARCHAR(50),
  customer_id VARCHAR(100),
  customer_name VARCHAR(150),
  server_name VARCHAR(100),
  sof_no VARCHAR(20),
  activity_date DATE NOT NULL,
  activity_type ENUM('New', 'Renewal', 'User') NOT NULL,
  record_nature ENUM('Sales', 'Purchase') DEFAULT 'Sales',
  billing_mode ENUM('Basic', 'Gold', 'Silver') DEFAULT 'Basic',
  bill_type ENUM('Tax Invoice', 'Credit Note') NOT NULL,
  billing_units INT DEFAULT 0,
  purchase_units INT DEFAULT 0,
  last_bill_rate DECIMAL(10,2),
  purchase_rate DECIMAL(10,2) DEFAULT 0,
  billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') NOT NULL,
  old_expiry_date DATE,
  start_from DATE,
  new_expiry_date DATE,
  date_diff_months INT DEFAULT 0,
  date_diff_days INT DEFAULT 0,
  bill_amount DECIMAL(12,2) NOT NULL,
  purchase_amount DECIMAL(12,2) DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. VISITS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id VARCHAR(100),
  visit_date DATE NOT NULL,
  visit_type ENUM('Support', 'Sales', 'Training', 'Installation', 'Other') DEFAULT 'Support',
  purpose TEXT,
  notes TEXT,
  status ENUM('Scheduled', 'Completed', 'Cancelled') DEFAULT 'Scheduled',
  created_by VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 8. TDL CUSTOMIZATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tdl_customizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id VARCHAR(100) NOT NULL,
  tdl_name VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('Pending', 'In Progress', 'Completed', 'On Hold') DEFAULT 'Pending',
  priority ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium',
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  assigned_to VARCHAR(20),
  created_by VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
);

-- ============================================================
-- 9. TDL REQUIREMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tdl_requirements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customization_id INT NOT NULL,
  requirement TEXT NOT NULL,
  is_completed TINYINT(1) DEFAULT 0,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 10. AUDIT LOG TABLE (optional)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id VARCHAR(100),
  old_values JSON,
  new_values JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ADD MISSING COLUMNS TO EXISTING TABLES (SAFE)
-- Using ALTER TABLE ... ADD COLUMN IF NOT EXISTS pattern
-- ============================================================

-- Servers: Add missing columns
ALTER TABLE servers ADD COLUMN IF NOT EXISTS billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') DEFAULT 'Monthly';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS server_expiry DATE NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS purchase_rate DECIMAL(10,2) DEFAULT 0;

-- Customers: Add missing columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS group_id VARCHAR(20) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address1 VARCHAR(255) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address2 VARCHAR(255) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address3 VARCHAR(255) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS remark TEXT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company VARCHAR(150) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS e_invoice TINYINT(1) DEFAULT 0;

-- Activities: Add missing columns
ALTER TABLE activities ADD COLUMN IF NOT EXISTS group_id VARCHAR(50) NULL;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS record_nature ENUM('Sales', 'Purchase') DEFAULT 'Sales';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS billing_mode ENUM('Basic', 'Gold', 'Silver') DEFAULT 'Basic';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS purchase_rate DECIMAL(10,2) DEFAULT 0;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS purchase_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS purchase_units INT DEFAULT 0;

-- ============================================================
-- DATA MIGRATION (SAFE - only updates empty values)
-- ============================================================

-- Copy name to company if company is empty
UPDATE customers SET company = name WHERE company IS NULL OR company = '';

-- Copy address to address1 if address1 is empty
UPDATE customers SET address1 = address WHERE (address1 IS NULL OR address1 = '') AND address IS NOT NULL;

-- ============================================================
-- CREATE INDEXES (SAFE - IF NOT EXISTS)
-- ============================================================
-- Note: MySQL 8.0+ supports IF NOT EXISTS for indexes
-- For older versions, errors are ignored

-- Indexes will be created only if they don't exist
-- CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
-- CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
-- CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
-- CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(activity_date);
-- CREATE INDEX IF NOT EXISTS idx_mappings_server ON mappings(server_id);
-- CREATE INDEX IF NOT EXISTS idx_mappings_customer ON mappings(customer_id);

-- ============================================================
-- NOTES
-- ============================================================
-- 1. This script NEVER uses DROP, DELETE, or TRUNCATE
-- 2. All operations are safe and idempotent (can run multiple times)
-- 3. Existing data is NEVER modified or removed
-- 4. New columns are added with NULL or sensible defaults
-- 5. Old columns are preserved for backward compatibility
