# HCP/1 · 万物之城硬件终端协议规范

- 版本：`HCP/1`（第 1 版，2026-10）
- 适用终端：ESP32-S3 + 屏幕 + 按键（参考固件见 `firmware/esp32s3-console/`）
- 唯一类型来源：`packages/shared/src/hardware.ts`
- 服务端实现：`services/api/src/hardware/`（网关 `index.ts`、画面投影 `hud.ts`、持久化 `store.ts`）
- 验收用例：`tests/hardware.test.ts`（19 项，`npx tsx --test tests/hardware.test.ts`）

---

## 1. 定位与设计原则

HCP（Hardware Console Protocol）解决的是一个具体问题：**让学生手里的 ESP32-S3 成为游戏的真终端**，而不是一个只能看分数的摆设。

五条不可妥协的原则，决定了下面所有设计：

| 原则 | 具体含义 |
| --- | --- |
| **服务端权威** | 硬件永远不提交"分数""胜负""通关"这类结论。它只上报"按了哪个键"，服务器翻译为命令、按引擎规则校验、再落库。 |
| **设备零业务逻辑** | 按键要执行什么，由服务器在每一帧里下发（`km` 字段）。换关卡、换章节、换玩法都不需要刷固件。 |
| **语义帧而非像素帧** | 服务器下发"一个进度条、三条任务、一个读数"，不是一张位图。终端负责排版，因此 128×64 单色屏与 320×240 彩屏共用同一条协议。 |
| **能力分级授权** | 未绑定设备只能收画面；绑定后才拿到操控与仿真权限；硬件在环再单独一层。权限随设备状态实时变化。 |
| **可复现** | 命令即事件，事件即回放。硬件操作与网页操作在服务端是同一种 `GameCommand`，共用同一套存档、审计与回放机制。 |

---

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 终端 / 设备 | 一台 ESP32-S3 硬件，用 `deviceId` 唯一标识 |
| 安装标识 | `installationId`，芯片 MAC 派生的 16 位十六进制串，用于"同一块板子重新烧录后复用记录" |
| 设备令牌 | `token`，32 字节随机值的 base64url，长期凭据，仅存 NVS，服务端只存 sha256 |
| 配对码 | 8 位大写字母数字（显示为 `ABCD-2345`），10 分钟有效，一次性 |
| 硬件会话 | 一台设备在一段时间内对某个游戏会话的控制关系 |
| HUD 帧 | 服务器 → 终端的画面描述（`t:"hud"`） |
| 按键映射 | HUD 帧内的 `km` 数组，声明每个物理键当前绑定的语义 |
| 游戏会话 | 已有概念，`game_sessions` 一行，由 `game.executeCommand` 驱动 |

---

## 3. 传输与端点

| 用途 | 方法与路径 | 鉴权 |
| --- | --- | --- |
| 设备登记 | `POST /api/hw/enroll` | 无 Cookie；若服务器配置 `HW_ENROLL_KEY`，需 `x-provision-key` 头 |
| 绑定账号 | `POST /api/hw/bind` | 网页登录 Cookie |
| 终端列表 | `GET /api/hw/devices` | 网页登录 Cookie |
| 挂载/卸载会话 | `POST /api/hw/devices/:id/attach` | 网页登录 Cookie |
| 画面预览 | `GET /api/hw/devices/:id/screen` | 网页登录 Cookie |
| 解绑（吊销） | `DELETE /api/hw/devices/:id` 或 `POST /api/hw/devices/:id/revoke` | 网页登录 Cookie |
| **实时通道** | `WSS /hw/v1` | `Authorization: Bearer <token>` |

要点：

