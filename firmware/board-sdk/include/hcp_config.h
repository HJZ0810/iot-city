#pragma once

/**
 * 学生/教师需要修改的配置。烧录前确认这四项。
 * 详细说明见 docs/hardware/ONBOARDING.md
 */
#define HCP_WIFI_SSID "your-wifi-ssid"       // 2.4GHz，不支持 5GHz
#define HCP_WIFI_PASS "your-wifi-password"   // WPA2 个人版
#define HCP_SERVER_HOST "iot.luo-jin-ai.com" // 只填域名，不要带 https:// 与路径
#define HCP_SERVER_PORT 443

/* 可选：服务器配置了 HW_ENROLL_KEY 时才需要 */
// #define HCP_PROVISION_KEY "向管理员索取"

/* 可选：0 = 跳过 TLS 证书校验（校园内网）；1 = 需提供 CA 证书 */
#define HCP_TLS_VERIFY 0

/* 可选：不需要屏幕时定义此宏，省 flash */
// #define HCP_NO_DISPLAY
