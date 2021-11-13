//@ts-check
require('dotenv').config();
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const {WebSocketServer, WebSocket} = require('ws');

const PORT = process.env.PORT || 8080;


function raw_to_c(raw){ return raw / 128; }

// MYSQL

const DBManager = require("./DBManager");
const db = new DBManager();
db.connect();

// WEB INTERFACE

app.use('/test',express.static('test'));

app.get('/', (req, res) => {
    const ip = req.ip;
    const hostname = req.hostname;
    res.send(`Hello ${hostname}@${ip}`);
    res.end();
});


// WEBSOCKETS

/*
Post New Tmeperatures Request Body Format:
    - uint8  request_type (10)
    - uint32 device_id
    - uint32 thermometers_count
    - uint32 measurements_count
    - uint64 thermometer_ids[thermometers_count]
    - int16 measurements[measurements_count][thermometers_count]
    
Get Latest Temperatures Request Body Format:
    - uint8 request_type (20)
Response:
    - uint8  request_type (20)
    - uint32 count
    - uint64 timestamps[count]
    - uint64 thermometer_ids[count]
    - int16  measurements[count]
    
Set Sample Frequency:
    - uint8  request_type (30)
    - uint64 sample_interval_ms
    
Get Current Timestamp:
    - uint8  request_type (40)
Response:
    - uint8  request_type (40)
    - uint64 current_timestamp
*/

/**@type {WebSocket[]} */
const connected_clients = [];

const RequestTypes = {
    PostNewTemperatures: 10,
    GetLastMeasurements: 20,
    SetSampleFrequency: 30,
    GetCurrentTimestamp: 40
};
Object.freeze(RequestTypes);

/**
 * @param {WebSocket} ws
 * @param {Buffer} data 
 * @param {Boolean} isBinary 
 */
function handleMessage(ws, data, isBinary){
    const msg = data.toString();
    if(isBinary === false && msg.startsWith("echo")){
        console.log(`Received ECHO: ${msg}`);
        ws.send(msg);
        return;
    }
    const request_type = data.readUInt8(0);
    switch(request_type){
        case RequestTypes.PostNewTemperatures: {
            handlePostNewTemperatures(ws, data.slice(1));
            break;
        }
        case RequestTypes.GetLastMeasurements: {
            handleGetLastMeasurements(ws);
            break;
        }
        case RequestTypes.SetSampleFrequency: {
            handleSetSampleFrequency(ws, data);
            break;
        }
        case RequestTypes.GetCurrentTimestamp: {
            handleGetCurrentTimestamp(ws);
            break;
        }
    }
}

/**
 * @param {WebSocket} ws
 * @param {Buffer} data 
 */
function handlePostNewTemperatures(ws, data){
    if(data.length < 12){
       invalidPostNewTemperatureRequest(ws, data, `Request too short: ${data.length}`);
       return false;
    }
    const device_id = data.readUInt32LE(0);
    const thermometers_count = data.readUInt32LE(4);
    const measurements_count = data.readUInt32LE(8);
    const expected_request_length = 12 + thermometers_count * 8 + thermometers_count * measurements_count * 2;
    
    console.log(`Received Post New Temperatures Request 1:`, {
        device_id,
        thermometers_count,
        measurements_count
    });
    
    if(data.length !== expected_request_length){
        invalidPostNewTemperatureRequest(ws, data, `Request of invalid length: ${data.length} (expected ${expected_request_length})`);
        return false;
    }
    
    const thermometers_ids = [];
    const measurements = [];
    for(let i=0; i<thermometers_count; i++){
        thermometers_ids.push(data.readBigUInt64LE(12+i*8));
    }
    for(let i=0; i<measurements_count*thermometers_count; i++){
        measurements.push(data.readInt16LE(12+thermometers_count*8+i*2));
    }
    const measurements_c = measurements.map(x => raw_to_c(x));
    console.log(`Received Post New Temperatures Request 2:`, {
        thermometers_ids,
        measurements,
        measurements_c
    });
    
    const times = new Array(measurements_count).fill(new Date());
    db.insert_new_measurements(times, thermometers_ids, measurements);
}
function invalidPostNewTemperatureRequest(ws, data, reason){
    console.log(`Invalid Post New Request Temperature Request: `, reason);
}

/**
 * @param {WebSocket} ws 
 */
function handleGetLastMeasurements(ws){
    db.get_last_measurements(function(err, result) {
        if(err){
            return;
        }
        const count = result.length;
        let buffer = Buffer.allocUnsafe(1 + 4 + count * (8+8+2));
        buffer.writeUInt8(RequestTypes.GetLastMeasurements, 0);
        buffer.writeUInt32LE(count, 1);
        for(let i=0; i<count; i++){
            buffer.writeBigInt64LE(BigInt(new Date(result[i].time).getTime()), 5 + i*8);
            buffer.writeBigUInt64LE(BigInt(result[i].id), 5 + (count + i)*8);
            buffer.writeInt16LE(result[i].value, 5 + count*16 + i*2);
        }
        ws.send(buffer);
    });
}

/**
 * @param {WebSocket} ws 
 * @param {Buffer} payload
 */
function handleSetSampleFrequency(ws, payload){
    const newInterval = payload.readBigUInt64LE(1);
    console.log(`Setting sample frequency of ${connected_clients.length} clients to ${newInterval}.`);
    for(let client of connected_clients){
        client.send(payload, err => {
            if(err){
                console.error(`Error while sending Set Sample Frequency Request: `, err);
            }
        });
    }
}

/**
 * @param {WebSocket} ws 
 */
function handleGetCurrentTimestamp(ws){
    const timestamp = BigInt(Date.now());
    const buffer = Buffer.allocUnsafe(9);
    buffer.writeUInt8(RequestTypes.GetCurrentTimestamp, 0);
    buffer.writeBigUInt64LE(timestamp, 1);
    console.log(`Responding with current timestamp of: `, timestamp);
    ws.send(buffer, err => {
        if(err){
            console.error(`Error while sending Get Current Timestamp Resposne: `, err);
        }
    });
}



const wss = new WebSocketServer({server});
wss.on('connection', function(ws, req) {
    console.log(`New WebSocket Connection:`, ws.url);
    const socket = req.socket;
    console.log(`Socket info`, `${socket.localAddress}:${socket.localPort}`, `${socket.remoteAddress}:${socket.remotePort}`);
    ws.on('close', function(number, reason){
        console.log(`WebSocket Connection Closed:`, number , reason);
        const i = connected_clients.indexOf(ws);
        connected_clients.splice(i, i > -1 ? 1 : 0);
    });
    ws.on('error', function(err){
        console.error(`WebSocket Error:`, err);
    })
    ws.on('message', function(data, isBinary){
        if(data.toString() === '/'){ // HeartBeat
            return;
        }
        if(data.toString().length == 0){
            console.log(`Empty Buffer`);
            return;
        }
        console.log('Received Message: ', data, isBinary ? "" : data.toString());
        if(!(data instanceof Buffer)){
            console.log(`Message Data is not a Buffer`, data);
        }
        handleMessage(ws, /**@type {Buffer}*/ (data), isBinary);
    });
    connected_clients.push(ws);
});

server.listen(PORT, () => {
    console.log("App listening on port: ", PORT);
});