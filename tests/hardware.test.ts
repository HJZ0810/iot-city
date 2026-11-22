import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { applyCommand, createState } from '../packages/engine/src/index.ts';
import { levelSchema, publicLevel, type GameCommand, type LevelDefinition, type SessionView, type UserView } from '../packages/shared/src/index.ts';
import type { HwCaps } from '../packages/shared/src/hardware.ts';
import { registerHardware } from '../services/api/src/hardware/index.ts';
import type { HardwareStore, HwDeviceRecord } from '../services/api/src/hardware/store.ts';
import { httpError } from '../services/api/src/errors.ts';

const USER: UserView = { id: 'user-1', username: 'stu1', nickname: '学生一', role: 'student', createdAt: '2026-10-21T00:00:00.000Z' };
const CAPS: HwCaps = { w: 320, h: 240, color: 'rgb565', touch: false, rotary: false, keys: ['K1', 'K2', 'K3', 'K4', 'K5'], lang: 'zh' };

const level: LevelDefinition = levelSchema.parse({
  id: 'level-hw-test', number: 1, chapter: 1, version: 1,
  title: '终端联调', subtitle: '验证硬件通道与引擎闭环',
  scene: 'lab', dimension: '2d', difficulty: 1, estimatedMinutes: 5,
  briefing: '城东实验台的温湿度传感器读数异常，请用终端确认设备状态并运行一次仿真，观察环境反馈后再判断。',
  ending: '终端验收通过，传感器数据已回到可信区间。',
  knowledge: ['传感器'],
  npc: { name: '值班工程师', role: '系统维护', lines: ['先看设备状态。', '再看仿真结果。'] },
  devices: [
    {
      id: 'sensor-1', kind: 'sensor', label: '温湿度传感器', model: 'DHT22', position: [0, 0, 0], installed: true, enabled: true,
      parameters: {
        metric: { label: '采集指标', type: 'select', value: 'temperature', options: ['temperature', 'humidity'] },
        offset: { label: '校准偏移', type: 'number', value: 0, min: -10, max: 10 },
      },
      faults: [], description: '采集环境温度并上传网关。',
    },
  ],
  links: [], environment: { temperature: 24 }, inventory: [],
  tasks: [
    { id: 't1', label: '确认传感器在线', description: '检查温湿度传感器当前状态。', knowledge: ['传感器'], requires: [], all: [{ source: 'inspected', target: 'sensor-1', op: 'exists' }], hint: '在终端上按检查键。', feedback: '传感器在线，可以继续。', points: 50 },
    { id: 't2', label: '运行一次仿真', description: '运行 1 秒仿真观察环境反馈。', knowledge: ['传感器'], requires: ['t1'], all: [{ source: 'ticks', op: 'gte', value: 1 }], hint: '在终端上按仿真键。', feedback: '仿真完成，数据已刷新。', points: 50 },
  ],
  rules: [], failures: [],
  explanation: '传感器读数需要先确认在线状态，再通过仿真观察环境变化，这是物联网排障的基本顺序。',
  references: [{ title: 'HCP/1 规范', url: 'https://iot.luo-jin-ai.com/docs/hardware' }],
  solution: [{ type: 'start' }, { type: 'inspect', target: 'sensor-1' }, { type: 'simulate', payload: { ticks: 1 } }],
  failureCase: [],
});

class MemoryStore implements HardwareStore {
  devices = new Map<string, HwDeviceRecord>();
  events: Array<{ kind: string; accepted: boolean; message: string }> = [];
  sessions: Array<{ deviceId: string; gameSessionId: string | null; closed: boolean }> = [];

