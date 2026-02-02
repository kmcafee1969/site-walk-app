import { Client } from '@microsoft/microsoft-graph-client';
import AuthService from './AuthService';
import { sharepointConfig } from '../config/sharepoint.config';
import { ExcelService } from './ExcelService';
import * as XLSX from 'xlsx';

class SharePointService {
    /**
     * Helper to find a matching folder name case-insensitively
     */
    async findMatchingFolder(parentPath, targetName) {
        try {
            const siteId = await this.getSiteId();
            const libraryName = sharepointConfig.sharepoint.documentLibrary;

            // 1. Get the drive ID
            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const targetDrive = drives.value.find(d => d.name === libraryName);
            if (!targetDrive) return targetName; // Fallback

            // 2. List children of parent path
            // Handle root vs subfolder
            const itemPath = parentPath ? `/root:/${parentPath}:` : '/root';
            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}${itemPath}/children?select=name,folder`;

            const response = await this.proxyRequest(endpoint);
            const children = response.value || [];

            // 3. Find match
            // Try exact match first
            const exact = children.find(c => c.name === targetName);
            if (exact) return exact.name;

            // Try case-insensitive
            const lowerTarget = targetName.toLowerCase();
            const fuzzy = children.find(c => c.name.toLowerCase() === lowerTarget);
            if (fuzzy) return fuzzy.name;

            // Try containing match (for Phase folders e.g. "Phase 11" matches "Telamon Site Walks - Phase 11")
            if (targetName.includes('Phase')) {
                const phaseNum = targetName.replace(/[^0-9]/g, '');
                const phaseMatch = children.find(c => c.name.includes(`Phase ${phaseNum}`));
                if (phaseMatch) return phaseMatch.name;
            }

            return targetName; // No match found, use original (will create new)
        } catch (error) {
            console.warn(`Could not resolve folder ${targetName} in ${parentPath}:`, error);
            return targetName; // Fallback on error
        }
    }

    /**
     * Resolve full path by checking each segment
     */
    async resolveSharePointPath(phase, siteName, subfolder = 'PHOTOS') {
        let rootFolder = sharepointConfig.sharepoint.folderPath;

        // 0. Resolve Root Folder (in case of hyphen/spacing issues)
        rootFolder = await this.findMatchingFolder(null, rootFolder);

        // 1. Resolve Phase Folder
        // Input might be "Phase 11" or "PHASE 11" -> want "Telamon Site Walks - Phase 11"
        const phaseNameInput = sharepointConfig.sharepoint.normalizePhase(phase);
        const resolvedPhase = await this.findMatchingFolder(rootFolder, phaseNameInput);

        // 2. Resolve Site Folder
        // Input "NE-Franklin" -> want "NE-FRANKLIN" (or whatever exists)
        const phasePath = `${rootFolder}/${resolvedPhase}`;
        const resolvedSiteKey = await this.findMatchingFolder(phasePath, siteName);

        // 3. Return path with optional subfolder
        return subfolder
            ? `${rootFolder}/${resolvedPhase}/${resolvedSiteKey}/${subfolder}`
            : `${rootFolder}/${resolvedPhase}/${resolvedSiteKey}`;
    }

    /**
     * Helper to make authenticated requests via Vercel proxy
     */
    async proxyRequest(endpoint, method = 'GET', body = null, isBinary = false) {
        // Simple security check: Use the hardcoded PIN for now
        const PIN = '2025';

        const headers = {
            'Content-Type': 'application/json',
            'x-auth-pin': PIN
        };

        const options = {
            method: 'POST', // Always POST to the proxy itself
            headers: headers,
            body: JSON.stringify({
                endpoint,
                method,
                body
            })
        };

        try {
            const response = await fetch('/api/proxy', options);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Proxy Request Failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            if (isBinary) {
                return await response.arrayBuffer();
            }

            return await response.json();
        } catch (e) {
            console.error("Proxy fetch failed:", e);
            throw new Error(`Proxy Connection Failed: ${e.message}`);
        }
    }

    /**
     * Get site ID from site URL
     */
    async getSiteId() {
        // We can cache this if needed, but for now just fetch
        const siteUrl = sharepointConfig.sharepoint.siteUrl;
        const hostname = new URL(siteUrl).hostname;
        const sitePath = new URL(siteUrl).pathname;

        const site = await this.proxyRequest(`/sites/${hostname}:${sitePath}`);
        return site.id;
    }

    /**
     * Download Excel file from SharePoint
     */
    async downloadExcelFile(filename) {
        try {
            const siteId = await this.getSiteId();
            console.log(`Downloading file: ${filename} from site: ${siteId}`);

            // Get drives to find the document library
            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);

            // Find the Documents library
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            if (!targetDrive) {
                throw new Error(`Document library "${libraryName}" not found`);
            }

            // Construct file path with folder
            const folderPath = sharepointConfig.sharepoint.folderPath;
            const filePath = `${folderPath}/${filename}`;
            console.log(`Downloading via proxy: ${filePath}`);

            // Download the file (binary)
            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}/root:/${filePath}:/content`;
            return await this.proxyRequest(endpoint, 'GET', null, true); // true for binary
        } catch (error) {
            console.error(`Error downloading ${filename}:`, error);
            throw error;
        }
    }

    /**
     * Parse Excel file buffer using ExcelService
     */
    async parseWithExcelService(fileBuffer, type) {
        const mockFile = {
            arrayBuffer: async () => fileBuffer
        };

        if (type === 'tracker') {
            return ExcelService.loadSiteTracker(mockFile);
        } else if (type === 'requirements') {
            return ExcelService.loadPhotoRequirements(mockFile);
        }
        throw new Error('Unknown parse type');
    }

    /**
     * Load site details
     */
    async loadSiteDetails() {
        try {
            const filename = sharepointConfig.sharepoint.siteDetailsFile;
            const fileBuffer = await this.downloadExcelFile(filename);
            return await this.parseWithExcelService(fileBuffer, 'tracker');
        } catch (error) {
            console.error('Error loading site details:', error);
            throw error;
        }
    }

    /**
     * Get the drive item ID for the Site Tracker Excel file
     * Required for Graph Excel API operations
     */
    async getTrackerDriveItemId() {
        const siteId = await this.getSiteId();
        const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
        const libraryName = sharepointConfig.sharepoint.documentLibrary;
        const targetDrive = drives.value.find(d => d.name === libraryName);

        if (!targetDrive) throw new Error('Document library not found');

        const folderPath = sharepointConfig.sharepoint.folderPath;
        const filename = sharepointConfig.sharepoint.siteDetailsFile;
        const filePath = `${folderPath}/${filename}`;

        // Get the item by path to retrieve its ID
        const item = await this.proxyRequest(
            `/sites/${siteId}/drives/${targetDrive.id}/root:/${filePath}`
        );

        // Get the list of worksheets and use the first one
        const worksheets = await this.proxyRequest(
            `/sites/${siteId}/drives/${targetDrive.id}/items/${item.id}/workbook/worksheets`
        );

        const worksheetName = worksheets.value && worksheets.value[0] ? worksheets.value[0].name : 'Sheet1';
        console.log('📑 Using worksheet:', worksheetName);

        return { siteId, driveId: targetDrive.id, itemId: item.id, worksheetName };
    }

    /**
     * Find the row number for a specific site in the tracker
     * Uses Graph Excel API to read column A (SiteID)
     */
    async findSiteRowInTracker(targetSiteId) {
        try {
            const { siteId, driveId, itemId, worksheetName } = await this.getTrackerDriveItemId();

            // First, read header row to log column names
            const headerEndpoint = `/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets('${worksheetName}')/range(address='A1:AZ1')`;
            const headerResponse = await this.proxyRequest(headerEndpoint, 'GET');
            const headers = headerResponse.values[0] || [];
            console.log('📊 EXCEL COLUMN HEADERS:', headers.map((h, i) => `${i}:${h}`).join(' | '));

            // Read column A (SiteID) to find the row
            // Assume max 500 rows, read A1:A500
            const endpoint = `/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets('${worksheetName}')/range(address='A1:A500')`;
            const response = await this.proxyRequest(endpoint, 'GET');

            const values = response.values || [];

            // Find the row (1-indexed in Excel)
            for (let i = 0; i < values.length; i++) {
                const cellValue = String(values[i][0] || '').trim();
                if (cellValue === String(targetSiteId).trim()) {
                    console.log(`Found site ${targetSiteId} at row ${i + 1}`);
                    return i + 1; // Excel rows are 1-indexed
                }
            }

            console.warn(`Site ${targetSiteId} not found in tracker`);
            return null;
        } catch (error) {
            console.error('Error finding site row:', error);
            throw error;
        }
    }

    /**
     * Update a specific row in the Site Tracker with questionnaire data
     * Uses Graph Excel API PATCH to update cells directly
     */
    async updateSiteTrackerRow(targetSiteId, formData) {
        try {
            console.log(`Updating tracker for site ${targetSiteId}...`);

            const { siteId, driveId, itemId, worksheetName } = await this.getTrackerDriveItemId();
            const rowNumber = await this.findSiteRowInTracker(targetSiteId);

            if (!rowNumber) {
                throw new Error(`Site ${targetSiteId} not found in Site Tracker`);
            }

            // Read header row to build dynamic column mapping
            const headerEndpoint = `/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets('${worksheetName}')/range(address='A1:AZ1')`;
            const headerResponse = await this.proxyRequest(headerEndpoint, 'GET');
            const headers = headerResponse.values[0] || [];

            // Build column index map (normalize header names)
            const normalizeHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const columnMap = {};
            headers.forEach((h, i) => {
                columnMap[normalizeHeader(h)] = i;
            });

            console.log('📊 Column map built:', Object.keys(columnMap).slice(0, 20).join(', '));

            // Read current row
            const rowAddress = `A${rowNumber}:AZ${rowNumber}`;
            const currentRow = await this.proxyRequest(
                `/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets('${worksheetName}')/range(address='${rowAddress}')`,
                'GET'
            );

            const rowValues = currentRow.values[0] || [];
            while (rowValues.length < 52) rowValues.push('');

            // Helper to update column by name
            const setColumn = (headerName, value) => {
                const idx = columnMap[normalizeHeader(headerName)];
                if (idx !== undefined && value !== undefined) {
                    rowValues[idx] = value;
                    console.log(`  Set ${headerName} (col ${idx}) = ${String(value).substring(0, 30)}`);
                }
            };

            // Update fields using header names
            setColumn('Walked By', formData.walkedBy);
            setColumn('Date Walked', formData.dateWalked);
            setColumn('Checked In', formData.checkedIn);
            setColumn('Checked Out', formData.checkedOut);
            setColumn('Tower Owner', formData.towerOwner);
            setColumn('Tower Owner Site Number', formData.faNumber);
            setColumn('Lease Area Type', formData.leaseAreaType);
            setColumn('Power Company', formData.powerCompany);
            setColumn('Meter Number', formData.meterNumber);
            setColumn('Telco / Fiber Provider', formData.telcoFiberProvider);
            setColumn('Telco / Fiber POC', formData.telcoFiberPOC);
            setColumn('Lease Area Issues', formData.leaseAreaIssues);
            setColumn('Gate/Shelter Code', formData.gateShelterCode);

            // Measurements
            for (let i = 1; i <= 9; i++) {
                setColumn(`Measurement ${i} (inches)`, formData[`measurement${i}`]);
            }
            setColumn('Measurement 10 (feet)', formData.measurement10);
            setColumn('Measurement 11 (feet)', formData.measurement11);

            // PATCH the row
            const patchEndpoint = `/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets('${worksheetName}')/range(address='${rowAddress}')`;
            await this.proxyRequest(patchEndpoint, 'PATCH', {
                values: [rowValues]
            });

            console.log(`✓ Updated tracker row ${rowNumber} for site ${targetSiteId}`);
            return true;
        } catch (error) {
            console.error('Error updating site tracker row:', error);
            throw error;
        }
    }

    /**
     * Load photo requirements
     */
    async loadPhotoRequirements() {
        try {
            const filename = sharepointConfig.sharepoint.photoRequirementsFile;
            const fileBuffer = await this.downloadExcelFile(filename);
            return await this.parseWithExcelService(fileBuffer, 'requirements');
        } catch (error) {
            console.error('Error loading photo requirements:', error);
            throw error;
        }
    }

    /**
     * Upload photo to SharePoint
     * Uses Upload Session for reliability and direct upload capability
     */
    async uploadPhoto(phase, siteName, filename, photoBlob) {
        try {
            const siteId = await this.getSiteId();
            // Verify connection
            await this.getSiteId();

            // RESOLVE PATH DYNAMICALLY
            // This prevents duplicate folder creation by finding the ACTUAL existing folder name
            // regardless of case (e.g. finding "CO-ATWOOD" when input is "co-atwood")
            const resolvedPath = await this.resolveSharePointPath(phase, siteName);
            const fullPath = `${resolvedPath}/${filename}`;

            console.log(`🚀 STARTING UPLOAD: ${filename}`);
            console.log(`📂 Resolved Target Path: ${fullPath}`);

            console.log(`Requesting upload session for: ${fullPath}`);

            // 1. Get Upload URL from Proxy
            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            if (!targetDrive) throw new Error("Drive not found");

            // Encode the full path safely
            // Split by slash and encode EACH segment, then join
            const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/');

            const createSessionUrl = `/sites/${siteId}/drives/${targetDrive.id}/root:/${encodedPath}:/createUploadSession`;
            const session = await this.proxyRequest(createSessionUrl, 'POST', {
                item: {
                    "@microsoft.graph.conflictBehavior": "replace"
                }
            });

            const uploadUrl = session.uploadUrl;
            console.log("Got upload URL, uploading direct to Microsoft...");

            // 2. Upload Direct to Microsoft
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Range': `bytes 0-${photoBlob.size - 1}/${photoBlob.size}`,
                    'Content-Length': photoBlob.size
                },
                body: photoBlob
            });

            if (!uploadResponse.ok) {
                throw new Error(`Direct Upload Failed: ${uploadResponse.statusText}`);
            }

            console.log(`Photo uploaded successfully: ${fullPath}`);
            return true;
        } catch (error) {
            console.error('Error uploading photo:', error);
            throw error;
        }
    }

    /**
     * Upload Zip file containing all photos
     */
    async uploadZip(phase, siteName, siteId, zipFilename, zipBlob) {
        try {
            const siteIdValue = await this.getSiteId();

            // RESOLVE PATH: .../[Phase]/[Site Name]/PHOTOS
            // We want the zip to arrive in the PHOTOS folder, matching the user's request
            // User Request: "name the zip file {site name} [site ID] PHOTOS.zip and upload it to the PHOTOS folder in the site folder."
            const resolvedPath = await this.resolveSharePointPath(phase, siteName, 'PHOTOS');
            const fullPath = `${resolvedPath}/${zipFilename}`;

            console.log(`🚀 STARTING ZIP UPLOAD: ${zipFilename}`);
            console.log(`📂 Resolved Target Path: ${fullPath}`);

            const drives = await this.proxyRequest(`/sites/${siteIdValue}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            if (!targetDrive) throw new Error("Drive not found");

            // Create Upload Session (Zip is likely >4MB)
            const encodedPath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
            const createSessionUrl = `/sites/${siteIdValue}/drives/${targetDrive.id}/root:/${encodedPath}:/createUploadSession`;

            const session = await this.proxyRequest(createSessionUrl, 'POST', {
                item: { "@microsoft.graph.conflictBehavior": "replace" }
            });

            const uploadUrl = session.uploadUrl;
            console.log("Got upload URL, uploading Zip to Microsoft...");

            // For large files, upload in chunks (10MB each)
            const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
            const fileSize = zipBlob.size;

            if (fileSize <= CHUNK_SIZE) {
                // Small file - single upload
                console.log(`Small file (${(fileSize / 1024 / 1024).toFixed(2)} MB), uploading in one request...`);
                try {
                    const uploadResponse = await fetch(uploadUrl, {
                        method: 'PUT',
                        headers: {
                            'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
                            'Content-Length': fileSize.toString()
                        },
                        body: zipBlob
                    });

                    if (!uploadResponse.ok) {
                        throw new Error(`Direct Zip Upload Failed: ${uploadResponse.statusText}`);
                    }
                } catch (err) {
                    console.error("Upload fetch failed:", err);
                    throw new Error(`Microsoft Upload Connection Failed: ${err.message}`);
                }
            } else {
                // Large file - chunked upload
                console.log(`Large file (${(fileSize / 1024 / 1024).toFixed(2)} MB), uploading in ${CHUNK_SIZE / 1024 / 1024}MB chunks...`);

                let start = 0;
                let chunkNumber = 1;
                const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

                while (start < fileSize) {
                    const end = Math.min(start + CHUNK_SIZE, fileSize);
                    const chunk = zipBlob.slice(start, end);

                    console.log(`Uploading chunk ${chunkNumber}/${totalChunks}: bytes ${start}-${end - 1}/${fileSize}`);

                    try {
                        const uploadResponse = await fetch(uploadUrl, {
                            method: 'PUT',
                            headers: {
                                'Content-Range': `bytes ${start}-${end - 1}/${fileSize}`,
                                'Content-Length': (end - start).toString()
                            },
                            body: chunk
                        });

                        if (!uploadResponse.ok && uploadResponse.status !== 202) {
                            const errorText = await uploadResponse.text();
                            throw new Error(`Chunk upload failed: ${uploadResponse.status} - ${errorText}`);
                        }

                        const progress = Math.round((end / fileSize) * 100);
                        console.log(`✓ Chunk ${chunkNumber} uploaded (${progress}% complete)`);
                    } catch (err) {
                        console.error(`Chunk ${chunkNumber} upload failed:`, err);
                        throw new Error(`Microsoft Upload Connection Failed at chunk ${chunkNumber}: ${err.message}`);
                    }

                    start = end;
                    chunkNumber++;
                }
            }

            console.log(`✅ Zip uploaded successfully: ${fullPath}`);
            return true;
        } catch (error) {
            console.error('Error uploading zip:', error);
            throw error;
        }
    }

    /**
     * Upload questionnaire Excel
     */
    async uploadQuestionnaire(phase, siteName, siteId, excelBuffer) {
        try {
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            const sharepointSiteId = await this.getSiteId();

            // RESOLVE PATH DYNAMICALLY (No subfolder for questionnaire)
            const resolvedPath = await this.resolveSharePointPath(phase, siteName, null);

            // Construct filename
            const filenameOnly = `Telamon Site Walk Form ${siteName} ${siteId}.xlsx`;
            const fullPath = `${resolvedPath}/${filenameOnly}`;

            console.log(`🚀 STARTING QUESTIONNAIRE UPLOAD: ${filenameOnly}`);
            console.log(`📂 Resolved Target Path: ${fullPath}`);

            const drives = await this.proxyRequest(`/sites/${sharepointSiteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            // Encode path safely
            const encodedPath = fullPath.split('/').map(s => encodeURIComponent(s)).join('/');
            const createSessionUrl = `/sites/${sharepointSiteId}/drives/${targetDrive.id}/root:/${encodedPath}:/createUploadSession`;
            const session = await this.proxyRequest(createSessionUrl, 'POST', {
                item: { "@microsoft.graph.conflictBehavior": "replace" }
            });

            console.log("Got upload URL, uploading direct to Microsoft...");

            const uploadResponse = await fetch(session.uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Range': `bytes 0-${blob.size - 1}/${blob.size}`,
                    'Content-Length': blob.size
                },
                body: blob
            });

            if (!uploadResponse.ok) {
                throw new Error(`Direct Upload Failed: ${uploadResponse.statusText}`);
            }

            return true;
        } catch (error) {
            console.error('Error uploading questionnaire:', error);
            throw error;
        }
    }

    /**
     * Check if a questionnaire exists in SharePoint
     */
    async checkQuestionnaireExists(phase, siteName, siteId) {
        try {
            // PASS NULL as subfolder to look in the SITE root, not PHOTOS
            const files = await this.listFiles(phase, siteName, null);
            console.log(`[CheckQuestionnaire] Found ${files.length} files in ${siteName} folder`);

            // Relaxed check: ends with .xlsx and contains "questionnaire" or "form"
            const match = files.find(f => {
                const name = f.name.toLowerCase();
                return name.endsWith('.xlsx') && (name.includes('questionnaire') || name.includes('site walk form') || name.includes('form'));
            });

            if (match) {
                console.log(`v Found matching questionnaire: ${match.name}`);
                return true;
            }

            console.log(`x No matching questionnaire found. Files: ${files.map(f => f.name).join(', ')}`);
            return false;
        } catch (error) {
            console.error('Error checking questionnaire existence:', error);
            return false;
        }
    }

    /**
     * Download and parse questionnaire
     */
    async downloadQuestionnaire(phase, siteName, siteId) {
        try {
            const filename = `Telamon Site Walk Form ${siteName} ${siteId}.xlsx`;

            // Re-use resolving logic from downloadExcelFile/downloadPhoto via downloadExcelFile
            // But downloadExcelFile assumes "Documents" folder root.
            // We need to target the specific site folder.

            const siteIdSharePoint = await this.getSiteId();
            const resolvedPath = await this.resolveSharePointPath(phase, siteName, null);
            const fullPath = `${resolvedPath}/${filename}`;

            console.log(`Downloading questionnaire: ${fullPath}`);

            // Get drives
            const drives = await this.proxyRequest(`/sites/${siteIdSharePoint}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            // Encode path
            const encodedPath = fullPath.split('/').map(s => encodeURIComponent(s)).join('/');
            const endpoint = `/sites/${siteIdSharePoint}/drives/${targetDrive.id}/root:/${encodedPath}:/content`;

            const buffer = await this.proxyRequest(endpoint, 'GET', null, true);

            // Parse with ExcelService
            const mockFile = { arrayBuffer: async () => buffer };
            return await ExcelService.parseQuestionnaire(mockFile);

        } catch (error) {
            console.error('Error downloading questionnaire:', error);
            throw error;
        }
    }



    /**
     * Delete file from SharePoint
     */
    async deleteFile(phase, siteName, filename) {
        try {
            const siteId = await this.getSiteId();

            // Resolve path dynamically
            const resolvedPath = await this.resolveSharePointPath(phase, siteName);
            const fullPath = `${resolvedPath}/${filename}`;

            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}/root:/${fullPath}`;

            await this.proxyRequest(endpoint, 'DELETE');
            console.log(`✓ File deleted successfully: ${fullPath}`);
            return true;
        } catch (error) {
            console.error('Error deleting file:', error);
            if (error.message.includes('404')) return true;
            throw error;
        }
    }

    /**
     * List files in a site folder
     * Returns items with: name, id, size, lastModifiedDateTime, folder (if folder), childCount
     */
    async listFiles(phase, siteName, subfolder = 'PHOTOS') {
        try {
            const siteId = await this.getSiteId();

            // Resolve path dynamically
            const photoPath = await this.resolveSharePointPath(phase, siteName, subfolder);

            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            // Include 'folder' property to distinguish folders from files
            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}/root:/${photoPath}:/children?select=name,id,size,lastModifiedDateTime,folder`;

            const response = await this.proxyRequest(endpoint);
            return response.value || [];
        } catch (error) {
            console.error('Error listing files:', error);
            return [];
        }
    }

    /**
     * Check if a specific file exists in SharePoint
     */
    async checkFileExists(phase, siteName, filename, subfolder = 'PHOTOS') {
        try {
            const files = await this.listFiles(phase, siteName, subfolder);
            return files.some(f => f.name === filename);
        } catch (error) {
            console.error('Error checking file existence:', error);
            return false;
        }
    }

    /**
     * Get next available filename (appends _1, _2, etc. if file exists)
     * @param {string} phase - Site phase
     * @param {string} siteName - Site name
     * @param {string} baseFilename - Base filename (e.g., "overall_compound.zip")
     * @param {string} subfolder - Subfolder name
     * @returns {Promise<string>} - Available filename
     */
    async getNextAvailableFilename(phase, siteName, baseFilename, subfolder = 'PHOTOS') {
        try {
            const files = await this.listFiles(phase, siteName, subfolder);
            const existingNames = new Set(files.map(f => f.name.toLowerCase()));

            // Check if base filename is available
            if (!existingNames.has(baseFilename.toLowerCase())) {
                return baseFilename;
            }

            // Parse base name and extension
            const lastDotIndex = baseFilename.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? baseFilename.substring(0, lastDotIndex) : baseFilename;
            const extension = lastDotIndex > 0 ? baseFilename.substring(lastDotIndex) : '';

            // Find next available number
            let counter = 1;
            while (counter < 100) { // Safety limit
                const newFilename = `${baseName}_${counter}${extension}`;
                if (!existingNames.has(newFilename.toLowerCase())) {
                    return newFilename;
                }
                counter++;
            }

            // Fallback with timestamp
            return `${baseName}_${Date.now()}${extension}`;
        } catch (error) {
            console.error('Error getting next available filename:', error);
            // Fallback with timestamp
            const lastDotIndex = baseFilename.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? baseFilename.substring(0, lastDotIndex) : baseFilename;
            const extension = lastDotIndex > 0 ? baseFilename.substring(lastDotIndex) : '';
            return `${baseName}_${Date.now()}${extension}`;
        }
    }

    /**
     * Get direct SharePoint URL for the PHOTOS folder
     * Used for "View in SharePoint" button to avoid loading photos into memory
     */
    getPhotoFolderUrl(phase, siteName) {
        const siteUrl = sharepointConfig.sharepoint.siteUrl;
        const rootFolder = sharepointConfig.sharepoint.folderPath;
        const normalizedPhase = sharepointConfig.sharepoint.normalizePhase(phase);

        // Build path matching SharePoint's exact format
        // Example working URL id param: /sites/Trid3ntCOPs/Shared Documents/Telamon - Viaero Site Walks/Telamon Site Walks- Phase 11/CO-ATWOOD/PHOTOS
        const fullPath = `/sites/Trid3ntCOPs/Shared Documents/${rootFolder}/${normalizedPhase}/${siteName}/PHOTOS`;

        // Encode the entire path for the id parameter
        const encodedId = encodeURIComponent(fullPath);

        return `${siteUrl}/Shared%20Documents/Forms/AllItems.aspx?id=${encodedId}`;
    }

    /**
     * Get direct SharePoint URL for a category subfolder in PHOTOS
     * Used for "View in SharePoint" button to go directly to category folder
     * @param {string} phase - Site phase
     * @param {string} siteName - Site name
     * @param {string} categoryName - Photo requirement name (will be sanitized)
     */
    getCategoryFolderUrl(phase, siteName, categoryName) {
        const siteUrl = sharepointConfig.sharepoint.siteUrl;
        const rootFolder = sharepointConfig.sharepoint.folderPath;
        const normalizedPhase = sharepointConfig.sharepoint.normalizePhase(phase);

        // Sanitize category name to match folder name created by Power Automate
        const sanitizedCategory = categoryName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

        // Build full path including category subfolder
        const fullPath = `/sites/Trid3ntCOPs/Shared Documents/${rootFolder}/${normalizedPhase}/${siteName}/PHOTOS/${sanitizedCategory}`;

        // Encode the entire path for the id parameter
        const encodedId = encodeURIComponent(fullPath);

        return `${siteUrl}/Shared%20Documents/Forms/AllItems.aspx?id=${encodedId}`;
    }

    /**
     * Download a specific photo
     */
    async downloadPhoto(phase, siteName, filename) {
        try {
            const siteId = await this.getSiteId();

            // Resolve path dynamically
            const photoPath = await this.resolveSharePointPath(phase, siteName);
            const fullPath = `${photoPath}/${filename}`;

            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}/root:/${fullPath}:/content`;

            const arrayBuffer = await this.proxyRequest(endpoint, 'GET', null, true);
            return new Blob([arrayBuffer]);
        } catch (error) {
            console.error(`Error downloading photo ${filename}:`, error);
            throw error;
        }
    }
    /**
     * Run deep diagnostics to find the broken link in the path
     */
    async runDiagnostics(phase, siteName) {
        const logs = [];
        const log = (msg) => logs.push(`${new Date().toLocaleTimeString()}: ${msg}`);

        try {
            log(`Starting diagnostics for: Phase="${phase}", Site="${siteName}"`);

            const siteId = await this.getSiteId();
            log(`Site ID: ${siteId}`);

            // 1. Check Drives
            log('Step 1: finding Document Library...');
            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            if (!targetDrive) {
                log(`❌ Error: Document Library "${libraryName}" not found. Available: ${drives.value.map(d => d.name).join(', ')}`);
                return logs;
            }
            log(`✓ Found Drive: ${targetDrive.name} (${targetDrive.id})`);

            // 2. Check Root Folder
            log('Step 2: Finding Root Folder...');
            let rootFolderName = sharepointConfig.sharepoint.folderPath; // "Telamon - Viaero Site Walks"

            // List children of root
            const rootChildrenUrl = `/sites/${siteId}/drives/${targetDrive.id}/root/children`;
            const rootChildren = await this.proxyRequest(rootChildrenUrl);

            if (!rootChildren.value) {
                log(`❌ Error: Could not list root children.`);
                return logs;
            }

            // Find match
            // Try exact
            let matchedRoot = rootChildren.value.find(c => c.name === rootFolderName);
            if (!matchedRoot) {
                // Try fuzzy
                log(`! Exact match for "${rootFolderName}" not found. listing candidates:`);
                rootChildren.value.forEach(c => log(` - ${c.name}`));

                matchedRoot = rootChildren.value.find(c => c.name.toLowerCase() === rootFolderName.toLowerCase());
            }

            if (!matchedRoot) {
                log('❌ Error: Root folder not found.');
                return logs;
            }
            log(`✓ Found Root: ${matchedRoot.name}`);

            // 3. Find Phase
            log(`Step 3: Finding Phase Folder ("${phase}")...`);
            const normalizedPhase = sharepointConfig.sharepoint.normalizePhase(phase);
            log(`Normalized Phase Target: ${normalizedPhase}`);

            const rootPathEncoded = encodeURIComponent(matchedRoot.name);
            const phaseParentUrl = `/sites/${siteId}/drives/${targetDrive.id}/root:/${rootPathEncoded}:/children`;
            const phaseChildren = await this.proxyRequest(phaseParentUrl);

            let matchedPhase = phaseChildren.value.find(c => c.name === normalizedPhase);
            if (!matchedPhase) {
                // Try number match logic
                if (normalizedPhase.includes('Phase')) {
                    const num = normalizedPhase.replace(/[^0-9]/g, '');
                    matchedPhase = phaseChildren.value.find(c => c.name.includes(`Phase ${num}`));
                }
            }

            if (!matchedPhase) {
                log(`❌ Error: Phase folder not found. Candidates in ${matchedRoot.name}:`);
                phaseChildren.value.forEach(c => log(` - ${c.name}`));
                return logs;
            }
            log(`✓ Found Phase: ${matchedPhase.name}`);

            // 4. Find Site
            log(`Step 4: Finding Site Folder ("${siteName}")...`);

            // Encode path parts
            const phasePathEncoded = `${rootPathEncoded}/${encodeURIComponent(matchedPhase.name)}`;
            const siteParentUrl = `/sites/${siteId}/drives/${targetDrive.id}/root:/${phasePathEncoded}:/children`;
            const siteChildren = await this.proxyRequest(siteParentUrl);

            let matchedSite = siteChildren.value.find(c => c.name === siteName);
            // Try case insensitive
            if (!matchedSite) {
                matchedSite = siteChildren.value.find(c => c.name.toLowerCase() === siteName.toLowerCase());
            }

            if (!matchedSite) {
                log(`❌ Error: Site folder "${siteName}" not found. Candidates in ${matchedPhase.name}:`);
                siteChildren.value.forEach(c => log(` - ${c.name}`));
                return logs;
            }
            log(`✓ Found Site: ${matchedSite.name}`);

            // 5. List Files in Site
            log('Step 5: Listing Files in Site Folder...');
            const sitePathEncoded = `${phasePathEncoded}/${encodeURIComponent(matchedSite.name)}`;
            const filesUrl = `/sites/${siteId}/drives/${targetDrive.id}/root:/${sitePathEncoded}:/children`;
            const files = await this.proxyRequest(filesUrl);

            log(`Found ${files.value.length} items:`);
            files.value.forEach(f => log(` [${f.folder ? 'DIR' : 'FILE'}] ${f.name}`));

            // Check PHOTOS folder existence
            const photosFolder = files.value.find(f => f.name === 'PHOTOS');
            if (photosFolder) {
                log(`✓ PHOTOS folder exists.`);
            } else {
                log(`! PHOTOS folder MISSING.`);
            }

            log('Diagnostics Complete.');
            return logs;

        } catch (error) {
            log(`CRITICAL EXCEPTION: ${error.message}`);
            console.error(error);
            return logs;
        }
    }
}

export default new SharePointService();
