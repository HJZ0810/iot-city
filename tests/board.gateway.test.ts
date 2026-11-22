import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { publicLevel, type GameCommand, type UserView } from '../packages/shared/src/index.ts';
import { levelSchema } from '../packages/shared/src/index.ts';
import type { HwCaps } from '../packages/shared/src/hardware.ts';
import { registerHardware } from '../services/api/src/hardware/index.ts';
import { createBoardService } from '../services/api/src/board/index.ts';
import type { HardwareStore, HwDeviceRecord } from '../services/api/src/hardware/store.ts';
import { httpError } from '../services/api/src/errors.ts';

/**
 * 板端链路端到端：真实 Fastify + 真实 WebSocket + 真实网关，
 * 只把数据库与游戏会话换成内存桩，验证 exam / probe / evidence / probe-result 是否闭环。
 */

const USER: UserView = { id: 'user-b', username: 'stu_b', nickname: '学生乙', role: 'student', createdAt: '2026-10-21T00:00:00.000Z' };
const CAPS: HwCaps = { w: 320, h: 240, color: 'rgb565', touch: false, rotary: false, keys: ['K1', 'K2', 'K3', 'K4'], lang: 'zh', board: 'jlc-esp32s3-tft', features: ['gpio', 'pwm', 'dht11', 'wifi'] };

/** 板端关卡不需要游戏会话，这里给一个空关卡满足类型，任何命令都会被拒绝。 */
const stubLevel = levelSchema.parse({
  id: 'level-stub', number: 1, chapter: 1, version: 1, title: '占位关卡', subtitle: '仅用于满足类型校验',
  scene: 'lab', dimension: '2d', difficulty: 1, estimatedMinutes: 1,
  briefing: '这段文字仅用于满足关卡结构校验，板端流程不会进入这个会话，因此内容没有实际意义。',
  ending: '这段文字仅用于满足关卡结构校验，板端流程不会进入这个会话，因此内容没有实际意义。',
  knowledge: ['占位'], npc: { name: '无', role: '无', lines: ['无'] },
  devices: [{ id: 'd1', kind: 'sensor', label: '占位', model: 'x', position: [0, 0, 0], installed: true, enabled: true, parameters: {}, faults: [], description: '占位' }],
  links: [], environment: {}, inventory: [],
  tasks: [
    { id: 't1', label: '占位一', description: '占位任务一', knowledge: ['占位'], requires: [], all: [{ source: 'ticks', op: 'gte', value: 1 }], hint: '无', feedback: '无', points: 50 },
    { id: 't2', label: '占位二', description: '占位任务二', knowledge: ['占位'], requires: ['t1'], all: [{ source: 'ticks', op: 'gte', value: 2 }], hint: '无', feedback: '无', points: 50 },
  ],
  rules: [], failures: [],
  explanation: '这段解释仅用于满足关卡结构校验，板端流程不会进入这个会话，因此这里的内容没有实际教学意义。',
  references: [{ title: '占位', url: 'https://example.com' }],
  solution: [{ type: 'start' }, { type: 'inspect', target: 'd1' }, { type: 'simulate', payload: { ticks: 1 } }],
  failureCase: [],
});

