import { z } from 'zod';
import { type BoardLevelKind, type BoardProbeResult, boardEvidenceSchema, boardReportSchema } from './board.ts';

/**
 * HCP/1 —— 万物之城硬件终端协议（Hardware Console Protocol）
 * 服务端、固件参考实现与自动化测试共用本文件的定义，不得各自复制一份。
 * 规范见 docs/hardware/HCP-v1.md。
 */
export const HCP_VERSION = 'HCP/1';

export const hcpLimits = {
  frameBytes: 8192,
  hudTextChars: 1200,
  widgets: 12,
  keys: 6,
  sparkPoints: 48,
  inputsPerSecond: 10,
  inputsPerMinute: 300,
  inputIdMemo: 128,
  hudAckTimeoutMs: 4000,
  hudPushIntervalMs: 1200,
  heartbeatSeconds: 20,
  sensorIntervalMs: 2000,
  sessionIdleMinutes: 30,
} as const;

/** 设备令牌可授予的作用域，服务端在握手时下发实际授予结果。 */
export const hwScopes = ['hud:read', 'game:input', 'sim:step', 'hil:sensor'] as const;
export type HwScope = (typeof hwScopes)[number];

export const hwKeyIds = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'] as const;
export type HwKeyId = (typeof hwKeyIds)[number];

export const hwScreenIds = ['boot', 'pair', 'idle', 'briefing', 'console', 'paused', 'finished', 'offline'] as const;
export type HwScreenId = (typeof hwScreenIds)[number];

/** 设备本地导航，不产生游戏命令，由网关更新视图后重推 HUD。 */
export const hwNavActions = ['focus-next', 'focus-prev', 'page-next', 'page-prev', 'refresh'] as const;
export type HwNavAction = (typeof hwNavActions)[number];

/** 硬件被允许触发的命令白名单。未列入的类型即使出现在按键映射中也会被拒绝。 */
export const hardwareCommandTypes = ['start', 'pause', 'resume', 'inspect', 'dialog', 'simulate', 'hint', 'answer'] as const;
export type HardwareCommandType = (typeof hardwareCommandTypes)[number];

export const hwErrorCodes = ['BAD_FRAME', 'BAD_CAPS', 'UNAUTHORIZED', 'DEVICE_REVOKED', 'NOT_BOUND', 'NO_SESSION', 'UNKNOWN_KEY', 'RATE_LIMIT', 'COMMAND_REJECTED', 'SENSOR_REJECTED', 'FRAME_TOO_LARGE', 'PAIR_EXPIRED', 'DEVICE_LIMIT', 'IDEMPOTENT_REPLAY', 'EXAM_NOT_ACTIVE', 'PROBE_MISMATCH', 'EVIDENCE_REJECTED'] as const;
export type HwErrorCode = (typeof hwErrorCodes)[number];

export const hcpErrorText: Record<HwErrorCode, string> = {
  BAD_FRAME: '帧格式不符合 HCP/1 规范。',
  BAD_CAPS: '设备能力声明无效。',
  UNAUTHORIZED: '设备令牌无效或已轮换，请重新配对。',
  DEVICE_REVOKED: '设备已被解绑或停用。',
  NOT_BOUND: '设备尚未绑定账号，请在网页输入配对码。',
  NO_SESSION: '当前没有可操控的任务，请在网页开始一关。',
  UNKNOWN_KEY: '该按键在当前画面没有绑定动作。',
  RATE_LIMIT: '操作过于频繁，已被限流。',
  COMMAND_REJECTED: '服务器拒绝了这次操作。',
  SENSOR_REJECTED: '硬件在环数据不在允许的关卡模式下。',
  FRAME_TOO_LARGE: '帧超出大小上限。',
  PAIR_EXPIRED: '配对码已过期，请让设备重新生成。',
  DEVICE_LIMIT: '该账号已绑定设备数量达到上限。',
  IDEMPOTENT_REPLAY: '重复的输入编号，已按幂等处理。',
  EXAM_NOT_ACTIVE: '当前没有进行中的板端关卡，请在网页开始一关。',
  PROBE_MISMATCH: '上报的探针编号与当前考察项不一致。',
  EVIDENCE_REJECTED: '证据格式或时间窗口不符合要求。',
};

