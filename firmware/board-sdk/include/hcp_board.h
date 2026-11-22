#pragma once

/**
 * 板型常量：与《SCH_TFT版_2024-09-24》原理图一致。
 * 1.8" ST7735 的引脚组原理图只给出集合 IO9/10/11/12/21/38，
 * 角色映射（SCLK/MOSI/CS/DC/RST/BL）以板上丝印为准，首次上板请逐一核对。
 */
#define HCP_BOARD_ID "jlc-esp32s3-tft"

#define HCP_LED1 4
#define HCP_LED2 5
#define HCP_LED3 6
#define HCP_LED4 7

#define HCP_KEY_UP 17
#define HCP_KEY_DOWN 18
#define HCP_KEY_LEFT 15
#define HCP_KEY_RIGHT 16
#define HCP_KEY_A 13
#define HCP_KEY_B 14

#define HCP_BUZZER 47
#define HCP_RELAY 2
#define HCP_LIGHT 1
#define HCP_DHT 8
#define HCP_STRIP 48

#define HCP_TFT_SCLK 12
#define HCP_TFT_MOSI 11
#define HCP_TFT_CS 10
#define HCP_TFT_DC 9
#define HCP_TFT_RST 21
#define HCP_TFT_BL 38
#define HCP_TFT_WIDTH 320
#define HCP_TFT_HEIGHT 240
