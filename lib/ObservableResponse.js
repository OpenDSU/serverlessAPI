function ObservableResponse() {
    this.progress = async (progress) => {
        console.log(progress);
    }

    this.end = async (response) => {
        console.log(response);
    }
}

module.exports = ObservableResponse;