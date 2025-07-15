function ResponseCleanupRegistry() {
    const cleanupCallbacks = new Map();

    this.registerCleanupCallback = (callId, callback) => {
        if (!cleanupCallbacks.has(callId)) {
            cleanupCallbacks.set(callId, []);
        }
        cleanupCallbacks.get(callId).push(callback);
    };

    this.executeCleanupCallbacks = (callId) => {
        if (cleanupCallbacks.has(callId)) {
            const callbacks = cleanupCallbacks.get(callId);
            callbacks.forEach((callback, index) => {
                try {
                    callback();
                } catch (error) {
                    console.error(`Error executing cleanup callback for callId ${callId}:`, error);
                }
            });
            cleanupCallbacks.delete(callId);
        }
    };

    this.removeCleanupCallbacks = (callId) => {
        cleanupCallbacks.delete(callId);
    };

    this.getActiveCallIds = () => {
        return Array.from(cleanupCallbacks.keys());
    };
}

let instance;

module.exports = {
    getInstance: () => {
        if (!instance) {
            instance = new ResponseCleanupRegistry();
        }
        return instance;
    }
}; 