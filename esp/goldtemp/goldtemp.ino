#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-variable"
#include <OneWire.h>
#pragma GCC diagnostic pop
#include <DallasTemperature.h>
#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ESP_EEPROM.h>
#include <ESPTelnet.h>

ESPTelnet telnet;
void set_new_measurement_interval(const uint64_t);

//// CONFIG /////////////////////

constexpr int  MAX_DEVICES = 10;
constexpr int  ONE_WIRE_BUS = D1;

struct Config{
  char CRED_SSID[32] = "TP-LINK_FD2F53";
  char CRED_PASS[32] = "42936961";
  char WS_HOST[102] = "192.168.0.101";
  uint16_t WS_PORT = 8080;
  uint64_t SAMPLE_INTERVAL = 0;
};
static_assert(sizeof(Config) == 32+32+102 + 2 + 8);

constexpr char AP_SSID[] = "ESP GOLDTEMP";
constexpr char AP_PASS[] = "1234abcd";

struct ConfigWithWsPayload{
  char payload_header_padding[24];
  Config cfg;
  char* get_payload_start(){ return payload_header_padding + 24 - 14 - 1 - 4 - 4; }
};
ConfigWithWsPayload config_with_ws_payload;

bool config_changed = false;
Config& cfg = config_with_ws_payload.cfg;

bool save_config(){
  if(!config_changed){
    return true;
  }
  EEPROM.put(0, cfg);
  if(!EEPROM.commit()){
    return false;
  }
  config_changed = false;
  return true;
}

void validate_config(){
  cfg.CRED_SSID[sizeof(cfg.CRED_SSID)-1] = '\0';
  cfg.CRED_PASS[sizeof(cfg.CRED_PASS)-1] = '\0';
  cfg.WS_HOST[sizeof(cfg.WS_HOST)-1] = '\0';
  if(cfg.SAMPLE_INTERVAL < 5000 && cfg.SAMPLE_INTERVAL != 0){
    cfg.SAMPLE_INTERVAL = 5000;
  }
}

void set_config(char key, String value){
  switch(key){
    case '1':{
      strncpy(cfg.CRED_SSID, value.c_str(), sizeof(cfg.CRED_SSID));
      break;
    }
    case '2':{
      strncpy(cfg.CRED_PASS, value.c_str(), sizeof(cfg.CRED_PASS));
      break;
    }
    case '3':{
      strncpy(cfg.WS_HOST, value.c_str(), sizeof(cfg.WS_HOST));
      break;
    }
    case '4':{
      cfg.WS_PORT = value.toInt();
      break;
    }
    case '5':{
      cfg.SAMPLE_INTERVAL = value.toInt();
      break;
    }
    default:{
      return;
    }
  }
  validate_config();
  config_changed = true;
}

//constexpr char CRED_SSID[] =  "👌";
//constexpr char CRED_PASS[] = "qwertyui";
//constexpr char WS_HOST[] = "192.168.43.111";

constexpr int WS_HB_INTERVAL = 1000 * 15;

uint32_t  DEVICE_ID = 100;

//// LOGGER AND TIME ///////////////////

bool is_current_timestamp_set_value = false;
uint64_t current_timestamp_base = 0;
uint32_t current_timestamp_millis_offset = 0;

void set_current_timestamp(uint64_t timestamp){
  current_timestamp_base = timestamp;
  current_timestamp_millis_offset = millis() / 1000;
  is_current_timestamp_set_value = true;
}
bool is_timestamp_set(){
  return is_current_timestamp_set_value;
}
uint64_t get_current_timestamp(){
  const uint32_t current_millis = millis() / 1000;
  current_timestamp_base += current_millis - current_timestamp_millis_offset;
  current_timestamp_millis_offset = current_millis;
  return current_timestamp_base;
}

