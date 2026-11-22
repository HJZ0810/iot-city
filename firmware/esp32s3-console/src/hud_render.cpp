#include "hud_render.h"

/* ----------------------------- 面板驱动 ----------------------------- */
class LGFX_Console : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789 panel_;
  lgfx::Bus_SPI bus_;
  lgfx::Light_PWM light_;

 public:
  LGFX_Console() {
    {
      auto cfg = bus_.config();
      cfg.spi_host = SPI2_HOST;
      cfg.spi_mode = 0;
      cfg.freq_write = 40000000;
      cfg.freq_read = 16000000;
      cfg.spi_3wire = false;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = PIN_TFT_SCLK;
      cfg.pin_mosi = PIN_TFT_MOSI;
      cfg.pin_miso = -1;
      cfg.pin_dc = PIN_TFT_DC;
      bus_.config(cfg);
      panel_.setBus(&bus_);
    }
    {
      auto cfg = panel_.config();
      cfg.pin_cs = PIN_TFT_CS;
      cfg.pin_rst = PIN_TFT_RST;
      cfg.pin_busy = -1;
      cfg.panel_width = SCREEN_WIDTH;
      cfg.panel_height = SCREEN_HEIGHT;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.readable = false;
      cfg.invert = true;
      cfg.rgb_order = false;
      cfg.dlen_16bit = false;
      cfg.bus_shared = false;
      panel_.config(cfg);
    }
    {
      auto cfg = light_.config();
      cfg.pin_bl = PIN_TFT_BL;
      cfg.invert = false;
      cfg.freq = 12000;
      cfg.pwm_channel = 7;
      light_.config(cfg);
      panel_.setLight(&light_);
    }
    setPanel(&panel_);
  }
};

static LGFX_Console lcd;

namespace {
constexpr uint16_t kBg = 0x10A2;        // 深空蓝
constexpr uint16_t kPanel = 0x0861;
constexpr uint16_t kText = TFT_WHITE;
constexpr uint16_t kDim = 0x94B2;
constexpr uint16_t kAccent = 0x05FF;
constexpr uint16_t kOk = 0x2E66;
constexpr uint16_t kWarn = 0xFD20;
constexpr uint16_t kBad = 0xF800;
constexpr int16_t kPad = 6;

const lgfx::IFont* bodyFont() { return &lgfx::fonts::efontCN_12; }
const lgfx::IFont* titleFont() { return &lgfx::fonts::efontCN_16; }
}  // namespace

void HudRenderer::begin() {
  lcd.init();
  lcd.setRotation(1);
  lcd.setBrightness(200);
  lcd.fillScreen(kBg);
  lcd.setTextColor(kText, kBg);
}

void HudRenderer::banner(const char* text, uint16_t color) {
  lcd.fillRect(0, kStatusHeight, SCREEN_WIDTH, 18, color);
  lcd.setFont(bodyFont());
  lcd.setTextColor(TFT_WHITE, color);
  lcd.drawString(text, kPad, kStatusHeight + 3);
}

/* 中文字符按双宽计算，避免截断半个字形 */
int16_t HudRenderer::wrapText(const char* text, int16_t x, int16_t y, int16_t width, int16_t maxLines, uint16_t color) {
  lcd.setFont(bodyFont());
  lcd.setTextColor(color, kBg);
  const int16_t lineHeight = lcd.fontHeight() + 3;
  const int16_t perLine = (width - 12) / 12 > 1 ? (width - 12) / 12 : 1;
  String line;
  int16_t lines = 0;
  int16_t used = 0;
  size_t bytes = 0;
  const size_t total = strlen(text);
  while (bytes < total && lines < maxLines) {
    const uint8_t lead = static_cast<uint8_t>(text[bytes]);
    const size_t charBytes = lead < 0x80 ? 1 : (lead < 0xE0 ? 2 : (lead < 0xF0 ? 3 : 4));
    if (bytes + charBytes > total) break;
    const int16_t weight = charBytes == 1 ? 1 : 2;
    if (used + weight > perLine) {
      lcd.drawString(line.c_str(), x, y + lines * lineHeight);
      line = "";
      used = 0;
      lines++;
      if (lines >= maxLines) break;
    }
    line.concat(text + bytes, charBytes);
    used += weight;
    bytes += charBytes;
  }
  if (line.length() && lines < maxLines) {
    lcd.drawString(line.c_str(), x, y + lines * lineHeight);
    lines++;
  }
  return y + lines * lineHeight;
}

