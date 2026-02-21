import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import SharePointService from '../services/SharePointService';
import EmailService from '../services/EmailService';
import { sharepointConfig } from '../config/sharepoint.config';
import { SyncService } from '../services/SyncService';
import { SupabaseService } from '../services/SupabaseService';
import JSZip from 'jszip';

function SiteDetailScreen() {
    const { siteId } = useParams();
    const navigate = useNavigate();
    const [site, setSite] = useState(null);
    const [photoRequirements, setPhotoRequirements] = useState([]);
    const [localPendingCounts, setLocalPendingCounts] = useState({}); // Changed from capturedPhotos
    const [sharepointCounts, setSharepointCounts] = useState({}); // NEW: SharePoint photo counts per req
    const [loadingSharepointCounts, setLoadingSharepointCounts] = useState(false); // NEW
    const [questionnaire, setQuestionnaire] = useState(null);
    // const [hasRemoteQuestionnaire, setHasRemoteQuestionnaire] = useState(false); // REMOVED: Legacy file check
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
            // Load questionnaire
            const loadQuestionnaire = async () => {
                const quest = await StorageService.getQuestionnaire(siteId);
                setQuestionnaire(quest);
            };
            loadQuestionnaire();

            // Add visibility listener to reload when coming back
            const handleVisibilityChange = () => {
                if (document.visibilityState === 'visible') {
                    loadQuestionnaire();
                }
            };
            document.addEventListener('visibilitychange', handleVisibilityChange);
            window.addEventListener('focus', loadQuestionnaire);

            return () => {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
                window.removeEventListener('focus', loadQuestionnaire);
            };

            // Legacy questionnaire file check removed. Master Tracker is source of truth.


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

    const PHOTOS_PER_ZIP = 40; // Max photos per zip to stay under 250MB and limit memory

    const handleUploadAllPhotos = async () => {
        if (!site) return;

        // Load all photos with full data (blobs)
        const allPhotos = await StorageService.getPhotos(siteId);
        const pendingPhotos = allPhotos.filter(p => p.status === 'pending');

        if (pendingPhotos.length === 0) {
            alert('No photos to upload');
            return;
        }

        if (!SyncService.isOnline()) {
            alert('You must be online to upload photos.');
            return;
        }

        setShowUploadModal(true);
        setIsUploading(true);

        try {
            // 1. Group photos by category (photoReqName)
            const categoryMap = {};
            for (const photo of pendingPhotos) {
                const category = photo.photoReqName || 'uncategorized';
                if (!categoryMap[category]) categoryMap[category] = [];
                categoryMap[category].push(photo);
            }

            const categories = Object.keys(categoryMap);
            console.log(`📦 ${pendingPhotos.length} photos across ${categories.length} categories`);

            // 2. Build list of zip batches (split large categories into chunks)
            const zipBatches = [];
            for (const category of categories) {
                const photos = categoryMap[category];
                const sanitizedCategory = category
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '');

                if (photos.length <= PHOTOS_PER_ZIP) {
                    zipBatches.push({
                        name: `${sanitizedCategory}.zip`,
                        category,
                        photos
                    });
                } else {
                    // Split into parts
                    for (let i = 0; i < photos.length; i += PHOTOS_PER_ZIP) {
                        const chunk = photos.slice(i, i + PHOTOS_PER_ZIP);
                        const partNum = Math.floor(i / PHOTOS_PER_ZIP) + 1;
                        zipBatches.push({
                            name: `${sanitizedCategory}_part${partNum}.zip`,
                            category,
                            photos: chunk
                        });
                    }
                }
            }

            console.log(`📦 ${zipBatches.length} zip batches to upload`);

            let totalUploaded = 0;
            let failCount = 0;
            const errors = [];

            // 3. Process each zip batch
            for (let batchIdx = 0; batchIdx < zipBatches.length; batchIdx++) {
                const batch = zipBatches[batchIdx];

                try {
                    // Update progress: zipping
                    setUploadProgress({
                        current: batchIdx + 1,
                        total: zipBatches.length,
                        status: `📦 Zipping ${batch.category} (${batch.photos.length} photos)...\nBatch ${batchIdx + 1} of ${zipBatches.length}`
                    });

                    // Create zip for this batch
                    const zip = new JSZip();

                    for (let i = 0; i < batch.photos.length; i++) {
                        const photo = batch.photos[i];

                        // Recover blob if missing
                        let blob = photo.blob;
                        if (!blob && photo.dataUrl) {
                            const res = await fetch(photo.dataUrl);
                            blob = await res.blob();
                        }

                        if (!blob) {
                            console.warn(`Skipping ${photo.filename}: no blob/dataUrl`);
                            continue;
                        }

                        // Add to zip (flat structure — just the filename)
                        zip.file(photo.filename, blob);
                    }

                    // Generate zip blob
                    setUploadProgress(prev => ({
                        ...prev,
                        status: `📦 Compressing ${batch.name}...\nBatch ${batchIdx + 1} of ${zipBatches.length}`
                    }));

                    const zipBlob = await zip.generateAsync({
                        type: 'blob',
                        compression: 'STORED' // No compression for JPEGs (already compressed)
                    });

                    const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
                    console.log(`📦 ${batch.name}: ${sizeMB} MB (${batch.photos.length} photos)`);

                    // Upload zip directly to SharePoint
                    setUploadProgress(prev => ({
                        ...prev,
                        status: `☁️ Uploading ${batch.name} (${sizeMB} MB)...\nBatch ${batchIdx + 1} of ${zipBatches.length}`
                    }));

                    await SharePointService.uploadZipToSharePoint(
                        site.phase,
                        site.name,
                        batch.name,
                        zipBlob,
                        (percent) => {
                            setUploadProgress(prev => ({
                                ...prev,
                                status: `☁️ Uploading ${batch.name} (${percent}%)...\nBatch ${batchIdx + 1} of ${zipBatches.length}`
                            }));
                        }
                    );

                    // Mark all photos in this batch as synced
                    for (const photo of batch.photos) {
                        await StorageService.updatePhotoStatus(photo.id, 'synced');
                    }

                    totalUploaded += batch.photos.length;
                    console.log(`✅ Batch ${batchIdx + 1}/${zipBatches.length} uploaded: ${batch.name}`);

                } catch (err) {
                    console.error(`❌ Failed batch ${batch.name}:`, err);
                    errors.push(`${batch.name}: ${err.message}`);
                    failCount++;
                }
            }

            // 4. Show results
            if (failCount === 0) {
                setUploadProgress({
                    current: zipBatches.length,
                    total: zipBatches.length,
                    status: `✅ Success! ${totalUploaded} photos uploaded in ${zipBatches.length} zip files directly to SharePoint.`
                });

                // Send email notification
                try {
                    const folderPath = `PHOTOS/ (${zipBatches.length} zip files)`;
                    await EmailService.sendUploadNotification(site.name, 'photos', totalUploaded, { folderPath });
                } catch (emailErr) {
                    console.error('Email notification failed:', emailErr);
                }
            } else {
                setUploadProgress({
                    current: zipBatches.length,
                    total: zipBatches.length,
                    status: `⚠️ Partial Success\n\n${totalUploaded} photos uploaded\n${failCount} batches failed\n\nErrors:\n${errors.slice(0, 5).join('\n')}`
                });
            }

            // Refresh pending counts
            const updatedMeta = await StorageService.getPhotoMetadata(siteId);
            const recalcedPending = {};
            updatedMeta.filter(p => p.status === 'pending').forEach(p => {
                const reqId = p.photoReqId.toString();
                recalcedPending[reqId] = (recalcedPending[reqId] || 0) + 1;
            });
            setLocalPendingCounts(recalcedPending);

            setIsUploading(false);
        } catch (error) {
            setIsUploading(false);
            console.error('Upload error:', error);
            setUploadProgress({
                current: 0,
                total: 0,
                status: `❌ Upload failed: ${error.message}`
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
                            Project #{site.siteId || site.name}
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
                                                        {req.name}
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

                    <Link to={`/site/${siteId}/questionnaire`} state={{ loadFromCloud: true }}>
                        <button className={`btn ${questionnaire ? 'btn-success' : 'btn-primary'}`} style={{ width: '100%' }}>
                            {questionnaire ? '✓ View/Edit Questionnaire' : '📋 Start Questionnaire'}
                        </button>
                    </Link>

                    {/* Conflict Resolution: Local Draft but No Remote File */}
                    {/* Conflict Resolution: Removed - Master Tracker is source of truth */}
                    {questionnaire && !isOnline && (
                        <div style={{ fontSize: '12px', marginTop: '4px', textAlign: 'center', color: '#666' }}>
                            Draft saved locally
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
                    <span style={{ color: '#666' }}>v2.7.0 | Build: 2026-02-19</span>
                </div>
                {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
        </div >
    );
}

export default SiteDetailScreen;
