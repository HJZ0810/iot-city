/**
 * 本地预览服务（仅用于前端走查与浏览器自动化）
 * ------------------------------------------------------------------
 * 与生产 `services/api` 的区别：只把 MySQL 换成内存，其余全部复用真实内容包与真实引擎。
 * 用途：在没有本地数据库的机器上，用真实浏览器验证学生主流程。
 * 不用于生产，不参与验收结论中的“后端集成测试”。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { levels, chapters } from '../packages/content/src/index.ts';
import { boardLevels, boardChapters, getBoardLevel } from '../packages/content/src/index.ts';
import { createState, applyCommand } from '../packages/engine/src/index.ts';
import { publicLevel, publicBoardLevel, type BoardFacts, type BoardLevel } from '../packages/shared/src/index.ts';
import { createRun, submitEvidence, submitQuizAnswer, useHint, viewOf, type BoardRunState } from '../services/api/src/board/runner.ts';

const PORT = Number(process.env.PREVIEW_PORT ?? 4399);
const WEB_ROOT = resolve('dist/web');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const users = new Map<string, { id: string; username: string; nickname: string; password: string; role: 'student'; createdAt: string }>();
const sessions = new Map<string, { id: string; userId: string; mode: string; level: ReturnType<typeof getLevel>; state: ReturnType<typeof createState>; startedAt: number; preview: boolean }>();
const results: Array<{ sessionId: string; userId: string; mode: string; levelId: string; score: number; stars: number; elapsedSeconds: number; completedAt: string }> = [];
const cookies = new Map<string, string>();
/** 板子线：账号 → 当前进行中的关卡（预览用内存态，判定逻辑与生产完全同一套纯函数） */
const boardRuns = new Map<string, { level: BoardLevel; run: BoardRunState }>();
const boardResults: Array<{ userId: string; levelId: string; score: number; stars: number; createdAt: string }> = [];

const boardView = (uid: string) => { const active = boardRuns.get(uid); return active ? viewOf(active.level, active.run) : null; };
const finishBoard = (uid: string) => {
  const active = boardRuns.get(uid);
  if (!active) return;
  const { level, run } = active;
  if (run.status === 'passed' || run.status === 'failed') {
    const score = viewOf(level, run).score;
    if (!boardResults.some((r) => r.levelId === level.id && r.userId === uid)) {
      boardResults.unshift({ userId: uid, levelId: level.id, score, stars: run.status === 'passed' ? viewOf(level, run).stars : 0, createdAt: new Date().toISOString() });
    }
  }
};

function getLevel(id: string) {
  const level = levels.find((l) => l.id === id);
  if (!level) throw Object.assign(new Error('关卡不存在。'), { status: 404, code: 'LEVEL_NOT_FOUND' });
  return level;
}
const view = (uid: string) => { const u = users.get(uid); return u ? { id: u.id, username: u.username, nickname: u.nickname, role: u.role, createdAt: u.createdAt } : null; };

function sessionView(s: (typeof sessions) extends Map<string, infer V> ? V : never) {
  return { id: s.id, mode: s.mode, level: publicLevel(s.level), state: s.state, elapsedSeconds: Math.floor((Date.now() - s.startedAt) / 1000), updatedAt: new Date().toISOString() };
}

function progressOf(userId: string) {
  const mine = results.filter((r) => r.userId === userId);
  const completed = [...new Set(mine.filter((r) => r.mode === 'story').map((r) => r.levelId))];
  let next = 1;
  while (completed.includes(`level-${String(next).padStart(2, '0')}`)) next++;
  const active = [...sessions.values()].filter((s) => s.userId === userId && !['completed', 'failed'].includes(s.state.phase));
  return {
    completed,
    unlockedChapter: Math.min(10, Math.floor((next - 1) / 6) + 1),
    results: mine,
    activeSessions: active.map((s) => ({ id: s.id, title: s.level.title, mode: s.mode, updatedAt: new Date().toISOString() })),
    achievements: completed.length ? [{ id: 'first-clear', title: '第一束信号', description: '已完成一次通过服务端验证的工程任务。' }] : [],
  };
}

function json(res: import('node:http').ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}
const fail = (res: import('node:http').ServerResponse, status: number, code: string, message: string) => json(res, status, { error: { code, message } });

