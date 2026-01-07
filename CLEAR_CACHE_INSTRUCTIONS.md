# Clear Your Phone's Browser Cache

To fix the blank screen issue on your phone, you need to clear the browser cache so it loads the updated code.

## For iPhone (Safari):

1. **Close the browser tab** completely (swipe it away)
2. **Open Safari Settings**:
   - Go to Settings app
   - Scroll down to Safari
   - Tap "Clear History and Website Data"
   - Confirm
3. **Reopen Safari** and type: `http://192.168.1.240:3000`

## For Android (Chrome):

1. **Close the browser tab** completely
2. **Clear cache**:
   - Open Chrome
   - Tap the three dots menu (⋮)
   - Go to Settings → Privacy → Clear browsing data
   - Select "Cached images and files" (uncheck other options)
   - Tap "Clear data"
3. **Reopen Chrome** and type: `http://192.168.1.240:3000`

## Alternative: Force Refresh

Instead of clearing all cache, try a **hard refresh**:

### iPhone Safari:
1. Open the page: `http://192.168.1.240:3000`
2. Tap the refresh button in the address bar
3. If still blank, close tab and reopen

### Android Chrome:
1. Open the page: `http://192.168.1.240:3000`
2. Pull down from the top of the page to refresh
3. If still blank, close tab and reopen

## What to Expect After Clearing Cache:

- The app should load and show the "Upload Excel File" screen
- If there's an error, you'll now see an error message instead of a blank screen
- The error message will tell us what's wrong

## If Still Blank:

Try this URL with a cache-busting parameter:
```
http://192.168.1.240:3000/?v=2
```

This forces the browser to reload everything fresh.
