#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

/**
 * 万物之城 板端 SDK（HCP/1）
 * ------------------------------------------------------------------
 * 学生只需要写三件事：
 *   1) setup 里调用 HCP.begin()
 *   2) loop 里调用 HCP.loop()
 *   3) 按题目要求驱动外设；需要上报读数时调用 HCP.report("key", 值)
 *
 * SDK 负责：联网登记、握手上屏、按键扫描、证据采集与上报、屏幕渲染。
 * SDK 不负责：替学生实现功能。灯亮不亮、PWM 对不对，仍由学生代码决定。
 * 规范见 docs/hardware/BOARD-TRACK.md
 */

enum HcpKey : uint8_t {
  KEY_UP = 0,
  KEY_DOWN = 1,
  KEY_LEFT = 2,
  KEY_RIGHT = 3,
  KEY_A = 4,
  KEY_B = 5,
  KEY_COUNT = 6,
};

struct HcpDhtReading {
  bool ok = false;
  float temperature = 0;
  float humidity = 0;
};

class HcpSdk {
 public:
  /** 连接网络、登记设备、开始收题。可传入学号用于屏幕标题。 */
  void begin(const char* studentLabel = nullptr);

  /** 必须每轮调用：收发协议、扫描按键、按时上报证据。 */
  void loop();

  /** 接管屏幕渲染；不设置时用内置简易渲染（只画 text/list/kv/alert）。 */
  void onScreen(void (*callback)(JsonObjectConst screen));

  /** 主动上报一个读数。服务器会用硬件实测值交叉校验。 */
  void report(const char* key, double value);

  /** 六个按键自开机以来的累计按下次数（已消抖）。 */
  uint32_t keyPresses(HcpKey key) const;

  /** PWM 初始化（兼容 arduino-esp32 2.x / 3.x），同时登记为证据来源。 */
  bool ledc(uint8_t pin, uint32_t hz, float dutyPercent);

  /** 无源蜂鸣器方波，默认 GPIO47、50% 占空比。 */
  bool tone(uint32_t hz, float dutyPercent = 50);

  /** 读 DHT11（GPIO8），结果同时记为证据；失败时 ok=false。 */
  HcpDhtReading readDht();

  /** WS2812 灯带（GPIO48）。 */
  void stripBegin(uint16_t count);
  void setStripPixel(uint16_t index, uint8_t r, uint8_t g, uint8_t b);
  void showStrip();

  /** 若用原生 API 配 PWM，需要显式登记通道，否则服务器读不到 PWM 证据。 */
  void watchPwm(uint8_t pin, uint8_t channel);

  const char* deviceId() const { return deviceId_; }
  bool online() const { return wsUp_; }

 private:
  void connectWifi();
  bool enroll();
  void startSocket();
  void handleFrame(const char* payload);
  void pushEvidence(const char* pid);
  void scanKeys();
  void samplePins();
  void render(JsonObjectConst screen);
  void renderBuiltin(JsonObjectConst screen);

  String deviceId_;
  String token_;
  bool wsUp_ = false;
  uint32_t lastPingAt_ = 0;
  uint32_t lastEvidenceAt_ = 0;
  String pendingProbeId_;
  uint32_t probeDeadline_ = 0;
  uint32_t probeWindowMs_ = 4000;
  uint8_t evidenceStage_ = 0;

  struct PinWatch {
    uint8_t pin;
    uint8_t mode;   // 0=in 1=out 2=analog 3=pwm
    uint8_t level;
    uint16_t edges;
  } watched_[14];
  uint8_t watchedCount_ = 0;

  struct PwmWatch {
    uint8_t pin;
    uint8_t channel;
    uint32_t hz;
    float duty;
  } pwm_[4];
  uint8_t pwmCount_ = 0;

  uint32_t keyPress_[KEY_COUNT] = {0, 0, 0, 0, 0, 0};
  bool keyStable_[KEY_COUNT];
  uint32_t keyChangedAt_[KEY_COUNT] = {0, 0, 0, 0, 0, 0};

  HcpDhtReading dht_;
  uint16_t stripCount_ = 0;
  uint8_t stripFirst_[3] = {0, 0, 0};
  bool stripDirty_ = false;

  struct ReportSlot {
    char key[24];
    double value;
    uint32_t ts;
  } reports_[8];
  uint8_t reportCount_ = 0;

  void (*screenCallback_)(JsonObjectConst) = nullptr;
};

extern HcpSdk HCP;

/** 六个按键的索引常量，便于学生书写：HCP.keyPresses(KEY_A)。 */
inline const char* hcpKeyName(HcpKey key) {
  static const char* names[KEY_COUNT] = {"up", "down", "left", "right", "a", "b"};
  return key < KEY_COUNT ? names[key] : "?";
}
