const functions = require('firebase-functions');
const config = require('./config.json');

const {dialogflow} = require('actions-on-google');

const app = dialogflow({
    debug: true
});

app.intent('Retrieve-Next-Arrival-Time', (conv) => {
    conv.ask('Getting.');
});

exports.dialogflowHandler = functions.https.onRequest(app);

exports.api = functions.https.onRequest((req, res) => {
    if (req.method === 'POST') {
        const body = req.body;
        const headers = req.headers;
        if (headers.key === config.key) {
            res.send('Authorized');
        } else {
	        res.status(401).send("Unauthorized.");
        }
    }
	res.send("Bus-Predictor API.");
});
