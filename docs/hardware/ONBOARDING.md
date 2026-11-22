# 硬件终端接入规范（学生 / 教师 / 管理员）

本文回答一个问题：**要让一块 ESP32-S3 连进「万物之城」，到底需要在哪些地方、输入哪些东西？**

结论先给：一共 **3 个输入面、5 个必填项**，其余全部自动完成。

| 输入面 | 需要输入什么 | 谁来做 | 什么时候 |
| --- | --- | --- | --- |
| ① 固件代码 `include/config.h` | Wi-Fi 名称、Wi-Fi 密码、服务器域名、端口、设备型号 | 烧录者 | 烧录前一次填好 |
| ② 硬件串口控制台 | 现场改 Wi-Fi、改服务器地址、重新登记（`enroll`） | 学生/教师 | 换教室、换网络时 |
| ③ 游戏网页 | 8 位配对码（设备屏幕上显示） | 学生本人 | 每台设备绑定一次 |

设备号、设备令牌、协议版本、画面布局**都不需要人工输入**。

---

## 一、硬件准备

最小可用形态：

| 部件 | 要求 | 备注 |
| --- | --- | --- |
| 主控 | ESP32-S3（建议带 8MB Flash、PSRAM 可选） | ESP32-S3-DevKitC-1 即可 |
| 屏幕 | SPI 屏，ST7789 320×240 / GC9A01 圆屏 / ILI9341 | 驱动在 `hud_render.cpp` 顶部替换 |
| 按键 | 3–5 个轻触开关，一端接 GPIO、一端接 GND | 3 键即可跑通全部工程操作 |
| 网络 | 2.4GHz Wi-Fi（WPA2 个人版） | ESP32 不支持 5GHz；企业 802.1X 不支持 |
| 可选 | 旋转编码器、真实传感器（DHT22/BH1750 等） | 编码器走 `rot` 帧；传感器走 `sensor` 帧（沙盒观测） |

> 服务器必须是 HTTPS/WSS 可达的（正式环境 `iot.luo-jin-ai.com:443`）。纯内网实验可自建实例，但需要自带证书或把 `DEVICE_TLS_VERIFY` 置 0。

---

## 二、输入面 ①：代码里填什么

打开 `firmware/esp32s3-console/include/config.h`，只改这一段：

```cpp
/* 必填 1/2：Wi-Fi */
#define DEFAULT_WIFI_SSID "Campus-IoT"        // 2.4GHz 网络名
#define DEFAULT_WIFI_PASS "12345678"          // Wi-Fi 密码

/* 必填 3：服务器域名。只填主机名，不要带 https://、不要带 /api */
#define DEFAULT_SERVER_HOST "iot.luo-jin-ai.com"
#define DEFAULT_SERVER_PORT 443

/* 必填 4：设备型号，会显示在网页「我的终端」里 */
#define DEVICE_MODEL "ESP32-S3-TFT-320x240"
#define FIRMWARE_VERSION "0.1.0"
```

可选（按需开启）：

```cpp
// 服务器配了 HW_ENROLL_KEY 时才需要，密钥向管理员索取
// #define PROVISION_KEY "xxxxxx"

// 0 = 跳过证书校验（校园内网可用）；1 = 需先填好 src/ca_cert.h
#define DEVICE_TLS_VERIFY 0
```

**不要**在代码里写设备号、令牌、配对码——它们由服务器签发并存在 NVS 里，写死会导致多台设备互相顶号。

烧录：

```bash
cd firmware/esp32s3-console
pio run -t upload        # 首次编译约 3–5 分钟
pio device monitor -b 115200
```

---

## 三、输入面 ②：硬件上输入什么

上电后固件自动用 `config.h` 的 Wi-Fi 联网并登记。**如果现场网络和烧录时不一样**，用串口控制台（115200，命令后带回车/换行）：

| 命令 | 作用 | 示例 |
| --- | --- | --- |
| `help` | 列出全部命令 | `help` |
| `status` | 查看型号、固件、安装标识、设备号、Wi-Fi 状态与 RSSI、服务器地址、通道状态 | `status` |
| `wifi <ssid> <password>` | 设置 Wi-Fi 并保存到 NVS，随后自动重启 | `wifi Lab-2.4G 87654321` |
| `server <host> [port]` | 设置服务器域名（自动去掉 `https://` 与结尾斜杠），端口默认 443 | `server iot.luo-jin-ai.com 443` |
| `enroll` | 清除令牌后重新登记，生成新配对码 | `enroll` |
| `reset` | 恢复出厂（等同 `enroll`） | `reset` |

