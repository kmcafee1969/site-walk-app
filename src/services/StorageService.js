// IndexedDB storage service for offline persistence
import { openDB } from 'idb';

const DB_NAME = 'site-walk-db';
const DB_VERSION = 1;

export const StorageService = {
    async getDB() {
        return openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // Sites store
                if (!db.objectStoreNames.contains('sites')) {
                    db.createObjectStore('sites', { keyPath: 'id' });
                }

                // Photos store
                if (!db.objectStoreNames.contains('photos')) {
                    const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
                    photoStore.createIndex('siteId', 'siteId', { unique: false });
                    photoStore.createIndex('status', 'status', { unique: false }); // synced, pending
                }

                // Questionnaires store
                if (!db.objectStoreNames.contains('questionnaires')) {
                    db.createObjectStore('questionnaires', { keyPath: 'siteId' });
                }

                // Settings/Metadata store (requirements, current site, etc)
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Sync Queue store (actions to replay)
                if (!db.objectStoreNames.contains('syncQueue')) {
                    const queueStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                    queueStore.createIndex('created', 'created', { unique: false });
                }
            },
        });
    },

    // Sites
    async saveSites(sites) {
        const db = await this.getDB();
        const tx = db.transaction('sites', 'readwrite');
        const store = tx.objectStore('sites');
        await store.clear(); // Clear old cached sites to prevent duplicates after re-import
        await Promise.all(sites.map(site => store.put(site)));
        await tx.done;
    },

    async getSites() {
        const db = await this.getDB();
        return db.getAll('sites');
    },

    async getSite(siteId) {
        const db = await this.getDB();
        return db.get('sites', siteId);
    },

    // Photos
    async savePhoto(siteId, photoData) {
        const db = await this.getDB();
        const photo = {
            ...photoData,
            siteId: siteId,
            status: 'pending', // Default to pending upload
            timestamp: new Date().toISOString()
        };
        await db.put('photos', photo);
        return photo;
    },

    async getPhotos(siteId) {
        const db = await this.getDB();
        return db.getAllFromIndex('photos', 'siteId', siteId);
    },

    // Lightweight metadata-only retrieval (excludes blob/dataUrl to save memory)
    async getPhotoMetadata(siteId) {
        const db = await this.getDB();
        const photos = await db.getAllFromIndex('photos', 'siteId', siteId);
        // Return only metadata, not the memory-heavy blob/dataUrl
        return photos.map(p => ({
            id: p.id,
            photoReqId: p.photoReqId,
            photoReqName: p.photoReqName,
            filename: p.filename,
            status: p.status,
            capturedAt: p.capturedAt,
            size: p.size
        }));
    },

    async getAllPhotos() {
        const db = await this.getDB();
        return db.getAll('photos');
    },

    async deletePhoto(photoId) {
        const db = await this.getDB();
        await db.delete('photos', photoId);
    },

    // Questionnaires
    async saveQuestionnaire(siteId, data, status = 'pending') {
        const db = await this.getDB();
        const questionnaire = {
            siteId: siteId,
            ...data,
            status: status,
            completedAt: new Date().toISOString()
        };
        await db.put('questionnaires', questionnaire);
    },

    async deleteQuestionnaire(siteId) {
        const db = await this.getDB();
        await db.delete('questionnaires', siteId);
    },

    async updatePhotoStatus(id, status) {
        const db = await this.getDB();
        const photo = await db.get('photos', id);
        if (photo) {
            photo.status = status;
            if (status === 'synced') {
                photo.syncedAt = new Date().toISOString();
            }
            await db.put('photos', photo);
        }
    },

    async getQuestionnaire(siteId) {
        const db = await this.getDB();
        return db.get('questionnaires', siteId);
    },

    async getAllQuestionnaires() {
        const db = await this.getDB();
        return db.getAll('questionnaires');
    },

    // Photo Requirements
    async savePhotoRequirements(requirements) {
        const db = await this.getDB();
        await db.put('settings', { key: 'photo_requirements', value: requirements });
    },

    async getPhotoRequirements() {
        const db = await this.getDB();
        const result = await db.get('settings', 'photo_requirements');
        return result ? result.value : [];
    },

    // Current Site
    async setCurrentSite(siteId) {
        const db = await this.getDB();
        await db.put('settings', { key: 'current_site', value: siteId });
    },

    async getCurrentSite() {
        const db = await this.getDB();
        const result = await db.get('settings', 'current_site');
        return result ? result.value : null;
    },

    // Sync Queue
    async addToSyncQueue(action) {
        const db = await this.getDB();
        const item = {
            ...action,
            created: new Date().toISOString(),
            status: 'pending'
        };
        await db.add('syncQueue', item);
    },

    async getSyncQueue() {
        const db = await this.getDB();
        return db.getAll('syncQueue');
    },

    async removeFromSyncQueue(id) {
        const db = await this.getDB();
        await db.delete('syncQueue', id);
    },

    // Utilities
    async clearAll() {
        const db = await this.getDB();
        // Clear all stores
        const stores = ['sites', 'photos', 'questionnaires', 'settings', 'syncQueue'];
        const tx = db.transaction(stores, 'readwrite');
        await Promise.all(stores.map(store => tx.objectStore(store).clear()));
        await tx.done;
    },

    // For export compatibility
    async exportAllData() {
        const db = await this.getDB();
        return {
            sites: await db.getAll('sites'),
            photos: await db.getAll('photos'),
            questionnaires: await db.getAll('questionnaires'),
            exportDate: new Date().toISOString()
        };
    }
};
