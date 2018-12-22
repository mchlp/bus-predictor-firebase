const functions = require('firebase-functions');
const config = require('./config.json');

const {dialogflow, Permission} = require('actions-on-google');

const app = dialogflow({
    debug: false
});

app.intent('Retrieve-Next-Arrival-Time', (conv) => {
    conv.ask('Getting.');
});

app.intent('Welcome-Intent', (conv) => {
    const options = {
        context: "In order to proceed",
        permissions: ['DEVICE_PRECISE_LOCATION']
    };
    conv.ask(new Permission(options));
});

app.intent('Process-Location', (conv, params, confirmationGranted) => {
    if (confirmationGranted) {
        const coordinates = conv.device.location.coordinates
        conv.ask('You are at ' + coordinates.longitude + ' and ' + coordinates.latitude);
    } else {
        conv.ask('Sorry, permission denied.');
    }
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