1. **同源**：与站点、API 同一个域名（正式环境 `iot.luo-jin-ai.com`），复用同一张证书，终端只需配一个域名。
2. **编码**：WS 文本帧，UTF-8 JSON。单帧上限 **8192 字节**，超出即 `FRAME_TOO_LARGE`。
3. **为什么不用 MQTT**：本协议需要双向低延迟、需要"一设备一连接"的在线状态与超时判定，且终端数量在教室内可控（几十台）。直连 WSS 省掉一个 broker 与一层主题设计，运维面更小。若后续扩展到上千台，可在网关前加 MQTT 桥接而不改终端帧格式。
4. `DELETE` 的空 body 在 Fastify 默认 JSON 解析器下会被判非法，因此同时提供 `POST .../revoke`。浏览器端统一带 `content-type: application/json` 时请用后者。

---

## 4. 身份与生命周期

### 4.1 状态机

```
             enroll                 网页输入配对码              网页解绑 / 超时
  (无记录) ─────────► pending ─────────────────────► bound ─────────────────► revoked
                        │                              │                          │
                        │ 24h 未绑定                     │ 重新烧录 enroll            │ 重新 enroll
                        └──────────► revoked ◄──────────┘                          │
                                        └──────────────────────────────────────────┘
                                                  回到 pending
```

- `pending`：已有令牌、可连、只能收画面（作用域仅 `hud:read`）。
- `bound`：已归属某账号，拿到 `game:input` / `sim:step` / `hil:sensor`。
- `revoked`：令牌已轮换，在途连接立即被 `1008` 关闭；重新登记才回到 `pending`。
- 同一账号最多绑定 **4** 台终端（`HW_MAX_DEVICES_PER_USER`）。
- 同一 `installationId` 重复登记不产生新设备：已绑定设备保留归属只轮换令牌；其余回到 `pending` 并生成新配对码。

### 4.2 登记（enroll）

请求：

```json
{
  "installationId": "a1b2c3d4e5f60718",
  "model": "ESP32-S3-TFT-320x240",
  "fw": "0.1.0",
  "caps": {
    "w": 320, "h": 240, "color": "rgb565",
    "touch": false, "rotary": false, "lang": "zh",
    "keys": ["K1", "K2", "K3", "K4", "K5"]
  }
}
```

响应：

```json
{
  "data": {
    "deviceId": "1f0c…",
    "token": "9mQ…（43 字符 base64url）",
    "pairCode": "ABCD-2345",
    "pairExpiresAt": "2026-10-21T10:30:00.000Z",
    "wsUrl": "wss://iot.luo-jin-ai.com/hw/v1",
    "heartbeatSeconds": 20
  }
}
```

约束：

- `installationId` 必须匹配 `^[a-f0-9]{16,32}$`。
- `caps.w/h` 必须落在 64–1024（兼容小屏与彩色大屏），`keys` 至少 1 个、最多 6 个。
- 登记接口限流 **10 次/小时/IP**；批量烧录场景请配置 `HW_ENROLL_KEY`，否则同一出口 IP 的机房会互相挤占配额。

### 4.3 绑定（bind）

```http
POST /api/hw/bind
{ "code": "ABCD-2345", "name": "实验台一号" }
```

- `code` 服务端会做归一化（去分隔符、转大写）。
- 失败码：`PAIR_CODE_INVALID`(404) / `PAIR_EXPIRED`(410) / `DEVICE_LIMIT`(409)。
- 绑定成功会立即向在线终端推送 `ready` 帧，并写入 `audit_logs`（`action=hw.bind`）。

### 4.4 令牌轮换与吊销

- 吊销 = 轮换令牌（写一个新的随机 hash）+ 关闭在途连接 + 关闭 `hw_sessions`。
- 设备侧感知：收到 `{t:"bye",reason:"设备已被解绑"}` 后连接被关闭；重连会因令牌不匹配被 `1008` 拒绝。
- 恢复方式：`reset`（串口）→ 重新 `enroll` → 新配对码 → 网页重新绑定。

---

## 5. 连接与帧

### 5.1 握手

