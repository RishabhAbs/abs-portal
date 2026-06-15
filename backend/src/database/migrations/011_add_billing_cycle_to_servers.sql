-- Migration 011: Add Billing Cycle to Servers Table
USE abs_cloud;

ALTER TABLE servers ADD COLUMN billing_cycle ENUM('Monthly', 'Quarterly', 'Half-Yearly', 'Yearly') DEFAULT 'Yearly';
