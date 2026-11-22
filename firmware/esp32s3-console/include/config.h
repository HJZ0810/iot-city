#pragma once

/**
 * ============================================================
 *  用户需要改的地方全部集中在本文件
 *  协议规范：docs/hardware/HCP-v1.md
 *  接入说明：docs/hardware/ONBOARDING.md
 *  板端关卡：docs/hardware/BOARD-TRACK.md
 *
 *  引脚依据《SCH_TFT版_2024-09-24》原理图（嘉立创 ESP32-S3 功能板 TFT 版）
 * ============================================================
 */

/* ---------- 必填 1/2：Wi-Fi（2.4GHz，ESP32 不支持 5GHz） ---------- */
#define DEFAULT_WIFI_SSID "your-wifi-ssid"
#define DEFAULT_WIFI_PASS "your-wifi-password"

/* ---------- 必填 3：服务器域名（只填主机名，不要带 https:// 和路径） ---------- */
#define DEFAULT_SERVER_HOST "iot.luo-jin-ai.com"
#define DEFAULT_SERVER_PORT 443

/* ---------- 必填 4：设备型号（会显示在网页“我的终端”里） ---------- */
#define DEVICE_MODEL "JLC-ESP32S3-TFT"
#define FIRMWARE_VERSION "0.2.0"

/* ---------- 可选：批量烧录密钥，与服务器 HW_ENROLL_KEY 一致时才需要 ---------- */
// #define PROVISION_KEY "向管理员索取"

/* ---------- 可选：TLS 校验。0 = 跳过证书校验（校园内网可用） ---------- */
/* 1 = 需要把服务器证书链放入 src/ca_cert.h 的 ROOT_CA_PEM */
#define DEVICE_TLS_VERIFY 0

/* ============================================================
 *  引脚定义：与原理图一致，改动前请先核对丝印
 * ============================================================ */

/* 1.8" ST7735 屏幕（SPI）。原理图标注的引脚组为 IO9/10/11/12/21/38，
 * 具体 SCLK/MOSI/CS/DC/RST/BL 的对应关系以板上丝印为准，首次上板请逐一确认。 */
#define PIN_TFT_SCLK 12
#define PIN_TFT_MOSI 11
#define PIN_TFT_CS 10
#define PIN_TFT_DC 9
#define PIN_TFT_RST 21
#define PIN_TFT_BL 38

/* 六个按键：上/下/左/右/A/B，另一端接 GND，按下为低电平 */
#define PIN_KEY_UP 17
#define PIN_KEY_DOWN 18
#define PIN_KEY_LEFT 15
#define PIN_KEY_RIGHT 16
#define PIN_KEY_A 13
#define PIN_KEY_B 14

/* 板载外设 */
#define PIN_LED1 4
#define PIN_LED2 5
#define PIN_LED3 6
#define PIN_LED4 7
#define PIN_BUZZER 47
#define PIN_RELAY 2
#define PIN_LIGHT 1
#define PIN_DHT 8
#define PIN_STRIP 48

#define SCREEN_WIDTH 320
#define SCREEN_HEIGHT 240
#define HEARTBEAT_SECONDS 20