struct TelnetPrint : public Print{
  ESPTelnet& telnet;
  size_t write(uint8_t value) override{
    telnet.print(value);
    return 1;
  }
  size_t write(const uint8_t* str, size_t len) override{
    String s;
    s.reserve(len);
    s.concat((const char*)str, len);
    telnet.print(s);
    return len;
  }
  TelnetPrint(ESPTelnet& telnet)
    : telnet(telnet)
  {}
};

TelnetPrint telnetPrint(telnet);

template<uint32_t TBUF_SIZE>
struct StrBuf : public Print{
  static constexpr auto BUF_SIZE = TBUF_SIZE;
  static constexpr auto PAYLOAD_HEADER_SIZE = 14 + 1 + 4 + 1 + 4;
  char buf_with_ws_payload[PAYLOAD_HEADER_SIZE + BUF_SIZE + 1] {};
  char* buf = buf_with_ws_payload + PAYLOAD_HEADER_SIZE;
  uint32_t buf_end = 0;
  bool buf_overflow = false;

  size_t get_payload_length(){
    return PAYLOAD_HEADER_SIZE - 14 + (buf_overflow ? BUF_SIZE : buf_end);
  }

  void print_to_serial(){
    if(buf_overflow){
      Serial.write(buf+buf_end, BUF_SIZE - buf_end);
      telnetPrint.write((const uint8_t*)(buf+buf_end), BUF_SIZE - buf_end);
    }
    Serial.write(buf, buf_end);
    telnetPrint.write((const uint8_t*)buf, buf_end);
  }
  
  size_t write(uint8_t value) override{
    buf[buf_end] = value;
    buf_end++;
    if(buf_end >= BUF_SIZE){
      buf_overflow = true;
      buf_end = 0;
    }
    buf[buf_end] = 0;
    return 1;
  }
  size_t write(const uint8_t* str, size_t len) override{
    if(len <= 0)
      return 0;
    const auto left = BUF_SIZE - buf_end;
    if(len > left){
      memcpy(buf + buf_end, str, left);
      buf_end = 0;
      buf_overflow = true;
      return len + write(str + left, len - left);
    }
    memcpy(buf + buf_end, str, len);
    buf_end = (buf_end + len) % BUF_SIZE;
    buf[buf_end] = 0;
    return len;
  }
};

StrBuf<5000> log_buffer;
StrBuf<2000> important_log_buffer;

template<bool IS_IMPORTANT = false, typename T, typename ... Ts>
inline void logp(const T& arg, const Ts& ... args){
	Serial.print(arg);
  log_buffer.print(arg);
  telnetPrint.print(arg);
  if constexpr(IS_IMPORTANT){
    important_log_buffer.print(arg);
  }
	logp<IS_IMPORTANT>(args...);
}
template<bool>
inline void logp(){}

template<bool IS_IMPORTANT = false, typename ... Ts>
inline void logln( const Ts& ... args ){
  const auto now = get_current_timestamp();
	logp<IS_IMPORTANT>(now, "| ", args ..., '\n');
}

//// WIFI /////////////////////
WiFiClient client;

void reboot_network();

bool wait_for_wifi_to_connect(int retries = 8){
  int code = 0;
  while(--retries >= 0){
    code = WiFi.status();
    if(code == WL_CONNECTED)
      break;
    delay(500);
  }
  return code == WL_CONNECTED;
}

