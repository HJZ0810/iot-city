# 架构入口

正式设计见 `docs/superpowers/specs/2026-10-21-iot-city-design.md`。

浏览器React/Three.js → 同源Fastify HTTP/WebSocket → 共享确定性引擎 → 独立MySQL数据库。

硬件终端（ESP32-S3）→ `wss://<域名>/hw/v1`（HCP/1）→ 硬件网关 → 同一 `game.executeCommand` → 同一存档与结算。终端不持有任何游戏规则，按键语义由服务器按帧下发。

板端轨道（B 轨）：学生代码在自己的开发板上运行 → 板端 SDK 采集硬件证据 → `evidence` 帧 → `services/api/src/board/grader.ts` 逐条断言 → 判定只由服务端产出。两条轨道共用账号与设备通道，排行榜分开。

核心原则：命令在服务器验证与串行提交；事件与快照同事务；内容版本不可变；客户端只渲染和提交操作；教师DSL不可执行任意代码。

前端与内容在不同worktree开发，共享契约由Codex维护。部署由Codex单一执行者负责。
