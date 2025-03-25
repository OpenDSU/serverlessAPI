function SlowResponse() {
    const webhookUrl = process.env.WEBHOOK_URL;
    const _generateCallId = () => {
        return require('crypto').randomBytes(32).toString('base64url');
    }
    const callId = _generateCallId();
    const sendDataToWebhook = async (endpoint, data) => {
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ callId, ...data })
        });
        if (!response.ok) {
            throw new Error(`Failed to send data to webhook: ${response.statusText}`);
        }
    }

    const sendProgressToWebhook = async (progress) => {
        const endpoint = `${webhookUrl}/progress`;
        return await sendDataToWebhook(endpoint, {progress});
    }

    const sendResultToWebhook = async (result) => {
        const endpoint = `${webhookUrl}/result`;
        await sendDataToWebhook(endpoint, {result});
    }

    this.progress = async (percent) => {
        await sendProgressToWebhook(percent);
    }

    this.end = async (result) => {
        await sendResultToWebhook(result);
    }

    this.getCallId = () => {
        return callId;
    }
}

module.exports = SlowResponse;