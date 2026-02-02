import React, { useState } from 'react';
import PinAuthService from '../services/PinAuthService';

function PinLoginScreen({ onLoginSuccess }) {
    const [username, setUsername] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const result = await PinAuthService.login(username, pin);

            if (result.success) {
                onLoginSuccess(result.user);
            } else {
                setError(result.error || 'Invalid username or PIN.');
                setPin('');
            }
        } catch (err) {
            setError('Login failed. Please try again.');
            setPin('');
        } finally {
            setLoading(false);
        }
    };

    const isFormValid = username.trim().length > 0 && pin.length >= 4;

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
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔐</div>
                <h1 style={{
                    fontSize: '24px',
                    marginBottom: '12px',
                    color: '#1976d2'
                }}>
                    Access RMR COP App
                </h1>

                <p style={{
                    color: '#666',
                    marginBottom: '32px',
                    fontSize: '14px'
                }}>
                    Enter your credentials to continue
                </p>

                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Username"
                        autoFocus
                        autoComplete="username"
                        autoCapitalize="off"
                        style={{
                            width: '100%',
                            padding: '14px 16px',
                            fontSize: '16px',
                            textAlign: 'left',
                            borderRadius: '8px',
                            border: '2px solid #ddd',
                            marginBottom: '12px',
                            boxSizing: 'border-box'
                        }}
                    />

                    <input
                        type="tel"
                        pattern="[0-9]*"
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        placeholder="PIN"
                        maxLength="6"
                        autoComplete="current-password"
                        style={{
                            width: '100%',
                            padding: '14px 16px',
                            fontSize: '20px',
                            textAlign: 'center',
                            borderRadius: '8px',
                            border: '2px solid #ddd',
                            marginBottom: '20px',
                            letterSpacing: '4px',
                            boxSizing: 'border-box'
                        }}
                    />

                    {error && (
                        <div style={{
                            color: '#c62828',
                            marginBottom: '20px',
                            fontSize: '14px',
                            padding: '10px',
                            background: '#ffebee',
                            borderRadius: '6px'
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!isFormValid || loading}
                        style={{
                            width: '100%',
                            padding: '14px 24px',
                            background: isFormValid && !loading ? '#1976d2' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: isFormValid && !loading ? 'pointer' : 'not-allowed',
                        }}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <p style={{
                    marginTop: '24px',
                    fontSize: '12px',
                    color: '#999'
                }}>
                    Contact your administrator if you need access
                </p>
            </div>
        </div>
    );
}

export default PinLoginScreen;
