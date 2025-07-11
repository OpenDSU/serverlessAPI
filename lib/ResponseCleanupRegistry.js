function ResponseCleanupRegistry() {
    const cleanupCallbacks = new Map();

    this.registerCleanupCallback = (callId, callback) => {
        if (!cleanupCallbacks.has(callId)) {
            cleanupCallbacks.set(callId, []);
        }
        cleanupCallbacks.get(callId).push(callback);
        console.log(`[CLEANUP REGISTRY] Registered cleanup callback for callId: ${callId.substring(0, 16)}... (total: ${cleanupCallbacks.get(callId).length})`);
    };

    this.executeCleanupCallbacks = (callId) => {
        console.log(`[CLEANUP REGISTRY] Executing cleanup callbacks for callId: ${callId.substring(0, 16)}...`);
        console.log(`[CLEANUP REGISTRY] Registry has ${cleanupCallbacks.size} total entries`);
        if (cleanupCallbacks.has(callId)) {
            const callbacks = cleanupCallbacks.get(callId);
            console.log(`[CLEANUP REGISTRY] Found ${callbacks.length} callbacks for callId: ${callId.substring(0, 16)}...`);
            callbacks.forEach((callback, index) => {
                try {
                    console.log(`[CLEANUP REGISTRY] Executing callback ${index + 1}/${callbacks.length}`);
                    callback();
                } catch (error) {
                    console.error(`Error executing cleanup callback for callId ${callId}:`, error);
                }
            });
            cleanupCallbacks.delete(callId);
        } else {
            console.log(`[CLEANUP REGISTRY] No callbacks found for callId: ${callId.substring(0, 16)}...`);
            // Debug: show all registered callIds
            const registeredCallIds = Array.from(cleanupCallbacks.keys());
            console.log(`[CLEANUP REGISTRY] Currently registered callIds (${registeredCallIds.length}):`,
                registeredCallIds.map(id => id.substring(0, 16) + '...'));
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