# 公共契约 v1

唯一类型/Schema来源：`packages/shared/src/index.ts`。所有API成功 `{data: T}`；失败 `{error:{code,message,details?}}`。Cookie登录，同源credentials，不把密码或token写localStorage。JSON最大512KB，关卡编辑最大1MB，设备≤64。

## API
- GET /api/health → {status,version,database}
- POST /api/auth/register {username,password,nickname?} → UserView，role只能student
- POST /api/auth/login {username,password} → UserView + HttpOnly Cookie
- POST /api/auth/logout {} → {ok:true}
- GET /api/auth/me → UserView，未登录401
- PATCH /api/auth/me {nickname} → UserView
- GET /api/chapters → ChapterView[]
- GET /api/levels → PublicLevel[]，不返回solution/failureCase
- GET /api/levels/:id → PublicLevel
- GET /api/progress → ProgressView
- POST /api/sessions {levelId?,mode,projectId?,challenge?} → SessionView；每日种子由服务端决定，story必传levelId；沙盒加载可传projectId；沙盒标准挑战challenge=true可结算，默认自由实验不计榜
- POST /api/sessions/:id/next {} → SessionView，仅已完成的无尽会话可进入下一轮
- GET /api/sessions/:id → SessionView
- POST /api/sessions/:id/commands → GameCommand → {session:SessionView,result:EngineResult,resultRecord:AttemptResult|null}；revision冲突409 + details.session
- GET /api/sessions/:id/events → {initial:GameState,events:EventView[]}，仅本人/授权教师/管理员
- GET /api/leaderboards?mode=overall|GameMode&scope=individual|team|class&classId?&season=current|all → LeaderboardEntry[]
- GET /api/reports/me → {attempts,completed,totalScore,knowledge:Array<{name,attempts,errors}>,recent:AttemptResult[]}
- GET /api/sandbox → Array<{id,name,updatedAt}>
- POST /api/sandbox {name,sessionId:string} → {id}，按本人沙盒会话快照保存；也兼容{name,level:LevelDefinition}；不需要客户端拿到解法，自建工程不产生竞赛分
- GET /api/sandbox/:id → {id,name,level:PublicLevel}

## 班级与后台业务（OpenCode承接）
- GET /api/classes → ClassView[]（学生自己的/教师负责的/管理员全部）
- POST /api/classes {name} → ClassView（teacher/admin）
- POST /api/classes/join {code} → ClassView（学生）
- GET /api/classes/:id/members → Array<UserView & {completed:number,totalScore:number,groupId:string|null}>（授权教师/admin）
- DELETE /api/classes/:id/members/:userId → {ok:true}（授权教师/admin）
- GET /api/classes/:id/assignments → AssignmentView[]（班级成员/授权教师/admin）
- POST /api/classes/:id/assignments {levelId,title,mode,dueAt?} → AssignmentView（授权教师/admin）
- GET /api/classes/:id/report → {members,assignments,results,knowledge,groups}（授权教师/admin）
- GET /api/classes/:id/export → CSV（UTF8 BOM，单元格公式注入防护）
- POST /api/classes/:id/groups {name,memberIds:string[]} → {id,name,memberIds}（授权教师/admin）
- GET /api/content → Array<{id,title,status,version,ownerId,updatedAt}>（自己内容/授权班级内容；admin全部）
- POST /api/content {level:LevelDefinition} → {id,version,status:'draft'}（teacher/admin）
- GET /api/content/:id → {level:LevelDefinition,status,ownerId}（作者或admin）
- PUT /api/content/:id {level:LevelDefinition} → {id,version,status:'draft'}（作者或admin）
- POST /api/content/:id/preview {} → SessionView（作者/admin，不结算正式榜单）
- POST /api/content/:id/publish {classId?:string,global?:boolean} → {id,version,status:'published'}；global只有admin，class需所属教师
- POST /api/content/:id/rollback {version:number} → {id,version,status:'draft'}（复制旧内容为新草稿）
- DELETE /api/content/:id → {ok:true}（停用，不删除历史版本）
- GET /api/admin/users → UserView[]（admin）
- PATCH /api/admin/users/:id {role?,nickname?,disabled?} → UserView（admin，不可禁用最后一个admin）
- POST /api/admin/users/:id/reset-password {password} → {ok:true}（admin，撤销旧session）
- GET /api/admin/audit → Array<{id,actorId,action,targetId,createdAt}>
- GET /api/admin/overview → {users,classes,levels,sessions,activeRooms,results,version,uptime}
- GET /api/admin/settings → {dailyRefreshHour,eventRetentionDays,seasonId,maxRoomPlayers}
- PUT /api/admin/settings 同字段，严格校验，admin
- GET/POST /api/admin/assets → 仅登记来自受控本地资源的资产元数据，禁止任意服务器路径访问
- POST /api/admin/seasons {name} → {id,name}；保留历史

## 实时（Codex维护）
- GET /api/rooms → RoomView[]
- POST /api/rooms {mode:'coop'|'pvp',levelId?,maxPlayers?:2|4} → RoomView
- POST /api/rooms/join {code} → RoomView
- GET /api/rooms/:id → RoomView
- POST /api/rooms/:id/ready {ready:boolean,team?:0|1,engineerRole?} → RoomView
- POST /api/rooms/:id/start {} → RoomView；仅host，至少2人，PvP人数平衡
- POST /api/rooms/:id/leave {} → {ok:true}
- POST /api/matchmaking {size:2|4} → RoomView（进入等待队列，可取消）
- WS /ws：ClientMessage/ServerMessage见shared；每次连接cookie鉴权，房间读写必须验证成员资格。

