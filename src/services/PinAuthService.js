import { createClient } from '@supabase/supabase-js';

const USER_AUTH_KEY = 'rmr_cop_user_auth';
const USER_DATA_KEY = 'rmr_cop_user_data';

// Supabase client (same as rmr-platform uses)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The app ID this site-walk-app instance is for
// This should match the app in Supabase that users are assigned to
const APP_ID = import.meta.env.VITE_APP_ID;

let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

class PinAuthService {
    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return localStorage.getItem(USER_AUTH_KEY) === 'true';
    }

    /**
     * Get the currently logged in user data
     */
    getCurrentUser() {
        const userData = localStorage.getItem(USER_DATA_KEY);
        if (userData) {
            try {
                return JSON.parse(userData);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * Get user's role
     */
    getUserRole() {
        const user = this.getCurrentUser();
        return user?.role || 'user';
    }

    /**
     * Check if current user can delete items
     * Only 'admin' and 'user' roles can delete
     */
    canDelete() {
        const role = this.getUserRole();
        return role === 'admin' || role === 'user';
    }

    /**
     * Check if current user is an admin
     */
    isAdmin() {
        return this.getUserRole() === 'admin';
    }

    /**
     * Verify username and PIN against Supabase
     * @param {string} username The username entered by user
     * @param {string} pin The PIN entered by user
     * @returns {Promise<{success: boolean, error?: string, user?: object}>}
     */
    async login(username, pin) {
        if (!supabase) {
            return {
                success: false,
                error: 'Database connection not configured. Contact administrator.'
            };
        }

        if (!APP_ID) {
            return {
                success: false,
                error: 'App not configured. Contact administrator.'
            };
        }

        try {
            const { data, error } = await supabase
                .from('app_users')
                .select('*')
                .eq('app_id', APP_ID)
                .eq('username', username.toLowerCase().trim())
                .eq('pin', pin.trim())
                .eq('is_active', true)
                .single();

            if (error && error.code !== 'PGRST116') {
                console.error('Login error:', error);
                return { success: false, error: 'Login failed. Please try again.' };
            }

            if (!data) {
                return { success: false, error: 'Invalid username or PIN.' };
            }

            // Successful login
            localStorage.setItem(USER_AUTH_KEY, 'true');
            localStorage.setItem(USER_DATA_KEY, JSON.stringify({
                id: data.id,
                username: data.username,
                display_name: data.display_name,
                role: data.role
            }));

            return { success: true, user: data };

        } catch (err) {
            console.error('Login error:', err);
            return { success: false, error: 'Network error. Please check your connection.' };
        }
    }

    /**
     * Logout (clear user auth)
     */
    logout() {
        localStorage.removeItem(USER_AUTH_KEY);
        localStorage.removeItem(USER_DATA_KEY);
    }
}

export default new PinAuthService();
