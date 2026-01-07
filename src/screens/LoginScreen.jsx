import React, { useState } from 'react';
import AuthService from '../services/AuthService';

function LoginScreen({ onLoginSuccess }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async () => {
        setLoading(true);
        setError(null);

        try {
            // loginRedirect doesn't return - it redirects the page
            // User will be taken to Microsoft login, then redirected back
            await AuthService.login();
            // This code won't execute - user will be redirected away
        } catch (err) {
            console.error('Login error:', err);
            setError(`Failed to sign in: ${err.message || 'Please try again.'}`);
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
            padding: '20px'
        }}>
            <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '40px',
                maxWidth: '400px',
                width: '100%',
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                textAlign: 'center'
            }}>
                <h1 style={{
                    fontSize: '28px',
                    marginBottom: '12px',
                    color: '#1976d2'
                }}>
                    📱 Viaero Site Walk
                </h1>

                <p style={{
                    color: '#666',
                    marginBottom: '32px',
                    fontSize: '14px'
                }}>
                    Sign in with your Microsoft account to access site data
                </p>

                {error && (
                    <div style={{
                        background: '#ffebee',
                        color: '#c62828',
                        padding: '12px',
                        borderRadius: '6px',
                        marginBottom: '20px',
                        fontSize: '14px'
                    }}>
                        {error}
                    </div>
                )}

                <button
                    onClick={handleLogin}
                    disabled={loading}
                    style={{
                        width: '100%',
                        padding: '14px 24px',
                        background: loading ? '#ccc' : '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        transition: 'background 0.2s'
                    }}
                    onMouseOver={(e) => {
                        if (!loading) e.target.style.background = '#1565c0';
                    }}
                    onMouseOut={(e) => {
                        if (!loading) e.target.style.background = '#1976d2';
                    }}
                >
                    {loading ? (
                        <>
                            <span>Signing in...</span>
                        </>
                    ) : (
                        <>
                            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
                                <rect x="1" y="1" width="9" height="9" fill="white" />
                                <rect x="1" y="11" width="9" height="9" fill="white" />
                                <rect x="11" y="1" width="9" height="9" fill="white" />
                                <rect x="11" y="11" width="9" height="9" fill="white" />
                            </svg>
                            <span>Sign in with Microsoft</span>
                        </>
                    )}
                </button>

                <p style={{
                    marginTop: '24px',
                    fontSize: '12px',
                    color: '#999'
                }}>
                    Your credentials are securely managed by Microsoft
                </p>
            </div>
        </div>
    );
}

export default LoginScreen;
