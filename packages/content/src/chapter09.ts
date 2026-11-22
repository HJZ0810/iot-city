import type { LevelDefinition, DeviceDefinition, ParameterDefinition, Predicate, TaskDefinition } from '../../shared/src/index.ts';

const p=(label:string,value:string|number|boolean,type:ParameterDefinition['type']=typeof value==='boolean'?'boolean':typeof value==='number'?'number':'text',extra:Partial<ParameterDefinition>={}):ParameterDefinition=>({label,value,type,...extra});
const device=(id:string,kind:DeviceDefinition['kind'],label:string,parameters:DeviceDefinition['parameters'],position:[number,number,number],options:Partial<Pick<DeviceDefinition,'installed'|'enabled'|'faults'|'description'|'model'>>={}):DeviceDefinition=>({id,kind,label,model:options.model??label,position,installed:options.installed??true,enabled:options.enabled??true,parameters,faults:options.faults??[],description:options.description??label});
const task=(id:string,label:string,description:string,knowledge:string[],requires:string[],all:Predicate[],hint:string,feedback:string,points:number):TaskDefinition=>({id,label,description,knowledge,requires,all,hint,feedback,points});
const start={type:'start' as const,payload:{}};
const base=(number:number,title:string,subtitle:string,scene:LevelDefinition['scene'],difficulty:number,briefing:string,ending:string,knowledge:string[],npc:LevelDefinition['npc'],devices:DeviceDefinition[],links:LevelDefinition['links'],environment:Record<string,number>,tasks:TaskDefinition[],explanation:string,references:LevelDefinition['references'],solution:LevelDefinition['solution'],failureCase:LevelDefinition['failureCase']):LevelDefinition=>({id:`level-${String(number).padStart(2,'0')}`,number,chapter:9,version:1,title,subtitle,scene,dimension:'3d',difficulty,estimatedMinutes:12,briefing,ending,knowledge,npc,devices,links,environment,inventory:[],tasks,rules:[],failures:[],explanation,references,solution,failureCase});

const industrialSignal=base(49,'工业信号','现场控制器与网关的串口参数不一致，数据在物理层就丢了。','factory',2,
 '装配线的振动控制器通过现场总线接到边缘网关。交接班记录写着“设备在线但收不到数据”，值班工程师怀疑不是网络问题，而是两侧串口参数不一致。你需要先确认总线类型与连接关系，再把控制器波特率改回网关铭牌上的 19200，最后运行仿真观察参数是否生效。',
 '控制器与网关的串口参数重新对齐，工业现场信号恢复上行。',['串口通信','波特率匹配','现场总线'],
 {name:'邵工',role:'产线自动化工程师',lines:['先看总线类型，UART 和 I2C 的排查方式完全不同。','网关侧面铭牌写的是 19200，控制器出厂设置是 9600。']},
 [device('plc','controller','振动控制器',{bus:p('现场总线','uart','select',{options:['i2c','uart','spi']}),baudRate:p('波特率',9600,'number',{min:1200,max:115200}),interval:p('采样周期',1,'number',{min:1,max:60})},[0,0,0],{description:'通过 UART 与网关通讯的现场控制器。'}),device('gw','gateway','产线边缘网关',{online:p('在线',true),subscribed:p('订阅现场信号',true)},[3,0,0],{description:'汇聚现场总线数据并转发到平台。'}),device('cloud','cloud','产线监控平台',{online:p('在线',true)},[6,0,0],{description:'展示产线实时状态。'})],
 [{from:'plc',to:'gw',kind:'wire',quality:1},{from:'gw',to:'cloud',kind:'network',quality:1}],{vibration:2},[
 task('survey-line','核对总线与链路','检查控制器、网关与平台，确认总线类型为 UART 且链路已连接。',['现场总线','链路核对'],[],[{source:'inspected',target:'plc',op:'exists'},{source:'inspected',target:'gw',op:'exists'},{source:'inspected',target:'cloud',op:'exists'},{source:'parameter',target:'plc',key:'bus',op:'eq',value:'uart'},{source:'connected',target:'plc',key:'gw',op:'eq',value:true}], '逐个检查三台设备，并用连接状态确认控制器到网关的物理链路。','总线类型为 UART，控制器与网关已在同一链路上。',200),
 task('align-baud','按铭牌对齐波特率','把控制器波特率改为 19200，并运行仿真确认参数生效。',['波特率匹配','参数下发'],['survey-line'],[{source:'parameter',target:'plc',key:'baudRate',op:'eq',value:19200},{source:'ticks',op:'gte',value:1}], 'configure 目标为控制器，键名 baudRate，值取网关铭牌上的 19200。','两侧串口参数一致，现场信号恢复上行。',400)],
 'UART 通信要求收发双方波特率一致；不一致时物理层无法正确采样，表现为“设备在线但无数据”。本关只验证参数对齐这一层，不模拟真实 RS-485 电气特性、帧格式与校验错误。',
 [{title:'TI, RS-485 Design Guide',url:'https://www.ti.com/lit/an/slla272d/slla272d.pdf'}],
 [start,{type:'inspect',target:'plc',payload:{}},{type:'inspect',target:'gw',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'configure',target:'plc',payload:{key:'baudRate',value:19200}},{type:'simulate',payload:{ticks:1}}],
 [start,{type:'simulate',payload:{ticks:1}}]);

