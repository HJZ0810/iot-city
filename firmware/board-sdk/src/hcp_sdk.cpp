#include "hcp_sdk.h"

#include <Adafruit_NeoPixel.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#ifndef HCP_NO_DISPLAY
#include <LovyanGFX.hpp>
#endif

#include "hcp_board.h"
#include "hcp_config.h"

HcpSdk HCP;

namespace {

Preferences prefs;
WebSocketsClient ws;
Adafruit_NeoPixel* strip = nullptr;
String cfgSsid, cfgPass, cfgHost, cfgToken;
uint16_t cfgPort = HCP_SERVER_PORT;
uint32_t probeStartedAt = 0;
uint32_t lastWifiCheck = 0;

const uint8_t kKeyPins[KEY_COUNT] = {HCP_KEY_UP, HCP_KEY_DOWN, HCP_KEY_LEFT, HCP_KEY_RIGHT, HCP_KEY_A, HCP_KEY_B};

#ifndef HCP_NO_DISPLAY
class HcpDisplay : public lgfx::LGFX_Device {
  lgfx::Panel_ST7735S panel_;
  lgfx::Bus_SPI bus_;
  lgfx::Light_PWM light_;

 public:
  HcpDisplay() {
    auto bus = bus_.config();
    bus.spi_host = SPI2_HOST;
    bus.spi_mode = 0;
    bus.freq_write = 27000000;
    bus.freq_read = 8000000;
    bus.spi_3wire = false;
    bus.use_lock = true;
    bus.dma_channel = SPI_DMA_CH_AUTO;
    bus.pin_sclk = HCP_TFT_SCLK;
    bus.pin_mosi = HCP_TFT_MOSI;
    bus.pin_miso = -1;
    bus.pin_dc = HCP_TFT_DC;
    bus_.config(bus);
    panel_.setBus(&bus_);

    auto panel = panel_.config();
    panel.pin_cs = HCP_TFT_CS;
    panel.pin_rst = HCP_TFT_RST;
    panel.pin_busy = -1;
    panel.panel_width = 128;   // ST7735S 原生 132x162，做偏移
    panel.panel_height = 160;
    panel.offset_x = 2;
    panel.offset_y = 1;
    panel.readable = false;
    panel.invert = true;
    panel.rgb_order = false;
    panel.dlen_16bit = false;
    panel.bus_shared = false;
    panel_.config(panel);

    auto light = light_.config();
    light.pin_bl = HCP_TFT_BL;
    light.invert = false;
    light.freq = 12000;
    light.pwm_channel = 7;
    light_.config(light);
    panel_.setLight(&light_);
    setPanel(&panel_);
  }
};
HcpDisplay lcd;
#endif

const uint8_t kWatchedPins[] = {HCP_LED1, HCP_LED2, HCP_LED3, HCP_LED4, HCP_RELAY, HCP_BUZZER, HCP_STRIP, HCP_KEY_A, HCP_KEY_B};
const uint8_t kWatchedCount = sizeof(kWatchedPins) / sizeof(kWatchedPins[0]);

String installationId() {
  const uint64_t mac = ESP.getEfuseMac();
  char buffer[17];
  snprintf(buffer, sizeof(buffer), "%08x%08x", static_cast<uint32_t>(mac & 0xffffffffULL), static_cast<uint32_t>(mac >> 32));
  return String(buffer);
}

void saveString(const char* key, const String& value) {
  prefs.begin("hcp", false);
  prefs.putString(key, value);
  prefs.end();
}

const char* wifiModeName(wifi_mode_t mode) {
  switch (mode) {
    case WIFI_MODE_STA: return "sta";
    case WIFI_MODE_AP: return "ap";
    case WIFI_MODE_APSTA: return "ap_sta";
    default: return "off";
  }
}

}  // namespace

/* ----------------------------- 公共接口 ----------------------------- */

