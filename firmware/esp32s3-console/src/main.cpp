#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "hud_render.h"
#if DEVICE_TLS_VERIFY
#include "ca_cert.h"
#endif

/**
 * 万物之城 HCP/1 终端固件（参考实现）
 * ------------------------------------------------------------------
 * 职责边界：本固件不含任何游戏规则。
 *   - 上行：只上报「按了哪个键」以及心跳；
 *   - 下行：只渲染服务器下发的 HUD 语义控件；
 *   - 语义：每个键要执行什么，由服务器在 HUD 帧的 km 字段里给出。
 * 因此固件被刷改也无法凭空生成游戏命令，作弊面收敛在服务器一侧。
 */

namespace {

Preferences prefs;
WebSocketsClient ws;
HudRenderer hud;

struct Settings {
  String ssid;
  String pass;
  String host;
  uint16_t port = DEFAULT_SERVER_PORT;
  String token;
  String deviceId;
} cfg;

constexpr int kKeyCount = 5;
const char* kKeyIds[kKeyCount] = {"K1", "K2", "K3", "K4", "K5"};
const int kKeyPins[kKeyCount] = {PIN_KEY1, PIN_KEY2, PIN_KEY3, PIN_KEY4, PIN_KEY5};

bool keyStable[kKeyCount] = {true, true, true, true, true};
uint32_t keyChangedAt[kKeyCount] = {0, 0, 0, 0, 0};
uint32_t inputSeq = 0;
uint32_t bootNonce = 0;
uint32_t lastPingAt = 0;
uint32_t lastWifiCheck = 0;
bool wsUp = false;

String installationId() {
  const uint64_t mac = ESP.getEfuseMac();
  char buffer[17];
  snprintf(buffer, sizeof(buffer), "%08x%08x", static_cast<uint32_t>(mac & 0xffffffffULL), static_cast<uint32_t>(mac >> 32));
  return String(buffer);
}

void loadSettings() {
  prefs.begin("iotcity", true);
  cfg.ssid = prefs.getString("ssid", DEFAULT_WIFI_SSID);
  cfg.pass = prefs.getString("pass", DEFAULT_WIFI_PASS);
  cfg.host = prefs.getString("host", DEFAULT_SERVER_HOST);
  cfg.port = prefs.getUShort("port", DEFAULT_SERVER_PORT);
  cfg.token = prefs.getString("token", "");
  cfg.deviceId = prefs.getString("devid", "");
  prefs.end();
}

void saveString(const char* key, const String& value) {
  prefs.begin("iotcity", false);
  prefs.putString(key, value);
  prefs.end();
}

/* ----------------------------- 网络与登记 ----------------------------- */

bool connectWifi(uint32_t timeoutMs = 20000) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < timeoutMs) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

bool secureClient(WiFiClientSecure& client) {
#if DEVICE_TLS_VERIFY
  // 证书链写在 src/ca_cert.h 的 ROOT_CA_PEM
  client.setCACert(ROOT_CA_PEM);
#else
  client.setInsecure();
#endif
  return true;
}

/** 首次开机或恢复出厂后的自动登记：换取设备令牌与 8 位配对码。 */
bool enrollDevice() {
  WiFiClientSecure client;
  secureClient(client);
  HTTPClient https;
  const String url = String("https://") + cfg.host + ":" + String(cfg.port) + "/api/hw/enroll";
  if (!https.begin(client, url)) {
    Serial.println("[enroll] 无法建立 HTTPS 连接");
    return false;
  }
  https.addHeader("Content-Type", "application/json");
#ifdef PROVISION_KEY
  https.addHeader("x-provision-key", PROVISION_KEY);
#endif

  JsonDocument doc;
  doc["installationId"] = installationId();
  doc["model"] = DEVICE_MODEL;
  doc["fw"] = FIRMWARE_VERSION;
  JsonObject caps = doc["caps"].to<JsonObject>();
  caps["w"] = SCREEN_WIDTH;
  caps["h"] = SCREEN_HEIGHT;
  caps["color"] = "rgb565";
  caps["touch"] = false;
  caps["rotary"] = false;
  caps["lang"] = "zh";
  JsonArray keys = caps["keys"].to<JsonArray>();
  for (const char* key : kKeyIds) keys.add(key);

  String body;
  serializeJson(doc, body);
  const int status = https.POST(body);
  String response = https.getString();
  https.end();
  if (status != 200) {
    Serial.printf("[enroll] 失败 status=%d %s\n", status, response.c_str());
    return false;
  }

  JsonDocument reply;
  if (deserializeJson(reply, response) != DeserializationError::Ok) return false;
  JsonObjectConst data = reply["data"].as<JsonObjectConst>();
  cfg.deviceId = data["deviceId"] | "";
  cfg.token = data["token"] | "";
  saveString("devid", cfg.deviceId);
  saveString("token", cfg.token);

  const char* pair = data["pairCode"] | "";
  Serial.printf("[enroll] 设备号 %s\n[enroll] 配对码 %s（10 分钟内有效）\n", cfg.deviceId.c_str(), pair);
  hud.banner(cfg.token.length() ? "已登记，等待网页绑定" : "登记失败", 0x2E66);
  return cfg.token.length() > 0;
}

