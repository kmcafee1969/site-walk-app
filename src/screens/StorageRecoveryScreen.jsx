import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { StorageService } from '../services/StorageService';
import { SyncService } from '../services/SyncService';

export default function StorageRecoveryScreen() {
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [sites, setSites] = useState([]);
    const [status, setStatus] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const allPhotos = await StorageService.getAllPhotos();
            const allSites = await StorageService.getSites();
            setPhotos(allPhotos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
            setSites(allSites);
        } catch (err) {
            console.error(err);
            setStatus('Error loading storage: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleForceSync = async () => {
        if (syncing) return;
        setSyncing(true);
        setStatus('Processing sync queue...');
        try {
            const count = await SyncService.processQueue();
            setStatus(`Sync complete. Successfully processed ${count} items.`);
            await loadData();
        } catch (err) {
            setStatus('Sync failed: ' + err.message);
        } finally {
            setSyncing(false);
        }
    };

    const handleExport = async () => {
        try {
            setStatus('Exporting data...');
            const data = await StorageService.exportAllData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `site-walk-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setStatus('Export complete. File downloaded.');
        } catch (err) {
            setStatus('Export failed: ' + err.message);
        }
    };

    const getSiteName = (siteId) => {
        const site = sites.find(s => s.id === siteId);
        return site ? site.name : `Unknown (${siteId})`;
    };

    const pendingCount = photos.filter(p => p.status === 'pending').length;

    return (
        <div className="screen" style={{ padding: '20px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <Link to="/" style={{ marginRight: '16px', textDecoration: 'none', fontSize: '24px' }}>←</Link>
                <h1 style={{ margin: 0, fontSize: '20px' }}>Storage Diagnostics</h1>
            </div>

            <div style={{ background: 'white', padding: '16px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h2 style={{ fontSize: '16px', margin: '0 0 8px 0' }}>Overview</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div style={{ padding: '12px', background: '#e3f2fd', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1976d2' }}>{photos.length}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>Total Photos</div>
                    </div>
                    <div style={{ padding: '12px', background: pendingCount > 0 ? '#fff3e0' : '#e8f5e9', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: pendingCount > 0 ? '#ef6c00' : '#2e7d32' }}>{pendingCount}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>Pending Sync</div>
                    </div>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                    <button 
                        onClick={handleForceSync} 
                        disabled={syncing}
                        style={{ 
                            flex: 1, 
                            padding: '12px', 
                            backgroundColor: '#1976d2', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '6px',
                            fontWeight: '600'
                        }}
                    >
                        {syncing ? 'Syncing...' : 'Force Sync Now'}
                    </button>
                    <button 
                        onClick={handleExport}
                        style={{ 
                            flex: 1, 
                            padding: '12px', 
                            backgroundColor: '#4caf50', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '6px',
                            fontWeight: '600'
                        }}
                    >
                        Export Backup
                    </button>
                </div>
                {status && (
                    <div style={{ marginTop: '12px', padding: '10px', background: '#eee', borderRadius: '4px', fontSize: '13px', color: '#333' }}>
                        {status}
                    </div>
                )}
            </div>

            <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Photo Log (Recent First)</h3>
            {loading ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>Loading storage...</div>
            ) : photos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', color: '#999' }}>
                    No photos found in browser storage.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {photos.map(photo => (
                        <div key={photo.id} style={{ 
                            background: 'white', 
                            padding: '12px', 
                            borderRadius: '8px', 
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            borderLeft: photo.status === 'pending' ? '4px solid #ef6c00' : '4px solid #4caf50'
                        }}>
                            {photo.dataUrl && (
                                <img 
                                    src={photo.dataUrl} 
                                    style={{ width: '50px', height: '50px', borderRadius: '4px', objectFit: 'cover', marginRight: '12px' }} 
                                    alt="preview"
                                />
                            )}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{photo.photoReqName}</div>
                                <div style={{ fontSize: '12px', color: '#666' }}>{getSiteName(photo.siteId)}</div>
                                <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                                    {new Date(photo.timestamp).toLocaleString()}
                                </div>
                            </div>
                            <div style={{ 
                                padding: '4px 8px', 
                                borderRadius: '4px', 
                                fontSize: '10px', 
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                color: 'white',
                                backgroundColor: photo.status === 'pending' ? '#ef6c00' : '#4caf50'
                            }}>
                                {photo.status}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ marginTop: '30px', padding: '15px', background: '#fff9c4', borderRadius: '8px', border: '1px solid #fbc02d', color: '#574200' }}>
                <h4 style={{ margin: '0 0 5px 0', fontSize: '14px' }}>💡 Storage Tips</h4>
                <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.4' }}>
                    <strong>iOS Warning:</strong> If you delete the app icon from your home screen, <strong>all photos listed here will be lost</strong>. 
                    If the app won't load from the home screen, try force-closing it (swipe up) and restarting your phone first.
                </p>
            </div>
        </div>
    );
}