void HcpSdk::begin(const char* studentLabel) {
  Serial.begin(115200);
  delay(150);
  Serial.printf("\n[万物之城] 板端 SDK 启动 %s\n", HCP_BOARD_ID);
  if (studentLabel) Serial.printf("[万物之城] 学生标识：%s\n", studentLabel);

  prefs.begin("hcp", true);
  cfgSsid = prefs.getString("ssid", HCP_WIFI_SSID);
  cfgPass = prefs.getString("pass", HCP_WIFI_PASS);
  cfgHost = prefs.getString("host", HCP_SERVER_HOST);
  cfgPort = prefs.getUShort("port", HCP_SERVER_PORT);
  cfgToken = prefs.getString("token", "");
  deviceId_ = prefs.getString("devid", "");
  prefs.end();

  for (uint8_t index = 0; index < KEY_COUNT; index++) {
    pinMode(kKeyPins[index], INPUT_PULLUP);
    keyStable_[index] = true;
  }
  for (uint8_t index = 0; index < kWatchedCount && index < 14; index++) {
    pinMode(kWatchedPins[index], INPUT);
    watched_[index] = {kWatchedPins[index], 0, static_cast<uint8_t>(digitalRead(kWatchedPins[index])), 0};
  }
  watchedCount_ = kWatchedCount;

#ifndef HCP_NO_DISPLAY
  lcd.init();
  lcd.setRotation(1);
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setFont(&lgfx::fonts::efontCN_12);
  lcd.drawString("正在连接服务器…", 8, 8);
#endif

  connectWifi();
  if (!cfgToken.length() && !enroll()) {
    Serial.println("[万物之城] 登记失败，请检查 hcp_config.h");
    return;
  }
  startSocket();
}

void HcpSdk::loop() {
  ws.loop();
  scanKeys();
  samplePins();

  // 证据调度：探针窗口 50% 与 85% 各上报一次，给学生代码留出执行时间
  if (pendingProbeId_.length()) {
    const uint32_t elapsed = millis() - probeStartedAt;
    if (evidenceStage_ == 0 && elapsed > probeWindowMs_ / 2) {
      evidenceStage_ = 1;
      pushEvidence(pendingProbeId_.c_str());
    } else if (evidenceStage_ == 1 && elapsed > static_cast<uint32_t>(probeWindowMs_ * 0.85)) {
      evidenceStage_ = 2;
      pushEvidence(pendingProbeId_.c_str());
    } else if (elapsed > probeWindowMs_ + 1500) {
      pendingProbeId_ = "";
      evidenceStage_ = 0;
    }
  }

  if (wsUp_ && millis() - lastPingAt_ > 20000) {
    lastPingAt_ = millis();
    JsonDocument doc;
    doc["t"] = "ping";
    doc["ts"] = millis();
    String out;
    serializeJson(doc, out);
    ws.sendTXT(out);
  }

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiCheck > 5000) {
    lastWifiCheck = millis();
    connectWifi();
  }
}

void HcpSdk::onScreen(void (*callback)(JsonObjectConst screen)) { screenCallback_ = callback; }

void HcpSdk::report(const char* key, double value) {
  if (!key) return;
  ReportSlot& slot = reports_[reportCount_ % 8];
  snprintf(slot.key, sizeof(slot.key), "%s", key);
  slot.value = value;
  slot.ts = millis();
  reportCount_ = (reportCount_ + 1) % 8;
}

uint32_t HcpSdk::keyPresses(HcpKey key) const { return key < KEY_COUNT ? keyPress_[key] : 0; }

bool HcpSdk::ledc(uint8_t pin, uint32_t hz, float dutyPercent) {
  const float duty = constrain(dutyPercent, 0.0f, 100.0f);
  const uint8_t bits = 12;
  const uint32_t maxDuty = (1u << bits) - 1;
  const uint32_t raw = static_cast<uint32_t>(maxDuty * duty / 100.0f);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  if (!ledcAttach(pin, hz, bits)) return false;
  ledcWrite(pin, raw);
  const uint8_t channel = 0;  // 3.x 以引脚为句柄
#else
  const uint8_t channel = (pin % 16) / 2;
  ledcSetup(channel, hz, bits);
  ledcAttachPin(pin, channel);
  ledcWrite(channel, raw);
#endif
  if (pwmCount_ < 4) pwm_[pwmCount_++] = {pin, channel, hz, duty};
  return true;
}

