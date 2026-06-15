-- Create new office table with cleaned schema
CREATE TABLE IF NOT EXISTS office_check_in_out_details_new (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    office_name VARCHAR(255) NOT NULL,
    office_address TEXT,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(10, 8) NOT NULL,
    radius INT DEFAULT 50,
    status ENUM('Active', 'Inactive') DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed data from old table (handling potential type conversion if needed)
-- Using IGNORE to skip errors if table already exists/populated
INSERT IGNORE INTO office_check_in_out_details_new (office_name, office_address, latitude, longitude, radius, status, created_at, updated_at)
SELECT 
    office_name, 
    office_address, 
    CAST(latitude AS DECIMAL(10,8)), 
    CAST(longitude AS DECIMAL(10,8)), 
    radious, 
    status, 
    created_at, 
    updated_at 
FROM office_check_in_out_details;

-- Create new attendance table with correct user_id type (VARCHAR)
-- Removed foreign key constraint to avoid compatibility issues with existing chaos
CREATE TABLE IF NOT EXISTS user_checkin_checkout_details_new (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    checkin_time TIME,
    checkin_latitude DECIMAL(10, 8),
    checkin_longitude DECIMAL(10, 8),
    checkin_address TEXT,
    checkout_time TIME,
    checkout_latitude DECIMAL(10, 8),
    checkout_longitude DECIMAL(10, 8),
    checkout_address TEXT,
    working_hours TIME,
    status ENUM('Present', 'Absent', 'Pending') DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create history table for 30-day tracking
CREATE TABLE IF NOT EXISTS user_location_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(10, 8) NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (user_id, recorded_at)
);
