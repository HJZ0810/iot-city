import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type {} from '@fastify/websocket';
import { z } from 'zod';
import {
  HCP_VERSION,
  HW_MAX_DEVICES_PER_USER,
  HW_PAIR_ALPHABET,
  HW_PAIR_CODE_TTL_MS,
  HW_UNBOUND_TTL_MS,
  formatPairCode,
  hcpFrameBytes,
  hcpLimits,
  hardwareCommandTypes,
  hwAttachRequestSchema,
  hwBindRequestSchema,
  hwClientMessageSchema,
  hwEnrollRequestSchema,
  normalizePairCode,
  type HwCaps,
  type HwDeviceView,
  type HwErrorCode,
  type HwKeyId,
  type HwScope,
  type HwServerMessage,
  type HudKey,
} from '../../../../packages/shared/src/index.ts';
import type { GameCommand, Role, SessionView, UserView } from '../../../../packages/shared/src/index.ts';
import type { AppContext } from '../context.ts';
import type { createGame } from '../game.ts';
import { iso } from '../db.ts';
import { httpError } from '../errors.ts';
import { buildHud, systemScreen } from './hud.ts';
import type { BoardService } from '../board/index.ts';
import { createSqlHardwareStore, type HardwareStore, type HwDeviceRecord } from './store.ts';

type GameApi = ReturnType<typeof createGame>;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const apiScopes: HwScope[] = ['hud:read', 'game:input', 'sim:step', 'hil:sensor'];
/** 未绑定设备只能收画面，不能操作游戏；绑定后才拿到操控与仿真权限。 */
const scopesFor = (bound: boolean): HwScope[] => (bound ? apiScopes : ['hud:read']);

interface HwConn {
  socket: WebSocket;
  deviceId: string;
  device: HwDeviceRecord;
  user: UserView | null;
  caps: HwCaps;
  keys: HwKeyId[];
  keymap: HudKey[];
  focusIndex: number;
  screenRev: number;
  lastSignature: string;
  lastPushAt: number;
  lastSeenAt: number;
  sessionId: string | null;
  queue: Promise<void>;
  bucket: { secondStart: number; second: number; minuteStart: number; minute: number };
  seen: Set<string>;
  sensorAt: number;
  hudAckedAt: number;
  /** 板端关卡：学生代码主动上报的读数，随下一条证据一起提交 */
  reports: Array<{ k: string; v: number; ts: number }>;
  lastProbeId: string | null;
  lastExamId: string | null;
}

const screenSignature = (screen: { id: string; title: string; subtitle?: string; widgets: unknown; km: unknown; focus?: string; elapsed: number; score: number }) =>
  JSON.stringify([screen.id, screen.title, screen.subtitle ?? '', screen.widgets, screen.km, screen.focus ?? '', screen.elapsed, screen.score]);

