import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExcelService } from '../services/ExcelService';
import { StorageService } from '../services/StorageService';
import { SyncService } from '../services/SyncService';
import { SupabaseService } from '../services/SupabaseService';

function DataLoadScreen({ onDataLoaded }) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [siteTrackerFile, setSiteTrackerFile] = useState(null);
    const [photoReqsFile, setPhotoReqsFile] = useState(null);
    const [siteTrackerLoaded, setSiteTrackerLoaded] = useState(false);
    const [photoReqsLoaded, setPhotoReqsLoaded] = useState(false);
    const [syncStatus, setSyncStatus] = useState('');

    const syncFromSharePoint = async () => {
        if (!window.confirm('Import data from SharePoint Excel files into Supabase?\n\nThis will update sites, photo requirements, and form fields.')) return;

        setLoading(true);
        setError('');
        setSyncStatus('Connecting to SharePoint...');

        try {
            const response = await fetch('/api/import-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-pin': '2025'
                }
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Import failed');
            }

            setSyncStatus('');
            alert(`✅ Import Complete!\n\n${result.message}\n\n${result.details.errors.length > 0 ? 'Warnings:\n' + result.details.errors.join('\n') : 'No errors.'}`);

            // Refresh the app data
            window.location.href = '/';
        } catch (err) {
            setError(`SharePoint Sync Failed: ${err.message}`);
            setSyncStatus('');
        } finally {
            setLoading(false);
        }
    };

    const handleSiteTrackerUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setSiteTrackerFile(file);
        setError('');
        setSiteTrackerLoaded(true);
    };

    const handlePhotoReqsUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setPhotoReqsFile(file);
        setError('');
        setPhotoReqsLoaded(true);
    };

    const handleContinue = async () => {
        if (!siteTrackerFile || !photoReqsFile) {
            setError('Please upload both files before continuing.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Load site tracker
            const sites = await ExcelService.loadSiteTracker(siteTrackerFile);
            if (sites.length === 0) {
                setError('No sites found in the Site Tracker file. Please check the file format.');
                setLoading(false);
                return;
            }

            // Load photo requirements
            const photoReqs = await ExcelService.loadPhotoRequirements(photoReqsFile);
            if (photoReqs.length === 0) {
                setError('No photo requirements found in the Photo Requirements file. Please check the file format.');
                setLoading(false);
                return;
            }

            // Save photo requirements to localStorage
            StorageService.savePhotoRequirements(photoReqs);

            // Continue with site data
            await onDataLoaded(sites);
            setLoading(false);
            navigate('/');
        } catch (err) {
            setError(err.message || 'Failed to load Excel files. Please try again.');
            setLoading(false);
        }
    };

    const loadDemoData = () => {
        // Load demo data for testing
        const demoSites = [
            {
                id: '435',
                name: 'NE-FRANKLIN',
                address: '123 Tower Road',
                city: 'Franklin',
                state: 'NE',
                zip: '68939',
                latitude: '40.0969',
                longitude: '-99.2168',
                phase: 'Phase 9',
                towerOwner: 'American Tower',
                powerCompany: 'Southern Power District',
                meterNumber: '12345678',
                telcoProvider: 'AT&T',
                leaseAreaType: 'Compound',
                gateCode: '',
                photosUploaded: '',
                formUploaded: '',
                dateWalked: '',
                walkedBy: ''
            },
            {
                id: '436',
                name: 'NE-BRYNWOOD',
                address: '456 Signal Ave',
                city: 'Brynwood',
                state: 'NE',
                zip: '68001',
                latitude: '41.2565',
                longitude: '-96.0086',
                phase: 'Phase 9',
                towerOwner: 'Crown Castle',
                powerCompany: 'Nebraska Public Power',
                meterNumber: '87654321',
                telcoProvider: 'Verizon',
                leaseAreaType: 'Rooftop',
                gateCode: '1234',
                photosUploaded: '',
                formUploaded: '',
                dateWalked: '',
                walkedBy: ''
            }
        ];

        onDataLoaded(demoSites);
    };

    return (
        <div>
            <div className="header">
                <div className="container">
                    <h1>📱 Viaero Site Walk</h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '40px' }}>
                <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                    <h2 style={{ marginBottom: '8px', textAlign: 'center' }}>Welcome</h2>
                    <p className="text-muted mb-3" style={{ textAlign: 'center' }}>
                        Sync data from SharePoint or upload Excel files manually.
                    </p>

                    {/* AUTOMATED SYNC BUTTON */}
                    <div style={{
                        padding: '20px',
                        marginBottom: '24px',
                        background: 'linear-gradient(135deg, #1565c0 0%, #1976d2 100%)',
                        borderRadius: '12px',
                        textAlign: 'center'
                    }}>
                        <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', marginBottom: '12px' }}>
                            Automatically import sites & photo requirements from SharePoint
                        </p>
                        <button
                            onClick={syncFromSharePoint}
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '14px 24px',
                                fontSize: '16px',
                                fontWeight: '600',
                                backgroundColor: 'white',
                                color: '#1565c0',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.7 : 1
                            }}
                        >
                            {loading && syncStatus ? syncStatus : '📥 Sync from SharePoint'}
                        </button>
                    </div>

                    <div style={{ textAlign: 'center', color: '#999', fontSize: '12px', marginBottom: '16px' }}>
                        — or upload manually —
                    </div>

                    {error && (
                        <div style={{
                            padding: '12px',
                            marginBottom: '16px',
                            backgroundColor: '#ffebee',
                            color: '#c62828',
                            borderRadius: '8px'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Site Tracker Upload */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: '500',
                            fontSize: '14px'
                        }}>
                            1. Site Tracker File
                        </label>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleSiteTrackerUpload}
                            style={{ display: 'none' }}
                            id="site-tracker-upload"
                            disabled={loading}
                        />
                        <label
                            htmlFor="site-tracker-upload"
                            className={`btn ${siteTrackerLoaded ? 'btn-secondary' : 'btn-primary'} ${loading ? 'disabled' : ''}`}
                            style={{
                                display: 'block',
                                cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {siteTrackerLoaded ? (
                                <>✓ {siteTrackerFile.name}</>
                            ) : (
                                <>📂 Upload Site Tracker</>
                            )}
                        </label>
                        <p className="text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                            Expected: Telamon Site Details
                        </p>
                    </div>

                    {/* Photo Requirements Upload */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: '500',
                            fontSize: '14px'
                        }}>
                            2. Photo Requirements File
                        </label>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handlePhotoReqsUpload}
                            style={{ display: 'none' }}
                            id="photo-reqs-upload"
                            disabled={loading}
                        />
                        <label
                            htmlFor="photo-reqs-upload"
                            className={`btn ${photoReqsLoaded ? 'btn-secondary' : 'btn-primary'} ${loading ? 'disabled' : ''}`}
                            style={{
                                display: 'block',
                                cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {photoReqsLoaded ? (
                                <>✓ {photoReqsFile.name}</>
                            ) : (
                                <>📂 Upload Photo Requirements</>
                            )}
                        </label>
                        <p className="text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                            Expected: Telamon Photo Requirements.xlsx
                        </p>
                    </div>

                    {/* Continue Button */}
                    <button
                        onClick={handleContinue}
                        className="btn btn-primary"
                        disabled={loading || !siteTrackerLoaded || !photoReqsLoaded}
                        style={{
                            width: '100%',
                            marginBottom: '12px',
                            opacity: (!siteTrackerLoaded || !photoReqsLoaded) ? 0.5 : 1
                        }}
                    >
                        {loading ? (
                            <>
                                <div className="spinner" style={{ width: '20px', height: '20px', display: 'inline-block', marginRight: '8px' }}></div>
                                Loading...
                            </>
                        ) : (
                            <>Continue →</>
                        )}
                    </button>

                    {/* Demo Data Button */}
                    <button
                        onClick={loadDemoData}
                        className="btn btn-secondary"
                        disabled={loading}
                        style={{ width: '100%' }}
                    >
                        🧪 Load Demo Data (Testing)
                    </button>

                    {/* CLOUD SYNC SECTION */}
                    <div style={{ marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
                        <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>☁️ Cloud Sync Management</h3>
                        <p className="text-muted" style={{ fontSize: '12px', marginBottom: '16px' }}>
                            Move photos from Supabase Buffer to SharePoint. Run this periodically.
                        </p>

                        <button
                            onClick={async () => {
                                if (!window.confirm('Start syncing pending photos to SharePoint? This may take a while.')) return;

                                setLoading(true);
                                try {
                                    const result = await SyncService.syncSupabaseToSharePoint((current, total, filename) => {
                                        setError(`Syncing ${current}/${total}: ${filename}`);
                                    });

                                    alert(`Sync Complete!\n\nSuccess: ${result.success}\nFailed: ${result.failed}`);
                                    setError('');
                                } catch (err) {
                                    setError(`Sync Failed: ${err.message}`);
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            className="btn btn-primary"
                            disabled={loading}
                            style={{
                                width: '100%',
                                backgroundColor: '#2e7d32',
                                borderColor: '#2e7d32'
                            }}
                        >
                            {loading ? 'Syncing...' : '🔄 Sync Pending Photos to SharePoint'}
                        </button>
                    </div>

                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                        <button
                            onClick={async () => {
                                try {
                                    const pending = await SupabaseService.getPendingPhotos();
                                    alert(`Pending Photos: ${pending.length}\n\nThis checks the 'buffer-photos' queue.`);
                                } catch (err) {
                                    alert(`Check failed: ${err.message}`);
                                }
                            }}
                            style={{ background: 'none', border: 'none', color: '#666', textDecoration: 'underline', cursor: 'pointer', fontSize: '12px' }}
                        >
                            Check Queue Status
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}

export default DataLoadScreen;
