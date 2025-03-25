const ResponseMixin = require('./ResponseMixin');

function ObservableResponse() {
    ResponseMixin(this);
    this.init();

    this.progress = async (intermediateResultObject) => {
        const endpoint = `${this.webhookUrl}/progress`;
        await this.sendDataToWebhook(endpoint, {
            status: 'pending',
            progress: intermediateResultObject
        });
    }

    this.end = async () => {
        const endpoint = `${this.webhookUrl}/result`;
        await this.sendDataToWebhook(endpoint, {
            status: 'completed'
        });
    }
}

module.exports = ObservableResponse;