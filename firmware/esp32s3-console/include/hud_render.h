#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include "config.h"

/**
 * HUD 渲染器：只负责把服务器下发的语义控件画出来，不含任何游戏规则。
 * 控件类型见 docs/hardware/HCP-v1.md 第 6 节。
 * 屏幕坐标系：0..SCREEN_WIDTH x 0..SCREEN_HEIGHT，底部 32px 固定为按键条。
 */
class HudRenderer {
 public:
  void begin();
  void draw(JsonObjectConst screen);
  void banner(const char* text, uint16_t color);
  static constexpr int16_t kStatusHeight = 20;
  static constexpr int16_t kKeyBarHeight = 32;
  int16_t contentBottom() const { return SCREEN_HEIGHT - kKeyBarHeight; }

 private:
  void keyBar(JsonArrayConst keys);
  void drawText(JsonObjectConst w, int16_t& y);
  void drawKv(JsonObjectConst w, int16_t& y);
  void drawList(JsonObjectConst w, int16_t& y);
  void drawGauge(JsonObjectConst w, int16_t& y);
  void drawBar(JsonObjectConst w, int16_t& y);
  void drawSpark(JsonObjectConst w, int16_t& y);
  void drawAlert(JsonObjectConst w, int16_t& y);
  int16_t wrapText(const char* text, int16_t x, int16_t y, int16_t width, int16_t maxLines, uint16_t color);
};
