//@ts-check

/**
 * @param {string[]} args 
 * @param {ArrayBuffer} buffer
 * @param {number} offset
 */
function decode_buffer( buffer, args, offset = 0 ){
    const res = {};
    const view = new DataView(buffer, offset);
    let i = 0;
    
    const decode_next = function(/**@type {string}*/ type){
        let value;
        if      (type === 'u8' || type === 'char')   { value = view.getUint8(i);           i += 1; }
        else if (type === 'u16')  { value = view.getUint16(i, true);    i += 2; }
        else if (type === 'u32')  { value = view.getUint32(i, true);    i += 4; }
        else if (type === 'u64')  { value = view.getBigUint64(i, true); i += 8; }
        else if (type === 'i8')   { value = view.getInt8(i);            i += 1; }
        else if (type === 'i16')  { value = view.getInt16(i, true);     i += 2; }
        else if (type === 'i32')  { value = view.getInt32(i, true);     i += 4; }
        else if (type === 'i64')  { value = view.getBigInt64(i, true);  i += 8; }
        else { throw new Error(`Unknown Buffer Data Type: ${type}`) }
        return value;
    }
    
    for(let arg of args){
        const [type, name, size] = arg.split(' ');
        if(size){
            res[name] = [];
            let count = +size;
            while(count > 0){
                const value = decode_next(type);
                res[name].push(value);
                count -= 1;
            }
            if(type === 'char'){
                res[name] = res[name].map(x => String.fromCharCode(x)).join('');
            }
        }else{
            res[name] = decode_next(type);
        }
    }
    
    return res;
}

/**
 * @param {number} buffer_length
 * @param {[string, any][]} args
 */
 function encode_buffer(buffer_length, args){
    const buffer = new ArrayBuffer(buffer_length);
    const view = new DataView(buffer);
    
    let i = 0;
    
    const encode_next = function(/**@type {string}*/ type, /**@type {number}*/ value){
        if      (type === 'u8')   { view.setUint8(i, value);           i += 1; }
        else if (type === 'u16')  { view.setUint16(i, value, true);    i += 2; }
        else if (type === 'u32')  { view.setUint32(i, value, true);    i += 4; }
        else if (type === 'u64')  { view.setBigUint64(i, BigInt(value), true); i += 8; }
        else if (type === 'i8')   { view.setInt8(i, value);            i += 1; }
        else if (type === 'i16')  { view.setInt16(i, value, true);     i += 2; }
        else if (type === 'i32')  { view.setInt32(i, value, true);     i += 4; }
        else if (type === 'i64')  { view.setBigInt64(i, BigInt(value), true);  i += 8; }
        else { throw new Error(`Unknown Buffer Data Type: ${type}`) }
    }
    
    for(const [type, value] of args){
        if(type.startsWith('str')){
            const length = (+type.slice(3)) || 0;
            console.log(length);
            for(let a=0; a<length; a++){
                encode_next('u8', value.charCodeAt(a) || 0);
            }
        }
        else if(value instanceof Array){
            for(const elem of value){
                encode_next(type, elem || 0);
            }
        }else{
            encode_next(type, value || 0);
        }
    }
    
    return buffer;
}

/**
 * @param {string} str 
 */
function normalize_string(str){
    const null_index = str.indexOf('\u0000');
    if(null_index >= 0){
        return str.slice(0, null_index);
    }
    return str;
}

/**
 * @param {number} value 
 */
function raw_to_c(value){
    return value / 128;
}

class Config{
    constructor(){
        this.cred_ssid = "";
        this.cred_pass = "";
        this.ws_host = "";
        this.ws_port = 0;
        this.sample_interval = 0;
    }
    
    normalize_strings(){
        this.cred_ssid = normalize_string(this.cred_ssid);
        this.cred_pass = normalize_string(this.cred_pass);
        this.ws_host   = normalize_string(this.ws_host);
    }
}
/**@type {Object.<string, string>} */
const RecognizedDeviceNames = {};

/**
 * @param {string} id 
 * @param {string} name 
 */
function registerDeviceName(id, name){
    RecognizedDeviceNames[id] = name;
}

/**
 * @param {string} id 
 */
function getDeviceNameById(id){
    return RecognizedDeviceNames[id] || (id + '?');
}

function getDefaultSocketAddress(){
    const is_https = location.protocol === 'https:';
    return `${is_https ? 'wss' : 'ws'}://${location.host}`;
}


