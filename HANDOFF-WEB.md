# Web 学生端交接

## 已实现

- React 19 + TypeScript + Vite 学生端入口：独立用户名密码注册、登录和退出；角色只读服务端用户对象，不在客户端授予角色。
- 城市大厅、章节地图、学习报告、个人/团队与九模式榜单、自由沙盒、协作/竞技房间、**我的终端**、个人档案等页面。关卡、章节、进度、统计和榜单均读取 API；空数据和请求错误分别呈现，不含预置分数/名单。
- **我的终端（板子线入口）**：`apps/web/src/pages/TerminalPage.tsx`。配对码绑定开发板（`/api/hw/bind`）、解绑、拉取板载画面（`/api/hw/devices/:id/screen`，按 HUD 控件本地重绘，不伪造无硬件时的画面）；板端关卡按章节浏览、开始一关后显示服务端下发的当前考察项与采样窗口、显示提示（扣分由服务端算）、屏上答题、放弃；任务书展示 `brief/objective/knowledge/pins/starterCode`。参考解与探针正文永不下发，页面也没有对应字段可读。
- 游戏控制台按服务端会话状态渲染任务、NPC、设备、设备参数、物资、安装/拆卸、连线、暂停/恢复和仿真。所有操作携带 `crypto.randomUUID()` 与当前服务端 revision；409 使用错误详情中的 session 快照同步。分数和任务完成状态不由客户端推断。
- 真实 Three.js / React Three Fiber 设备场景由动态 import 加载；主题受关卡 scene 和设备坐标驱动。低特效偏好关闭阴影并切换至可操作的 2D 场景。页面不可见时提交暂停命令；尊重系统减少动画设置。音效默认关闭，用户启用后才播放确认音。
- 房间通过 REST 创建/加入/准备/开始/离开，并建立 cookie 鉴权 WS 连接接收房间状态广播；已开始的房间读取关卡及房间队伍状态，游戏命令通过 WS 携带服务端 revision 并等待 ack 更新，断连/拒绝不会显示为本地成功。场景展示真实房间队员、在线状态、队伍和房间消息；结束结果使用服务端 winner。PvP 禁止暂停。
- 教师/管理员导航入口按角色显示，ManagementApp 通过 lazy 插槽接入，契约为 `ManagementApp({user: UserView, onExit: () => void})`。
- Vite 输出目录为 `dist/web`，与 API 静态文件路径约定一致。

## 实际验证

- `node_modules/.bin/tsc.cmd --noEmit`：通过。
- `node_modules/.bin/vite.cmd build`：通过；Three.js 场景 chunk 约 887 KB（gzip 240 KB），这是按需加载的独立 chunk，构建器给出 chunk size 提示。
- 使用真实引擎测试夹具渲染并检查了桌面游戏现场（仅用于本地视觉预览，不代表联机验收）。API `127.0.0.1:3220` 不可达，未执行真实登录后页面、WS 命令/ack 或多客户端联机验收；未取得移动窄屏截图。

## 仍需完成/集成验收

- 本分支当前只收到并实际显示 API 返回的关卡数量；完整 10 章×60 关的内容和相应后端 API 仍需集成后验收。不能把当前数据称为 60 关已可玩。
- 需要 API 服务就绪后逐页核对响应结构、cookie 登录/注册、错误码和 409 结构，以及存档恢复和无尽下一轮。
- 真实后端 API 就绪后需验收 WS 鉴权、房间队伍状态、命令 revision/ack、拒绝与断连、对局结束 winner、多客户端协作及 1v1/2v2 竞技。当前 UI 接线不等于已验证真实多人比赛。
- 团队榜 API query 目前只有 `scope=team`，UI 通过模式切换显示；class 维度筛选待后端提供 classId 选择数据。
- 管理导航/动态插槽目前是明确的集成占位组件；教师/管理员工作台需接入管理工单实现与 API 后才能验收。
- 沙盒可创建/恢复 session 并按当前会话快照保存存档；待后端实现 `POST /api/sessions {mode:'sandbox',projectId}` 与 `POST /api/sandbox {name,sessionId}` 后实测。
- 场景用低面数程序化物件呈现，章节主题根据场景类型区分；正式 3D 美术资产、跨设备视觉检查和实际 2D/移动端截图仍未完成。

## 导航接入点

主入口：`apps/web/src/App.tsx`。教师和管理员菜单通过 `user.role` 过滤；新增页面使用 Page union 并添加懒加载分支。管理组件应导出默认组件并接受 `user` 与 `onExit`。API client 位于 `apps/web/src/api.ts`，场景在 `apps/web/src/WorldScene.tsx`。

## 视觉与 3D 现场（2026-10-21 重做）

主题从深色青绿整体改为**白蓝/白绿浅色**：纸白底（`#f4f8f7`）+ 纯白卡片 + 1px 细边 + 三级轻投影，强调色分三档（主操作绿 `#0f9b7d` / 信息蓝 `#2563eb` / 提醒琥珀 `#b45309`）。

- 令牌在 `apps/web/src/styles/01-foundation.css`；表面层（卡片、顶栏、按钮、表格、表单、章节插画）在 `apps/web/src/styles/07-light-polish.css`。
- `scripts/lightify.mjs` 是一次性反色脚本（明度/饱和度三档映射），产物还要人工修；**不要**再对已经改好的样式跑它。
- 板载屏幕预览（`.board-screen`）刻意保留深色，用来模拟真实 TFT。

3D 现场：

- `apps/web/src/scene/textures.ts`：ambientCG 的 CC0 贴图（混凝土/石材/沥青/金属/木纹/瓷砖/草地），512px JPG，共 463KB，位于 `apps/web/public/tex/`。**贴图不克隆**，按「材质 + 密度档」共享实例，图片到达后由 three 自行上传。
- `apps/web/src/scene/kits.tsx`：十个场景各一套手写布景（城市/实验室/大棚/家居/车间/机房/路口/电力/网络/危机），含地坪、墙体、机柜、工作台、绿植、护栏、管线、路灯等实体。
- `apps/web/src/WorldScene.tsx`：自写球坐标轨道相机（不用 `OrbitControls`，它会和 `lookAt` 叠加出滚转把地平线拧歪）；`RoomEnvironment` + PMREM 做 IBL；一盏带 2048 阴影图的主光。
- 设备标签用 `sprite`，永远正对镜头。

**构建注意**：`vite.config.ts` 必须保留 `publicDir: 'apps/web/public'`，否则 `public/tex` 不会进 `dist/web`，贴图会静默 404。
