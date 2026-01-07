import * as XLSX from 'xlsx';

// Handle SheetJS (XLSX) being imported as a default export or namespace
const X = XLSX.default || XLSX;

// Helper to normalize keys (lowercase, remove special chars)
const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// Helper to safely convert values to string
const toString = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
        if (val instanceof Date) return val.toISOString().split('T')[0];
        return JSON.stringify(val);
    }
    return String(val).trim();
};

export const ExcelService = {
    async loadSiteTracker(file) {
        try {
            const buffer = await file.arrayBuffer();
            const workbook = X.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convert to JSON with raw values
            const rawData = X.utils.sheet_to_json(worksheet, { defval: '' });
            const sites = [];

            rawData.forEach((row, index) => {
                // Create a look-up map for this row with normalized keys
                const rowMap = {};
                Object.keys(row).forEach(key => {
                    rowMap[normalizeKey(key)] = row[key];
                });

                // Check for various ID fields
                const siteId = rowMap.siteid || rowMap.id || rowMap.projectid || rowMap.projectno || rowMap.site;

                if (siteId) {
                    sites.push({
                        id: toString(siteId),
                        name: toString(rowMap.sitename || rowMap.name || rowMap.projectname),
                        address: toString(rowMap.address || rowMap.streetaddress),
                        city: toString(rowMap.city),
                        state: toString(rowMap.state),
                        zip: toString(rowMap.zip || rowMap.zipcode || rowMap.postalcode),
                        latitude: toString(rowMap.latitude || rowMap.lat),
                        longitude: toString(rowMap.longitude || rowMap.long || rowMap.lon),
                        phase: toString(rowMap.group || rowMap.phase || rowMap.projectphase),
                        towerOwner: toString(rowMap.towerowner || rowMap.owner),
                        powerCompany: toString(rowMap.powercompany || rowMap.utilityprovider),
                        meterNumber: toString(rowMap.meternumber || rowMap.meterid),
                        telcoProvider: toString(rowMap.telcofiberprovider || rowMap.telco || rowMap.fiberprovider),
                        leaseAreaType: toString(rowMap.leaseareatype || rowMap.leasetype),
                        gateCode: toString(rowMap.gatecode || rowMap.gatesheltercode || rowMap.accesscode),
                        photosUploaded: toString(rowMap.photosuploaded),
                        formUploaded: toString(rowMap.sitewalkformuploaded || rowMap.formuploaded),
                        dateWalked: toString(rowMap.datewalked),
                        walkedBy: toString(rowMap.walkedby)
                    });
                }
            });

            return sites;
        } catch (error) {
            console.error('Error loading site tracker:', error);
            throw new Error('Failed to load site tracker Excel file');
        }
    },

    async loadPhotoRequirements(file) {
        try {
            const buffer = await file.arrayBuffer();
            const workbook = X.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            const rawData = X.utils.sheet_to_json(worksheet, { defval: '' });
            const requirements = [];

            rawData.forEach((row, index) => {
                const rowMap = {};
                Object.keys(row).forEach(key => {
                    rowMap[normalizeKey(key)] = row[key];
                });

                const name = rowMap.photoname || rowMap.name || rowMap.requirement || rowMap.photo;
                // Generate ID if missing, or use index + 1
                const id = rowMap.photoreqid || rowMap.id || rowMap.number || (name ? String(index + 1) : null);

                if (id || name) {
                    requirements.push({
                        id: String(id),
                        category: rowMap.category || 'General',
                        name: name || `Photo ${id}`,
                        description: rowMap.photodescription || rowMap.description || rowMap.details || ''
                    });
                }
            });

            return requirements;
        } catch (error) {
            console.error('Error loading photo requirements:', error);
            throw new Error('Failed to load photo requirements Excel file');
        }
    },

    async parseQuestionnaire(file) {
        try {
            const buffer = await file.arrayBuffer();
            const workbook = X.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convert to array of arrays (rows)
            const rows = X.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            const formData = {};

            // Helper to clean key
            const cleanKey = (k) => String(k).trim().toLowerCase();

            rows.forEach(row => {
                if (row.length < 2) return;
                const key = cleanKey(row[0]);
                const value = toString(row[1]);

                if (!key || !value) return;

                // Mapping logic
                if (key === 'walked by') formData.walkedBy = value;
                else if (key === 'date walked') formData.dateWalked = value;
                else if (key === 'checked in') formData.checkedIn = value;
                else if (key === 'checked out') formData.checkedOut = value;
                else if (key === 'tower owner') formData.towerOwner = value;
                else if (key === 'fa number') formData.faNumber = value;
                else if (key === 'viaero poc') {
                    // split "Name, Phone, Email"
                    const parts = value.split(',').map(s => s.trim());
                    if (parts[0]) formData.pocName = parts[0];
                    if (parts[1]) formData.pocPhone = parts[1];
                    if (parts[2]) formData.pocEmail = parts[2];
                }
                else if (key === 'tower type') formData.towerType = value;
                else if (key === 'lease area type') formData.leaseAreaType = value;
                else if (key === 'power company') formData.powerCompany = value;
                else if (key === 'meter number') formData.meterNumber = value;
                else if (key.includes('telco') && key.includes('provider')) formData.telcoFiberProvider = value; // fuzzy match
                else if (key.includes('telco') && key.includes('poc')) formData.telcoFiberPOC = value;

                // Measurements
                else if (key.startsWith('measurement')) {
                    // Extract number
                    const match = key.match(/measurement (\d+)/);
                    if (match && match[1]) {
                        formData[`measurement${match[1]}`] = value;
                    }
                }
                else if (key === 'lease area issues') formData.leaseAreaIssues = value;
                else if (key.includes('gate') && key.includes('code')) formData.gateShelterCode = value;
            });

            return formData;
        } catch (error) {
            console.error('Error parsing questionnaire:', error);
            throw new Error('Failed to parse questionnaire Excel file');
        }
    },

    async generateUpdatedTracker(sites, questionnaires) {
        try {
            console.log('Starting Excel generation with SheetJS...');

            // Define headers
            const headers = [
                'SiteID', 'SiteName', 'Address', 'City', 'State', 'Zip', 'County',
                'Latitude', 'Longitude', 'Notes', 'Group', 'Tower Owner',
                'Tower Owner Site Number', 'Viaero POC', 'Site Type', 'Lease Area Type',
                'Power Company', 'Meter Number', 'Telco / Fiber Provider', 'Telco / Fiber POC',
                'Measurement 1 (inches)', 'Measurement 2 (inches)', 'Measurement 3 (inches)',
                'Measurement 4 (inches)', 'Measurement 5 (inches)', 'Measurement 6 (inches)',
                'Measurement 7 (inches)', 'Measurement 8 (inches)', 'Measurement 9 (inches)',
                'Measurement 10 (feet)', 'Measurement 11 (feet)',
                'Walked By', 'Date Walked', 'Checked In', 'Checked Out',
                'Lease Area Issues', 'Gate/Shelter Code',
                'Photos Uploaded', 'Site Walk Form Uploaded', 'Measurements PDF Uploaded',
                'Confirmation Email Recv\'d', 'Action Needed'
            ];

            const rows = [headers];

            sites.forEach((site) => {
                const questionnaire = questionnaires[site.id];

                const viaeroPOC = [
                    questionnaire?.pocName || '',
                    questionnaire?.pocPhone || '',
                    questionnaire?.pocEmail || ''
                ].filter(val => val && val !== 'N/A').join(' | ');

                const row = [
                    site.id,
                    site.name,
                    site.address,
                    site.city,
                    site.state,
                    site.zip,
                    '', // County
                    site.latitude,
                    site.longitude,
                    '', // Notes
                    site.phase,
                    questionnaire?.towerOwner || site.towerOwner,
                    questionnaire?.faNumber || '',
                    viaeroPOC,
                    '', // Site Type
                    questionnaire?.leaseAreaType || site.leaseAreaType,
                    questionnaire?.powerCompany || site.powerCompany,
                    questionnaire?.meterNumber || site.meterNumber,
                    questionnaire?.telcoProvider || '',
                    questionnaire?.telcoPOC || '',
                    questionnaire?.measurement1 || '',
                    questionnaire?.measurement2 || '',
                    questionnaire?.measurement3 || '',
                    questionnaire?.measurement4 || '',
                    questionnaire?.measurement5 || '',
                    questionnaire?.measurement6 || '',
                    questionnaire?.measurement7 || '',
                    questionnaire?.measurement8 || '',
                    questionnaire?.measurement9 || '',
                    questionnaire?.measurement10 || '',
                    questionnaire?.measurement11 || '',
                    questionnaire?.walkedBy || '',
                    questionnaire?.dateWalked || '',
                    questionnaire?.checkInTime || '',
                    questionnaire?.checkOutTime || '',
                    questionnaire?.leaseAreaIssues || '',
                    questionnaire?.gateCode || site.gateCode,
                    '', // Photos Uploaded
                    '', // Site Walk Form Uploaded
                    '', // Measurements PDF Uploaded
                    '', // Confirmation Email Recv'd
                    '' // Action Needed
                ];

                rows.push(row);
            });

            const wb = X.utils.book_new();
            const ws = X.utils.aoa_to_sheet(rows);
            X.utils.book_append_sheet(wb, ws, 'Site Tracker');
            const buffer = X.write(wb, { type: 'array', bookType: 'xlsx' });

            return buffer;
        } catch (error) {
            console.error('Error in generateUpdatedTracker:', error);
            throw error;
        }
    }
};
