function SlowResponse() {
    const ResponseMixin = require('./mixins/ResponseMixin');
    ResponseMixin(this);
    this.init();

    this.progress = async (progressData) => {
        const endpoint = `${this.webhookUrl}/progress`;
        await this.sendDataToWebhook(endpoint, {
            status: 'pending',
            progress: progressData
        });
    }

    this.end = async (result) => {
        const endpoint = `${this.webhookUrl}/result`;
        await this.sendDataToWebhook(endpoint, {
            status: 'completed',
            result,
        });
    }
}

module.exports = SlowResponse;