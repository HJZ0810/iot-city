import type { ChapterView } from '../../shared/src/index.ts';
import { type BoardLevel, boardLevelSchema } from '../../shared/src/board.ts';

/**
 * 板端轨道（B 轨）内容：学生在自己的 ESP32-S3 开发板上写程序，
 * 通过 HCP 接入云端，服务器用探针采集真实硬件证据来判定功能是否实现。
 *
 * 每个 firmware 关卡的探针只能判定“稳定工作点”，不判定波形全程；
 * 需要过程性判定的题目请用 report 让学生的代码主动上报序列。
 */

const starter = (setupBody: string, loopBody: string) => `#include <Arduino.h>
#include "hcp_sdk.h"

void setup() {
  HCP.begin();   // 联网 + 上屏，屏幕顶部会显示本题与当前考察项
${setupBody}}

void loop() {
  HCP.loop();    // 必须每轮调用，SDK 靠它收发证据与刷新屏幕
${loopBody}}
`;

const base = {
  track: 'board' as const,
  board: 'jlc-esp32s3-tft' as const,
  version: 2,
};

const raw: BoardLevel[] = [
  /* ================= 第一章 灯火初明：基础输入输出 ================= */
  {
    ...base,
    id: 'board-b1-01',
    kind: 'firmware',
    number: 1,
    chapter: 1,
    title: '三灯点名',
    subtitle: '用 digitalWrite 按顺序点亮指定 LED',
    difficulty: 1,
    estimatedMinutes: 10,
    brief: '巡检队的指示灯牌坏了：编号 1、2、3 的灯必须常亮，编号 4 的灯保持熄灭。先让 1 号灯闪三下自检，再全部点亮。',
    objective: ['把 GPIO4、GPIO5、GPIO6 置为高电平并保持', '让 GPIO4 至少闪烁三次后再常亮', 'GPIO7 全程保持低电平（这一路灯不在本次任务内）'],
    knowledge: ['GPIO 输出', 'digitalWrite', '引脚编号与丝印对应'],
    pins: [
      { label: 'LED1', gpio: 4, note: '高电平点亮' },
      { label: 'LED2', gpio: 5 },
      { label: 'LED3', gpio: 6 },
      { label: 'LED4', gpio: 7, note: '本题必须熄灭' },
    ],
    starterCode: starter(
      `  pinMode(4, OUTPUT);
  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(7, OUTPUT);
  // TODO: 让 LED1 闪三下自检，然后点亮 LED1~LED3`,
      '',
    ),
    probes: [
      {
        id: 'p-steady',
        title: '三灯常亮、四号熄灭',
        description: '服务器读取四个引脚的电平，检查 1/2/3 号灯亮、4 号灯灭。',
        windowMs: 4000,
        expect: [
          { type: 'pin-level', pin: 4, value: 1, note: 'LED1 应常亮' },
          { type: 'pin-level', pin: 5, value: 1, note: 'LED2 应常亮' },
          { type: 'pin-level', pin: 6, value: 1, note: 'LED3 应常亮' },
          { type: 'pin-level', pin: 7, value: 0, note: 'LED4 不在任务内，必须熄灭' },
        ],
        hint: '确认 pinMode 设为 OUTPUT，并对 4/5/6 号引脚都调用了 digitalWrite(HIGH)。',
        weight: 2,
      },
      {
        id: 'p-blink',
        title: '自检闪烁',
        description: '统计 GPIO4 的电平翻转次数，证明学生代码真的执行过闪烁。',
        windowMs: 4000,
        expect: [{ type: 'pin-edges', pin: 4, min: 4, note: '闪三下会产生至少 6 次电平翻转' }],
        hint: '三次“亮-灭”循环即产生 6 次翻转；每次翻转之间要留出延时，太快会被判为抖动。',
        weight: 1,
      },
    ],
    hints: ['先写 pinMode，再写 digitalWrite；顺序反了灯不会亮。', '闪烁用 for 循环加 delay，不要在 loop 里无限闪——任务结束后要停在常亮状态。'],
    solution: starter(
      `  pinMode(4, OUTPUT);
  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(7, OUTPUT);
  for (int i = 0; i < 3; i++) {
    digitalWrite(4, HIGH); delay(200);
    digitalWrite(4, LOW);  delay(200);
  }
  digitalWrite(4, HIGH);
  digitalWrite(5, HIGH);
  digitalWrite(6, HIGH);
  digitalWrite(7, LOW);`,
      '',
    ),
    failureModes: [
      { symptom: '四灯全亮', cause: '把 GPIO7 也写成了 HIGH；题目只要 1~3 号灯。' },
      { symptom: '灯不亮但代码没错', cause: '引脚号与丝印不一致：本板 LED1~4 对应 GPIO4~7。' },
    ],
  },
  {
    ...base,
    id: 'board-b1-02',
    kind: 'firmware',
    number: 2,
    chapter: 1,
    title: '呼吸的亮度',
    subtitle: '用 LEDC(PWM) 把灯稳定在 1kHz / 60%',
    difficulty: 2,
    estimatedMinutes: 15,
    brief: '2 号灯要做舱内氛围灯：频率 1000Hz、亮度 60%，并且要稳定保持，不能靠 delay 抖动去“骗”亮度。',
    objective: ['使用 LEDC(PWM) 驱动 GPIO5，而不是 digitalWrite', '频率稳定在 1000Hz（±15%）', '占空比稳定在 60%（±10%）', '程序连续运行 2 秒以上不复位'],
    knowledge: ['LEDC', 'PWM 频率', '占空比', 'Arduino-ESP32 2.x/3.x API 差异'],
    pins: [{ label: 'LED2', gpio: 5, note: 'LEDC 通道 1' }],
    starterCode: starter(
      `  pinMode(5, OUTPUT);
  // TODO: 用 LEDC 把 GPIO5 设为 1000Hz、占空比 60%
  // 提示：SDK 提供了跨核心版本兼容的 HCP.ledc(pin, hz, dutyPct)`,
      '',
    ),
    probes: [
      {
        id: 'p-pwm',
        title: '频率与占空比',
        description: '读取 LEDC 实际配置，核对频率与占空比。',
        windowMs: 4000,
        expect: [
          { type: 'pwm', pin: 5, hz: 1000, hzTolerancePct: 15, duty: 60, dutyTolerancePct: 10 },
          { type: 'uptime', minMs: 2000, note: '要稳定保持在 60%，不是闪一下就复位' },
        ],
        hint: '占空比是 0~100 的百分比还是 0~255 的原始值？不同 API 不一样，先确认单位再传参。',
        weight: 3,
      },
    ],
    hints: ['3.x 核心用 ledcAttach(pin, hz, resolution)，2.x 用 ledcSetup + ledcAttachPin；SDK 的 HCP.ledc 已封装两种。', '如果亮度忽明忽暗，检查是不是在 loop 里不停重设占空比。'],
    solution: starter(
      `  HCP.ledc(5, 1000, 60);   // GPIO5, 1kHz, 60%`,
      '',
    ),
    failureModes: [
      { symptom: '灯亮但探针报“没有 PWM 采样”', cause: '仍在用 digitalWrite；LEDC 未启用。' },
      { symptom: '频率对但亮度不对', cause: '把 60 当成 0~255 的原始值传了进去，实际只到 23%。' },
    ],
  },
  {
    ...base,
    id: 'board-b1-03',
    kind: 'firmware',
    number: 3,
    chapter: 1,
    title: '按下的次数',
    subtitle: '读 A 键并把自己的计数上报云端',
    difficulty: 2,
    estimatedMinutes: 15,
    brief: '测试台要统计操作员按下 A 键的次数。连按两次 A 键，然后把计数上报上来——注意，云端会同时用按键扫描结果核对，报错了会被发现。',
    objective: ['启用内部上拉，能区分按下与松开', '按下 A 键至少两次', '把累计次数用 HCP.report("a.count", 次数) 上报'],
    knowledge: ['GPIO 输入', '内部上拉', '按键消抖', '上报与交叉校验'],
    pins: [{ label: 'SW5(A)', gpio: 13, note: '按下为低电平' }],
    starterCode: starter(
      `  // SDK 已经帮你扫描 6 个按键并消抖
  Serial.begin(115200);`,
      `  // TODO: 每 500ms 把 A 键累计次数上报一次
  static uint32_t last = 0;
  if (millis() - last > 500) {
    last = millis();
    // HCP.report("a.count", HCP.keyPresses(KEY_A));
  }`,
    ),
    probes: [
      {
        id: 'p-press',
        title: 'A 键确实被按了',
        description: '读取按键扫描器的边沿计数。',
        windowMs: 8000,
        expect: [{ type: 'key', key: 'a', presses: 2, note: '请在 8 秒内至少按两次 A 键' }],
        hint: '如果按了没反应，检查按键是否被 SDK 接管（不要自己再 pinMode 覆盖）。',
        weight: 2,
      },
      {
        id: 'p-report',
        title: '上报值与硬件一致',
        description: '比对上报的计数与 SDK 扫描到的次数。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'a.count', min: 2, max: 200, cross: { source: 'keys.a', tolerance: 0 }, note: '上报值必须等于真实按键次数' }],
        hint: '上报的是“累计次数”；如果你在 loop 里每轮清零，云端收到的永远是 1。',
        weight: 2,
      },
    ],
    hints: ['HCP.keyPresses(KEY_A) 返回开机以来的累计次数，不需要自己写中断。', '上报要放在有时间间隔的分支里，否则一帧上报几十次会触发限流。'],
    solution: starter(
      `  Serial.begin(115200);`,
      `  static uint32_t last = 0;
  if (millis() - last > 500) {
    last = millis();
    HCP.report("a.count", HCP.keyPresses(KEY_A));
  }`,
    ),
    failureModes: [
      { symptom: '按了键但 presses 为 0', cause: '学生代码把 GPIO13 重新 pinMode(OUTPUT)，把 SDK 的输入配置覆盖了。' },
      { symptom: '上报值每次都是 1', cause: '计数变量定义在 loop 里，每轮被重置。' },
    ],
  },
  {
    ...base,
    id: 'board-b1-04',
    kind: 'quiz',
    number: 4,
    chapter: 1,
    title: '高电平之谜',
    subtitle: '屏上答题：上拉输入的电平判读',
    difficulty: 1,
    estimatedMinutes: 5,
    brief: '屏幕会显示一段按键电路。看清接法，用方向键选择答案，按 A 提交。',
    objective: ['判断 INPUT_PULLUP 下按键未按下时的电平', '理解“按下接地”的电路含义'],
    knowledge: ['内部上拉', '低电平有效', '按键电路'],
    starterCode: `// 本题为上机前的电路判读，无需修改代码。
pinMode(13, INPUT_PULLUP);
bool pressed = (digitalRead(13) == LOW);`,
    probes: [],
    screenQuiz: {
      prompt: '按键一端接 GPIO13，另一端接 GND，引脚配置为 INPUT_PULLUP。此时 digitalRead(13) 读到 HIGH，说明：',
      animation: 'blink',
      options: [
        { id: 'A', label: '按键正被按下' },
        { id: 'B', label: '按键没有被按下' },
        { id: 'C', label: '引脚已经烧坏' },
        { id: 'D', label: '必须外接电源才能读' },
      ],
      answer: 'B',
      explanation: '内部上拉把引脚拉到高电平；按键按下时引脚被短接到 GND，才会读到 LOW。所以 HIGH 表示未按下。',
    },
    hints: ['想想“上拉”把引脚默认拉到了哪一边。'],
  },

  /* ================= 第二章 感知有度：模拟量与传感器 ================= */
  {
    ...base,
    id: 'board-b2-05',
    kind: 'firmware',
    number: 5,
    chapter: 2,
    title: '光的读数',
    subtitle: '读光敏电阻的 ADC 值并如实上报',
    difficulty: 2,
    estimatedMinutes: 15,
    brief: '温室需要知道当前照度。光敏电阻接在 GPIO1（ADC1_CH0），光越强读数越小。读到毫伏值后上报，云端会用同一引脚的实测值核对。',
    objective: ['用 analogReadMilliVolts 读取 GPIO1', '至少每 500ms 上报一次 HCP.report("light", 毫伏值)', '上报值与硬件实测相差不超过 300mV'],
    knowledge: ['ADC', '模拟量转毫伏', '分压电路', '上报交叉校验'],
    pins: [{ label: '光敏', gpio: 1, note: 'ADC1_CH0，光强↑读数↓' }],
    starterCode: starter(
      `  Serial.begin(115200);
  analogReadResolution(12);`,
      `  static uint32_t last = 0;
  if (millis() - last > 500) {
    last = millis();
    // TODO: 读 GPIO1 的毫伏值并上报为 "light"
  }`,
    ),
    probes: [
      {
        id: 'p-adc',
        title: '传感器在工作',
        description: '检查该引脚是否有合理的模拟读数（不是 0 也不是满量程）。',
        windowMs: 4000,
        expect: [{ type: 'adc', pin: 1, min: 20, max: 4900, note: '读数贴边通常意味着分压电阻或接线有问题' }],
        hint: '确认用的是 ADC1 通道（GPIO1），且没有把这个引脚配成 OUTPUT。',
        weight: 1,
      },
      {
        id: 'p-report',
        title: '上报值与实测一致',
        description: '比对上报的毫伏值与 SDK 同期采样值。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'light', min: 0, max: 5000, cross: { source: 'adc.mv', tolerance: 300 } }],
        hint: '如果你上报的是 0~4095 的原始码值而不是毫伏值，就会和实测对不上。',
        weight: 2,
      },
    ],
    hints: ['analogReadMilliVolts(1) 直接给出毫伏值，省去自己换算。', '上报前可以取几次平均，但不要改变量纲。'],
    solution: starter(
      `  Serial.begin(115200);
  analogReadResolution(12);`,
      `  static uint32_t last = 0;
  if (millis() - last > 500) {
    last = millis();
    HCP.report("light", analogReadMilliVolts(1));
  }`,
    ),
    failureModes: [{ symptom: '上报值与实测差很多', cause: '上报了原始码值（0~4095）而不是毫伏值（0~3300）。' }],
  },
  {
    ...base,
    id: 'board-b2-06',
    kind: 'firmware',
    number: 6,
    chapter: 2,
    title: '按下即通电',
    subtitle: 'B 键触发继电器吸合',
    difficulty: 2,
    estimatedMinutes: 15,
    brief: '实验台的抽风机由继电器控制。要求：按一次 B 键后，继电器保持吸合（GPIO2 高电平）。云端会同时检查按键事件与继电器引脚。',
    objective: ['读取 B 键并按一次', '把 GPIO2 置为高电平并保持吸合', '不要在 loop 里反复通断'],
    knowledge: ['继电器驱动', '状态保持', '按键触发'],
    pins: [
      { label: '继电器 K1', gpio: 2, note: '高电平吸合' },
      { label: 'SW6(B)', gpio: 14 },
    ],
    starterCode: starter(
      `  pinMode(2, OUTPUT);
  digitalWrite(2, LOW);
  bool engaged = false;`,
      `  // TODO: 检测到 B 键按下后把 engaged 置 true 并吸合继电器
  static uint32_t seen = 0;
  if (HCP.keyPresses(KEY_B) > seen) {
    seen = HCP.keyPresses(KEY_B);
    // 在这里吸合继电器
  }`,
    ),
    probes: [
      {
        id: 'p-key',
        title: 'B 键被触发',
        description: '检查 B 键的有效按下次数。',
        windowMs: 8000,
        expect: [{ type: 'key', key: 'b', presses: 1 }],
        hint: '按一次 B 键即可；如果扫不到，检查是否覆盖了 SDK 的输入配置。',
        weight: 1,
      },
      {
        id: 'p-relay',
        title: '继电器保持吸合',
        description: '读取 GPIO2 的最终电平。',
        windowMs: 4000,
        expect: [{ type: 'pin-level', pin: 2, value: 1, note: '吸合后应一直保持' }],
        hint: '如果读完立刻 digitalWrite(LOW)，云端采样时继电器又断开了。',
        weight: 3,
      },
    ],
    hints: ['用一个 bool 记住状态，只在按键那一刻改它。', '继电器线圈有反向电动势，实际接线务必按原理图加续流二极管——本题只验证逻辑电平。'],
    solution: starter(
      `  pinMode(2, OUTPUT);
  digitalWrite(2, LOW);
  bool engaged = false;`,
      `  static uint32_t seen = 0;
  if (HCP.keyPresses(KEY_B) > seen) {
    seen = HCP.keyPresses(KEY_B);
    engaged = true;
    digitalWrite(2, engaged ? HIGH : LOW);
  }`,
    ),
  },
  {
    ...base,
    id: 'board-b2-07',
    kind: 'firmware',
    number: 7,
    chapter: 2,
    title: '单总线上的温湿度',
    subtitle: '读 DHT11 并上报温度',
    difficulty: 3,
    estimatedMinutes: 20,
    brief: '仓库要记录温湿度。DHT11 数据线接 GPIO8，要求读到合法温湿度并上报温度。注意 DHT11 两次采样至少间隔 1 秒，读太快会返回 NaN。',
    objective: ['周期读取 DHT11（间隔 ≥1s）', '上报 HCP.report("temp", 温度)', '上报值与 SDK 解析的总线数据相差不超过 1.5℃'],
    knowledge: ['DHT11 单总线时序', '传感器采样周期', '数据合法性判断'],
    pins: [{ label: 'DHT11', gpio: 8, note: '需 4.7k 上拉（板上已焊）' }],
    starterCode: starter(
      `  Serial.begin(115200);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    // TODO: 读取 DHT11，成功则上报温度
    // 若使用 Adafruit 库：dht.readTemperature()
  }`,
    ),
    probes: [
      {
        id: 'p-dht',
        title: '总线上有合法数据',
        description: 'SDK 监听数据线解码，检查温湿度是否在合理区间。',
        windowMs: 8000,
        expect: [
          { type: 'dht', field: 'temperature', min: 5, max: 45 },
          { type: 'dht', field: 'humidity', min: 20, max: 95 },
        ],
        hint: '没有合法响应通常是时序或上拉问题；也可能是采样太快，DHT11 还没准备好。',
        weight: 2,
      },
      {
        id: 'p-report',
        title: '上报温度与总线一致',
        description: '比对上报值与解码值；若上报 NaN 或凭空填数会被判负。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'temp', min: -10, max: 60, cross: { source: 'dht.temperature', tolerance: 1.5 } }],
        hint: 'readTemperature() 返回浮点，直接上报即可；不要用 int 强转后四舍五入到个位以外的错误值。',
        weight: 2,
      },
    ],
    hints: ['DHT11 精度是 1℃，上报值和实测差 1℃ 以内属正常，容差已留到 1.5。', '如果一直 NaN，先确认数据线接在 GPIO8，且采样间隔大于 1 秒。'],
    solution: starter(
      `  Serial.begin(115200);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    auto r = HCP.readDht();          // SDK 封装：{ok, temperature, humidity}
    if (r.ok) HCP.report("temp", r.temperature);
  }`,
    ),
    failureModes: [
      { symptom: 'dht.ok 一直为 false', cause: '采样过于频繁（<1s）或数据线接触不良。' },
      { symptom: '温度对但湿度离谱', cause: '把湿度字节和温度字节读反了。' },
    ],
  },
  {
    ...base,
    id: 'board-b2-08',
    kind: 'quiz',
    number: 8,
    chapter: 2,
    title: '选对传感器',
    subtitle: '屏上答题：为场景选择正确的传感器',
    difficulty: 1,
    estimatedMinutes: 5,
    brief: '屏幕会给出三个场景，用上下键查看，方向键选择，A 键提交。',
    objective: ['根据被测物理量选择传感器类型', '理解模拟量与数字量的取舍'],
    knowledge: ['传感器选型', '模拟量与数字量'],
    starterCode: `// 本题为选型判读。
// 提示：电容式土壤湿度传感器输出模拟量，需接 ADC 引脚。`,
    probes: [],
    screenQuiz: {
      prompt: '要监测花盆土壤的含水率，最合适的是：',
      animation: 'wave',
      options: [
        { id: 'A', label: 'DHT11 温湿度模块' },
        { id: 'B', label: '电容式土壤湿度传感器' },
        { id: 'C', label: '光敏电阻' },
        { id: 'D', label: '无源蜂鸣器' },
      ],
      answer: 'B',
      explanation: 'DHT11 测的是空气温湿度，光敏电阻测光照，蜂鸣器是执行器。测土壤含水率要用插入式土壤湿度传感器，电容式比电阻式更耐腐蚀。',
    },
    hints: ['先问自己：题目要测的物理量是什么？'],
  },

  /* ================= 第三章 光影成章：灯效与显示 ================= */
  {
    ...base,
    id: 'board-b3-09',
    kind: 'firmware',
    number: 9,
    chapter: 3,
    title: '第一颗灯珠',
    subtitle: '驱动 16 颗 WS2812，让首像素变红',
    difficulty: 3,
    estimatedMinutes: 20,
    brief: '4×4 灯阵共 16 颗 WS2812，接 GPIO48。要求整条灯带按 16 颗初始化，首像素设为纯红，并真正发送出去。',
    objective: ['按 16 颗像素初始化灯带', '首像素设为 rgb(255,0,0)', '调用刷新让数据真正发到灯珠'],
    knowledge: ['WS2812 时序', 'RMT 驱动', '像素与颜色顺序'],
    pins: [{ label: 'WS2812', gpio: 48, note: '16 颗串联，GRB 顺序' }],
    starterCode: starter(
      `  HCP.stripBegin(16);   // SDK 初始化 16 颗灯珠`,
      `  static bool done = false;
  if (!done) {
    done = true;
    // TODO: 把第 0 颗设为红色并刷新
    // HCP.setStripPixel(0, 255, 0, 0);
    // HCP.showStrip();
  }`,
    ),
    probes: [
      {
        id: 'p-strip',
        title: '首像素为纯红',
        description: '检查发送缓冲的像素数量与首像素颜色。',
        windowMs: 4000,
        expect: [{ type: 'strip', count: 16, first: { r: 255, g: 0, b: 0 }, tolerance: 28 }],
        hint: '灯珠是 GRB 顺序：如果你把 RGB 直接塞进去，红色会显示成绿色。SDK 已按 GRB 处理，直接传 RGB 即可。',
        weight: 3,
      },
    ],
    hints: ['初始化数量必须与物理灯珠数一致，少了后面的灯不亮，多了会花屏。', '改完颜色一定要 showStrip()，缓冲不会自动发送。'],
    solution: starter(
      `  HCP.stripBegin(16);`,
      `  static bool done = false;
  if (!done) {
    done = true;
    HCP.setStripPixel(0, 255, 0, 0);
    HCP.showStrip();
  }`,
    ),
    failureModes: [
      { symptom: '灯珠显示绿色而不是红色', cause: 'RGB 与 GRB 顺序搞混。' },
      { symptom: '一颗都不亮', cause: '初始化数量为 0，或没有调用 showStrip。' },
    ],
  },
  {
    ...base,
    id: 'board-b3-10',
    kind: 'quiz',
    number: 10,
    chapter: 3,
    title: '雨滴怎么流',
    subtitle: '屏上答题：4×4 灯阵动画的实现思路',
    difficulty: 2,
    estimatedMinutes: 6,
    brief: '屏幕会播放一次“自上而下流动”的动画，看完后选择正确的实现思路。',
    objective: ['理解逐行刷新与整帧刷新的区别', '能根据视觉效果反推循环结构'],
    knowledge: ['WS2812 寻址', '逐行动画', '帧刷新'],
    starterCode: `// 4x4 灯阵按行优先编号：index = row * 4 + col
// 显示一行：for (int c = 0; c < 4; c++) setStripPixel(row * 4 + c, ...);`,
    probes: [],
    screenQuiz: {
      prompt: '要让 4×4 灯阵出现“自上而下流动的雨滴”，正确做法是：',
      animation: 'pulse',
      options: [
        { id: 'A', label: '16 颗灯同时点亮并保持常亮' },
        { id: 'B', label: '每次只点亮当前行，延时后熄灭换下一行' },
        { id: 'C', label: '只点亮第 0 颗灯' },
        { id: 'D', label: '把所有灯设为随机颜色' },
      ],
      answer: 'B',
      explanation: '“流动”来自时间上的状态转移：同一时刻只显示一行，然后按行推进。只亮一颗是“点”，不是“行”；全亮则没有流动。',
    },
    hints: ['动画的本质是“每一帧画面不同”，而不是“一次性全画完”。'],
  },
  {
    ...base,
    id: 'board-b3-11',
    kind: 'firmware',
    number: 11,
    chapter: 3,
    title: '两千米赫的鸣叫',
    subtitle: '用无源蜂鸣器输出 2kHz 方波',
    difficulty: 2,
    estimatedMinutes: 12,
    brief: '报警器要求 2000Hz、50% 占空比的方波。无源蜂鸣器不会自己发声，必须给它方波。',
    objective: ['对 GPIO47 输出 PWM', '频率 2000Hz（±12%）', '占空比 50%（±20%）'],
    knowledge: ['无源与有源蜂鸣器', 'PWM 频率与音调', '占空比与响度'],
    pins: [{ label: 'BUZZER1', gpio: 47, note: '无源，需外部方波' }],
    starterCode: starter(
      `  // TODO: 输出 2000Hz / 50% 方波
  // HCP.tone(2000, 50);`,
      '',
    ),
    probes: [
      {
        id: 'p-tone',
        title: '音调与占空比',
        description: '读取 GPIO47 的 LEDC 参数。',
        windowMs: 4000,
        expect: [{ type: 'pwm', pin: 47, hz: 2000, hzTolerancePct: 12, duty: 50, dutyTolerancePct: 20 }],
        hint: '无源蜂鸣器不响，最常见的原因是只给了高电平而没有给方波。',
        weight: 2,
      },
    ],
    hints: ['有源蜂鸣器给高电平就响，无源必须给频率——本板是无源的。', '频率决定音调，占空比影响响度与音色，50% 是最响的方波。'],
    solution: starter(`  HCP.tone(2000, 50);`, ''),
  },

  /* ================= 第四章 一线通云：联网 ================= */
  {
    ...base,
    id: 'board-b4-12',
    kind: 'firmware',
    number: 12,
    chapter: 4,
    title: '连上路由器',
    subtitle: 'STA 模式联网并上报信号强度',
    difficulty: 3,
    estimatedMinutes: 20,
    brief: '终端要接入教室路由器。连接成功后上报 RSSI，云端会与设备侧 Wi-Fi 状态核对——报了不存在的数会被发现。',
    objective: ['以 STA 模式连接指定的 Wi-Fi', '连接成功（RSSI 优于 -85dBm）', '上报 HCP.report("rssi", WiFi.RSSI())'],
    knowledge: ['STA 模式', 'RSSI', '连接状态机', '断线重连'],
    pins: [],
    starterCode: starter(
      `  Serial.begin(115200);
  // TODO: WiFi.mode(WIFI_STA); WiFi.begin(ssid, pass);
  // 注意：SDK 已为协议连接建立过 STA，这里不要再切模式`,
      `  static uint32_t last = 0;
  if (millis() - last > 1000) {
    last = millis();
    // TODO: 联网成功后上报 RSSI
  }`,
    ),
    probes: [
      {
        id: 'p-link',
        title: 'STA 已联网',
        description: '读取 Wi-Fi 模式与信号强度。',
        windowMs: 6000,
        expect: [{ type: 'wifi', mode: 'sta', rssiMin: -85 }],
        hint: '连不上先看串口：是密码错、还是 5GHz 热点（ESP32 只支持 2.4GHz）。',
        weight: 2,
      },
      {
        id: 'p-report',
        title: '上报 RSSI',
        description: '比对上报值与设备 Wi-Fi 实测值。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'rssi', min: -120, max: 0, cross: { source: 'wifi.rssi', tolerance: 5 } }],
        hint: 'WiFi.RSSI() 返回负数，接近 0 才表示信号强；不要取绝对值上报。',
        weight: 2,
      },
    ],
    hints: ['等待连接时一定要加 delay，否则看门狗会复位。', 'RSSI 每秒都在变，容差留了 5dBm。'],
    solution: starter(
      `  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin("Campus-IoT", "12345678");
  while (WiFi.status() != WL_CONNECTED) { delay(300); }`,
      `  static uint32_t last = 0;
  if (millis() - last > 1000) {
    last = millis();
    HCP.report("rssi", WiFi.RSSI());
  }`,
    ),
  },
  {
    ...base,
    id: 'board-b4-13',
    kind: 'quiz',
    number: 13,
    chapter: 4,
    title: '负数的含义',
    subtitle: '屏上答题：RSSI 判读',
    difficulty: 1,
    estimatedMinutes: 5,
    brief: '屏幕显示一段信号强度读数，判断当前链路质量。',
    objective: ['理解 RSSI 是负值且越接近 0 越好'],
    knowledge: ['RSSI', '无线链路质量'],
    starterCode: `// 串口输出示例：RSSI: -78 dBm
// 记住：越接近 0 越强，-90 以下基本不可用。`,
    probes: [],
    screenQuiz: {
      prompt: '设备上报 RSSI = -78 dBm，最合理的判断是：',
      animation: 'none',
      options: [
        { id: 'A', label: '信号极佳，可以跑高清视频' },
        { id: 'B', label: '信号一般，可能出现丢包与延迟' },
        { id: 'C', label: '完全没有信号' },
        { id: 'D', label: '读数无效，RSSI 不能为负' },
      ],
      answer: 'B',
      explanation: '-50 以上是满格，-60 良好，-70 一般，-80 弱且频繁丢包，-90 以下濒临断连。RSSI 本来就是负值。',
    },
    hints: ['把常见区间记成一张表：-50 / -60 / -70 / -80 / -90。'],
  },

  /* ================= 第五章 万无一失：综合排障 ================= */
  {
    ...base,
    id: 'board-b5-14',
    kind: 'debug',
    number: 14,
    chapter: 5,
    title: '四处故障',
    subtitle: '一份被改坏的巡检程序，需要全部修好',
    difficulty: 5,
    estimatedMinutes: 40,
    brief: '学长的巡检程序有四处错误：灯接错引脚、按键没上拉、DHT 读太快、上报时整数除法把温度抹平了。修好它们，让四项验收全部通过。',
    objective: [
      '修复 LED 引脚，让 GPIO4 常亮',
      '修复按键配置，使 A 键可被扫描到',
      '修复 DHT 采样间隔，让总线返回合法数据',
      '修复上报精度，让上报温度与实测一致',
    ],
    knowledge: ['GPIO 输出', '上拉输入', '传感器时序', '整数除法陷阱', '系统化排障'],
    pins: [
      { label: 'LED1', gpio: 4 },
      { label: 'SW5(A)', gpio: 13 },
      { label: 'DHT11', gpio: 8 },
    ],
    starterCode: `#include <Arduino.h>
#include "hcp_sdk.h"

// 这段代码有 4 个 bug，逐个找出来。
void setup() {
  HCP.begin();
  pinMode(5, OUTPUT);            // bug 1：题目要求点亮的是 GPIO4
  digitalWrite(5, HIGH);
  pinMode(13, INPUT);            // bug 2：没有上拉，按键永远读到悬空电平
}

void loop() {
  HCP.loop();
  static uint32_t last = 0;
  if (millis() - last > 50) {    // bug 3：DHT11 至少间隔 1s
    last = millis();
    auto r = HCP.readDht();
    int t = r.temperature;       // bug 4：转 int 后精度丢失，且 r.ok 未判
    HCP.report("temp", t / 2);   // 整数除法把温度又砍了一半
  }
}
`,
    probes: [
      {
        id: 'p-led',
        title: 'LED 引脚正确',
        description: '检查 GPIO4 电平。',
        windowMs: 4000,
        expect: [{ type: 'pin-level', pin: 4, value: 1 }],
        hint: '看题目要求的是哪一路灯，再核对引脚号。',
        weight: 2,
      },
      {
        id: 'p-key',
        title: '按键可被扫描',
        description: '检查 A 键有效按下次数。',
        windowMs: 8000,
        expect: [{ type: 'key', key: 'a', presses: 1 }],
        hint: 'INPUT 与 INPUT_PULLUP 的区别，决定了按键松开时引脚是悬空还是高电平。',
        weight: 2,
      },
      {
        id: 'p-dht',
        title: 'DHT 数据合法',
        description: '检查总线解码结果。',
        windowMs: 8000,
        expect: [{ type: 'dht', field: 'temperature', min: 5, max: 45 }],
        hint: '采样太频繁时 DHT11 根本来不及响应，r.ok 会一直是 false。',
        weight: 3,
      },
      {
        id: 'p-report',
        title: '上报精度正确',
        description: '比对上报值与实测温度。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'temp', min: -10, max: 60, cross: { source: 'dht.temperature', tolerance: 1.5 } }],
        hint: '把温度存进 int 再除以 2，等于把 24.5℃ 变成 12℃。',
        weight: 3,
      },
    ],
    hints: [
      '四个 bug 分别落在：引脚号、输入模式、采样周期、数据类型。',
      '排障顺序建议：先让灯亮、再让键可读、再看传感器、最后看上报值。',
    ],
    solution: `#include <Arduino.h>
#include "hcp_sdk.h"

void setup() {
  HCP.begin();
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);
  pinMode(13, INPUT_PULLUP);
}

void loop() {
  HCP.loop();
  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    auto r = HCP.readDht();
    if (r.ok) HCP.report("temp", r.temperature);
  }
}
`,
    failureModes: [
      { symptom: '灯一直不亮', cause: '引脚号写错（GPIO5 vs GPIO4）。' },
      { symptom: '按键计数为 0', cause: '用了 INPUT 而不是 INPUT_PULLUP，引脚悬空。' },
      { symptom: 'DHT 一直读不到', cause: '采样间隔 50ms，远小于 DHT11 的 1s 要求。' },
      { symptom: '上报温度只有实际的一半', cause: 'int 强转 + 除以 2 的整数除法。' },
    ],
  },
  {
    ...base,
    id: 'board-b3-12',
    kind: 'firmware',
    number: 15,
    chapter: 3,
    title: '灯阵雨滴',
    subtitle: '让 4×4 灯阵逐行流动，并把帧数上报',
    difficulty: 3,
    estimatedMinutes: 25,
    brief: '灯阵要做“雨滴自上而下流动”：同一时刻只亮一行，按行推进，循环播放。服务器判断的是“动画确实在跑”，所以每刷新一帧就把累计帧数上报一次。',
    objective: ['按 16 颗灯珠初始化灯带', '每次只点亮当前行（4 颗），延时后切到下一行', '每帧调用 HCP.report("frames", 累计帧数)', '连续运行 3 秒以上'],
    knowledge: ['WS2812 寻址', '逐行动画', '帧计数器'],
    pins: [{ label: 'WS2812', gpio: 48, note: '4×4，行优先编号 row*4+col' }],
    starterCode: starter(
      `  HCP.stripBegin(16);
  uint32_t frames = 0;`,
      `  static uint32_t last = 0;
  static uint8_t row = 0;
  if (millis() - last > 120) {
    last = millis();
    // TODO: 只点亮 row 这一行，熄灭其它行，刷新后 row 前移
    // 并用 HCP.report("frames", ++frames) 上报帧数
  }`,
    ),
    probes: [
      {
        id: 'p-strip',
        title: '灯带按 16 颗工作',
        description: '检查灯带初始化数量与是否发送过帧。',
        windowMs: 4000,
        expect: [{ type: 'strip', count: 16, first: { r: 0, g: 0, b: 0 }, tolerance: 255, note: '本项只校验数量，颜色不做要求' }],
        hint: 'stripBegin 的数量必须等于物理灯珠数；改了颜色要调用 showStrip()。',
        weight: 2,
      },
      {
        id: 'p-run',
        title: '动画在持续推进',
        description: '读取上报的累计帧数与运行时长。',
        windowMs: 5000,
        expect: [
          { type: 'report', key: 'frames', min: 12, note: '3 秒内至少刷新 12 帧' },
          { type: 'uptime', minMs: 3000 },
        ],
        hint: '每帧都要 report 一次；如果 frames 一直是 1，说明计数变量定义在 loop 里被重置了。',
        weight: 3,
      },
    ],
    hints: ['行优先编号：第 row 行的 4 颗是 row*4 + 0..3。', '切行之前先把上一行熄灭，否则会越亮越多。'],
    solution: starter(
      `  HCP.stripBegin(16);
  uint32_t frames = 0;`,
      `  static uint32_t last = 0;
  static uint8_t row = 0;
  if (millis() - last > 120) {
    last = millis();
    for (uint16_t i = 0; i < 16; i++) HCP.setStripPixel(i, 0, 0, 0);
    for (uint8_t col = 0; col < 4; col++) HCP.setStripPixel(row * 4 + col, 0, 255, 255);
    HCP.showStrip();
    row = (row + 1) % 4;
    HCP.report("frames", ++frames);
  }`,
    ),
    failureModes: [{ symptom: '灯全亮不流动', cause: '没有先熄灭其它行，或者没有按行推进 row。' }],
  },
  {
    ...base,
    id: 'board-b4-14',
    kind: 'firmware',
    number: 16,
    chapter: 4,
    title: '双角色同时在线',
    subtitle: 'AP + STA 并存：既开热点又连路由器',
    difficulty: 3,
    estimatedMinutes: 20,
    brief: '野外作业时路由器不可靠：设备要自己开热点供手机直连，同时仍连教室路由器把数据传回云端。请把 Wi-Fi 设为 AP_STA 双角色。',
    objective: ['Wi-Fi 模式设为 AP + STA', '保持 STA 已连接（云端通道依赖它）', '连续运行 3 秒以上不复位'],
    knowledge: ['AP 模式', 'STA 模式', 'AP_STA 双角色'],
    pins: [],
    starterCode: starter(
      `  // TODO: 先设双角色模式，再开热点
  // 注意：SDK 已经用 STA 连了服务器，切换模式时不要断开 STA`,
      '',
    ),
    probes: [
      {
        id: 'p-mode',
        title: '双角色已开启',
        description: '读取 Wi-Fi 当前模式。',
        windowMs: 6000,
        expect: [{ type: 'wifi', mode: 'ap_sta' }],
        hint: 'WIFI_AP 只开热点、WIFI_STA 只做终端，两者都有才是 AP_STA。',
        weight: 3,
      },
      {
        id: 'p-stable',
        title: '切模式后没有复位',
        description: '检查运行时长。',
        windowMs: 4000,
        expect: [{ type: 'uptime', minMs: 3000 }],
        hint: '软热点密码至少 8 位，参数不合法会直接重启。',
        weight: 1,
      },
    ],
    hints: ['WiFi.softAP("ESP32-Lab", "12345678") 会返回是否成功，可以打印出来看。', '如果 STA 断了，云端通道也会断——探针就收不到证据了。'],
    solution: starter(
      `  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("ESP32-Lab", "12345678");`,
      '',
    ),
  },
  {
    ...base,
    id: 'board-b4-15',
    kind: 'firmware',
    number: 17,
    chapter: 4,
    title: '掉线自己爬起来',
    subtitle: '断线重连，不许靠复位解决',
    difficulty: 4,
    estimatedMinutes: 25,
    brief: '教室路由器每晚定时重启。设备必须在掉线后自己重连，而不是整机复位。要求连续运行 12 秒以上、STA 保持在线。',
    objective: ['实现断线检测与重连（WiFi.reconnect 或重新 begin）', 'STA 保持已连接', '连续运行 12 秒以上，不出现复位'],
    knowledge: ['连接状态机', '退避重试', '看门狗复位'],
    pins: [],
    starterCode: starter(
      `  WiFi.mode(WIFI_STA);`,
      `  static uint32_t last = 0;
  if (millis() - last > 3000) {
    last = millis();
    // TODO: 发现掉线就重连；注意等待循环里要 delay，否则看门狗会复位
  }`,
    ),
    probes: [
      {
        id: 'p-alive',
        title: '长时间运行未复位',
        description: '读取设备连续运行时长。',
        windowMs: 14000,
        expect: [{ type: 'uptime', minMs: 12000 }],
        hint: 'while (WiFi.status() != WL_CONNECTED) { } 这种空转会触发看门狗，必须加 delay。',
        weight: 3,
      },
      {
        id: 'p-link',
        title: 'STA 仍在线',
        description: '检查 Wi-Fi 模式与信号。',
        windowMs: 4000,
        expect: [{ type: 'wifi', mode: 'sta', rssiMin: -88 }],
        hint: '重连过程中不要切到 WIFI_OFF，否则云端通道也会断。',
        weight: 2,
      },
    ],
    hints: ['WiFi.reconnect() 比重新 begin 更快，优先用它。', '先判断 status，再决定等多久；每轮都要让出 CPU。'],
    solution: starter(
      `  WiFi.mode(WIFI_STA);`,
      `  static uint32_t last = 0;
  if (millis() - last > 3000) {
    last = millis();
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      for (int i = 0; i < 10 && WiFi.status() != WL_CONNECTED; i++) delay(200);
    }
  }`,
    ),
    failureModes: [{ symptom: 'uptime 一直很小', cause: '等待循环没有 delay，触发看门狗复位。' }],
  },
  {
    ...base,
    id: 'board-b5-15',
    kind: 'firmware',
    number: 18,
    chapter: 5,
    title: '慢采样的取舍',
    subtitle: '低功耗场景：低频采样并如实上报',
    difficulty: 4,
    estimatedMinutes: 25,
    brief: '电池供电的田间节点不能高频采样。要求每 2 秒读一次光敏并上报毫伏值，连续运行 4 秒以上。云端会用同一引脚的实测值核对。',
    objective: ['每 2 秒读取一次 GPIO1 的毫伏值', '上报 HCP.report("mv", 毫伏值)', '连续运行 4 秒以上'],
    knowledge: ['低功耗采样', 'ADC 毫伏换算', '采样周期'],
    pins: [{ label: '光敏', gpio: 1 }],
    starterCode: starter(
      `  analogReadResolution(12);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    // TODO: 读一次并上报
  }`,
    ),
    probes: [
      {
        id: 'p-adc',
        title: '传感器有读数',
        description: '检查光敏引脚是否有合理模拟值。',
        windowMs: 4000,
        expect: [{ type: 'adc', pin: 1, min: 20, max: 4900 }],
        hint: '确认没有把 GPIO1 配成 OUTPUT。',
        weight: 1,
      },
      {
        id: 'p-report',
        title: '上报值与实测一致',
        description: '比对上报毫伏值与采样值。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'mv', min: 0, max: 5000, cross: { source: 'adc.mv', tolerance: 300 } }],
        hint: '上报的是毫伏（0–3300），不是原始码值（0–4095）。',
        weight: 3,
      },
      {
        id: 'p-alive',
        title: '持续运行',
        description: '检查运行时长。',
        windowMs: 4000,
        expect: [{ type: 'uptime', minMs: 4000 }],
        hint: '不要用 delay(2000) 死等——期间协议收发会停，证据可能发不出去。',
        weight: 1,
      },
    ],
    hints: ['用 millis() 判断间隔，不要用 delay 占住主循环。', '读数的量纲要和上报的量纲一致。'],
    solution: starter(
      `  analogReadResolution(12);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    HCP.report("mv", analogReadMilliVolts(1));
  }`,
    ),
  },
  {
    ...base,
    id: 'board-b5-16',
    kind: 'firmware',
    number: 19,
    chapter: 5,
    title: '四合一联调',
    subtitle: '灯、传感器、上报、联网同时成立',
    difficulty: 5,
    estimatedMinutes: 35,
    brief: '毕业设计的验收现场：指示灯常亮、温湿度读到合法值、数据如实上报、设备保持联网。四项缺一不可。',
    objective: ['GPIO4 常亮作为运行指示', 'DHT11 读到合法温湿度', '上报温度且与实测一致', 'STA 保持联网'],
    knowledge: ['系统联调', '多外设共存', '验收思维'],
    pins: [
      { label: 'LED1', gpio: 4 },
      { label: 'DHT11', gpio: 8 },
    ],
    starterCode: starter(
      `  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    // TODO: 读 DHT11 并上报温度
  }`,
    ),
    probes: [
      {
        id: 'p-led',
        title: '运行指示灯常亮',
        description: '读取 GPIO4 电平。',
        windowMs: 4000,
        expect: [{ type: 'pin-level', pin: 4, value: 1 }],
        hint: '指示灯要在 setup 里点亮后一直保持。',
        weight: 1,
      },
      {
        id: 'p-dht',
        title: '温湿度合法',
        description: '检查单总线解码结果。',
        windowMs: 8000,
        expect: [
          { type: 'dht', field: 'temperature', min: 5, max: 45 },
          { type: 'dht', field: 'humidity', min: 20, max: 95 },
        ],
        hint: 'DHT11 两次采样至少间隔 1 秒。',
        weight: 2,
      },
      {
        id: 'p-report',
        title: '上报与实测一致',
        description: '交叉校验上报温度。',
        windowMs: 4000,
        expect: [{ type: 'report', key: 'temp', min: -10, max: 60, cross: { source: 'dht.temperature', tolerance: 1.5 } }],
        hint: '用浮点保存温度，别用 int 截断。',
        weight: 3,
      },
      {
        id: 'p-link',
        title: '保持联网',
        description: '检查 Wi-Fi 状态。',
        windowMs: 4000,
        expect: [{ type: 'wifi', mode: 'sta', rssiMin: -88 }],
        hint: '如果这里失败，前几项的证据根本传不上来——通常是切了 WIFI_OFF。',
        weight: 1,
      },
    ],
    hints: ['先把四个功能分别跑通，再合到一个 loop 里。', '每轮 loop 都要调用 HCP.loop()，不要被长 delay 阻塞。'],
    solution: starter(
      `  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);`,
      `  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    auto r = HCP.readDht();
    if (r.ok) HCP.report("temp", r.temperature);
  }`,
    ),
  },
  {
    ...base,
    id: 'board-b5-17',
    kind: 'quiz',
    number: 20,
    chapter: 5,
    title: '日志里的真凶',
    subtitle: '屏上答题：从串口日志定位根因',
    difficulty: 3,
    estimatedMinutes: 8,
    brief: '屏幕会显示一段现场串口日志，上下键翻看，选出最可能的根因。',
    objective: ['从多行日志中区分“正常项”和“异常项”', '把异常项与硬件时序要求对应起来'],
    knowledge: ['日志分析', '采样时序', '排障顺序'],
    starterCode: `// 现场日志（节选）
// [boot]   heap=182k  reason=poweron
// [wifi]   connected rssi=-61 ip=192.168.1.27
// [led]    GPIO4 HIGH
// [dht]    read fail  interval=55ms  ok=false
// [cloud]  ws connected`,
    probes: [],
    screenQuiz: {
      prompt: '日志里 Wi-Fi 正常、指示灯正常、云端已连上，只有 DHT 一直失败。最可能的根因是：',
      animation: 'none',
      options: [
        { id: 'A', label: 'Wi-Fi 信号太弱导致传感器读不到' },
        { id: 'B', label: 'DHT11 采样间隔 55ms，远小于其 1 秒要求' },
        { id: 'C', label: '堆内存不足，传感器无法初始化' },
        { id: 'D', label: '云端连接占用了传感器引脚' },
      ],
      answer: 'B',
      explanation: '日志已排除网络（rssi=-61 且 ws connected）、内存（heap=182k）与指示灯。DHT11 每次转换需要约 1 秒，55ms 的间隔会让它一直返回失败——这正是日志里 interval=55ms 的含义。',
    },
    hints: ['先划掉日志里明确正常的三项，再看剩下的那一项。'],
  },
];

