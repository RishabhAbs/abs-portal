-- ============================================================
-- Migration: Add new columns to customers table (SAFE - NO DROPS)
-- IMPORTANT: This migration only ADDS missing columns
-- It NEVER deletes, drops, or removes any existing data
-- ============================================================

-- Step 1: Add new columns to customers table (only if they don't exist)
-- Using stored procedure pattern for conditional column add

DELIMITER //

CREATE PROCEDURE AddColumnIfNotExists()
BEGIN
  -- Add group_id column
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'group_id') THEN
    ALTER TABLE customers ADD COLUMN group_id VARCHAR(20) NULL;
  END IF;

  -- Add address1 column
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'address1') THEN
    ALTER TABLE customers ADD COLUMN address1 VARCHAR(255) NULL;
  END IF;

  -- Add address2 column
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'address2') THEN
    ALTER TABLE customers ADD COLUMN address2 VARCHAR(255) NULL;
  END IF;

  -- Add address3 column
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'address3') THEN
    ALTER TABLE customers ADD COLUMN address3 VARCHAR(255) NULL;
  END IF;

  -- Add remark column
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'remark') THEN
    ALTER TABLE customers ADD COLUMN remark TEXT NULL;
  END IF;

  -- Add company column (if name column exists, copy data; don't delete name)
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'company') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'name') THEN
      ALTER TABLE customers ADD COLUMN company VARCHAR(150) NULL;
      UPDATE customers SET company = name WHERE company IS NULL;
    ELSE
      ALTER TABLE customers ADD COLUMN company VARCHAR(150) NOT NULL DEFAULT '';
    END IF;
  END IF;
END //

DELIMITER ;

CALL AddColumnIfNotExists();
DROP PROCEDURE IF EXISTS AddColumnIfNotExists;

-- Step 2: Copy address data to address1 (if address column exists and address1 is empty)
UPDATE customers SET address1 = address WHERE address IS NOT NULL AND (address1 IS NULL OR address1 = '');

-- NOTE: Old columns (person_name, mobile_no, address, name) are NOT dropped
-- They are kept for backward compatibility and data preservation
-- The application will use the new columns going forward
