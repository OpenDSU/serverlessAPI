function CMBSlowResponse() {
    const CMBResponseMixin = require('./mixins/CMBResponseMixin');
    CMBResponseMixin(this);

    this.init();

    let isCompleted = false;
    let resourceCleanupCallbacks = [];

    this.progress = async (progressData) => {
        if (isCompleted) {
            if (process.env.WEBHOOK_DEBUG === 'true') {
                console.warn(`CMBSlowResponse with callId ${this.callId} already completed, ignoring progress update`);
            }
            return;
        }
        try {
            const endpoint = `${this.webhookUrl}/progress`;
            await this.sendDataToWebhook(endpoint, {
                status: 'pending',
                progress: progressData
            });
        } catch (error) {
            console.error(`Error sending progress for CMBSlowResponse ${this.callId}:`, error);
            this._handleError(error);
        }
    }

    this.end = async (result) => {
        if (isCompleted) {
            if (process.env.WEBHOOK_DEBUG === 'true') {
                console.warn(`CMBSlowResponse with callId ${this.callId} already completed, ignoring end call`);
            }
            return;
        }
        try {
            isCompleted = true;
            // Mark response as completed to prevent expiry
            this._markCompleted();

            const endpoint = `${this.webhookUrl}/result`;
            await this.sendDataToWebhook(endpoint, {
                status: 'completed',
                result,
            });
            // Clean up resources when completed normally
            this._cleanup();
            // Remove cleanup callbacks from registry since we completed successfully
            this._removeFromCleanupRegistry();
        } catch (error) {
            console.error(`Error sending result for CMBSlowResponse ${this.callId}:`, error);
            this._handleError(error);
        }
    }

    this.addResourceCleanupCallback = (callback) => {
        resourceCleanupCallbacks.push(callback);
    }

    this._cleanup = () => {
        resourceCleanupCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error(`Error executing resource cleanup callback:`, error);
            }
        });
        resourceCleanupCallbacks = [];
    }

    this._removeFromCleanupRegistry = () => {
        try {
            const ResponseCleanupRegistry = require('./ResponseCleanupRegistry').getInstance();
            ResponseCleanupRegistry.removeCleanupCallbacks(this.callId);
        } catch (error) {
            console.error(`Error removing cleanup callbacks from registry:`, error);
        }
    }

    this._markCompleted = () => {
        // Signal to ResponseMixin that this response is completed
        if (typeof this._setCompleted === 'function') {
            this._setCompleted(true);
        }
    }

    this._handleError = (error) => {
        if (!isCompleted) {
            isCompleted = true;
            this._markCompleted();

            // Create a standardized error object
            const responseError = new Error(error.message || 'Unknown error occurred');
            responseError.code = error.code || 'UNKNOWN_ERROR';
            responseError.callId = this.callId;
            responseError.originalError = error;

            // Trigger error callbacks through the mixin
            this._triggerError(responseError);

            // Clean up resources
            this._cleanup();
            this._removeFromCleanupRegistry();
        }
    }

    // Register cleanup callback for expiry
    this.addCleanupCallback(() => {
        if (!isCompleted) {
            console.log(`CMBSlowResponse with callId ${this.callId} expired - cleaning up resources`);
            isCompleted = true;
            this._cleanup();
        }
    });
}

module.exports = CMBSlowResponse; 