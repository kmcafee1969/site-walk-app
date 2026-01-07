import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExcelService } from '../services/ExcelService';
import { StorageService } from '../services/StorageService';

function DataLoadScreen({ onDataLoaded }) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [siteTrackerFile, setSiteTrackerFile] = useState(null);
    const [photoReqsFile, setPhotoReqsFile] = useState(null);
    const [siteTrackerLoaded, setSiteTrackerLoaded] = useState(false);
    const [photoReqsLoaded, setPhotoReqsLoaded] = useState(false);

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
                        Upload both Excel files to get started.
                    </p>

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
                </div>
            </div>
        </div>
    );
}

export default DataLoadScreen;