const edgeBuffer=base(50,'边缘缓存','网络闪断时先缓存、复联后补发，而不是丢数据。','factory',3,
 '注塑车间的边缘网关每隔几分钟就会短暂掉线。温控探头本身正常，但平台侧的数据出现空洞。你需要在探头上启用发送缓冲，让掉线期间的采样先存在本地，恢复后再补发；随后运行仿真观察采样窗口是否真的累积起来。',
 '探头在断网期间保留采样，复联后补发成功，平台侧不再出现数据空洞。',['边缘缓存','数据补发','采样窗口'],
 {name:'杜敏',role:'车间数据工程师',lines:['探头带采样窗口参数，仿真每跑一秒就会记一个采样。','缓冲开着，掉线才不至于把这段数据直接扔掉。']},
 [device('edge','sensor','温控探头',{metric:p('测量对象','temperature','select',{options:['temperature','humidity']}),bufferEnabled:p('启用缓冲',false),historyWindow:p('采样窗口',10,'number',{min:2,max:120}),topic:p('上报主题','plant/mold/temp','text'),sinkDevice:p('发送目标','gw','text'),bufferLimit:p('缓冲上限',20,'number',{min:1,max:120})},[0,0,0],{description:'采集温度并缓存掉线期间的采样值。'}),device('gw','gateway','车间边缘网关',{online:p('在线',true),subscription:p('订阅主题','plant/+/temp','text')},[3,0,0]),device('cloud','cloud','注塑数据平台',{online:p('在线',true)},[6,0,0])],
 [{from:'edge',to:'gw',kind:'wireless',quality:1},{from:'gw',to:'cloud',kind:'network',quality:1}],{temperature:26},[
 task('inspect-buffer','确认探头与缓存状态','检查探头、网关和平台，确认缓冲当前是关闭的。',['边缘缓存','采样窗口'],[],[{source:'inspected',target:'edge',op:'exists'},{source:'inspected',target:'gw',op:'exists'},{source:'inspected',target:'cloud',op:'exists'},{source:'parameter',target:'edge',key:'bufferEnabled',op:'eq',value:false},{source:'reachable',target:'edge',key:'cloud',op:'eq',value:true}], '检查后读参数：bufferEnabled 现在是 false，说明掉线时会直接丢采样。','探头与平台可达，但缓冲未开启。',200),
 task('enable-buffer','开启缓冲并验证采样累积','启用缓冲，仿真三秒后确认采样窗口里已有多个采样。',['缓冲开关','采样累积'],['inspect-buffer'],[{source:'parameter',target:'edge',key:'bufferEnabled',op:'eq',value:true},{source:'metric',key:'sampleCount_edge',op:'gte',value:3},{source:'ticks',op:'gte',value:3}], '先 configure bufferEnabled=true，再 simulate 3 秒；sampleCount_edge 反映窗口内采样数。','缓冲开启后采样持续累积，复联即可补发。',420)],
 '探头带有采样窗口参数时，每个仿真 tick 会把当前读数压入窗口，环境量 sampleCount_<设备> 记录窗口长度。缓冲开关决定掉线期间是缓存还是丢弃。本关不模拟真实环形缓冲溢出策略与断点续传握手。',
 [{title:'AWS IoT Core 开发者指南',url:'https://docs.aws.amazon.com/iot/latest/developerguide/iot-gs.html'}],
 [start,{type:'inspect',target:'edge',payload:{}},{type:'inspect',target:'gw',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'configure',target:'edge',payload:{key:'bufferEnabled',value:true}},{type:'simulate',payload:{ticks:3}}],
 [start,{type:'inspect',target:'edge',payload:{}},{type:'simulate',payload:{ticks:3}}]);