void HudRenderer::drawText(JsonObjectConst w, int16_t& y) {
  const char* value = w["v"] | "";
  const char* size = w["size"] | "m";
  const bool center = !strcmp(w["align"] | "l", "c");
  if (center) {
    lcd.setFont(!strcmp(size, "l") ? titleFont() : bodyFont());
    lcd.setTextColor(kText, kBg);
    lcd.drawCentreString(value, SCREEN_WIDTH / 2, y + 4);
    y += lcd.fontHeight() + 10;
    return;
  }
  y = wrapText(value, kPad, y + 2, SCREEN_WIDTH, 6, kText) + 4;
}

void HudRenderer::drawKv(JsonObjectConst w, int16_t& y) {
  const char* key = w["k"] | "";
  const char* value = w["v"] | "";
  const char* tone = w["tone"] | "";
  uint16_t color = kText;
  if (!strcmp(tone, "ok")) color = kOk;
  else if (!strcmp(tone, "warn")) color = kWarn;
  else if (!strcmp(tone, "bad")) color = kBad;
  lcd.setFont(bodyFont());
  lcd.setTextColor(kDim, kBg);
  lcd.drawString(key, kPad, y);
  lcd.setTextColor(color, kBg);
  lcd.drawRightString(value, SCREEN_WIDTH - kPad, y);
  y += lcd.fontHeight() + 4;
}

void HudRenderer::drawList(JsonObjectConst w, int16_t& y) {
  if (w["label"].is<const char*>()) {
    lcd.setFont(bodyFont());
    lcd.setTextColor(kDim, kBg);
    lcd.drawString(w["label"] | "", kPad, y);
    y += lcd.fontHeight() + 2;
  }
  lcd.setFont(bodyFont());
  const int16_t lineHeight = lcd.fontHeight() + 4;
  for (JsonObjectConst item : w["items"].as<JsonArrayConst>()) {
    if (y + lineHeight > contentBottom()) break;
    const char* state = item["st"] | "todo";
    const char* mark = !strcmp(state, "done") ? "[x]" : (!strcmp(state, "focus") ? ">" : "[ ]");
    uint16_t color = !strcmp(state, "done") ? kOk : (!strcmp(state, "focus") ? kAccent : kText);
    lcd.setTextColor(color, kBg);
    lcd.drawString(mark, kPad, y);
    lcd.drawString(item["k"] | "", kPad + 28, y);
    y += lineHeight;
  }
  y += 2;
}

void HudRenderer::drawGauge(JsonObjectConst w, int16_t& y) {
  const float value = w["v"] | 0.0f;
  const float min = w["min"] | 0.0f;
  const float max = w["max"] | 100.0f;
  const float ratio = max > min ? constrain((value - min) / (max - min), 0.0f, 1.0f) : 0.0f;
  lcd.setFont(bodyFont());
  lcd.setTextColor(kDim, kBg);
  lcd.drawString(w["label"] | "", kPad, y);
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%.1f%s", value, w["unit"] | "");
  lcd.setTextColor(kText, kBg);
  lcd.drawRightString(buffer, SCREEN_WIDTH - kPad, y);
  y += lcd.fontHeight() + 3;
  lcd.drawRect(kPad, y, SCREEN_WIDTH - 2 * kPad, 10, kDim);
  lcd.fillRect(kPad + 1, y + 1, static_cast<int16_t>((SCREEN_WIDTH - 2 * kPad - 2) * ratio), 8, kAccent);
  y += 16;
}

void HudRenderer::drawBar(JsonObjectConst w, int16_t& y) {
  const float value = w["v"] | 0.0f;
  const float max = w["max"] | 100.0f;
  const float ratio = max > 0 ? constrain(value / max, 0.0f, 1.0f) : 0.0f;
  lcd.setFont(bodyFont());
  lcd.setTextColor(kDim, kBg);
  lcd.drawString(w["label"] | "", kPad, y);
  char buffer[16];
  snprintf(buffer, sizeof(buffer), "%d%%", static_cast<int>(ratio * 100));
  lcd.drawRightString(buffer, SCREEN_WIDTH - kPad, y);
  y += lcd.fontHeight() + 3;
  lcd.drawRect(kPad, y, SCREEN_WIDTH - 2 * kPad, 8, kDim);
  lcd.fillRect(kPad + 1, y + 1, static_cast<int16_t>((SCREEN_WIDTH - 2 * kPad - 2) * ratio), 6, kOk);
  y += 14;
}

