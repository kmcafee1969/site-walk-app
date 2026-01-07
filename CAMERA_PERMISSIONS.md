# Camera Permission Instructions for Laptop

## The Issue
When you click "Open Camera" on your laptop, you're seeing "Unable to access camera. Please check permissions."

This is because your browser needs explicit permission to access the camera.

## How to Fix (Chrome/Edge)

### Option 1: Allow When Prompted
1. Click "📷 Open Camera" button
2. Look for a popup in the address bar asking for camera permission
3. Click "Allow"
4. The camera should now work

### Option 2: Manually Enable in Browser Settings

**For Chrome:**
1. Click the lock icon (🔒) or camera icon in the address bar next to `http://localhost:3000`
2. Find "Camera" in the dropdown
3. Change from "Block" to "Allow"
4. Refresh the page
5. Try "Open Camera" again

**For Edge:**
1. Click the lock icon in the address bar
2. Click "Permissions for this site"
3. Find "Camera" and set to "Allow"
4. Refresh the page
5. Try again

### Option 3: Browser Settings
**Chrome:**
1. Go to `chrome://settings/content/camera`
2. Under "Allowed to use your camera", add `http://localhost:3000`
3. Refresh the app and try again

**Edge:**
1. Go to `edge://settings/content/camera`
2. Under "Allow", add `http://localhost:3000`
3. Refresh and try again

## After Allowing Permission

Once you allow camera access:
- The camera viewfinder will appear
- You can click "📸 Capture" to take photos
- Photos are automatically named (e.g., "NE-FRANKLIN 435 Overall Compound 1.1")
- You can download photos to your device
- Upload them manually to SharePoint

## Alternative: Use Your Phone's Camera

If the laptop camera doesn't work or you prefer:
1. Take photos with your phone's regular camera app
2. Name them manually following the format shown in the app
3. Upload to SharePoint in the correct folder structure