/** 单账号可绑定设备上限。 */
export const HW_MAX_DEVICES_PER_USER = 4;
export const HW_PAIR_CODE_TTL_MS = 10 * 60 * 1000;
export const HW_UNBOUND_TTL_MS = 24 * 60 * 60 * 1000;

const scalarish = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

export const hwCapsSchema = z
  .object({
    w: z.number().int().min(64).max(1024),
    h: z.number().int().min(48).max(1024),
    color: z.enum(['mono', 'rgb565']),
    touch: z.boolean().default(false),
    rotary: z.boolean().default(false),
    keys: z.array(z.enum(hwKeyIds)).min(1).max(6),
    lang: z.enum(['zh', 'en']).default('zh'),
    /** 板型档案 id，声明后服务器可下发针对该板的外设探针；不声明也能玩剧情操控 */
    board: z.string().max(40).optional(),
    /** 自报外设能力，如 gpio/adc/pwm/dht11/ws2812/wifi/tft；仅用于筛选可下发的内容 */
    features: z.array(z.string().max(20)).max(16).default([]),
  })
  .strict();
export type HwCaps = z.infer<typeof hwCapsSchema>;

const wText = z.object({ t: z.literal('text'), v: z.string().max(hcpLimits.hudTextChars), size: z.enum(['s', 'm', 'l']).optional(), align: z.enum(['l', 'c']).optional() }).strict();
const wKv = z.object({ t: z.literal('kv'), k: z.string().max(24), v: z.string().max(60), tone: z.enum(['ok', 'warn', 'bad']).optional() }).strict();
const wList = z.object({
  t: z.literal('list'),
  label: z.string().max(24).optional(),
  items: z.array(z.object({ k: z.string().max(60), v: z.string().max(40).optional(), st: z.enum(['done', 'todo', 'focus']).optional() }).strict()).max(12),
}).strict();
const wGauge = z.object({ t: z.literal('gauge'), label: z.string().max(24), v: z.number().finite(), min: z.number().finite(), max: z.number().finite(), unit: z.string().max(12).optional() }).strict();
const wBar = z.object({ t: z.literal('bar'), label: z.string().max(24), v: z.number().finite(), max: z.number().finite() }).strict();
const wSpark = z.object({ t: z.literal('spark'), label: z.string().max(24).optional(), pts: z.array(z.number().finite()).min(2).max(hcpLimits.sparkPoints) }).strict();
const wAlert = z.object({ t: z.literal('alert'), level: z.enum(['info', 'warn', 'error']), v: z.string().max(160) }).strict();
export const hudWidgetSchema = z.discriminatedUnion('t', [wText, wKv, wList, wGauge, wBar, wSpark, wAlert]);
export type HudWidget = z.infer<typeof hudWidgetSchema>;

/**
 * 按键语义完全由服务器下发。设备只上报“按了哪个键”，
 * 网关按最后一次下发且已被证明送达的映射表翻译为命令，因此设备端无法凭空构造命令。
 */
export const hudKeySchema = z
  .object({
    k: z.enum(hwKeyIds),
    lb: z.string().max(16),
    cmd: z.enum(hardwareCommandTypes).optional(),
    tg: z.string().max(80).optional(),
    pl: z.record(z.string().max(40), scalarish).optional(),
    nav: z.enum(hwNavActions).optional(),
    tone: z.enum(['primary', 'warn']).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.cmd || v.nav), { message: '按键必须绑定命令或导航动作' });
export type HudKey = z.infer<typeof hudKeySchema>;

export const hudScreenSchema = z
  .object({
    id: z.enum(hwScreenIds),
    rev: z.number().int().nonnegative(),
    title: z.string().max(60),
    subtitle: z.string().max(120).optional(),
    widgets: z.array(hudWidgetSchema).max(hcpLimits.widgets),
    km: z.array(hudKeySchema).max(hcpLimits.keys),
    focus: z.string().max(80).optional(),
    elapsed: z.number().int().nonnegative().default(0),
    score: z.number().int().nonnegative().default(0),
    online: z.boolean().default(true),
  })
  .strict();
