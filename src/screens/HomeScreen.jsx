import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';

function HomeScreen({ sites, onRefresh, onLogout }) {
    const [filteredSites, setFilteredSites] = useState(sites);
    const [searchTerm, setSearchTerm] = useState('');
    const [siteStatus, setSiteStatus] = useState({});
    const [expandedPhases, setExpandedPhases] = useState({});

    useEffect(() => {
        const calculateStatus = async () => {
            // Calculate completion status for each site
            const status = {};
            try {
                const allPhotos = await StorageService.getAllPhotos();
                const allQuestionnaires = await StorageService.getAllQuestionnaires();
                const photoReqs = await StorageService.getPhotoRequirements();

                sites.forEach(site => {
                    // IndexedDB returns array of photos, filter by siteId
                    const photos = allPhotos.filter(p => p.siteId === site.id);
                    const questionnaire = allQuestionnaires.find(q => q.siteId === site.id);

                    // Count unique photo requirements captured
                    const uniquePhotoReqs = new Set(photos.map(p => p.photoReqId));

                    status[site.id] = {
                        photosComplete: uniquePhotoReqs.size === photoReqs.length,
                        photoCount: uniquePhotoReqs.size,
                        totalPhotoReqs: photoReqs.length,
                        questionnaireComplete: !!questionnaire
                    };
                });
                setSiteStatus(status);
            } catch (error) {
                console.error("Error calculating site status:", error);
            }
        };

        if (sites.length > 0) {
            calculateStatus();
        }
    }, [sites]);

    useEffect(() => {
        // Filter sites based on search term
        if (!searchTerm) {
            setFilteredSites(sites);
        } else {
            // Helper to safely convert to string
            const safeString = (val) => {
                if (val === null || val === undefined) return '';
                if (typeof val === 'object') return JSON.stringify(val);
                return String(val);
            };

            const filtered = sites.filter(site =>
                safeString(site.name).toLowerCase().includes(searchTerm.toLowerCase()) ||
                safeString(site.id).includes(searchTerm) ||
                safeString(site.address).toLowerCase().includes(searchTerm.toLowerCase()) ||
                safeString(site.city).toLowerCase().includes(searchTerm.toLowerCase()) ||
                safeString(site.phase).toLowerCase().includes(searchTerm.toLowerCase())
            );
            setFilteredSites(filtered);
        }
    }, [searchTerm, sites]);

    // Group sites by phase and sort alphabetically within each phase
    const groupedSites = {};
    filteredSites.forEach(site => {
        const phase = site.phase || 'No Phase';
        if (!groupedSites[phase]) {
            groupedSites[phase] = [];
        }
        groupedSites[phase].push(site);
    });

    // Sort sites within each phase alphabetically by name
    Object.keys(groupedSites).forEach(phase => {
        groupedSites[phase].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
    });

    // Sort phases numerically
    const sortedPhases = Object.keys(groupedSites).sort((a, b) => {
        // Extract numbers from phase names (e.g., "Phase 1" -> 1)
        const numA = parseInt(a.match(/\d+/)?.[0] || '999');
        const numB = parseInt(b.match(/\d+/)?.[0] || '999');
        return numA - numB;
    });

    const togglePhase = (phase) => {
        setExpandedPhases(prev => ({
            ...prev,
            [phase]: !prev[phase]
        }));
    };

    return (
        <div className="screen">
            <header
                style={{
                    backgroundColor: '#1976d2',
                    color: 'white',
                    padding: '16px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}
            >
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Site Walks</h1>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={onRefresh}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        aria-label="Refresh Data"
                    >
                        <svg style={{ width: '24px', height: '24px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button
                        onClick={() => {
                            if (window.confirm('Are you sure you want to log out?')) {
                                onLogout();
                            }
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        aria-label="Logout"
                    >
                        <svg style={{ width: '24px', height: '24px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="p-4">
                <div className="mb-4 text-sm text-gray-600">
                    {sites.length} Active Sites
                </div>

                {sites.length === 0 ? (
                    <div className="text-center py-10 text-gray-500">
                        <p className="mb-4">No sites loaded.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="text-blue-600 underline mb-8"
                        >
                            Tap to Retry
                        </button>

                        <div className="mt-8 border-t pt-4 text-left">
                            <details className="text-xs text-gray-500">
                                <summary className="cursor-pointer mb-2 font-bold">Troubleshooting Tools</summary>
                                <button
                                    onClick={async () => {
                                        const log = (msg) => {
                                            const el = document.getElementById('home-logs');
                                            if (el) el.innerHTML += `<div>${new Date().toLocaleTimeString()}: ${msg}</div>`;
                                        };

                                        document.getElementById('home-logs').style.display = 'block';
                                        log("Testing API Connection...");
                                        try {
                                            const res = await fetch('/api/proxy', {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                    'x-auth-pin': '2025'
                                                },
                                                body: JSON.stringify({ endpoint: '/sites/root' })
                                            });
                                            log(`API Status: ${res.status} ${res.statusText}`);

                                            if (res.ok) {
                                                log("SUCCESS: Backend is reachable!");
                                                log("Try tapping 'Tap to Retry' above.");
                                            } else {
                                                log(`FAILED: ${res.status}`);
                                            }
                                        } catch (e) {
                                            log(`Fetch Error: ${e.message}`);
                                        }
                                    }}
                                    className="bg-gray-200 px-3 py-1 rounded text-xs mb-2 border border-gray-300"
                                >
                                    Test Connection
                                </button>
                                <div id="home-logs" className="bg-gray-100 p-2 rounded text-xs h-32 overflow-y-auto font-mono text-black mt-2 hidden"></div>
                            </details>
                        </div>
                    </div>
                ) : (
                    <div>
                        <input
                            type="text"
                            placeholder="🔍 Search sites..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                fontSize: '16px',
                                border: '1px solid #ddd',
                                borderRadius: '8px',
                                marginBottom: '20px',
                                boxSizing: 'border-box'
                            }}
                        />

                        {filteredSites.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
                                <p style={{ fontSize: '18px', marginBottom: '12px' }}>No sites found</p>
                                <p style={{ fontSize: '14px' }}>Try a different search term</p>
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {sortedPhases.map(phase => {
                                    const phaseSites = groupedSites[phase];
                                    const isExpanded = expandedPhases[phase];

                                    return (
                                        <div key={phase} style={{ marginBottom: '16px' }}>
                                            {/* Phase Header */}
                                            <div
                                                onClick={() => togglePhase(phase)}
                                                style={{
                                                    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
                                                    color: 'white',
                                                    padding: '16px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: isExpanded ? '8px' : '0'
                                                }}
                                            >
                                                <div>
                                                    <h3 style={{ margin: 0, fontSize: '18px' }}>{phase}</h3>
                                                    <p style={{ margin: '4px 0 0 0', fontSize: '14px', opacity: 0.9 }}>
                                                        {phaseSites.length} site{phaseSites.length !== 1 ? 's' : ''}
                                                    </p>
                                                </div>
                                                <span style={{ fontSize: '24px', transition: 'transform 0.3s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                                                    ▼
                                                </span>
                                            </div>

                                            {/* Site List */}
                                            {isExpanded && (
                                                <div style={{ paddingLeft: '8px' }}>
                                                    {phaseSites.map(site => {
                                                        const status = siteStatus[site.id] || {};
                                                        const isComplete = status.photosComplete && status.questionnaireComplete;

                                                        return (
                                                            <Link
                                                                key={site.id}
                                                                to={`/site/${site.id}`}
                                                                className="site-card"
                                                                style={{
                                                                    display: 'block',
                                                                    padding: '16px',
                                                                    marginBottom: '12px',
                                                                    background: 'white',
                                                                    borderRadius: '8px',
                                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                                                    textDecoration: 'none',
                                                                    color: 'inherit',
                                                                    border: isComplete ? '2px solid #4caf50' : '1px solid #e0e0e0'
                                                                }}
                                                            >
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                    <div style={{ flex: 1 }}>
                                                                        <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#1976d2' }}>
                                                                            {site.name || 'Unnamed Site'}
                                                                        </h3>
                                                                        <p style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#666' }}>
                                                                            Site ID: {site.id}
                                                                        </p>
                                                                        <p style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#666' }}>
                                                                            📍 {site.address}, {site.city}, {site.state}
                                                                        </p>
                                                                        {site.latitude && site.longitude && (
                                                                            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#999' }}>
                                                                                {site.latitude}, {site.longitude}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                    <div style={{ marginLeft: '12px', textAlign: 'right' }}>
                                                                        {isComplete ? (
                                                                            <span style={{ color: '#4caf50', fontSize: '24px' }}>✓</span>
                                                                        ) : (
                                                                            <div style={{ fontSize: '12px', color: '#999' }}>
                                                                                <div>📷 {status.photoCount || 0}/{status.totalPhotoReqs || 0}</div>
                                                                                <div>📝 {status.questionnaireComplete ? '✓' : '○'}</div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Version Footer */}
            <div style={{
                textAlign: 'center',
                padding: '20px',
                fontSize: '11px',
                color: '#888',
                borderTop: '1px solid #eee',
                marginTop: '20px'
            }}>
                App Version: v2.7.0 | Build: 2026-02-19
            </div>
        </div>
    );
}

export default HomeScreen;
