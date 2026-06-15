-- Add person_name and mobile_no columns to customers table
ALTER TABLE customers ADD COLUMN person_name VARCHAR(255) NULL AFTER name;
ALTER TABLE customers ADD COLUMN mobile_no VARCHAR(20) NULL AFTER person_name;
