/**
 * Automated Supabase → SharePoint Photo Sync
 * 
 * Downloads pending photos from Supabase Storage and uploads them
 * to the correct SharePoint folder structure.
 * 
 * Triggered automatically by Vercel Cron (every 15 min) or manually via POST.
 * 
 * Usage: POST /api/sync-photos  (or GET for cron)
 * Headers: x-auth-pin: 2025 (for manual calls)
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const { createClient } = require('@supabase/supabase-js');

// SharePoint config
const SP_SITE_URL = 'netorg17734095.sharepoint.com:/sites/Trid3ntCOPs';
const DOC_LIBRARY = 'Documents';
const BASE_FOLDER = 'Telamon - Viaero Site Walks';

// Supabase config
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ID = process.env.VITE_APP_ID || 'dbbb0954-8591-45a7-8b1a-a4eb07ee8941';

function normalizePhase(phase) {
    if (phase && phase.includes('Telamon Site Walks - ')) return phase;
    const cleanPhase = (phase || '').toUpperCase().replace('PHASE', '').trim();
    if (cleanPhase) return `Telamon Site Walks - Phase ${cleanPhase}`;
    return phase;
}

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Content-Type, x-auth-pin');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // For cron jobs (GET), verify with CRON_SECRET; for manual (POST), verify PIN
    if (req.method === 'GET') {
        // Vercel Cron sends Authorization header
        const authHeader = req.headers['authorization'];
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized cron call' });
        }
    } else {
        const userPin = (req.headers['x-auth-pin'] || '').trim();
        if (userPin !== '2025' && userPin !== (process.env.APP_PIN || '').trim()) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const results = { synced: 0, failed: 0, errors: [], total: 0 };

    try {
        // 1. Get pending photos
        const { data: pendingPhotos, error: fetchError } = await supabase
            .from('photos')
            .select('*')
            .eq('sharepoint_status', 'pending')
            .limit(20); // Process max 20 per run to stay within serverless timeout

        if (fetchError) throw new Error(`Failed to fetch pending photos: ${fetchError.message}`);

        if (!pendingPhotos || pendingPhotos.length === 0) {
            return res.status(200).json({ success: true, message: 'No pending photos to sync', details: results });
        }

        results.total = pendingPhotos.length;
        console.log(`📷 Found ${pendingPhotos.length} pending photos`);

        // 2. Get SharePoint access token
        const accessToken = await getSharePointToken();

        // 3. Get SharePoint drive info
        const { siteId, driveId } = await getSharePointDrive(accessToken);

        // 4. Load sites and photo requirements for path resolution
        const { data: sites } = await supabase.from('sites').select('*').eq('app_id', APP_ID);
        const { data: photoReqs } = await supabase.from('photo_requirements').select('*').eq('app_id', APP_ID);

        // 5. Process each photo
        for (const photo of pendingPhotos) {
            try {
                console.log(`📤 Processing: ${photo.filename}`);

                // Find the site
                const site = sites.find(s => s.id === photo.site_id);
                if (!site) {
                    throw new Error(`Site not found for ID: ${photo.site_id}`);
                }

                // Find the photo requirement (for category subfolder)
                const req = photoReqs.find(r => r.id === photo.photo_req_id);

                // Build SharePoint path
                const phaseFolderName = normalizePhase(site.phase);
                let uploadFilename = photo.filename;

                if (req) {
                    // Put in category subfolder
                    const sanitizedCategory = req.name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '');
                    uploadFilename = `${sanitizedCategory}/${photo.filename}`;
                }

                const fullPath = `${BASE_FOLDER}/${phaseFolderName}/${site.name}/PHOTOS/${uploadFilename}`;
                console.log(`📂 Target path: ${fullPath}`);

                // Download from Supabase Storage
                const { data: fileData, error: downloadError } = await supabase
                    .storage
                    .from('buffer-photos')
                    .download(photo.storage_path);

                if (downloadError) {
                    throw new Error(`Failed to download from Supabase: ${downloadError.message}`);
                }

                // Convert to buffer
                const arrayBuffer = await fileData.arrayBuffer();
                const photoBuffer = Buffer.from(arrayBuffer);

                // Upload to SharePoint
                await uploadToSharePoint(accessToken, siteId, driveId, fullPath, photoBuffer);

                // Mark as synced
                await supabase
                    .from('photos')
                    .update({
                        sharepoint_status: 'synced',
                        sharepoint_path: fullPath,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', photo.id);

                results.synced++;
                console.log(`✅ Synced: ${photo.filename}`);

            } catch (err) {
                console.error(`❌ Failed: ${photo.filename}:`, err.message);
                results.failed++;
                results.errors.push(`${photo.filename}: ${err.message}`);

                // Mark as error so we can retry later
                await supabase
                    .from('photos')
                    .update({
                        sharepoint_status: 'error',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', photo.id);
            }
        }

        console.log(`🎉 Sync complete: ${results.synced} synced, ${results.failed} failed`);
        return res.status(200).json({
            success: true,
            message: `Synced ${results.synced}/${results.total} photos to SharePoint`,
            details: results
        });

    } catch (error) {
        console.error('❌ Sync failed:', error);
        return res.status(500).json({ success: false, error: error.message, details: results });
    }
};

// ==================== SharePoint Helpers ====================

async function getSharePointToken() {
    const config = {
        auth: {
            clientId: process.env.VITE_AZURE_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${process.env.VITE_AZURE_TENANT_ID}`,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
        }
    };
    if (!config.auth.clientSecret) throw new Error('Missing AZURE_CLIENT_SECRET');

    const cca = new ConfidentialClientApplication(config);
    const authResponse = await cca.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
    });
    if (!authResponse || !authResponse.accessToken) throw new Error('Failed to acquire access token');
    return authResponse.accessToken;
}

async function getSharePointDrive(accessToken) {
    const siteRes = await graphRequest(accessToken, `/sites/${SP_SITE_URL}`);
    const siteId = siteRes.id;
    const drivesRes = await graphRequest(accessToken, `/sites/${siteId}/drives`);
    const drive = drivesRes.value.find(d => d.name === DOC_LIBRARY);
    if (!drive) throw new Error(`Drive "${DOC_LIBRARY}" not found`);
    return { siteId, driveId: drive.id };
}

async function graphRequest(accessToken, endpoint) {
    const url = `https://graph.microsoft.com/v1.0${endpoint}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Graph API error (${response.status}): ${errText}`);
    }
    return response.json();
}

async function uploadToSharePoint(accessToken, siteId, driveId, filePath, buffer) {
    // Encode each path segment
    const encodedPath = filePath.split('/').map(s => encodeURIComponent(s)).join('/');

    if (buffer.length < 4 * 1024 * 1024) {
        // Simple upload for files < 4MB
        const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:/${encodedPath}:/content`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/octet-stream'
            },
            body: buffer
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Upload failed (${response.status}): ${errText}`);
        }
        return response.json();
    } else {
        // Upload session for larger files
        const sessionUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:/${encodedPath}:/createUploadSession`;
        const sessionRes = await fetch(sessionUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                item: { '@microsoft.graph.conflictBehavior': 'replace' }
            })
        });

        if (!sessionRes.ok) throw new Error(`Failed to create upload session: ${sessionRes.statusText}`);
        const session = await sessionRes.json();

        const uploadRes = await fetch(session.uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Range': `bytes 0-${buffer.length - 1}/${buffer.length}`,
                'Content-Length': buffer.length.toString()
            },
            body: buffer
        });

        if (!uploadRes.ok) throw new Error(`Upload session failed: ${uploadRes.statusText}`);
        return uploadRes.json();
    }
}