class TinyStore implements HardwareStore {
  devices = new Map<string, HwDeviceRecord>();
  events: string[] = [];
  async create(i: { id: string; installationId: string; model: string; firmware: string; caps: HwCaps; tokenHash: string; pairCode: string; pairExpiresAt: string; name: string }) {
    const record: HwDeviceRecord = { id: i.id, installationId: i.installationId, model: i.model, firmware: i.firmware, tokenHash: i.tokenHash, pairCode: i.pairCode, pairExpiresAt: i.pairExpiresAt, userId: null, name: i.name, caps: i.caps, status: 'pending', lastSeenAt: null, lastIp: null, createdAt: new Date().toISOString() };
    this.devices.set(record.id, record);
    return record;
  }
  async findByInstallation(v: string) { return [...this.devices.values()].find((d) => d.installationId === v) ?? null; }
  async findById(v: string) { return this.devices.get(v) ?? null; }
  async findByTokenHash(v: string) { return [...this.devices.values()].find((d) => d.tokenHash === v && d.status !== 'revoked') ?? null; }
  async findByPairCode(v: string) { return [...this.devices.values()].find((d) => d.pairCode === v && d.status === 'pending') ?? null; }
  async countBound(v: string) { return [...this.devices.values()].filter((d) => d.userId === v && d.status === 'bound').length; }
  async rebind(id: string, i: { pairCode: string; pairExpiresAt: string; tokenHash: string }) { const d = this.devices.get(id)!; const next = { ...d, ...i, status: 'pending' as const, userId: null }; this.devices.set(id, next); return next; }
  async bind(id: string, userId: string, name: string) { const d = this.devices.get(id)!; const next: HwDeviceRecord = { ...d, userId, name, status: 'bound', pairCode: null, pairExpiresAt: null }; this.devices.set(id, next); return next; }
  async revoke(id: string, tokenHash: string) { const d = this.devices.get(id); if (d) this.devices.set(id, { ...d, status: 'revoked', tokenHash }); }
  async listByUser(v: string) { return [...this.devices.values()].filter((d) => d.userId === v); }
  async touch(id: string, ip: string, firmware: string, caps: HwCaps) { const d = this.devices.get(id); if (d) this.devices.set(id, { ...d, lastIp: ip, firmware, caps, lastSeenAt: new Date().toISOString() }); }
  async expireStale() { return 0; }
  async recordEvent(i: { kind: string; message: string }) { this.events.push(`${i.kind}:${i.message}`); }
  async openSession() {}
  async closeSessions() {}
}

const db = {
  async query<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM users')) return [{ id: USER.id, username: USER.username, nickname: USER.nickname, role: USER.role, created_at: USER.createdAt }] as T[];
    return [] as T[];
  },
  async execute() { return { affectedRows: 1 }; },
  async transaction<T>(fn: (tx: typeof db) => Promise<T>) { return fn(db); },
};

const staleLevel = publicLevel(stubLevel);
const game = {
  async owned(): Promise<never> { throw httpError(404, 'SESSION_NOT_FOUND', '找不到你的游戏存档。'); },
  async view() { return { id: 'none', mode: 'story' as const, level: staleLevel, state: {} as never, elapsedSeconds: 0, updatedAt: new Date().toISOString() }; },
  async executeCommand(_u: UserView, _id: string, _c: GameCommand): Promise<never> { throw httpError(409, 'NO_SESSION', '没有进行中的剧情会话。'); },
};

const ctx = {
  db,
  async requireUser(request: { headers: Record<string, unknown> }) {
    if (request.headers['x-test-user'] !== USER.id) throw httpError(401, 'AUTH_REQUIRED', '请先登录。');
    return USER;
  },
  async audit() {},
} as never;

const store = new TinyStore();
const board = createBoardService(undefined, undefined);
let app: FastifyInstance;
let base = '';

before(async () => {
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    void reply.code(status).send({ error: { code: e.code ?? 'ERROR', message: e.message } });
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  await registerHardware(app, ctx, game as never, store, board);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  process.env.PUBLIC_ORIGIN = base;
});