  async create(input: { id: string; installationId: string; model: string; firmware: string; caps: HwCaps; tokenHash: string; pairCode: string; pairExpiresAt: string; name: string }) {
    const record: HwDeviceRecord = { id: input.id, installationId: input.installationId, model: input.model, firmware: input.firmware, tokenHash: input.tokenHash, pairCode: input.pairCode, pairExpiresAt: input.pairExpiresAt, userId: null, name: input.name, caps: input.caps, status: 'pending', lastSeenAt: null, lastIp: null, createdAt: new Date().toISOString() };
    this.devices.set(record.id, record);
    return record;
  }
  async findByInstallation(installationId: string) {
    return [...this.devices.values()].find((d) => d.installationId === installationId) ?? null;
  }
  async findById(id: string) {
    return this.devices.get(id) ?? null;
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.devices.values()].find((d) => d.tokenHash === tokenHash && d.status !== 'revoked') ?? null;
  }
  async findByPairCode(code: string) {
    return [...this.devices.values()].find((d) => d.pairCode === code && d.status === 'pending') ?? null;
  }
  async countBound(userId: string) {
    return [...this.devices.values()].filter((d) => d.userId === userId && d.status === 'bound').length;
  }
  async rebind(id: string, input: { model: string; firmware: string; caps: HwCaps; tokenHash: string; pairCode: string; pairExpiresAt: string }) {
    const current = this.devices.get(id);
    if (!current) return null;
    const keep = current.status === 'bound' && current.userId;
    const next: HwDeviceRecord = { ...current, model: input.model, firmware: input.firmware, caps: input.caps, tokenHash: input.tokenHash, ...(keep ? {} : { pairCode: input.pairCode, pairExpiresAt: input.pairExpiresAt, status: 'pending' as const, userId: null }) };
    this.devices.set(id, next);
    return next;
  }
  async bind(id: string, userId: string, name: string) {
    const current = this.devices.get(id);
    if (!current || current.status !== 'pending') return null;
    const next: HwDeviceRecord = { ...current, userId, name, status: 'bound', pairCode: null, pairExpiresAt: null };
    this.devices.set(id, next);
    return next;
  }
  async revoke(id: string, replacementTokenHash: string) {
    const current = this.devices.get(id);
    if (current) this.devices.set(id, { ...current, status: 'revoked', tokenHash: replacementTokenHash, pairCode: null });
    await this.closeSessions(id);
  }
  async listByUser(userId: string) {
    return [...this.devices.values()].filter((d) => d.userId === userId && d.status === 'bound');
  }
  async touch(id: string, ip: string, firmware: string, caps: HwCaps) {
    const current = this.devices.get(id);
    if (current) this.devices.set(id, { ...current, firmware, caps, lastIp: ip, lastSeenAt: new Date().toISOString() });
  }
  async expireStale() {
    return 0;
  }
  async recordEvent(input: { kind: string; accepted: boolean; message: string }) {
    this.events.push({ kind: input.kind, accepted: input.accepted, message: input.message });
  }
  async openSession(input: { deviceId: string; gameSessionId: string | null }) {
    this.sessions.push({ deviceId: input.deviceId, gameSessionId: input.gameSessionId, closed: false });
  }
  async closeSessions(deviceId: string) {
    for (const s of this.sessions) if (s.deviceId === deviceId) s.closed = true;
  }
}

/* ---------------------- 内存版会话与引擎适配器 ---------------------- */

const sessionRow = {
  id: 'sess-1', user_id: USER.id, mode: 'story' as const, level_id: level.id, level_version: level.version, seed: 42,
  state: createState(level, 42), initial_state: createState(level, 42), revision: 0, status: 'briefing',
  preview: 0, elapsed_ms: 0, last_active_at: new Date().toISOString(), root_id: null, round: 1,
};

const db = {
  async query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (sql.includes('FROM users')) return [{ id: USER.id, username: USER.username, nickname: USER.nickname, role: USER.role, created_at: USER.createdAt }] as T[];
    if (sql.includes('FROM game_sessions')) {
      if (sql.includes('WHERE id=?')) return (values[0] === sessionRow.id && values[1] === USER.id ? [sessionRow] : []) as T[];
      return [sessionRow] as T[];
    }
    return [] as T[];
  },
  async execute() {
    return { affectedRows: 1 };
  },
  async transaction<T>(fn: (tx: typeof db) => Promise<T>) {
    return fn(db);
  },
};