```
终端                                   网关
 |  WSS upgrade  Authorization: Bearer …  |
 |--------------------------------------->|
 |                        校验 sha256(token)
 |<---- {t:"hello"|"ready"} ------------- |   已绑定推 ready，未绑定推 hello(pair)
 |  {t:"hello",v,caps,fw}                 |   设备声明能力（也会刷新 caps/firmware）
 |--------------------------------------->|
 |<---- {t:"hello",v:"HCP/1",scopes,…} -- |
 |<---- {t:"hud",screen:{…}} -------------|
 |  {t:"ack",rev}                         |
 |--------------------------------------->|
```

- 用户名与 `deviceId` 不接受客户端指定，全部来自令牌反查。
- 同 `deviceId` 重复连接时，**旧连接被 `1012` 关闭**（新连接优先），避免一台设备两条通道打架。
- 未带令牌或令牌非法：直接 `1008` 关闭，不做任何业务响应。

### 5.2 心跳与超时

- 设备每 **20 秒**至少发一次 `{"t":"ping","ts":<毫秒>}`；服务端回 `pong`。
- 服务端在 **60 秒**内收不到任何帧即判定掉线并关闭连接（`heartbeatSeconds × 3`）。
- 终端应实现 3 秒重连退避；`@fastify/websocket` 的 `maxPayload` 为 64KB，协议层仍以 8KB 为上限。

### 5.3 帧序号

- 每个连接维护单调递增的 `screen.rev`。
- 终端渲染完成后回 `{"t":"ack","rev":N}`；服务端用它统计画面是否送达（v1 只记录，不重传）。
- 仅用于画面同步，**不参与计分**，也不作为命令的 revision。

### 5.4 上行帧（终端 → 服务器）

| `t` | 字段 | 说明 |
| --- | --- | --- |
| `hello` | `v`,`fw`,`caps` | 声明协议版本、固件版本、屏幕能力；可随时重发以更新能力 |
| `input` | `id`(8–64 字符),`ev` | 输入事件，`id` 是幂等键 |
| `ack` | `rev` | 画面确认 |
| `sensor` | `m`,`v`,`ts?` | 硬件在环读数（见第 9 节） |
| `ping` | `ts?` | 心跳 |
| `bye` | — | 设备主动下线 |

### 5.5 下行帧（服务器 → 终端）

| `t` | 字段 | 说明 |
| --- | --- | --- |
| `hello` | `v`,`dev{id,name,status}`,`pair?{code,expiresIn}`,`scopes`,`ts` | 握手回执 |
| `ready` | `dev{id,name}`,`scopes` | 绑定完成 |
| `hud` | `screen` | 画面 |
| `toast` | `level`,`v` | 一次性提示（不改变画面结构） |
| `pong` | `ts`,`serverTime` | 心跳回执 |
| `err` | `code`,`msg`,`retry?` | 错误，见第 10 节 |
| `bye` | `reason` | 服务端要求断开 |

---

## 6. HUD 语义帧

`screen` 结构：

