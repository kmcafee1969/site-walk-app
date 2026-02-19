/**
 * SharePoint → Supabase Data Import Endpoint
 * 
 * Downloads Excel files from SharePoint and upserts into Supabase tables:
 * - Telamon Site Details.xlsx → sites table
 * - Telamon Photo Requirements.xlsx → photo_requirements table
 * - Static questionnaire field definitions → form_fields table
 * 
 * Usage: POST /api/import-data
 * Headers: x-auth-pin: 2025
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

// SharePoint config (same as sharepoint.config.js but for server-side)
const SHAREPOINT_SITE_URL = 'netorg17734095.sharepoint.com:/sites/Trid3ntCOPs';
const DOC_LIBRARY = 'Documents';
const FOLDER_PATH = 'Telamon - Viaero Site Walks';
const SITE_DETAILS_FILE = 'Telamon Site Details.xlsx';
const PHOTO_REQS_FILE = 'Telamon Photo Requirements.xlsx';

// Supabase config
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ID = process.env.VITE_APP_ID || 'dbbb0954-8591-45a7-8b1a-a4eb07ee8941';

// Helper to normalize Excel column keys
const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// Helper to safely convert values to string
const toString = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
        if (val instanceof Date) return val.toISOString().split('T')[0];
        return JSON.stringify(val);
    }
    if (typeof val === 'number' && val > 40000 && val < 60000) {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + val * 24 * 60 * 60 * 1000);
        return date.toISOString().split('T')[0];
    }
    return String(val).trim();
};

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Content-Type, x-auth-pin');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // PIN check
    const userPin = (req.headers['x-auth-pin'] || '').trim();
    if (userPin !== '2025' && userPin !== (process.env.APP_PIN || '').trim()) {
        return res.status(401).json({ error: 'Unauthorized: Invalid PIN' });
    }

    // Validate config
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'Missing Supabase configuration (VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const results = { sites: 0, requirements: 0, formFields: 0, errors: [] };

    try {
        // 1. Get SharePoint access token
        console.log('🔑 Acquiring SharePoint access token...');
        const accessToken = await getSharePointToken();

        // 2. Get SharePoint site ID and drive ID
        console.log('📂 Finding SharePoint document library...');
        const { siteId, driveId } = await getSharePointDrive(accessToken);

        // 3. Import Sites
        console.log('📊 Downloading Site Details Excel...');
        try {
            const sitesBuffer = await downloadFile(accessToken, siteId, driveId, `${FOLDER_PATH}/${SITE_DETAILS_FILE}`);
            const sitesData = parseSiteTracker(sitesBuffer);
            console.log(`📊 Parsed ${sitesData.length} sites from Excel`);

            if (sitesData.length > 0) {
                const upsertedSites = await upsertSites(supabase, sitesData);
                results.sites = upsertedSites;
                console.log(`✅ Upserted ${upsertedSites} sites to Supabase`);
            }
        } catch (err) {
            console.error('❌ Sites import error:', err.message);
            results.errors.push(`Sites: ${err.message}`);
        }

        // 4. Import Photo Requirements
        console.log('📷 Downloading Photo Requirements Excel...');
        try {
            const reqsBuffer = await downloadFile(accessToken, siteId, driveId, `${FOLDER_PATH}/${PHOTO_REQS_FILE}`);
            const reqsData = parsePhotoRequirements(reqsBuffer);
            console.log(`📷 Parsed ${reqsData.length} requirements from Excel`);

            if (reqsData.length > 0) {
                const upsertedReqs = await upsertPhotoRequirements(supabase, reqsData);
                results.requirements = upsertedReqs;
                console.log(`✅ Upserted ${upsertedReqs} requirements to Supabase`);
            }
        } catch (err) {
            console.error('❌ Requirements import error:', err.message);
            results.errors.push(`Requirements: ${err.message}`);
        }

        // 5. Seed Form Fields
        console.log('📝 Seeding form fields...');
        try {
            const seeded = await seedFormFields(supabase);
            results.formFields = seeded;
            console.log(`✅ Seeded ${seeded} form fields`);
        } catch (err) {
            console.error('❌ Form fields error:', err.message);
            results.errors.push(`Form Fields: ${err.message}`);
        }

        console.log('🎉 Import complete:', results);
        return res.status(200).json({
            success: true,
            message: `Imported ${results.sites} sites, ${results.requirements} requirements, ${results.formFields} form fields`,
            details: results
        });

    } catch (error) {
        console.error('❌ Import failed:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            details: results
        });
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

    if (!config.auth.clientSecret) {
        throw new Error('Missing AZURE_CLIENT_SECRET');
    }

    const cca = new ConfidentialClientApplication(config);
    const authResponse = await cca.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!authResponse || !authResponse.accessToken) {
        throw new Error('Failed to acquire SharePoint access token');
    }

    return authResponse.accessToken;
}

async function getSharePointDrive(accessToken) {
    // Get Site ID
    const siteRes = await graphRequest(accessToken, `/sites/${SHAREPOINT_SITE_URL}`);
    const siteId = siteRes.id;

    // Get Drives and find the Documents library
    const drivesRes = await graphRequest(accessToken, `/sites/${siteId}/drives`);
    const drive = drivesRes.value.find(d => d.name === DOC_LIBRARY);

    if (!drive) {
        throw new Error(`Document library "${DOC_LIBRARY}" not found`);
    }

    return { siteId, driveId: drive.id };
}

async function downloadFile(accessToken, siteId, driveId, filePath) {
    const endpoint = `/sites/${siteId}/drives/${driveId}/root:/${filePath}:/content`;
    const url = `https://graph.microsoft.com/v1.0${endpoint}`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Download failed (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function graphRequest(accessToken, endpoint) {
    const url = `https://graph.microsoft.com/v1.0${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Graph API error (${response.status}): ${errText}`);
    }

    return response.json();
}

// ==================== Excel Parsing ====================

function parseSiteTracker(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const sites = [];

    rawData.forEach((row) => {
        const rowMap = {};
        Object.keys(row).forEach(key => {
            rowMap[normalizeKey(key)] = row[key];
        });

        const siteId = rowMap.siteid || rowMap.id || rowMap.projectid || rowMap.projectno || rowMap.site;

        if (siteId) {
            sites.push({
                external_id: toString(siteId),
                name: toString(rowMap.sitename || rowMap.name || rowMap.projectname || siteId),
                address: toString(rowMap.address || rowMap.streetaddress),
                city: toString(rowMap.city),
                state: toString(rowMap.state),
                zip: toString(rowMap.zip || rowMap.zipcode || rowMap.postalcode),
                latitude: parseFloat(rowMap.latitude || rowMap.lat) || null,
                longitude: parseFloat(rowMap.longitude || rowMap.long || rowMap.lon) || null,
                phase: toString(rowMap.group || rowMap.phase || rowMap.projectphase),
                metadata: {
                    tower_owner: toString(rowMap.towerowner || rowMap.owner),
                    tower_owner_site_number: toString(rowMap.towerownersitenumber),
                    viaero_poc: toString(rowMap.viaeropoc),
                    site_type: toString(rowMap.sitetype || rowMap.towertype),
                    power_company: toString(rowMap.powercompany || rowMap.utilityprovider),
                    meter_number: toString(rowMap.meternumber || rowMap.meterid),
                    telco_provider: toString(rowMap.telcofiberprovider || rowMap.telco || rowMap.fiberprovider),
                    telco_provider_poc: toString(rowMap.telcofiberpoc),
                    lease_area_type: toString(rowMap.leaseareatype || rowMap.leasetype),
                    gate_code: toString(rowMap.gatecode || rowMap.gatesheltercode || rowMap.accesscode),
                    photos_uploaded: toString(rowMap.photosuploaded),
                    form_uploaded: toString(rowMap.sitewalkformuploaded || rowMap.formuploaded),
                    date_walked: toString(rowMap.datewalked),
                    walked_by: toString(rowMap.walkedby),
                }
            });
        }
    });

    return sites;
}

function parsePhotoRequirements(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const requirements = [];

    rawData.forEach((row, index) => {
        const rowMap = {};
        Object.keys(row).forEach(key => {
            rowMap[normalizeKey(key)] = row[key];
        });

        const name = rowMap.photoname || rowMap.name || rowMap.requirement || rowMap.photo;
        const externalId = rowMap.photoreqid || rowMap.id || rowMap.number || (name ? String(index + 1) : null);

        if (externalId || name) {
            requirements.push({
                external_id: String(externalId || index + 1),
                name: name || `Photo ${externalId}`,
                description: toString(rowMap.photodescription || rowMap.description || rowMap.details),
                category: toString(rowMap.category) || 'General',
                sort_order: index + 1
            });
        }
    });

    return requirements;
}

// ==================== Supabase Upserts ====================

async function upsertSites(supabase, sites) {
    // Prepare rows with app_id
    const rows = sites.map(site => ({
        app_id: APP_ID,
        external_id: site.external_id,
        name: site.name,
        address: site.address,
        city: site.city,
        state: site.state,
        zip: site.zip,
        latitude: site.latitude,
        longitude: site.longitude,
        phase: site.phase,
        status: 'active',
        metadata: site.metadata,
        updated_at: new Date().toISOString()
    }));

    // Upsert using external_id + app_id as the conflict key
    // Since there's no unique constraint on (app_id, external_id), we'll delete and re-insert
    // First delete existing sites for this app
    const { error: deleteError } = await supabase
        .from('sites')
        .delete()
        .eq('app_id', APP_ID);

    if (deleteError) {
        console.error('Delete sites error:', deleteError);
        throw new Error(`Failed to clear existing sites: ${deleteError.message}`);
    }

    // Insert in batches of 50
    let total = 0;
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error: insertError } = await supabase
            .from('sites')
            .insert(batch);

        if (insertError) {
            console.error('Insert sites error:', insertError);
            throw new Error(`Failed to insert sites (batch ${i}): ${insertError.message}`);
        }
        total += batch.length;
    }

    return total;
}

async function upsertPhotoRequirements(supabase, requirements) {
    const rows = requirements.map(req => ({
        app_id: APP_ID,
        external_id: req.external_id,
        name: req.name,
        description: req.description,
        category: req.category,
        sort_order: req.sort_order,
        updated_at: new Date().toISOString()
    }));

    // Delete existing and re-insert
    const { error: deleteError } = await supabase
        .from('photo_requirements')
        .delete()
        .eq('app_id', APP_ID);

    if (deleteError) {
        throw new Error(`Failed to clear existing requirements: ${deleteError.message}`);
    }

    // Insert in batches
    let total = 0;
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error: insertError } = await supabase
            .from('photo_requirements')
            .insert(batch);

        if (insertError) {
            throw new Error(`Failed to insert requirements (batch ${i}): ${insertError.message}`);
        }
        total += batch.length;
    }

    return total;
}

async function seedFormFields(supabase) {
    // Check if form fields already exist for this app
    const { data: existing } = await supabase
        .from('form_fields')
        .select('id')
        .eq('app_id', APP_ID)
        .limit(1);

    if (existing && existing.length > 0) {
        console.log('Form fields already seeded, skipping');
        return 0;
    }

    // Questionnaire field definitions
    const fields = [
        { field_name: 'walkedBy', field_type: 'text', label: 'Walked By', section: 'General', field_order: 1 },
        { field_name: 'dateWalked', field_type: 'date', label: 'Date Walked', section: 'General', field_order: 2 },
        { field_name: 'checkedIn', field_type: 'text', label: 'Checked In', section: 'General', field_order: 3 },
        { field_name: 'checkedOut', field_type: 'text', label: 'Checked Out', section: 'General', field_order: 4 },
        { field_name: 'towerOwner', field_type: 'text', label: 'Tower Owner', section: 'Site Info', field_order: 5 },
        { field_name: 'faNumber', field_type: 'text', label: 'FA Number', section: 'Site Info', field_order: 6 },
        { field_name: 'pocName', field_type: 'text', label: 'Viaero POC Name', section: 'Site Info', field_order: 7 },
        { field_name: 'pocPhone', field_type: 'text', label: 'Viaero POC Phone', section: 'Site Info', field_order: 8 },
        { field_name: 'pocEmail', field_type: 'text', label: 'Viaero POC Email', section: 'Site Info', field_order: 9 },
        { field_name: 'towerType', field_type: 'text', label: 'Tower Type', section: 'Site Info', field_order: 10 },
        { field_name: 'leaseAreaType', field_type: 'text', label: 'Lease Area Type', section: 'Site Info', field_order: 11 },
        { field_name: 'powerCompany', field_type: 'text', label: 'Power Company', section: 'Utilities', field_order: 12 },
        { field_name: 'meterNumber', field_type: 'text', label: 'Meter Number', section: 'Utilities', field_order: 13 },
        { field_name: 'telcoFiberProvider', field_type: 'text', label: 'Telco / Fiber Provider', section: 'Utilities', field_order: 14 },
        { field_name: 'telcoFiberPOC', field_type: 'text', label: 'Telco / Fiber POC', section: 'Utilities', field_order: 15 },
        { field_name: 'measurement1', field_type: 'text', label: 'Measurement 1 (inches)', section: 'Measurements', field_order: 16 },
        { field_name: 'measurement2', field_type: 'text', label: 'Measurement 2 (inches)', section: 'Measurements', field_order: 17 },
        { field_name: 'measurement3', field_type: 'text', label: 'Measurement 3 (inches)', section: 'Measurements', field_order: 18 },
        { field_name: 'measurement4', field_type: 'text', label: 'Measurement 4 (inches)', section: 'Measurements', field_order: 19 },
        { field_name: 'measurement5', field_type: 'text', label: 'Measurement 5 (inches)', section: 'Measurements', field_order: 20 },
        { field_name: 'measurement6', field_type: 'text', label: 'Measurement 6 (inches)', section: 'Measurements', field_order: 21 },
        { field_name: 'measurement7', field_type: 'text', label: 'Measurement 7 (inches)', section: 'Measurements', field_order: 22 },
        { field_name: 'measurement8', field_type: 'text', label: 'Measurement 8 (inches)', section: 'Measurements', field_order: 23 },
        { field_name: 'measurement9', field_type: 'text', label: 'Measurement 9 (inches)', section: 'Measurements', field_order: 24 },
        { field_name: 'measurement10', field_type: 'text', label: 'Measurement 10 (feet)', section: 'Measurements', field_order: 25 },
        { field_name: 'measurement11', field_type: 'text', label: 'Measurement 11 (feet)', section: 'Measurements', field_order: 26 },
        { field_name: 'leaseAreaIssues', field_type: 'textarea', label: 'Lease Area Issues', section: 'Issues', field_order: 27 },
        { field_name: 'gateShelterCode', field_type: 'text', label: 'Gate / Shelter Code', section: 'Access', field_order: 28 },
    ];

    const rows = fields.map(f => ({
        app_id: APP_ID,
        ...f
    }));

    const { error } = await supabase
        .from('form_fields')
        .insert(rows);

    if (error) {
        throw new Error(`Failed to seed form fields: ${error.message}`);
    }

    return rows.length;
}