const store = new MemoryStore();
let state = createState(level, 42);
const view = (): SessionView => ({ id: sessionRow.id, mode: sessionRow.mode, level: publicLevel(level), state, elapsedSeconds: Math.floor(sessionRow.elapsed_ms / 1000), updatedAt: new Date().toISOString() });
const game = {
  async owned(_user: UserView, id: string) {
    if (id !== sessionRow.id) throw httpError(404, 'SESSION_NOT_FOUND', '找不到你的游戏存档。');
    return sessionRow;
  },
  async view() {
    return view();
  },
  async executeCommand(_user: UserView, id: string, command: GameCommand) {
    if (id !== sessionRow.id) throw httpError(404, 'SESSION_NOT_FOUND', '找不到你的游戏存档。');
    const result = applyCommand(level, state, command);
    state = result.state;
    sessionRow.state = state;
    sessionRow.revision = state.revision;
    sessionRow.status = state.phase;
    return { session: view(), result, resultRecord: null };
  },
};

const ctx = {
  db,
  async requireUser(request: { headers: Record<string, unknown> }) {
    if (request.headers['x-test-user'] !== USER.id) throw httpError(401, 'AUTH_REQUIRED', '请先登录。');
    return USER;
  },
  async audit() {},
} as never;

let app: FastifyInstance;
let base = '';

before(async () => {
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const zod = error as { issues?: unknown[]; name?: string };
    if (Array.isArray(zod.issues)) {
      void reply.code(400).send({ error: { code: 'INVALID_INPUT', message: '输入不符合要求。', details: zod.issues } });
      return;
    }
    const e = error as Error & { statusCode?: number; code?: string; details?: unknown };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    void reply.code(status).send({ error: { code: status < 500 ? e.code ?? 'REQUEST_FAILED' : 'INTERNAL_ERROR', message: status < 500 ? e.message : '服务暂时不可用。', ...(e.details ? { details: e.details } : {}) } });
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 65536 } });
  await registerHardware(app, ctx, game as never, store);
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
const wsUrl = () => `${base.replace('http', 'ws')}/hw/v1`;

function connect(token: string) {
  const ws = new WebSocket(wsUrl(), { headers: { authorization: `Bearer ${token}` } });
  const inbox: Array<Record<string, unknown>> = [];
  const closed: number[] = [];
  ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
  ws.on('close', (code) => closed.push(code));
  ws.on('error', () => undefined);
  return { ws, inbox, closed };
}

async function waitFor(inbox: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, label: string, timeout = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await sleep(20);
  }
  throw new Error(`等待「${label}」超时，最近消息：${JSON.stringify(inbox.slice(-4))}`);
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'x-test-user': USER.id };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

