import { StorageService } from './StorageService';
import SharePointService from './SharePointService';

export const SyncService = {
    isOnline() {
        return navigator.onLine;
    },

    async addToQueue(type, data) {
        await StorageService.addToSyncQueue({
            type,
            data,
            attempts: 0
        });
        console.log(`Added ${type} to sync queue`);
    },

    async processQueue() {
        if (!this.isOnline()) {
            console.log('Offline: Cannot process sync queue');
            return;
        }

        const queue = await StorageService.getSyncQueue();
        if (queue.length === 0) {
            return;
        }

        console.log(`Processing ${queue.length} items in sync queue...`);
        let successCount = 0;

        for (const item of queue) {
            try {
                let success = false;

                if (item.type === 'PHOTO') {
                    success = await this.syncPhoto(item.data);
                } else if (item.type === 'QUESTIONNAIRE') {
                    success = await this.syncQuestionnaire(item.data);
                } else if (item.type === 'DELETE_PHOTO') {
                    success = await this.syncDeletePhoto(item.data);
                }

                if (success) {
                    await StorageService.removeFromSyncQueue(item.id);
                    successCount++;
                }
            } catch (error) {
                console.error(`Error processing queue item ${item.id}:`, error);
            }
        }

        return successCount;
    },

    async syncPhoto(data) {
        try {
            // Data expected: { siteId, photoId, phase, siteName }
            const photo = (await StorageService.getPhotos(data.siteId))
                .find(p => p.id === data.photoId);

            if (!photo) {
                console.error('Photo not found in storage:', data.photoId);
                return true; // Remove from queue
            }

            await SharePointService.uploadPhoto(
                data.phase,
                data.siteName,
                photo.filename,
                photo.blob
            );

            console.log(`Synced photo: ${photo.filename}`);
            return true;
        } catch (error) {
            console.error('Sync photo error:', error);
            return false;
        }
    },

    async syncQuestionnaire(data) {
        try {
            // Data expected: { phase, siteName, siteId, blob }
            const { phase, siteName, siteId, blob } = data;

            await SharePointService.uploadQuestionnaire(
                phase,
                siteName,
                siteId,
                blob
            );

            console.log(`Synced questionnaire for ${siteName}`);
            return true;
        } catch (error) {
            console.error('Sync questionnaire error:', error);
            return false;
        }
    },

    async syncDeletePhoto(data) {
        try {
            // Data expected: { phase, siteName, filename }
            const { phase, siteName, filename } = data;

            await SharePointService.deleteFile(phase, siteName, filename);
            console.log(`Synced deletion for: ${filename}`);
            return true;
        } catch (error) {
            console.error('Sync delete photo error:', error);
            return false;
        }
    },

    async reconcilePhotos(siteId, phase, siteName) {
        if (!this.isOnline()) return { deleted: 0, downloaded: 0 };

        try {
            console.log(`Reconciling photos for ${siteName}...`);

            // 1. Get server files
            const serverFiles = await SharePointService.listFiles(phase, siteName);
            const serverFilenames = new Set(serverFiles.map(f => f.name));

            // 2. Get local photos
            const localPhotos = await StorageService.getPhotos(siteId);
            const localFilenames = new Set(localPhotos.map(p => p.filename));

            // DEBUG: Log what we found
            console.log('🔍 RECONCILIATION DEBUG:');
            console.log('Server files:', Array.from(serverFilenames));
            console.log('Local files:', Array.from(localFilenames));
            console.log('Local photos with status:', localPhotos.map(p => ({ filename: p.filename, status: p.status, capturedAt: p.capturedAt })));

            // 2.5 DEDUPLICATION: Remove duplicate local photos with same filename (keep newest)
            const seenFilenames = new Map(); // filename -> photo with newest capturedAt
            for (const photo of localPhotos) {
                const existing = seenFilenames.get(photo.filename);
                if (!existing) {
                    seenFilenames.set(photo.filename, photo);
                } else {
                    // Keep the one with later capturedAt
                    const existingDate = new Date(existing.capturedAt || 0);
                    const currentDate = new Date(photo.capturedAt || 0);
                    if (currentDate > existingDate) {
                        // Delete the older one
                        await StorageService.deletePhoto(existing.id);
                        console.log(`🧹 Removed duplicate (older): ${existing.filename}`);
                        seenFilenames.set(photo.filename, photo);
                    } else {
                        // Delete the current one (it's older or same)
                        await StorageService.deletePhoto(photo.id);
                        console.log(`🧹 Removed duplicate (older): ${photo.filename}`);
                    }
                }
            }

            // Refresh local data after deduplication
            const cleanedPhotos = await StorageService.getPhotos(siteId);
            const cleanedFilenames = new Set(cleanedPhotos.map(p => p.filename));

            // 3. Find photos to delete (Local exists, Server missing)
            // Delete photos if:
            // - They don't exist on the server, AND
            // - Either: status is not 'pending', OR status is 'pending' but photo is old (>5 min)
            const now = new Date();
            const photosToDelete = cleanedPhotos.filter(p => {
                const notOnServer = !serverFilenames.has(p.filename);

                if (!notOnServer) {
                    // Photo exists on server, keep it
                    console.log(`✓ Keeping synced photo: ${p.filename}`);
                    return false;
                }

                // Photo doesn't exist on server
                const isPending = p.status === 'pending';

                if (!isPending) {
                    // Not pending, safe to delete
                    console.log(`📌 Will delete: ${p.filename} (status: ${p.status})`);
                    return true;
                }

                // Photo is pending - check if it's stale
                const capturedAt = p.capturedAt ? new Date(p.capturedAt) : new Date(0);
                const ageMinutes = (now - capturedAt) / 1000 / 60;

                if (ageMinutes > 1440) {
                    // Pending for >24 hours and not on server = stuck/orphaned
                    console.log(`⚠️ Will delete stale pending photo: ${p.filename} (age: ${ageMinutes.toFixed(1)} min)`);
                    return true;
                } else {
                    // Recently pending, give it time to upload
                    console.log(`⏭️ Skipping recent pending photo: ${p.filename} (age: ${ageMinutes.toFixed(1)} min)`);
                    return false;
                }
            });

            // 4. Find photos to download (Server exists, Local missing)
            const photosToDownload = serverFiles.filter(f => {
                const shouldDownload = !localFilenames.has(f.name) && f.name.toLowerCase().endsWith('.jpg');
                if (shouldDownload) {
                    console.log(`📥 Will download: ${f.name}`);
                }
                return shouldDownload;
            });

            console.log(`Reconciliation Plan: Delete ${photosToDelete.length}, Download ${photosToDownload.length}`);

            // Execute Deletions
            for (const photo of photosToDelete) {
                await StorageService.deletePhoto(photo.id);
                console.log(`Deleted local orphan: ${photo.filename}`);
            }

            // Execute Downloads
            const photoReqs = await StorageService.getPhotoRequirements();

            for (const file of photosToDownload) {
                try {
                    // Download Blob
                    const blob = await SharePointService.downloadPhoto(phase, siteName, file.name);

                    // Parse filename to match requirement
                    // Format: SiteName SiteId PhotoReqName Sequential.Sub.jpg
                    let matchedReq = null;
                    let photoReqName = '';

                    // FIXED: Use regex with word boundary to prevent "Overall Compound 1" matching "Overall Compound 2"
                    // Sort by name length descending to match longest first (more specific)
                    const sortedReqs = [...photoReqs].sort((a, b) => b.name.length - a.name.length);

                    for (const req of sortedReqs) {
                        // Escape special regex characters and require the name to be followed by a space and digit
                        const escapedName = req.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const reqPattern = new RegExp(`${escapedName} \\d`);
                        if (reqPattern.test(file.name)) {
                            matchedReq = req;
                            photoReqName = req.name;
                            break;
                        }
                    }

                    // Fallback: exact name extraction
                    if (!matchedReq) {
                        const nameParts = file.name.split(' - ');
                        if (nameParts.length >= 3) {
                            const lastPart = nameParts[nameParts.length - 1];
                            photoReqName = lastPart.replace(/ \d+\.\d+\.(jpg|jpeg)$/i, '').trim();
                            matchedReq = photoReqs.find(r => r.name === photoReqName);
                        }
                    }

                    if (matchedReq) {
                        // FIXED: Convert blob to base64 for persistence across browser sessions
                        const base64DataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });

                        const photoData = {
                            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                            photoReqId: matchedReq.id,
                            photoReqName: matchedReq.name,
                            filename: file.name,
                            blob: blob,
                            dataUrl: base64DataUrl, // Base64 persists across sessions
                            size: blob.size,
                            capturedAt: file.lastModifiedDateTime || new Date().toISOString(),
                            status: 'synced'
                        };

                        await StorageService.savePhoto(siteId, photoData);
                        console.log(`Downloaded and saved: ${file.name}`);
                    } else {
                        console.warn(`Could not match photo ${file.name} to a requirement. Skipping.`);
                    }
                } catch (err) {
                    console.error(`Failed to download ${file.name}:`, err);
                }
            }

            return { deleted: photosToDelete.length, downloaded: photosToDownload.length };
        } catch (error) {
            console.error('Reconciliation error:', error);
            return { deleted: 0, downloaded: 0 };
        }
    },

    init() {
        window.addEventListener('online', () => {
            console.log('Network restored. Processing sync queue...');
            this.processQueue();
        });

        if (this.isOnline()) {
            setTimeout(() => this.processQueue(), 5000);
        }
    }
};