```json
{
  "id": "console",
  "rev": 42,
  "title": "7. 测量漂移",
  "subtitle": "进行中 · 得分 0",
  "widgets": [ … ],
  "km": [ … ],
  "focus": "sensor-1",
  "elapsed": 96,
  "score": 0,
  "online": true
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 画面类型：`boot` `pair` `idle` `briefing` `console` `paused` `finished` `offline` |
| `rev` | 本连接内单调递增，从 1 开始 |
| `title`/`subtitle` | 顶栏文本，≤60 / ≤120 字符 |
| `widgets` | 最多 12 个控件，按下标自上而下排 |
| `km` | 最多 6 条按键映射，按 `caps.keys` 裁剪 |
| `focus` | 当前聚焦设备 id（`inspect` 的目标），无则为空 |
| `elapsed`/`score` | 秒 / 分，服务端计算，终端仅展示 |
| `online` | 服务器视角的会话在线状态 |

### 6.1 控件

| `t` | 字段 | 渲染建议 |
| --- | --- | --- |
| `text` | `v`(≤1200),`size`:`s\|m\|l`,`align`:`l\|c` | 自动换行，超出截断并显示省略号 |
| `kv` | `k`(≤24),`v`(≤60),`tone`:`ok\|warn\|bad` | 左标签右值，`tone` 决定颜色 |
| `list` | `label?`,`items[{k,v?,st:'done'\|'todo'\|'focus'}]`(≤12) | 行首状态标记：`[x]` / `[ ]` / `>` |
| `gauge` | `label`,`v`,`min`,`max`,`unit?` | 数值 + 横向填充条 |
| `bar` | `label`,`v`,`max` | 百分比条（执行器占空比等） |
| `spark` | `label?`,`pts[]`(2–48) | 折线，纵向自适应 min/max |
| `alert` | `level`:`info\|warn\|error`,`v`(≤160) | 带色边框的提示块 |

**画面里永远不出现**：关卡解法 `solution`、失败条件 `failureCase`、题目答案 `questions[].answer`、其他玩家数据。这是 `hud.ts` 的类型约束（只接受 `PublicLevel`）强制的，不靠自觉。

### 6.2 按键映射

```json
{"k":"K1","lb":"检查设备","cmd":"inspect","tg":"sensor-1","tone":"primary"}
{"k":"K2","lb":"下一设备","nav":"focus-next"}
{"k":"K3","lb":"仿真1秒","cmd":"simulate","pl":{"ticks":1}}
{"k":"K4","lb":"任务提示","cmd":"hint","tg":"t3"}
{"k":"K5","lb":"暂停","cmd":"pause","tone":"warn"}
```

- `cmd` 与 `nav` 二选一：
  - `cmd` → 翻译成游戏命令，走完整引擎校验；
  - `nav` → 设备本地视图操作（`focus-next` `focus-prev` `page-next` `page-prev` `refresh`），由网关更新视图后重推画面，不产生命令、不计入操作数。
- 动作池按"教学价值"排序，再按终端实际键数**依次绑定**：3 键手持机得到「检查 / 换设备 / 仿真」，5 键面板得到全部。同一份逻辑适配不同硬件，不分支。
- `K6` 及以上为预留位（答题面板、旋钮确认等），v1 不下发。

### 6.3 各画面内容

| 画面 | 触发 | 内容 | 按键 |
| --- | --- | --- | --- |
| `pair` | 已连未绑定 | 8 位配对码大字 + 有效期 | 无 |
| `idle` | 已绑定、无进行中会话 | 提示去网页选关 | 无 |
| `briefing` | 会话 `phase=briefing` | 简报正文、联络人、限时（限时模式） | 开始 / 继续对话 / 提示 |
| `console` | `phase=running` | 任务列表、进度、用时、聚焦设备读数与曲线、最近反馈 | 检查 / 换设备 / 仿真 / 提示 / 暂停 |
| `paused` | `phase=paused` | 进度、用时 | 继续 / 提示 |
| `finished` | `completed`/`failed` | 得分、星级、提示与错误次数 | 刷新 |
| `offline` | 断线 | 重连提示 | 无 |

---

## 7. 输入、幂等与限流

### 7.1 输入事件

```json
{"t":"input","id":"a1b2c3d4e5f6a7b8","ev":{"t":"key","k":"K1","a":"press"}}
```

| `ev.t` | 字段 | v1 处理 |
| --- | --- | --- |
| `key` | `k`,`a`:`press\|long\|repeat` | 按映射表执行；未映射返回 `UNKNOWN_KEY` |
| `touch` | `x`,`y`(0–1024) | 等价于 `nav:refresh`（点选区域映射留待 v1.1，避免与控件布局强耦合） |
| `rot` | `d`(−8…8) | 切换聚焦设备，等价于连续 `focus-next/prev` |

### 7.2 幂等

- `input.id` 是幂等键，同一 `id` 只执行一次；服务端保留最近 **128** 条。
- 该 `id` 会直接作为 `GameCommand.id` 写入 `game_events`，因此**跨断线重连的重放**也安全（数据库主键 `(session_id,id)` + `sameCommand` 校验）。
- 同一个 `id` 携带不同内容 → 命令层返回 `IDEMPOTENCY_CONFLICT`，不会重复结算。

### 7.3 限流

| 维度 | 上限 | 超限表现 |
| --- | --- | --- |
| 输入频率 | 10 次/秒、300 次/分（每设备） | `err:RATE_LIMIT`，事件不入库 |
| 单帧 | 8192 字节 | `FRAME_TOO_LARGE` |
| 帧数 | 单会话 `revision ≥ 10000` 后拒绝 | `event limit`（沿用引擎策略） |
| 在环读数 | ≥2 秒一次 | `RATE_LIMIT` |

硬件端必须做按键消抖（≥30ms），否则一次长按会产生大量 `repeat` 打满配额。

---

## 8. 命令翻译与安全边界

网关把 `km` 条目翻译成命令时，依次执行四道检查：

1. **作用域**：`game:input` 未授予 → `NOT_BOUND`；`simulate` 还需 `sim:step`。
2. **白名单**：命令类型必须属于 `start / pause / resume / inspect / dialog / simulate / hint / answer`。其余类型（`configure`、`connect`、`collect`、`rule`…）**在硬件通道上不可达**，即使篡改固件下发也被拒绝。
3. **目标合法性**：`tg` 来自服务器自己生成并保存的映射表，不信任设备上报的任何目标字段。
4. **引擎校验**：`game.executeCommand` 用真实 `revision` 提交事务，越界参数、非法状态、已完成会话一律被引擎拒绝。

由此得到的性质：

- 改固件可以"乱发帧"，但只能触发当前画面允许的那几个动作，等价于乱按键盘；
- 不可能通过硬件伪造分数、完成判定或计时（成绩永远由服务端 `results` 表计算）；
- 所有硬件操作与网页操作写入同一张 `game_events`，操作回放、学习分析、教师审计无需区分来源。

审计侧另记 `hw_events`（`kind=input|sensor`，含 `accepted` 与拒绝原因），用于排查"学生说按了没反应"这类问题。

---

## 9. 硬件在环（HIL）

v1 定位为**观测通道**，不是仿真注入：

```json
{"t":"sensor","m":"temperature","v":23.4,"ts":1234567}
```

- 仅在 `mode=sandbox` 且**非**标准挑战（`flags` 不含 `standard-sandbox`）时接受，否则 `SENSOR_REJECTED`。
- 服务端只落 `hw_events` 并回 `toast`，**不修改** `state.environment`。
- 原因：直接注入会绕过引擎、破坏确定性回放与计分公平；把真实读数喂进仿真需要一条"环境更新命令"并纳入时序模型，属于 v2 内容。

v2 计划（未实现，不在验收范围）：新增 `hil-environment` 命令，把真实读数作为带时间戳的观测序列写入状态，回放时按同一序列重放；仅沙盒与非排行榜模式可用。

---

## 10. 错误码

| code | 触发 | 终端应做什么 |
| --- | --- | --- |
| `BAD_FRAME` | JSON 非法或不符合 schema | 记录串口日志，不重试 |
| `BAD_CAPS` | `caps` 越界（如 `w<64`） | 修正 `config.h` 后重连 |
| `UNAUTHORIZED` | 令牌无效/已轮换 | 停止重试，提示重新配对 |
| `DEVICE_REVOKED` | 设备被解绑 | 显示`bye`原因，执行 `reset` |
| `NOT_BOUND` | 未绑定就发输入 | 显示配对码画面 |
| `NO_SESSION` | 无进行中会话 | 显示 `idle` |
| `UNKNOWN_KEY` | 按键不在当前映射表 | 忽略，可提示"当前无此操作" |
| `RATE_LIMIT` | 超频 | 丢弃本次，降速 |
| `COMMAND_REJECTED` | 引擎拒绝（参数越界、状态不符等） | 展示 `msg`，等下一帧 |
| `SENSOR_REJECTED` | 非沙盒仍上报读数 | 停发 `sensor` |
| `FRAME_TOO_LARGE` | 帧超 8KB | 检查是否误发大字段 |
| `PAIR_EXPIRED` | 配对码过期 | 重新 `enroll` |
| `DEVICE_LIMIT` | 账号绑定满 4 台 | 先解绑旧设备 |
| `IDEMPOTENT_REPLAY` | 预留（v1 由服务端静默忽略） | 无需处理 |

---

## 11. 版本与兼容

- 帧内 `hello.v` 声明协议版本，当前固定 `HCP/1`；服务端在 `hello` 回执里回同样版本。
- 新增控件类型、`nav` 动作属于**向后兼容**变更：旧固件忽略不认识的 `t`，画面元素减少但不崩。
- 修改已有字段语义、变更鉴权方式属于**破坏性**变更，必须升到 `HCP/2` 并保留 `/hw/v1` 至少一个版本周期。
- 未知 `t` 的上行帧 → `BAD_FRAME`；未知字段被 zod `.strict()` 拒绝，避免"看起来生效实际被忽略"。

---

## 12. 完整时序

### 12.1 首次开机

```
上电 → 连 Wi-Fi → POST /api/hw/enroll
     ← {deviceId, token, pairCode}
     → WSS /hw/v1 (Bearer token)
     ← hello{dev.status:"pending", pair:{code}}
     ← hud{screen.id:"pair", 大字配对码}
     学生在网页输入 ABCD-2345 → POST /api/hw/bind
     ← ready{dev.name:"实验台一号"}
     ← hud{screen.id:"idle"}
