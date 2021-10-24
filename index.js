//@ts-check
require('dotenv').config();
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const {WebSocketServer, WebSocket} = require('ws');
const mysql = require('mysql2');

const PORT = process.env.PORT || 8080;

// MYSQL

const DB_CRED = require('./db_credentials');
class DBManager{
    constructor(){
        this.default_connection_params = {
            database: DB_CRED.NAME,
            port: +DB_CRED.PORT,
            host: DB_CRED.ADDR,
            user: DB_CRED.USER,
            supportBigNumbers: true,
        };
        
        if(DB_CRED.PASS){
            this.default_connection_params.password = DB_CRED.PASS;
        }
        this.connection = null;
        this.last_connection_params = Object.assign({}, this.default_connection_params);
    }
    connect(connection_params = {}, next = function(err){}){
        this.last_connection_params = Object.assign({}, this.default_connection_params, connection_params);
        this.#_connect_impl(next);
    }
    #_connect_impl(next = function(err){}){
        this.connection = mysql.createConnection(this.last_connection_params);
        this.connection.connect(function (err){
            if(err){
                console.error('Error while connecting to MySQL server: ', err);
            }
            next(err);
        });
    }
    reconnect(next = function(err){}){
        if(!this.is_connected()){
            this.#_connect_impl(next);
        }
    }
    is_connected(){
        return this.connection && this.connection.authorized && this.connection;
    }
    
    #_reconnect_if_nessesary(next_error, next_good){
        if(!this.is_connected()){
            console.log("Connection disconnected. Reconnecting...");
            this.reconnect(function(err){
                if(err){
                    next_error(err);
                    return;
                }
                next_good();
            });
            return;
        }
    }
    
    /**
     * 
     * @param {string} query 
     * @param {function(mysql.QueryError, mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.OkPacket | mysql.OkPacket[] | mysql.ResultSetHeader, mysql.FieldPacket[]) : void} callback 
     */
    query_with_reconnect(query, callback = function(err, result, fields){}){
        this.connection.query(query, (err, ...rest) => {
            if(err && err.fatal){
                this.#_connect_impl((err2) => {
                    if(err2){
                        callback(err, ...rest);
                        return;
                    }
                    this.connection.query(query, callback);
                });
                return;
            }
            callback(err, ...rest);
        })
    }
    
    /**
     * 
     * @param {Date[]} times 
     * @param {BigInt[]} thermometers_ids 
     * @param {number[]} values 
     */
    insert_new_measurements(times, thermometers_ids, values, next = function(err){}){
        this.#_reconnect_if_nessesary(next, this.insert_new_measurements.bind(this, ...arguments));
        const NO_VALUE = -200;
        let query = `INSERT INTO measurements (time, thermometer_id, value) VALUES `;
        for(let time_i=0; time_i<times.length; time_i++){
            const time = times[time_i];
            for (let i = 0; i < thermometers_ids.length; i++) {
                const thermometer_id = thermometers_ids[i];
                const value = values[time_i*times.length + i];
                if(value === NO_VALUE){
                    continue;
                }
                query += `(${mysql.escape(time)},${thermometer_id},${value}),`;
            }
        }
        query = query.slice(0,-1);
        this.query_with_reconnect(query,(err) => {
            if(err){
                console.error("Error while perofming insert query: ", err);
            }
            next(err);
        });
    }
    
    get_last_measurements(next = function(err, result){}){
        this.#_reconnect_if_nessesary(next, this.get_last_measurements.bind(this, ...arguments));
        const query =
        `SELECT m.thermometer_id as id, m.time, m.value FROM measurements AS m JOIN(
         SELECT MAX(m.time) AS TIME, m.thermometer_id AS id FROM measurements AS m GROUP BY m.thermometer_id
         ) AS maxes ON m.thermometer_id = maxes.id AND m.time = maxes.time`;
        this.query_with_reconnect(query, function(err, result, fields){
            if(err){
                console.error("Error while performing get_last_measurements query: ", err);
                next(err);
            }
            next(err, result);
        });
    }
    
};

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
*/

/*
Get Latest Temperatures Request Body Format:
    - uint8 request_type (20)
Response:
    - uint8  request_type (20)
    - uint32 count
    - uint64 timestamps[count]
    - uint64 thermometer_ids[count]
    - int16  measurements[count]
*/

const RequestTypes = {
    PostNewTemperatures: 10,
    GetLastMeasurements: 20
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
        case RequestTypes.GetLastMeasurements: {
            handleGetLastMeasurements(ws);
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
    console.log(`Received Post New Temperatures Request 2:`, {
        thermometers_ids,
        measurements
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
            buffer.writeBigInt64LE(BigInt(result[i].id), 5 + (count + i)*8);
            buffer.writeInt16LE(result[i].value, 5 + count*16 + i*2);
        }
        ws.send(buffer);
    });
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