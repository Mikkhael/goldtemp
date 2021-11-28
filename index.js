//@ts-check
require('dotenv').config();
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const {WebSocketServer, WebSocket} = require('ws');

const DEBUG = process.env['DEBUG_MODE'] == '1';

const fs = require('fs');

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

Register As ESP Device:
    - uint8 requrest_type (1)
    - uint32 device_id 

Post New Tmeperatures Request Body Format:
    - uint8  request_type (10)
    - uint32 device_id
    - uint32 thermometers_count
    - uint32 measurements_count
    - uint64 thermometer_ids[thermometers_count]
    - uint64 measurements_timestamps[measurements_count]
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
    
    
Get Logs:
    - uint8 request_type (50)
    [ - uint32 seq (Server <-> ESP) ]
    - uint8 get_only_important (0|1)
Response:
    - uint8 response_type (51)
    [ - uint32 seq (Server <-> ESP) ]
    - uint8 is_only_important (0|1)
    - uint32 device_id
    - char[] data
    
Get Config
    - uint8 request_type 60
    [ - uint32 seq (Server <-> ESP) ]
Response:
    - uint8 response_type 61
    [ - uint32 seq (Server <-> ESP) ]
    - uint32 device_id
    - char[32+32+102+2+8] data
    
Set Config:
    - uint8 request_type 70
    - char[32+32+102+2+8] data

Reboot Network:
    - uint8 request_type 71
    
Save Config:
    - uint8 request_type 72
    
    
Start Sleeping:
    - uint8 request_type 80
    - uint64 duration_ms
    
Set Sleeping Time:
    - uint8 request_type 81
    - uint16 start_minutes
    - uint16 duration_minutes
    
*/

const DEVICE_CONFIG_LEN = 32+32+102+2+8;

class WebSocketSession{
    /**@typedef {WebSocket & {session: WebSocketSession}} WebSocketWithSession */
    constructor(){
        this.device_id = 0;
        this.remote_address = "?";
        this.local_address = "?";
    }
}

const SequenceManager = require('./SequenceManager');
const sequenceManager = new SequenceManager;


/**
 * 
 * @param {WebSocketWithSession} client_ws 
 * @param {Object.<number, WebSocketWithSession>} devices 
 * @param {Buffer} payload 
 * @param {function(Error, WebSocketWithSession):void} next
 */
function forwardMessageWithSeq(client_ws, devices, payload, next){
    for(const device_id in devices){
        const device_ws = devices[device_id];
        sequenceManager.register_new(client_ws, (number) => {
            const buffer = Buffer.allocUnsafe(payload.length + 4);
            payload.copy(buffer, 4);
            buffer.writeUInt8(payload.readUInt8(0), 0);
            buffer.writeUInt32LE(number, 1);
            device_ws.send(buffer, err => {
                next(err, device_ws);
            });
        });
    }
}

/**
 * 
 * @param {WebSocketWithSession} ws 
 * @param {string} name 
 * @param {number} expected_len 
 * @param {Buffer} payload
 */
function handleForwardDefault(ws, name, expected_len, payload){
    if(ws.session.device_id !== 0){
        console.error(`Error: Received ${name} from a device with id ${ws.session.device_id}`);
        return;
    }
    if(payload.length !== expected_len){
        console.error(`Error: invalid ${name} Size: ${payload.length} (expected ${expected_len})` );
        return;
    }
    forwardMessageWithSeq(ws, connected_devices, payload, (err, device_ws) => {
        if(err){
            console.error(`Error while sending ${name}`);
        }else{
            console.log(`Sent ${name} to device with id ${device_ws.session.device_id}`);
        }
    });
}
/**
 * 
 * @param {WebSocketWithSession} ws 
 * @param {string} name 
 * @param {number} expected_len 
 * @param {Buffer} payload
 */
function handleForwardDefaultNoSeq(ws, name, expected_len, payload){
    if(ws.session.device_id !== 0){
        console.error(`Error: Received ${name} from a device with id ${ws.session.device_id}`);
        return;
    }
    if(payload.length !== expected_len){
        console.error(`Error: invalid ${name} Size: ${payload.length} (expected ${expected_len})` );
        return;
    }
    for(const device_id in connected_devices){
        const device_ws = connected_devices[device_id];
        device_ws.send(payload, err => {
            if(err){
                console.error(`Error while sending ${name}`);
            }
        });
    }
}

/**
 * 
 * @param {WebSocketWithSession} device_ws 
 * @param {Buffer} payload 
 * @param {function(Error):void} next
 */
function forwardBackMessageWithSeq(device_ws, payload, next){
    const seq = payload.readUInt32LE(1);
    const client_ws = sequenceManager.release(seq);
    if(!client_ws){
        console.error(`Error: Received Unregistered Seq Number: ${seq}`);
        next(null);
    }
    payload.writeUInt8(payload.readInt8(0), 4);
    client_ws.send(payload.slice(4), err =>{
        next(err);
    });
}