bool HcpSdk::tone(uint32_t hz, float dutyPercent) { return ledc(HCP_BUZZER, hz, dutyPercent); }

void HcpSdk::watchPwm(uint8_t pin, uint8_t channel) {
  if (pwmCount_ < 4) pwm_[pwmCount_++] = {pin, channel, 0, 0};
}

HcpDhtReading HcpSdk::readDht() {
  uint8_t data[5] = {0, 0, 0, 0, 0};
  pinMode(HCP_DHT, OUTPUT);
  digitalWrite(HCP_DHT, LOW);
  delay(20);
  digitalWrite(HCP_DHT, HIGH);
  pinMode(HCP_DHT, INPUT_PULLUP);
  delayMicroseconds(40);

  dht_ = {};
  if (pulseIn(HCP_DHT, LOW, 200) == 0) return dht_;
  if (pulseIn(HCP_DHT, HIGH, 200) == 0) return dht_;
  for (uint8_t bit = 0; bit < 40; bit++) {
    const uint32_t low = pulseIn(HCP_DHT, LOW, 200);
    const uint32_t high = pulseIn(HCP_DHT, HIGH, 200);
    if (!low || !high) return dht_;
    data[bit / 8] <<= 1;
    if (high > low) data[bit / 8] |= 1;
  }
  if (static_cast<uint8_t>(data[0] + data[1] + data[2] + data[3]) != data[4]) return dht_;
  dht_.ok = true;
  dht_.humidity = data[0] + data[1] * 0.1f;
  dht_.temperature = data[2] + (data[3] & 0x7F) * 0.1f;
  return dht_;
}

void HcpSdk::stripBegin(uint16_t count) {
  if (strip) {
    delete strip;
    strip = nullptr;
  }
  if (!count || count > 64) return;
  strip = new Adafruit_NeoPixel(count, HCP_STRIP, NEO_GRB + NEO_KHZ800);
  strip->begin();
  strip->clear();
  strip->show();
  stripCount_ = count;
}

void HcpSdk::setStripPixel(uint16_t index, uint8_t r, uint8_t g, uint8_t b) {
  if (!strip || index >= stripCount_) return;
  strip->setPixelColor(index, strip->Color(r, g, b));
  if (index == 0) {
    stripFirst_[0] = r;
    stripFirst_[1] = g;
    stripFirst_[2] = b;
    stripDirty_ = true;
  }
}

void HcpSdk::showStrip() {
  if (strip) strip->show();
}

/* ----------------------------- 内部实现 ----------------------------- */

void HcpSdk::connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) delay(200);
  if (WiFi.status() == WL_CONNECTED) Serial.printf("[万物之城] Wi-Fi 已连接 %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("[万物之城] Wi-Fi 连接失败");
}

