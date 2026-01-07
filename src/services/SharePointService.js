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
            console.log("Got upload URL, uploading Zip direct to Microsoft...");

            try {
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Range': `bytes 0-${zipBlob.size - 1}/${zipBlob.size}`,
                        'Content-Length': zipBlob.size
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

            console.log(`Zip uploaded successfully: ${fullPath}`);
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
     */
    async listFiles(phase, siteName, subfolder = 'PHOTOS') {
        try {
            const siteId = await this.getSiteId();

            // Resolve path dynamically
            const photoPath = await this.resolveSharePointPath(phase, siteName, subfolder);

            const drives = await this.proxyRequest(`/sites/${siteId}/drives`);
            const libraryName = sharepointConfig.sharepoint.documentLibrary;
            const targetDrive = drives.value.find(d => d.name === libraryName);

            const endpoint = `/sites/${siteId}/drives/${targetDrive.id}/root:/${photoPath}:/children?select=name,id,size,lastModifiedDateTime`;

            const response = await this.proxyRequest(endpoint);
            return response.value || [];
        } catch (error) {
            console.error('Error listing files:', error);
            return [];
        }
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