export type HudScreen = z.infer<typeof hudScreenSchema>;

export const hwInputEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('key'), k: z.enum(hwKeyIds), a: z.enum(['press', 'long', 'repeat']).default('press') }).strict(),
  z.object({ t: z.literal('touch'), x: z.number().int().min(0).max(1024), y: z.number().int().min(0).max(1024) }).strict(),
  z.object({ t: z.literal('rot'), d: z.number().int().min(-8).max(8) }).strict(),
]);
export type HwInputEvent = z.infer<typeof hwInputEventSchema>;

export const hwClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: z.string().max(12), fw: z.string().max(40), caps: hwCapsSchema }).strict(),
  z.object({ t: z.literal('input'), id: z.string().min(8).max(64), ev: hwInputEventSchema }).strict(),
  z.object({ t: z.literal('ack'), rev: z.number().int().nonnegative() }).strict(),
  z.object({ t: z.literal('sensor'), m: z.string().max(24), v: z.number().finite(), ts: z.number().int().nonnegative().optional() }).strict(),
  boardEvidenceSchema,
  boardReportSchema,
  z.object({ t: z.literal('ping'), ts: z.number().int().nonnegative().optional() }).strict(),
  z.object({ t: z.literal('bye') }).strict(),
]);
export type HwClientMessage = z.infer<typeof hwClientMessageSchema>;

/** 板端关卡的题目视图，屏幕与网页共用同一份结构 */
export interface HwExamView {
  sessionId: string;
  levelId: string;
  title: string;
  kind: BoardLevelKind;
  objective: string[];
  probes: Array<{ id: string; title: string; description: string }>;
  currentProbeIndex: number;
  status: 'running';
}

export type HwServerMessage =
  | { t: 'hello'; v: string; dev: { id: string; name: string; status: 'pending' | 'bound' }; pair?: { code: string; expiresIn: number }; scopes: HwScope[]; ts: number }
  | { t: 'exam'; exam: HwExamView }
  | { t: 'probe'; probe: { id: string; title: string; description: string; windowMs: number }; index: number; total: number }
  | { t: 'probe-result'; result: BoardProbeResult }
  | { t: 'ready'; dev: { id: string; name: string }; scopes: HwScope[] }
  | { t: 'hud'; screen: HudScreen }
  | { t: 'toast'; level: 'info' | 'warn' | 'error'; v: string }
  | { t: 'pong'; ts: number; serverTime: number }
  | { t: 'err'; code: HwErrorCode; msg: string; retry?: number }
  | { t: 'bye'; reason: string };

export type HwDeviceStatus = 'pending' | 'bound' | 'revoked';

export interface HwDeviceView {
  id: string;
  name: string;
  model: string;
  firmware: string;
  status: HwDeviceStatus;
  online: boolean;
  caps: HwCaps;
  pairCode?: string;
  pairExpiresAt?: string | null;
  lastSeenAt: string | null;
  attachedSessionId: string | null;
  createdAt: string;
}

export const hwEnrollRequestSchema = z
  .object({
    installationId: z.string().regex(/^[a-f0-9]{16,32}$/),
    model: z.string().min(1).max(60),
    fw: z.string().min(1).max(40),
    caps: hwCapsSchema,
  })
  .strict();
export type HwEnrollRequest = z.infer<typeof hwEnrollRequestSchema>;

export interface HwEnrollResponse {
  deviceId: string;
  token: string;
  pairCode: string;
  pairExpiresAt: string;
  wsUrl: string;
  heartbeatSeconds: number;
}

export const hwBindRequestSchema = z.object({ code: z.string().trim().min(6).max(12), name: z.string().trim().min(1).max(40).optional() }).strict();
export const hwAttachRequestSchema = z.object({ sessionId: z.string().max(80).nullable() }).strict();

/** 帧必须是 UTF-8 JSON 且在 hcpLimits.frameBytes 以内。 */
export function hcpFrameBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** 配对码字母表刻意去掉 0/O、1/I 等易混字符，屏幕字体小也不至于输错。 */
export const HW_PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function formatPairCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
