function ResponseMixin(target) {
    const ResponseCleanupRegistry = require('../ResponseCleanupRegistry').getInstance();
    let cleanupCallbacks = [];
    let errorCallbacks = [];
    let lastActivityTime = Date.now();
    let expiryTimer = null;
    let isCompleted = false;

    target._generateId = () => {
        return require('crypto').randomBytes(32).toString('base64url');
    }

    target.init = () => {
        target.webhookUrl = process.env.INTERNAL_WEBHOOK_URL;
        target.callId = target._generateId();

        if (!target.webhookUrl) {
            throw new Error('INTERNAL_WEBHOOK_URL environment variable is not set');
        }

        target._startExpiryTimer();

        ResponseCleanupRegistry.registerCleanupCallback(target.callId, () => {
            target._handleExpiry();
        });

        // Establish serverless mapping immediately when response is created
        target._registerServerlessMapping();
    }

    target._registerServerlessMapping = async () => {
        if (process.env.SERVERLESS_ID) {
            try {
                // Register the mapping with the webhook system
                const endpoint = `${target.webhookUrl}/registerMapping`;
                const headers = {
                    'Content-Type': 'application/json',
                    'x-serverless-id': process.env.SERVERLESS_ID
                };

                const response = await fetch(endpoint, {
                    method: 'PUT',
                    headers: headers,
                    body: JSON.stringify({ callId: target.callId, serverlessId: process.env.SERVERLESS_ID })
                });

                if (!response.ok) {
                    console.warn(`Failed to register serverless mapping: ${response.status} ${response.statusText}`);
                }
            } catch (error) {
                console.error(`Error registering serverless mapping for callId ${target.callId}:`, error);
            }
        }
    }

    target._startExpiryTimer = () => {
        const expiryTime = parseInt(process.env.WEBHOOK_EXPIRY_TIME) || 5 * 60 * 1000;

        if (expiryTimer) {
            clearTimeout(expiryTimer);
        }

        expiryTimer = setTimeout(() => {
            if (!isCompleted) {
                console.log(`[PLUGIN EXPIRY] CallId ${target.callId} expired after ${expiryTime / 1000}s of inactivity`);
                target._handleExpiry();
            }
        }, expiryTime);

        lastActivityTime = Date.now();
    }

    target._resetExpiryTimer = () => {
        if (!isCompleted) {
            target._startExpiryTimer();
        }
    }

    target._setCompleted = (completed) => {
        isCompleted = completed;
        if (completed && expiryTimer) {
            console.log(`[PLUGIN EXPIRY] CallId ${target.callId} marked as completed, clearing expiry timer`);
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }
    }

    target.addCleanupCallback = (callback) => {
        cleanupCallbacks.push(callback);
    }

    target.onError = (callback) => {
        errorCallbacks.push(callback);
        return target;
    }

    target._triggerError = (error) => {
        // Execute all registered error callbacks
        errorCallbacks.forEach(callback => {
            try {
                callback(error);
            } catch (err) {
                console.error(`Error executing error callback:`, err);
            }
        });
    }

    target._handleExpiry = () => {
        if (isCompleted) {
            return; // Already completed, ignore
        }

        isCompleted = true;

        if (expiryTimer) {
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }

        const expiryMinutes = Math.floor((parseInt(process.env.WEBHOOK_EXPIRY_TIME) || 5 * 60 * 1000) / 1000 / 60);
        console.log(`Response with callId ${target.callId} expired after ${expiryMinutes} minutes of inactivity`);

        // Create error object for expiry
        const expiryError = new Error(`Request expired: CallId ${target.callId} was inactive for more than ${expiryMinutes} minutes`);
        expiryError.code = 'EXPIRED';
        expiryError.callId = target.callId;
        expiryError.expiryTime = expiryMinutes;

        // Execute all registered error callbacks
        errorCallbacks.forEach((callback, index) => {
            try {
                callback(expiryError);
            } catch (error) {
                console.error(`Error executing error callback:`, error);
            }
        });

        // Execute all registered cleanup callbacks
        cleanupCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error(`Error executing cleanup callback:`, error);
            }
        });
        cleanupCallbacks = [];
        errorCallbacks = [];
    }

    target.sendDataToWebhook = async (endpoint, data) => {
        // Reset expiry timer on activity
        target._resetExpiryTimer();

        const headers = {
            'Content-Type': 'application/json'
        };

        // Include serverlessId header if available for process health tracking
        if (process.env.SERVERLESS_ID) {
            headers['x-serverless-id'] = process.env.SERVERLESS_ID;
        }

        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ callId: target.callId, ...data })
        });

        if (!response.ok) {
            throw new Error(`Failed to send data to webhook: ${response.statusText}`);
        }
    }

    target.getCallId = () => {
        return target.callId;
    }

    return target;
}

module.exports = ResponseMixin; 