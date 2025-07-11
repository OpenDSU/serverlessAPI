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
        console.log(`[RESPONSE DEBUG] Registered error callback for callId: ${target.callId.substring(0, 8)}... (total: ${errorCallbacks.length})`);
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
        console.log(`[RESPONSE DEBUG] Executing ${errorCallbacks.length} error callbacks for callId: ${target.callId.substring(0, 8)}...`);
        errorCallbacks.forEach((callback, index) => {
            try {
                console.log(`[RESPONSE DEBUG] Calling error callback ${index + 1}/${errorCallbacks.length}`);
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

        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
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