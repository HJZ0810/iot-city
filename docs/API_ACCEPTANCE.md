# API 与 WebSocket 集成验收

本文件说明可重复运行的 API 验收脚本。脚本会在目标 API 和数据库中创建带唯一前缀的学生、教师、班级、内容、会话与房间记录；脚本不清理这些数据。建议使用一次性隔离数据库和仅供验收的管理员账号。

## 运行前提

- Node.js 支持原生 `fetch`、ES modules 和 `Headers.getSetCookie()`；项目依赖 `ws` 已安装。
- API 已启动并连接可写数据库，且官方 `level-01`、`level-06` 及其管理员可读完整内容可用。
- 管理员账号具备用户角色修改、内容读取和密码重置权限。
- `PUBLIC_ORIGIN` 必须与 API 认可的站点来源一致。默认值为 `BASE_URL` 的 origin。
- 注册接口限流为每分钟 5 次；脚本每轮创建 3 个用户，避免重复快速运行。

示例环境变量（PowerShell）：

```powershell
$env:BASE_URL = 'http://127.0.0.1:3220'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:3220'
$env:ADMIN_USERNAME = 'acceptance-admin'
$env:ADMIN_PASSWORD = '<通过本机安全环境注入>'
$env:REPORT_PATH = 'audit/api-integration.json'
node tests/api.integration.mjs
```

报告只记录 API origin、检查名称、结果状态和错误的 endpoint/预期/实际状态码或错误码；不会写入密码、Cookie 或认证头。失败退出码为非零。默认报告路径是 `audit/api-integration.json`。

## 检查覆盖

- 独立 Cookie 会话、匿名请求拒绝、注册角色限制和管理员角色调整。
- 官方关卡完整解法结算、服务端成绩记录、同命令幂等重放、revision 冲突、跨用户存档隔离、暂停/恢复、重新登录后恢复。
- 教师班级/成员权限、发布到班级、作业创建、内容更新为新版本、旧会话继续绑定旧版本，以及已保存事件快照和最终会话状态一致性。
- 管理员密码重置撤销旧会话；最后一名管理员保护（仅当活跃管理员恰好一人时执行）；自由沙盒和标准挑战标记；排行榜可读。
- Cookie 鉴权的 WebSocket、合作房间通过关、房间人数上限、PvP 暂停拒绝与服务端结算。

测试数据使用随机前缀 `it...`。重复执行会留下新的记录，避免误删已有数据。管理接口真实密码重置会改变验收教师账号密码，因此每轮都新建教师账号。

## 验收边界

脚本不访问服务器、不验证部署域名，也不操作浏览器 UI。合作与 PvP 通过独立 WebSocket 连接模拟两个 Cookie 身份，不能代替两个或四个真实浏览器的重连、渲染和人工交互验收。脚本自身尚未对目标服务执行；语法检查通过仅表示脚本可解析，不表示 API、数据库或实时流程已通过。

## 题库 API

题库路由由 `registerQuestionRoutes(app, ctx)` 注册，要求教师或管理员会话：

- `GET /api/questions?scope=mine|available` 列出作者题目（含草稿）或当前已发布可用题目（含自己的草稿），仅返回列表元信息。
- `POST /api/questions` 接收 `{definition: QuestionDefinition}` 并由服务端生成题库 ID。
- `GET /api/questions/:id` 读取完整定义；草稿只对作者和管理员开放，已发布题目需符合全局或班级访问范围。
- `PUT /api/questions/:id` 编辑作者题目，并将其退回草稿；题库变化不会改写关卡里已有的题目副本。
- `POST /api/questions/:id/copy` 复制授权可读题目为当前用户的新草稿。
- `POST /api/questions/:id/publish` 接收 `{classId}` 或管理员专用 `{global:true}`。
- `DELETE /api/questions/:id` 停用题目并保留记录。

单选答案需匹配唯一选项 ID；多选答案需为不重复的非空选项子集；数值题答案必须为数字；文本题答案不得为空。学生无权访问这些题库路由，学生关卡视图会删除每道题目的 `answer` 与 `explanation` 字段。题库 CRUD 尚未纳入上方集成脚本，需在后续隔离 API 验收中单独覆盖。