const timeline=base(51,'时序异常','单点读数正常不代表过程正常，趋势要放在窗口里看。','factory',3,
 '热处理炉的温度单点读数一直在允许范围内，但工艺员发现曲线形状不对。平台保留了最近的采样窗口和异常阈值参数。你需要检查探头与平台的配置，运行足够长的仿真让窗口填满，再用窗口统计判断这段时间是否稳定。',
 '采样窗口填满，运行趋势被判读清楚，工艺曲线恢复正常监控。',['时序数据','滑动窗口','趋势判读'],
 {name:'何工',role:'热处理工艺员',lines:['单点读数合格，不代表过程没有漂移。','窗口里样本太少时，任何趋势判断都不可信。']},
 [device('probe','sensor','炉温探头',{metric:p('测量对象','temperature','select',{options:['temperature','vibration']}),historyWindow:p('采样窗口',10,'number',{min:2,max:120}),anomalyThreshold:p('异常阈值',5,'number',{min:1,max:50}),sampleInterval:p('采样间隔',1,'number',{min:1,max:10})},[0,0,0],{description:'记录炉温滑动窗口与异常阈值。'}),device('cloud','cloud','热处理监控平台',{online:p('在线',true)},[3,0,0])],
 [{from:'probe',to:'cloud',kind:'network',quality:1}],{temperature:860},[
 task('inspect-window','检查窗口与阈值配置','检查探头与平台，确认采样窗口为 10、异常阈值为 5。',['滑动窗口','告警阈值'],[],[{source:'inspected',target:'probe',op:'exists'},{source:'inspected',target:'cloud',op:'exists'},{source:'parameter',target:'probe',key:'historyWindow',op:'eq',value:10},{source:'parameter',target:'probe',key:'anomalyThreshold',op:'eq',value:5}], 'inspect 后读参数：historyWindow 与 anomalyThreshold 都在参数面板里。','窗口长度与阈值符合工艺规程。',210),
 task('fill-window','填满窗口并判读趋势','仿真四秒让窗口累积样本，确认窗口统计量已经可用。',['采样累积','窗口统计'],['inspect-window'],[{source:'metric',key:'sampleCount_probe',op:'gte',value:4},{source:'metric',key:'windowMean_probe',op:'gt',value:0},{source:'ticks',op:'gte',value:4}], 'simulate 4 秒；windowMean_probe 为窗口均值，sampleCount_probe 为样本数。','窗口已填满，均值与趋势统计可用，异常可被识别。',430)],
 '探头按采样间隔把读数压入长度 10 的滑动窗口，平台侧可读 sampleCount、windowMean、windowRange、trend 等窗口统计量；异常阈值用于判断窗口极差是否越界。本关不模拟真实时序数据库压缩、插值或告警抑制策略。',
 [{title:'InfluxDB 时序数据文档',url:'https://docs.influxdata.com/influxdb/'}],
 [start,{type:'inspect',target:'probe',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'simulate',payload:{ticks:4}}],
 [start,{type:'simulate',payload:{ticks:4}}]);

