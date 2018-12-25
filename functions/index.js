const functions = require('firebase-functions');
const admin = require('firebase-admin');
const googlePolyline = require('google-polyline');
const axios = require('axios');
const config = require('./config.json');
const xmlParser = require('xml-parser');
const { dialogflow, Permission } = require('actions-on-google');
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config['db']['url']
});

const globals = {
    apiKey: config['cloud-platform']['api-key'],
    nextBusUrl: config['nextbus-api']['root-url'],
    agency: config['nextbus-api']['agency'],
    mapsUrl: config['google-maps-api']['root-url']
};

const app = dialogflow({
    debug: false
});

const parseMinutes = (minutes) => {
    if (minutes === 1) {
        return '1 minute';
    } else {
        return minutes + ' minutes';
    }
};

const getDistance = (x1, y1, x2, y2) => {
    return Math.sqrt(Math.pow(Math.abs(Number.parseFloat(x1) - Number.parseFloat(x2)), 2) + Math.pow(Math.abs(Number.parseFloat(y1) - Number.parseFloat(y2)), 2));
};

const sortStopsByDistance = (a, b) => {
    if (a.distance > b.distance) {
        return 1;
    } else if (a.distance === b.distance) {
        return 0;
    } else {
        return -1;
    }
};

const announcePredictions = (predictionInfo) => {
    let predictionMessage = '';
    if (predictionInfo.children.length > 0) {
        if (predictionInfo.children.length > 1) {
            predictionMessage += ' There are ' + predictionInfo.children.length + ' branches from the route ' + predictionInfo.attributes.routeTag + ' that serve this stop.';
        }
        for (let i = 0; i < predictionInfo.children.length; i++) {
            const predictionsList = predictionInfo.children[i];
            predictionMessage += ' The next buses for the route ' + predictionsList.attributes.title + ' are expected to arrive in ';
            for (let i = 0; i < predictionsList.children.length; i++) {
                const prediction = predictionsList.children[i];
                predictionMessage += parseMinutes(prediction.attributes.minutes);
                if (i === predictionsList.children.length - 2) {
                    predictionMessage += ', and ';
                } else if (i === predictionsList.children.length - 1) {
                    predictionMessage += '.';
                } else {
                    predictionMessage += ', ';
                }
            }
        }
    } else {
        predictionMessage = ' No predictions are currently available for this stop.';
    }
    return predictionMessage;
};

app.intent('Retrieve-Next-Arrival-Time-By-Stop', async (conv) => {
    const stopId = conv.parameters['Stop-ID']['stop-id'];
    const predictionRes = await axios.get(globals.nextBusUrl + '?command=predictions&a=' + globals.agency + '&stopId=' + stopId);
    const parsedPredictionData = xmlParser(predictionRes.data);
    const predictionInfoList = parsedPredictionData['root']['children'];
    console.log(admin.database());
    let newQuery = admin.database().ref('/queries/by-stop').push();
    newQuery.set({
        'time-stamp': Date.now(),
        'stop-id': stopId
    });
    let predictionMessage = '';
    if (predictionInfoList.length > 0) {
        predictionMessage += 'Here are the predictions for ' + predictionInfoList[0].attributes.stopTitle + '. ';
        if (predictionInfoList.length === 0) {
            predictionMessage += ' No predictions are currently available for this stop.';
        } else {
            for (let i = 0; i < predictionInfoList.length; i++) {
                if (predictionInfoList[i].children.length > 0) {
                    if (predictionInfoList[i].children.length === 1) {
                        predictionMessage += ' There is one branch from the route ' + predictionInfoList[i].attributes.routeTag + ' that serves this stop.';
                    }
                    predictionMessage += announcePredictions(predictionInfoList[i]);
                }
            }
        }
    } else {
        predictionMessage += 'That is not a valid stop.';
    }
    conv.close(predictionMessage);
});