`status` 不会打印令牌明文（只显示「已保存」），可以放心截图交作业。

屏幕上能看到的：

| 画面 | 显示内容 | 说明 |
| --- | --- | --- |
| 初始化 | 「正在初始化…」 | 连 Wi-Fi 中 |
| 配对 | 大字 `ABCD-2345` + 有效期 | 拿去网页绑定 |
| 待机 | 「已绑定，等待选择任务」 | 去网页开始一关 |
| 简报 | 关卡标题 + 简报正文 + 底部按键条 | 按 K1 开始 |
| 控制台 | 任务列表、进度、用时、设备读数/曲线、最近反馈 + 按键条 | 主战场 |
| 结算 | 得分、星级、提示与错误次数 | 详细解析在网页 |

按键语义**写在屏幕底部的按键条上**（服务器随画面下发），不写死在固件里。3 键设备与 5 键设备的按键条不一样，这是正常的。

---

## 四、输入面 ③：网页上输入什么

只有一步：

1. 学生用学号账号登录游戏网页。
2. 进入「我的终端」→「添加终端」。
3. 输入设备屏幕上的 8 位配对码（`ABCD-2345`，分隔符可省略）。
4. 可给终端起名（如「实验台一号」），保存。

绑定成功后：

- 终端立刻显示「已绑定，等待选择任务」；
- 网页「我的终端」出现该设备，状态「在线」；
- 学生开始任意个人关卡后，终端自动接管该会话的操作面板（无需再点选）。

配对码 **10 分钟有效、只能用一次**。每账号最多绑 **4** 台。

---

## 五、教师 / 管理员要配什么

服务器端环境变量（`.env`）：

| 变量 | 作用 | 建议 |
| --- | --- | --- |
| `HW_ENROLL_KEY` | 启用批量烧录密钥。设置后，`POST /api/hw/enroll` 必须带 `x-provision-key` | 实验室统一烧录时启用；学生自助登记时留空 |
| `PUBLIC_ORIGIN` | 用于生成 `wsUrl`（`wss://<域名>/hw/v1`） | 必须填正式域名，否则设备拿到的地址不可用 |

不要设置 `HW_ENROLL_KEY` 的场景：学生自己烧自己的板子。此时登记接口按 IP 限流 10 次/小时，一个教室的 NAT 出口够用；若整班同时在机房登记，请启用密钥，否则会互相挤占配额。

管理动作：

- 查看：网页「我的终端」列表含在线状态、型号、固件版本、上次连接时间。
- 解绑：删除终端 → 令牌立即轮换、在途连接被 1008 关闭、审计日志记录 `hw.revoke`。
- 教师可在班级维度要求学生把终端用于某次实验课，终端本身不区分班级（绑定的是学生账号）。

---

## 六、上线自查清单（12 项，逐条打勾）

- [ ] 1. `config.h` 的 5 个必填项已改，域名不带 `https://` 与路径。
- [ ] 2. Wi-Fi 为 2.4GHz 且为 WPA2 个人版。
- [ ] 3. 编译烧录成功，串口 115200 打印固件版本。
- [ ] 4. `status` 显示 Wi-Fi 已连接、有 IP、RSSI 优于 −80dBm。
- [ ] 5. `status` 显示令牌「已保存」、通道「在线」。
- [ ] 6. 屏幕出现 8 位配对码。
- [ ] 7. 网页绑定成功，终端显示「已绑定」。
- [ ] 8. 网页「我的终端」显示该设备「在线」。
- [ ] 9. 网页开始第一关，终端出现简报画面且底部有「K1 开始任务」。
- [ ] 10. 按 K1 后终端切到控制台，网页端任务状态同步变化（同一存档、同一 revision）。
- [ ] 11. 按「检查设备」，网页端任务勾选、终端任务列表出现完成标记。
- [ ] 12. 拔电重连后，终端自动回到当前进度，网页端分数不重复、进度不回退。

第 10–12 项验证的是「服务端权威」：终端与网页看到的是同一个 `game_sessions` 状态，不是两套。

---

