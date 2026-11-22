# 板端 SDK（hcp-sdk 1.0.0）

让一块 ESP32-S3 成为「万物之城」的**可判题终端**：学生写业务代码，SDK 负责联网、上屏、采证、上报。

> 状态说明：本 SDK 为按原理图编写的参考实现，**尚未在真机编译验证**。首次上板请先跑 `examples/b1_01_three_leds`，确认 TFT 引脚与按键极性，再进入正式关卡。

## 一、学生要做的三件事

```cpp
#include "hcp_sdk.h"

void setup() {
  HCP.begin();   // 联网 + 上屏 + 开始收题
}

void loop() {
  HCP.loop();    // 必须每轮调用
  // 这里写题目要求的代码
}
```

需要上报读数时：`HCP.report("temp", 24.5);`

## 二、烧录前改这 4 项（`include/hcp_config.h`）

| 宏 | 填什么 |
| --- | --- |
| `HCP_WIFI_SSID` | 2.4GHz 网络名（ESP32 不支持 5GHz） |
| `HCP_WIFI_PASS` | Wi-Fi 密码 |
| `HCP_SERVER_HOST` | 只填域名，如 `iot.luo-jin-ai.com` |
| `HCP_SERVER_PORT` | 通常 `443` |

可选：`HCP_PROVISION_KEY`（服务器启用批量烧录密钥时）、`HCP_TLS_VERIFY`（公网部署建议置 1 并配置 CA）、`HCP_NO_DISPLAY`（无屏时省 flash）。

## 三、两种安装方式

**A. Arduino IDE（课堂最常见）**

1. 新建 sketch，例如 `b1_01`。
2. 把本目录 `src/hcp_sdk.cpp`、`include/*.h` 复制到 sketch 同目录。
3. 安装库：`WebSockets`（Links2004）、`ArduinoJson` 7.x、`Adafruit NeoPixel`、`LovyanGFX`。
4. 板子选 `ESP32S3 Dev Module`，Flash 16MB，PSRAM OPI。

**B. PlatformIO**

```ini
lib_deps =
  symlink://C:/path/to/firmware/board-sdk
  links2004/WebSockets@^2.4.1
  bblanchon/ArduinoJson@^7.2.0
  adafruit/Adafruit NeoPixel@^1.12.0
  lovyan03/LovyanGFX@^1.1.16
```

## 四、API

| API | 说明 |
| --- | --- |
| `HCP.begin([学号])` | 连接网络、登记设备、开始收题 |
| `HCP.loop()` | 协议收发、按键扫描、证据调度（必须每轮调用） |
| `HCP.report(key, value)` | 上报读数；服务器会与硬件实测交叉校验 |
| `HCP.keyPresses(KEY_A)` | 六键累计按下次数（`KEY_UP/DOWN/LEFT/RIGHT/A/B`） |
| `HCP.ledc(pin, hz, dutyPct)` | 跨 core 2.x/3.x 的 PWM 初始化，并登记为证据 |
| `HCP.tone(hz, dutyPct=50)` | 无源蜂鸣器方波（GPIO47） |
| `HCP.readDht()` | 读 DHT11（GPIO8），返回 `{ok, temperature, humidity}`，同时记为证据 |
| `HCP.stripBegin(n)` / `setStripPixel(i,r,g,b)` / `showStrip()` | WS2812 灯带（GPIO48） |
| `HCP.watchPwm(pin, channel)` | 用原生 LEDC API 时显式登记通道 |
| `HCP.onScreen(cb)` | 接管屏幕渲染（默认用内置简易渲染） |

## 五、证据是怎么来的（决定判题公不公平）

| 证据 | 采集方式 | 学生需要注意什么 |
| --- | --- | --- |
| 引脚电平/边沿 | 后台轮询 GPIO（含 LED、继电器、蜂鸣器） | 无需额外代码 |
| PWM 频率/占空比 | 记录 `HCP.ledc`/`HCP.tone` 的设置 | 用原生 `ledcSetup` 需调 `watchPwm` 登记 |
| ADC | 直接采样光敏引脚 GPIO1 | 无需额外代码 |
| 按键次数 | SDK 自行扫描 6 键并消抖 | 不要另外 `pinMode` 覆盖 SDK 的输入配置 |
| DHT11 | `HCP.readDht()` 解析单总线时序 | 必须用 `HCP.readDht()`（或自行调用后把结果写入 `report`） |
| WS2812 | 记录 `showStrip()` 前的首像素与数量 | 必须用 `HCP.setStripPixel` / `showStrip` |
| Wi-Fi | `WiFi.getMode/RSSI/localIP` | 无需额外代码 |

服务器只在**当前考察项的窗口内**接受证据（窗口 50% 与 85% 各上报一次），因此学生代码要在 `loop()` 里持续维持状态，不能只闪一下就退出。

## 六、常见问题

| 现象 | 原因 |
| --- | --- |
| 屏幕空白但有串口输出 | TFT 引脚角色与原理图丝印不一致，先核对 `hcp_board.h` |
| 一直「登记失败 status=401」 | 服务器设置了 `HW_ENROLL_KEY`，需填 `HCP_PROVISION_KEY` |
| 屏幕显示 8 位配对码但网页说无效 | 配对码 10 分钟过期，重新上电或清除 NVS 中的 token |
| 探针报「没有 PWM 采样」 | 用了原生 `ledcSetup` 且未调 `watchPwm` |
| 探针报「无法交叉校验」 | 用了第三方 DHT 库但没把读数交给 SDK（改用 `HCP.readDht()`） |
| 上报值与实测差很多 | 上报了原始码值而不是物理量（例如 ADC 用 0–4095 而不是毫伏） |

## 七、与协议的关系

SDK 实现了 `HCP/1` 的终端侧：`hello / input / ack / evidence / report / ping`。
协议规范见 `docs/hardware/HCP-v1.md`，板端判题规则见 `docs/hardware/BOARD-TRACK.md`。
