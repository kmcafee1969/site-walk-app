// SharePoint and Azure AD Configuration
export const sharepointConfig = {
    // Azure AD App Registration
    auth: {
        clientId: '345d9c49-99fe-4910-a1f9-d567ad6016fc',
        authority: 'https://login.microsoftonline.com/736ca106-146c-4c48-bbd0-ccd4fcff89c1',
        redirectUri: 'https://192.168.1.240:3000',
    },

    // API Scopes
    scopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All', 'User.Read', 'Mail.Send'],

    // Notification settings
    notifications: {
        email: 'kimby@trid3nt.us',
        enabled: true
    },

    // Application Access PIN
    // Loaded from Environment (VITE_APP_PIN)
    accessPin: import.meta.env.VITE_APP_PIN || '2025',

    // Admin users (can reload data from SharePoint)
    adminUsers: ['kimby@trid3nt.us'],

    // SharePoint Site Configuration
    sharepoint: {
        siteUrl: 'https://netorg17734095.sharepoint.com/sites/Trid3ntCOPs',
        documentLibrary: 'Documents', // The actual library name (also known as "Shared Documents")
        folderPath: 'Telamon - Viaero Site Walks', // Folder within the Documents library

        // Master data files (in the Telamon - Viaero Site Walks folder)
        siteDetailsFile: 'Telamon Site Details.xlsx',
        photoRequirementsFile: 'Telamon Photo Requirements.xlsx',

        // Normalize phase names for SharePoint folder structure
        normalizePhase: (phase) => {
            // If it's already in the long format, return it
            if (phase && phase.includes('Telamon Site Walks - ')) return phase;

            // Extract the number/identifier
            const cleanPhase = (phase || '').toUpperCase().replace('PHASE', '').trim();

            // Map known phases
            // Pattern: "Telamon Site Walks - Phase X" (space-dash-space for consistency)
            if (cleanPhase) {
                return `Telamon Site Walks - Phase ${cleanPhase}`;
            }

            return phase; // Fallback
        },

        // Upload paths
        getPhotoPath: (phase, siteName) => {
            const normalizedPhase = sharepointConfig.sharepoint.normalizePhase(phase);
            // Use siteName as provided (case sensitive) or consider implementing a lookup
            return `Telamon - Viaero Site Walks/${normalizedPhase}/${siteName}/PHOTOS`;
        },
        getQuestionnaireFile: (phase, siteName, siteId) => {
            const normalizedPhase = sharepointConfig.sharepoint.normalizePhase(phase);
            return `Telamon - Viaero Site Walks/${normalizedPhase}/${siteName}/Telamon Site Walk Form ${siteName} ${siteId}.xlsx`;
        }
    }
};
