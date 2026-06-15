-- Migration 004: Sync User Counts to Mappings and Servers
USE abs_cloud;

-- Add caching columns to mappings
ALTER TABLE mappings
ADD COLUMN billed_users INT DEFAULT 0 AFTER serial_no,
ADD COLUMN purchase_users INT DEFAULT 0 AFTER billed_users;

-- Add caching column to servers
ALTER TABLE servers
ADD COLUMN purchase_units INT DEFAULT 0 AFTER purchase_rate;

-- Note: We will populate these columns via a backend logic update in ActivitiesService
