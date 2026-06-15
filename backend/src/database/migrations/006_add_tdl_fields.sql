
-- Create tdl_customizations table with all fields
CREATE TABLE IF NOT EXISTS tdl_customizations (
    id VARCHAR(50) PRIMARY KEY,
    person_name VARCHAR(255) NOT NULL,
    phone_no VARCHAR(50) NOT NULL,
    requirement TEXT NOT NULL,
    remark TEXT,
    handled_by VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
