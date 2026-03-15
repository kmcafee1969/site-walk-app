import { createClient } from '@supabase/supabase-js';
import PinAuthService from './PinAuthService';

// Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const APP_ID = import.meta.env.VITE_APP_ID;

let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// Ensure this matches App.jsx or package.json
const APP_VERSION = 'v2.8.2-RecoveryDeploy-20260313';

class ActivityLogService {
    /**
     * Submit a log entry to Supabase
     * @param {string} action - Action identifier (e.g. 'LOGIN', 'SYNC_START', 'ERROR')
     * @param {string|object} details - Additional context or error message
     */
    async log(action, details = null) {
        if (!supabase) return; // Fail silently if no connection

        try {
            // Get current user info if available
            const user = PinAuthService.getCurrentUser();
            const username = user ? user.username : 'anonymous';
            const displayName = user ? user.display_name : 'Anonymous User';
            
            // Format details as string if it's an object
            let detailsStr = details;
            if (typeof details === 'object' && details !== null) {
                try {
                    detailsStr = JSON.stringify(details);
                } catch (e) {
                    detailsStr = 'Un-stringifiable object';
                }
            } else if (details === null) {
                 detailsStr = '';
            }

            const { error } = await supabase
                .from('activity_logs')
                .insert([
                    {
                        username: username,
                        display_name: displayName,
                        action: action,
                        details: detailsStr,
                        app_version: APP_VERSION,
                        app_id: APP_ID
                    }
                ]);

            if (error) {
                console.error('Failed to write activity log:', error);
            }
        } catch (err) {
            console.error('Exception writing activity log:', err);
        }
    }

    // Helper functions for common events
    logLogin(success, errorMsg = null) {
        this.log(success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', errorMsg || 'User logged in successfully');
    }

    logSync(type, status, details = null) {
        this.log(`SYNC_${type}_${status}`, details);
    }
    
    logPhotoUpload(status, batchName, details = null) {
        this.log(`PHOTO_UPLOAD_${status}`, { batch: batchName, ...details });
    }

    logError(context, errorObj) {
        let msg = errorObj;
        if (errorObj instanceof Error) {
            msg = { message: errorObj.message, stack: errorObj.stack };
        }
        this.log(`ERROR_${context}`, msg);
    }
}

export default new ActivityLogService();