/* ----------------------------- 协议收发 ----------------------------- */

void sendJson(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
}

void sendHello() {
  JsonDocument doc;
  doc["t"] = "hello";
  doc["v"] = "HCP/1";
  doc["fw"] = FIRMWARE_VERSION;
  JsonObject caps = doc["caps"].to<JsonObject>();
  caps["w"] = SCREEN_WIDTH;
  caps["h"] = SCREEN_HEIGHT;
  caps["color"] = "rgb565";
  caps["touch"] = false;
  caps["rotary"] = false;
  caps["lang"] = "zh";
  JsonArray keys = caps["keys"].to<JsonArray>();
  for (const char* key : kKeyIds) keys.add(key);
  sendJson(doc);
  Serial.println("[ws] hello 已发送");
}

void handleFrame(const char* payload) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[ws] 帧解析失败：%s\n", error.c_str());
    return;
  }
  const char* type = doc["t"] | "";
  if (!strcmp(type, "hud")) {
    JsonObjectConst screen = doc["screen"].as<JsonObjectConst>();
    hud.draw(screen);
    JsonDocument ack;
    ack["t"] = "ack";
    ack["rev"] = screen["rev"] | 0;
    sendJson(ack);
  } else if (!strcmp(type, "hello")) {
    const char* name = doc["dev"]["name"] | "终端";
    Serial.printf("[ws] 握手成功 设备=%s 状态=%s\n", name, doc["dev"]["status"] | "?");
    if (!strcmp(doc["dev"]["status"] | "", "pending")) hud.banner("请在网页输入配对码绑定", 0xFD20);
  } else if (!strcmp(type, "ready")) {
    Serial.printf("[ws] 绑定完成：%s\n", doc["dev"]["name"] | "");
    hud.banner("已绑定，等待选择任务", 0x2E66);
  } else if (!strcmp(type, "toast")) {
    hud.banner(doc["v"] | "", !strcmp(doc["level"] | "", "error") ? 0xF800 : 0xFD20);
  } else if (!strcmp(type, "err")) {
    Serial.printf("[ws] 错误 %s：%s\n", doc["code"] | "", doc["msg"] | "");
    hud.banner(doc["msg"] | "操作被拒绝", 0xF800);
  } else if (!strcmp(type, "bye")) {
    Serial.println("[ws] 服务器要求断开");
    ws.disconnect();
  } else if (!strcmp(type, "pong")) {
    // 心跳正常，无需处理
  }
}

void onSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsUp = true;
      Serial.println("[ws] 已连接 /hw/v1");
      sendHello();
      break;
    case WStype_DISCONNECTED:
      wsUp = false;
      hud.banner("连接中断，正在重连", 0xF800);
      Serial.println("[ws] 连接断开");
      break;
    case WStype_TEXT:
      handleFrame(reinterpret_cast<const char*>(payload));
      break;
    case WStype_ERROR:
      Serial.println("[ws] 传输错误");
      break;
    default:
      break;
  }
  (void)length;
}

void startSocket() {
  if (!cfg.token.length()) return;
  ws.setExtraHeaders((String("Authorization: Bearer ") + cfg.token + "\r\n").c_str());
#if DEVICE_TLS_VERIFY
  ws.beginSslWithCA(cfg.host.c_str(), cfg.port, "/hw/v1", ROOT_CA_PEM);
#else
  ws.beginSSL(cfg.host.c_str(), cfg.port, "/hw/v1");
#endif
  ws.onEvent(onSocket);
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 3000, 2);
}

/* ----------------------------- 按键输入 ----------------------------- */

void sendKey(int index) {
  if (!wsUp) return;
  char id[24];
  snprintf(id, sizeof(id), "%06x%08lx%02x", static_cast<unsigned>(bootNonce & 0xffffff), static_cast<unsigned long>(millis()), static_cast<unsigned>(inputSeq++ & 0xff));
  JsonDocument doc;
  doc["t"] = "input";
  doc["id"] = id;
  JsonObject ev = doc["ev"].to<JsonObject>();
  ev["t"] = "key";
  ev["k"] = kKeyIds[index];
  ev["a"] = "press";
  sendJson(doc);
  Serial.printf("[key] %s id=%s\n", kKeyIds[index], id);
}

void pollKeys() {
  for (int i = 0; i < kKeyCount; i++) {
    const bool pressed = digitalRead(kKeyPins[i]) == LOW;
    if (pressed != keyStable[i] && millis() - keyChangedAt[i] > 30) {
      keyChangedAt[i] = millis();
      keyStable[i] = pressed;
      if (pressed) sendKey(i);
    }
  }
}

