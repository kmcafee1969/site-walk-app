import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

window.APP_LOADED = true;

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
