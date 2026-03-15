import { supabase } from './SupabaseService';

// Environment variables
const APP_ID = import.meta.env.VITE_APP_ID;
const USER_DATA_KEY = 'rmr_cop_user_data';

// Ensure this matches App.jsx or package.json
const APP_VERSION = 'v2.8.2-RecoveryDeploy-20260313';

class ActivityLogService {
    /**
     * Submit a log entry to Supabase
     * @param {string} action - Action identifier (e.g. 'LOGIN', 'SYNC_START', 'ERROR')
     * @param {string|object} details - Additional context or error message
     */
    async log(action, details = null) {
        if (!supabase) {
            console.warn('ActivityLogService: Supabase client not available');
            return;
        }

        try {
            // Read user info directly from localStorage to avoid circular dependency with PinAuthService
            const userData = localStorage.getItem(USER_DATA_KEY);
            let username = 'anonymous';
            let displayName = 'Anonymous User';
            
            if (userData) {
                try {
                    const parsed = JSON.parse(userData);
                    username = parsed.username || 'anonymous';
                    displayName = parsed.display_name || 'Anonymous User';
                } catch (e) {
                    console.warn('ActivityLogService: Failed to parse user data from localStorage');
                }
            }
            
            console.log(`ActivityLogService: Attempting to log [${action}] for [${username}]`);

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

            // Safety check for APP_ID - ensure it's a valid string or null
            const appIdToUse = (APP_ID && typeof APP_ID === 'string' && APP_ID.length > 5) ? APP_ID : null;

            const { error } = await supabase
                .from('activity_logs')
                .insert([
                    {
                        username: username,
                        display_name: displayName,
                        action: action,
                        details: detailsStr,
                        app_version: APP_VERSION,
                        app_id: appIdToUse
                    }
                ]);

            if (error) {
                console.error('ActivityLogService: Supabase insert error:', error);
            } else {
                console.log(`ActivityLogService: Log [${action}] sent successfully`);
            }
        } catch (err) {
            console.error('ActivityLogService: Fatal exception in log():', err);
        }
    }

    // Diagnostic test
    async logTest() {
        return this.log('DIAGNOSTIC_TEST', { timestamp: new Date().toISOString(), message: 'Manually triggered test log' });
    }

    // Helper functions for common events
    logLogin(success, errorMsg = null) {
        this.log(success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', errorMsg || (success ? 'User logged in successfully' : 'Login failed'));
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