/**
 * 
 * @param {WebSocketWithSession} ws 
 * @param {string} name 
 * @param {number} expected_len 
 * @param {Buffer} payload
 * @param {boolean} leneq
 */
function handleForwardBackDefault(ws, name, expected_len, payload, leneq = true){
    if(ws.session.device_id === 0){
        console.error(`Error: Received ${name} from a non-device`);
        return;
    }
    if(leneq){
        if(payload.length != expected_len){
            console.error(`Error: invalid ${name} Size: ${payload.length} (expected ${expected_len})` );
            return;
        }
    }else{
        if(payload.length < expected_len){
            console.error(`Error: invalid ${name} Size: ${payload.length} (expected >= ${expected_len})` );
            return;
        }
    }
    forwardBackMessageWithSeq(ws, payload, (err) => {
        if(err){
            console.error(`Error while sending ${name}`);
        }
    });
}

/**@type {Object.<number, WebSocketWithSession>} */
const connected_devices = {};

const RequestTypes = {
    RegisterAsDevice: 1,
    PostNewTemperatures: 10,
    GetLastMeasurements: 20,
    SetSampleFrequency: 30,
    GetCurrentTimestamp: 40,
    GetLogsRequest: 50,
    GetLogsResponse: 51,
    GetConfigRequest: 60,
    GetConfigResponse: 61,
    SetConfig: 70,
    RebootNetwork: 71,
    SaveConfig: 72,
    StartSleeping: 80,
    SetSleepingTime: 81,
};
Object.freeze(RequestTypes);

/**
 * @param {WebSocketWithSession} ws
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
        case RequestTypes.RegisterAsDevice: {
            const device_id = data.readUInt32LE(1);
            registerNewDevice(device_id, ws);
            break;
        }
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
        case RequestTypes.GetLogsRequest: {
            handleGetLogsRequest(ws, data);
            break;
        }
        case RequestTypes.GetLogsResponse: {
            handleGetLogsResponse(ws, data);
            break;
        }
        case RequestTypes.GetConfigRequest: {
            handleGetConfigRequest(ws, data);
            break;
        }
        case RequestTypes.GetConfigResponse: {
            handleGetConfigResponse(ws, data);
            break;
        }
        case RequestTypes.SetConfig: {
            handleSetConfig(ws, data);
            break;
        }
        case RequestTypes.RebootNetwork: {
            handleRebootNetwork(ws, data);
            break;
        }
        case RequestTypes.SaveConfig: {
            handleSaveConfig(ws, data);
            break;
        }
        // case RequestTypes.StartSleeping: {
        //     handleStartSleeping(ws, data);
        //     break;
        // }
        case RequestTypes.SetSleepingTime: {
            handleSetSleepingTime(ws, data);
            break;
        }
        default: {
            console.log(`Unrecoqnized payload from ${ws.session.remote_address}`, data);
            break;
        }
    }
}

/**
 * @param {number} device_id 
 * @param {WebSocketWithSession} ws 
 */
function registerNewDevice(device_id, ws){
    ws.session.device_id = device_id;
    connected_devices[device_id] = ws;
}

/**
 * @param {WebSocketWithSession} ws
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
    const expected_request_length = 12 + (thermometers_count + measurements_count) * 8 + (thermometers_count * measurements_count * 2);
    
    if(DEBUG){
        console.log(`Received Post New Temperatures Request 1:`, {
            device_id,
            thermometers_count,
            measurements_count
        });
    }
    
    if(data.length !== expected_request_length){
        invalidPostNewTemperatureRequest(ws, data, `Request of invalid length: ${data.length} (expected ${expected_request_length})`);
        return false;
    }
    
    const thermometers_ids = [];
    const measurements_timestamps = [];
    const measurements = [];
    for(let i=0; i<thermometers_count; i++){
        thermometers_ids.push(data.readBigUInt64LE(12+i*8));
    }
    for(let i=0; i<measurements_count; i++){
        measurements_timestamps.push(data.readBigUInt64LE(12+thermometers_count*8+i*8));
    }
    for(let i=0; i<measurements_count*thermometers_count; i++){
        measurements.push(data.readInt16LE(12+(thermometers_count+measurements_count)*8+i*2));
    }
    const measurements_c = measurements.map(x => raw_to_c(x));
    
    if(DEBUG){   
        console.log(`Received Post New Temperatures Request 2:`, {
            thermometers_ids,
            measurements_timestamps,
            measurements,
            measurements_c
        });
    }
        
    const times = measurements_timestamps.map(x => x === 0n ? new Date() : new Date(Number(x)*1000));
    db.insert_new_measurements(times, thermometers_ids, measurements);
}
function invalidPostNewTemperatureRequest(ws, data, reason){
    console.error(`Invalid Post New Request Temperature Request: `, reason);
}

/**
 * @param {WebSocketWithSession} ws 
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
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload
 */
function handleSetSampleFrequency(ws, payload){
    const newInterval = payload.readBigUInt64LE(1);
    console.log(`Setting sample frequency of ${Object.keys(connected_devices).length} clients to ${newInterval}.`);
    for(let client_id in connected_devices){
        const client = connected_devices[client_id];
        client.send(payload, err => {
            if(err){
                console.error(`Error while sending Set Sample Frequency Request: `, err);
            }
        });
    }
}

