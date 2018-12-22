const functions = require('firebase-functions');
const config = require('./config.json');

const {dialogflow, Permission} = require('actions-on-google');

const app = dialogflow({
    debug: true
});

app.intent('Retrieve-Next-Arrival-Time', (conv) => {
    conv.ask('Getting.');
});

app.intent('Welcome-Intent', (conv) => {
    const options = {
        context: "In order to proceed, I need you location.",
        permissions: ['DEVICE_PRECISE_LOCATION']
    };
    conv.ask(new Permission(options));
});

app.intent('Process-Location', (conv, params, confirmationGranted) => {
    if (confirmationGranted) {
        if (conv.data === 'DEVICE_PRECISE_LOCATION') {
            conv.ask('You are at ' + conv.device.location.coordiantes);
        } else {
            conv.ask('Wrong info sent.');
        }
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
