import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

window.APP_LOADED = true;

// Force check for Service Worker updates immediately on load
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New update available. Force reloading...');
    updateSW(true); // Automatically accept the update
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