app.intent('Retrieve-Next-Arrival-Time-By-Route', async (conv) => {
    const location = conv.user.storage.location;
    const routeBranch = conv.parameters['route-branch'];
    const routeNum = routeBranch['branch-number'];
    const routeLetter = routeBranch['branch-letter'];
    const routeDirection = conv.parameters['route-direction'];
    const routeInfoRes = await axios.get(globals.nextBusUrl + '?command=routeConfig&a=' + globals.agency + '&r=' + routeNum);
    const parsedRouteInfoData = xmlParser(routeInfoRes.data);
    const routeInfo = parsedRouteInfoData['root']['children'][0];
    if (routeInfo.children.length > 0) {
        const allStops = {};
        for (let i = 0; i < routeInfo.children.length; i++) {
            const stopEle = routeInfo.children[i];
            if (stopEle.name === 'stop') {
                let normalizedStopEle = stopEle.attributes;
                normalizedStopEle.distance = getDistance(location[0], location[1], normalizedStopEle.lat, normalizedStopEle.lon);
                allStops[normalizedStopEle.tag] = normalizedStopEle;
            }
        }

        let filteredStopsList = [];
        for (let i = 0; i < routeInfo.children.length; i++) {
            const directionEle = routeInfo.children[i];
            if (directionEle.name === 'direction') {
                if (directionEle.attributes.name.toUpperCase() === routeDirection.toUpperCase() && (!routeLetter || directionEle.attributes.branch.toUpperCase() === (routeNum + routeLetter.toUpperCase()))) {
                    for (let j = 0; j < directionEle.children.length; j++) {
                        const stopEle = directionEle.children[j];
                        if (stopEle.name === 'stop') {
                            filteredStopsList.push(allStops[stopEle.attributes.tag]);
                        }
                    }
                }
            }
        }


        if (filteredStopsList.length > 0) {
            filteredStopsList.sort(sortStopsByDistance);
            const closestStops = filteredStopsList.slice(0, config['google-maps-api']['distance-matrix-batch-size']);
            const stopCoordinates = [];
            for (let i = 0; i < closestStops.length; i++) {
                stopCoordinates.push([closestStops[i].lat, closestStops[i].lon]);
            }
            const encodedLocation = googlePolyline.encode([location]);
            const encodedStops = googlePolyline.encode(stopCoordinates);
            const distanceMatrixRes = await axios.get(globals.mapsUrl + '/distancematrix/json?units=metric&origins=enc:' + encodedLocation + ':&destinations=enc:' + encodedStops + ':&mode=walking&key=' + globals.apiKey);
            const destDistanceMatrix = distanceMatrixRes.data.rows[0].elements;
            let minDistance = Number.MAX_VALUE;
            let minStop;
            for (let i = 0; i < destDistanceMatrix.length; i++) {
                if (destDistanceMatrix[i].status === 'OK') {
                    if (minDistance > destDistanceMatrix[i].distance.value) {
                        minDistance = destDistanceMatrix[i].distance.value;
                        minStop = closestStops[i];
                    }
                }
            }

            let predictionMessage = 'Your closest stop for this route is ' + minStop.title + '.';

            const predictionRes = await axios.get(globals.nextBusUrl + '?command=predictions&a=' + globals.agency + '&r=' + routeNum + '&s=' + minStop.tag);
            const parsedPredictionData = xmlParser(predictionRes.data);
            const predictionInfo = parsedPredictionData['root']['children'][0];
            predictionMessage += announcePredictions(predictionInfo);
            conv.close(predictionMessage);
        } else {
            conv.close('The route you specified could not be found.');
        }
    } else {
        conv.close('The route you specified could not be found.');
    }
});

app.intent('Welcome-Intent', (conv) => {
    if (!conv.user.storage.location) {
        const options = {
            context: "Welcome to Bus Predictor. In order to proceed",
            permissions: ['DEVICE_PRECISE_LOCATION']
        };
        conv.ask(new Permission(options));
    } else {
        conv.ask('Welcome to Bus Predictor. I am using your previously saved location. Waiting for your command...');
    }
});

app.intent('Process-Location', async (conv, params, confirmationGranted) => {
    if (confirmationGranted) {
        const coordinates = conv.device.location.coordinates;
        const res = await axios.get(globals.mapsUrl + '/geocode/json?latlng=' + coordinates.latitude + ',' + coordinates.longitude + '&location_type=ROOFTOP&result_type=street_address&key=' + globals.apiKey);
        resData = res.data;
        if (resData['status'] === 'OK') {
            conv.ask('Your location was detected as ' + resData['results'][0]['formatted_address'] + '. Is this correct or close to your current location?');
        } else {
            conv.close('Your location could not be determined.');
        }
    } else {
        conv.close('Sorry, you denied permission to access your location.');
    }
});

app.intent('Process-Location-Yes', (conv) => {
    conv.user.storage.location = [conv.device.location.coordinates.latitude, conv.device.location.coordinates.longitude];
    conv.ask('Great. Would you like to save your location for the future?');
});

app.intent('Save-Location-Yes', (conv) => {
    conv.user.storage.location = [conv.device.location.coordinates.latitude, conv.device.location.coordinates.longitude];
    conv.ask('Alright. Your location has been saved. To clear you location in the future, just say "clear location". For help, just say "help". Waiting for your command...');
});

app.intent('Clear-Location', (conv) => {
    conv.user.storage.location = null;
    conv.close('Your location has been cleared. Goodbye.');
});

exports.dialogflowHandler = functions.https.onRequest((req, res) => {
    const headers = req.headers;
    if (req.method === 'POST') {
        if (headers.key === config.key) {
            app(req, res);
        } else {
            console.log('Unauthorized access attempted.');
            res.status(401).send("Unauthorized.");
        }
    } else {
        res.send("Bus-Predictor API.");
    }
});