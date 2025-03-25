function ResponseMixin(target) {
    const _generateCallId = () => {
        return require('crypto').randomBytes(32).toString('base64url');
    }

    target.init = () => {
        target.webhookUrl = process.env.WEBHOOK_URL;
        target.callId = _generateCallId();

        if (!target.webhookUrl) {
            throw new Error('WEBHOOK_URL environment variable is not set');
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