# 执行任务板

状态：待办 / 进行 / 待验收 / 完成。**完成必须记录证据（可复核的命令或产物路径）。**

> 2026-10-21 v3 重同步：本表早期是规划态（全为待办），现按实测结果回填。状态口径：
> - **完成** = 有可复跑命令 + 产物/输出证据；
> - **待验收** = 代码与单测齐备，但缺浏览器/实物/多人实测；
> - **进行** = 部分能力已上线但覆盖不全。

| ID | 任务 | 负责人 | 依赖 | 状态 | 证据 |
|---|---|---|---|---|---|
| P0-01 | 服务器只读盘点 | Codex | 无 | 完成 | server2 现状已核：PM2 / nginx / MySQL 8 / certbot |
| P0-02 | 完整验收矩阵 | OpenCode | 源需求 | 完成 | `audit/requirements-matrix.md` |
| P0-03 | 架构/设计/契约 | Codex | 用户关键方向 | 完成 | `ARCHITECTURE.md`、`CONTRACTS.md`、`DATABASE.md`、`GAME_ENGINE_SPEC.md` |
| P0-04 | 设计独立审阅 | OpenCode | P0-03 | 进行 | `audit/opencode-design-review.jsonl` |
| P1-01 | 确定性引擎及仿真 | Codex | P0-03 | 完成 | `packages/engine`，34 项测试全绿 |
| P1-02 | 数据库/认证/存档/结算 | Codex | P1-01 | 完成 | `migrations/001–006`、`services/api/src/auth.ts`；生产通关后学习记录即时可读 |
| P1-03 | 学生游戏界面/场景 | OpenCode | 共享契约 | 完成 | 浏览器走查 12/12，3D canvas + WebGL 实测；`audit/BROWSER-VERIFY.md` |
| P2-01 | 60 关完整内容/解法 | Codex蓝图+OpenCode | 引擎/内容契约 | 完成 | `npx tsx scripts/validate-content.ts` → `{"valid":60,"target":60}` |
| P3-01 | 九模式及规则生成 | Codex核心+OpenCode界面 | P1 | 进行 | 模式入口与规则已实现；每日/无尽/限时/Boss 的浏览器实测未覆盖 |
| P4-01 | 合作/PvP/榜单 | Codex核心+OpenCode界面 | P1/P3 | 待验收 | `services/api/src/rooms.ts`（真实 WS、断线宽限、服务端判胜负）；多人同房与 PvP 未在浏览器验收 |
| P5-01 | 教学管理/编辑器/回放 | Codex内核+OpenCode业务 | P1/版本契约 | 待验收 | `apps/web/src/management/*`；建班→布置→改版→旧存档 未走查 |
| P6-01 | 视觉/音效/浏览器/性能 | 共同 | 各产品模块 | 进行 | 视觉与动效已就位；首屏/帧率/内存**未实测** |
| P7-01 | 集成/安全/并发/恢复验收 | 共同 | P1-P6 | 待办 | `tests/api.integration.mjs` 需独立测试库；越权矩阵、注入、XSS/CSRF 未执行 |
| P7-02 | Server2 正式部署/交付 | Codex | 验收通过 | 进行 | **已上线**：PM2 `iot-city` + nginx `iot.luo-jin-ai.com` + Let's Encrypt，生产 smoke 9/9；正式交付仍需 P7-01 |
| P8-01 | 硬件协议 HCP/1 | Codex | 板型引脚图 | 完成 | `docs/hardware/HCP-v1.md`、`packages/shared/src/hardware.ts`，19 项测试 |
| P8-02 | 控制台固件（HUD + 串口配网） | Codex | P8-01 | 待验收 | `firmware/esp32s3-console`；**无实物上电联调** |
| P9-01 | 板端闯关 B 轨（判题/证据链） | Codex | P8-01 | 完成 | 20 关内容、10 类断言、交叉校验；26 项测试；生产库实测建会话成功 |
| P9-02 | 板端 SDK 与示例工程 | Codex | P9-01 | 待验收 | `firmware/board-sdk` + `examples/b1_01_three_leds`；**未在实物上编译烧写** |
| P9-03 | 我的终端页（学生入口） | Codex | P9-01 | 完成 | `apps/web/src/pages/TerminalPage.tsx`；生产 smoke 第 7–9 步实测通过 |
| P10-01 | 题库内容（60 关 `questions`） | 待分配 | P2-01 | 待办 | 当前带 `questions` 的关卡数为 0 |
| P10-02 | 场景 2.5D/2D 分层 | 待分配 | P1-03 | 待办 | 60 关 `dimension` 全为 `3d` |
