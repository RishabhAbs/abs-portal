-- Migration 010: Add billing_mode to activities table
USE abs_cloud;

ALTER TABLE activities ADD COLUMN billing_mode ENUM('day_to_day', 'month_to_month') DEFAULT 'day_to_day' AFTER group_id;