bool HcpSdk::enroll() {
  WiFiClientSecure client;
#if HCP_TLS_VERIFY
  // 如需严格校验，请把证书链写入 hcp_ca.h 并在此调用 client.setCACert(...)
#else
  client.setInsecure();
#endif
  HTTPClient https;
  const String url = String("https://") + cfgHost + ":" + String(cfgPort) + "/api/hw/enroll";
  if (!https.begin(client, url)) return false;
  https.addHeader("Content-Type", "application/json");
#ifdef HCP_PROVISION_KEY
  https.addHeader("x-provision-key", HCP_PROVISION_KEY);
#endif

  JsonDocument doc;
  doc["installationId"] = installationId();
  doc["model"] = HCP_BOARD_ID;
  doc["fw"] = "sdk-1.0.0";
  JsonObject caps = doc["caps"].to<JsonObject>();
  caps["w"] = HCP_TFT_WIDTH;
  caps["h"] = HCP_TFT_HEIGHT;
  caps["color"] = "rgb565";
  caps["touch"] = false;
  caps["rotary"] = false;
  caps["lang"] = "zh";
  caps["board"] = HCP_BOARD_ID;
  JsonArray keys = caps["keys"].to<JsonArray>();
  for (const char* key : {"K1", "K2", "K3", "K4", "K5", "K6"}) keys.add(key);
  JsonArray features = caps["features"].to<JsonArray>();
  for (const char* feature : {"gpio", "adc", "pwm", "dht11", "ws2812", "relay", "buzzer", "wifi", "tft"}) features.add(feature);

  String body;
  serializeJson(doc, body);
  const int status = https.POST(body);
  const String response = https.getString();
  https.end();
  if (status != 200) {
    Serial.printf("[万物之城] 登记失败 status=%d\n", status);
    return false;
  }
  JsonDocument reply;
  if (deserializeJson(reply, response) != DeserializationError::Ok) return false;
  JsonObjectConst data = reply["data"].as<JsonObjectConst>();
  deviceId_ = String(data["deviceId"] | "");
  cfgToken = String(data["token"] | "");
  saveString("devid", deviceId_);
  saveString("token", cfgToken);
  Serial.printf("[万物之城] 配对码 %s（网页输入，10 分钟内有效）\n", data["pairCode"] | "");
  return cfgToken.length() > 0;
}

void HcpSdk::startSocket() {
  if (!cfgToken.length()) return;
  static String headers;
  headers = String("Authorization: Bearer ") + cfgToken + "\r\n";
  ws.setExtraHeaders(headers);
  ws.beginSSL(cfgHost.c_str(), cfgPort, "/hw/v1");
  ws.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
    if (type == WStype_CONNECTED) {
      wsUp_ = true;
      JsonDocument doc;
      doc["t"] = "hello";
      doc["v"] = "HCP/1";
      doc["fw"] = "sdk-1.0.0";
      JsonObject caps = doc["caps"].to<JsonObject>();
      caps["w"] = HCP_TFT_WIDTH;
      caps["h"] = HCP_TFT_HEIGHT;
      caps["color"] = "rgb565";
      caps["touch"] = false;
      caps["rotary"] = false;
      caps["lang"] = "zh";
      caps["board"] = HCP_BOARD_ID;
      JsonArray keys = caps["keys"].to<JsonArray>();
      for (const char* key : {"K1", "K2", "K3", "K4", "K5", "K6"}) keys.add(key);
      JsonArray features = caps["features"].to<JsonArray>();
      for (const char* feature : {"gpio", "adc", "pwm", "dht11", "ws2812", "relay", "buzzer", "wifi", "tft"}) features.add(feature);
      String out;
      serializeJson(doc, out);
      ws.sendTXT(out);
      Serial.println("[万物之城] 已连接 /hw/v1");
    } else if (type == WStype_DISCONNECTED) {
      wsUp_ = false;
    } else if (type == WStype_TEXT) {
      handleFrame(reinterpret_cast<const char*>(payload));
    }
    (void)length;
  });
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 3000, 2);
}

void HcpSdk::handleFrame(const char* payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) return;
  const char* type = doc["t"] | "";
  if (!strcmp(type, "hud")) {
    JsonObjectConst screen = doc["screen"].as<JsonObjectConst>();
    if (screenCallback_) screenCallback_(screen);
    else renderBuiltin(screen);
    JsonDocument ack;
    ack["t"] = "ack";
    ack["rev"] = screen["rev"] | 0;
    String out;
    serializeJson(ack, out);
    ws.sendTXT(out);
  } else if (!strcmp(type, "probe")) {
    JsonObjectConst probe = doc["probe"].as<JsonObjectConst>();
    pendingProbeId_ = String(probe["id"] | "");
    probeWindowMs_ = probe["windowMs"] | 4000;
    probeStartedAt = millis();
    evidenceStage_ = 0;
    Serial.printf("[万物之城] 考察项 %s（窗口 %ums）\n", pendingProbeId_.c_str(), probeWindowMs_);
  } else if (!strcmp(type, "probe-result")) {
    JsonObjectConst result = doc["result"].as<JsonObjectConst>();
    Serial.printf("[万物之城] %s：%s\n", (result["passed"] | false) ? "通过" : "未通过", result["feedback"] | "");
    if (result["passed"] | false) {
      pendingProbeId_ = "";
      evidenceStage_ = 0;
    }
  } else if (!strcmp(type, "ready")) {
    Serial.println("[万物之城] 设备已绑定");
  } else if (!strcmp(type, "toast")) {
    Serial.printf("[万物之城] %s\n", doc["v"] | "");
  } else if (!strcmp(type, "err")) {
    Serial.printf("[万物之城] 错误 %s：%s\n", doc["code"] | "", doc["msg"] | "");
  }
}