after(async () => {
  await app.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(inbox: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, label: string, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await sleep(20);
  }
  throw new Error(`等待「${label}」超时，最近消息：${JSON.stringify(inbox.slice(-5)).slice(0, 800)}`);
}

function connect(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/hw/v1`, { headers: { authorization: `Bearer ${token}` } });
  const inbox: Array<Record<string, unknown>> = [];
  ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
  ws.on('error', () => undefined);
  return { ws, inbox };
}

const goodPins = [
  { pin: 4, mode: 'out', level: 1, edges: 6 },
  { pin: 5, mode: 'out', level: 1, edges: 1 },
  { pin: 6, mode: 'out', level: 1, edges: 1 },
  { pin: 7, mode: 'out', level: 0, edges: 0 },
];
const facts = (extra: Record<string, unknown> = {}) => ({ uptimeMs: 6000, boot: 'poweron', pins: goodPins, pwm: [], adc: [], keys: [], reports: [], errors: [], ...extra });

test('板端链路：设备收到题目帧，上证据后拿到逐项判定', async (t) => {
  let token = '';
  let deviceId = '';
  let inbox: Array<Record<string, unknown>> = [];
  let ws: WebSocket;

  await t.test('登记并绑定设备', async () => {
    const enrolled = await fetch(`${base}/api/hw/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: 'bbccddeeff001122', model: 'ESP32-S3-TFT', fw: '0.2.0', caps: CAPS }) });
    const payload = (await enrolled.json()) as { data: { deviceId: string; token: string; pairCode: string } };
    deviceId = payload.data.deviceId;
    token = payload.data.token;
    const opened = connect(token);
    ws = opened.ws;
    inbox = opened.inbox;
    await waitFor(inbox, (m) => (m.screen as { id?: string } | undefined)?.id === 'pair', '配对画面');
    const bound = await fetch(`${base}/api/hw/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': USER.id }, body: JSON.stringify({ code: payload.data.pairCode }) });
    assert.equal(bound.status, 200);
    await waitFor(inbox, (m) => m.t === 'ready', 'ready');
  });

  await t.test('开始板端关卡后下发 exam 与 probe', async () => {
    const view = await board.start(USER.id, 'board-b1-01');
    assert.equal(view.levelId, 'board-b1-01');
    assert.equal(view.currentProbeIndex, 0);
    const exam = await waitFor(inbox, (m) => m.t === 'exam', 'exam 帧');
    assert.equal((exam.exam as { levelId: string }).levelId, 'board-b1-01');
    const probe = await waitFor(inbox, (m) => m.t === 'probe', 'probe 帧');
    assert.equal((probe.probe as { id: string }).id, 'p-steady');
    const hud = inbox.filter((m) => m.t === 'hud').at(-1)!.screen as { title: string; km: Array<{ cmd?: string }> };
    assert.ok(hud.title.includes('三灯点名'), '屏幕标题应为关卡名');
    assert.equal(hud.km[0]?.cmd, 'hint', '板端固件不需要新按键语义，K1 是提示');
  });

  await t.test('提交合格证据 → 探针通过并推进', async () => {
    ws.send(JSON.stringify({ t: 'evidence', pid: 'p-steady', facts: facts() }));
    const result = await waitFor(inbox, (m) => m.t === 'probe-result', 'probe-result');
    const payload = result.result as { probeId: string; passed: boolean; checks: unknown[] };
    assert.equal(payload.probeId, 'p-steady');
    assert.equal(payload.passed, true);
    const next = await waitFor(inbox, (m) => m.t === 'probe' && (m.probe as { id: string }).id === 'p-blink', '下一项 probe');
    assert.equal((next.probe as { id: string }).id, 'p-blink');
  });

  await t.test('提交不合格证据 → 判负并给出反馈', async () => {
    ws.send(JSON.stringify({ t: 'evidence', pid: 'p-blink', facts: facts({ pins: goodPins.map((p) => (p.pin === 4 ? { ...p, edges: 0 } : p)) }) }));
    const result = await waitFor(inbox, (m) => m.t === 'probe-result' && (m.result as { probeId: string }).probeId === 'p-blink', '闪烁判定');
    const payload = result.result as { passed: boolean; feedback: string };
    assert.equal(payload.passed, false);
    assert.match(payload.feedback, /边沿/);
  });

  await t.test('改正后通过，关卡结束并上报得分', async () => {
    ws.send(JSON.stringify({ t: 'evidence', pid: 'p-blink', facts: facts() }));
    const result = await waitFor(inbox, (m) => m.t === 'probe-result' && (m.result as { passed: boolean }).passed === true, '通过');
    assert.equal((result.result as { passed: boolean }).passed, true);
    const toast = await waitFor(inbox, (m) => m.t === 'toast' && String(m.v).includes('板端关卡结束'), '结束提示');
    assert.match(String(toast.v), /得分 9[0-9][0-9]/);
    assert.equal(board.current(USER.id), null, '结束后不再占用屏幕');
    assert.ok(store.events.some((event) => event.startsWith('probe:')), '探针判定应写入审计事件');
    void deviceId;
  });

  await t.test('屏上答题：按 K2 选中 B 直接判定', async () => {
    await board.start(USER.id, 'board-b1-04');
    const hud = await waitFor(inbox, (m) => (m.screen as { title?: string } | undefined)?.title?.includes('高电平之谜') ?? false, '答题画面');
    const km = (hud.screen as { km: Array<{ pl?: { option?: string } }> }).km;
    assert.deepEqual(km.map((k) => k.pl?.option), ['A', 'B', 'C', 'D']);
    ws.send(JSON.stringify({ t: 'input', id: randomUUID(), ev: { t: 'key', k: 'K2' } }));
    const toast = await waitFor(inbox, (m) => m.t === 'toast' && String(m.v).includes('答对'), '答题反馈');
    assert.match(String(toast.v), /得分 1000/);
    assert.equal(board.current(USER.id), null);
  });
});
