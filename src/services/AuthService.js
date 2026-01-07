/**
 * AuthService - Simplified for Service Account Model
 * 
 * Since we are now using a Backend Proxy with a Service Account,
 * individual user authentication via MSAL is no longer required.
 * 
 * This service now acts as a stub to maintain compatibility with the rest
 * of the application which expects an AuthService.
 */

// We don't need MSAL anymore
// import { PublicClientApplication } from '@azure/msal-browser';
// import { msalConfig } from '../config/auth.config';

class AuthService {
    constructor() {
        this.authenticated = true; // Always considered "authenticated" for SharePoint purposes
    }

    async initialize() {
        // No-op
        return Promise.resolve();
    }

    async login() {
        // No-op, we are always logged in via Proxy
        console.log('Login requested, but using Service Account Proxy.');
        return Promise.resolve({ account: { username: 'Service Account' } });
    }

    logout() {
        // No-op
        console.log('Logout not applicable for Service Account.');
    }

    async getAccessToken() {
        // Not used by frontend anymore, Proxy handles tokens
        return null;
    }

    isAuthenticated() {
        return true;
    }

    async handleRedirectPromise() {
        return null;
    }
}

export default new AuthService();