const cloudEye=base(52,'云端之眼','主题通配符写错一位，平台就永远收不到数据。','datacenter',3,
 '污水厂把在线数据推到城市物联网平台，网关侧显示发送成功，平台却查不到点位。值班平台管理员提示：先核对网关发布主题与平台订阅主题是否真的匹配，再运行仿真看投递指标。这里的关键不是“连上了”，而是“主题对得上”。',
 '网关与平台主题匹配，投递指标恢复，云端终于“看见”现场。',['MQTT 主题','通配符匹配','端到端投递'],
 {name:'苏珊',role:'平台运维管理员',lines:['连上不等于收到，主题少一位通配符就差一个层级。','平台订阅的是 water/+/flow，网关发的是 water/plant/flow。']},
 [device('gw','gateway','污水厂网关',{online:p('在线',true),authenticated:p('平台认证',true),topic:p('发布主题','water/plant/flow','text'),subscription:p('网关订阅','water/+/flow','text')},[0,0,0]),device('cloud','cloud','城市物联网平台',{online:p('在线',true),authenticated:p('平台认证',true),subscription:p('平台订阅','water/+/flow','text')},[3,0,0])],
 [{from:'gw',to:'cloud',kind:'network',quality:1}],{flow:32},[
 task('compare-topics','对比两侧主题','检查网关与平台，确认双方在线且认证通过。',['主题层级','认证状态'],[],[{source:'inspected',target:'gw',op:'exists'},{source:'inspected',target:'cloud',op:'exists'},{source:'parameter',target:'gw',key:'online',op:'eq',value:true},{source:'parameter',target:'cloud',key:'authenticated',op:'eq',value:true},{source:'reachable',target:'gw',key:'cloud',op:'eq',value:true}], '链路可达、两侧在线，问题只剩主题是否匹配。','两侧在线且可达，需要继续核对主题层级。',210),
 task('fix-subscription','按实际主题修正订阅','把平台订阅改为与发布主题一致的层级，并仿真验证投递。',['通配符匹配','投递验证'],['compare-topics'],[{source:'parameter',target:'cloud',key:'subscription',op:'eq',value:'water/plant/flow'},{source:'metric',key:'delivery',op:'eq',value:1},{source:'ticks',op:'gte',value:1}], '平台订阅改成 water/plant/flow 后，投递指标 delivery 才会变成 1。','主题匹配成功，平台侧出现现场点位数据。',430)],
 'MQTT 主题按层级匹配，+ 匹配单层、# 匹配多层；发布主题 water/plant/flow 与订阅 water/+/flow 的层级数不同，因此不匹配。投递指标 delivery 由引擎在主题匹配且链路可达时为 1。本关不模拟真实 Broker 的会话保持、保留消息与心跳。',
 [{title:'OASIS MQTT 5.0 规范',url:'https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html'}],
 [start,{type:'inspect',target:'gw',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'configure',target:'cloud',payload:{key:'subscription',value:'water/plant/flow'}},{type:'simulate',payload:{ticks:1}}],
 [start,{type:'inspect',target:'gw',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'simulate',payload:{ticks:1}}]);

const identityTrap=base(53,'身份陷阱','能连通不等于有资格上报，缺认证的设备必须被挡住。','datacenter',4,
 '园区能耗采集终端能连到平台，但上报一律被拒。安全策略要求：设备必须携带认证信息、链路必须加密、并且访问列表允许。你要先确认当前三项配置全部缺失，再逐项补齐，最后仿真验证平台开始接收数据。',
 '终端完成认证与加密，访问列表放行，能耗数据恢复上报。',['设备认证','传输加密','访问控制列表'],
 {name:'梁策',role:'园区安全审计员',lines:['先看 authenticated、encrypted、acl 三个参数。','三项都补齐才算合规，缺一项平台都不会收。']},
 [device('meter','terminal','能耗采集终端',{authenticated:p('已认证',false),encrypted:p('链路加密',false),acl:p('访问列表','deny','select',{options:['allow','deny']}),topic:p('上报主题','park/meter/power','text')},[0,0,0],{description:'园区能耗采集终端，安全参数默认未配置。'}),device('cloud','cloud','园区能效平台',{online:p('在线',true),authenticated:p('平台认证',true)},[3,0,0])],
 [{from:'meter',to:'cloud',kind:'network',quality:1}],{power:120},[
 task('audit-security','审计三项安全配置','检查终端与平台，确认认证、加密、访问列表当前都不合规。',['安全基线','访问控制'],[],[{source:'inspected',target:'meter',op:'exists'},{source:'inspected',target:'cloud',op:'exists'},{source:'parameter',target:'meter',key:'authenticated',op:'eq',value:false},{source:'parameter',target:'meter',key:'encrypted',op:'eq',value:false},{source:'parameter',target:'meter',key:'acl',op:'eq',value:'deny'}], 'inspect 终端后逐个读三个安全参数，都是不合规值。','审计确认三项安全配置均未满足。',230),
 task('harden-device','补齐认证、加密与放行','依次配置三项安全参数，仿真验证平台开始接收数据。',['设备认证','传输加密','最小权限'],['audit-security'],[{source:'parameter',target:'meter',key:'authenticated',op:'eq',value:true},{source:'parameter',target:'meter',key:'encrypted',op:'eq',value:true},{source:'parameter',target:'meter',key:'acl',op:'eq',value:'allow'},{source:'ticks',op:'gte',value:1}], '三次 configure，分别把 authenticated、encrypted 置真、acl 置 allow，然后 simulate 1 秒。','认证、加密与访问控制全部就位，平台恢复接收。',450)],
 '设备接入平台前需要完成身份认证、链路加密与访问控制三项检查；任一不满足时平台拒收。本关用布尔参数表示三项状态，不模拟真实证书链、TLS 握手、令牌签发与 RBAC 策略引擎。',
 [{title:'NIST SP 800-207 零信任架构',url:'https://csrc.nist.gov/pubs/sp/800/207/final'}],
 [start,{type:'inspect',target:'meter',payload:{}},{type:'inspect',target:'cloud',payload:{}},{type:'configure',target:'meter',payload:{key:'authenticated',value:true}},{type:'configure',target:'meter',payload:{key:'encrypted',value:true}},{type:'configure',target:'meter',payload:{key:'acl',value:'allow'}},{type:'simulate',payload:{ticks:1}}],
 [start,{type:'inspect',target:'meter',payload:{}},{type:'configure',target:'meter',payload:{key:'authenticated',value:true}},{type:'simulate',payload:{ticks:1}}]);