/**
 * @param {number} count 
 * @param {BigInt[]} timestamps 
 * @param {BigInt[]} thermometer_ids 
 * @param {number[]} measurements
 * @this {Socket}
 */
let onGetLastTemperatures = function(count, timestamps, thermometer_ids, measurements){ console.log(arguments); }

/**
 * @param {boolean} is_important 
 * @param {number} device_id 
 * @param {string} data 
 * @this {Socket}
 */
let onGetLogs = function(is_important, device_id, data){ console.log(arguments); }

/**
 * @param {number} device_id
 * @param {Config} cfg
 * @this {Socket}
 */
let onGetConfig = function(device_id, cfg){ console.log(arguments); }

let onGetThermometerNames = function(){ console.log(RecognizedDeviceNames); };

/**
 * @param {BigInt} device_id 
 * @param {BigInt[]} timestamps 
 * @param {number[]} values 
 */
let onGetMeasurementsSince = function(device_id, timestamps, values){ console.log(arguments); };


let onConnect = function(){};
class Socket{
    constructor(address = getDefaultSocketAddress(), heartbeat_delay = 20000){
        this.address = address;
        this.heartbeat_delay = heartbeat_delay;
        
        /**@type {WebSocket} */
        this.socket = null;
        
        this.heartbeat_timeout = null;
        
        this.connect();
    }
    
    connect(address = this.address){
        this.socket = new WebSocket(address);
        
        // Connection opened
        this.socket.addEventListener('open', (event) => {
            console.log('Connected To server: ', event);
            this.#_sendHeartbeat();
            onConnect();
        });
    
        // Listen for messages
        this.socket.addEventListener('message', (event) => {
            const msg = event.data;
            if(msg instanceof Blob){
                msg.arrayBuffer().then(buffer => {
                    const array = new Uint8Array(buffer)
                    console.log(array);
                    switch(array[0]){
                        case 20:{
                            this.handleGetLatestTemperatures(buffer);
                            break;
                        }
                        case 51:{
                            this.handleGetLogs(buffer);
                            break;
                        }
                        case 61:{
                            this.handleGetConfig(buffer);
                            break;
                        }
                        case 101:{
                            this.handleGetMeasurementsSince(buffer);
                            break;
                        }
                    }
                });
            }else{
                const json = JSON.parse(msg);
                if(!json || !json.type){
                    console.error('Unrecognized TEXT ws message: ', msg);
                }else{
                    switch(json.type){
                        case "names":{
                            this.handleGetThermometerNames(json.data);
                            break;
                        }
                        default:{
                            console.error(`Unrecognized JSON ws message: `, json.type);
                            break;
                        }
                    }
                }
            }
        });
        
        this.socket.addEventListener("error", (event) => {
            console.error("Socket error: ", event);
        });
        
        this.socket.addEventListener("close", (event) => {
            console.log("Socket closed: ", event);
        })
    }
    
    disconnect(){
        if(this.socket){
            this.socket.close();
        }
    }
    
    #_sendHeartbeat(){
        if(this.socket.readyState !== this.socket.OPEN){
            console.log("Cannot send heartbeat, socket not OPEN");
            return;
        }
        this.socket.send('/');
        this.heartbeat_timeout = setTimeout(this.#_sendHeartbeat.bind(this), this.heartbeat_delay);
    }
    
    
    sendGetLatestTemperatures(){
        const buffer = encode_buffer(1, [
            ['u8', 20]
        ]);
        this.socket.send(buffer);
    }
    
    sendGetLogs(is_important = true){
        const buffer = encode_buffer(2, [
            ['u8', 50],
            ['u8', +is_important]
        ]);
        this.socket.send(buffer);
    }
    
    sendGetConfig(){
        const buffer = encode_buffer(1, [
            ['u8', 60]
        ]);
        this.socket.send(buffer);
    }
    
    sendSetConfig(cfg = new Config()){
        const buffer = encode_buffer(1+32+32+102+2+8, [
            ['u8', 70],
            ['str32', cfg.cred_ssid],
            ['str32', cfg.cred_pass],
            ['str102', cfg.ws_host],
            ['u16', cfg.ws_port],
            ['u64', cfg.sample_interval],
        ]);
        this.socket.send(buffer);
    }
    
    sendRebootNetwork(){
        const buffer = encode_buffer(1, [
            ['u8', 71]
        ]);
        this.socket.send(buffer);
    }
    