void HudRenderer::drawSpark(JsonObjectConst w, int16_t& y) {
  JsonArrayConst points = w["pts"].as<JsonArrayConst>();
  const int16_t count = points.size();
  if (count < 2) return;
  const int16_t height = 40;
  const int16_t width = SCREEN_WIDTH - 2 * kPad;
  float min = points[0].as<float>();
  float max = min;
  for (JsonVariantConst point : points) {
    const float value = point.as<float>();
    min = min < value ? min : value;
    max = max > value ? max : value;
  }
  if (max - min < 0.001f) max = min + 1.0f;
  if (w["label"].is<const char*>()) {
    lcd.setFont(bodyFont());
    lcd.setTextColor(kDim, kBg);
    lcd.drawString(w["label"] | "", kPad, y);
  }
  const int16_t top = y + 14;
  lcd.drawRect(kPad, top, width, height, kPanel);
  int16_t previousX = kPad;
  int16_t previousY = top + height - static_cast<int16_t>((points[0].as<float>() - min) / (max - min) * height);
  for (int16_t i = 1; i < count; i++) {
    const int16_t px = kPad + static_cast<int32_t>(width) * i / (count - 1);
    const int16_t py = top + height - static_cast<int16_t>((points[i].as<float>() - min) / (max - min) * height);
    lcd.drawLine(previousX, previousY, px, py, kAccent);
    previousX = px;
    previousY = py;
  }
  y = top + height + 6;
}

void HudRenderer::drawAlert(JsonObjectConst w, int16_t& y) {
  const char* level = w["level"] | "info";
  const uint16_t color = !strcmp(level, "error") ? kBad : (!strcmp(level, "warn") ? kWarn : kPanel);
  const int16_t top = y;
  const int16_t used = wrapText(w["v"] | "", kPad + 4, y + 3, SCREEN_WIDTH - 2 * kPad, 3, kText);
  lcd.drawRect(kPad, top, SCREEN_WIDTH - 2 * kPad, used - top + 4, color);
  y = used + 6;
}

void HudRenderer::keyBar(JsonArrayConst keys) {
  const int16_t top = SCREEN_HEIGHT - kKeyBarHeight;
  lcd.fillRect(0, top, SCREEN_WIDTH, kKeyBarHeight, kPanel);
  const int16_t count = keys.size();
  if (!count) return;
  const int16_t cell = SCREEN_WIDTH / count;
  lcd.setFont(bodyFont());
  for (int16_t i = 0; i < count; i++) {
    JsonObjectConst key = keys[i];
    const bool primary = !strcmp(key["tone"] | "", "primary");
    lcd.drawRect(i * cell, top + 2, cell - 2, kKeyBarHeight - 5, primary ? kAccent : kDim);
    lcd.setTextColor(primary ? kAccent : kText, kPanel);
    char label[24];
    snprintf(label, sizeof(label), "%s %s", key["k"] | "", key["lb"] | "");
    lcd.drawString(label, i * cell + 4, top + 10);
  }
}

void HudRenderer::draw(JsonObjectConst screen) {
  lcd.fillScreen(kBg);
  lcd.fillRect(0, 0, SCREEN_WIDTH, kStatusHeight, kPanel);
  lcd.setFont(bodyFont());
  lcd.setTextColor(kText, kPanel);
  lcd.drawString(screen["title"] | "", kPad, 4);
  lcd.setTextColor(kDim, kPanel);
  char status[48];
  snprintf(status, sizeof(status), "%us  %d", (unsigned)(screen["elapsed"] | 0), (int)(screen["score"] | 0));
  lcd.drawRightString(status, SCREEN_WIDTH - kPad, 4);

  int16_t y = kStatusHeight + 4;
  if (screen["subtitle"].is<const char*>()) {
    lcd.setFont(bodyFont());
    lcd.setTextColor(kDim, kBg);
    lcd.drawString(screen["subtitle"] | "", kPad, y);
    y += lcd.fontHeight() + 4;
  }
  for (JsonObjectConst widget : screen["widgets"].as<JsonArrayConst>()) {
    if (y >= contentBottom() - 8) break;
    const char* type = widget["t"] | "";
    if (!strcmp(type, "text")) drawText(widget, y);
    else if (!strcmp(type, "kv")) drawKv(widget, y);
    else if (!strcmp(type, "list")) drawList(widget, y);
    else if (!strcmp(type, "gauge")) drawGauge(widget, y);
    else if (!strcmp(type, "bar")) drawBar(widget, y);
    else if (!strcmp(type, "spark")) drawSpark(widget, y);
    else if (!strcmp(type, "alert")) drawAlert(widget, y);
  }
  keyBar(screen["km"].as<JsonArrayConst>());
}
