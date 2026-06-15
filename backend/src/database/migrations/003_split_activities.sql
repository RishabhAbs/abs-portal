-- Add record_nature and group_id columns to activities table
ALTER TABLE activities
ADD COLUMN record_nature ENUM('Sales', 'Purchase') NOT NULL DEFAULT 'Sales' AFTER activity_type,
ADD COLUMN group_id VARCHAR(50) NULL AFTER id;

-- Update existing records to have 'Sales' nature (as they were primarily sales focused logic before)
-- Note: Logic for existing records is tricky as they contain both info, but we default to Sales for now.
UPDATE activities SET record_nature = 'Sales';