async function body(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

function currentUser(req: import('node:http').IncomingMessage): string | null {
  const cookie = String(req.headers.cookie ?? '');
  const match = /preview_sid=([^;]+)/.exec(cookie);
  const uid = match ? cookies.get(match[1]!) : undefined;
  return uid && users.has(uid) ? uid : null;
}

async function serveStatic(res: import('node:http').ServerResponse, pathname: string) {
  const rel = normalize(pathname).replace(/^([/\\])+/, '');
  const file = join(WEB_ROOT, rel || 'index.html');
  if (!file.startsWith(WEB_ROOT)) return fail(res, 403, 'FORBIDDEN', '路径不合法');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const html = await readFile(join(WEB_ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html']! });
      res.end(html);
    } catch {
      fail(res, 500, 'WEB_BUILD_MISSING', '请先执行 node scripts/build.mjs 生成 dist/web');
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  try {
    if (!path.startsWith('/api/')) return serveStatic(res, path);

    const uid = currentUser(req);

    if (path === '/api/health') return json(res, 200, { data: { status: 'ok', version: 'preview', database: 'memory', authoredLevels: levels.length, targetLevels: 60 } });
    if (path === '/api/config') return json(res, 200, { data: { season: { id: 'season-1', name: '城市复苏计划' }, dailyRefreshHour: 0, eventRetentionDays: 180, maxRoomPlayers: 4, scoringRules: { story: '按任务点累计，提示与错误扣分', overall: '九模式归一化均值' } } });

    if (path === '/api/auth/register' && method === 'POST') {
      const input = await body(req);
      const username = String(input.username ?? '').trim();
      const password = String(input.password ?? '');
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return fail(res, 400, 'INVALID_INPUT', '用户名需 3–32 位字母、数字或下划线。');
      if (password.length < 8) return fail(res, 400, 'INVALID_INPUT', '密码至少 8 位。');
      if ([...users.values()].some((u) => u.username === username)) return fail(res, 409, 'USERNAME_TAKEN', '用户名已被占用。');
      const user = { id: randomUUID(), username, nickname: String(input.nickname ?? username).slice(0, 40) || username, password, role: 'student' as const, createdAt: new Date().toISOString() };
      users.set(user.id, user);
      const sid = randomUUID();
      cookies.set(sid, user.id);
      return json(res, 200, { data: view(user.id) }, { 'set-cookie': `preview_sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const input = await body(req);
      const user = [...users.values()].find((u) => u.username === String(input.username ?? '') && u.password === String(input.password ?? ''));
      if (!user) return fail(res, 401, 'AUTH_FAILED', '用户名或密码不正确。');
      const sid = randomUUID();
      cookies.set(sid, user.id);
      return json(res, 200, { data: view(user.id) }, { 'set-cookie': `preview_sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      const match = /preview_sid=([^;]+)/.exec(String(req.headers.cookie ?? ''));
      if (match) cookies.delete(match[1]!);
      return json(res, 200, { data: { ok: true } }, { 'set-cookie': 'preview_sid=; Path=/; Max-Age=0' });
    }
    if (!uid) return fail(res, 401, 'AUTH_REQUIRED', '请先登录。');
    if (path === '/api/auth/me') {
      if (method === 'PATCH') { const input = await body(req); const u = users.get(uid)!; u.nickname = String(input.nickname ?? u.nickname).slice(0, 40); }
      return json(res, 200, { data: view(uid) });
    }

    if (path === '/api/chapters') return json(res, 200, { data: chapters });
    if (path === '/api/levels') return json(res, 200, { data: levels.map(publicLevel) });
    if (path.startsWith('/api/levels/')) return json(res, 200, { data: publicLevel(getLevel(decodeURIComponent(path.slice('/api/levels/'.length)))) });
    if (path === '/api/progress') return json(res, 200, { data: progressOf(uid) });
    if (path === '/api/reports/me') {
      const mine = results.filter((r) => r.userId === uid);
      return json(res, 200, { data: { attempts: mine.length, completed: new Set(mine.map((r) => r.levelId)).size, totalScore: mine.reduce((n, r) => n + r.score, 0), knowledge: [], recent: mine.slice(0, 30) } });
    }
    if (path === '/api/leaderboards') {
      const entries = [...users.values()].map((u) => { const mine = results.filter((r) => r.userId === u.id); return { id: u.id, name: u.nickname, score: mine.reduce((n, r) => n + r.score, 0), wins: 0, attempts: mine.length, team: false, rank: 0 }; })
        .sort((a, b) => b.score - a.score).map((e, i) => ({ ...e, rank: i + 1 }));
      return json(res, 200, { data: entries });
    }

    if (path === '/api/sessions' && method === 'POST') {
      const input = await body(req);
      const mode = String(input.mode ?? 'story');
      const levelId = input.levelId ? String(input.levelId) : 'level-01';
      const level = getLevel(levelId);
      const state = createState(level, Math.floor(Math.random() * 1e9));
      const session = { id: randomUUID(), userId: uid, mode, level, state, startedAt: Date.now(), preview: false };
      sessions.set(session.id, session);
      return json(res, 200, { data: sessionView(session) });
    }
    const cmdMatch = /^\/api\/sessions\/([^/]+)(\/commands|\/events|\/next)?$/.exec(path);
    if (cmdMatch) {
      const session = sessions.get(cmdMatch[1]!);
      if (!session || session.userId !== uid) return fail(res, 404, 'SESSION_NOT_FOUND', '找不到你的游戏存档。');
      if (cmdMatch[2] === '/commands' && method === 'POST') {
        const command = await body(req);
        const outcome = applyCommand(session.level as never, session.state, command as never);
        session.state = outcome.state;
        let record = null;
        if (outcome.state.phase === 'completed' && !results.some((r) => r.sessionId === session.id)) {
          const score = outcome.state.score;
          const stars = score >= 900 ? 3 : score >= 650 ? 2 : 1;
          record = { sessionId: session.id, userId: uid, mode: session.mode, levelId: session.level.id, score, stars, elapsedSeconds: Math.floor((Date.now() - session.startedAt) / 1000), completedAt: new Date().toISOString() };
          results.push(record);
        }
        return json(res, 200, { data: { session: sessionView(session), result: outcome, resultRecord: record } });
      }
      if (cmdMatch[2] === '/events') return json(res, 200, { data: { level: publicLevel(session.level), initial: session.state, final: session.state, events: [] } });
      return json(res, 200, { data: sessionView(session) });
    }

    if (path === '/api/sandbox') return json(res, 200, { data: [] });
    if (path === '/api/rooms') return json(res, 200, { data: [] });
    if (path === '/api/classes') return json(res, 200, { data: [] });

    /* ---------------------- 板子线（真实关卡 + 真实判定） ---------------------- */
    if (path === '/api/hw/devices') return json(res, 200, { data: [] });
    if (path === '/api/board/chapters') return json(res, 200, { data: boardChapters });
    if (path === '/api/board/levels') return json(res, 200, { data: boardLevels.map(publicBoardLevel) });
    if (path.startsWith('/api/board/levels/')) {
      const level = getBoardLevel(decodeURIComponent(path.slice('/api/board/levels/'.length)));
      if (!level) return fail(res, 404, 'BOARD_LEVEL_NOT_FOUND', '板端关卡不存在。');
      return json(res, 200, { data: publicBoardLevel(level) });
    }
    if (path === '/api/board/results') return json(res, 200, { data: boardResults.filter((r) => r.userId === uid) });
    if (path === '/api/board/sessions/current' && method === 'GET') return json(res, 200, { data: boardView(uid) });
    if (path === '/api/board/sessions' && method === 'POST') {
      const input = await body(req);
      const level = getBoardLevel(String(input.levelId ?? ''));
      if (!level) return fail(res, 404, 'BOARD_LEVEL_NOT_FOUND', '板端关卡不存在。');
      const existing = boardRuns.get(uid);
      if (existing && existing.level.id === level.id && existing.run.status === 'running') return json(res, 200, { data: viewOf(level, existing.run) });
      if (existing) finishBoard(uid);
      const run = createRun(level, randomUUID());
      boardRuns.set(uid, { level, run });
      return json(res, 200, { data: viewOf(level, run) });
    }
    if (path === '/api/board/sessions/evidence' && method === 'POST') {
      const active = boardRuns.get(uid);
      if (!active) return fail(res, 409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      const input = await body(req);
      const outcome = submitEvidence(active.level, active.run, String(input.pid ?? ''), (input.facts ?? {}) as BoardFacts);
      if (outcome.error === 'RUN_FINISHED') return fail(res, 409, 'BOARD_FINISHED', '这一关已经结束。');
      if (outcome.error === 'PROBE_MISMATCH') return fail(res, 409, 'PROBE_MISMATCH', '提交的考察项与当前进度不一致。');
      active.run = outcome.run;
      finishBoard(uid);
      return json(res, 200, { data: { ok: Boolean(outcome.result?.passed), result: outcome.result, view: viewOf(active.level, outcome.run), finished: outcome.run.status !== 'running' } });
    }
    if (path === '/api/board/sessions/answer' && method === 'POST') {
      const active = boardRuns.get(uid);
      if (!active) return fail(res, 409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      const input = await body(req);
      const outcome = submitQuizAnswer(active.level, active.run, String(input.optionId ?? ''));
      if (outcome.error) return fail(res, 409, 'BOARD_NOT_ACTIVE', '这一关已经结束。');
      active.run = outcome.run;
      finishBoard(uid);
      return json(res, 200, { data: viewOf(active.level, outcome.run) });
    }
    if (path === '/api/board/sessions/hint' && method === 'POST') {
      const active = boardRuns.get(uid);
      if (!active) return fail(res, 409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      active.run = useHint(active.run);
      return json(res, 200, { data: viewOf(active.level, active.run) });
    }
    if (path === '/api/board/sessions/abandon' && method === 'POST') {
      const active = boardRuns.get(uid);
      if (active) { active.run = { ...active.run, status: 'abandoned' }; boardRuns.delete(uid); }
      return json(res, 200, { data: { ok: true } });
    }

    return fail(res, 404, 'NOT_FOUND', `预览服务未实现该接口：${method} ${path}`);
  } catch (error) {
    const e = error as Error & { status?: number; code?: string };
    if (e.status && e.status < 500) return fail(res, e.status, e.code ?? 'REQUEST_FAILED', e.message);
    console.error('[preview]', e);
    return fail(res, 500, 'INTERNAL_ERROR', '预览服务内部错误。');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${PORT}  关卡 ${levels.length}  章节 ${chapters.length}`);
});
