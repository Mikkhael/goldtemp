//@ts-check
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const {WebSocketServer, WebSocket} = require('ws');
const mysql = require('mysql2');

const PORT = process.env.PORT || 8080;

// MYSQL

const DB_CRED = require('./db_credentials');
const connection_params = {
    database: DB_CRED.NAME,
    port: +DB_CRED.PORT,
    host: DB_CRED.ADDR,
    user: DB_CRED.USER,
    supportBigNumbers: true,
};
if(DB_CRED.PASS){
    connection_params.password = DB_CRED.PASS;
}
const connection = mysql.createConnection(connection_params);

/**
 * 
 * @param {string[]} times 
 * @param {BigInt[]} thermometers_ids 
 * @param {number[]} values 
 */
function insert_new_measures(times, thermometers_ids, values){
    const NO_VALUE = -200
    let query = `INSERT INTO measures (time, thermometer_id, value) VALUES `;
    for(let time_i=0; time_i<times.length; time_i++){
        const time = times[time_i];
        for (let i = 0; i < thermometers_ids.length; i++) {
            const thermometer_id = thermometers_ids[i];
            const value = values[time_i*times.length + i];
            if(value === NO_VALUE){
                continue;
            }
            query += `('${time}',${thermometer_id},${value}),`;
        }
    }
    query = query.slice(0,-1);
    connection.query(query,function(err){
        if(err){
            console.error("Error while perofming insert query: ", err);
            return;
        }
        console.log("Insert executed");
    });
}

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
    - uint32 measures_count
    - uint64 thermometer_ids[thermometers_count]
    - int16 measures[measures_count][thermometers_count]
*/

const RequestTypes = {
    PostNewTemperatures: 10
};
Object.freeze(RequestTypes);

/**
 * @param {WebSocket} ws
 * @param {Buffer} data 
 * @param {Boolean} isBinary 
 */
function handleMessage(ws, data, isBinary){
    const request_type = data.readUInt8(0);
    switch(request_type){
        case RequestTypes.PostNewTemperatures: {
            handlePostNewTemperatures(ws, data.slice(1));
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
    const measures_count = data.readUInt32LE(8);
    const expected_request_length = 12 + thermometers_count * 8 + thermometers_count * measures_count * 2;
    
    console.log(`Received Post New Temperatures Request 1:`, {
        device_id,
        thermometers_count,
        measures_count
    });
    
    if(data.length !== expected_request_length){
        invalidPostNewTemperatureRequest(ws, data, `Request of invalid length: ${data.length} (expected ${expected_request_length})`);
        return false;
    }
    
    const thermometers_ids = [];
    const measures = [];
    for(let i=0; i<thermometers_count; i++){
        thermometers_ids.push(data.readBigUInt64LE(12+i*8));
    }
    for(let i=0; i<measures_count*thermometers_count; i++){
        measures.push(data.readInt16LE(12+thermometers_count*8+i*2));
    }
    console.log(`Received Post New Temperatures Request 2:`, {
        thermometers_ids,
        measures
    });
    
    console.log('Inserting into databse');
    const times = new Array(measures_count).fill(new Date().toISOString());
    insert_new_measures(times, thermometers_ids, measures);
}
function invalidPostNewTemperatureRequest(ws, data, reason){
    console.log(`Invalid Post New Request Temperature Request: `, reason);
}

const wss = new WebSocketServer({server});
wss.on('connection', function(ws, req) {
    console.log(`New WebSocket Connection:`, ws.url);
    const socket = req.socket;
    console.log(`Socket info`, `${socket.localAddress}:${socket.localPort}`, `${socket.remoteAddress}:${socket.remotePort}`);
    ws.on('close', function(number, reason){
        console.log(`WebSocket Connection Closed:`, number , reason);
    });
    ws.on('error', function(err){
        console.error(`WebSocket Error:`, err);
    })
    ws.on('message', function(data, isBinary){
        if(data.toString() === '/'){ // HeartBeat
            return;
        }
        console.log('Received Message: ', data, isBinary ? "" : data.toString());
        if(!(data instanceof Buffer)){
            console.log(`Message Data is not a Buffer`, data);
        }
        handleMessage(ws, /**@type {Buffer}*/ (data), isBinary);
    });
});

server.listen(PORT, () => {
    console.log("App listening on port: ", PORT);
});