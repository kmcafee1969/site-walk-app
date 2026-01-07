import { sharepointConfig } from '../config/sharepoint.config';

const PIN_AUTH_KEY = 'rmr_cop_pin_auth';

class PinAuthService {
    /**
     * Check if user has entered correct PIN
     */
    isAuthenticated() {
        return localStorage.getItem(PIN_AUTH_KEY) === 'true';
    }

    /**
     * Verify PIN and log in
     * @param {string} pin The PIN entered by user
     * @returns {boolean} True if PIN is correct
     */
    login(pin) {
        // In a real app, we might hash this. For this level of security, direct comparison is acceptable.
        // PIN is defined in sharepoint.config.js
        if (pin === sharepointConfig.accessPin) {
            localStorage.setItem(PIN_AUTH_KEY, 'true');
            return true;
        }
        return false;
    }

    /**
     * Logout (clear PIN auth)
     */
    logout() {
        localStorage.removeItem(PIN_AUTH_KEY);
    }
}

export default new PinAuthService();
