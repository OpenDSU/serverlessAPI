function CMBResponseMixin(target) {
    const ResponseMixin = require('./ResponseMixin');
    ResponseMixin(target);
    let onExternalWebhookCallback = null;
    let pollingInterval = null;
    target.externalWebhookId = target._generateId();
    const pollExternalWebhook = () => {
        pollingInterval = setInterval(async () => {
            const response = await fetch(`${target.getExternalWebhookUrl()}/${target.externalWebhookId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'completed') {
                    clearInterval(pollingInterval);
                    onExternalWebhookCallback(data.result);
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