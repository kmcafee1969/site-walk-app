/**
 * Local Development Server for API Proxy
 * 
 * This runs the same proxy logic as api/proxy.js but in a local Express server.
 * Only used for development. In production, Vercel handles /api/proxy.
 */

import express from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Environment Config
const config = {
    auth: {
        clientId: process.env.VITE_AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.VITE_AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};

app.post('/api/proxy', async (req, res) => {
    console.log('📡 Proxy request received:', req.body.endpoint);

    // PIN Security Check
    const userPin = req.headers['x-auth-pin'];
    if (userPin !== '2025') {
        return res.status(401).json({ error: 'Unauthorized: Invalid PIN' });
    }

    if (!config.auth.clientSecret) {
        console.error('❌ Missing AZURE_CLIENT_SECRET');
        return res.status(500).json({ error: 'Server Configuration Error: Missing Client Secret' });
    }

    try {
        // Get Access Token (Client Credentials Flow)
        const cca = new ConfidentialClientApplication(config);
        const authResponse = await cca.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default'],
        });

        if (!authResponse || !authResponse.accessToken) {
            throw new Error('Failed to acquire access token');
        }

        // Forward Request to Microsoft Graph
        const { endpoint, method = 'GET', body } = req.body;

        const graphUrl = `https://graph.microsoft.com/v1.0/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
        console.log('🔗 Forwarding to:', graphUrl);

        const fetchOptions = {
            method,
            headers: {
                'Authorization': `Bearer ${authResponse.accessToken}`,
                'Content-Type': 'application/json',
            },
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : body;
        }

        const graphRes = await fetch(graphUrl, fetchOptions);

        // Handle Response
        if (!graphRes.ok) {
            const errorText = await graphRes.text();
            console.error('❌ Graph API Error:', graphRes.status, errorText);
            return res.status(graphRes.status).json({ error: errorText });
        }

        // Check content type to decide how to return
        const contentType = graphRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await graphRes.json();
            console.log('✅ JSON response received');
            return res.status(200).json(data);
        } else {
            // Binary data (Excel files, Images)
            const arrayBuffer = await graphRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            console.log('✅ Binary response received:', buffer.length, 'bytes');
            res.setHeader('Content-Type', contentType || 'application/octet-stream');
            return res.status(200).send(buffer);
        }

    } catch (error) {
        console.error('❌ Proxy Error:', error);
        return res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 Local API Proxy running on http://localhost:${PORT}`);
    console.log(`   Requests to /api/proxy will be handled here.\n`);
});
