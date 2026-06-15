-- ============================================================
-- ABS Technologies Cloud Management System
-- Purchase Activities Schema v1.0
-- ============================================================
-- This table tracks what we pay to server providers (I2K2, etc.)
-- Separate from billing activities (customer charges)
-- ============================================================

USE abs_cloud;

-- ============================================================
-- PURCHASE ACTIVITIES TABLE
-- Stores server purchase/renewal transactions with providers
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_activities (
  id VARCHAR(20) PRIMARY KEY,                    -- Format: PUR001, PUR002...
  server_id VARCHAR(20) NOT NULL,                -- References servers.id
  server_name VARCHAR(100) NOT NULL,             -- Server company name (denormalized)
  server_ip VARCHAR(100),                        -- Server IP for reference
  sof_no VARCHAR(20),                            -- SOF reference number
  activity_date DATE NOT NULL,                   -- Transaction date
  activity_type ENUM('New', 'Renewal') NOT NULL, -- Purchase type
  purchase_units INT DEFAULT 0,                  -- Total users on server (P.U.)
  purchase_rate DECIMAL(10,2),                   -- Rate per user (what we pay)
  billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') NOT NULL,
  old_expiry_date DATE,                          -- Previous expiry (for renewals)
  new_expiry_date DATE,                          -- New expiry date
  total_amount DECIMAL(12,2) NOT NULL,           -- Total cost (P.U. × Rate × Cycle)
  customer_details JSON,                         -- List of customers and their users
  remark TEXT,                                   -- Notes
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE RESTRICT,

  INDEX idx_server_id (server_id),
  INDEX idx_activity_date (activity_date),
  INDEX idx_activity_type (activity_type)
);

-- ============================================================
-- SAMPLE QUERIES
-- ============================================================

-- Get total purchase cost:
-- SELECT SUM(total_amount) as total_cost FROM purchase_activities;

-- Get purchase cost by server:
-- SELECT server_name, SUM(total_amount) as total
-- FROM purchase_activities
-- GROUP BY server_id, server_name;

-- Get profit (Revenue - Cost):
-- SELECT
--   (SELECT SUM(bill_amount) FROM activities) as revenue,
--   (SELECT SUM(total_amount) FROM purchase_activities) as cost,
--   (SELECT SUM(bill_amount) FROM activities) - (SELECT SUM(total_amount) FROM purchase_activities) as profit;