import { z } from 'zod';

/**
 * 板端轨道（B 轨）—— 学生在自己的开发板上写程序，通过 HCP 连云端，
 * 服务器出题、发探针、收硬件证据、判定功能是否真正实现。
 *
 * 设计前提：设备侧上报的“证据”不可信到可以直接当答案用，所以
 *   1) 证据必须来自 SDK 对真实外设的采样（引脚电平/边沿/总线解码），
 *   2) 学生主动上报的读数（report）必须与 SDK 交叉源一致才计分，
 *   3) 分数只由服务端 grader 计算，设备无法提交分数。
 * 规范见 docs/hardware/BOARD-TRACK.md。
 */

export const BOARD_TRACK = 'board' as const;

/** 板型档案：与《SCH_TFT版_2024-09-24》原理图一致，内容与 SDK 共用。 */
export const BOARD_PROFILE = {
  id: 'jlc-esp32s3-tft',
  name: '嘉立创 ESP32-S3 功能板 TFT 版',
  mcu: 'ESP32-S3-WROOM-1-N16R8',
  pins: {
    led: [4, 5, 6, 7],
    key: { up: 17, down: 18, left: 15, right: 16, a: 13, b: 14 },
    buzzer: 47,
    relay: 2,
    light: 1,
    dht: 8,
    strip: 48,
    /** 1.8" ST7735 屏幕，引脚组以原理图为准，SDK 侧再按实测确认 */
    tft: [9, 10, 11, 12, 21, 38],
  },
  features: ['gpio', 'adc', 'pwm', 'dht11', 'ws2812', 'relay', 'buzzer', 'wifi', 'tft'],
} as const;

/** 按键索引 → 丝印，证据里只传索引，避免字符串大小写歧义。 */
export const BOARD_KEYS = ['up', 'down', 'left', 'right', 'a', 'b'] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];

export const boardLevelKinds = ['firmware', 'quiz', 'debug'] as const;
export type BoardLevelKind = (typeof boardLevelKinds)[number];

export const boardLevelKindNames: Record<BoardLevelKind, string> = {
  firmware: '功能验收',
  quiz: '屏上答题',
  debug: '代码排障',
};

/* ----------------------------- 断言（服务器侧判定） ----------------------------- */

const base = { note: z.string().max(120).optional() };

/** 交叉校验源：学生上报值必须与这些“SDK 从硬件读到的事实”对齐 */
export const boardCrossSources = ['dht.temperature', 'dht.humidity', 'adc.mv', 'wifi.rssi', 'keys.up', 'keys.down', 'keys.left', 'keys.right', 'keys.a', 'keys.b'] as const;
export type BoardCrossSource = (typeof boardCrossSources)[number];

export const boardAssertionSchema = z.discriminatedUnion('type', [
  /** 引脚最终电平：验证“点亮/关闭/继电器吸合”这类离散动作 */
  z.object({ type: z.literal('pin-level'), pin: z.number().int().min(0).max(48), value: z.union([z.literal(0), z.literal(1)]), ...base }).strict(),
  /** 窗口内边沿次数：闪烁、呼吸、流水都靠它，比“当前电平”更难蒙 */
  z.object({ type: z.literal('pin-edges'), pin: z.number().int().min(0).max(48), min: z.number().int().min(0).max(100000), max: z.number().int().min(0).max(100000).optional(), ...base }).strict(),
  /** PWM 频率与占空比：蜂鸣器音调、LED 调光、舵机 */
  z.object({ type: z.literal('pwm'), pin: z.number().int().min(0).max(48), hz: z.number().positive(), hzTolerancePct: z.number().min(0).max(90).default(10), duty: z.number().min(0).max(100).optional(), dutyTolerancePct: z.number().min(0).max(90).default(10), ...base }).strict(),
  /** ADC 读数区间：光敏电阻这类模拟量，验证传感器确实在工作 */
  z.object({ type: z.literal('adc'), pin: z.number().int().min(0).max(48), min: z.number().min(0), max: z.number().min(0), ...base }).strict(),
  /** 按键事件：板上真实按下次数（不是学生自己报的数） */
  z.object({ type: z.literal('key'), key: z.enum(BOARD_KEYS), presses: z.number().int().min(1).max(200), ...base }).strict(),
  /** DHT11：SDK 侧解码单总线时序得到的温湿度 */
  z.object({ type: z.literal('dht'), field: z.enum(['temperature', 'humidity']), min: z.number(), max: z.number(), ...base }).strict(),
  /** WS2812：像素数量与前若干像素颜色 */
  z.object({ type: z.literal('strip'), count: z.number().int().min(1).max(64), first: z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) }).strict(), tolerance: z.number().int().min(0).max(255).default(28), ...base }).strict(),
  /** Wi-Fi 状态：模式、信号强度、IP 前缀 */
  z.object({ type: z.literal('wifi'), mode: z.enum(['sta', 'ap', 'ap_sta', 'off']).optional(), rssiMin: z.number().int().min(-120).max(0).optional(), ipPrefix: z.string().max(24).optional(), ...base }).strict(),
  /** 学生上报的读数，且必须与 SDK 交叉源一致（防止直接打印正确答案） */
  z.object({ type: z.literal('report'), key: z.string().min(1).max(24), min: z.number().optional(), max: z.number().optional(), cross: z.object({ source: z.enum(['dht.temperature', 'dht.humidity', 'adc.mv', 'wifi.rssi', 'keys.up', 'keys.down', 'keys.left', 'keys.right', 'keys.a', 'keys.b']), tolerance: z.number().min(0).max(5000) }).strict().optional(), ...base }).strict(),
  /** 运行时长下限：防止靠反复重启刷新状态蒙过时序类探针 */
  z.object({ type: z.literal('uptime'), minMs: z.number().int().min(0), ...base }).strict(),
]);
export type BoardAssertion = z.infer<typeof boardAssertionSchema>;

