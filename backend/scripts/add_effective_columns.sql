-- Migration to add effective columns for performance optimization
ALTER TABLE cloud_mappings
ADD COLUMN effective_rate DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN effective_expiry DATE DEFAULT NULL,
ADD COLUMN effective_cycle VARCHAR(50) DEFAULT NULL,
ADD COLUMN effective_mode VARCHAR(50) DEFAULT NULL;

-- Indexing for fast filtering
CREATE INDEX idx_effective_rate ON cloud_mappings(effective_rate);
CREATE INDEX idx_effective_expiry ON cloud_mappings(effective_expiry);
