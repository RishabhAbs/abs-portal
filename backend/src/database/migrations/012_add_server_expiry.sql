-- Add server_expiry column to servers table
-- This stores the purchase/server expiry date for the server subscription

ALTER TABLE servers ADD COLUMN IF NOT EXISTS server_expiry DATE NULL;

-- Update existing servers to have NULL expiry (to be set manually or via activities)
