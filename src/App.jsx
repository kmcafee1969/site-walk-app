import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles/index.css';
import HomeScreen from './screens/HomeScreen';
import SiteDetailScreen from './screens/SiteDetailScreen';
import PhotoCaptureScreen from './screens/PhotoCaptureScreen';
import QuestionnaireScreen from './screens/QuestionnaireScreen';
import DataLoadScreen from './screens/DataLoadScreen';

import { StorageService } from './services/StorageService';
import AuthService from './services/AuthService';
import SharePointService from './services/SharePointService';
import { SyncService } from './services/SyncService';

// Version for deployment debugging
// Version for deployment debugging
// Version for deployment debugging
const APP_VERSION = 'v2.6.2-20260213-2045';

// Error Boundary Component
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('App Error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h1>⚠️ Something went wrong</h1>
                    <p style={{ color: '#666', marginBottom: '20px' }}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '12px 24px',
                            backgroundColor: '#1976d2',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '16px',
                            cursor: 'pointer'
                        }}
                    >
                        Reload App
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

import PinAuthService from './services/PinAuthService';
import PinLoginScreen from './screens/PinLoginScreen';
import SessionService from './services/SessionService'; // Import SessionService

function App() {
    const [isPinAuthenticated, setIsPinAuthenticated] = useState(PinAuthService.isAuthenticated()); // Initialize with current auth state
    const [isLoading, setIsLoading] = useState(true);
    const [sites, setSites] = useState([]);
    const [error, setError] = useState(null);

    const handleLogout = () => {
        PinAuthService.logout();
        setIsPinAuthenticated(false);
        SessionService.stopMonitoring(); // Stop monitoring on logout
    };

    useEffect(() => {
        // MIGRATION: Force logout for v2.6.1 update to ensure session policy is active
        // using a specific key to guarantee it runs exactly once per device per update
        const MIGRATION_KEY = 'rmr_cop_migration_v261';
        const hasMigrated = localStorage.getItem(MIGRATION_KEY);

        if (!hasMigrated) {
            console.log('Migration: v2.6.1 update. Forcing one-time logout.');
            localStorage.setItem(MIGRATION_KEY, 'true');
            // Clear auth to force login
            localStorage.removeItem('rmr_cop_user_auth');
            // Also clear legacy session if exists
            localStorage.removeItem('rmr_cop_last_active');

            setIsPinAuthenticated(false);
            return; // Stop here
        }

        // Initialize Session Service
        if (isPinAuthenticated) {
            SessionService.init(handleLogout);
        }

        initializeApp();
        // Initialize background sync service
        SyncService.init();

        // Check session on visibility change (for when app comes back from background)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isPinAuthenticated) {
                SessionService.checkSession();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isPinAuthenticated]);

    const initializeApp = async () => {
        try {
            await AuthService.initialize();

            // Only try to load data if we have passed the PIN gate
            if (isPinAuthenticated) {
                await loadDataFromSharePoint();
            } else {
                setIsLoading(false); // Stop loading to show PIN screen
            }

        } catch (err) {
            console.error('Initialization error:', err);
            setError(err.message);
            setIsLoading(false);
        }
    };

    const loadDataFromSharePoint = async () => {
        try {
            setIsLoading(true);
            console.log('Loading data from SharePoint via Service Account...');

            // Load site details and photo requirements from SharePoint (Proxy)
            const [siteDetails, photoRequirements] = await Promise.all([
                SharePointService.loadSiteDetails(),
                SharePointService.loadPhotoRequirements()
            ]);

            console.log(`Loaded ${siteDetails.length} sites from SharePoint`);
            console.log(`Loaded ${photoRequirements.length} photo requirements from SharePoint`);

            // Save to localStorage for offline access
            await StorageService.saveSites(siteDetails);
            await StorageService.savePhotoRequirements(photoRequirements);

            setSites(siteDetails);
        } catch (err) {
            console.error('Error loading from SharePoint:', err);

            // Fallback to cached data
            const cachedSites = await StorageService.getSites();
            if (cachedSites.length > 0) {
                console.log('Using cached data due to SharePoint error');
                setSites(cachedSites);
                // No alert needed on initial load if cache is available
            } else {
                setError(`Failed to load data from SharePoint: ${err.message}`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Manual refresh handler
    const handleRefresh = async () => {
        await loadDataFromSharePoint();
    };

    const handlePinSuccess = () => {
        setIsPinAuthenticated(true);
        SessionService.init(handleLogout); // Start session monitoring on login
    };

    const handleDataLoaded = async (loadedSites) => {
        setSites(loadedSites);
        await StorageService.saveSites(loadedSites);
    };

    if (isLoading && isPinAuthenticated) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)'
            }}>
                <div style={{ textAlign: 'center', color: 'white', padding: '20px' }}>
                    <div className="spinner" style={{
                        width: '40px',
                        height: '40px',
                        border: '4px solid rgba(255,255,255,0.3)',
                        borderTop: '4px solid white',
                        borderRadius: '50%',
                        margin: '0 auto 16px auto',
                        animation: 'spin 1s linear infinite'
                    }}></div>
                    <h2>Connecting to SharePoint...</h2>
                    <p>Downloading Site List and Photo Requirements</p>
                    <p style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>Using Service Account</p>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                padding: '20px'
            }}>
                <div style={{ textAlign: 'center', maxWidth: '400px' }}>
                    <h2 style={{ color: '#c62828', marginBottom: '16px' }}>⚠️ Error</h2>
                    <p style={{ marginBottom: '20px' }}>{error}</p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        <button
                            onClick={() => window.location.reload()}
                            className="btn btn-primary"
                            style={{ padding: '12px 24px' }}
                        >
                            Retry
                        </button>
                        <button
                            onClick={() => { setError(null); setIsLoading(false); }}
                            className="btn btn-secondary"
                            style={{ padding: '12px 24px' }}
                        >
                            Ignore & Continue
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // PIN Authentication Check (First Layer)
    if (!isPinAuthenticated) {
        return (
            <ErrorBoundary>
                <PinLoginScreen onLoginSuccess={handlePinSuccess} />
            </ErrorBoundary>
        );
    }

    // Main App (Accessible after PIN)
    return (
        <ErrorBoundary>
            <div className="app-main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                <BrowserRouter>
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <HomeScreen
                                    sites={sites}
                                    onRefresh={handleRefresh}
                                    onLogout={handleLogout} // Pass logout handler
                                />
                            }
                        />
                        <Route path="/admin" element={<DataLoadScreen onDataLoaded={handleDataLoaded} />} />
                        <Route path="/site/:siteId" element={<SiteDetailScreen />} />
                        <Route path="/site/:siteId/photo/:photoReqId" element={<PhotoCaptureScreen />} />
                        <Route path="/site/:siteId/questionnaire" element={<QuestionnaireScreen />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </div>
        </ErrorBoundary>
    );
}

export default App;
