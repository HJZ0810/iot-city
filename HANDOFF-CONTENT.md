# 内容工单交接

> 2026-10-21 v2 重写：上一版只覆盖 30 关，本版按当前仓库实测结果更新（60 关 + 120 道题）。

## 一、已实现范围

- `packages/content` 导出 `levels`、`chapters`、`getLevel(id)`、`boardLevels`、`boardChapters`、`getBoardLevel`；A 轨按 level number 排序，B 轨独立。
- **A 轨 60/60 关**：第 1–10 章各 6 关（level-01 … level-60）。关卡正文（briefing / ending / NPC 台词 / 任务 / 提示 / 解析）全部手写，不是模板替换。
- **题库 120 道**：`packages/content/src/questions.ts` 逐关手写，每关 2 道，由 `index.ts` 挂到 `level.questions`。题型分布：单选 107 / 多选 7 / 数值 6。
- **B 轨 20 关**：`packages/content/src/board.ts`，功能验收 14 / 屏上答题 5 / 代码排障 1。

## 二、各章机制（A 轨）

| 章 | 主题 | 代表机制 |
| --- | --- | --- |
| 1 | 物联初启 | RFID 授权联锁、终端入网、温度校准、光照闭环、双标签分拣、多传感器融合 |
| 2 | 传感迷局 | 系统偏差、数字滤波、ADC 量化步长、Nyquist 采样、执行器因果、AND 判据 |
| 3 | 万物互联 | 星型补链、树状中继、Mesh 冗余、ZigBee 角色、BLE 双向配对、LoRa/NB-IoT 概念参数 |
| 4 | 协议迷城 | MQTT 主题与 `+`/`#` 通配、QoS 1/2 语义、Last Will、retain、CoAP/HTTP 场景决策、网关上下游映射 |
| 5 | 嵌入式核心 | GPIO 输入/输出、PWM 频率与占空比、I2C 地址冲突、UART 波特率、休眠折减、看门狗复位 |
| 6 | 智慧家居 | 双阈值照明、门磁报警与复位、重叠阈值顺序、断云不断控、设备认证与订阅 ACL、楼宇综合验收 |
| 7 | 智慧农业 | 土壤湿度启停滞回、温湿双条件、泵保护与量程饱和、覆盖半径、采样到阀门的闭环 |
| 8 | 智慧城市 | 停车容量约束、街灯中继、干道流量分层排障、夜间能耗对照、隧道干扰、跨域联调验收 |
| 9 | 工业与云端 | 现场总线波特率、边缘缓存补发、滑动窗口趋势、MQTT 端到端、三重防护、安全域隔离、全局告警与多域关联、链路冗余、群体协作、最终防线、分阶段重启 |
| 10 | 万物危机 | 多阶段依赖链、滞回恢复、工程验收顺序 |

## 三、验证方式（可复跑）

```bash
npx tsx scripts/validate-content.ts     # → {"valid":60,"target":60,"actualFailedPaths":13,"chapters":10}
npx tsx scripts/check-questions.ts      # → {"checked":120,"failed":0}
npx tsx scripts/run-solutions.ts        # 逐关提交参考解（如本地有）
```

`check-questions.ts` 逐关校验：正确答案能被引擎接受并返回解析、`answered:<id>` 标记写入、重复作答被“已经完成”拦住。

**注意**：答题**不加分**。引擎的 score 只在关卡完成时按 `1000 − 提示×60 − 错误×15 − 多余动作×2` 计算，题目是形成性检查，不是计分项。这是既有设计，改动会影响引擎测试基线。

## 四、仍需注意的边界

- `level-24`（网关协议适配）只覆盖上下游主题边界与线性数值映射，不是真实的协议转译引擎；文案里已注明“教学抽象”。
- 安全类关卡中 `encrypted` 只用于清除 `unencrypted` 故障与任务判据，不参与引擎的路径/投递计算；设备授权也**不等于**平台用户 RBAC。
- 全部关卡 `dimension='3d'`，2.5D/2D 分支仍未启用。
- 每关平均 2.7 个任务、3.4 台设备，离“13 项交付标准”的厚度仍有差距（见 `audit/STATUS-2026-10-21.md`）。
