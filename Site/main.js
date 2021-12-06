//@ts-check

function Sth(site){fetch(site)
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
})
.catch(function(err) {  
    console.log('Failed to fetch page: ', err);  
})};

    Sth('settings.html');
    Sth('graph.html');
    Sth('errors.html'); 

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

    var a = document.getElementById("temp");

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
        value_parts[1] = value_parts[1].padEnd(2, '0');
        return value_parts.join('.').replace(/ /g, '&nbsp;');
    }

    function reloadTemps(){
        document.getElementById('temp').innerHTML = "";
        
        for(let id in thermometers){
            let div = addElement();
            div.querySelector(".TherName").innerHTML = getDeviceNameById(thermometers[id].id);
            div.querySelector(".Temp").innerHTML = `${pad_temperature(thermometers[id].value)}℃`;
            
            let fmt = new Intl.DateTimeFormat([], {dateStyle: "short", timeStyle: 'medium'});
            let date = new Date(Number(thermometers[id].time));
            
            div.querySelector(".Times").innerHTML = `${fmt.format(date)}`;
            document.getElementById('temp').appendChild(div);
        }
    }
    
    onGetLastTemperatures = function(count, timestamps, thermometer_ids, measurements){
        
        for(let i=0; i<count; i++){
            thermometers[ thermometer_ids[i] ] = {
                time: timestamps[i],
                value: Math.round(measurements[i] * 100) / 100,
                id: thermometer_ids[i]
            };
        }

        /*getConfig();
        setConfig();
        saveConfig();
        rebootNetwork();
        setSleepNetwork();*/


        reloadTemps();
    }
    
    // To automatycznie zaktualizuje tablice z nazwami, która wykożystywana jest przez 'getDeviceNameById', który wywoływany jest w 'reloadTemps'
    onGetThermometerNames = function(){ 
        reloadTemps();
    }
    
    onGetLogs = function(important, id, data){
        document.getElementById('logs_elem').innerHTML = data;
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

    let get_device_names_interval = null;
    let last_measurements_interval = null;

    onConnect = function(){
        if(get_device_names_interval)
            clearInterval(get_device_names_interval);
        if(last_measurements_interval)
            clearInterval(last_measurements_interval);
        get_device_names_interval = setInterval(() => {
            socket.sendGetThermometerNames();
        }, 60 * 1000);
        last_measurements_interval = setInterval(()=>{
            socket.sendGetLatestTemperatures();
        }, 5000);
        
        socket.sendGetThermometerNames();
        socket.sendGetLatestTemperatures();
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