    sendSaveConfig(){
        const buffer = encode_buffer(1, [
            ['u8', 72]
        ]);
        this.socket.send(buffer);
    }
    
    sendSetSleepingTime(start_minutes = 0, duration_minutes = 0){
        const start_minutes_utc = start_minutes + new Date().getTimezoneOffset();
        const buffer = encode_buffer(5, [
            ['u8', 81],
            ['u16', start_minutes_utc],
            ['u16', duration_minutes],
        ]);
        this.socket.send(buffer);
    }
    
    sendGetThermometerNames(){
        const buffer = encode_buffer(1, [
            ['u8', 90]
        ]);
        this.socket.send(buffer);
    }

    /**
     * @param {BigInt|string} thermometer_id 
     * @param {Date} from 
     * @param {Date} to 
     */
    sendGetMeasurementsSince(thermometer_id, from, to){
        console.log(thermometer_id, BigInt(thermometer_id.toString()));
        const buffer = encode_buffer(1+8+8+8, [
            ['u8', 100],
            ['u64', BigInt(thermometer_id.toString())],
            ['u64', from.getTime()],
            ['u64', to.getTime()],
        ]);
        this.socket.send(buffer);
    }
    
    /**
     * @param {ArrayBuffer} buffer 
     */
    handleGetLatestTemperatures(buffer){
        try{
            const {count} = decode_buffer(buffer, [
                'u32 count'
            ], 1);
            const {timestamps, thermometer_ids, raw_measurements} = decode_buffer(buffer, [
                `u64 timestamps ${count}`,
                `u64 thermometer_ids ${count}`,
                `i16 raw_measurements ${count}`,
            ], 5);
            const measurements = raw_measurements.map(x => raw_to_c(x));
            onGetLastTemperatures.call(this, count, timestamps, thermometer_ids, measurements);
        }catch(err){
            if(err instanceof RangeError){
                console.error(`GetLastMeasurements: Received invalid length buffer: `, new Uint8Array(buffer));
            }else{
                throw err;
            }
        }
    }
    
    /**
     * @param {ArrayBuffer} buffer 
     */
    handleGetLogs(buffer){
        try{
            const {is_important, device_id, data} = decode_buffer(buffer, [
                'u8 is_important',
                'u32 device_id',
                `char data ${buffer.byteLength - 1 - 1 - 4}`
            ], 1);
            onGetLogs.call(this, is_important != 0, device_id, data);
        }catch(err){
            if(err instanceof RangeError){
                console.error(`GetLogs: Received invalid length buffer: `, new Uint8Array(buffer));
            }else{
                throw err;
            }
        }
    }
    
    /**
     * @param {ArrayBuffer} buffer 
     */
    handleGetConfig(buffer){
        try{
            const raw_cfg = decode_buffer(buffer, [
                'u32 device_id',
                `char cred_ssid 32`,
                `char cred_pass 32`,
                `char ws_host 102`,
                `u16 ws_port`,
                `u64 sample_interval`,
            ], 1);
            const cfg = new Config();
            Object.assign(cfg, raw_cfg);
            cfg.normalize_strings();
            onGetConfig.call(this, raw_cfg.device_id, cfg); 
        }catch(err){
            if(err instanceof RangeError){
                console.error(`GetConfig: Received invalid length buffer: `, new Uint8Array(buffer));
            }else{
                throw err;
            }
        }
    }
    
    /**
     * @param {Object.<string, string>} data 
     */
    handleGetThermometerNames(data){
        for(const key in data){
            registerDeviceName(key, data[key]);
        }
        onGetThermometerNames();
    }
    
    /**
     * @param {ArrayBuffer} buffer 
     */
     handleGetMeasurementsSince(buffer){
        try{
            const res_header = decode_buffer(buffer, [
                'u64 thermometer_id',
                'u32 count'
            ], 1);
            const res_data = decode_buffer(buffer, [
                `u64 timestamps ${res_header.count}`,
                `i16 values ${res_header.count}`
            ], 1+8+4);
            onGetMeasurementsSince(res_header.thermometer_id, res_data.timestamps, res_data.values);
        }catch(err){
            if(err instanceof RangeError){
                console.error(`GetConfig: Received invalid length buffer: `, new Uint8Array(buffer));
            }else{
                throw err;
            }
        }
    }


};

/*
    INFO DLA MARCINA
    najpierw robisz se socket:
    const socket = new Socket();
*/