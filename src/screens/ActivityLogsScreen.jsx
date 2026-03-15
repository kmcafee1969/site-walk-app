import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

function ActivityLogsScreen() {
    const navigate = useNavigate();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('ALL');

    useEffect(() => {
        fetchLogs();
        
        // Setup real-time subscription
        if (!supabase) return;
        
        const subscription = supabase
            .channel('public:activity_logs')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, payload => {
                setLogs(current => [payload.new, ...current].slice(0, 500)); // Keep last 500 logs
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, []);

    const fetchLogs = async () => {
        if (!supabase) {
            setError('Database connection not configured.');
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(500);

            if (error) {
                if (error.code === '42P01') {
                     throw new Error('Supabase table `activity_logs` has not been created yet. Please execute the SQL script in your Supabase Dashboard.');
                }
                throw error;
            }

            setLogs(data || []);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch activity logs:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const filteredLogs = logs.filter(log => {
        if (filter === 'ALL') return true;
        if (filter === 'ERRORS') return log.action.includes('ERROR') || log.action.includes('FAILED');
        if (filter === 'SYNC') return log.action.includes('SYNC');
        if (filter === 'PHOTOS') return log.action.includes('PHOTO');
        if (filter === 'LOGINS') return log.action.includes('LOGIN');
        return true;
    });

    const getActionColor = (action) => {
        if (action.includes('SUCCESS') || action === 'COMPLETED_ALL') return '#4caf50'; // Green
        if (action.includes('FAILED') || action.includes('ERROR')) return '#f44336'; // Red
        if (action.includes('STARTED')) return '#2196f3'; // Blue
        if (action.includes('LOGIN')) return '#ff9800'; // Orange
        return '#757575'; // Grey
    };

    return (
        <div className="screen" style={{ backgroundColor: '#f5f5f5', minHeight: '100vh', paddingBottom: '20px' }}>
            <header style={{
                backgroundColor: '#1976d2',
                color: 'white',
                padding: '16px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                <button 
                    onClick={() => navigate(-1)} 
                    style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}
                >
                    ←
                </button>
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Activity & Error Logs</h1>
            </header>

            <div style={{ padding: '20px' }}>
                {error && (
                    <div style={{ padding: '15px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ef9a9a' }}>
                        <strong>⚠️ Log System Error:</strong><br/>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '15px' }}>
                    {['ALL', 'ERRORS', 'SYNC', 'PHOTOS', 'LOGINS'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: filter === f ? '#1976d2' : 'white',
                                color: filter === f ? 'white' : '#666',
                                border: '1px solid #ddd',
                                borderRadius: '20px',
                                fontWeight: filter === f ? 'bold' : 'normal',
                                whiteSpace: 'nowrap',
                                cursor: 'pointer'
                            }}
                        >
                            {f === 'ALL' ? 'All Activity' : f}
                        </button>
                    ))}
                    <button 
                        onClick={fetchLogs}
                        style={{ padding: '8px 16px', backgroundColor: '#e0e0e0', color: '#333', border: 'none', borderRadius: '20px', cursor: 'pointer', marginLeft: 'auto' }}
                    >
                        🔄 Refresh
                    </button>
                </div>

                <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    {loading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Loading logs...</div>
                    ) : filteredLogs.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>No logs found for this filter.</div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #eee', textAlign: 'left' }}>
                                        <th style={{ padding: '12px 16px', color: '#666' }}>Time</th>
                                        <th style={{ padding: '12px 16px', color: '#666' }}>User</th>
                                        <th style={{ padding: '12px 16px', color: '#666' }}>Action</th>
                                        <th style={{ padding: '12px 16px', color: '#666' }}>Details</th>
                                        <th style={{ padding: '12px 16px', color: '#666' }}>Version</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLogs.map(log => {
                                        const date = new Date(log.created_at);
                                        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                        
                                        return (
                                            <tr key={log.id} style={{ borderBottom: '1px solid #eee', backgroundColor: log.action.includes('ERROR') ? '#fff5f5' : 'white' }}>
                                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                                    <div style={{ fontWeight: '500' }}>{timeStr}</div>
                                                    <div style={{ fontSize: '12px', color: '#999' }}>{dateStr}</div>
                                                </td>
                                                <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                                                    <div style={{ fontWeight: 'bold', color: '#333' }}>{log.display_name}</div>
                                                    <div style={{ fontSize: '12px', color: '#999' }}>@{log.username}</div>
                                                </td>
                                                <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                                                    <span style={{ 
                                                        backgroundColor: getActionColor(log.action) + '20', 
                                                        color: getActionColor(log.action),
                                                        padding: '4px 8px', 
                                                        borderRadius: '4px',
                                                        fontWeight: 'bold',
                                                        fontSize: '12px'
                                                    }}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px 16px', maxWidth: '300px', verticalAlign: 'top' }}>
                                                    <div style={{ 
                                                        fontSize: '13px', 
                                                        color: '#555',
                                                        wordBreak: 'break-word',
                                                        fontFamily: log.details && log.details.startsWith('{') ? 'monospace' : 'inherit'
                                                    }}>
                                                        {log.details || '-'}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '12px 16px', color: '#999', fontSize: '12px', verticalAlign: 'top' }}>
                                                    {log.app_version}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ActivityLogsScreen;