/* ----------------------------- 探针 ----------------------------- */

export const boardProbeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,40}$/),
    title: z.string().min(2).max(60),
    description: z.string().min(4).max(300),
    /** 探针观察窗口，服务器在这段时间内收证据 */
    windowMs: z.number().int().min(800).max(60000).default(4000),
    /** 服务器侧激励：目前只做“等待/驱动参考引脚”，不改变学生电路 */
    setup: z.array(z.object({ do: z.enum(['wait', 'note']), ms: z.number().int().min(0).max(60000).optional(), text: z.string().max(120).optional() }).strict()).max(4).optional(),
    expect: z.array(boardAssertionSchema).min(1).max(8),
    /** 部分失败时的教学反馈 */
    hint: z.string().min(4).max(300),
    weight: z.number().int().min(1).max(10).default(1),
  })
  .strict();
export type BoardProbe = z.infer<typeof boardProbeSchema>;

/* ----------------------------- 证据 ----------------------------- */

export const boardFactsSchema = z
  .object({
    uptimeMs: z.number().int().min(0),
    boot: z.string().max(24).optional(),
    pins: z.array(z.object({ pin: z.number().int().min(0).max(48), mode: z.enum(['in', 'out', 'analog', 'pwm']), level: z.union([z.literal(0), z.literal(1)]), edges: z.number().int().min(0).max(1000000) }).strict()).max(40).default([]),
    pwm: z.array(z.object({ pin: z.number().int().min(0).max(48), hz: z.number().min(0).max(100000), duty: z.number().min(0).max(100) }).strict()).max(8).default([]),
    adc: z.array(z.object({ pin: z.number().int().min(0).max(48), mv: z.number().min(0).max(5000) }).strict()).max(8).default([]),
    keys: z.array(z.object({ key: z.enum(BOARD_KEYS), presses: z.number().int().min(0).max(10000), lastAt: z.number().int().min(0).optional() }).strict()).max(6).default([]),
    dht: z.object({ ok: z.boolean(), temperature: z.number().min(-40).max(80).optional(), humidity: z.number().min(0).max(100).optional() }).strict().optional(),
    strip: z.object({ count: z.number().int().min(0).max(64), first: z.object({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) }).strict() }).strict().optional(),
    wifi: z.object({ mode: z.enum(['sta', 'ap', 'ap_sta', 'off']), rssi: z.number().int().min(-120).max(0).optional(), ip: z.string().max(48).optional() }).strict().optional(),
    reports: z.array(z.object({ k: z.string().min(1).max(24), v: z.number().finite(), ts: z.number().int().min(0) }).strict()).max(32).default([]),
    errors: z.array(z.string().max(120)).max(8).default([]),
  })
  .strict();
export type BoardFacts = z.infer<typeof boardFactsSchema>;

export const boardEvidenceSchema = z.object({ t: z.literal('evidence'), pid: z.string().min(2).max(40), facts: boardFactsSchema }).strict();
export type BoardEvidence = z.infer<typeof boardEvidenceSchema>;

export const boardReportSchema = z.object({ t: z.literal('report'), k: z.string().min(1).max(24), v: z.number().finite() }).strict();

/* ----------------------------- 关卡 ----------------------------- */