```

### 12.2 日常开局

```
网页开始关卡 → 服务器创建 game_sessions(phase=briefing)
终端每 1.2s 轮询一次视图（网关侧）
     ← hud{screen.id:"briefing", km:[{K1,cmd:"start"}]}
按下 K1 → {t:"input",id,ev:{k:"K1"}}
     → 引擎 start → phase=running → 任务检测 → revision++
     ← hud{screen.id:"console", km:[inspect, focus-next, simulate, hint, pause]}
按下 K1 → inspect → 任务 t1 完成
     ← hud{任务列表 t1 标记 done, alert:"已确认传感器在线"}
```

### 12.3 断网重连

```
Wi-Fi 断开 → 终端显示 offline，WebSocket 库每 3s 重试
恢复 → 重新握手 → hello → 网关重新解析当前会话（同一 game_sessions 行，状态未丢）
     ← hud{rev 从 1 重新计数, 内容与断线前一致}
待补发的输入：因 id 幂等，重发不会重复执行
```

### 12.4 解绑

```
网页删除终端 → token_hash 轮换 + hw_sessions 关闭
终端 ← bye{reason:"设备已被解绑"} → close(1008)
重连 → 1008 → 终端进入「请用串口 reset 重新登记」提示
```

---

## 13. 已知限制（v1 明确未实现）

1. **固件未在真机编译验证**：`firmware/esp32s3-console/` 是参考实现，平台工具链与具体屏幕驱动需按实物调整；协议侧已用 Node 模拟设备完成 19 项端到端验证。
2. **触摸未做区域映射**：`touch` 只触发刷新；控件级点选留待 v1.1。
3. **答题未上硬件**：`answer` 命令类型已预留，v1 的 HUD 不含 `question` 画面，题目仍在网页作答（5 键硬件做多选题体验不可接受）。
4. **联机房间不接管**：`coop`/`pvp` 会话由实时服务独占，硬件 attach 会返回 `ROOM_SESSION_NOT_SUPPORTED`。
5. **TLS 默认跳过校验**：校园内网可接受，公网部署须把 `DEVICE_TLS_VERIFY` 置 1 并配置 `ca_cert.h`。
6. **无画面重传**：`ack` 只统计不重传，丢帧等下一次内容变化（1.2s 内）。
