#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-variable"
#include <OneWire.h>
#pragma GCC diagnostic pop
#include <DallasTemperature.h>
#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>

//// CONFIG /////////////////////

constexpr int  MAX_DEVICES = 20;
constexpr int  ONE_WIRE_BUS = D1;

const char AP_SSID[] = "ESPIndicator";
const char AP_PASS[] = "qwertyui";

//// LOGGER ///////////////////

template<typename T, typename ... Ts>
inline void logp(const T& arg, const Ts& ... args){
  Serial.print(arg);
  logp(args...);
}
inline void logp(){}
template<typename ... Ts>
inline void logln( const Ts& ... args ){
  logp(args ..., '\n');
}

//// WIFI /////////////////////
WiFiClient client;

bool wifi_connect(){
  logln("Setting soft-AP...");
  bool res = WiFi.softAP(AP_SSID, AP_PASS);
  logln("Status: ", res);
  return res;
}



//// ONEWIRE /////////////////////
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

DeviceAddress addresses[MAX_DEVICES] {};
uint64_t numAddresses[MAX_DEVICES] {};
uint8_t numberOfDevices = 0;

void printAddress(DeviceAddress deviceAddress, char* destination)
{
  static constexpr char letters[17] = "0123456789ABCDEF";
  for (uint8_t i = 0; i < 8; i++){
    destination[i*2 + 0] = letters[(deviceAddress[i] / 16) % 16];
    destination[i*2 + 1] = letters[deviceAddress[i] % 16];
  }
}
void printAddress(uint64_t deviceAddress, char* destination){
  printAddress(reinterpret_cast<uint8_t*>(&deviceAddress), destination);
}

uint64_t addressToUint(const DeviceAddress deviceAddress)
{
  uint64_t res = 0;
  for (uint8_t i = 0; i < 8; i++){
    res |= deviceAddress[i];
    res <<= 8;
  }
  return res;
}

//// TERMOMETERS /////////////////////

bool rescan_devices(){
  sensors.begin();
  numberOfDevices = sensors.getDeviceCount();
  if(numberOfDevices < 0 || numberOfDevices > MAX_DEVICES){
    logln("Too many Devices found: ", numberOfDevices);
    return false;
  }

  for(uint8_t i=0; i<numberOfDevices; i++){
    if(!sensors.getAddress(addresses[i], i)){
      continue;
    }
  numAddresses[i] = addressToUint(addresses[i]);
    //printAddress(addresses[i], stringAddresses + 16 * i);
  }
  return true;
}

void rescan_devices_with_log(){
  const auto t1 = millis();
  const bool res = rescan_devices();
  const auto t2 = millis();
  logln("Scan took ", t2-t1, "millis.");
  if(!res){
    logln("Error occured during rescanning devices");
    return;
  }
  logln("Found ", numberOfDevices, " devices: ");
  for(size_t i=0; i<numberOfDevices; i++){
  logln(i, ": ", numAddresses[i]);
  }
}

///// SERVER //////////

const char indexhtml[] PROGMEM = R"ABC(
<html><body>
<div id="D"></div>
<input type="button" value="X" onclick="e()">
<script>
k={};
function r(){
    fetch("./r").then(x=>x.text()).then(x=>{
        console.log(x);
        s(x.split(',').filter(y=>y.length>0));
        setTimeout(r, 3000);
    }).catch(err=>{
        console.log(err);
        setTimeout(r, 3000);
    })
}
const D = document.getElementById("D");
function s(xs){
    for(let i in k){
        k[i] = false;
    }
    for(let x of xs){
        k[x] = true;
    }
    e();
    for(let i in k){
        D.innerHTML += `<p style="color:${k[i]?"black":"grey"}">${i}</p>`;
    }
}
function e(){
    D.innerHTML = "";
}
r();
</script>
</body></html>
)ABC";

ESP8266WebServer server(80);
char buf[3000];

void handleRoot(){
  //sprintf(buf, "HELLO %f <br>%s", random(0,100)*1.f, indexhtml);
  server.send(200, "text/html", indexhtml);
}

void handleRefresh(){
  rescan_devices_with_log();
  int off = 1;
  buf[0] = ',';
  buf[1] = '\0';
  for(int i=0; i<numberOfDevices; i++){
    off += sprintf(buf + off, "%llu,", numAddresses[i]);
  }
  server.send(200, "text/plain", buf);
}

void server_setup(){
  server.on("/", handleRoot);
  server.on("/r", handleRefresh);
  server.begin();
}

//// SETUP AND LOOP ///////////////////////////

void setup(void)
{
  Serial.begin(115200);
  logln("Connecting to WiFi...");
  wifi_connect();
  logln("Ip: ", WiFi.localIP());
  server_setup();
}


void loop(void)
{
  server.handleClient();
}
