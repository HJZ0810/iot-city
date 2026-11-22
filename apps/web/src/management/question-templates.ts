import type { QuestionDefinition } from '../../../../packages/shared/src/index.ts';

type TemplateSeed = Omit<QuestionDefinition, 'id'>;
const single = (prompt: string, options: string[], answer: number, explanation: string, knowledge: string[], points = 5): TemplateSeed => ({
  kind: 'single', prompt, options: options.map((label, i) => ({ id: `o${i + 1}`, label })), answer: `o${answer + 1}`, explanation, knowledge, points,
});

export const questionTemplates: Array<{ title: string; definition: TemplateSeed }> = [
  { title: 'IPv4 子网掩码', definition: single('IPv4 地址 192.168.10.34/27 所属子网的网络地址是什么？', ['192.168.10.0', '192.168.10.32', '192.168.10.34', '192.168.10.64'], 1, '/27 的块大小为 32，34 落在 32–63 区间，因此网络地址是 192.168.10.32。', ['IPv4', '子网划分']) },
  { title: 'DHCP 地址租约', definition: single('终端取得 DHCP 租约后，续租通常首先向哪台服务器发送单播 DHCPREQUEST？', ['原租约服务器（T1 阶段）', '任意 DNS 服务器', '默认网关', '所有二层交换机'], 0, '标准租约 T1 到期后客户端向原 DHCP 服务器单播续租；若未成功，T2 阶段再广播重绑定。', ['DHCP', '地址管理']) },
  { title: 'DNS A 与 CNAME', definition: single('DNS 中，哪种记录把一个主机名指向 IPv4 地址？', ['A', 'AAAA', 'CNAME', 'MX'], 0, 'A 记录保存 IPv4 地址；AAAA 用于 IPv6，CNAME 是别名，MX 指定邮件交换服务器。', ['DNS', '名称解析']) },
  { title: 'MQTT QoS 1', definition: single('MQTT QoS 1 对消息交付提供什么保证？', ['至多一次，可能丢失', '至少一次，可能重复', '恰好一次且无协议开销', '只保证 TCP 连接'], 1, 'QoS 1 通过 PUBACK 提供至少一次交付，接收端可能看到重复消息，应使用消息 ID 或业务幂等处理。', ['MQTT', '消息可靠性']) },
  { title: 'MQTT 保留消息', definition: single('发布带 retain 标记的 MQTT 消息后，新订阅者通常会收到什么？', ['该主题最近一条保留消息', '该主题的全部历史消息', '发布者的所有在线状态', 'Broker 的全部主题列表'], 0, 'Broker 为主题保留最新一条 retain 消息，并在新订阅建立时发送；它不是历史消息队列。', ['MQTT', '保留消息']) },
  { title: 'MQTT 遗嘱消息', definition: single('MQTT 遗嘱消息（Will）通常在什么情况下由 Broker 发布？', ['客户端非正常断开且连接上配置了 Will', '客户端每次正常发送 PINGREQ', '订阅者取消订阅', 'Broker 收到任何 QoS 0 消息'], 0, '客户端连接时注册 Will；检测到非正常断开后，Broker 按配置发布。正常 DISCONNECT 通常不会触发。', ['MQTT', '在线状态']) },
  { title: 'TLS 主机名验证', definition: single('TLS 客户端验证服务端证书时，哪项检查可防止连到名称不匹配的服务器？', ['证书 SAN 与请求主机名匹配', '证书文件名与 URL 相同', 'TCP 端口为 443', '证书公钥长度大于 2048 位即可'], 0, '客户端应验证证书链、有效期及 SAN 中的主机名与目标名称匹配；端口或文件名不能替代身份验证。', ['TLS', '证书验证']) },
  { title: 'VLAN 广播域', definition: single('在未配置三层转发的情况下，两个不同 VLAN 的终端能否直接进行 IP 通信？', ['不能，需经过三层路由或受控网关', '可以，只要 IP 地址在同一网段', '可以，交换机会自动转发', '只能通过 DNS 通信'], 0, 'VLAN 将二层广播域隔离。跨 VLAN 通信需要三层设备执行路由，并配置相应策略。', ['以太网', 'VLAN']) },
  { title: 'PoE 供电协商', definition: single('标准 PoE 供电设备在向受电设备供电前，首先要完成什么？', ['检测受电设备特征并分类/协商功率', '向任意网线持续输出最高电压', '通过 DHCP 分配地址', '先建立 MQTT 连接'], 0, 'PSE 先检测 PD 的有效特征电阻，并按标准执行分类或协商，再进入供电阶段，避免对非 PoE 设备误供电。', ['PoE', '供电安全']) },
  { title: 'I²C 上拉电阻', definition: single('I²C SDA/SCL 线路常需上拉电阻，主要因为总线使用哪种电气结构？', ['开漏/开集电极输出', '推挽输出且总线空闲为高阻低电平', '差分电流环', '单端模拟电压输出'], 0, 'I²C 设备以开漏方式拉低总线，由上拉电阻恢复逻辑高电平；阻值需结合总线电容和速度选择。', ['I2C', '总线电气']) },
  { title: 'SPI 片选', definition: single('SPI 总线上多个从设备共享时钟和数据线时，主机通常如何选择目标从设备？', ['拉低该设备独立的片选 CS', '改变 I²C 地址', '发送 DNS 查询', '通过 PWM 占空比选择'], 0, '多数 SPI 设计用每个从设备独立的 CS/SS 线；被选设备在 CS 有效期间响应时钟和数据。', ['SPI', '片选']) },
  { title: '采样与奈奎斯特', definition: single('要避免带限信号发生理想采样混叠，采样频率至少应满足什么条件？', ['大于信号最高频率的两倍', '等于信号最高频率', '低于信号最高频率的一半', '与信号幅值成正比即可'], 0, '理想奈奎斯特条件要求采样频率严格高于最高信号频率的两倍；实际系统还需留出滤波器过渡带。', ['信号采样', '混叠']) },
  { title: '12 位 ADC 分辨率', definition: { kind: 'number', prompt: '理想 12 位 ADC 的输入满量程范围为 0–3.3 V，按 2^N 个量化等级估算，单个 LSB 电压约为多少伏？', options: [], answer: 3.3 / 4096, tolerance: 0.000001, explanation: '12 位共有 2^12 = 4096 个量化等级，3.3 / 4096 ≈ 0.0008057 V（约 0.806 mV）。实际 ADC 端点定义和误差会影响读数。', knowledge: ['ADC', '量化分辨率'], points: 8 } },
  { title: 'RS-485 终端匹配', definition: single('一条长距离、两端各有收发器的 RS-485 总线，终端电阻通常应如何布置？', ['仅在总线物理两端按线缆特性阻抗匹配', '每个节点都并联一个终端电阻', '只在电源端接地', '把 A、B 线短接'], 0, '终端匹配放在传输线物理两端，减少反射；短支线和偏置设计也需遵循收发器及布线规范。', ['RS-485', '信号完整性']) },
  { title: '4–20 mA 活零点', definition: single('工业 4–20 mA 变送器的 4 mA“活零点”有什么诊断价值？', ['可将零量程信号与断线等接近 0 mA 的故障区分', '表示传感器已达到满量程', '用于自动选择 Modbus 地址', '可省略电流测量电阻'], 0, '4 mA 表示有效量程下限，接近 0 mA 可提示回路断线或供电故障；故障阈值仍需按设备规格配置。', ['工业仪表', '故障诊断']) },
  { title: '控制回差', definition: single('恒温控制采用回差（例如低于 18°C 开启、高于 20°C 关闭）的主要目的是什么？', ['避免阈值附近频繁开关造成抖动', '提高传感器位数', '消除所有测量噪声', '自动校准温度传感器'], 0, '两个不同切换阈值形成滞回区，可减少噪声导致的快速反复切换；它不会消除测量误差。', ['控制系统', '滞回']) },
  { title: 'PWM 占空比', definition: single('频率固定的 PWM 信号占空比从 25% 提高到 75%，理想数字输出的平均电压通常怎样变化？', ['从约 25% 满量程上升到约 75% 满量程', '保持不变', '频率自动增加三倍', '输出变为负电压'], 0, '对 0 到 V 高电平且负载可平均的理想 PWM，平均值约为占空比乘以高电平电压；负载动态和滤波会影响实际结果。', ['PWM', '执行器控制']) },
  { title: '看门狗定时器', definition: single('嵌入式设备启用看门狗后，主程序通常需要定期执行什么操作？', ['在规定时间内喂狗/刷新计时器', '持续保持复位引脚有效', '关闭所有中断', '每次都重新烧录固件'], 0, '程序应在健康运行时按设计刷新看门狗；若卡死或超时未刷新，硬件触发复位。刷新点应避免掩盖局部故障。', ['嵌入式可靠性', '看门狗']) },
  { title: 'Modbus RTU 帧间隔', definition: single('Modbus RTU 通过什么方式在串行线路上识别帧边界？', ['帧间静默时间间隔', '每帧都必须以 HTTP 头结束', 'TLS 证书分隔符', '固定的以太网 MAC 地址'], 0, 'RTU 使用字符时间间隔区分帧，常见规范以至少 3.5 个字符时间作为帧间隔；具体时序依波特率和规范版本。', ['Modbus RTU', '串行协议']) },
  { title: '遥测数据最小化', definition: single('环境监测平台只需计算楼层平均温度时，哪种数据处理更符合最小化原则？', ['按楼层聚合必要读数，并限制原始数据留存范围', '永久公开每个传感器的精确位置和原始记录', '将测量数据与账号密码合并存储', '默认收集与分析无关的个人信息'], 0, '只收集和保留实现用途所需的数据，并限制访问和留存期限，可降低不必要的隐私暴露。', ['数据治理', '隐私保护']) },
];

export function instantiateQuestion(template: TemplateSeed, id: string): QuestionDefinition {
  return structuredClone({ ...template, id });
}
