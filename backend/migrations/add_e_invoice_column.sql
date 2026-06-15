-- Migration: Add e_invoice and other tracking columns to tables
-- Run this if you get "Unknown column 'e_invoice' in 'field list'" error

-- Add to customer table
ALTER TABLE customer ADD COLUMN IF NOT EXISTS e_invoice VARCHAR(20);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS business_type VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS accounts_person_type VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS account_contact_id VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS it_person VARCHAR(100);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS it_person_id VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS ca_name VARCHAR(100);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS ca_id VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS business_description TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS e_way_bill VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS connected_banking VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS whatsapp_enabled VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS customisation VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS tally_slow VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS customer_behaviour TEXT;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS loyalty VARCHAR(50);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS conversion_probability VARCHAR(50);

-- Add to cloud_tdl_tasks table
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS e_invoice VARCHAR(20);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS business_type VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS accounts_person_type VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS account_contact_id VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS it_person VARCHAR(100);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS it_person_id VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS ca_name VARCHAR(100);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS ca_id VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS business_description TEXT;
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS e_way_bill VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS connected_banking VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS whatsapp_enabled VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS customisation VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS tally_slow VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS customer_behaviour TEXT;
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS loyalty VARCHAR(50);
ALTER TABLE cloud_tdl_tasks ADD COLUMN IF NOT EXISTS conversion_probability VARCHAR(50);

-- Add to cloud_visits table
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS e_invoice VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS business_type VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS accounts_person_type VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS it_person VARCHAR(100);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS ca_name VARCHAR(100);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS business_description TEXT;
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS e_way_bill VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS connected_banking VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS whatsapp_enabled VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS customisation VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS tally_slow VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS loyalty VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS conversion_probability VARCHAR(50);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS check_out_response VARCHAR(100);
ALTER TABLE cloud_visits ADD COLUMN IF NOT EXISTS customer_behaviour TEXT;
