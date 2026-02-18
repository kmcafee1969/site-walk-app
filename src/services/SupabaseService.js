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
        // Fetch from 'sites' table
        // We select specific columns to match the legacy Excel structure
        const { data, error } = await supabase
            .from('sites')
            .select(`
                id,
                site_id,
                phase,
                site_name,
                address,
                city,
                state,
                zip,
                latitude,
                longitude,
                t_mobile_id,
                nfid,
                pace_id,
                project_manager,
                construction_manager,
                company
            `);

        if (error) {
            console.error('Supabase getSites error:', error);
            throw error;
        }

        // Map snake_case to camelCase/Legacy format expected by the app
        return data.map(site => ({
            id: site.id, // Supabase UUID
            siteId: site.site_id, // "CO-ATWOOD"
            phase: site.phase,
            name: site.site_name, // "CO-ATWOOD" (redundant but used by app)
            address: site.address,
            city: site.city,
            state: site.state,
            zip: site.zip,
            latitude: site.latitude || 0,
            longitude: site.longitude || 0,

            // Extra fields (optional in app but good to have)
            tMobileId: site.t_mobile_id,
            nfid: site.nfid,
            paceId: site.pace_id,
            projectManager: site.project_manager,
            constructionManager: site.construction_manager,
            company: site.company || 'Telamon'
        }));
    },

    /**
     * Fetch photo requirements
     */
    async getPhotoRequirements() {
        const { data, error } = await supabase
            .from('photo_requirements')
            .select(`
                id,
                category,
                description,
                min_photos,
                priority,
                phase_id,
                phase_name
            `)
            .order('priority', { ascending: true });

        if (error) {
            console.error('Supabase getPhotoRequirements error:', error);
            throw error;
        }

        return data.map(req => ({
            id: req.id,
            name: req.category, // App uses 'name' for category
            description: req.description,
            minPhotos: req.min_photos || 0,
            priority: req.priority || 999
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