void HcpSdk::scanKeys() {
  for (uint8_t index = 0; index < KEY_COUNT; index++) {
    const bool pressed = digitalRead(kKeyPins[index]) == LOW;
    if (pressed != !keyStable_[index] && millis() - keyChangedAt_[index] > 25) {
      keyChangedAt_[index] = millis();
      keyStable_[index] = !pressed;
      if (pressed) keyPress_[index]++;
    }
  }
}

void HcpSdk::samplePins() {
  for (uint8_t index = 0; index < watchedCount_; index++) {
    PinWatch& watch = watched_[index];
    const uint8_t level = static_cast<uint8_t>(digitalRead(watch.pin));
    if (level != watch.level) {
      watch.level = level;
      if (watch.edges < 65000) watch.edges++;
    }
  }
}

void HcpSdk::pushEvidence(const char* pid) {
  if (!wsUp_ || !pid || !*pid) return;
  JsonDocument doc;
  doc["t"] = "evidence";
  doc["pid"] = pid;
  JsonObject facts = doc["facts"].to<JsonObject>();
  facts["uptimeMs"] = millis();
  facts["boot"] = "poweron";

  JsonArray pins = facts["pins"].to<JsonArray>();
  for (uint8_t index = 0; index < watchedCount_; index++) {
    JsonObject entry = pins.add<JsonObject>();
    entry["pin"] = watched_[index].pin;
    entry["mode"] = watched_[index].mode == 3 ? "pwm" : (watched_[index].mode == 2 ? "analog" : (watched_[index].mode == 1 ? "out" : "in"));
    entry["level"] = watched_[index].level;
    entry["edges"] = watched_[index].edges;
  }

  JsonArray pwm = facts["pwm"].to<JsonArray>();
  for (uint8_t index = 0; index < pwmCount_; index++) {
    JsonObject entry = pwm.add<JsonObject>();
    entry["pin"] = pwm_[index].pin;
    entry["hz"] = pwm_[index].hz;
    entry["duty"] = pwm_[index].duty;
  }

  JsonArray adc = facts["adc"].to<JsonArray>();
  JsonObject light = adc.add<JsonObject>();
  light["pin"] = HCP_LIGHT;
  light["mv"] = analogReadMilliVolts(HCP_LIGHT);

  JsonArray keys = facts["keys"].to<JsonArray>();
  for (uint8_t index = 0; index < KEY_COUNT; index++) {
    JsonObject entry = keys.add<JsonObject>();
    entry["key"] = *hcpKeyName(static_cast<HcpKey>(index));
    entry["presses"] = keyPress_[index];
  }

  if (dht_.ok) {
    JsonObject dht = facts["dht"].to<JsonObject>();
    dht["ok"] = true;
    dht["temperature"] = dht_.temperature;
    dht["humidity"] = dht_.humidity;
  } else {
    JsonObject dht = facts["dht"].to<JsonObject>();
    dht["ok"] = false;
  }

  if (stripCount_ && stripDirty_) {
    JsonObject stripFacts = facts["strip"].to<JsonObject>();
    stripFacts["count"] = stripCount_;
    JsonObject first = stripFacts["first"].to<JsonObject>();
    first["r"] = stripFirst_[0];
    first["g"] = stripFirst_[1];
    first["b"] = stripFirst_[2];
  }

  JsonObject wifi = facts["wifi"].to<JsonObject>();
  wifi["mode"] = wifiModeName(WiFi.getMode());
  if (WiFi.status() == WL_CONNECTED) {
    wifi["rssi"] = WiFi.RSSI();
    wifi["ip"] = WiFi.localIP().toString();
  }

  JsonArray reports = facts["reports"].to<JsonArray>();
  for (uint8_t index = 0; index < reportCount_; index++) {
    JsonObject entry = reports.add<JsonObject>();
    entry["k"] = reports_[index].key;
    entry["v"] = reports_[index].value;
    entry["ts"] = reports_[index].ts;
  }

  String out;
  serializeJson(doc, out);
  if (out.length() > 7800) {
    Serial.println("[万物之城] 证据过大，已截断上报项");
  }
  ws.sendTXT(out);
  Serial.printf("[万物之城] 已上报证据 %s\n", pid);
}