test('HCP/1：登记 → 配对 → 绑定 → 操控 → 解绑 全链路', async (t) => {
  let token = '';
  let pairCode = '';
  let deviceId = '';
  const connection = { ws: null as unknown as WebSocket, inbox: [] as Array<Record<string, unknown>>, closed: [] as number[] };

  await t.test('设备首次登记返回一次性令牌与配对码', async () => {
    const response = await fetch(`${base}/api/hw/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: 'a1b2c3d4e5f60718', model: 'ESP32-S3-TFT', fw: '0.1.0', caps: CAPS }) });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { data: { deviceId: string; token: string; pairCode: string; wsUrl: string; heartbeatSeconds: number } };
    deviceId = payload.data.deviceId;
    token = payload.data.token;
    pairCode = payload.data.pairCode;
    assert.match(pairCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(payload.data.token.length >= 40, '令牌应为 32 字节随机值');
    assert.equal(payload.data.wsUrl, `${base.replace('http', 'ws')}/hw/v1`);
    assert.equal(payload.data.heartbeatSeconds, 20);
  });

  await t.test('未绑定设备连上后只能看到配对画面', async () => {
    const opened = connect(token);
    connection.ws = opened.ws;
    connection.inbox = opened.inbox;
    connection.closed = opened.closed;
    const hud = await waitFor(opened.inbox, (m) => m.t === 'hud', '配对画面');
    const screen = hud.screen as { id: string; widgets: Array<{ t: string; v?: string }> };
    assert.equal(screen.id, 'pair');
    assert.equal(screen.widgets[0]?.v, pairCode, '屏幕应显示配对码');
  });

  await t.test('非法令牌被拒绝', async () => {
    const opened = connect('not-a-real-token');
    const started = Date.now();
    while (!opened.closed.length && Date.now() - started < 3000) await sleep(20);
    assert.deepEqual(opened.closed, [1008]);
  });

  await t.test('网页输入配对码完成绑定，设备收到 ready', async () => {
    const bound = await api('POST', '/api/hw/bind', { code: pairCode, name: '实验台一号' });
    assert.equal(bound.status, 200);
    assert.equal((bound.json.data as { status: string }).status, 'bound');
    const ready = await waitFor(connection.inbox, (m) => m.t === 'ready', 'ready 帧');
    assert.deepEqual((ready.scopes as string[]).slice().sort(), ['game:input', 'hil:sensor', 'hud:read', 'sim:step']);
  });

  await t.test('设备在线状态与列表接口一致', async () => {
    const list = await api('GET', '/api/hw/devices');
    assert.equal(list.status, 200);
    const devices = list.json.data as Array<{ id: string; online: boolean; status: string; name: string }>;
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.id, deviceId);
    assert.equal(devices[0]!.online, true);
    assert.equal(devices[0]!.name, '实验台一号');
  });

  await t.test('挂载会话后下发简报画面，按键映射由服务器给出', async () => {
    const attached = await api('POST', `/api/hw/devices/${deviceId}/attach`, { sessionId: sessionRow.id });
    assert.equal(attached.status, 200);
    const hud = await waitFor(connection.inbox, (m) => (m.screen as { id?: string } | undefined)?.id === 'briefing', '简报画面');
    const screen = hud.screen as { widgets: Array<{ t: string }>; km: Array<{ k: string; cmd?: string }> };
    assert.ok(screen.widgets.some((w) => w.t === 'text'), '简报应包含正文');
    assert.equal(screen.km[0]?.cmd, 'start');
  });

  await t.test('按 K1 开始任务，引擎状态推进到 running', async () => {
    connection.ws.send(JSON.stringify({ t: 'input', id: randomUUID(), ev: { t: 'key', k: 'K1' } }));
    await waitFor(connection.inbox, (m) => (m.screen as { id?: string } | undefined)?.id === 'console', '控制台画面');
    assert.equal(state.phase, 'running');
    const screen = (connection.inbox.filter((m) => m.screen).at(-1)!.screen as { km: Array<{ k: string; cmd?: string; tg?: string }> });
    assert.deepEqual(screen.km.map((k) => k.k), ['K1', 'K2', 'K3', 'K4', 'K5']);
    assert.equal(screen.km[0]!.cmd, 'inspect');
    assert.equal(screen.km[0]!.tg, 'sensor-1');
  });

  await t.test('按 K1 检查设备，第一个任务自动完成', async () => {
    connection.ws.send(JSON.stringify({ t: 'input', id: randomUUID(), ev: { t: 'key', k: 'K1' } }));
    const started = Date.now();
    while (!state.completedTasks.includes('t1') && Date.now() - started < 3000) await sleep(20);
    assert.ok(state.completedTasks.includes('t1'), '检查任务应完成');
    assert.ok(state.inspected.includes('sensor-1'));
    const screen = (connection.inbox.filter((m) => m.screen).at(-1)!.screen as { widgets: Array<{ t: string; label?: string; items?: Array<{ st?: string }> }> });
    const list = screen.widgets.find((w) => w.t === 'list');
    assert.ok(list?.items?.some((i) => i.st === 'done'), '任务列表应标出已完成项');
  });

  await t.test('重复输入编号被幂等忽略', async () => {
    const before = store.events.length;
    const id = randomUUID();
    connection.ws.send(JSON.stringify({ t: 'input', id, ev: { t: 'key', k: 'K3' } }));
    await waitFor(connection.inbox, (m) => (m.screen as { widgets?: unknown } | undefined)?.widgets !== undefined, '仿真后画面');
    connection.ws.send(JSON.stringify({ t: 'input', id, ev: { t: 'key', k: 'K3' } }));
    await sleep(300);
    assert.equal(store.events.length, before + 1, '同一编号只应执行一次');
  });

  await t.test('未映射按键被拒绝', async () => {
    connection.ws.send(JSON.stringify({ t: 'input', id: randomUUID(), ev: { t: 'key', k: 'K6' } }));
    const error = await waitFor(connection.inbox, (m) => m.t === 'err' && m.code === 'UNKNOWN_KEY', '未知按键错误');
    assert.match(String(error.msg), /没有绑定动作/);
  });

  await t.test('突发输入触发限流', async () => {
    await sleep(1100);
    for (let i = 0; i < 16; i++) connection.ws.send(JSON.stringify({ t: 'input', id: randomUUID(), ev: { t: 'key', k: 'K2' } }));
    const error = await waitFor(connection.inbox, (m) => m.t === 'err' && m.code === 'RATE_LIMIT', '限流错误');
    assert.match(String(error.msg), /频繁/);
    await sleep(1100);
  });

  await t.test('剧情模式拒绝硬件在环数据', async () => {
    connection.ws.send(JSON.stringify({ t: 'sensor', m: 'temperature', v: 23.4 }));
    await waitFor(connection.inbox, (m) => m.t === 'err' && m.code === 'SENSOR_REJECTED', '在环数据拒绝');
  });

  await t.test('心跳与画面确认保持连接可用', async () => {
    connection.ws.send(JSON.stringify({ t: 'ping', ts: 1 }));
    const pong = await waitFor(connection.inbox, (m) => m.t === 'pong', 'pong');
    assert.equal(pong.ts, 1);
    const screen = connection.inbox.filter((m) => m.screen).at(-1)!.screen as { rev: number };
    connection.ws.send(JSON.stringify({ t: 'ack', rev: screen.rev }));
    await sleep(120);
    assert.equal(connection.closed.length, 0);
  });

  await t.test('解绑后旧令牌立即失效', async () => {
    const revoked = await api('DELETE', `/api/hw/devices/${deviceId}`);
    assert.equal(revoked.status, 200);
    const started = Date.now();
    while (!connection.closed.length && Date.now() - started < 3000) await sleep(20);
    assert.ok(connection.closed.length > 0, '在途连接应被关闭');
    const replug = connect(token);
    const begun = Date.now();
    while (!replug.closed.length && Date.now() - begun < 3000) await sleep(20);
    assert.deepEqual(replug.closed, [1008]);
  });

  await t.test('重新烧录的同一硬件可以再次登记', async () => {
    const response = await fetch(`${base}/api/hw/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: 'a1b2c3d4e5f60718', model: 'ESP32-S3-TFT', fw: '0.1.1', caps: CAPS }) });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { data: { deviceId: string; token: string; pairCode: string } };
    assert.equal(payload.data.deviceId, deviceId, '同一 installationId 应复用设备记录');
    assert.notEqual(payload.data.token, token, '重新登记必须轮换令牌');
    assert.match(payload.data.pairCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

test('HCP/1：批量烧录密钥与能力校验', async (t) => {
  await t.test('未配置密钥时不拦截普通登记', async () => {
    const response = await fetch(`${base}/api/hw/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: 'ffffffffffffffff', model: 'ESP32-S3-TFT', fw: '0.1.1', caps: CAPS }) });
    assert.equal(response.status, 200);
  });

  await t.test('能力声明不合法时拒绝登记', async () => {
    const response = await fetch(`${base}/api/hw/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId: 'eeeeeeeeeeeeeeee', model: 'ESP32-S3-TFT', fw: '0.1.1', caps: { ...CAPS, w: 10 } }) });
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { code: string } };
    assert.equal(payload.error.code, 'INVALID_INPUT');
  });
});