void net_status_update(bool force = false){
  static bool last_wifi_status = false;
  if(WiFi.status() == WL_CONNECTED){
    if(last_wifi_status == false || force){
      logln<true>("WiFi Connected. ", WiFi.localIP());
    }
  }else{
    if(last_wifi_status == true || force){
      logln<true>("WiFi Disconnected: ", WiFi.status());
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
bool ws_is_connected = false;
void wsEventHandler(WStype_t type, uint8_t* payload, size_t length){
  switch(type) {
    case WStype_DISCONNECTED:{
      if(ws_is_connected){
        logln<true>("[WSc] Disconnected!");
        ws_is_connected = false;
      }
      break;
    }
    case WStype_CONNECTED: {
      ws_is_connected = true;
      uint8_t buffer[5];
      buffer[0] = 1;
      memcpy(buffer+1, &DEVICE_ID, 4);
      logln<true>("[WSc] Connected");
      ws.sendBIN(buffer, 5);
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
//      logln("[WSc] get binary length: ", length);
//      ws.sendBIN(payload, length);
      if(payload[0] == 30 && length == 9){ // New Sampling Interval
        uint64_t new_interval;
        memcpy(&new_interval, payload+1, 8);
        set_new_measurement_interval(new_interval);
      }else if(payload[0] == 40 && length == 9){ // Current Timestamp
        uint64_t new_timestamp;
        memcpy(&new_timestamp, payload+1, 8);
        set_current_timestamp(new_timestamp);
        logln<true>("Current timestamp set to: ", new_timestamp);
      }else if(payload[0] == 50 && length == 6){ // Get Logs
        char response_id = 51;
        uint32_t seq;
        uint8_t only_important;
        memcpy(&seq, payload+1, 4);
        memcpy(&only_important, payload+5, 1);
        char* buf = only_important ? important_log_buffer.buf_with_ws_payload : log_buffer.buf_with_ws_payload;
        auto len = only_important ? important_log_buffer.get_payload_length() : log_buffer.get_payload_length();
        memcpy(buf + 14, &response_id, 1);
        memcpy(buf + 14 + 1, &seq, 4);
        memcpy(buf + 14 + 1 + 4, &only_important, 1);
        memcpy(buf + 14 + 1 + 4 + 1, &DEVICE_ID, 4);
        ws.sendBIN((uint8_t*)buf, len, true);
      }else if(payload[0] == 60 && length == 5){ // Get Config
        char response_id = 61;
        uint32_t seq;
        memcpy(&seq, payload+1, 4);
        char* buf = config_with_ws_payload.get_payload_start();
        memcpy(buf + 14, &response_id, 1);
        memcpy(buf + 14 + 1, &seq, 4);
        memcpy(buf + 14 + 1 + 4, &DEVICE_ID, 4);
        ws.sendBIN((uint8_t*)buf, 1+4+4+sizeof(Config), true);
      }else if(payload[0] == 70 && length == 1 + sizeof(Config)){ // Set Config
        memcpy(&cfg, payload+1, sizeof(cfg));
        config_changed = true;
        validate_config();
        set_new_measurement_interval(cfg.SAMPLE_INTERVAL);
      }else if(payload[0] == 71 && length == 1){ // Reboot Network
        logln<true>("Rebooting Network");
        reboot_network();
      }else if(payload[0] == 72 && length == 1){ // Save Config
        if(save_config()){
          logln<true>("Saved Config");
        }else{
          logln<true>("Failed to save Config");
        }
        logln<true>("EEPROM usage: ", EEPROM.percentUsed());
      }
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
      logln<true>("[WSc] error: ", String((char*)payload));
      break;
    }
    default:{
      break;
    }
  }
}

void ws_begin(){
  ws.disconnect();
  ws.begin(cfg.WS_HOST, cfg.WS_PORT, "/");
  ws.onEvent(wsEventHandler);
  ws.setReconnectInterval(5000);
  ws.enableHeartbeat(WS_HB_INTERVAL, 3000, 2);
}

//// MEASUREMENTS //////////////////


struct Measurements{
	static constexpr int16_t NO_TEMP = -200 * 128;
	static constexpr uint32_t MAX_DEVICES = ::MAX_DEVICES;
	static constexpr uint32_t MAX_MEASUREMENTS = 500;
  static constexpr uint32_t MAX_PAYLOAD_MEASUREMENTS_SIZE = (8 + 2*MAX_DEVICES)*50;
  static constexpr uint32_t MAX_PAYLOAD_SIZE = 14 + 1 + 4*3 + 8*MAX_DEVICES + MAX_PAYLOAD_MEASUREMENTS_SIZE;

  size_t payload_length = 0;
  uint8_t ws_payload[MAX_PAYLOAD_SIZE]{};

	uint64_t device_ids[MAX_DEVICES]{};
	uint64_t measurements_times[MAX_MEASUREMENTS];
	int16_t  measurements_values[MAX_DEVICES * MAX_MEASUREMENTS];
	
	uint32_t commited_measurements = 0;
  uint32_t payloaded_measurements = 0;
	uint32_t tracked_devices = 0;

/*
Post New Tmeperatures Request Body Format:
    - uint8  request_type (10)
    - uint32 device_id
    - uint32 thermometers_count
    - uint32 measurements_count
    - uint64 thermometer_ids[thermometers_count]
    - uint64 measurements_timestamps[measurements_count]
    - int16 measurements[measurements_count][thermometers_count]
*/
  void prepare_payload(){ // TODO
    static const uint8_t request_id = 10;
    
    auto t1 = millis();
    payloaded_measurements = MAX_PAYLOAD_MEASUREMENTS_SIZE / (8 + 2*tracked_devices);
    if(payloaded_measurements > commited_measurements)
      payloaded_measurements = commited_measurements;
    uint32_t measurements_diff = commited_measurements - payloaded_measurements;
    
    payload_length = 14;
    auto push = [this](const char* data, const size_t length){ memcpy(ws_payload + payload_length, data, length); payload_length += length; };
    push((char*)&request_id, 1);
    push((char*)&DEVICE_ID, 4);
    push((char*)&tracked_devices, 4);
    push((char*)&payloaded_measurements, 4);
    push((char*)device_ids, 8*tracked_devices);
    push((char*)(measurements_times + measurements_diff), 8*payloaded_measurements);
    for(uint32_t i=0; i<payloaded_measurements; i++){
      push((char*)(measurements_values + (commited_measurements - i - 1) * MAX_DEVICES), tracked_devices*2);
    }
    
    auto t2 = millis();

    //logln("DEBUG: ", sizeof(ws_payload), " ", payloaded_measurements, " ", commited_measurements, " ", measurements_diff, " ", MAX_PAYLOAD_MEASUREMENTS_SIZE, " ", MAX_PAYLOAD_SIZE);

    //commited_measurements -= payload_length;
    logln("Preparing took ", t2-t1, " millis. Payload length: ", payload_length);
  }

  void clear_payload(){
    payload_length = 0;
    payloaded_measurements = 0;
  }
  bool send_payload(){
    if(payload_length == 0){
      logln<true>("No payload prepared.");
      return false;
    }
    return ws.sendBIN((uint8_t*)ws_payload, payload_length - 14, true);
  }
  bool send_measurement_part(){
    prepare_payload();
    if(!send_payload()) return false;
    commited_measurements -= payloaded_measurements;
    clear_payload();
    clear_next_measurement();
    return true;
  }
  bool send_all_measurements(){
    while(commited_measurements > 0){
      if(!send_measurement_part()) return false;
    }
    return true;
  }
  
	void clear_next_measurement(){
    clear_payload();
		if(commited_measurements >= MAX_MEASUREMENTS)
			return;
		for(size_t i=0; i<MAX_DEVICES; i++){
			measurements_values[i + commited_measurements*MAX_DEVICES] = NO_TEMP;
		}
		measurements_times[commited_measurements] = 0;
	}
	void clear(){
		commited_measurements = 0;
		tracked_devices = 0;
    clear_payload();
		clear_next_measurement();
	}
	bool set_value(uint64_t device_id, int16_t value){
    clear_payload();
		if(commited_measurements >= MAX_MEASUREMENTS){
			logln<true>("Too many measurements");
			return false;
		}
		size_t device_index = 0;
		for(; device_index < tracked_devices; device_index++){
			if(device_ids[device_index] == device_id){
				break; 
			}
		}
		if(device_index >= MAX_DEVICES){
			logln<true>("Too many devices");
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
    clear_payload();
		if(commited_measurements >= MAX_MEASUREMENTS){
			logln<true>("Cannot commit more measurements");
			return false;
		}
    measurements_times[commited_measurements] = ( is_timestamp_set() ? get_current_timestamp() : 0 );
		commited_measurements += 1;
    clear_next_measurement();
		return true;
	}
	
	void print(){
    for(size_t i=0; i<commited_measurements; i++){
      logp(measurements_times[i]);
      logp('\t');
    }
    logp('\n');
		for(size_t i=0; i<tracked_devices; i++){
      logp(i, ": ", device_ids[i], " |\t");
			for(size_t j=0; j<commited_measurements; j++){
				logp(raw_to_c(measurements_values[i + j*MAX_DEVICES]));
				logp('\t');
			}
			logp('\n');
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
    logln<true>("Too many Devices found: ", numberOfDevices);
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
    logln<true>("Error occured during rescanning devices");
    return;
  }
  logln<true>("Found ", numberOfDevices, " devices: ");
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
  if(!measurements.send_all_measurements()) return false;
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
  Serial.print("======= Testing =======");
  fill_test_temperatures();
  Serial.println("Generated temperatures:");
  measurements.print();
  
}

void big_test_routine(uint64_t d_count, uint64_t m_count){
  Serial.print("======= Testing ======= Generating Big test for\n Devices: ");
  Serial.print(d_count);
  Serial.print("\n Measurements: ");
  Serial.println(m_count);
  measurements.clear();
  int16_t m = 10000;
  for(size_t i=0; i<m_count; i++){
    for(size_t j=0; j<d_count; j++){
      //Serial.printf("(%u,%u)",i,j);
      measurements.set_value(77700000 + j, ++m );
    }
    Serial.println(i);
    measurements.commit();
  }
  Serial.println("DONE");
}

//// TELNET ///////////////////////////////////

String last_telnet_command;

void telnet_begin(){
  telnet.onConnect([](String ip){
    logln<true>("Telnet connection: ", ip);
  });
  telnet.onConnectionAttempt([](String ip){
    logln<true>("Telnet connection attempt: ", ip);
  });
  telnet.onReconnect([](String ip){
    logln<true>("Telnet reconnect: ", ip);
  });
  telnet.onDisconnect([](String ip){
    logln<true>("Telnet disconnect: ", ip);
  });
  telnet.onInputReceived([](String str){
    last_telnet_command = str;
  });
  telnet.begin();
}

//// SETUP AND LOOP ///////////////////////////

void show_config(){
  logln<true>("Config" , config_changed ? "*" : "" , 
    "|CRED_SSID:", cfg.CRED_SSID,
    "|CRED_PASS:", cfg.CRED_PASS,
    "|WS_HOST:", cfg.WS_HOST,
    "|WS_PORT:", cfg.WS_PORT,
    "|SAMPLE_INTERVAL:", cfg.SAMPLE_INTERVAL);
}

void EEPROM_init(){
  EEPROM.begin(sizeof(Config));
  if(EEPROM.percentUsed() >= 0) {
    EEPROM.get(0, cfg);
    logln<true>("EEPROM usage: ", EEPROM.percentUsed());
  } else {
    logln<true>("No EEPROM saved");  
  }
  show_config();
}

void reboot_network(){
  telnet.stop();
  ws.disconnect();
  WiFi.disconnect();
  logln("Connecting to WiFi...");
  WiFi.begin(cfg.CRED_SSID, cfg.CRED_PASS);
  wait_for_wifi_to_connect();
  ws_begin();
  net_status_update(true);
}

void setup(void)
{
  Serial.begin(115200);
  Serial.println();
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASS);
  EEPROM_init();
  reboot_network();
  telnet_begin();
  set_new_measurement_interval(cfg.SAMPLE_INTERVAL);
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

  void execute_now(){
      counter = millis();
      handler();
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
    wait_for_wifi_to_connect();
  }
}, 200);

IntervalExecution measurement_routine_interval([]{
  //auto t1 = millis();
  if(complete_measurement_routine()){
    logln("Ok. ");
  }else{
    logln<true>("Measurement routine failed! ");
  }
  //auto t2 = millis();
  //logln("(", t2-t1, "ms)");
}, 0);

IntervalExecution current_timestamp_refresh([]{
  if(!is_timestamp_set() && ws_is_connected){
    static const uint8_t payload[] = {40};
    ws.sendBIN(payload, 1);
  }
}, 5000);

void set_new_measurement_interval(const uint64_t new_interval){
  measurement_routine_interval.update_interval(new_interval);
  logln<true>("Changed Measurement Sample Interval to ", new_interval, "ms.");
}

bool handle_command(String& command){
  logln("Command: ", command);
  if(command == "scan"){
    rescan_devices_with_log();
  }else if(command == "req"){
    request_temperatures();
  }else if(command == "get"){
    getAllTemperatures();
  }else if(command == "z"){
    measurement_routine_interval.execute_now();
  }else if(command == "s"){
    bool res = measurements.send_all_measurements();
    logln("Send status: ", res);
  }else if(command == "print"){
    measurements.print();
  }else if(command == "send"){
    bool res = measurements.send_payload();
    logln("Sent payload with status: ", res);
  }else if(command == "sendflush"){
    logln("Flushing records: ", measurements.payloaded_measurements);
    measurements.commited_measurements -= measurements.payloaded_measurements;
  }else if(command == "clearpayload"){
    measurements.clear_payload();
    logln("Cleared payload");
  }else if(command == "clear"){
    measurements.clear();
  }else if(command == "test"){
    test_routine();
  }else if(command == "test0"){
    big_test_routine(Measurements::MAX_DEVICES, Measurements::MAX_MEASUREMENTS);
  }else if(command == "test1"){
    big_test_routine(Measurements::MAX_DEVICES-1, Measurements::MAX_MEASUREMENTS-1);
  }else if(command == "test2"){
    big_test_routine(Measurements::MAX_DEVICES, Measurements::MAX_MEASUREMENTS-1);
  }else if(command == "test3"){
    big_test_routine(Measurements::MAX_DEVICES-1, Measurements::MAX_MEASUREMENTS);
  }else if(command == "test4"){
    big_test_routine(Measurements::MAX_DEVICES/2, Measurements::MAX_MEASUREMENTS/2);
  }else if(command == "showconfig"){
    show_config();
  }else if(command == "reboot"){
    reboot_network();
  }else if(command == "saveconfig"){
    bool res = save_config();
    logln("Save Config Status: ", res);
  }else if(command == "log"){
    Serial.println("=== LOGS  ===");
    telnetPrint.println("=== LOGS  ===");
    log_buffer.print_to_serial();
  }else if(command == "log!"){
    Serial.println("=== LOGS! ===");
    telnetPrint.println("=== LOGS! ===");
    important_log_buffer.print_to_serial();
  }else if(command == "prepare"){
    measurements.prepare_payload();
    logln("Prepared payload.");
  }else if(command.startsWith("wstestsend")){
    String data = command.substring(10);
    auto res = ws.sendTXT(data);
    logln("Test Sending Status: ", res);
  }else if(command.startsWith("int")){
    int new_interval = command.substring(3).toInt();
    measurement_routine_interval.update_interval(new_interval);
    logln("Set new interval to ", new_interval);
  }else if(command.startsWith("cfg")){
    int64_t from = 3;
    int64_t to = 0;
    while(from < command.length()){
      char key = command[from];
      to = command.indexOf(',', from);
      if(to < 0) to = command.length();
      String value = command.substring(from+1, to);
      logln("Config ", key, " : ", value);
      set_config(key, value);
      from = to + 1;
    }
  }else{
    logln("Unknown command: ", command);
    return false;
  }
  return true;
}

void loop(void)
{
  if(Serial.available()){
    String command = Serial.readStringUntil('\n');
    Serial.read();
    handle_command(command);
  }else if(last_telnet_command.length() > 0){
    handle_command(last_telnet_command);
    last_telnet_command = "";
  }
  ws.loop();
  telnet.loop();
  current_timestamp_refresh();
  net_update_interval();
  measurement_routine_interval();
}
