
-- 007_sync_activities_columns.sql
-- Synchronize activities table with the 24-column structure used in ActivitiesService

USE abs_cloud;

ALTER TABLE activities
ADD COLUMN IF NOT EXISTS purchase_rate DECIMAL(10,2) DEFAULT 0 AFTER last_bill_rate,
ADD COLUMN IF NOT EXISTS purchase_amount DECIMAL(12,2) DEFAULT 0 AFTER bill_amount,
ADD COLUMN IF NOT EXISTS start_from DATE NULL AFTER old_expiry_date,
ADD COLUMN IF NOT EXISTS purchase_units INT DEFAULT 0 AFTER billing_units;
