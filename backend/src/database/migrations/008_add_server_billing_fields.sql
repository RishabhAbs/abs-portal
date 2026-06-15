-- Migration 008: Add Billing Mode and Server Type to Servers Table
USE abs_cloud;

ALTER TABLE servers ADD COLUMN billing_mode ENUM('day_to_day', 'month_to_month') DEFAULT 'day_to_day';
