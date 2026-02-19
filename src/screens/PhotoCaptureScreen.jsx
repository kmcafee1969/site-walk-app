import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import { SyncService } from '../services/SyncService';
import { generatePhotoName, getNextSequentialNumber } from '../utils/photoNaming';
import { sharepointConfig } from '../config/sharepoint.config';
import SharePointService from '../services/SharePointService';

// Version info for debugging
export const APP_VERSION = '2.7.0';
export const APP_BUILD_DATE = '2026-02-04';

// Unique ID counter to ensure no collisions even with rapid captures
let photoIdCounter = 0;
const generateUniquePhotoId = () => {
    photoIdCounter++;
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${timestamp}-${photoIdCounter}-${random}`;
};

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

    // Compass heading state
    const [heading, setHeading] = useState(null);
    const headingRef = useRef(null);

    // Zoom State
    const [zoom, setZoom] = useState(1);
    const [zoomRange, setZoomRange] = useState({ min: 1, max: 3, step: 0.1 });
    const [supportsZoom, setSupportsZoom] = useState(false);

    // SharePoint photo count (to avoid loading images locally)
    const [sharepointPhotoCount, setSharepointPhotoCount] = useState(null);
    const [loadingSharepointCount, setLoadingSharepointCount] = useState(false);

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

                // MEMORY FIX: Only load PENDING photos (not synced ones)
                // Synced photos are in SharePoint and don't need to be displayed locally
                const allPhotos = await StorageService.getPhotos(siteId);
                const pendingPhotos = allPhotos.filter(p =>
                    p.photoReqId.toString() === photoReqId &&
                    p.status === 'pending'
                );
                setCapturedPhotos(pendingPhotos);
                photosRef.current = pendingPhotos;
                console.log(`Loaded ${pendingPhotos.length} pending photos for display`);

                // Skip reconciliation since it can cause issues - just show pending photos
            } catch (error) {
                console.error('Error loading photo capture data:', error);
                alert('Failed to load data. Please try again.');
                navigate(`/site/${siteId}`);
            }
        };

        loadData();

        // Fetch SharePoint photo count (separate from local photos)
        const fetchSharePointCount = async () => {
            if (!siteId || !photoReqId) return;

            try {
                setLoadingSharepointCount(true);
                const sites = await StorageService.getSites();
                const currentSite = sites.find(s => s.id.toString() === siteId);

                if (currentSite) {
                    const photoReqs = await StorageService.getPhotoRequirements();
                    const currentReq = photoReqs.find(r => r.id.toString() === photoReqId);

                    if (currentReq) {
                        // Sanitize category name to match folder name created by Power Automate
                        const sanitizedCategory = currentReq.name
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_')
                            .replace(/^_+|_+$/g, '');

                        // Try to list files in the category subfolder (e.g., PHOTOS/overall_compound_2)
                        try {
                            const folderPath = `PHOTOS/${sanitizedCategory}`;
                            const files = await SharePointService.listFiles(currentSite.phase, currentSite.name, folderPath);
                            const photoCount = files.filter(f => !f.name.endsWith('.zip')).length;
                            setSharepointPhotoCount(photoCount);
                            console.log(`SharePoint subfolder "${sanitizedCategory}": ${photoCount} photos`);
                        } catch (err) {
                            // Folder doesn't exist yet - fallback to filename matching in root
                            const files = await SharePointService.listFiles(currentSite.phase, currentSite.name, 'PHOTOS');
                            const matchingPhotos = files.filter(f =>
                                !f.name.endsWith('.zip') && f.name.toLowerCase().includes(currentReq.name.toLowerCase())
                            );
                            setSharepointPhotoCount(matchingPhotos.length);
                            console.log(`SharePoint root (fallback) for "${currentReq.name}": ${matchingPhotos.length}`);
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching SharePoint photo count:', error);
                setSharepointPhotoCount(0);
            } finally {
                setLoadingSharepointCount(false);
            }
        };

        fetchSharePointCount();

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

    // Device orientation (compass heading) tracking
    useEffect(() => {
        let orientationHandler = null;

        const handleOrientation = (event) => {
            // Get compass heading (webkitCompassHeading for iOS, alpha for Android)
            let compassHeading = null;

            if (event.webkitCompassHeading !== undefined) {
                // iOS - webkitCompassHeading is the compass heading
                compassHeading = event.webkitCompassHeading;
            } else if (event.alpha !== null) {
                // Android - alpha is rotation around z-axis, need to convert
                // This gives approximate heading (not as accurate as iOS)
                compassHeading = 360 - event.alpha;
            }

            if (compassHeading !== null) {
                setHeading(Math.round(compassHeading));
                headingRef.current = Math.round(compassHeading);
            }
        };

        // Request permission on iOS 13+
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ requires permission request on user gesture
            // We'll try to request it, but it may fail without user gesture
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientationabsolute', handleOrientation);
                        window.addEventListener('deviceorientation', handleOrientation);
                        orientationHandler = handleOrientation;
                    }
                })
                .catch(console.error);
        } else if ('DeviceOrientationEvent' in window) {
            // Android and older iOS
            window.addEventListener('deviceorientationabsolute', handleOrientation);
            window.addEventListener('deviceorientation', handleOrientation);
            orientationHandler = handleOrientation;
        }

        return () => {
            if (orientationHandler) {
                window.removeEventListener('deviceorientationabsolute', orientationHandler);
                window.removeEventListener('deviceorientation', orientationHandler);
            }
        };
    }, []);

    const imageCaptureRef = useRef(null); // Reference for ImageCapture API

    // Camera cleanup on unmount - critical for memory management
    useEffect(() => {
        return () => {
            // Stop camera stream on unmount
            if (streamRef.current) {
                console.log('Cleaning up camera stream on unmount');
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            // Clear video source
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        };
    }, []);

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
                    width: { ideal: 4096 },
                    height: { ideal: 2160 },
                    zoom: true // Hint to browser we want zoom
                },
                audio: false
            });

            // Store stream reference first
            streamRef.current = stream;

            const track = stream.getVideoTracks()[0];

            // Initialize ImageCapture if supported
            if ('ImageCapture' in window) {
                try {
                    imageCaptureRef.current = new ImageCapture(track);
                    console.log('ImageCapture API initialized');
                } catch (err) {
                    console.warn('ImageCapture initialization failed:', err);
                }
            }

            // Check for Zoom Capability
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
        imageCaptureRef.current = null;
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

    // Play camera shutter sound
    const playShutterSound = () => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Create a "click" sound using oscillators
            const duration = 0.15;
            const now = audioContext.currentTime;

            // High-frequency click
            const osc1 = audioContext.createOscillator();
            const gain1 = audioContext.createGain();
            osc1.type = 'square';
            osc1.frequency.setValueAtTime(1200, now);
            osc1.frequency.exponentialRampToValueAtTime(400, now + duration);
            gain1.gain.setValueAtTime(0.3, now);
            gain1.gain.exponentialRampToValueAtTime(0.01, now + duration);
            osc1.connect(gain1);
            gain1.connect(audioContext.destination);

            // Low "thunk" sound
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(150, now);
            osc2.frequency.exponentialRampToValueAtTime(50, now + duration * 0.5);
            gain2.gain.setValueAtTime(0.4, now);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + duration * 0.5);
            osc2.connect(gain2);
            gain2.connect(audioContext.destination);

            osc1.start(now);
            osc1.stop(now + duration);
            osc2.start(now);
            osc2.stop(now + duration * 0.5);

            // Clean up
            setTimeout(() => audioContext.close(), 200);
        } catch (e) {
            console.log('Audio not supported:', e);
        }
    };

    const capturePhoto = useCallback(async () => {
        if (!videoRef.current || !site || !photoReq) {
            alert('Error: Missing required data. Please go back and try again.');
            return;
        }

        // Play shutter sound immediately
        playShutterSound();

        try {
            let photoBlob;
            let width, height;

            // 1. CAPTURE IMAGE
            if (imageCaptureRef.current) {
                try {
                    console.log('Using ImageCapture API for high-res photo...');
                    photoBlob = await imageCaptureRef.current.takePhoto();
                    // Load into image to get dimensions
                    const bitmap = await createImageBitmap(photoBlob);
                    width = bitmap.width;
                    height = bitmap.height;
                    bitmap.close();
                    console.log(`ImageCapture success: ${width}x${height}`);
                } catch (err) {
                    console.warn('ImageCapture failed, falling back to video stream:', err);
                }
            }

            // Fallback: Capture from Video Stream
            if (!photoBlob) {
                console.log('Using Video Stream Fallback...');
                width = videoRef.current.videoWidth;
                height = videoRef.current.videoHeight;
                if (width === 0 || height === 0) throw new Error('Video dimensions are zero');

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(videoRef.current, 0, 0);
                photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
            }

            // 2. PROCESS IMAGE (Add Overlays)
            // We need to draw the blob onto a canvas to add overlays
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = URL.createObjectURL(photoBlob);
            });

            // Parse dimensions explicitly from the loaded image
            canvas.width = img.width;
            canvas.height = img.height;

            // Draw original image
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(img.src); // Cleanup

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
                }

                // Prepare text lines
                const lines = [
                    `Site: ${site.name} (${site.siteId})`,
                    locationStr
                ];

                // Add heading if available
                const hdg = headingRef.current;
                if (hdg !== null) {
                    // Convert heading to cardinal direction
                    const cardinalDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
                    const index = Math.round(hdg / 45) % 8;
                    const cardinal = cardinalDirs[index];
                    lines.push(`Heading: ${hdg}° ${cardinal}`);
                }

                lines.push(`Date: ${dateStr}`);

                // Text styling - Scale relative to image width
                const fontSize = Math.max(24, Math.floor(canvas.width / 40));
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

                console.log('Timestamp overlay added to high-res image');
            } catch (overlayError) {
                console.error('Failed to add timestamp overlay:', overlayError);
            }

            // Convert back to blob with high quality
            canvas.toBlob(async (finalBlob) => {
                if (!finalBlob) throw new Error('Failed to encode final image');

                // Generate photo name
                const photoReqName = photoReq.name || `Photo ${photoReq.id}`;
                const nextNum = getNextSequentialNumber(photosRef.current, photoReqName);
                const filename = generatePhotoName(
                    site.name,
                    site.siteId,
                    photoReqName,
                    nextNum.sequential,
                    nextNum.sub
                );

                // Create photo data
                const uniqueId = crypto.randomUUID ? crypto.randomUUID() : generateUniquePhotoId();
                const photoData = {
                    id: uniqueId,
                    photoReqId: photoReq.id,
                    photoReqName: photoReqName,
                    filename: filename + '.jpg',
                    blob: finalBlob,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.8), // Lower quality for thumbnail preview only
                    size: finalBlob.size,
                    width: canvas.width,
                    height: canvas.height,
                    capturedAt: new Date().toISOString(),
                    status: 'pending'
                };

                console.log('Saving photo data:', {
                    id: photoData.id,
                    filename: photoData.filename,
                    size: (photoData.size / 1024 / 1024).toFixed(2) + ' MB',
                    res: `${photoData.width}x${photoData.height}`
                });

                // Optimistically update Ref and State
                const newPhotos = [...photosRef.current, photoData];
                photosRef.current = newPhotos;
                setCapturedPhotos(newPhotos);

                try {
                    await StorageService.savePhoto(site.id, photoData);
                } catch (error) {
                    console.error('Error saving photo:', error);
                    alert('Failed to save photo. Local storage may be full.');
                    // Rollback
                    photosRef.current = photosRef.current.filter(p => p.id !== photoData.id);
                    setCapturedPhotos(photosRef.current);
                }
            }, 'image/jpeg', 0.95); // High quality final save

        } catch (error) {
            console.error('Capture failed:', error);
            alert('Failed to take photo: ' + error.message);
        }
    }, [site, photoReq, siteId]); // dependencies

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

    // Open SharePoint site category subfolder for this requirement
    const openInSharePoint = () => {
        if (site && photoReq) {
            // Open the specific category subfolder (e.g., PHOTOS/overall_compound_2)
            const url = SharePointService.getCategoryFolderUrl(site.phase, site.name, photoReq.name);
            console.log('Opening SharePoint category URL:', url);
            window.open(url, '_blank');
        } else if (site) {
            // Fallback to PHOTOS folder
            const url = SharePointService.getPhotoFolderUrl(site.phase, site.name);
            window.open(url, '_blank');
        } else {
            // Fallback to root
            const siteUrl = sharepointConfig.sharepoint.siteUrl;
            window.open(`${siteUrl}/Shared%20Documents`, '_blank');
        }
    };

    // Compress image using canvas (reduces file size significantly)
    // Updated defaults to 4096px / 0.95 quality for native-like resolution
    const compressImage = (file, maxWidth = 4096, quality = 0.95) => {
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
                    site.siteId,
                    photoReqName,
                    nextNum.sequential,
                    nextNum.sub
                );

                // Create photo data
                const uniqueId = crypto.randomUUID ? crypto.randomUUID() : generateUniquePhotoId();

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
                        <h1 style={{ fontSize: '16px' }}>{photoReq.name}</h1>
                        <p style={{ margin: 0, opacity: 0.9, fontSize: '12px' }}>
                            {site.name} - Project #{site.siteId || site.name}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                            <h3 style={{ fontSize: '16px', margin: 0 }}>
                                Photos
                            </h3>
                            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                {loadingSharepointCount ? (
                                    <span>☁️ Checking SharePoint...</span>
                                ) : sharepointPhotoCount !== null ? (
                                    <span style={{ color: sharepointPhotoCount > 0 ? '#4caf50' : '#999' }}>
                                        ☁️ {sharepointPhotoCount} in SharePoint
                                    </span>
                                ) : (
                                    <span>☁️ Could not check SharePoint</span>
                                )}
                                {capturedPhotos.length > 0 && (
                                    <span style={{ marginLeft: '12px' }}>
                                        📱 {capturedPhotos.length} local (pending upload)
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* GPS Status Indicator */}
                        <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: gpsStatus === 'locked' ? '#4caf50' : (gpsStatus === 'error' ? '#f44336' : '#ff9800'),
                                    boxShadow: `0 0 4px ${gpsStatus === 'locked' ? '#4caf50' : (gpsStatus === 'error' ? '#f44336' : '#ff9800')}`
                                }}></div>
                                <span style={{ color: '#666' }}>
                                    {gpsStatus === 'locked' ? 'GPS' : (gpsStatus === 'error' ? 'GPS Error' : 'GPS...')}
                                </span>
                            </div>
                            {/* Compass Heading Indicator */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '14px' }}>🧭</span>
                                <span style={{ color: heading !== null ? '#666' : '#999' }}>
                                    {heading !== null ? (
                                        <>
                                            {heading}° {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8]}
                                        </>
                                    ) : 'No compass'}
                                </span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {capturedPhotos.length > 0 && (
                                <button onClick={downloadPhotos} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '14px' }}>
                                    💾 Download
                                </button>
                            )}
                            <button onClick={openInSharePoint} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '14px' }}>
                                ☁️ View in SharePoint
                            </button>
                        </div>
                    </div>

                    {capturedPhotos.length === 0 ? (
                        <div className="text-muted text-center" style={{ padding: '12px' }}>
                            {sharepointPhotoCount > 0 ? (
                                <p style={{ margin: 0 }}>
                                    ✓ {sharepointPhotoCount} photos already uploaded to SharePoint.<br />
                                    <span style={{ fontSize: '12px' }}>Use "View in SharePoint" to see them.</span>
                                </p>
                            ) : (
                                <p style={{ margin: 0 }}>No photos captured yet</p>
                            )}
                        </div>
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
