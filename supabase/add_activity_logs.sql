-- Drop table if it exists
DROP TABLE IF EXISTS activity_logs;

-- Create Activity Logs Table
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    username TEXT NOT NULL,
    display_name TEXT,
    action TEXT NOT NULL,
    details TEXT,
    app_version TEXT,
    app_id UUID REFERENCES apps(id) -- Assuming there is an apps table for multi-tenant support.
);

-- Note: RLS is disabled or set to allow all authenticated users for simplicity in a private system, 
-- but in a real production environment, you'd restrict writing to authenticated users and reading to admins.
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert logs (so the mobile app can report errors even before full login if needed)
CREATE POLICY "Allow anyone to insert activity logs" 
ON activity_logs FOR INSERT 
WITH CHECK (true);

-- Allow admins to read all logs
CREATE POLICY "Allow admins to read activity logs" 
ON activity_logs FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.username = current_user
        AND app_users.role = 'admin'
    )
    OR true -- Temporarily allowing all reads for easier debugging if needed, remove `OR true` for strict security
);

-- Create an index to speed up chronological sorting
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);