## 硬件终端（HCP/1，规范见 docs/hardware/HCP-v1.md）
类型与限额唯一来源：`packages/shared/src/hardware.ts`。硬件只上报按键，不提交分数或胜负；命令由网关按服务器保存的按键映射翻译，并仍走 `game.executeCommand` 的 revision 与引擎校验。
- POST /api/hw/enroll {installationId,model,fw,caps} → {deviceId,token,pairCode,pairExpiresAt,wsUrl,heartbeatSeconds}；无 Cookie，配了 `HW_ENROLL_KEY` 时需 `x-provision-key`，限流 10 次/小时/IP
- GET /api/hw/devices → HwDeviceView[]（本人；admin 可管理）
- POST /api/hw/bind {code,name?} → HwDeviceView；code 8 位，10 分钟有效，一次性，每账号最多 4 台
- DELETE /api/hw/devices/:id 或 POST /api/hw/devices/:id/revoke → {ok:true}；轮换令牌并关闭在途连接
- POST /api/hw/devices/:id/attach {sessionId|null} → {ok,attachedSessionId}；只接受本人且非 coop/pvp 的会话
- GET /api/hw/devices/:id/screen → {screen}，供网页做终端预览，不改变设备状态
- WS /hw/v1：`Authorization: Bearer <deviceToken>`；上行 hello/input/ack/sensor/ping/bye，下行 hello/ready/hud/toast/pong/err/bye
- 约束：单帧 ≤8KB；输入 ≤10 次/秒、300 次/分；心跳 20 秒、60 秒无帧断开；硬件可触发命令仅 start/pause/resume/inspect/dialog/simulate/hint/answer；sensor 仅在非标准挑战沙盒中接受且不注入仿真

## 板端轨道（B 轨，规范见 docs/hardware/BOARD-TRACK.md）
板端关卡不复用剧情引擎：学生代码跑在自己的开发板上，服务器用探针采集硬件证据判题。分数只在服务端计算。
- GET /api/board/chapters → ChapterView[]
- GET /api/board/levels → PublicBoardLevel[]（不含 solution / probes / 答案）
- GET /api/board/levels/:id → PublicBoardLevel
- POST /api/board/sessions {levelId} → BoardRunView（一人同时只跑一关）
- GET /api/board/sessions/current → BoardRunView|null
- POST /api/board/sessions/evidence {pid,facts} → {result,view,finished}；pid 必须是当前考察项，否则 409 PROBE_MISMATCH
- POST /api/board/sessions/answer {optionId} → BoardRunView（屏上答题）
- POST /api/board/sessions/hint → BoardRunView（每次提示 -40 分）
- POST /api/board/sessions/abandon → {ok:true}
- GET /api/board/leaderboard?scope=individual|class&classId?&limit? → {rank,name,score,stars,attempts}[]（班级榜需 assertClassAccess；同一用户取最高分）
- GET /api/board/results → Array<{levelId,score,stars,createdAt}>（本人 B 轨成绩）
- WS /hw/v1 追加：下行 exam / probe / probe-result，上行 evidence / report；caps 可声明 board 与 features
- 约束：单探针连续失败 3 次判关卡失败；同关卡重开=续玩，换关卡重开=旧局 abandoned；通过/失败写 board_results（按 session 幂等，放弃局不写）；进程重启由 board_sessions.run 载回进行中关卡

## 后台代码与核心的接口
核心提供 `services/api/src/context.ts`：
```
interface AppContext {
 db: Database; // query<T>(sql,values?): Promise<T[]>; execute(sql,values?): Promise<{affectedRows:number}>; transaction<T>(fn:(tx:Database)=>Promise<T>):Promise<T>
 requireUser(request:FastifyRequest):Promise<UserView>;
 requireRole(request:FastifyRequest,allowed:Role[]):Promise<UserView>;
 assertClassAccess(user:UserView,classId:string,write?:boolean):Promise<void>;
 audit(actorId:string,action:string,targetId:string,details?:unknown):Promise<void>;
 getLevel(id:string,version?:number,user?:UserView):Promise<LevelDefinition>;
 createSession(user:UserView,options:{levelId?:string;mode:GameMode;preview?:boolean}):Promise<SessionView>;
 getRoomCount():number;
}
```
后台导出 `registerManagementRoutes(app:FastifyInstance,ctx:AppContext):Promise<void>` 放在 `services/api/src/management/index.ts`。只允许业务目录management内文件，不改核心。数据库表定义以 DATABASE.md 为准；无权创建迁移。

## 内容验收
packages/content/src/index.ts 导出 `levels:LevelDefinition[]`（60关，id=level-01..level-60）、`chapters:ChapterView[]`、`getLevel(id:string):LevelDefinition|undefined`。每关solution从briefing起执行（包含start），服务器绝不向学生返回它。失败案例用于验证错误反馈或无法通关，不要求每次错误立刻失败。每关必须有≥2真实任务，≥3操作，不同工程机制与因果仿真，不允许仅替换文案。所有设备参数与条件字段必须能被引擎计算；遇到缺失机制先报告，不伪造支持。
