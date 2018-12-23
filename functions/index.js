const functions = require('firebase-functions');
const axios = require('axios');
const config = require('./config.json');
const xmlParser = require('xml-parser');
const { dialogflow, Permission } = require('actions-on-google');

const globals = {
    apiKey: config['cloud-platform']['api-key'],
    nextBusUrl: config['nextbus-api']['root-url'],
    agency: config['nextbus-api']['agency'],
}

const app = dialogflow({
    debug: false
});

app.intent('Retrieve-Next-Arrival-Time', async (conv) => {
    const routeNum = conv.parameters['route-number'];
    const res = await axios.get(globals.nextBusUrl + '?command=routeConfig&a=' + globals.agency + '&r=' + routeNum);
    const parsedData = xmlParser(res.data);
    const routeInfo = parsedData['root']['children'][0];
    const stops = [];
    for (let i=0; i<routeInfo.children.length; i++) {
        const childEle = routeInfo.children[i];
        if (childEle.name === 'stop') {
            stops.push(childEle);
        }
    }
    console.log(stops);
    conv.ask('Getting for route ' + routeNum);
});

app.intent('Welcome-Intent', (conv) => {
    const options = {
        context: "Welcome to Bus Predictor. In order to proceed",
        permissions: ['DEVICE_PRECISE_LOCATION']
    };
    conv.ask(new Permission(options));
});

app.intent('Process-Location', async (conv, params, confirmationGranted) => {
    if (confirmationGranted) {
        const coordinates = conv.device.location.coordinates;
        const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json?latlng=' + coordinates.latitude + ',' + coordinates.longitude + '&location_type=ROOFTOP&result_type=street_address&key=' + globals.apiKey);
        resData = res.data;
        if (resData['results'].length > 0) {
            conv.ask('Your location was detected as ' + resData['results'][0]['formatted_address'] + '. Is this correct or close to your current location?');
        } else {
            conv.ask('Your location could not be determined.');
        }
    } else {
        conv.ask('Sorry, permission denied.');
    }
});

app.intent('Process-Location-Yes', (conv) => {
    conv.user.storage.location = conv.device.location.coordinates;
    conv.ask('Alright. Your location has been saved.');
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
