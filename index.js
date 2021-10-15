//@ts-check
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const {WebSocketServer, WebSocket} = require('ws');

const PORT = process.env.PORT || 80;

app.use('/test',express.static('test'));

app.get('/', (req, res) => {
    const ip = req.ip;
    const hostname = req.hostname;
    res.send(`Hello ${hostname}@${ip}`);
    res.end();
});


app.post('/post_temps', (req, res) => {
    /*
    Request Body Format:
        - uint32 device_id
        - uint32 thermometers_count
        - uint32 measures_count
        - uint64 thermometer_ids[thermometers_count]
        - uint16 measures[measures_count][thermometers_count]
    */
});

function handleOpen(/**@type {WebSocket}*/ ws){
    console.log(`WebSocket Connection Opened`);
}
function handleError(/**@type {WebSocket}*/ ws, /**@type {Error} */ error){
    console.log(`WebSocket Error:`, error);
}
function handleClose(/**@type {WebSocket}*/ ws, /**@type {Number} */ code, /**@type {Buffer}*/ reason){
    console.log(`WebSocket Connection Closed ${code}:${reason}`);
}
function handlePing(/**@type {WebSocket}*/ ws, /**@type {Buffer} */ data){
    console.log(`WebSocket Received Ping:`, data.toString());
}
function handlePong(/**@type {WebSocket}*/ ws, /**@type {Buffer} */ data){
    console.log(`WebSocket Received Pong:`, data.toString());
}
function handleMessage(/**@type {WebSocket}*/ ws, /**@type {Buffer} */ data, /**@type {Boolean} */ isBinary){
    console.log(`WebSocket Received Message${isBinary ? "(b)" : ""}:`, isBinary ? data : data.toString());
    ws.send(data.toString());
    if(data.toString() === 'test'){
        sendPeriodicMessage(ws, 0, 60 * 1000);
    }
}


function sendPeriodicMessage(/**@type {WebSocket}*/ ws, /**@type {Number}*/ id, /**@type {Number}*/ timeout){
    if(ws.readyState != WebSocket.OPEN){
        console.log(`Testing WebSocket is not OPEN: `);
        return;
    }
    ws.send(id.toString(), err => {
        if(err){
            console.log(`Error in periodic message: `, err);
            return;
        }
        setTimeout(sendPeriodicMessage.bind(null, ws, id+1, timeout), timeout);
    });
}


const wss = new WebSocketServer({server});
wss.on('connection', (ws) => {
    handleOpen(ws);
    ws.on('open', handleOpen.bind(null, ws));
    ws.on('close', handleClose.bind(null, ws));
    ws.on('error', handleError.bind(null, ws));
    ws.on('ping', handlePing.bind(null, ws));
    ws.on('pong', handlePong.bind(null, ws));
    ws.on('message', handleMessage.bind(null, ws));
});

server.listen(PORT, () => {
    console.log("App listening on port: ", PORT);
});