import { ConfidentialClientApplication } from '@azure/msal-node';

export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-auth-pin'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Verify PIN
    // Allow either the Environment Variable PIN OR the default '2025' to prevent lockout
    const envPin = (process.env.APP_PIN || '').trim();
    const hardcodedPin = '2025';
    const userPin = (req.headers['x-auth-pin'] || '').trim();

    console.log(`PIN Check: Received='${userPin}'`);

    if (userPin !== hardcodedPin && (envPin === '' || userPin !== envPin)) {
        return res.status(401).json({ error: `Unauthorized: Invalid PIN. Received: '${userPin}'` });
    }

    // 3. Environment Config
    const config = {
        auth: {
            clientId: process.env.VITE_AZURE_CLIENT_ID,
            authority: `https://login.microsoftonline.com/${process.env.VITE_AZURE_TENANT_ID}`,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
        }
    };

    if (!config.auth.clientSecret) {
        return res.status(500).json({ error: 'Server Configuration Error: Missing Client Secret' });
    }

    try {
        // 4. Get Access Token (Client Credentials Flow)
        const cca = new ConfidentialClientApplication(config);
        const authResponse = await cca.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default'],
        });

        if (!authResponse || !authResponse.accessToken) {
            throw new Error('Failed to acquire access token');
        }

        // 5. Forward Request to Microsoft Graph
        const { endpoint, method = 'GET', body } = req.body;

        // Construct full URL (ignoring leading slash if present)
        const graphUrl = `https://graph.microsoft.com/v1.0/${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;

        const fetchOptions = {
            method,
            headers: {
                'Authorization': `Bearer ${authResponse.accessToken}`,
                'Content-Type': 'application/json',
            },
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            // Check if body is binary (for uploads)
            // For this simple proxy, we'll assume JSON for metadata calls. 
            // Binary uploads might need special handling (Buffer), but let's start with JSON support.
            // Actually, for file uploads, we might pass the 'content' in body? 
            // OR receiving a stream? 
            // Simplification: For now, let's handle JSON requests. 
            // If we need to upload files, we might need a dedicated `upload.js` or handle base64.
            // Let's assume sending JSON for now, as that covers listing files and downloading (GET).
            // Uploading files via JSON body is bad for large files.

            // Wait, for DOWNLOADS (GET), we need to return binary.
            // For UPLOADS (PUT), we need to accept binary.

            fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : body;
        }

        const graphRes = await fetch(graphUrl, fetchOptions);

        // 6. Handle Response
        if (!graphRes.ok) {
            const errorText = await graphRes.text();
            return res.status(graphRes.status).json({ error: errorText });
        }

        // Check content type to decide how to return
        const contentType = graphRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await graphRes.json();
            return res.status(200).json(data);
        } else {
            // Binary data (Excel files, Images)
            const arrayBuffer = await graphRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            res.setHeader('Content-Type', contentType || 'application/octet-stream');
            return res.status(200).send(buffer);
        }

    } catch (error) {
        console.error('Proxy Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
