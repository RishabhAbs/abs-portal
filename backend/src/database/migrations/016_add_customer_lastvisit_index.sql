-- Add index for customer aging filter optimization
ALTER TABLE customer ADD INDEX idx_lastvisitdate (lastvisitdate);