## 七、故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 屏幕停在「Wi-Fi 未连接」 | 5GHz / 企业 802.1X / 密码错 | 换 2.4GHz WPA2；用 `wifi` 命令重填 |
| `enroll status=401` | 服务器设了 `HW_ENROLL_KEY` | `config.h` 填 `PROVISION_KEY` 后重刷 |
| `enroll status=0` / 超时 | 端口不是 443、域名错、服务器无证书 | 用 `server` 命令核对；确认 `https://域名/api/health` 可访问 |
| `enroll status=429` | 同 IP 登记超过 10 次/小时 | 等待或启用 `HW_ENROLL_KEY` |
| 有配对码但网页提示无效 | 已过期（10 分钟）或被别处先绑定 | 串口 `enroll` 重新生成 |
| 绑定后一直是「等待选择任务」 | 网页没开始关卡，或当前是联机房间会话 | 在网页开一关个人关卡；联机模式请用浏览器 |
| 按键无反应 | 引脚接错 / 短路 / 引脚定义不符 | 看串口是否打印 `[key] K1 …`；无打印则查 `PIN_KEY*` |
| 按键有打印但画面不变 | 该键在当前画面未绑定，或命令被引擎拒绝 | 看串口 `[ws] 错误 UNKNOWN_KEY/COMMAND_REJECTED` 与提示文案 |
| 提示「操作过于频繁」 | 超过 10 次/秒或 300 次/分 | 检查按键是否抖动（固件消抖 30ms），降低操作频率 |
| 画面偶尔不刷新 | 只在内容变化时推送（1.2s 一次） | 正常现象；断线会显示「连接中断」并自动重连 |
| 重连后报 `UNAUTHORIZED` | 令牌已被轮换（网页解绑过） | 串口 `reset` 重新登记并绑定 |
| 换了一块屏花屏 | 驱动型号不匹配 | 改 `hud_render.cpp` 顶部 `lgfx::Panel_*` 与 `offset/invert` |

---

## 八、参数速查表

| 项 | 值 | 出处 |
| --- | --- | --- |
| 协议版本 | `HCP/1` | `packages/shared/src/hardware.ts` |
| 实时通道 | `wss://<域名>/hw/v1` | 网关 `services/api/src/hardware/index.ts` |
| 单帧上限 | 8192 字节 | `hcpLimits.frameBytes` |
| 心跳 / 断线判定 | 20 秒 / 60 秒 | `hcpLimits.heartbeatSeconds` |
| 输入限流 | 10 次/秒、300 次/分 | `hcpLimits.inputsPerSecond/Minute` |
| 画面推送间隔 | 1.2 秒（仅内容变化时） | `hcpLimits.hudPushIntervalMs` |
| 配对码 | 8 位、10 分钟、一次性 | `HW_PAIR_CODE_TTL_MS` |
| 未绑定作废 | 24 小时 | `HW_UNBOUND_TTL_MS` |
| 绑定上限 | 4 台/账号 | `HW_MAX_DEVICES_PER_USER` |
| 控件 / 按键上限 | 12 个 / 6 个 | `hcpLimits.widgets/keys` |
| 在环读数间隔 | ≥2 秒 | `hcpLimits.sensorIntervalMs` |
| 硬件可触发命令 | `start pause resume inspect dialog simulate hint answer` | `hardwareCommandTypes` |

---

## 九、界面接入点（前端同学）

后端已提供、当前网页尚未接入的接口（网页侧由 Web 工作流实现）：

```
GET    /api/hw/devices              → HwDeviceView[]
POST   /api/hw/bind                 {code,name?} → HwDeviceView
DELETE /api/hw/devices/:id          → {ok:true}      （无 body，可不带 content-type）
POST   /api/hw/devices/:id/revoke   → {ok:true}      （浏览器统一带 JSON 请求头时用这个）
POST   /api/hw/devices/:id/attach   {sessionId|null} → {ok,attachedSessionId}
GET    /api/hw/devices/:id/screen   → {screen}       （用于网页画一个「终端预览」小窗）
```

最小页面结构建议：

1. 「我的终端」列表：设备名、型号、固件、在线状态、绑定时间、解绑按钮。
2. 「添加终端」表单：8 位配对码输入框 + 名称 + 提交；错误直接展示后端 `message`。
3. 关卡进行中：右侧一栏「终端预览」，轮询 `/screen` 或在命令返回后刷新，让学生看到硬件与网页同步。
