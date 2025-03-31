function ResponseMixin(target) {
    target._generateId = () => {
        return require('crypto').randomBytes(32).toString('base64url');
    }

    target.init = () => {
        target.webhookUrl = process.env.INTERNAL_WEBHOOK_URL;
        target.callId = target._generateId();

        if (!target.webhookUrl) {
            throw new Error('INTERNAL_WEBHOOK_URL environment variable is not set');
        }
    }
    
    target.sendDataToWebhook = async (endpoint, data) => {
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