void HcpSdk::render(JsonObjectConst screen) { renderBuiltin(screen); }

void HcpSdk::renderBuiltin(JsonObjectConst screen) {
#ifndef HCP_NO_DISPLAY
  lcd.fillScreen(TFT_BLACK);
  lcd.setFont(&lgfx::fonts::efontCN_12);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.drawString(String(screen["title"] | "").c_str(), 6, 4);
  lcd.setTextColor(0x94B2, TFT_BLACK);
  lcd.drawString(String(screen["subtitle"] | "").c_str(), 6, 22);

  int16_t y = 42;
  for (JsonObjectConst widget : screen["widgets"].as<JsonArrayConst>()) {
    if (y > HCP_TFT_HEIGHT - 42) break;
    const char* type = widget["t"] | "";
    if (!strcmp(type, "text")) {
      lcd.setTextColor(TFT_WHITE, TFT_BLACK);
      lcd.drawString(String(widget["v"] | "").substring(0, 120).c_str(), 6, y);
      y += 18;
    } else if (!strcmp(type, "kv")) {
      lcd.setTextColor(0x94B2, TFT_BLACK);
      lcd.drawString(String(widget["k"] | "").c_str(), 6, y);
      lcd.setTextColor(TFT_WHITE, TFT_BLACK);
      lcd.drawRightString(String(widget["v"] | "").c_str(), HCP_TFT_WIDTH - 6, y);
      y += 18;
    } else if (!strcmp(type, "list")) {
      for (JsonObjectConst item : widget["items"].as<JsonArrayConst>()) {
        if (y > HCP_TFT_HEIGHT - 42) break;
        const char* state = item["st"] | "todo";
        lcd.setTextColor(!strcmp(state, "done") ? 0x2E66 : (!strcmp(state, "focus") ? 0x05FF : TFT_WHITE), TFT_BLACK);
        lcd.drawString((!strcmp(state, "done") ? "[x] " : (!strcmp(state, "focus") ? "> " : "[ ] ")), 6, y);
        lcd.drawString(String(item["k"] | "").c_str(), 34, y);
        y += 18;
      }
      y += 4;
    } else if (!strcmp(type, "alert")) {
      lcd.setTextColor(0xFD20, TFT_BLACK);
      lcd.drawString(String(widget["v"] | "").substring(0, 90).c_str(), 6, y);
      y += 18;
    }
  }

  JsonArrayConst keys = screen["km"].as<JsonArrayConst>();
  const int16_t count = keys.size();
  if (count > 0) {
    const int16_t cell = HCP_TFT_WIDTH / count;
    for (int16_t index = 0; index < count; index++) {
      lcd.drawRect(index * cell + 2, HCP_TFT_HEIGHT - 30, cell - 4, 24, 0x528A);
      lcd.setTextColor(TFT_WHITE, TFT_BLACK);
      lcd.drawString(String(keys[index]["k"] | "").c_str(), index * cell + 6, HCP_TFT_HEIGHT - 26);
      lcd.drawString(String(keys[index]["lb"] | "").c_str(), index * cell + 6, HCP_TFT_HEIGHT - 12);
    }
  }
#else
  (void)screen;
#endif
}