/**
 * @param {WebSocketWithSession} ws 
 */
function handleGetCurrentTimestamp(ws){
    const timestamp = BigInt(Date.now())/1000n;
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

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
function handleGetLogsRequest(ws, payload){
    handleForwardDefault(ws, "Get Logs Request", 2, payload);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
 function handleGetLogsResponse(ws, payload){
    handleForwardBackDefault(ws, "Get Logs Response", 10, payload, false);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
 function handleGetConfigRequest(ws, payload){
    handleForwardDefault(ws, "Get Config Request", 1, payload);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
 function handleGetConfigResponse(ws, payload){
    handleForwardBackDefault(ws, "Get Config Response", 1+4+4+DEVICE_CONFIG_LEN, payload);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
function handleSetConfig(ws, payload){
    handleForwardDefaultNoSeq(ws, "Set Config", 1 + DEVICE_CONFIG_LEN, payload);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
function handleRebootNetwork(ws, payload){
    handleForwardDefaultNoSeq(ws, "Reboot Network", 1, payload);
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
function handleSaveConfig(ws, payload){
    handleForwardDefaultNoSeq(ws, "Save Config", 1, payload);
}


/// Sleeping

const SleepingManager = require('./SleepingManager');
const sleepingManager = new SleepingManager();


function refresh_sleeping_config(){
    db.get_sleep_config((err, result) => {
        if(err){
            console.error("Error while getting sleep config from database: ", err);
            return;
        }
        
        if(result.length < 1){
            console.error("No Sleep Config present in the Database");
            result[0] = {};
        }
        
        sleepingManager.set_sleep_time(
            result[0].sleep_start_minutes || 0,
            result[0].sleep_duration_minutes || 0
        );
    });
}

/**
 * @param {WebSocketWithSession} ws 
 * @param {Buffer} payload 
 */
function handleSetSleepingTime(ws, payload){
    if(payload.length != 5){
        console.error(`Error: invalid SetSleepingTimeRequest Size: ${payload.length} (expected 5)` );
        return;
    }
    
    const start_minutes = payload.readUInt16LE(1);
    const duration_minutes = payload.readUInt16LE(3);
    db.set_sleep_config(start_minutes, duration_minutes, function(err){
        sleepingManager.set_sleep_time(start_minutes, duration_minutes);
        console.log(`Set Sleep Time Config to: ${start_minutes}/${duration_minutes}`);
    });
}


/**
 * @param {WebSocketWithSession} ws 
 */
function responsdWithSleepRequestIfNessesary(ws){
    if(!ws.session.device_id){
        return;
    }
    const sleep_duration_ms = sleepingManager.get_remaining_duration_ms();
    if(sleep_duration_ms > 0){
        const buffer = Buffer.allocUnsafe(1+8);
        buffer.writeUInt8(RequestTypes.StartSleeping, 0);
        buffer.writeBigInt64LE(BigInt(sleep_duration_ms), 1);
        ws.send(buffer, err => {
            if(err){
                console.error("Error sending Sleep Request: ", err);
            }else{
                console.log(`Sent Sleep Request to Device with ID ${ws.session.device_id} for ${sleep_duration_ms} ms.`);
            }
        });
    }
}


const wss = new WebSocketServer({server});
wss.on('connection', function(/**@type {WebSocketWithSession} */ws, req) {
    ws.session = new WebSocketSession();
    const socket = req.socket;
    ws.session.local_address = `${socket.localAddress}/${socket.localPort}`;
    ws.session.remote_address = `${socket.remoteAddress}/${socket.remotePort}`;
    console.log(`New WebSocket Connection:`,
                ws.url, ws.session.local_address, ws.session.remote_address);
    ws.on('close', function(number, reason){
        console.log(`WebSocket Connection Closed:`, number , reason);
        if(connected_devices[ws.session.device_id] === ws){
            delete connected_devices[ws.session.device_id];
        }
    });
    ws.on('error', function(err){
        console.error(`WebSocket Error:`, err);
    })
    ws.on('message', function(data, isBinary){
        responsdWithSleepRequestIfNessesary(ws);
        
        if(data.toString() === '/'){ // HeartBeat
            return;
        }
        
        if(DEBUG){
            if(data.toString().length == 0){
                console.log(`Empty Buffer`);
                return;
            }
            console.log('Received Message: ', data, isBinary ? "" : data.toString());
            if(!(data instanceof Buffer)){
                console.log(`Message Data is not a Buffer`, data);
            }
        }
        
        handleMessage(ws, /**@type {Buffer}*/ (data), isBinary);
    });
    ws.on('ping', function(data){
        responsdWithSleepRequestIfNessesary(ws);
    });
});


sleepingManager.set_sleep_time( 21*60 + 41 + new Date().getTimezoneOffset(), 1 );

server.listen(PORT, () => {
    console.log("App listening on port: ", PORT);
    refresh_sleeping_config();
});