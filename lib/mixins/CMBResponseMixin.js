function CMBResponseMixin(target) {
    const ResponseMixin = require('../ResponseMixin');
    ResponseMixin(target);
    let onExternalWebhookCallback = null;
    let pollingInterval = null;
    
    const pollExternalWebhook = () => {
        pollingInterval = setInterval(async () => {
            const response = await fetch(target.getExternalWebhookUrl());
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'completed') {
                    clearInterval(pollingInterval);
                    onExternalWebhookCallback(data.data);
                }
            }
        }, 1000);
    }

    pollExternalWebhook();

    target.getExternalWebhookUrl = () => {
        return process.env.EXTERNAL_WEBHOOK_URL;
    }

    target.onExternalWebhook = (callback) => {
        onExternalWebhookCallback = callback;
    }
}

module.exports = CMBResponseMixin;