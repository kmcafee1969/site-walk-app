import SharePointService from './SharePointService';
import { sharepointConfig } from '../config/sharepoint.config';

class EmailService {
    /**
     * Send upload completion notification via Proxy
     */
    async sendUploadNotification(siteName, itemType, itemCount, additionalInfo = {}) {
        // Check if notifications are enabled
        if (!sharepointConfig.notifications.enabled) {
            console.log('Email notifications are disabled');
            return;
        }

        try {
            // Build email content
            const timestamp = new Date().toLocaleString();
            let itemsList = '';

            if (itemType === 'photos') {
                itemsList = `- ${itemCount} photo${itemCount > 1 ? 's' : ''}`;
            } else if (itemType === 'questionnaire') {
                itemsList = `- 1 Site Walk Questionnaire`;
            } else if (itemType === 'batch') {
                // For background sync with multiple items
                if (additionalInfo.photos > 0) {
                    itemsList += `- ${additionalInfo.photos} photo${additionalInfo.photos > 1 ? 's' : ''}\n`;
                }
                if (additionalInfo.questionnaires > 0) {
                    itemsList += `- ${additionalInfo.questionnaires} questionnaire${additionalInfo.questionnaires > 1 ? 's' : ''}`;
                }
            }

            const folderPath = additionalInfo.folderPath || `Documents > Telamon - Viaero Site Walks > ${siteName}`;

            const emailBody = `
Your site walk data has been successfully uploaded to SharePoint.

Site: ${siteName}
Items Uploaded:
${itemsList}

Uploaded at: ${timestamp}

Location: ${folderPath}

This is an automated notification from the Site Walk app.
            `.trim();

            const message = {
                message: {
                    subject: `Site Walk Upload Complete: ${siteName}`,
                    body: {
                        contentType: 'Text',
                        content: emailBody
                    },
                    toRecipients: [
                        {
                            emailAddress: {
                                address: sharepointConfig.notifications.email
                            }
                        }
                    ]
                },
                saveToSentItems: false
            };

            // Use the Proxy to send mail
            // NOTE: Client Credentials flow cannot use /me. We must use /users/{id | userPrincipalName}
            // We'll send AS the notification email user (admin)
            const senderEmail = sharepointConfig.notifications.email;
            await SharePointService.proxyRequest(`/users/${senderEmail}/sendMail`, 'POST', message);

            console.log(`✅ Email notification sent to ${sharepointConfig.notifications.email}`);
            return true;
        } catch (error) {
            console.error('Failed to send email notification:', error);
            console.warn('Upload was successful, but email notification failed');
            // Don't throw - we don't want to block the upload flow if email fails
            return false;
        }
    }
}

export default new EmailService();
