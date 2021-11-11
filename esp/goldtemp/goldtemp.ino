#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-variable"
#include <OneWire.h>
#pragma GCC diagnostic pop
#include <DallasTemperature.h>
#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>

//// CONFIG /////////////////////

constexpr int  MAX_DEVICES = 20;
constexpr int  ONE_WIRE_BUS = D1;

//
//constexpr char CRED_SSID[] =  "TP-LINK_FD2F53";
//constexpr char CRED_PASS[] = "42936961";
//constexpr char WS_HOST[] = "192.168.0.101";
constexpr char CRED_SSID[] =  "👌";
constexpr char CRED_PASS[] = "qwertyui";

constexpr char WS_HOST[] = "192.168.43.111";
constexpr int  WS_PORT = 8080;
constexpr char WS_URL[] = "/";
constexpr int  WS_HB_INTERVAL = 1000 * 15;

uint32_t  DEVICE_ID = 100;
int  TEMP_REFRESH = (1000 * 60 * 1);

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
  WiFi.begin(CRED_SSID, CRED_PASS);
  int code = 0;
  while(true){
    code = WiFi.status();
    if(code != WL_DISCONNECTED && code != WL_IDLE_STATUS)
      break;
    delay(500);
  }
  return code == WL_CONNECTED;
}
void net_status_update(bool force = false){
  static bool last_wifi_status = false;
  if(WiFi.status() == WL_CONNECTED){
    if(last_wifi_status == false || force){
      logln("WiFi Connected");
    }
  }else{
    if(last_wifi_status == true || force){
      logp("WiFi Disconnected: ");
      logln(WiFi.status());
    }
  }
  last_wifi_status = (WiFi.status() == WL_CONNECTED);
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

//// WebSockets ////////////////////
WebSocketsClient ws;
void wsEventHandler(WStype_t type, uint8_t* payload, size_t length){
  switch(type) {
    case WStype_DISCONNECTED:{
      logln("[WSc] Disconnected!");
      break;
    }
    case WStype_CONNECTED: {
      logln("[WSc] Connected to url: ", String((char*)payload));
      ws.sendTXT("Connected");
      break;
    }
    case WStype_TEXT:{
      logln("[WSc] get text: ", String((char*)payload));
      if(length > 4){
        ws.sendTXT(payload+4);
      }
      break;
    }
    case WStype_BIN:{
      logln("[WSc] get binary length: ", length);
      ws.sendBIN(payload, length);
      break;
    }
    case WStype_PING:{
        //logln("[WSc] get ping");
        break;
    }
    case WStype_PONG:{
        //logln("[WSc] get pong");
        break;
    }
    case WStype_ERROR:{
      logln("[WSc] error: ", String((char*)payload));
      break;
    }
    default:{
      break;
    }
  }
}

void ws_begin(){
  ws.begin(WS_HOST, WS_PORT, WS_URL);
  ws.onEvent(wsEventHandler);
  ws.setReconnectInterval(5000);
  ws.enableHeartbeat(WS_HB_INTERVAL, 3000, 2);
}

//// MEASUREMENTS //////////////////


struct Measurements{
	static constexpr int16_t NO_TEMP = -200 * 128;
	static constexpr uint32_t MAX_DEVICES = ::MAX_DEVICES;
	static constexpr uint32_t MAX_MEASUREMENTS = 500;

  size_t payload_length = 0;

  char     ws_payload_begining[(MAX_DEVICES + MAX_MEASUREMENTS)*8 + 50];
	uint64_t device_ids[MAX_DEVICES]{};
	uint64_t measurements_times[MAX_MEASUREMENTS];
	int16_t  measurements_values[MAX_DEVICES * MAX_MEASUREMENTS];
	
	uint32_t commited_measurements = 0;
	uint32_t tracked_devices = 0;

/*
Post New Tmeperatures Request Body Format:
    - uint8  request_type (10)
    - uint32 device_id
    - uint32 thermometers_count
    - uint32 measurements_count
    - uint64 thermometer_ids[thermometers_count]
    - int16 measurements[measurements_count][thermometers_count]
*/
  void prepare_payload(){
    auto t1 = millis();
    char* head = (char*)ws_payload_begining + 14;
    auto push = [&head, this](const char* data, const size_t length){ memcpy(head, data, length); head += length; };
    const char request_id = 10;
    push(&request_id, 1);
    push((char*)&DEVICE_ID, 4);
    push((char*)&tracked_devices, 4);
    push((char*)&commited_measurements, 4);
    push((char*)device_ids, 8*tracked_devices);
    for(uint32_t i=0; i<commited_measurements; i++){
      push((char*)(measurements_values + i * MAX_DEVICES), tracked_devices*2);
    }
    payload_length = head - (char*)ws_payload_begining - 14;
    auto t2 = millis();
    logln("Preparing took ", t2-t1, " millis. Payload length: ", payload_length);
  }

  bool send_payload(){
    if(payload_length == 0){
      logln("No payload prepared.");
      return false;
    }
    return ws.sendBIN((uint8_t*)ws_payload_begining, payload_length, true);
  }
  
	void clear_next_measurement(){
		if(commited_measurements >= MAX_MEASUREMENTS || payload_length != 0)
			return;
		for(size_t i=0; i<MAX_DEVICES; i++){
			measurements_values[i + commited_measurements*MAX_DEVICES] = NO_TEMP;
		}
		measurements_times[commited_measurements] = 0;
	}
	void clear(){
		commited_measurements = 0;
		tracked_devices = 0;
    payload_length = 0;
		clear_next_measurement();
	}
	bool set_value(uint64_t device_id, int16_t value){
    if(payload_length != 0){
      logln("Cannot add a measurement while payload is prepared.");
      return false;
    }
		if(commited_measurements >= MAX_DEVICES){
			logln("Too many measurements");
			return false;
		}
		size_t device_index = 0;
		for(; device_index < tracked_devices; device_index++){
			if(device_ids[device_index] == device_id){
				break; 
			}
		}
		if(device_index >= MAX_DEVICES){
			logln("Too many devices");
			return false;
		}
		else if(device_index >= tracked_devices){
			tracked_devices += 1;
			device_ids[device_index] = device_id;
		}
		measurements_values[device_index + commited_measurements * MAX_DEVICES] = value;
		return true;
	}
	bool commit(){
    if(payload_length != 0){
      logln("Cannot commit measurements while payload is prepared.");
      return false;
    }
		if(commited_measurements >= MAX_MEASUREMENTS){
			logln("Cannot commit more measurements");
			return false;
		}
		commited_measurements += 1;
    clear_next_measurement();
		return true;
	}
	
	void print(){
		for(size_t i=0; i<tracked_devices; i++){
      logp(i, ": ", device_ids[i], " |\t");
			for(size_t j=0; j<commited_measurements; j++){
				logp(raw_to_c(measurements_values[i + j*MAX_DEVICES]));
				logp('\t');
			}
			logln();
		}
	}
	
	Measurements(){
		clear();
	}
	
};

Measurements measurements;


//// TERMOMETERS /////////////////////

bool rescan_devices(){
  sensors.begin();
  numberOfDevices = sensors.getDeviceCount();
  if(numberOfDevices <= 0 || numberOfDevices > MAX_DEVICES){
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

void request_temperatures(){
  const auto t1 = millis();
  sensors.requestTemperatures();
  const auto t2 = millis();
  logln("Measurement took ", t2-t1, " millis.");
}

bool getTemperature(DeviceAddress deviceAddress, int16_t& result){
  result = sensors.getTemp	(deviceAddress);
  if(result == DEVICE_DISCONNECTED_RAW)
    return false;
  return true;
}

float raw_to_c(const int16_t raw){
	return float(raw) / 128.f;
}

bool getAllTemperatures(){
  for(uint8_t i=0; i<numberOfDevices; i++){
    int16_t value;
    const auto t1 = millis();
    const bool res = getTemperature(addresses[i], value);
    const auto t2 = millis();
    if(res)
      if(!measurements.set_value(numAddresses[i], value)){
		  return false;
	  }
    logln(numAddresses[i], ": ", raw_to_c(value), " [", value , res ? "] (" : "]err (", t2 - t1, ")");
  }
  if(!measurements.commit()){
	return false;
  }
  return true;
}

bool complete_measurement_routine(){
  measurements.clear();
  rescan_devices();
  request_temperatures();
  if(!getAllTemperatures()) return false;
  measurements.prepare_payload();
  if(!measurements.send_payload()) return false;
  return true;
}

//// TEST /////////////////

int16_t random_raw_temperature(){
  return random(120*128, 200*128);
}

void fill_test_temperatures(){
  measurements.clear();
  measurements.set_value(1111, random_raw_temperature());
  measurements.set_value(2222, random_raw_temperature());
  measurements.set_value(3333, random_raw_temperature());
  measurements.commit();
  measurements.set_value(1111, random_raw_temperature());
  measurements.set_value(2222, random_raw_temperature());
  measurements.set_value(3333, random_raw_temperature());
  measurements.commit();
  measurements.set_value(1111, random_raw_temperature());
  measurements.set_value(3333, random_raw_temperature());
  measurements.set_value(4444, random_raw_temperature());
  measurements.commit();
}
void test_routine(){
  Serial.print("======= Testing upload =======");
  fill_test_temperatures();
  Serial.println("Generated temperatures:");
  measurements.print();
  
  // TODO
  
}

//// SETUP AND LOOP ///////////////////////////

void setup(void)
{
  Serial.begin(115200);
  logln("Connecting to WiFi...");
  wifi_connect();
  ws_begin();
  net_status_update(true);
  rescan_devices_with_log();
}


template<typename Handler>
struct IntervalExecution
{
  Handler handler;
  uint64_t interval;
  uint64_t counter = 0;
  
  IntervalExecution(Handler handler, uint64_t interval)
    : handler(handler), interval(interval)
  {}

  void update_interval(uint64_t new_interval){
    interval = new_interval;
  }

  bool operator()(){
    if(interval == 0){
      return false;
    }
    uint64_t now = millis();
    if(now - counter > interval){
      counter = now;
      handler();
      return true;
    }
    return false;
  }
};

IntervalExecution net_update_interval([]{
  net_status_update();
  //logln(millis());
  if(WiFi.status() != WL_CONNECTED){
    logln("Reconnecting to wifi...");
    wifi_connect();
  }
}, 200);

IntervalExecution measurement_routine_interval([]{
  auto t1 = millis();
  if(complete_measurement_routine()){
    logp("Ok. ");
  }else{
    logp("Measurement routine failed! ");
  }
  auto t2 = millis();
  logln(t2-t1, '\t', t1, '\t', t2);
}, 0);

void loop(void)
{
  if(Serial.available()){
    String command = Serial.readStringUntil('\n');
    Serial.read();
    Serial.print("Command: ");
    Serial.println(command);
    if(command == "scan"){
      rescan_devices_with_log();
    }else if(command == "req"){
      request_temperatures();
    }else if(command == "get"){
      getAllTemperatures();
    }else if(command == "z"){
      rescan_devices_with_log();
      request_temperatures();
      getAllTemperatures();
    }else if(command == "print"){
      measurements.print();
    }else if(command == "send"){
      bool res = measurements.send_payload();
      logln("Sent payload with status: ", res);
    }else if(command == "clear"){
      measurements.clear();
    }else if(command == "test"){
      test_routine();
    }else if(command == "prepare"){
      measurements.prepare_payload();
      logln("Prepared payload.");
    }else if(command == "int"){
      String data = Serial.readStringUntil('\n');
      Serial.read();
      int new_interval = data.toInt();
      measurement_routine_interval.update_interval(new_interval);
      logln("Set new interval to ", new_interval);
    }else if(command == "wstestsend"){
      String data = Serial.readStringUntil('\n');
      Serial.read();
      auto res = ws.sendTXT(data);
      logln("Test Sending Status: ", res);
    }else{
      Serial.print("Unknown command: ");
      Serial.println(command);
    }
  }
  net_update_interval();
  measurement_routine_interval();
  ws.loop();
}
