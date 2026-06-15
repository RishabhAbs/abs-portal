
CREATE TABLE IF NOT EXISTS tdl_customizations (
    id VARCHAR(50) PRIMARY KEY,
    person_name VARCHAR(100) NOT NULL,
    phone_no VARCHAR(20) NOT NULL,
    requirement TEXT NOT NULL,
    status ENUM('Pending', 'In Progress', 'Completed') DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
