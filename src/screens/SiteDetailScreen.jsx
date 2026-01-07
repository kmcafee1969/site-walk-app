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
    const [capturedPhotos, setCapturedPhotos] = useState({});
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

            // Load site photos
            appendLog('Loading local photos...');
            photoReqs.forEach(req => {
                const category = req.category || 'General';
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push(req);
            });

            setPhotoRequirements(grouped);

            // Load captured photos for this site
            const photos = await StorageService.getPhotos(siteId);
            const photosByReq = {};
            photos.forEach(photo => {
                const reqId = photo.photoReqId.toString();
                if (!photosByReq[reqId]) {
                    photosByReq[reqId] = [];
                }
                photosByReq[reqId].push(photo);
            });
            setCapturedPhotos(photosByReq);

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

                            // Reload photos to update UI
                            StorageService.getPhotos(siteId).then(updatedPhotos => {
                                const newPhotosByReq = {};
                                updatedPhotos.forEach(photo => {
                                    const reqId = photo.photoReqId.toString();
                                    if (!newPhotosByReq[reqId]) {
                                        newPhotosByReq[reqId] = [];
                                    }
                                    newPhotosByReq[reqId].push(photo);
                                });
                                setCapturedPhotos(newPhotosByReq);
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

        const allPhotos = Object.values(capturedPhotos).flat();

        if (allPhotos.length === 0) {
            alert('No photos to upload');
            return;
        }

        // Check online status
        const isOnline = SyncService.isOnline();

        // Show modal
        setShowUploadModal(true);
        setUploadProgress({
            current: 0,
            total: allPhotos.length,
            status: isOnline ? 'Starting upload...' : 'Queueing for sync (Offline)...'
        });

        try {
            let successCount = 0;
            let failCount = 0;
            const errors = [];

            // ZIP OPTIMIZATION
            if (isOnline) {
                setUploadProgress({
                    current: 0,
                    total: 100,
                    status: 'Compressing photos into Zip bundle...'
                });

                const zip = new JSZip();

                // Add photos to zip
                for (let i = 0; i < allPhotos.length; i++) {
                    const photo = allPhotos[i];
                    // Get blob from dataURL if blob is missing (from IDB reload)
                    let blobToAdd = photo.blob;
                    if (!blobToAdd) {
                        // Convert dataURL to blob
                        const res = await fetch(photo.dataUrl);
                        blobToAdd = await res.blob();
                    }
                    // Add to zip (flat structure as requested, or matching simple structure)
                    zip.file(photo.filename, blobToAdd);
                }

                // Generate Zip
                const zipBlob = await zip.generateAsync({ type: "blob" });
                // Filename: {site name} [site ID] PHOTOS.zip
                const zipFilename = `${site.name} ${site.id} PHOTOS.zip`;

                setUploadProgress({
                    current: 50,
                    total: 100,
                    status: `Uploading Zip Bundle (${(zipBlob.size / 1024 / 1024).toFixed(2)} MB)...`
                });

                await SharePointService.uploadZip(
                    site.phase,
                    site.name,
                    site.id,
                    zipFilename,
                    zipBlob
                );

                // Mark ALL as synced so they don't upload again, but stay safe on device
                for (const photo of allPhotos) {
                    await StorageService.updatePhotoStatus(photo.id, 'synced');
                }

                appendLog(`✓ Uploaded Zip Bundle: ${zipFilename}`);
                successCount = allPhotos.length;

            } else {
                // FALLBACK: Offline Queue (Individual items)
                for (let i = 0; i < allPhotos.length; i++) {
                    const photo = allPhotos[i];
                    // Offline: Add to queue
                    console.log(`Queueing photo ${i + 1}/${allPhotos.length}: ${photo.filename}`);
                    await SyncService.addToQueue('PHOTO', {
                        siteId: site.id,
                        photoId: photo.id,
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
                        status: `✅ Success! Photos zipped & uploaded.\n\nFile: ${site.name} ${site.id} PHOTOS.zip\nLocation: ${folderPath}`
                    });

                    // Send email notification (Silent)
                    EmailService.sendUploadNotification(site.name, 'photos', successCount, { folderPath })
                        .catch(err => console.error('Email notification failed:', err));
                } else {
                    setUploadProgress({
                        current: allPhotos.length,
                        total: allPhotos.length,
                        status: `✅ Offline Mode: All ${successCount} photos queued.\n\nThey will automatically upload when you reconnect to the internet.`
                    });
                }
            } else {
                setUploadProgress({
                    current: allPhotos.length,
                    total: allPhotos.length,
                    status: `⚠️ Partial Success\n\n${successCount} ${isOnline ? 'uploaded' : 'queued'}\n${failCount} failed\n\nErrors:\n${errors.slice(0, 3).join('\n')}`
                });
            }

            setIsUploading(false);
        } catch (error) {
            setIsUploading(false);
            console.error('Upload error:', error);
            setUploadProgress({
                current: 0,
                total: allPhotos.length,
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
                    <h3 style={{ marginBottom: '12px' }}>Photo Requirements</h3>

                    {Object.entries(photoRequirements).map(([category, reqs]) => (
                        <div key={category} style={{ marginBottom: '16px' }}>
                            <h4 style={{ fontSize: '16px', marginBottom: '8px', color: 'var(--primary-color)' }}>
                                {category}
                            </h4>

                            {reqs.map(req => {
                                const photos = capturedPhotos[req.id] || [];
                                const isComplete = photos.length > 0;

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
                                                    {photos.length > 0 && (
                                                        <div style={{ fontSize: '12px', color: 'var(--success-color)', marginTop: '4px' }}>
                                                            {photos.length} photo{photos.length > 1 ? 's' : ''} captured
                                                        </div>
                                                    )}
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

                    {/* Upload All Photos Button */}
                    {Object.values(capturedPhotos).flat().length > 0 && (
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
                                    <>☁️ Upload All Photos to SharePoint ({Object.values(capturedPhotos).flat().length} photos)</>
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
                <strong>Debug Console:</strong>
                {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
        </div >
    );
}

export default SiteDetailScreen;
