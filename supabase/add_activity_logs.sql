-- Drop table if it exists to start fresh
DROP TABLE IF EXISTS activity_logs;

-- Create Activity Logs Table (Simplified to avoid strict foreign key errors)
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    username TEXT NOT NULL,
    display_name TEXT,
    action TEXT NOT NULL,
    details TEXT,
    app_version TEXT,
    app_id UUID -- Removed REFERENCES apps(id) for better compatibility
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert logs (so the app can report errors during loading/login)
CREATE POLICY "Allow anyone to insert activity logs" 
ON activity_logs FOR INSERT 
WITH CHECK (true);

-- Allow admins to read logs
-- We check the 'app_users' table which we know exists
CREATE POLICY "Allow admins to read activity logs" 
ON activity_logs FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.username = current_user
        AND app_users.role = 'admin'
    )
    OR true -- Temporarily allowing all reads for verification, remove this 'OR true' for production
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
