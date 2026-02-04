// Photo naming utility
// Format: {SiteName} {SiteID} {PhotoName} {Sequential}_{Timestamp}
// Example: NE-FRANKLIN 435 Overall Compound 1.1_143052
// The timestamp ensures uniqueness even if sequential numbers collide

export function generatePhotoName(siteName, siteId, photoReqName, sequentialNumber, subNumber = 1) {
    const cleanSiteName = siteName.trim();
    const cleanPhotoName = photoReqName.trim();
    const decimal = `${sequentialNumber}.${subNumber}`;

    // Add timestamp suffix (HHMMSS) to ensure uniqueness across sessions
    // This prevents filename collisions when taking additional photos after previous uploads
    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

    return `${cleanSiteName} ${siteId} ${cleanPhotoName} ${decimal}_${timestamp}`;
}

export function parsePhotoName(filename) {
    // Extract components from photo filename
    const match = filename.match(/^(.+?)\s+(\d+)\s+(.+?)\s+(\d+\.\d+)/);

    if (match) {
        return {
            siteName: match[1],
            siteId: match[2],
            photoName: match[3],
            sequential: match[4]
        };
    }

    return null;
}

export function getNextSequentialNumber(existingPhotos, photoReqName) {
    // Find highest sequential number for this photo requirement
    const matching = existingPhotos.filter(p => p.photoReqName === photoReqName);

    if (matching.length === 0) {
        return { sequential: 1, sub: 1 };
    }

    const numbers = matching.map(p => {
        // Match sequential.sub at the end of the filename, optionally followed by extension
        const parts = p.filename.match(/(\d+)\.(\d+)(?:\.[a-zA-Z0-9]+)?$/);
        if (parts) {
            return {
                sequential: parseInt(parts[1]),
                sub: parseInt(parts[2])
            };
        }
        return { sequential: 1, sub: 1 };
    });

    // Sort by sequential then sub
    numbers.sort((a, b) => {
        if (a.sequential !== b.sequential) {
            return a.sequential - b.sequential;
        }
        return a.sub - b.sub;
    });

    // Find the last sequential.sub and increment
    const last = numbers[numbers.length - 1];
    return {
        sequential: last.sequential,
        sub: last.sub + 1
    };
}