export async function registerHardware(app: FastifyInstance, ctx: AppContext, game: GameApi, storeOverride?: HardwareStore, boardService?: BoardService) {
  const store = storeOverride ?? createSqlHardwareStore(ctx.db);
  const connections = new Map<string, HwConn>();

  function send(conn: HwConn, message: HwServerMessage) {
    if (conn.socket.readyState !== 1) return;
    const frame = JSON.stringify(message);
    if (Buffer.byteLength(frame, 'utf8') > hcpLimits.frameBytes) {
      conn.socket.send(JSON.stringify({ t: 'err', code: 'FRAME_TOO_LARGE', msg: '画面内容超出单帧上限。' } satisfies HwServerMessage));
      return;
    }
    conn.socket.send(frame);
  }
  const fail = (conn: HwConn, code: HwErrorCode, msg: string) => send(conn, { t: 'err', code, msg });

  async function loadUser(id: string): Promise<UserView> {
    const rows = await ctx.db.query<{ id: string; username: string; nickname: string; role: Role; created_at: string }>('SELECT id,username,nickname,role,created_at FROM users WHERE id=? AND disabled=0', [id]);
    const row = rows[0];
    if (!row) throw httpError(401, 'USER_UNAVAILABLE', '账号不可用。');
    return { id: row.id, username: row.username, nickname: row.nickname, role: row.role, createdAt: iso(row.created_at) };
  }

  /** 硬件只能驱动「自己的、进行中的」会话；房间会话由实时服务独占，不在此处接管。 */
  async function resolveSession(conn: HwConn): Promise<SessionView | null> {
    if (!conn.user) return null;
    const user = conn.user;
    if (conn.sessionId) {
      const rows = await ctx.db.query<Record<string, unknown>>('SELECT * FROM game_sessions WHERE id=? AND user_id=?', [conn.sessionId, user.id]);
      const row = rows[0];
      // 已完成/失败的会话仍允许回看结算画面，但引擎会拒绝继续操作。
      if (row && ['briefing', 'running', 'paused', 'completed', 'failed'].includes(String(row.status)) && !['coop', 'pvp'].includes(String(row.mode))) return game.view(row as never);
      conn.sessionId = null;
    }
    const rows = await ctx.db.query<Record<string, unknown>>("SELECT * FROM game_sessions WHERE user_id=? AND status IN('briefing','running','paused') AND mode NOT IN('coop','pvp') ORDER BY last_active_at DESC LIMIT 1", [user.id]);
    const row = rows[0];
    if (!row) return null;
    conn.sessionId = String(row.id);
    return game.view(row as never);
  }

  async function pushHud(conn: HwConn, force = false) {
    if (!conn.user) {
      send(conn, { t: 'hud', screen: systemScreen('pair', conn.screenRev, { ...(conn.device.pairCode ? { pairCode: formatPairCode(conn.device.pairCode) } : {}), pairExpiresIn: HW_PAIR_CODE_TTL_MS / 1000 }) });
      return;
    }
    // 板端关卡优先：有进行中的板端关卡时，屏幕显示题目与验收进度，而不是剧情操控台
    if (boardService) {
      await boardService.ensureLoaded(conn.user.id);
      const active = boardService.current(conn.user.id);
      const boardScreen = boardService.screenOf(conn.user.id);
      if (active && boardScreen) {
        if (active.run.sessionId !== conn.lastExamId) {
          conn.lastExamId = active.run.sessionId;
          conn.lastProbeId = null;
          send(conn, {
            t: 'exam',
            exam: {
              sessionId: active.run.sessionId,
              levelId: active.level.id,
              title: active.level.title,
              kind: active.level.kind,
              objective: active.level.objective,
              probes: active.level.probes.map((probe) => ({ id: probe.id, title: probe.title, description: probe.description })),
              currentProbeIndex: active.run.currentProbeIndex,
              status: 'running',
            },
          });
        }
        const probe = active.level.probes[active.run.currentProbeIndex];
        if (probe && conn.lastProbeId !== probe.id) {
          conn.lastProbeId = probe.id;
          send(conn, { t: 'probe', probe: { id: probe.id, title: probe.title, description: probe.description, windowMs: probe.windowMs }, index: active.run.currentProbeIndex + 1, total: active.level.probes.length });
        }
        const signature = screenSignature(boardScreen);
        if (force || signature !== conn.lastSignature) {
          conn.screenRev++;
          boardScreen.rev = conn.screenRev;
          conn.lastSignature = signature;
          conn.keymap = boardScreen.km;
          send(conn, { t: 'hud', screen: boardScreen });
          conn.lastPushAt = Date.now();
        }
        return;
      }
      conn.lastExamId = null;
      conn.lastProbeId = null;
    }
    const session = await resolveSession(conn);
    if (!session) {
      const signature = `idle:${conn.deviceId}`;
      if (force || signature !== conn.lastSignature) {
        conn.screenRev++;
        conn.lastSignature = signature;
        conn.keymap = [];
        send(conn, { t: 'hud', screen: systemScreen('idle', conn.screenRev, { message: `${conn.user.nickname}，在网页选择关卡后本屏接管操作面板。` }) });
      }
      return;
    }
    const built = buildHud({ session, focusIndex: conn.focusIndex, keys: conn.keys });
    conn.focusIndex = built.focusIndex;
    const screen = built.screen;
    const signature = screenSignature(screen);
    if (!force && signature === conn.lastSignature) return;
    conn.screenRev++;
    screen.rev = conn.screenRev;
    conn.lastSignature = signature;
    conn.keymap = screen.km;
    send(conn, { t: 'hud', screen });
    conn.lastPushAt = Date.now();
  }

  const enqueue = (conn: HwConn, task: () => Promise<void>) => {
    conn.queue = conn.queue.then(task).catch((error: unknown) => {
      app.log.error({ deviceId: conn.deviceId, err: error }, 'hardware task failed');
      fail(conn, 'COMMAND_REJECTED', '服务器处理这次操作时出错，请重试。');
    });
  };

  function allowInput(conn: HwConn): boolean {
    const now = Date.now();
    if (now - conn.bucket.secondStart >= 1000) {
      conn.bucket.secondStart = now;
      conn.bucket.second = 0;
    }
    if (now - conn.bucket.minuteStart >= 60_000) {
      conn.bucket.minuteStart = now;
      conn.bucket.minute = 0;
    }
    if (conn.bucket.second >= hcpLimits.inputsPerSecond || conn.bucket.minute >= hcpLimits.inputsPerMinute) return false;
    conn.bucket.second++;
    conn.bucket.minute++;
    return true;
  }

  function remember(conn: HwConn, id: string): boolean {
    if (conn.seen.has(id)) return false;
    conn.seen.add(id);
    if (conn.seen.size > hcpLimits.inputIdMemo) conn.seen.delete(conn.seen.values().next().value as string);
    return true;
  }

  async function applyNav(conn: HwConn, nav: HudKey['nav'], session: SessionView) {
    const total = session.level.devices.length;
    if (nav === 'focus-next' && total) conn.focusIndex = (conn.focusIndex + 1) % total;
    else if (nav === 'focus-prev' && total) conn.focusIndex = (conn.focusIndex - 1 + total) % total;
    await pushHud(conn, true);
  }

  async function onInput(conn: HwConn, id: string, ev: { t: 'key'; k: HwKeyId; a: 'press' | 'long' | 'repeat' } | { t: 'touch'; x: number; y: number } | { t: 'rot'; d: number }) {
    if (!conn.user) return fail(conn, 'NOT_BOUND', '设备尚未绑定账号。');
    if (!allowInput(conn)) return fail(conn, 'RATE_LIMIT', '操作过于频繁，请稍候。');
    if (!remember(conn, id)) return; // 重复输入直接忽略，真正的幂等由命令层保证

    // 板端关卡占用按键语义：answer 走答题、hint 走提示，不进入游戏命令通道
    if (boardService && conn.user && boardService.current(conn.user.id)) {
      if (ev.t === 'touch' || ev.t === 'rot') {
        await pushHud(conn, true);
        return;
      }
      const boardEntry = conn.keymap.find((k) => k.k === ev.k);
      if (boardEntry && (await onBoardKey(conn, boardEntry))) return;
      if (!boardEntry) return fail(conn, 'UNKNOWN_KEY', `按键 ${ev.k} 在当前画面没有绑定动作。`);
    }

    const session = await resolveSession(conn);
    if (!session) return fail(conn, 'NO_SESSION', '当前没有可操控的任务，请在网页开始一关。');

    if (ev.t === 'touch') return applyNav(conn, 'refresh', session);
    const key = ev.t === 'key' ? ev.k : null;
    if (ev.t === 'rot') {
      const total = session.level.devices.length;
      if (total) conn.focusIndex = (conn.focusIndex + (ev.d > 0 ? 1 : -1) + total) % total;
      return pushHud(conn, true);
    }
    const entry = conn.keymap.find((k) => k.k === key);
    if (!entry) return fail(conn, 'UNKNOWN_KEY', `按键 ${String(key)} 在当前画面没有绑定动作。`);
    if (entry.nav) return applyNav(conn, entry.nav, session);
    if (!entry.cmd || !(hardwareCommandTypes as readonly string[]).includes(entry.cmd)) return fail(conn, 'COMMAND_REJECTED', '该按键动作不在硬件允许的命令范围内。');
    const scopes = scopesFor(Boolean(conn.user) && conn.device.status === 'bound');
    if (!scopes.includes('game:input')) return fail(conn, 'NOT_BOUND', '设备尚未绑定账号，不能操作游戏。');
    if (entry.cmd === 'simulate' && !scopes.includes('sim:step')) return fail(conn, 'COMMAND_REJECTED', '设备没有仿真步进的权限。');

    const command: GameCommand = {
      id,
      revision: session.state.revision,
      type: entry.cmd,
      ...(entry.tg ? { target: entry.tg } : {}),
      payload: (entry.pl ?? {}) as Record<string, unknown>,
    };
    try {
      const result = await game.executeCommand(conn.user, session.id, command);
      await store.recordEvent({ id: randomUUID(), deviceId: conn.deviceId, kind: 'input', payload: { key, command }, accepted: result.result.accepted, message: result.result.message });
      if (!result.result.accepted) send(conn, { t: 'toast', level: 'warn', v: result.result.message });
      await pushHud(conn, true);
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; message?: string; details?: { session?: SessionView } };
      await store.recordEvent({ id: randomUUID(), deviceId: conn.deviceId, kind: 'input', payload: { key, command }, accepted: false, message: e.message ?? '命令失败' });
      fail(conn, e.code === 'REVISION_CONFLICT' ? 'COMMAND_REJECTED' : 'COMMAND_REJECTED', e.statusCode ? e.message ?? '服务器拒绝了这次操作。' : '服务器拒绝了这次操作。');
      await pushHud(conn, true);
    }
  }

  async function onSensor(conn: HwConn, metric: string, value: number) {
    if (!conn.user) return fail(conn, 'NOT_BOUND', '设备尚未绑定账号。');
    if (Date.now() - conn.sensorAt < hcpLimits.sensorIntervalMs) return fail(conn, 'RATE_LIMIT', '传感器上报过于频繁。');
    const session = await resolveSession(conn);
    if (!session) return fail(conn, 'NO_SESSION', '当前没有可对照的虚拟任务。');
    // v1：硬件读数只作观测对照，不回灌仿真环境，避免绕过引擎与破坏确定性计分。
    if (session.mode !== 'sandbox' || session.state.flags.includes('standard-sandbox')) return fail(conn, 'SENSOR_REJECTED', '硬件在环数据仅在自由沙盒（非标准挑战）中接受。');
    conn.sensorAt = Date.now();
    await store.recordEvent({ id: randomUUID(), deviceId: conn.deviceId, kind: 'sensor', payload: { metric, value, sessionId: session.id }, accepted: true, message: `硬件读数 ${metric}=${value}` });
    send(conn, { t: 'toast', level: 'info', v: `已记录真实读数 ${metric}=${value}` });
  }

  async function onEvidence(conn: HwConn, pid: string, facts: Record<string, unknown>) {
    if (!conn.user) return fail(conn, 'NOT_BOUND', '设备尚未绑定账号。');
    if (!boardService) return fail(conn, 'EVIDENCE_REJECTED', '服务器未启用板端关卡。');
    // 学生代码主动上报的读数合并进证据，由判题器按交叉源核对
    const merged = { ...facts, reports: [...((facts.reports as Array<{ k: string; v: number; ts: number }> | undefined) ?? []), ...conn.reports].slice(-32) };
    conn.reports = [];
    const outcome = await boardService.evidence(conn.user.id, pid, merged as never);
    if (!outcome.ok) return fail(conn, outcome.error === 'PROBE_MISMATCH' ? 'PROBE_MISMATCH' : 'EXAM_NOT_ACTIVE', outcome.error === 'PROBE_MISMATCH' ? '提交的考察项与当前进度不一致。' : '当前没有进行中的板端关卡。');
    if (outcome.result) {
      send(conn, { t: 'probe-result', result: outcome.result });
      await store.recordEvent({ id: randomUUID(), deviceId: conn.deviceId, kind: 'probe', payload: { pid, passed: outcome.result.passed }, accepted: outcome.result.passed, message: outcome.result.feedback.slice(0, 280) });
    }
    await pushHud(conn, true);
    if (outcome.finished && outcome.view) send(conn, { t: 'toast', level: outcome.view.status === 'passed' ? 'info' : 'warn', v: `板端关卡结束，得分 ${outcome.view.score}` });
  }

  async function onReport(conn: HwConn, key: string, value: number) {
    conn.reports.push({ k: key, v: value, ts: Date.now() });
    if (conn.reports.length > 32) conn.reports = conn.reports.slice(-32);
  }

  async function onBoardKey(conn: HwConn, entry: HudKey) {
    if (!conn.user || !boardService) return false;
    const active = boardService.current(conn.user.id);
    if (!active) return false;
    if (entry.cmd === 'answer') {
      const option = String(entry.pl?.option ?? '');
      try {
        const view = await boardService.answer(conn.user.id, option);
        const quiz = active.level.screenQuiz;
        const correct = quiz ? quiz.answer === option : false;
        send(conn, { t: 'toast', level: correct ? 'info' : 'warn', v: correct ? `答对了，得分 ${view.score}` : '答案不对，请看屏幕解析' });
      } catch (error) {
        fail(conn, 'EXAM_NOT_ACTIVE', (error as Error).message || '这一关已经结束。');
      }
      await pushHud(conn, true);
      return true;
    }
    if (entry.cmd === 'hint') {
      try {
        const view = await boardService.hint(conn.user.id);
        const text = active.level.hints[Math.min(view.hintsUsed - 1, active.level.hints.length - 1)] ?? active.level.hints[0] ?? '先看题目要求。';
        send(conn, { t: 'toast', level: 'info', v: text });
      } catch {
        fail(conn, 'EXAM_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      }
      await pushHud(conn, true);
      return true;
    }
    if (entry.nav) {
      await pushHud(conn, true);
      return true;
    }
    return false;
  }

  async function onFrame(conn: HwConn, raw: string) {
    conn.lastSeenAt = Date.now();
    if (Buffer.byteLength(raw, 'utf8') > hcpLimits.frameBytes) return fail(conn, 'FRAME_TOO_LARGE', '帧超出大小上限。');
    let message;
    try {
      message = hwClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      return fail(conn, 'BAD_FRAME', '帧格式不符合 HCP/1 规范。');
    }
    if (message.t === 'ping') return send(conn, { t: 'pong', ts: message.ts ?? 0, serverTime: Date.now() });
    if (message.t === 'ack') {
      conn.hudAckedAt = Date.now();
      return;
    }
    if (message.t === 'bye') {
      conn.socket.close(1000, 'device bye');
      return;
    }
    if (message.t === 'hello') {
      conn.caps = message.caps;
      conn.keys = message.caps.keys;
      conn.keymap = [];
      await store.touch(conn.deviceId, String(conn.device.lastIp ?? ''), message.fw, message.caps);
      conn.device.firmware = message.fw;
      send(conn, {
        t: 'hello',
        v: HCP_VERSION,
        dev: { id: conn.deviceId, name: conn.device.name, status: conn.device.status === 'bound' ? 'bound' : 'pending' },
        ...(conn.device.pairCode ? { pair: { code: formatPairCode(conn.device.pairCode), expiresIn: Math.max(0, Math.floor((Date.parse(conn.device.pairExpiresAt ?? new Date().toISOString()) - Date.now()) / 1000)) } } : {}),
        scopes: scopesFor(Boolean(conn.user) && conn.device.status === 'bound'),
        ts: Date.now(),
      });
      await pushHud(conn, true);
      return;
    }
    if (message.t === 'sensor') return onSensor(conn, message.m, message.v);
    if (message.t === 'evidence') return onEvidence(conn, message.pid, message.facts as unknown as Record<string, unknown>);
    if (message.t === 'report') return onReport(conn, message.k, message.v);
    return onInput(conn, message.id, message.ev);
  }

  function broadcastToUser(userId: string, message: HwServerMessage) {
    for (const conn of connections.values()) if (conn.user?.id === userId) send(conn, message);
  }

  /* ------------------------------ REST ------------------------------ */

  const wsUrlFor = () => {
    const origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3220}`;
    return `${origin.replace(/^http/, 'ws')}/hw/v1`;
  };

  const newPairCode = async (): Promise<string> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let code = '';
      const bytes = randomBytes(8);
      for (let i = 0; i < 8; i++) code += HW_PAIR_ALPHABET[bytes[i]! % HW_PAIR_ALPHABET.length];
      if (!(await store.findByPairCode(code))) return code;
    }
    throw httpError(503, 'PAIR_CODE_EXHAUSTED', '配对码生成失败，请稍后重试。');
  };

  const viewOf = (device: HwDeviceRecord): HwDeviceView => ({
    id: device.id,
    name: device.name,
    model: device.model,
    firmware: device.firmware,
    status: device.status,
    online: connections.has(device.id),
    caps: device.caps,
    ...(device.pairCode ? { pairCode: formatPairCode(device.pairCode), pairExpiresAt: device.pairExpiresAt } : {}),
    lastSeenAt: device.lastSeenAt,
    attachedSessionId: connections.get(device.id)?.sessionId ?? null,
    createdAt: device.createdAt,
  });

  app.post('/api/hw/enroll', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const provisionKey = process.env.HW_ENROLL_KEY;
    if (provisionKey) {
      const provided = String(req.headers['x-provision-key'] ?? '');
      const a = Buffer.from(provided);
      const b = Buffer.from(provisionKey);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpError(401, 'ENROLL_FORBIDDEN', '缺少或错误的批量烧录密钥。');
    }
    const body = hwEnrollRequestSchema.parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const existing = await store.findByInstallation(body.installationId);
    const pairCode = await newPairCode();
    const pairExpiresAt = new Date(Date.now() + HW_PAIR_CODE_TTL_MS).toISOString();
    let device: HwDeviceRecord;
    if (existing) {
      device = (await store.rebind(existing.id, { model: body.model, firmware: body.fw, caps: body.caps, tokenHash, pairCode, pairExpiresAt })) ?? existing;
    } else {
      device = await store.create({ id: randomUUID(), installationId: body.installationId, model: body.model, firmware: body.fw, caps: body.caps, tokenHash, pairCode, pairExpiresAt, name: `${body.model}-${body.installationId.slice(-4)}` });
    }
    app.log.info({ deviceId: device.id }, 'hardware device enrolled');
    return { data: { deviceId: device.id, token, pairCode: device.pairCode ? formatPairCode(device.pairCode) : '', pairExpiresAt: device.pairExpiresAt ?? pairExpiresAt, wsUrl: wsUrlFor(), heartbeatSeconds: hcpLimits.heartbeatSeconds } };
  });

  app.get('/api/hw/devices', async (req) => {
    const user = await ctx.requireUser(req);
    return { data: (await store.listByUser(user.id)).map(viewOf) };
  });

  app.post('/api/hw/bind', async (req) => {
    const user = await ctx.requireUser(req);
    const body = hwBindRequestSchema.parse(req.body);
    const code = normalizePairCode(body.code);
    const device = await store.findByPairCode(code);
    if (!device) throw httpError(404, 'PAIR_CODE_INVALID', '配对码无效或已被使用。');
    if (!device.pairExpiresAt || Date.parse(device.pairExpiresAt) < Date.now()) throw httpError(410, 'PAIR_EXPIRED', '配对码已过期，请让设备重新生成。');
    if ((await store.countBound(user.id)) >= HW_MAX_DEVICES_PER_USER) throw httpError(409, 'DEVICE_LIMIT', `每个账号最多绑定 ${HW_MAX_DEVICES_PER_USER} 台终端。`);
    const bound = await store.bind(device.id, user.id, body.name ?? device.name);
    if (!bound) throw httpError(409, 'PAIR_CODE_INVALID', '配对码已被其他账号使用。');
    await ctx.audit(user.id, 'hw.bind', device.id, { model: device.model });
    const conn = connections.get(device.id);
    if (conn) {
      conn.user = user;
      conn.device = bound;
      conn.screenRev++;
      send(conn, { t: 'ready', dev: { id: bound.id, name: bound.name }, scopes: scopesFor(true) });
      await pushHud(conn, true);
    }
    return { data: viewOf(bound) };
  });

  // DELETE 与 POST .../revoke 等价：浏览器端统一带 JSON content-type 时用后者，
  // 因为空 body 的 DELETE 在 Fastify 默认解析器下会被判为非法 JSON。
  const revokeDevice = async (req: FastifyRequest) => {
    const user = await ctx.requireUser(req);
    const id = z.object({ id: z.string().max(80) }).parse(req.params).id;
    const device = await store.findById(id);
    if (!device) throw httpError(404, 'DEVICE_NOT_FOUND', '终端不存在。');
    if (device.userId !== user.id && user.role !== 'admin') throw httpError(403, 'FORBIDDEN', '只能解绑自己的终端。');
    // 解绑等同于吊销：轮换令牌使所有在途连接立即失效。
    await store.revoke(id, sha256(randomBytes(32).toString('base64url')));
    await ctx.audit(user.id, 'hw.revoke', id, {});
    const conn = connections.get(id);
    if (conn) {
      send(conn, { t: 'bye', reason: '设备已被解绑' });
      conn.socket.close(1008, 'revoked');
      connections.delete(id);
    }
    return { data: { ok: true } };
  };
  app.delete('/api/hw/devices/:id', revokeDevice);
  app.post('/api/hw/devices/:id/revoke', revokeDevice);

  app.post('/api/hw/devices/:id/attach', async (req) => {
    const user = await ctx.requireUser(req);
    const id = z.object({ id: z.string().max(80) }).parse(req.params).id;
    const body = hwAttachRequestSchema.parse(req.body);
    const device = await store.findById(id);
    if (!device || device.userId !== user.id) throw httpError(404, 'DEVICE_NOT_FOUND', '终端不存在。');
    if (body.sessionId) {
      const row = await game.owned(user, body.sessionId);
      if (row.mode === 'coop' || row.mode === 'pvp') throw httpError(400, 'ROOM_SESSION_NOT_SUPPORTED', '联机房间请用浏览器或联机面板操作。');
      await store.closeSessions(id);
      await store.openSession({ id: randomUUID(), deviceId: id, userId: user.id, gameSessionId: body.sessionId });
    } else {
      await store.closeSessions(id);
    }
    const conn = connections.get(id);
    if (conn) {
      conn.sessionId = body.sessionId;
      conn.focusIndex = 0;
      await pushHud(conn, true);
    }
    return { data: { ok: true, attachedSessionId: body.sessionId } };
  });

  app.get('/api/hw/devices/:id/screen', async (req) => {
    const user = await ctx.requireUser(req);
    const id = z.object({ id: z.string().max(80) }).parse(req.params).id;
    const device = await store.findById(id);
    if (!device || (device.userId !== user.id && user.role !== 'admin')) throw httpError(404, 'DEVICE_NOT_FOUND', '终端不存在。');
    const conn = connections.get(id);
    const session = conn ? await resolveSession(conn) : null;
    if (!session) return { data: { screen: systemScreen(conn ? 'idle' : 'offline', 0, { message: '终端当前没有画面。' }) } };
    return { data: { screen: buildHud({ session, focusIndex: conn?.focusIndex ?? 0, keys: device.caps.keys }).screen } };
  });

  /* ------------------------------ WS 网关 ------------------------------ */

  app.get('/hw/v1', { websocket: true }, (socket, req) => {
    const raw = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!raw) {
      socket.close(1008, 'device token required');
      return;
    }
    const ready = (async () => {
      const device = await store.findByTokenHash(sha256(raw));
      if (!device) {
        socket.close(1008, 'unauthorized');
        return null;
      }
      if (connections.has(device.id)) {
        const previous = connections.get(device.id)!;
        connections.delete(device.id);
        previous.socket.close(1012, 'replaced by newer connection');
      }
      const user = device.userId ? await loadUser(device.userId) : null;
      const conn: HwConn = {
        socket,
        deviceId: device.id,
        device,
        user,
        caps: device.caps,
        keys: device.caps.keys,
        keymap: [],
        focusIndex: 0,
        screenRev: 0,
        lastSignature: '',
        lastPushAt: 0,
        lastSeenAt: Date.now(),
        sessionId: null,
        queue: Promise.resolve(),
        bucket: { secondStart: Date.now(), second: 0, minuteStart: Date.now(), minute: 0 },
        seen: new Set(),
        sensorAt: 0,
        hudAckedAt: Date.now(),
        reports: [],
        lastProbeId: null,
        lastExamId: null,
      };
      connections.set(device.id, conn);
      await store.touch(device.id, String(req.ip ?? ''), device.firmware, device.caps);
      app.log.info({ deviceId: device.id, bound: Boolean(user) }, 'hardware terminal connected');
      // 未绑定设备先给出配对画面，绑定后由 bind 接口推 ready。
      if (!user) await pushHud(conn, true);
      else send(conn, { t: 'ready', dev: { id: device.id, name: device.name }, scopes: scopesFor(device.status === 'bound') });
      return conn;
    })().catch((error: unknown) => {
      app.log.warn({ err: error }, 'hardware handshake failed');
      socket.close(1011, 'handshake failed');
      return null;
    });

    socket.on('message', (data: unknown) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data);
      void ready.then((conn) => {
        if (!conn) return;
        enqueue(conn, () => onFrame(conn, text));
      });
    });
    socket.on('close', () => {
      void ready.then((conn) => {
        if (!conn) return;
        if (connections.get(conn.deviceId) === conn) connections.delete(conn.deviceId);
        void store.closeSessions(conn.deviceId).catch(() => undefined);
        app.log.info({ deviceId: conn.deviceId }, 'hardware terminal disconnected');
      });
    });
    socket.on('error', () => socket.close(1011, 'socket error'));
  });

  /* ------------------------------ 维护循环 ------------------------------ */

  const timer = setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const conn of [...connections.values()]) {
        if (now - conn.lastSeenAt > hcpLimits.heartbeatSeconds * 3000) {
          conn.socket.close(1008, 'heartbeat timeout');
          connections.delete(conn.deviceId);
          continue;
        }
        if (!conn.user) continue;
        if (now - conn.lastPushAt < hcpLimits.hudPushIntervalMs) continue;
        try {
          await pushHud(conn);
        } catch (error) {
          app.log.warn({ deviceId: conn.deviceId, err: error }, 'hud push failed');
        }
      }
      if (now % 3_600_000 < 10_000) await store.expireStale(new Date(now - HW_UNBOUND_TTL_MS).toISOString().slice(0, 19).replace('T', ' '));
    })().catch((error: unknown) => app.log.error({ err: error }, 'hardware maintenance failed'));
  }, 1000);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    for (const conn of connections.values()) conn.socket.close(1001, 'server restarting');
    connections.clear();
  });

  return { connections, broadcastToUser, viewOf };
}
