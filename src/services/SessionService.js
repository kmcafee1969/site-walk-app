/**
 * SessionService
 * Handles auto-logout functionality based on user inactivity.
 * Default timeout: 3 hours
 */

const SESSION_KEY = 'rmr_cop_last_active';
const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

class SessionService {
    constructor() {
        this.timeoutMs = DEFAULT_TIMEOUT_MS;
        this.logoutCallback = null;
        this.activityListener = this.recordActivity.bind(this);
        this.checkInterval = null;
    }

    /**
     * Initialize the session service
     * @param {Function} onLogout - Callback function to execute when session expires
     * @param {number} timeoutMs - Custom timeout in ms (optional)
     */
    init(onLogout, timeoutMs = DEFAULT_TIMEOUT_MS) {
        this.logoutCallback = onLogout;
        this.timeoutMs = timeoutMs;

        // Set initial activity timestamp if not present
        if (!localStorage.getItem(SESSION_KEY)) {
            this.recordActivity();
        }

        this.startMonitoring();
        this.checkSession(); // Check immediately on init
    }

    /**
     * Start listening for user activity
     */
    startMonitoring() {
        window.addEventListener('click', this.activityListener);
        window.addEventListener('touchstart', this.activityListener);
        window.addEventListener('keydown', this.activityListener);
        window.addEventListener('scroll', this.activityListener);

        // Check session every minute
        if (this.checkInterval) clearInterval(this.checkInterval);
        this.checkInterval = setInterval(() => this.checkSession(), 60000);
    }

    /**
     * Stop monitoring (e.g., on logout)
     */
    stopMonitoring() {
        window.removeEventListener('click', this.activityListener);
        window.removeEventListener('touchstart', this.activityListener);
        window.removeEventListener('keydown', this.activityListener);
        window.removeEventListener('scroll', this.activityListener);

        if (this.checkInterval) clearInterval(this.checkInterval);
        localStorage.removeItem(SESSION_KEY);
    }

    /**
     * Record current time as last active
     */
    recordActivity() {
        localStorage.setItem(SESSION_KEY, Date.now().toString());
    }

    /**
     * Check if the current session has expired
     * @returns {boolean} true if valid, false if expired
     */
    checkSession() {
        const lastActive = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10);
        const now = Date.now();

        if (now - lastActive > this.timeoutMs) {
            console.log('Session expired due to inactivity');
            this.logout();
            return false;
        }
        return true;
    }

    /**
     * Force logout
     */
    logout() {
        this.stopMonitoring();
        if (this.logoutCallback) {
            this.logoutCallback();
        }
    }
}

export default new SessionService();
