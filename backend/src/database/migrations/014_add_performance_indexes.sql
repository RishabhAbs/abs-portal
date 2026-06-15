-- Add indexes for performance optimization

-- Cloud Servers
-- Use distinct names to avoid conflicts if they somehow exist (though IF NOT EXISTS is safer if MariaDB supports it for indexes, otherwise we trust the migration system)
-- MariaDB 10.5+ supports IF NOT EXISTS for indexes, but to be safe for older versions we can use a stored procedure or just simple ALTERs if we know they don't exist.
-- Given this is a new migration file, we assume they don't exist.

ALTER TABLE cloud_servers ADD INDEX idx_server_ip (server_ip);
ALTER TABLE cloud_servers ADD INDEX idx_customer_ip (customer_ip);

-- Customers
ALTER TABLE customer ADD INDEX idx_mobile (mobile);
ALTER TABLE customer ADD INDEX idx_pincode (pincode);
ALTER TABLE customer ADD INDEX idx_gstin (gstin);
