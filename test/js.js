//@ts-check

/**
 * @param {string} selector
 */
function querySelectorInput(selector){
    return /**@type {HTMLInputElement}*/ (document.querySelector(selector));
}

/**
 * @param {number} id 
 */
function getConfigInput(id){
    return querySelectorInput(`#config>input[v='${id}']`);
}

/**
 * @param {Config} cfg 
 */
function show_config(cfg){
    getConfigInput(1).value = cfg.cred_ssid;
    getConfigInput(2).value = cfg.cred_pass;
    getConfigInput(3).value = cfg.ws_host;
    getConfigInput(4).value = cfg.ws_port.toString();
    getConfigInput(5).value = cfg.sample_interval.toString();
}

/**
 * @param {Config} cfg 
 */
function load_config(cfg){
    cfg.cred_ssid       = getConfigInput(1).value;
    cfg.cred_pass       = getConfigInput(2).value;
    cfg.ws_host         = getConfigInput(3).value;
    cfg.ws_port         = +getConfigInput(4).value;
    cfg.sample_interval = +getConfigInput(5).value;
}

const messages = document.getElementById('messages');

//@ts-ignore
let socket = new Socket();

onGetLastTemperatures = function(count, timestamps, thermometer_ids, measurements){
    document.getElementById(`last_measurements`).innerHTML = "";
    for(let i=0; i<count; i++){
        document.getElementById(`last_measurements`).innerHTML += 
            `${new Date(Number(timestamps[i]))} | ${thermometer_ids[i]} : ${measurements[i]}°C (${getDeviceNameById(thermometer_ids[i].toString())})<br />`;
    }
}

onGetLogs = function(is_important, device_id, data){
    document.getElementById('logs').innerHTML = data;
}

onGetConfig = function(device_id, cfg){
    show_config(cfg);
}

onGetThermometerNames = function(){
    const elem = document.getElementById(`last_measurements`);
    for(const id in RecognizedDeviceNames){
        elem.innerHTML = elem.innerHTML.replace(`${id}?`, RecognizedDeviceNames[id]);
    }
}

function getLastTemperatures(){
    socket.sendGetLatestTemperatures();
}

function getLastLogs(important){
    socket.sendGetLogs(important);
}

function getConfig(){
    socket.sendGetConfig();
}

function setConfig(){
    const cfg = new Config();
    load_config(cfg);
    socket.sendSetConfig(cfg);
}

function rebootNetwork(){
    socket.sendRebootNetwork();
}
function saveConfig(){
    socket.sendSaveConfig();
}

function setSleepConfig(){
    const d = new Date();
    
    const start_m = +querySelectorInput('#start_minutes').value || 0;
    const start_h = +querySelectorInput('#start_hours').value || 0;
    const duration_m = +querySelectorInput('#duration_minutes').value || 0;
    const duration_h = +querySelectorInput('#duration_hours').value || 0;
    
    socket.sendSetSleepingTime(
        start_h * 60 + start_m,
        duration_h * 60 + duration_m
    );
}

function getThermometerNames(){
    socket.sendGetThermometerNames();
}

/*
function parsePostNewTemperaturesRequest(){
    const device_id         = parseInt(querySelectorInput('#device_id').value);
    const thermometers_ids  = querySelectorInput('#thermometers_ids').value.split(',').map(x => parseInt(x));
    const measures          = querySelectorInput('#measures').value.split(/[;,]/g).map(x => parseInt(x));
    const thermometers_count = thermometers_ids.length;
    const measures_count     = measures.length / thermometers_count;
    
    const obj = {
        device_id,
        thermometers_count,
        measures_count,
        thermometers_ids,
        measures
    };
    
    console.log(`Sending Post New Temperatures Request:`, obj);
    
    const buffer = new ArrayBuffer(1+12+thermometers_count*8+measures_count*thermometers_count*2);
    const view = new DataView(buffer);
    
    view.setUint8(0, 10);
    view.setUint32(1, device_id, true);
    view.setUint32(1+4, thermometers_count, true);
    view.setUint32(1+8, measures_count, true);
    
    for(let i=0; i<thermometers_count; i++){
        view.setBigUint64(1+12+i*8, BigInt(thermometers_ids[i]), true);
    }
    for(let i=0; i<measures_count*thermometers_count; i++){
        view.setInt16(1+12+thermometers_count*8+i*2, measures[i], true);
    }
    
    console.log("Buffer: ", buffer);
    
    return {obj, buffer};
}

function postNewTemperatures(){
    const {obj, buffer} = parsePostNewTemperaturesRequest();
    
    socket.send(buffer);
}
*/
