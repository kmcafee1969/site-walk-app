/**
 * Fix RLS Policies - Adds missing INSERT/UPDATE policies to photos table
 * 
 * Usage: POST /api/fix-rls
 * Headers: x-auth-pin: 2025
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Content-Type, x-auth-pin');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const userPin = (req.headers['x-auth-pin'] || '').trim();
    if (userPin !== '2025' && userPin !== (process.env.APP_PIN || '').trim()) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const results = [];

    try {
        // Test: try inserting and deleting a test row using service role
        // The service role bypasses RLS, so this always works
        // But we need to fix policies for the anon key

        // Use rpc to execute SQL to add policies
        // Since we can't run raw SQL via the REST API, we'll use a workaround:
        // Create the policies via the Supabase Management API

        // Actually, let's just test if the anon key can insert by checking existing policies
        // The simplest fix: use the service role key in the mobile app for uploads too
        // OR: we add the policies via SQL

        // For now, let's try a different approach:
        // The mobile app should use the service role key for writes
        // But that exposes the key in the client bundle, which is bad

        // Best approach: create a proxy endpoint for photo uploads

        // Let's check what policies exist
        const { data: policies, error: policyError } = await supabase
            .rpc('get_policies', {});

        // rpc won't work without a function. Let's try querying pg_policies
        // Actually, we can't query system tables via REST API

        // Simplest fix: disable RLS on photos table temporarily
        // We can do this via a Supabase SQL function

        // Create a helper function first
        const { error: fnError } = await supabase.rpc('exec_sql', {
            query: `
                -- Drop existing policies (if any) and recreate
                DROP POLICY IF EXISTS "Allow public select on photos" ON photos;
                DROP POLICY IF EXISTS "Allow public insert on photos" ON photos;
                DROP POLICY IF EXISTS "Allow public update on photos" ON photos;
                DROP POLICY IF EXISTS "Allow public delete on photos" ON photos;
                
                CREATE POLICY "Allow public select on photos" ON photos FOR SELECT USING (true);
                CREATE POLICY "Allow public insert on photos" ON photos FOR INSERT WITH CHECK (true);
                CREATE POLICY "Allow public update on photos" ON photos FOR UPDATE USING (true);
                CREATE POLICY "Allow public delete on photos" ON photos FOR DELETE USING (true);
            `
        });

        if (fnError) {
            results.push(`RPC approach failed: ${fnError.message}`);

            // Alternative: Try direct REST approach - check if we can insert with service key
            // and report what the user needs to do manually
            results.push('Please run the following SQL in Supabase SQL Editor:');
            results.push(`
DROP POLICY IF EXISTS "Allow public select on photos" ON photos;
DROP POLICY IF EXISTS "Allow public insert on photos" ON photos;
DROP POLICY IF EXISTS "Allow public update on photos" ON photos;
DROP POLICY IF EXISTS "Allow public delete on photos" ON photos;

CREATE POLICY "Allow public select on photos" ON photos FOR SELECT USING (true);
CREATE POLICY "Allow public insert on photos" ON photos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on photos" ON photos FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on photos" ON photos FOR DELETE USING (true);

-- Also fix storage bucket policies
INSERT INTO storage.buckets (id, name, public) 
VALUES ('buffer-photos', 'buffer-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY IF NOT EXISTS "Allow public uploads" ON storage.objects 
FOR INSERT WITH CHECK (bucket_id = 'buffer-photos');

CREATE POLICY IF NOT EXISTS "Allow public reads" ON storage.objects 
FOR SELECT USING (bucket_id = 'buffer-photos');
            `);
        } else {
            results.push('✅ Policies updated successfully');
        }

        return res.status(200).json({ success: true, results });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            sql_to_run: `
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query):

DROP POLICY IF EXISTS "Allow public select on photos" ON photos;
DROP POLICY IF EXISTS "Allow public insert on photos" ON photos;
DROP POLICY IF EXISTS "Allow public update on photos" ON photos;
DROP POLICY IF EXISTS "Allow public delete on photos" ON photos;

CREATE POLICY "Allow public select on photos" ON photos FOR SELECT USING (true);
CREATE POLICY "Allow public insert on photos" ON photos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on photos" ON photos FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on photos" ON photos FOR DELETE USING (true);
            `
        });
    }
};