const isolation=base(54,'安全隔离','隔离不是把开关拨到“关”，而是让对方从网络上真的够不到。','factory',4,
 '外包运维带来一台临时笔记本，需要接入访客网络，但绝不能触摸生产控制网。你要先确认它当前对生产云平台可达，然后把它的访问列表置为拒绝，仿真后通过可达性验证隔离生效。这一步的判据是可复现的路径检查，不是口头保证。',
 '访客终端与生产平台之间不再有可达路径，隔离生效。',['网络隔离','可达性验证','访问控制'],
 {name:'罗工',role:'工控安全负责人',lines:['先把“能不能到”测出来，再改配置。','改完要看 reachable 的结果，而不是看设备是不是显示绿色。']},
 [device('guest','terminal','外包访客终端',{zone:p('所属安全域','guest','text'),firewallEnabled:p('域间放行',true),routeToZone:p('允许访问域','prod','text'),acl:p('访问列表','allow','select',{options:['allow','deny']}),authenticated:p('已认证',true),encrypted:p('链路加密',true)},[0,0,0],{description:'临时接入的访客终端，目前被允许跨域访问生产网。'}),device('prod','cloud','生产控制云平台',{zone:p('所属安全域','prod','text'),online:p('在线',true),authenticated:p('平台认证',true)},[5,0,0])],
 [{from:'guest',to:'prod',kind:'network',quality:1}],{flow:0},[
 task('probe-path','先证明当前可达','检查访客终端与生产平台，确认域间放行规则此刻确实让路径可达。',['可达性','信任边界'],[],[{source:'inspected',target:'guest',op:'exists'},{source:'inspected',target:'prod',op:'exists'},{source:'reachable',target:'guest',key:'prod',op:'eq',value:true},{source:'parameter',target:'guest',key:'firewallEnabled',op:'eq',value:true}], '先 inspect，再用 reachable 确认访客终端到生产平台是通的。','当前访客终端确实能到达生产平台，存在风险。',240),
 task('enforce-isolation','阻断并复验隔离','关闭域间放行，仿真后确认可达性变为不可达。',['域间隔离','隔离复验'],['probe-path'],[{source:'parameter',target:'guest',key:'firewallEnabled',op:'eq',value:false},{source:'reachable',target:'guest',key:'prod',op:'eq',value:false},{source:'ticks',op:'gte',value:1}], 'configure guest.firewallEnabled=false，然后 simulate 1 秒；再用 reachable 断言为 false。','跨域路径已断开，访客终端无法再触达生产平台。',460)],
 '当链路两端声明了不同的安全域时，只有一端开启域间放行、且放行目标正是对端域、同时其访问列表不为 deny，链路才可用。关闭放行后路径消失、可达性为假。本关验证的是“隔离后路径确实不存在”，而非真实交换机的 VLAN、ACL 硬件下发与防火墙会话表。',
 [{title:'IEC 62443 工业网络安全',url:'https://www.iec.ch/blog/understanding-iec-62443'}],
 [start,{type:'inspect',target:'guest',payload:{}},{type:'inspect',target:'prod',payload:{}},{type:'configure',target:'guest',payload:{key:'firewallEnabled',value:false}},{type:'simulate',payload:{ticks:1}}],
 [start,{type:'inspect',target:'guest',payload:{}},{type:'simulate',payload:{ticks:1}}]);

export const chapter09: LevelDefinition[] = [industrialSignal,edgeBuffer,timeline,cloudEye,identityTrap,isolation];
