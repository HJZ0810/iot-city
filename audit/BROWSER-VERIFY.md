# 浏览器自动化走查报告（2026-10-21）

- 驱动方式：Edge `--headless=new` + Chrome DevTools Protocol（`scripts/browser-verify.mjs`）
- 两种口径：
  - **full（本地完整）**：`dist/web` 生产构建 + 本地预览服务（真实内容包 + 真实引擎 + 真实板端判题器，仅 MySQL 换内存）
  - **smoke（生产）**：`https://iot.luo-jin-ai.com`，真实 nginx + PM2 + MySQL
- 结果：本地 **12/12**、生产 **9/9**，截图见 `audit/browser/`，原始记录 `audit/browser-verify.json`

## 一、生产 smoke（真实线上，9/9）

| # | 断言 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 首屏渲染（品牌 + 登录表单） | PASS | 首屏文字 223 字，`01-login.png` |
| 2 | 表单注册→登出→重新登录，进入城市中枢 | PASS | `02-city.png` |
| 3 | 第 9 章可见且受前置锁定 | PASS | `03-map-chapter9-locked.png` |
| 4 | 进入第 1 关后 **3D 画布挂载**（canvas 1、WebGL=true） | PASS | — |
| 5 | 经 HTTP 提交第 1 关参考解 → `phase=completed`、score=1000 | PASS | `08-smoke-level01.png` |
| 6 | 学习记录立即可读（通关已落 MySQL） | PASS | `09-smoke-reports.png` |
| 7 | 我的终端：绑定表单 + 5 个章节 + 第 1 章 4 关（功能验收/屏上答题） | PASS | — |
| 8 | 我的终端：开始板端关卡 → 服务器下发「三灯常亮、四号熄灭」考察项，任务书代码块可见 | PASS | `10-terminal-probe.png` |
| 9 | 我的终端：板载屏幕预览（无绑定终端时不伪造画面） | PASS | `11-terminal-screen.png` |

第 8 步的实测文案（说明是真数据，不是占位）：

```
当前考察项 三灯常亮、四号熄灭
服务器读取四个引脚的电平，检查 1/2/3 号灯亮、4 号灯灭。
采样窗口 4 秒 · 板子在窗口内上报的证据才会被采信
提示条：第 1 关已开始：板子屏幕上会出现「三灯常亮、四号熄灭」。
```

## 二、本地 full 口径（真引擎，12/12）

| # | 断言 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 登录页渲染 | PASS | `01-login.png` |
| 2 | 真实表单登录并进入城市中枢 | PASS | `02-city.png` |
| 3 | 第 9 章可见且受前置锁定 | PASS | `03-map-chapter9-locked.png` |
| 4 | 前置 48 关经真实引擎逐关通关 | PASS 48/48 | — |
| 5 | 章节按进度解锁（`unlockedChapter=9`） | PASS | `04-after-prereq.png` |
| 6 | 第 9 章首关可进入，同章第 50 关仍锁定 | PASS | — |
| 7 | 工具栏显示关卡名与 REV 0 | PASS | `05-game-level49.png` |
| 8 | 「进入现场」后 **3D 画布挂载**（canvas 1、WebGL=true） | PASS | `05-game-level49.png` |
| 9 | 开局后 REV 从 0 推进（start 命令生效） | PASS | 同上 |
| 10 | 提交参考解后 `phase=completed`、score=1000、完成 2 个任务 | PASS | `06-level49-completed.png` |
| 11 | 学习记录页可读并呈现成绩 | PASS | `07-reports.png` |

关键截图人工核对结论：

- `02-city.png`：深色科技风主界面，侧栏入口齐全、城市修复进度 00/60、九种模式卡片。
- `05-game-level49.png`：**真实 3D 场景**——车间网格地面、PLC/网关/平台三类设备实体与悬浮标签、选中高亮、右栏任务 0/2、REV 1。
- `10-terminal-probe.png`：板子线考察项面板 + 任务书（起始代码、引脚约定、判定记录空态）。

## 三、这轮走查顺带证明的事

1. **60 关内容全部可解**：第 1–48 关由页面内同源请求逐关提交参考解，48/48 通关；第 49 关经 UI 进入后通关——走的是 HTTP + 会话 + 引擎完整链路，比纯引擎校验更强。
2. **章节门禁正确**：第 9 章在完成前 48 关前「尚未解锁」；解锁后首关可进入，第 50 关仍锁定（顺序门禁）。
3. **三维场景真的在渲染**：WebGL 上下文可用，canvas 有有效尺寸，设备模型与标签可见。
4. **生产栈是通的**：生产 smoke 的 5、6 两步意味着 nginx → PM2 → Fastify → MySQL 写库 → 学习记录回读全部成立。
5. **板子线可达**：「我的终端」页真能从内容包拉关卡、在服务端建会话、下发考察项。

## 四、必须说明的边界（不能当作完整验收）

| 项 | 说明 |
| --- | --- |
| 预览服务不是生产后端 | 预览服务把 MySQL 换成内存。后端集成测试（`tests/api.integration.mjs`）仍需在 server2 的独立测试库上跑。 |
| 板子线只验证到「下发考察项」 | 没有实物板，`enroll → 绑定 → 证据上报 → 判定通过` 只在单元/协议测试层验证；浏览器里停在第 8 步。 |
| 未覆盖多人与 PvP | 只走单人剧情流程；协作房间、PvP 匹配、断线重连未在浏览器中验证。 |
| 未覆盖教师/管理员后台 | 后台代码存在（班级/布置/发布/草稿/知识点/回放/导出），本轮未走查。 |
| 未做性能测量 | 未测首屏耗时、帧率、内存增长；截图是静态证据，不等于性能达标。 |
| 无 2.5D/2D 分层 | 60 关 `dimension` 均为 `3d`。 |
| 题库仍为空 | 60 关没有一关带 `questions`。 |

## 五、复跑方式

```bash
cd D:/PRO/iot-city-20261021
node scripts/build.mjs                        # 生成 dist/web

# 本地完整口径
npx tsx scripts/preview-server.ts &           # 预览服务 :4399（含真实板端判题）
VERIFY_SCOPE=full  PREVIEW_URL=http://127.0.0.1:4399 node scripts/browser-verify.mjs

# 生产 smoke
VERIFY_SCOPE=smoke PREVIEW_URL=https://iot.luo-jin-ai.com node scripts/browser-verify.mjs
```

前置条件：本机安装 Edge 或 Chrome；`node_modules` 已包含 `ws`。

**部署提醒**：`dist/web` 用的是内容哈希文件名，`@fastify/static` 以 `wildcard:false` 在启动时登记文件清单。替换 `dist/web` 后**必须 `pm2 restart iot-city`**，否则新资源一律 404（首屏白屏，走查会在「首屏品牌渲染」这一步超时）。
