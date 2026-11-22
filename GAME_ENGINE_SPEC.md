# 引擎公开语义 v1

Codex负责 `packages/engine/src/`。导出 `createState(level,seed):GameState`、`applyCommand(level,state,command):EngineResult`、`evaluate(predicate,state):boolean`、`generateChallenge(baseLevels,mode,seed,round):LevelDefinition`、`replay(level,seed,commands):GameState`。

## 字段与参数
共享类型见packages/shared/src/index.ts。设备parameter定义其类型/范围/枚举，不能写入未定义参数。参数约定：
- sensor：`metric`=temperature/humidity/moisture/light/pressure/air/power/traffic/vibration，`offset`校准偏移，`scale`，`noiseFilter`=0..1，`sampleRate` Hz，`bits` ADC位宽。reading由environment[metric]确定，rawBias设备参数提供故障偏差，offset/scale调整后按ADC量化。`signalFrequency`与sampleRate决定采样是否有效（Nyquist）。
- actuator：`effect`=pump/fan/light/heater/valve/motor/alarm，`duty`0..100，`state`布尔。仿真时pump增加moisture、fan降低temperature、light增加light、heater增温、motor影响vibration，消耗power。过量输出有环境后果。
- controller：`gpioMode`=input/output、`gpioValue`=0/1、`pwmFrequency`、`duty`、`address`、`baudRate`、`bus`=i2c/uart/spi、`sleep`、`interval`。同总线重复address会fault；UART两端baudRate不同会fault；GPIO输入不能驱动执行器。
- radio/router/gateway/terminal/cloud：`protocol`、`channel`、`baudRate`、`address`、`range`、`rssi`、`ssid`、`password`（虚拟配置，非真实凭据）、`role`=coordinator/router/end、`qos`、`topic`、`subscription`、`retain`、`will`、`authenticated`、`encrypted`、`acl`、`online`、`buffer`、`retries`、`ttl`。网络仿真计算可达性；无线同信道且距离不超range；网关authenticated/encrypted等影响status；MQTT主题与订阅匹配才有delivery指标。不是实际协议栈。
- rfid：`tag`、`expectedTag`、`authorized`；power：`voltage`、`current`、`capacity`、`consumption`。
- 故障 `offline` 由enabled/online恢复；`uncalibrated`由offset+rawBias≈0恢复；`noise`由noiseFilter≥0.7恢复；`aliasing`由sampleRate>2×signalFrequency恢复；`address-conflict`、`baud-mismatch`由真实连接配置纠正；`unauthorized`由authenticated恢复；`unencrypted`由encrypted恢复；`interference`由信道/链路条件纠正。其它故障不能通过configure随意清除，use动作需要inventory中对应repair-kit并消耗。

## 命令payload
- start/pause/resume：{}。
- inspect：target=deviceId，记录inspected。
- dialog：target='npc'，payload={index:number}，记录dialogs为'npc:<index>'。
- collect：target=level.inventory中的物品id。
- use：target=deviceId，payload={itemId:string}，消耗物品，repair-kit清除可修复硬件故障。
- install/remove：target=deviceId；remove清除设备连接。
- connect：target=fromId，payload={to:deviceId,kind:'wire'|'wireless'|'bus'|'network'}；断开同签名。
- configure：target=deviceId，payload={key:string,value:Scalar}。
- move：target=deviceId，payload={position:[x,y,z]}。
- rule：payload={rule:ControlRule}；remove-rule target=rule.id。
- simulate：payload={ticks:number}，1..60；每tick代表1教学仿真秒，服务器限制仿真调用速率，计时成绩用真实活动时间；自由沙盒不自动结束。
- hint：target=taskId，计入提示惩罚；不能直接改变设备或完成目标。

## 规则谓词
source=parameter读取state.devices[target].parameters[key]；reading读设备reading；metric读environment[key]；installed/enabled读设备布尔；connected检查target→key直接双向连接；reachable检查合法链路BFS路径；inspected/flag/inventory/fault/rule/task/dialog分别读集合（fault用target设备+key故障）；ticks读tick。

eq/ne严格标量比较，gt/gte/lt/lte仅有限数；includes测试集合包含value；exists/absent测试布尔或是否含指定集合成员。设备关联字段不存在返回false，不能用缺失字段的ne绕过目标。

每条command都校验revision，相同id幂等由持久层处理。非法操作返回accepted=false及解释，但不会重置进度。规则仅在simulate中运行，单tick每条规则最多应用一次，先算读数再评估规则再运行执行器再重算读数/网络。任务按依赖顺序检测，已完成任务记录不可撤销；最终任务必须含工程结果条件，不能仅inspect。状态完成后不能继续更改正式结果。

environment内网络输出：`onlineDevices`、`reachableDevices`、`delivery`(0/1)、`packetLoss`0..1、`energy`、`sampleValid`0/1、`faultCount`。内容可以直接使用parameter条件考察协议语义，但关键章节需结合设备连通或simulation输出，不能全部做参数对照题。

评分=累计任务points，按提示次数、错误和多余操作扣有限罚分，最高1000；星级依900/650阈值。种子挑战修改允许的初始环境/故障/目标配套并带完整solution，可解性用引擎执行solution验证；不能只随机改目标破坏解法。
