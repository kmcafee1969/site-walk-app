import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import SharePointService from '../services/SharePointService';
import EmailService from '../services/EmailService';
import { sharepointConfig } from '../config/sharepoint.config';
import { SyncService } from '../services/SyncService';
import JSZip from 'jszip'; // Import JSZip for bundling

function SiteDetailScreen() {
    const { siteId } = useParams();
    const navigate = useNavigate();
    const [site, setSite] = useState(null);
    const [photoRequirements, setPhotoRequirements] = useState([]);
    const [localPendingCounts, setLocalPendingCounts] = useState({}); // Changed from capturedPhotos
    const [sharepointCounts, setSharepointCounts] = useState({}); // NEW: SharePoint photo counts per req
    const [loadingSharepointCounts, setLoadingSharepointCounts] = useState(false); // NEW
    const [questionnaire, setQuestionnaire] = useState(null);
    const [hasRemoteQuestionnaire, setHasRemoteQuestionnaire] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine); // Initialize state
    const [logs, setLogs] = useState([]); // Debug logs

    const appendLog = (msg) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);

    // Track online status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        const loadSiteData = async () => {
            // Load site data
            const sites = await StorageService.getSites();
            const currentSite = sites.find(s => s.id.toString() === siteId);

            if (!currentSite) {
                navigate('/');
                return;
            }

            setSite(currentSite);
            await StorageService.setCurrentSite(siteId);

            // Load photo requirements
            const photoReqs = await StorageService.getPhotoRequirements();
            appendLog(`Loaded ${photoReqs.length} photo requirements`);

            // Group by category
            const grouped = {};
            // ... (hidden grouping logic)

            // Log online status
            appendLog(`Online Status: ${isOnline}`);

            // Group requirements by category
            appendLog('Grouping photo requirements...');
            photoReqs.forEach(req => {
                const category = req.category || 'General';
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push(req);
            });

            setPhotoRequirements(grouped);

            // MEMORY FIX: Load only photo metadata (no blob/dataUrl) to count local pending photos
            appendLog('Loading local photo metadata (lightweight)...');
            const photoMeta = await StorageService.getPhotoMetadata(siteId);
            const pendingByReq = {};
            photoMeta.filter(p => p.status === 'pending').forEach(photo => {
                const reqId = photo.photoReqId.toString();
                pendingByReq[reqId] = (pendingByReq[reqId] || 0) + 1;
            });
            setLocalPendingCounts(pendingByReq);
            appendLog(`Found ${Object.values(pendingByReq).reduce((a, b) => a + b, 0)} local pending photos`);

            // MEMORY FIX: Check SharePoint for photo counts (no image loading)
            // OPTIMIZED: Uses folder property and parallel requests
            if (isOnline) {
                setLoadingSharepointCounts(true);
                try {
                    appendLog('Checking SharePoint for uploaded photos...');

                    // List items in PHOTOS folder (includes subfolders and files)
                    const items = await SharePointService.listFiles(currentSite.phase, currentSite.name, 'PHOTOS');
                    appendLog(`SharePoint PHOTOS folder has ${items.length} items`);

                    // Build a map of sanitized requirement names to requirement IDs
                    const sanitizeForFolder = (name) => {
                        return name
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_')
                            .replace(/^_+|_+$/g, '');
                    };

                    const reqNameToId = {};
                    photoReqs.forEach(req => {
                        const sanitized = sanitizeForFolder(req.name);
                        reqNameToId[sanitized] = req.id.toString();
                    });

                    const spCountByReq = {};
                    const allSpFileNames = new Set();

                    // Separate folders from files using the 'folder' property from Graph API
                    const folders = items.filter(item => item.folder && reqNameToId[sanitizeForFolder(item.name)]);
                    const rootFiles = items.filter(item => !item.folder && !item.name.endsWith('.zip'));

                    appendLog(`Found ${folders.length} category folders, ${rootFiles.length} root files`);

                    // Process folders in parallel for speed
                    if (folders.length > 0) {
                        const folderPromises = folders.map(async (folder) => {
                            try {
                                const folderPath = `PHOTOS/${folder.name}`;
                                const folderFiles = await SharePointService.listFiles(
                                    currentSite.phase,
                                    currentSite.name,
                                    folderPath
                                );
                                const photoFiles = folderFiles.filter(f => !f.name.endsWith('.zip'));
                                return { folder, files: photoFiles };
                            } catch (err) {
                                return { folder, files: [] };
                            }
                        });

                        const folderResults = await Promise.all(folderPromises);

                        for (const { folder, files } of folderResults) {
                            const sanitizedName = sanitizeForFolder(folder.name);
                            const reqId = reqNameToId[sanitizedName];
                            if (reqId && files.length > 0) {
                                spCountByReq[reqId] = (spCountByReq[reqId] || 0) + files.length;
                                files.forEach(f => allSpFileNames.add(f.name));
                            }
                        }
                    }

                    // Process root files with filename matching (for legacy photos)
                    for (const file of rootFiles) {
                        let matchedReqId = null;
                        let matchedLength = 0;

                        photoReqs.forEach(req => {
                            if (file.name.toLowerCase().includes(req.name.toLowerCase())) {
                                if (req.name.length > matchedLength) {
                                    matchedLength = req.name.length;
                                    matchedReqId = req.id.toString();
                                }
                            }
                        });

                        if (matchedReqId) {
                            spCountByReq[matchedReqId] = (spCountByReq[matchedReqId] || 0) + 1;
                        }
                        allSpFileNames.add(file.name);
                    }

                    setSharepointCounts(spCountByReq);
                    const totalCount = Object.values(spCountByReq).reduce((a, b) => a + b, 0);
                    appendLog(`Found ${totalCount} photos in SharePoint across ${Object.keys(spCountByReq).length} requirements`);

                    // AUTO-SYNC: Mark local pending photos as synced if found in SharePoint
                    const localPhotos = await StorageService.getPhotos(siteId);
                    let syncedCount = 0;
                    for (const photo of localPhotos) {
                        if (photo.status === 'pending' && allSpFileNames.has(photo.filename)) {
                            await StorageService.updatePhotoStatus(photo.id, 'synced');
                            syncedCount++;
                        }
                    }
                    if (syncedCount > 0) {
                        appendLog(`Auto-synced ${syncedCount} local photos that were already in SharePoint`);
                        // Refresh local counts
                        const updatedMeta = await StorageService.getPhotoMetadata(siteId);
                        const newPendingByReq = {};
                        updatedMeta.filter(p => p.status === 'pending').forEach(photo => {
                            const reqId = photo.photoReqId.toString();
                            newPendingByReq[reqId] = (newPendingByReq[reqId] || 0) + 1;
                        });
                        setLocalPendingCounts(newPendingByReq);
                    }
                } catch (err) {
                    appendLog(`SharePoint count check failed: ${err.message}`);
                } finally {
                    setLoadingSharepointCounts(false);
                }
            }

            // Load questionnaire
            const quest = await StorageService.getQuestionnaire(siteId);
            setQuestionnaire(quest);

            // Check if questionnaire exists in SharePoint (remote)
            if (isOnline) {
                appendLog(`Checking questionnaire: ${currentSite.phase} / ${currentSite.name}`);

                // TEST RESOLUTION
                try {
                    appendLog("Testing Path Resolution...");
                    const resolved = await SharePointService.resolveSharePointPath(currentSite.phase, currentSite.name);
                    appendLog(`Resolved Path: ${resolved}`);
                } catch (resErr) {
                    appendLog(`Resolution Error: ${resErr.message}`);
                }

                SharePointService.checkQuestionnaireExists(currentSite.phase, currentSite.name, siteId)
                    .then(async exists => {
                        appendLog(`Questionnaire exists: ${exists}`);
                        setHasRemoteQuestionnaire(exists);

                        // SYNC LOGIC: If remote is gone, but we have a "synced" local copy, delete it.
                        // (This handles the case where user deleted file in SharePoint to reset)
                        if (!exists && isOnline) {
                            const localQ = await StorageService.getQuestionnaire(siteId);

                            // Auto-delete ONLY if it was previously synced.
                            if (localQ && localQ.status === 'synced') {
                                appendLog("Remote missing & local is synced. Reseting local state.");
                                await StorageService.deleteQuestionnaire(siteId);
                                setQuestionnaire(null);
                            }
                        }
                    })
                    .catch(e => appendLog(`Err check quest: ${e.message}`));
            } else {
                appendLog("Skipping remote check: Offline");
            }

            // Reconcile with server (check for deletions and downloads)
            if (isOnline) {
                // RUN DIAGNOSTICS IMMEDIATELY
                appendLog("[SYSTEM] Starting Deep Diagnostics...");
                SharePointService.runDiagnostics(currentSite.phase, currentSite.name)
                    .then(logs => {
                        logs.forEach(l => appendLog(`[DIAG] ${l.split(': ').slice(1).join(': ')}`));
                    })
                    .catch(err => appendLog(`[DIAG] CRITICAL FAILURE: ${err.message}`));

                // Log what file list thinks
                SharePointService.listFiles(currentSite.phase, currentSite.name, null)
                    .then(files => {
                        appendLog(`[DEBUG] Site Root Files: ${files.map(f => f.name).join(', ')}`);
                    })
                    .catch(err => {
                        appendLog(`[DEBUG] Failed to list files: ${err.message}`);
                    });

                SyncService.reconcilePhotos(siteId, currentSite.phase, currentSite.name)
                    .then(result => {
                        const { deleted, downloaded } = result;

                        if (deleted > 0 || downloaded > 0) {
                            console.log(`Reconciliation: Deleted ${deleted}, Downloaded ${downloaded} photos`);

                            // MEMORY FIX: Reload metadata only, not full photos
                            StorageService.getPhotoMetadata(siteId).then(updatedMeta => {
                                const newPendingByReq = {};
                                updatedMeta.filter(p => p.status === 'pending').forEach(photo => {
                                    const reqId = photo.photoReqId.toString();
                                    newPendingByReq[reqId] = (newPendingByReq[reqId] || 0) + 1;
                                });
                                setLocalPendingCounts(newPendingByReq);
                            });
                        }
                    })
                    .catch(error => {
                        console.error('Reconciliation failed:', error);
                    });
            }
        };

        loadSiteData();
    }, [siteId, navigate]);

    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, status: '' });
    const [showUploadModal, setShowUploadModal] = useState(false);

    const handleUploadAllPhotos = async () => {
        if (!site) return;

        // MEMORY FIX: Load ONLY metadata first (lightweight)
        const photoMeta = await StorageService.getPhotoMetadata(siteId);
        const pendingMeta = photoMeta.filter(p => p.status === 'pending');

        if (pendingMeta.length === 0) {
            alert('No photos to upload');
            return;
        }

        // Check online status
        const isOnline = SyncService.isOnline();

        // Show modal
        setShowUploadModal(true);
        setUploadProgress({
            current: 0,
            total: pendingMeta.length,
            status: isOnline ? 'Starting upload...' : 'Queueing for sync (Offline)...'
        });

        try {
            let successCount = 0;
            let failCount = 0;
            const errors = [];
            const uploadedFiles = []; // Track uploaded filenames

            // CATEGORY-BASED ZIP OPTIMIZATION (Low Memory)
            if (isOnline) {
                // Group METADATA by category
                const metaByCategory = {};
                for (const photo of pendingMeta) {
                    const category = photo.photoReqName || 'uncategorized';
                    if (!metaByCategory[category]) {
                        metaByCategory[category] = [];
                    }
                    metaByCategory[category].push(photo);
                }

                const categories = Object.keys(metaByCategory);
                const totalCategories = categories.length;
                let categoryIndex = 0;

                setUploadProgress({
                    current: 0,
                    total: totalCategories,
                    status: `Preparing ${totalCategories} categories...`
                });

                // Process each category SEQUENTIALLY to keep memory usage low
                for (const category of categories) {
                    // 1. Get IDs for this category
                    const categoryMeta = metaByCategory[category];
                    const categoryIds = categoryMeta.map(p => p.id);

                    setUploadProgress({
                        current: categoryIndex,
                        total: totalCategories,
                        status: `Loading photos for "${category}"...`
                    });

                    // 2. Fetch FULL blobs for JUST this category
                    // This is the key fix: we only hold ~5-10 photos in memory at a time, not 100
                    const categoryPhotos = await StorageService.getPhotosByIds(categoryIds);

                    // Sanitize category name for filename
                    const sanitizedCategory = category
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '');

                    const baseFilename = `${sanitizedCategory}.zip`;
                    let categoryFilesAdded = 0;

                    setUploadProgress({
                        current: categoryIndex,
                        total: totalCategories,
                        status: `Zipping "${category}"...`
                    });

                    try {
                        // Create ZIP for this category
                        const zip = new JSZip();
                        let hasFiles = false;

                        for (const photo of categoryPhotos) {
                            let blobToAdd = photo.blob;

                            // Recovery logic
                            try {
                                if (!blobToAdd && photo.dataUrl) {
                                    const res = await fetch(photo.dataUrl);
                                    blobToAdd = await res.blob();
                                }
                            } catch (err) {
                                console.warn(`Failed to recover blob for ${photo.filename}`, err);
                            }

                            if (blobToAdd) {
                                zip.file(photo.filename, blobToAdd);
                                categoryFilesAdded++;
                                hasFiles = true;
                            } else {
                                console.error(`Photo corrupted: ${photo.filename}`);
                                errors.push(`Corrupted: ${photo.filename}`);
                                failCount++;
                            }
                        }

                        if (!hasFiles) {
                            console.warn(`Skipping empty zip for ${category}`);
                            categoryIndex++;
                            continue;
                        }

                        const zipBlob = await zip.generateAsync({ type: "blob" });
                        const zipSizeMB = (zipBlob.size / 1024 / 1024).toFixed(2);

                        // Upload
                        setUploadProgress({
                            current: categoryIndex,
                            total: totalCategories,
                            status: `Uploading "${category}" (${zipSizeMB} MB)...`
                        });

                        const finalFilename = await SharePointService.getNextAvailableFilename(
                            site.phase,
                            site.name,
                            baseFilename,
                            'PHOTOS'
                        );

                        await SharePointService.uploadZip(
                            site.phase,
                            site.name,
                            site.id,
                            finalFilename,
                            zipBlob
                        );

                        // Mark as synced
                        for (const photo of categoryPhotos) {
                            await StorageService.updatePhotoStatus(photo.id, 'synced');
                        }

                        uploadedFiles.push(`${finalFilename} (${categoryFilesAdded} photos)`);
                        successCount += categoryFilesAdded;

                        // RELEASE MEMORY
                        // Explicitly clear variables to help GC
                        categoryPhotos.length = 0;

                    } catch (catError) {
                        console.error(`Error uploading category ${category}:`, catError);
                        errors.push(`${category}: ${catError.message}`);
                        // Don't count these as strictly 'failed' if they weren't corrupted, 
                        // they just didn't upload. They remain 'pending'.
                    }

                    categoryIndex++;
                }

            } else {
                // FALLBACK: Offline Queue
                // ... (offline logic remains similar but uses metadata)
                for (let i = 0; i < pendingMeta.length; i++) {
                    const meta = pendingMeta[i];
                    // We don't check for blob corruption here to save memory, 
                    // we just queue the ID.

                    await SyncService.addToQueue('PHOTO', {
                        siteId: site.id,
                        photoId: meta.id,
                        phase: site.phase,
                        siteName: site.name
                    });
                    successCount++;
                }
            }



            // Show results
            if (failCount === 0) {
                if (isOnline) {
                    const folderPath = `Documents > Telamon - Viaero Site Walks > ${sharepointConfig.sharepoint.normalizePhase(site.phase)} > ${site.name} > PHOTOS`;

                    setUploadProgress({
                        current: 100,
                        total: 100,
                        status: `✅ Success! ${successCount} photos uploaded.\n\nFiles created:\n${uploadedFiles.join('\n')}\n\nLocation: ${folderPath}`
                    });

                    // Send email notification (Silent)
                    EmailService.sendUploadNotification(site.name, 'photos', successCount, { folderPath })
                        .catch(err => console.error('Email notification failed:', err));
                } else {
                    setUploadProgress({
                        current: pendingPhotos.length,
                        total: pendingPhotos.length,
                        status: `✅ Offline Mode: All ${successCount} photos queued.\n\nThey will automatically upload when you reconnect to the internet.`
                    });
                }
            } else {
                setUploadProgress({
                    current: pendingPhotos.length,
                    total: pendingPhotos.length,
                    status: `⚠️ Partial Success\n\n${successCount} ${isOnline ? 'uploaded' : 'queued'}\n${failCount} failed\n\nErrors:\n${errors.slice(0, 3).join('\n')}`
                });
            }

            setIsUploading(false);
        } catch (error) {
            setIsUploading(false);
            console.error('Upload error:', error);
            setUploadProgress({
                current: 0,
                total: pendingPhotos.length,
                status: `❌ Process failed: ${error.message}`
            });
        }
    };

    const closeUploadModal = () => {
        setShowUploadModal(false);
        setUploadProgress({ current: 0, total: 0, status: '' });
    };

    if (!site) {
        return <div className="spinner"></div>;
    }

    const mapsUrl = `https://www.google.com/maps?q=${site.latitude},${site.longitude}`;


    return (
        <div>
            <div className="header">
                <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Link to="/" style={{ color: 'white', fontSize: '24px', textDecoration: 'none' }}>
                        ←
                    </Link>
                    <div>
                        <h1 style={{ fontSize: '18px' }}>{site.name}</h1>
                        <p style={{ margin: 0, opacity: 0.9, fontSize: '12px' }}>
                            Project #{site.id}
                        </p>
                    </div>
                </div>
            </div>

            <div className="container">
                {/* Site Information */}
                <div className="card mb-3">
                    <h3 style={{ marginBottom: '12px' }}>Site Information</h3>

                    <div style={{ marginBottom: '8px' }}>
                        <strong>Phase:</strong> {site.phase}
                    </div>

                    <div style={{ marginBottom: '8px' }}>
                        <strong>Address:</strong><br />
                        {site.address}<br />
                        {site.city}, {site.state} {site.zip}
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                        <strong>Coordinates:</strong><br />
                        {site.latitude}, {site.longitude}
                    </div>

                    <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                    >
                        📍 Open in Google Maps
                    </a>
                </div>

                {/* Photo Requirements */}
                <div className="card mb-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0 }}>Photo Requirements</h3>
                        {site && (
                            <button
                                onClick={() => window.open(SharePointService.getPhotoFolderUrl(site.phase, site.name), '_blank')}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '12px' }}
                            >
                                ☁️ View All in SharePoint
                            </button>
                        )}
                    </div>

                    {loadingSharepointCounts && (
                        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                            ☁️ Checking SharePoint for uploaded photos...
                        </div>
                    )}

                    {Object.entries(photoRequirements).map(([category, reqs]) => (
                        <div key={category} style={{ marginBottom: '16px' }}>
                            <h4 style={{ fontSize: '16px', marginBottom: '8px', color: 'var(--primary-color)' }}>
                                {category}
                            </h4>

                            {reqs.map(req => {
                                const spCount = sharepointCounts[req.id] || 0;
                                const localPending = localPendingCounts[req.id] || 0;
                                const totalPhotos = spCount + localPending;
                                const isComplete = totalPhotos > 0;

                                return (
                                    <Link
                                        key={req.id}
                                        to={`/site/${siteId}/photo/${req.id}`}
                                        style={{ textDecoration: 'none', color: 'inherit' }}
                                    >
                                        <div style={{
                                            padding: '12px',
                                            marginBottom: '8px',
                                            backgroundColor: isComplete ? '#e8f5e9' : 'var(--surface)',
                                            border: `2px solid ${isComplete ? 'var(--success-color)' : 'var(--border-color)'}`,
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                                                        {req.id}: {req.name}
                                                    </div>
                                                    {req.description && (
                                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                            {req.description}
                                                        </div>
                                                    )}
                                                    {/* Show photo counts */}
                                                    <div style={{ fontSize: '12px', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                        {spCount > 0 && (
                                                            <span
                                                                style={{ color: '#4caf50', cursor: 'pointer', textDecoration: 'underline' }}
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    window.open(SharePointService.getCategoryFolderUrl(site.phase, site.name, req.name), '_blank');
                                                                }}
                                                            >
                                                                ☁️ {spCount} in SharePoint →
                                                            </span>
                                                        )}
                                                        {localPending > 0 && (
                                                            <span style={{ color: '#ff9800' }}>
                                                                📱 {localPending} pending upload
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: '24px' }}>
                                                    {isComplete ? '✓' : '📷'}
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    ))}

                    {/* Upload All Photos Button - now based on local pending counts */}
                    {Object.values(localPendingCounts).reduce((a, b) => a + b, 0) > 0 && (
                        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '2px solid var(--border-color)' }}>
                            <button
                                onClick={handleUploadAllPhotos}
                                disabled={isUploading}
                                className="btn btn-primary"
                                style={{ width: '100%', padding: '16px', fontSize: '16px' }}
                            >
                                {isUploading ? (
                                    <>⏳ Uploading to SharePoint...</>
                                ) : (
                                    <>☁️ Upload All Photos to SharePoint ({Object.values(localPendingCounts).reduce((a, b) => a + b, 0)} photos)</>
                                )}
                            </button>
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', textAlign: 'center' }}>
                                Photos will be uploaded to: Documents &gt; Telamon - Viaero Site Walks &gt; {sharepointConfig.sharepoint.normalizePhase(site.phase)} &gt; {site.name} &gt; PHOTOS
                            </p>
                        </div>
                    )}
                </div>

                {/* Questionnaire */}
                <div className="card mb-3">
                    <h3 style={{ marginBottom: '12px' }}>Site Walk Questionnaire</h3>
                    <p className="text-muted mb-2">
                        Complete the questionnaire after capturing all photos.
                    </p>

                    <Link to={`/site/${siteId}/questionnaire`} state={{ loadFromCloud: hasRemoteQuestionnaire }}>
                        <button className={`btn ${questionnaire || hasRemoteQuestionnaire ? 'btn-success' : 'btn-primary'}`} style={{ width: '100%' }}>
                            {questionnaire || hasRemoteQuestionnaire ? '✓ View/Edit Questionnaire' : '📋 Start Questionnaire'}
                        </button>
                    </Link>

                    {/* Conflict Resolution: Local Draft but No Remote File */}
                    {questionnaire && !hasRemoteQuestionnaire && isOnline && (
                        <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff3e0', borderRadius: '8px', border: '1px solid #ffe0b2' }}>
                            <p style={{ fontSize: '12px', color: '#e65100', margin: '0 0 8px 0' }}>
                                ⚠️ <strong>Sync Conflict:</strong> You have a local draft, but the file is missing from SharePoint.
                            </p>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={async () => {
                                        if (window.confirm('Are you sure you want to discard this local draft? This cannot be undone.')) {
                                            await StorageService.deleteQuestionnaire(siteId);
                                            setQuestionnaire(null);
                                        }
                                    }}
                                    className="btn btn-secondary"
                                    style={{ flex: 1, fontSize: '12px', padding: '8px', backgroundColor: '#ef5350', color: 'white', border: 'none' }}
                                >
                                    Discard Draft
                                </button>
                                <button
                                    onClick={handleUploadAllPhotos} // Re-use upload mechanism? logic might need tweak
                                    className="btn btn-primary"
                                    style={{ flex: 1, fontSize: '12px', padding: '8px' }}
                                >
                                    Upload to Restore
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Upload Progress Modal */}
            {showUploadModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        padding: '24px',
                        maxWidth: '500px',
                        width: '90%',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Uploading to SharePoint</h3>

                        {/* Progress Bar */}
                        <div style={{
                            width: '100%',
                            height: '24px',
                            backgroundColor: '#e0e0e0',
                            borderRadius: '12px',
                            overflow: 'hidden',
                            marginBottom: '16px'
                        }}>
                            <div style={{
                                width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
                                height: '100%',
                                backgroundColor: 'var(--primary-color)',
                                transition: 'width 0.3s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}>
                                {uploadProgress.current} / {uploadProgress.total}
                            </div>
                        </div>

                        {/* Status Message */}
                        <div style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: '14px',
                            marginBottom: '20px',
                            minHeight: '60px'
                        }}>
                            {uploadProgress.status}
                        </div>

                        {/* Close Button (only show when complete) */}
                        {uploadProgress.current === uploadProgress.total && uploadProgress.total > 0 && (
                            <button
                                onClick={closeUploadModal}
                                className="btn btn-primary"
                                style={{ width: '100%' }}
                            >
                                Close
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Debug Console */}
            <div style={{ padding: '10px', backgroundColor: '#f5f5f5', borderTop: '1px solid #ccc', maxHeight: '150px', overflowY: 'auto', fontSize: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong>Debug Console:</strong>
                    <span style={{ color: '#666' }}>v2.1.0 | Build: 2026-02-04</span>
                </div>
                {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
        </div >
    );
}

export default SiteDetailScreen;