/* ----------------------------- 串口配置台 ----------------------------- */

void printHelp() {
  Serial.println(F("命令："));
  Serial.println(F("  help                     显示本帮助"));
  Serial.println(F("  status                   查看当前配置与连接状态"));
  Serial.println(F("  wifi <ssid> <password>   设置 Wi-Fi 并保存"));
  Serial.println(F("  server <host> [port]     设置服务器域名（默认 443）"));
  Serial.println(F("  enroll                   重新登记设备并生成新配对码"));
  Serial.println(F("  reset                    清除令牌重新登记"));
}

String serialLine;

void handleCommand(String line) {
  line.trim();
  if (!line.length()) return;
  if (line == "help") return printHelp();
  if (line == "status") {
    Serial.printf("设备型号 %s 固件 %s\n", DEVICE_MODEL, FIRMWARE_VERSION);
    Serial.printf("安装标识 %s 设备号 %s\n", installationId().c_str(), cfg.deviceId.c_str());
    Serial.printf("Wi-Fi %s (%s) RSSI=%d\n", cfg.ssid.c_str(), WiFi.status() == WL_CONNECTED ? "已连接" : "未连接", WiFi.RSSI());
    Serial.printf("服务器 %s:%u 令牌 %s\n", cfg.host.c_str(), cfg.port, cfg.token.length() ? "已保存" : "无");
    Serial.printf("通道 %s\n", wsUp ? "在线" : "离线");
    return;
  }
  if (line.startsWith("wifi ")) {
    const int first = line.indexOf(' ');
    const int second = line.indexOf(' ', first + 1);
    if (second < 0) return Serial.println(F("用法：wifi <ssid> <password>"));
    cfg.ssid = line.substring(first + 1, second);
    cfg.pass = line.substring(second + 1);
    saveString("ssid", cfg.ssid);
    saveString("pass", cfg.pass);
    Serial.println(F("Wi-Fi 已保存，正在重启…"));
    delay(300);
    ESP.restart();
    return;
  }
  if (line.startsWith("server ")) {
    const int first = line.indexOf(' ');
    const int second = line.indexOf(' ', first + 1);
    cfg.host = second < 0 ? line.substring(first + 1) : line.substring(first + 1, second);
    cfg.host.replace("https://", "");
    cfg.host.replace("wss://", "");
    while (cfg.host.endsWith("/")) cfg.host.remove(cfg.host.length() - 1);
    cfg.port = second < 0 ? 443 : static_cast<uint16_t>(line.substring(second + 1).toInt());
    saveString("host", cfg.host);
    prefs.begin("iotcity", false);
    prefs.putUShort("port", cfg.port);
    prefs.end();
    Serial.printf("服务器已保存为 %s:%u\n", cfg.host.c_str(), cfg.port);
    return;
  }
  if (line == "enroll" || line == "reset") {
    prefs.begin("iotcity", false);
    prefs.remove("token");
    prefs.remove("devid");
    prefs.end();
    cfg.token = "";
    cfg.deviceId = "";
    Serial.println(F("已清除令牌，正在重新登记…"));
    delay(300);
    ESP.restart();
    return;
  }
  Serial.println(F("未知命令，输入 help 查看用法"));
}

void pollSerial() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      handleCommand(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 120) {
      serialLine += c;
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  bootNonce = esp_random();
  loadSettings();
  for (int pin : kKeyPins) pinMode(pin, INPUT_PULLUP);

  hud.begin();
  hud.banner("正在初始化…", 0x0861);
  Serial.printf("\n万物之城终端 %s / %s\n", DEVICE_MODEL, FIRMWARE_VERSION);

  if (!connectWifi()) {
    Serial.println(F("[wifi] 连接失败。请执行：wifi <ssid> <password>"));
    hud.banner("Wi-Fi 未连接，请用串口配置", 0xF800);
    return;
  }
  Serial.printf("[wifi] 已连接 %s\n", WiFi.localIP().toString().c_str());

  if (!cfg.token.length() && !enrollDevice()) {
    hud.banner("设备登记失败，检查服务器地址", 0xF800);
    return;
  }
  startSocket();
}

void loop() {
  pollSerial();
  pollKeys();

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiCheck > 5000) {
      lastWifiCheck = millis();
      Serial.println(F("[wifi] 断开，尝试重连"));
      WiFi.reconnect();
    }
  } else if (!wsUp && cfg.token.length() && millis() - lastWifiCheck > 15000) {
    // WebSocket 库自带重连；这里只做兜底重启
    lastWifiCheck = millis();
    if (millis() > 120000) ESP.restart();
  }

  ws.loop();

  if (wsUp && millis() - lastPingAt > HEARTBEAT_SECONDS * 1000UL) {
    lastPingAt = millis();
    JsonDocument doc;
    doc["t"] = "ping";
    doc["ts"] = millis();
    sendJson(doc);
  }
  delay(5);
}
