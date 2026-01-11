import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import { SyncService } from '../services/SyncService';
import { generatePhotoName, getNextSequentialNumber } from '../utils/photoNaming';

function PhotoCaptureScreen() {
    const { siteId, photoReqId } = useParams();
    const navigate = useNavigate();
    const [site, setSite] = useState(null);
    const [photoReq, setPhotoReq] = useState(null);
    const [capturedPhotos, setCapturedPhotos] = useState([]);
    const photosRef = useRef([]);
    const [showCamera, setShowCamera] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [location, setLocation] = useState(null); // Keep for UI rendering if needed
    const locationRef = useRef(null); // Use Ref for dependable callback access
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const fileInputRef = useRef(null); // For gallery uploads

    const [gpsStatus, setGpsStatus] = useState('searching'); // searching, locked, partial, error
    const [gpsError, setGpsError] = useState(null);

    // Zoom State
    const [zoom, setZoom] = useState(1);
    const [zoomRange, setZoomRange] = useState({ min: 1, max: 3, step: 0.1 });
    const [supportsZoom, setSupportsZoom] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                // Load site and photo requirement
                const sites = await StorageService.getSites();
                const currentSite = sites.find(s => s.id.toString() === siteId);

                const photoReqs = await StorageService.getPhotoRequirements();
                const currentPhotoReq = photoReqs.find(r => r.id.toString() === photoReqId);

                if (!currentSite || !currentPhotoReq) {
                    navigate(`/site/${siteId}`);
                    return;
                }

                setSite(currentSite);
                setPhotoReq(currentPhotoReq);

                // Load existing photos for this requirement
                const allPhotos = await StorageService.getPhotos(siteId);
                const photos = allPhotos.filter(p => p.photoReqId.toString() === photoReqId);
                setCapturedPhotos(photos);
                photosRef.current = photos;

                // Reconcile with SharePoint (sync deletions and downloads)
                if (SyncService.isOnline()) {
                    try {
                        const result = await SyncService.reconcilePhotos(siteId, currentSite.phase, currentSite.name);
                        console.log(`Photo screen reconciliation: Deleted ${result.deleted}, Downloaded ${result.downloaded}`);

                        // If anything changed, reload photos
                        if (result.deleted > 0 || result.downloaded > 0) {
                            const updatedPhotos = await StorageService.getPhotos(siteId);
                            const filteredPhotos = updatedPhotos.filter(p => p.photoReqId.toString() === photoReqId);
                            setCapturedPhotos(filteredPhotos);
                            photosRef.current = filteredPhotos;
                        }
                    } catch (error) {
                        console.error('Reconciliation failed:', error);
                    }
                }
            } catch (error) {
                console.error('Error loading photo capture data:', error);
                alert('Failed to load data. Please try again.');
                navigate(`/site/${siteId}`);
            }
        };

        loadData();

        // Robust Geolocation Handling
        let watchId = null;

        if (navigator.geolocation) {
            console.log('Starting GPS watch...');
            setGpsStatus('searching');

            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            };

            // Success handler
            const handleSuccess = (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                const newLoc = { latitude, longitude, accuracy };

                setLocation(newLoc); // Update state for UI
                locationRef.current = newLoc; // Update ref for callback

                setGpsStatus('locked');
                setGpsError(null);
                console.log(`GPS Updated: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (Acc: ${Math.round(accuracy)}m)`);
            };

            // Error handler
            const handleError = (error) => {
                console.warn('GPS Error:', error.message);
                setGpsStatus('error');

                let errorMessage = 'GPS Unavailable';
                switch (error.code) {
                    case 1: errorMessage = 'Location denied. Please enable permission.'; break;
                    case 2: errorMessage = 'Location unavailable. Check GPS signal.'; break;
                    case 3: errorMessage = 'Location timed out. Retrying...'; break;
                }
                setGpsError(errorMessage);

                // If high accuracy failed (timeout), try low accuracy
                if (error.code === 3 && options.enableHighAccuracy) {
                    console.log('Retrying with low accuracy...');
                    options.enableHighAccuracy = false;
                    navigator.geolocation.clearWatch(watchId);
                    watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
                }
            };

            // Start watching
            watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
        } else {
            console.error('Geolocation not supported');
            setGpsStatus('error');
            setGpsError('GPS not supported on this device');
        }

        // Cleanup
        return () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }
        };
    }, [siteId, photoReqId, navigate]);

    const startCamera = async () => {
        try {
            // Check if mediaDevices is available (requires secure context)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Camera access requires HTTPS or localhost. Please access the app via:\n\n' +
                    '• On this computer: http://localhost:3000\n' +
                    '• For testing: Use the file upload feature instead\n\n' +
                    'Note: Camera features work when the app is properly deployed with HTTPS.');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Use back camera on mobile
                    zoom: true // Hint to browser we want zoom
                },
                audio: false
            });

            // Store stream reference first
            streamRef.current = stream;

            // Check for Zoom Capability
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};

            if ('zoom' in capabilities) {
                console.log('Camera supports zoom:', capabilities.zoom);
                setSupportsZoom(true);
                setZoomRange({
                    min: capabilities.zoom.min,
                    max: capabilities.zoom.max,
                    step: capabilities.zoom.step
                });
                setZoom(capabilities.zoom.min);
            } else {
                console.log('Camera does NOT support zoom');
                setSupportsZoom(false);
            }

            // Show camera UI
            setShowCamera(true);

            // Wait for next render cycle to ensure video element exists
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    // Explicitly start playback
                    videoRef.current.play().catch(err => {
                        console.error('Error playing video:', err);
                        alert('Error starting camera playback. Please try again.');
                    });
                }
            }, 100);
        } catch (error) {
            console.error('Camera error:', error);
            if (error.name === 'NotAllowedError') {
                alert('Camera permission denied. Please allow camera access in your browser settings.');
            } else if (error.name === 'NotFoundError') {
                alert('No camera found on this device.');
            } else {
                alert('Unable to access camera: ' + error.message);
            }
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
        setSupportsZoom(false); // Reset zoom state
    };

    const handleZoom = async (event) => {
        const newZoom = parseFloat(event.target.value);
        setZoom(newZoom);

        if (streamRef.current) {
            const track = streamRef.current.getVideoTracks()[0];
            try {
                await track.applyConstraints({ advanced: [{ zoom: newZoom }] });
            } catch (err) {
                console.error('Zoom failed:', err);
            }
        }
    };

    const capturePhoto = useCallback(async () => {
        if (!videoRef.current || !site || !photoReq) {
            console.error('Missing data for capture:', {
                video: !!videoRef.current,
                site: !!site,
                photoReq: !!photoReq
            });
            alert('Error: Missing required data. Please go back and try again.');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;

        console.log('Canvas size:', canvas.width, 'x', canvas.height);

        if (canvas.width === 0 || canvas.height === 0) {
            console.error('Video dimensions are zero');
            alert('Error: Camera not ready. Please wait for the video to load.');
            return;
        }

        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0);

        // Add timestamp overlay in bottom right corner
        try {
            const now = new Date();
            const dateStr = now.toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });

            // Get location string from REF (guaranteed fresh)
            let locationStr = 'Location: Not Available';
            const loc = locationRef.current; // Use Ref!

            if (loc) {
                const latDir = loc.latitude >= 0 ? 'N' : 'S';
                const lonDir = loc.longitude >= 0 ? 'E' : 'W';
                locationStr = `Location: ${Math.abs(loc.latitude).toFixed(6)}° ${latDir}, ${Math.abs(loc.longitude).toFixed(6)}° ${lonDir}`;
            } else {
                console.warn('GPS location missing from ref at capture time');
            }

            // Prepare text lines
            const lines = [
                `Site: ${site.name} (${site.id})`,
                locationStr,
                `Date: ${dateStr}`
            ];

            // Text styling
            const fontSize = Math.max(16, Math.floor(canvas.height / 40)); // Responsive font size
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';

            // Measure text to create background
            const lineHeight = fontSize * 1.3;
            const padding = fontSize * 0.5;
            const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
            const bgWidth = maxWidth + (padding * 2);
            const bgHeight = (lines.length * lineHeight) + (padding * 2);

            // Draw semi-transparent black background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(
                canvas.width - bgWidth - 10,
                canvas.height - bgHeight - 10,
                bgWidth,
                bgHeight
            );

            // Draw text lines
            ctx.fillStyle = 'white';
            lines.forEach((line, index) => {
                ctx.fillText(
                    line,
                    canvas.width - padding - 10,
                    canvas.height - padding - 10 - ((lines.length - 1 - index) * lineHeight)
                );
            });

            console.log('Timestamp overlay added:', lines);
        } catch (overlayError) {
            console.error('Failed to add timestamp overlay:', overlayError);
            // Continue without overlay - don't block photo capture
        }

        // Convert to blob
        canvas.toBlob(async (blob) => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                alert('Error: Failed to capture photo. Please try again.');
                return;
            }

            console.log('Blob created, size:', blob.size);

            // Generate photo name
            const photoReqName = photoReq.name || `Photo ${photoReq.id}`;
            const nextNum = getNextSequentialNumber(photosRef.current, photoReqName);
            const filename = generatePhotoName(
                site.name,
                site.id,
                photoReqName,
                nextNum.sequential,
                nextNum.sub
            );

            console.log('Generated filename:', filename);

            // Create photo data
            const uniqueId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const photoData = {
                id: uniqueId,
                photoReqId: photoReq.id,
                photoReqName: photoReqName,
                filename: filename + '.jpg',
                blob: blob,
                dataUrl: canvas.toDataURL('image/jpeg', 0.9), // Restored for UI display
                size: blob.size,
                width: canvas.width,
                height: canvas.height,
                capturedAt: new Date().toISOString(),
                status: 'pending' // Mark as pending so it is not deleted by reconciliation
            };

            console.log('Saving photo data:', { id: photoData.id, filename: photoData.filename, size: photoData.size });

            // Optimistically update Ref and State immediately
            const newPhotos = [...photosRef.current, photoData];
            photosRef.current = newPhotos;
            setCapturedPhotos(newPhotos);

            try {
                // Save to IndexedDB
                await StorageService.savePhoto(site.id, photoData);
                console.log('Photo saved successfully to IndexedDB');
            } catch (error) {
                console.error('Error saving photo:', error);
                alert('Failed to save photo. Please try again.');

                // Rollback
                photosRef.current = photosRef.current.filter(p => p.id !== photoData.id);
                setCapturedPhotos(photosRef.current);
            }
        }, 'image/jpeg', 0.9);
    }, [site, photoReq, siteId, location]);

    const confirmDelete = async (photoId) => {
        try {
            // Find photo to get filename for sync
            const photoToDelete = capturedPhotos.find(p => p.id === photoId);

            if (!photoToDelete) {
                console.error('Photo not found:', photoId);
                alert('Error: Photo not found');
                return;
            }

            console.log('Deleting photo:', photoToDelete.filename);

            // Delete from local storage
            await StorageService.deletePhoto(photoId);
            console.log('✓ Deleted from local storage');

            // Update UI state
            setCapturedPhotos(prev => {
                const updated = prev.filter(p => p.id !== photoId);
                photosRef.current = updated;
                return updated;
            });
            setDeleteConfirmId(null);

            // Queue deletion sync
            console.log('Queueing deletion sync for:', photoToDelete.filename);
            await SyncService.addToQueue('DELETE_PHOTO', {
                phase: site.phase,
                siteName: site.name,
                filename: photoToDelete.filename
            });
            console.log('✓ Added to sync queue');

            // Trigger sync if online
            if (SyncService.isOnline()) {
                console.log('Online - processing sync queue immediately');
                const result = await SyncService.processQueue();
                console.log('Sync queue processed, success count:', result);

                if (result > 0) {
                    alert(`Photo deleted locally and from SharePoint`);
                } else {
                    alert(`Photo deleted locally. Will sync to SharePoint when connection is restored.`);
                }
            } else {
                console.log('Offline - will sync when connection is restored');
                alert('Photo deleted locally. Will sync to SharePoint when online.');
            }
        } catch (error) {
            console.error('Error in confirmDelete:', error);
            alert(`Error deleting photo: ${error.message}`);
        }
    };

    const downloadPhotos = () => {
        // Download all photos as files
        capturedPhotos.forEach(photo => {
            const link = document.createElement('a');
            link.href = photo.dataUrl;
            link.download = photo.filename;
            link.click();
        });
    };

    // Compress image using canvas (reduces file size significantly)
    const compressImage = (file, maxWidth = 1920, quality = 0.8) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url); // Free memory immediately

                // Calculate new dimensions
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                // Create canvas for compression
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to blob with compression
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            // Create data URL from compressed blob
                            const reader = new FileReader();
                            reader.onload = () => {
                                resolve({
                                    blob,
                                    dataUrl: reader.result,
                                    width,
                                    height
                                });
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        } else {
                            reject(new Error('Failed to compress image'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };

            img.src = url;
        });
    };

    // Handle gallery file upload - process sequentially to prevent memory issues
    const handleFileUpload = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        console.log(`📤 Processing ${files.length} file(s) from gallery...`);

        // Process files sequentially to avoid memory exhaustion
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            console.log(`Processing file ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

            try {
                // Compress image to reduce memory usage
                const compressed = await compressImage(file);
                console.log(`Compressed: ${(compressed.blob.size / 1024 / 1024).toFixed(2)} MB`);

                // Generate filename
                const photoReqName = photoReq.name || `Photo ${photoReq.id}`;
                const nextNum = getNextSequentialNumber(photosRef.current, photoReqName);
                const filename = generatePhotoName(
                    site.name,
                    site.id,
                    photoReqName,
                    nextNum.sequential,
                    nextNum.sub
                );

                // Create photo data
                const uniqueId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                const photoData = {
                    id: uniqueId,
                    photoReqId: photoReq.id,
                    photoReqName: photoReqName,
                    filename: filename + '.jpg',
                    blob: compressed.blob,
                    dataUrl: compressed.dataUrl,
                    size: compressed.blob.size,
                    width: compressed.width,
                    height: compressed.height,
                    capturedAt: new Date().toISOString(),
                    status: 'pending',
                    source: 'gallery'
                };

                // Update state and ref
                const newPhotos = [...photosRef.current, photoData];
                photosRef.current = newPhotos;
                setCapturedPhotos(newPhotos);

                // Save to IndexedDB
                await StorageService.savePhoto(site.id, photoData);
                console.log('✓ Gallery photo saved:', photoData.filename);
            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                alert(`Failed to process photo: ${file.name}`);
            }
        }

        console.log(`📤 Finished processing ${files.length} file(s)`);

        // Reset input to allow re-selecting same file
        event.target.value = '';
    };

    if (!site || !photoReq) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="header">
                <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Link to={`/site/${siteId}`} style={{ color: 'white', fontSize: '24px', textDecoration: 'none' }}>
                        ←
                    </Link>
                    <div>
                        <h1 style={{ fontSize: '16px' }}>{photoReq.id}: {photoReq.name}</h1>
                        <p style={{ margin: 0, opacity: 0.9, fontSize: '12px' }}>
                            {site.name} - Project #{site.id}
                        </p>
                    </div>
                </div>
            </div>

            <div className="container">
                {/* Photo Requirement Info */}
                <div className="card mb-3">
                    <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Photo Description</h3>
                    <p className="text-muted" style={{ marginBottom: '12px' }}>
                        {photoReq.description || 'No description available'}
                    </p>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Category: {photoReq.category}
                    </div>
                </div>

                {/* Camera */}
                {!showCamera ? (
                    <div className="card mb-3 text-center">
                        <button onClick={startCamera} className="btn btn-primary" style={{ width: '100%', marginBottom: '10px' }}>
                            📷 Open Camera
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary" style={{ width: '100%' }}>
                            📤 Upload From Gallery
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*"
                            multiple
                            hidden
                            onChange={handleFileUpload}
                        />
                    </div>
                ) : (
                    <div className="card mb-3">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            style={{
                                width: '100%',
                                borderRadius: '8px',
                                marginBottom: '12px',
                                backgroundColor: '#000'
                            }}
                        />
                        <div className="grid grid-2">
                            <button onClick={capturePhoto} className="btn btn-success">
                                📸 Capture
                            </button>
                            <button onClick={stopCamera} className="btn btn-danger">
                                ✕ Close Camera
                            </button>
                        </div>

                        {/* Zoom Control */}
                        {supportsZoom && (
                            <div style={{ marginTop: '12px', padding: '0 8px' }}>
                                <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                                    <span>Zoom: {zoom.toFixed(1)}x</span>
                                    <span>{zoomRange.max}x</span>
                                </label>
                                <input
                                    type="range"
                                    min={zoomRange.min}
                                    max={zoomRange.max}
                                    step={zoomRange.step}
                                    value={zoom}
                                    onChange={handleZoom}
                                    style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Captured Photos */}
                <div className="card mb-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ fontSize: '16px', margin: 0 }}>
                            Captured Photos ({capturedPhotos.length})
                        </h3>
                        {/* GPS Status Indicator */}
                        <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: gpsStatus === 'locked' ? '#4caf50' : (gpsStatus === 'error' ? '#f44336' : '#ff9800'),
                                boxShadow: `0 0 4px ${gpsStatus === 'locked' ? '#4caf50' : (gpsStatus === 'error' ? '#f44336' : '#ff9800')}`
                            }}></div>
                            <span style={{ color: '#666' }}>
                                {gpsStatus === 'locked' ? 'GPS Ready' : (gpsStatus === 'error' ? 'GPS Error' : 'Finding Loc...')}
                            </span>
                        </div>
                        {capturedPhotos.length > 0 && (
                            <button onClick={downloadPhotos} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '14px', marginLeft: '8px' }}>
                                💾 Download All
                            </button>
                        )}
                    </div>

                    {capturedPhotos.length === 0 ? (
                        <p className="text-muted text-center">No photos captured yet</p>
                    ) : (
                        <div className="grid">
                            {capturedPhotos.map(photo => (
                                <div key={photo.id} style={{
                                    border: '2px solid var(--border-color)',
                                    borderRadius: '8px',
                                    padding: '8px'
                                }}>
                                    <img
                                        src={photo.dataUrl}
                                        alt={photo.filename}
                                        style={{
                                            width: '100%',
                                            borderRadius: '4px',
                                            marginBottom: '8px'
                                        }}
                                    />
                                    <div style={{ fontSize: '12px', marginBottom: '4px', wordBreak: 'break-word' }}>
                                        <strong>{photo.filename}</strong>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                        {new Date(photo.capturedAt).toLocaleString()}
                                    </div>
                                    {deleteConfirmId === photo.id ? (
                                        <div className="grid grid-2" style={{ gap: '8px' }}>
                                            <button
                                                onClick={() => confirmDelete(photo.id)}
                                                className="btn btn-danger"
                                                style={{ padding: '6px', fontSize: '12px' }}
                                            >
                                                ✓ Confirm
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmId(null)}
                                                className="btn btn-secondary"
                                                style={{ padding: '6px', fontSize: '12px' }}
                                            >
                                                ✕ Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setDeleteConfirmId(photo.id)}
                                            className="btn btn-danger"
                                            style={{ width: '100%', padding: '6px', fontSize: '12px' }}
                                        >
                                            🗑️ Delete
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Instructions */}
                <div className="card" style={{ backgroundColor: '#e3f2fd' }}>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--primary-dark)' }}>
                        ℹ️ Instructions
                    </h4>
                    <ul style={{ fontSize: '12px', marginLeft: '20px', color: 'var(--text-primary)' }}>
                        <li>Photos are automatically named with site and requirement info</li>
                        <li>You can capture multiple photos for this requirement</li>
                        <li>Download photos to save them to your device</li>
                        <li>Upload photos to SharePoint manually following folder structure: {site.phase} {'>'} {site.name} {'>'} Photos</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default PhotoCaptureScreen;