export const boardScreenQuizSchema = z
  .object({
    prompt: z.string().min(6).max(600),
    /** 屏上动画：由 HUD 控件渲染的主题名，SDK 本地播放，不依赖网络 */
    animation: z.enum(['none', 'blink', 'breath', 'rainbow', 'wave', 'pulse']).default('none'),
    options: z.array(z.object({ id: z.string().min(1).max(4), label: z.string().min(1).max(60) }).strict()).min(2).max(4),
    answer: z.string().min(1).max(4),
    explanation: z.string().min(10).max(600),
  })
  .strict();
export type BoardScreenQuiz = z.infer<typeof boardScreenQuizSchema>;

export const boardLevelSchema = z
  .object({
    id: z.string().regex(/^board-[a-z0-9-]{2,40}$/),
    track: z.literal('board'),
    board: z.literal('jlc-esp32s3-tft'),
    kind: z.enum(boardLevelKinds),
    number: z.number().int().min(1).max(400),
    chapter: z.number().int().min(1).max(20),
    version: z.number().int().min(1),
    title: z.string().min(2).max(60),
    subtitle: z.string().min(2).max(120),
    difficulty: z.number().int().min(1).max(5),
    estimatedMinutes: z.number().int().min(3).max(180),
    /** 显示在板子屏幕上的开场说明，SDK 会分页渲染 */
    brief: z.string().min(20).max(1200),
    /** 电脑端显示的完整任务书 */
    objective: z.array(z.string().min(4).max(200)).min(1).max(8),
    knowledge: z.array(z.string().min(1).max(60)).min(1).max(8),
    pins: z.array(z.object({ label: z.string().min(1).max(24), gpio: z.number().int().min(0).max(48), note: z.string().max(80).optional() }).strict()).max(12).optional(),
    starterCode: z.string().min(20).max(8000),
    /** 功能验收与排障题必须有探针；纯屏上答题可无探针 */
    probes: z.array(boardProbeSchema).max(10).default([]),
    screenQuiz: boardScreenQuizSchema.optional(),
    hints: z.array(z.string().min(4).max(300)).min(1).max(6),
    /** 参考解，只给服务器自检与教师查看，绝不下发学生 */
    solution: z.string().min(20).max(8000).optional(),
    failureModes: z.array(z.object({ symptom: z.string().min(4).max(160), cause: z.string().min(4).max(200) }).strict()).max(6).optional(),
    timeLimitSeconds: z.number().int().min(60).max(7200).optional(),
  })
  .strict()
  .superRefine((level, ctx) => {
    if (level.kind !== 'quiz' && level.probes.length < 1) ctx.addIssue({ code: 'custom', message: '功能验收与排障题至少需要一条探针', path: ['probes'] });
    if (level.kind === 'quiz' && !level.screenQuiz) ctx.addIssue({ code: 'custom', message: '屏上答题必须提供 screenQuiz', path: ['screenQuiz'] });
    const ids = new Set(level.probes.map((p) => p.id));
    if (ids.size !== level.probes.length) ctx.addIssue({ code: 'custom', message: '探针 id 重复', path: ['probes'] });
  });
export type BoardLevel = z.infer<typeof boardLevelSchema>;

export type PublicBoardLevel = Omit<BoardLevel, 'solution' | 'probes' | 'screenQuiz'> & {
  probeCount: number;
  probeTitles: string[];
  screenQuiz?: Omit<BoardScreenQuiz, 'answer' | 'explanation'>;
};

export function publicBoardLevel(level: BoardLevel): PublicBoardLevel {
  const { solution: _solution, probes, screenQuiz, ...rest } = level;
  return {
    ...rest,
    probeCount: probes.length,
    probeTitles: probes.map((p) => p.title),
    ...(screenQuiz ? { screenQuiz: { prompt: screenQuiz.prompt, animation: screenQuiz.animation, options: screenQuiz.options } } : {}),
  };
}

/* ----------------------------- 判定结果 ----------------------------- */

export interface BoardCheckResult {
  type: BoardAssertion['type'];
  passed: boolean;
  /** 给学生的判定说明，含实测值 */
  detail: string;
}

export interface BoardProbeResult {
  probeId: string;
  title: string;
  passed: boolean;
  weight: number;
  checks: BoardCheckResult[];
  /** 第一条失败断言的教学反馈 */
  feedback: string;
}

export const boardRunStatuses = ['running', 'passed', 'failed', 'abandoned'] as const;
export type BoardRunStatus = (typeof boardRunStatuses)[number];

export interface BoardRunView {
  sessionId: string;
  levelId: string;
  title: string;
  kind: BoardLevelKind;
  status: BoardRunStatus;
  currentProbeIndex: number;
  totalProbes: number;
  currentProbe?: { id: string; title: string; description: string; windowMs: number };
  results: BoardProbeResult[];
  score: number;
  stars: number;
  hintsUsed: number;
  startedAt: string;
  updatedAt: string;
}
