-- Backfill customer last visit info from cloud_visits

-- Update lastvisitdate and lastvisitperson based on the most recent completed visit
UPDATE customer c
JOIN (
    SELECT 
        v.customer_id, 
        v.scheduled_date as last_date,
        v.user_name as last_person,
        v.check_out_remark as last_remark
    FROM cloud_visits v
    WHERE v.status = 'Completed'
    AND v.id IN (
        SELECT MAX(id) 
        FROM cloud_visits 
        WHERE status = 'Completed' 
        GROUP BY customer_id
    )
) v ON c.id = v.customer_id
SET 
    c.lastvisitdate = v.last_date,
    c.lastvisitperson = v.last_person,
    c.lastvisitremark = v.last_remark
WHERE c.lastvisitdate IS NULL;