export const boardLevels: BoardLevel[] = raw.map((level) => boardLevelSchema.parse(level)).sort((a, b) => a.number - b.number);

export const boardChapters: ChapterView[] = [
  { id: 1, title: '灯火初明', subtitle: 'GPIO 输出、输入与上拉', color: '#f59e0b', story: '巡检队的灯牌与按键全部失灵。你手上只有一块开发板，先把最基础的电平控制拿回来。' },
  { id: 2, title: '感知有度', subtitle: '模拟量、传感器与执行器', color: '#22d3ee', story: '灯亮了，但城市还需要知道冷暖和明暗。光敏、温湿度与继电器开始接入。' },
  { id: 3, title: '光影成章', subtitle: '灯阵、动画与声音', color: '#a855f7', story: '数据需要被人看见。16 颗灯珠与蜂鸣器成为你的输出设备。' },
  { id: 4, title: '一线通云', subtitle: '联网、信号与重连', color: '#38bdf8', story: '设备必须开口说话。联网、判读信号质量、在掉线后自己爬起来。' },
  { id: 5, title: '万无一失', subtitle: '综合排障', color: '#f43f5e', story: '一份被改坏的巡检程序交到你手上，四处故障等着被逐个定位。' },
];

export function getBoardLevel(id: string): BoardLevel | undefined {
  return boardLevels.find((level) => level.id === id);
}
