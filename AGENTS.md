# 万物之城工程约束

- 完整需求见 `docs/source/任务.md`。当前对话修订优先：部署仅 Server2；独立用户名密码账号；正式域名 `iot.luo-jin-ai.com`。
- 总体目标是完成 P0–P7，不以阶段成果冒充完整交付。60 关必须有实质不同的工程任务；禁止空关卡、假联机、虚构成绩。
- Codex 维护 `packages/shared`、`packages/engine`、核心数据库迁移、存档/结算和实时权威服务。OpenCode 按独立工单实现内容、UI、后台常规业务和验证。
- 工单之外的文件不得修改；公共契约变更先报告 Codex；每个任务写明结果与实际执行的测试。不打印秘密。
- 不允许 OpenCode 访问生产服务器。所有服务器命令由 Codex 通过 `D:\PRO\claw\linshi\server-manager\server.ps1` 显式指定 `-Server server2` 执行。
- 使用独立 Git worktree 和任务分支。不得覆盖或丢弃已有改动。禁止修改源需求文档。
- 站点、API、WebSocket 同源；HttpOnly Cookie 登录；所有教师和管理操作服务端鉴权。注册不允许自选教师或管理员。
- 学业分数没有金钱属性。禁止接入扣款、充值或维护金融余额。
- 类型严格，内容与引擎分离，规则 DSL 不执行任意代码。随机数种子化。结算仅由服务器计算。
- 每项完成必须有构建、功能验收或可复现证据；用户明确要求的测试属于本任务范围。禁止虚构性能、并发或美术质量。
- 当前对话补充：免费DeepSeek/GLM遭上游限流后，用户明确改派GPT-6-Luna承担原批量工单。当前web/content/management三个GPT-6-Luna子代理在独立worktree开发；不调用收费外部模型替代。
