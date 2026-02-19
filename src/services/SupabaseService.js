import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client
// These env vars must be set in Vercel (and .env for local dev)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase Environment Variables! Check .env or Vercel config.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const SupabaseService = {
    /**
     * Fetch all sites from Supabase
     * Mapped to match the app's internal camelCase format
     */
    async getSites() {
        // Fetch from 'sites' table - using actual Supabase schema columns
        const { data, error } = await supabase
            .from('sites')
            .select(`
                id,
                app_id,
                external_id,
                name,
                address,
                city,
                state,
                zip,
                latitude,
                longitude,
                phase,
                status,
                metadata
            `);

        if (error) {
            console.error('Supabase getSites error:', error);
            throw error;
        }

        // Map to the format expected by the app
        // Extra fields (t_mobile_id, nfid, etc.) are stored in metadata JSONB
        return data.map(site => {
            const meta = site.metadata || {};
            return {
                id: site.id,
                siteId: site.external_id || site.name,
                phase: site.phase || '',
                name: site.name,
                address: site.address || '',
                city: site.city || '',
                state: site.state || '',
                zip: site.zip || '',
                latitude: site.latitude || 0,
                longitude: site.longitude || 0,
                // Fields from metadata needed by QuestionnaireScreen
                towerOwner: meta.tower_owner || '',
                towerOwnerSiteNumber: meta.tower_owner_site_number || '',
                viaeropoc: meta.viaero_poc || '',
                siteType: meta.site_type || '',
                powerCompany: meta.power_company || '',
                meterNumber: meta.meter_number || '',
                telcoProvider: meta.telco_provider || '',
                telcoProviderPOC: meta.telco_provider_poc || '',
                leaseAreaType: meta.lease_area_type || '',
                gateCode: meta.gate_code || '',
                photosUploaded: meta.photos_uploaded || '',
                formUploaded: meta.form_uploaded || '',
                dateWalked: meta.date_walked || '',
                walkedBy: meta.walked_by || '',
                // Legacy fields
                tMobileId: meta.t_mobile_id || '',
                nfid: meta.nfid || '',
                paceId: meta.pace_id || '',
                projectManager: meta.project_manager || '',
                constructionManager: meta.construction_manager || '',
                company: meta.company || 'Telamon'
            };
        });
    },

    /**
     * Fetch photo requirements
     */
    async getPhotoRequirements() {
        const { data, error } = await supabase
            .from('photo_requirements')
            .select(`
                id,
                app_id,
                external_id,
                name,
                description,
                category,
                required,
                sort_order
            `)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error('Supabase getPhotoRequirements error:', error);
            throw error;
        }

        return data.map(req => ({
            id: req.id,
            name: req.name,
            description: req.description || '',
            category: req.category || 'General',
            required: req.required || false,
            minPhotos: req.required ? 1 : 0,
            priority: req.sort_order || 999
        }));
    },

    /**
     * Upload photo to Supabase Storage buffer
     */
    async uploadPhoto(file, metadata) {
        // 1. Upload file to Storage
        // Path: public/buffer-photos/{siteId}/{filename}
        const filePath = `${metadata.siteId}/${metadata.filename}`;

        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('buffer-photos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            console.error('Supabase Storage Upload Error:', uploadError);
            throw uploadError;
        }

        // 2. Insert record into DB
        const { data: insertData, error: insertError } = await supabase
            .from('photos')
            .insert({
                site_id: metadata.siteId,
                photo_req_id: metadata.photoReqId,
                filename: metadata.filename,
                storage_path: uploadData.path,
                metadata: {
                    size: file.size,
                    width: metadata.width,
                    height: metadata.height,
                    captured_at: metadata.capturedAt
                },
                sharepoint_status: 'pending'
            })
            .select();

        if (insertError) {
            console.error('Supabase DB Insert Error:', insertError);
            // Cleanup storage on DB failure? Ideally yes.
            await supabase.storage.from('buffer-photos').remove([filePath]);
            throw insertError;
        }

        return insertData[0];
    },

    /**
     * Get photos pending sync to SharePoint
     */
    async getPendingPhotos() {
        const { data, error } = await supabase
            .from('photos')
            .select('*')
            .eq('sharepoint_status', 'pending');

        if (error) throw error;
        return data;
    },

    /**
     * Download photo blob from Supabase Storage
     */
    async downloadPhoto(storagePath) {
        const { data, error } = await supabase
            .storage
            .from('buffer-photos')
            .download(storagePath);

        if (error) throw error;
        return data; // Blob
    },

    /**
     * Update SharePoint sync status
     */
    async updatePhotoSharePointStatus(id, status, sharepointPath = null) {
        const updateData = {
            sharepoint_status: status,
            updated_at: new Date().toISOString()
        };

        if (sharepointPath) {
            updateData.sharepoint_path = sharepointPath;
        }

        const { error } = await supabase
            .from('photos')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;
    },

    /**
     * Check connection health
     */
    async checkConnection() {
        const { data, error } = await supabase.from('sites').select('count', { count: 'exact', head: true });
        return !error;
    }
};
