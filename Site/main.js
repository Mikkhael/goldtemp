//@ts-check

function Sth(site, next){fetch(site)
    .then(function(response) {
        return response.text()
    })
    .then(function(html) {
        var parser = new DOMParser();
        var content = parser.parseFromString(html, "text/html");
        /**@type {HTMLElement} */
        var div = content.querySelector(".move");
        div.style.display = "none";
        div.setAttribute("id", site);
        document.body.appendChild(div);
        if(next){
            next();
        }
})
.catch(function(err) {  
    console.log('Failed to fetch page: ', err);  
})};

    Sth('settings.html' , () => {set_loaded("config"); });
    Sth('graph.html', () => {startChart(); set_loaded("graph");});
    Sth('errors.html', () => {set_loaded("errors"); }); 

    function disableAll(){
        document.getElementById("settings.html").style.display = "none";
        document.getElementById("graph.html").style.display = "none";
        document.getElementById("errors.html").style.display = "none";
        document.getElementById("index.html").style.display = "none";
    }

    function moveToSettings(){
        disableAll();
        document.getElementById("settings.html").style.display = "block";
    }

    function moveToGraph(){
        disableAll();
        document.getElementById("graph.html").style.display = "block";
    }

    function moveToErrors(){
        disableAll();
        document.getElementById("errors.html").style.display = "block";
    }

    function moveToHome(){
        disableAll();
        document.getElementById("index.html").style.display = "block";
    }

    function addElement(){
        var newDiv = document.createElement("div");
        newDiv.innerHTML = `<span class="TherName" style="font-weight: bold">"getThermometerNames()"</span>
        <br>
        <span class="Temp" style="font-weight: bold">"getLastTemperatures()"</span>
        <br>
        <span class="Times" style="font-weight: bold"></span>`;
        return newDiv;
    }
    
    function addGraphThermometerElement(){
        var newDiv = document.createElement("div");
        newDiv.className = "GraphRecord";
        newDiv.innerHTML = `<span class="GraphRecordThermometer">(Thermometer Name)</span>`
        return newDiv;
    }

    var thermometers = {};

    //@ts-ignore
    let socket = new Socket();

    /**@param {number} value */
    function pad_temperature(value){
        const value_str = value.toString();
        const value_parts = value_str.split('.');
        value_parts[0] = value_parts[0].padStart(3, ' ');
        if(value_parts.length == 1)
            value_parts[1] = "";
        value_parts[1] = value_parts[1].padEnd(1, '0');
        return value_parts.join('.').replace(/ /g, '&nbsp;');
    }
    
    
    let COLOR_COLD = [0, 13, 255];
    let COLOR_HOT  = [255, 0, 0];
    
    let TEMPERATURE_COLD = 20;
    let TEMPERATURE_HOT  = 50;
    
    function get_temp_color_raw(x){
        if(x <= TEMPERATURE_COLD){
            return COLOR_COLD;
        }else if(x >= TEMPERATURE_HOT){
            return COLOR_HOT;
        }
        return [0,0,0].map((_,i) =>  COLOR_COLD[i] + (COLOR_HOT[i] - COLOR_COLD[i]) * ((x-TEMPERATURE_COLD)/(TEMPERATURE_HOT - TEMPERATURE_COLD)) );
    }
    
    function get_temp_color_rgb(x){
        return `rgb(${get_temp_color_raw(x).join()})`;
    }
    
    
    function reloadTemps(){
        document.getElementById('temp').innerHTML = "";
        document.getElementById('graphRecords').innerHTML = "";
        
        const thermometers_sorted = Object.entries(thermometers).sort((a,b) => getDeviceNameById(a[1].id) < getDeviceNameById(b[1].id) ? -1 : 1);
        console.log('sdfsdf',thermometers_sorted);
        for(let index in thermometers_sorted){
            const id = thermometers_sorted[index][0];
            let div = addElement();
            div.querySelector(".TherName").innerHTML = getDeviceNameById(thermometers[id].id);
            div.querySelector(".Temp").innerHTML = `${pad_temperature(thermometers[id].value)}℃`;
            //@ts-expect-error
            div.querySelector(".Temp").style.color = get_temp_color_rgb(thermometers[id].value);
            
            let fmt = new Intl.DateTimeFormat([], {dateStyle: "short", timeStyle: 'medium'});
            let date = new Date(Number(thermometers[id].time));
            
            div.querySelector(".Times").innerHTML = `${fmt.format(date)}`;
            document.getElementById('temp').appendChild(div);
            
            div = addGraphThermometerElement();
            div.querySelector(".GraphRecordThermometer").innerHTML = getDeviceNameById(thermometers[id].id);
            div.setAttribute("device_id", thermometers[id].id);
            div.onclick = () => {clickedRecord(div, thermometers[id].id)};
            div.setAttribute("is_selected", thermometers[id].selected ? "1" : "0");
            
            document.getElementById('graphRecords').appendChild(div);
        }
    }
    
    function clickedRecord(element, id){
        thermometers[id].selected = !thermometers[id].selected;
        element.setAttribute("is_selected", thermometers[id].selected ? "1" : "0");
    }
    
    onGetLastTemperatures = function(count, timestamps, thermometer_ids, measurements){
        
        for(let i=0; i<count; i++){
            if(thermometers[thermometer_ids[i]] && thermometers[thermometer_ids[i]].time > timestamps[i]){
                continue;
            }
            thermometers[ thermometer_ids[i] ] = {
                time: timestamps[i],
                value: Math.round(measurements[i] * 10) / 10,
                id: thermometer_ids[i],
                selected: thermometers[thermometer_ids[i]]?.selected || false
            };
        }
        reloadTemps();
    }
    
    // To automatycznie zaktualizuje tablice z nazwami, która wykożystywana jest przez 'getDeviceNameById', który wywoływany jest w 'reloadTemps'
    onGetThermometerNames = function(){ 
        reloadTemps();
    }
    
    onGetLogs = function(important, id, data){
        let data_formated = data;
        if(data.indexOf('\u0000') != -1){
            data_formated = data.slice(data.indexOf('\u0000')+1) + data.slice(0, data.indexOf('\u0000'));
        }
        document.getElementById('logs_elem').innerHTML = data_formated;
    }

    onGetConfig = function(id, cfg){
        //@ts-expect-error
        document.getElementById('settings_1').value = cfg.cred_ssid;
        //@ts-expect-error
        document.getElementById('settings_2').value = cfg.cred_pass;
        //@ts-expect-error
        document.getElementById('settings_3').value = cfg.ws_host;
        //@ts-expect-error
        document.getElementById('settings_4').value = cfg.ws_port.toString();
        //@ts-expect-error
        document.getElementById('settings_5').value = cfg.sample_interval.toString();
    }
    
    onGetMeasurementsSince = function(id, timestamps, values){
        console.log("TL: ", timestamps.length);
        console.log(timestamps);
        let data = [];
        for(let i=0; i<timestamps.length; i++){
            data.push({
                x: new Date(Number(timestamps[i])*1000),
                y: raw_to_c(values[i]),
            });
        }
        data = data.sort((a, b) => a.x.getTime() - b.x.getTime());
        addChartDataset(getDeviceNameById(id.toString()), data);
        updateChart();
    }

    function setConfig(){
        const cfg = new Config();
        //@ts-expect-error
        cfg.cred_ssid = document.getElementById('settings_1').value;
        //@ts-expect-error
        cfg.cred_pass = document.getElementById('settings_2').value;
        //@ts-expect-error
        cfg.ws_host = document.getElementById('settings_3').value;
        //@ts-expect-error
        cfg.ws_port = +document.getElementById('settings_4').value;
        //@ts-expect-error
        cfg.sample_interval = +document.getElementById('settings_5').value;

        socket.sendSetConfig(cfg);
    }
    function setSleepNetwork(){
        //@ts-expect-error
        const sh = +document.getElementById("sleep_1").value || 0;
        //@ts-expect-error
        const sm = +document.getElementById("sleep_2").value || 0;
        //@ts-expect-error
        const dh = +document.getElementById("sleep_3").value || 0;
        //@ts-expect-error
        const dm = +document.getElementById("sleep_4").value || 0;

        socket.sendSetSleepingTime(sh*60+sm, dh*60+dm)
    }
    function getConfig(){
        socket.sendGetConfig();
    }
    function saveConfig(){
        socket.sendSaveConfig();
    }
    function rebootNetwork(){
        socket.sendRebootNetwork();
    }

    function getLogs(important = false){
        socket.sendGetLogs(important);
    }
    
    function getSelectedIds(){
        return Object.values(thermometers).filter(x => x.selected).map(x => x.id);
    }
    
    /**
     * @param {Date} date 
     */
    function getBeginningOfDay(date){
        date.setMilliseconds(0);
        date.setSeconds(0);
        date.setMinutes(0);
        date.setHours(0);
        return date;
    }
    
    function drawGraph(){
        const ids = getSelectedIds();
        const from = /** @type {HTMLInputElement} */ ( document.getElementById('graph_date_from') ).value;
        const to   = /** @type {HTMLInputElement} */ ( document.getElementById('graph_date_to')   ).value;
        let fromDate = new Date(from);
        let toDate   = new Date(to);
        if(from == ""){ fromDate = getBeginningOfDay(new Date()); }
        if(to   == ""){ toDate   = getBeginningOfDay(new Date()); }
        toDate = new Date(toDate.getTime() + 1000*60*60*24);
        console.log(ids, from, to, fromDate, toDate);
        if(ids){
            getGraph(ids, fromDate, toDate);
        }
    }
    
    /**
     * @param {BigInt[]} thermometer_ids 
     * @param {Date} from 
     * @param {Date} to 
     */
    function getGraph(thermometer_ids, from, to){
        clearChart();
        console.log(from, to);
        for(let id of thermometer_ids){
            socket.sendGetMeasurementsSince(id, from, to);
        }
    }
    
    function setManagedDevices(){
        const searchParams = new URLSearchParams(window.location.search);
        const ids = searchParams.getAll("id").join(",").split(",").map(x => +x).filter(x => x);
        console.log(`IDS: `, ids);
        socket.sendSetManagedDevices(ids);
    }
    
    let get_device_names_interval = null;
    let last_measurements_interval = null;

    
    function setRefreshInterval(thermometerNamesRefresh = 10 * 60 * 1000, latestTemperaturesRefresh = 5 * 60 * 1000){
        if(get_device_names_interval)
            clearInterval(get_device_names_interval);
        if(last_measurements_interval)
            clearInterval(last_measurements_interval);
            
        get_device_names_interval = setInterval(() => {
            socket.sendGetThermometerNames();
        }, thermometerNamesRefresh);
        last_measurements_interval = setInterval(()=>{
            socket.sendGetLatestTemperatures();
        }, latestTemperaturesRefresh);
        
        socket.sendGetThermometerNames();
        socket.sendGetLatestTemperatures();
    }
    
    
    onConnect = function(){
        set_loaded("socket");
        setManagedDevices();
    }

    let parts_to_load = ["errors", "socket", "config", "graph"]
    function set_loaded(name){
        parts_to_load = parts_to_load.filter(x => x != name);
        if(parts_to_load.length == 0){
            setup();
        }
    }
    
    function setup(){
        setRefreshInterval();
    }

    // To poniżęj jest tylko i wyłącznie dla testów
    // setTimeout(() => {
    //     socket.sendGetThermometerNames();
    // }, 2000);
    // setTimeout(() => {
    //     socket.sendGetLatestTemperatures();
    // }, 3000);
    
    // Tą funkcję wywołać można ręcznie w konsolce
    function generate_test_thermometers_output(){
        RecognizedDeviceNames["111111111111"] = "Piętro 1";
        RecognizedDeviceNames["222222222222"] = "Piętro 2 Kuchnia";
        RecognizedDeviceNames["333333333333"] = "Piętro 2 Łazienka";
        
        // Zasymulowanie otrzymania odpowiedzi od serwera z randomowymi danymi
        // Można se dodać jakieś inne dane jak chcesz
        let now = new Date().getTime();
        onGetLastTemperatures(4,
            [now, now-1000, now-2000, now-3000].map(x => BigInt(x)),
            [111111111111, 222222222222, 333333333333, 12092432184172583680n].map(x => BigInt(x)),
            [12, -32.5, 100, 54.32]
        );
    }

    //generate_test_thermometers_output();