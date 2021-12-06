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

    
    function reloadTemps(){
        document.getElementById('temp').innerHTML = "";
        
        for(let id in thermometers){
            let div = addElement();
            div.querySelector(".TherName").innerHTML = getDeviceNameById(thermometers[id].id);
            div.querySelector(".Temp").innerHTML = `${thermometers[id].value} ℃`;
            
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
                value: measurements[i],
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
    
    
    // To poniżęj jest tylko i wyłącznie dla testów
    setTimeout(() => {
        socket.sendGetThermometerNames();
    }, 2000);
    setTimeout(() => {
        socket.sendGetLatestTemperatures();
    }, 3000);
    
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

    generate_test_thermometers_output();