import React, { useState } from 'react';
import PinAuthService from '../services/PinAuthService';

function PinLoginScreen({ onLoginSuccess }) {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(null);

    const handleSubmit = (e) => {
        e.preventDefault();
        setError(null);

        if (PinAuthService.login(pin)) {
            onLoginSuccess();
        } else {
            setError('Incorrect PIN. Please try again.');
            setPin('');
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
                    Enter the access PIN to continue
                </p>

                <form onSubmit={handleSubmit}>
                    <input
                        type="tel"
                        pattern="[0-9]*"
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        placeholder="Enter PIN"
                        maxLength="6"
                        autoFocus
                        style={{
                            width: '100%',
                            padding: '16px',
                            fontSize: '24px',
                            textAlign: 'center',
                            borderRadius: '8px',
                            border: '2px solid #ddd',
                            marginBottom: '20px',
                            letterSpacing: '4px'
                        }}
                    />

                    {error && (
                        <div style={{
                            color: '#c62828',
                            marginBottom: '20px',
                            fontSize: '14px'
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={pin.length < 4}
                        style={{
                            width: '100%',
                            padding: '14px 24px',
                            background: pin.length >= 4 ? '#1976d2' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
                        }}
                    >
                        Enter App
                    </button>
                </form>
            </div>
        </div>
    );
}

export default PinLoginScreen;
