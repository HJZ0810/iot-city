import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { boardFactsSchema, type BoardFacts, type BoardLevel, type BoardProbeResult, type BoardRunView, publicBoardLevel } from '../../../../packages/shared/src/index.ts';
import { boardLevels, boardChapters } from '../../../../packages/content/src/index.ts';
import type { AppContext } from '../context.ts';
import { httpError } from '../errors.ts';
import { createRun, scoreOf, submitEvidence, submitQuizAnswer, useHint, viewOf, type BoardRunState } from './runner.ts';
import { starsFor } from './grader.ts';
import { boardScreen } from './screen.ts';
import { createMemoryBoardStore, type BoardStore } from './store.ts';

export interface BoardActive {
  sessionId: string;
  level: BoardLevel;
  run: BoardRunState;
  startedAt: string;
  /** 证据链摘要：每次 evidence 追加哈希，教师可据此核对判定依据 */
  digest: string;
}

export interface EvidenceOutcome {
  ok: boolean;
  error?: 'EXAM_NOT_ACTIVE' | 'PROBE_MISMATCH' | 'RUN_FINISHED';
  result?: BoardProbeResult;
  view?: BoardRunView;
  finished?: boolean;
}

/**
 * 板端关卡服务。
 * 内存缓存负责热路径（屏幕刷新与按键），持久层负责断点续玩与成绩入库：
 *   - 同一账号同一关卡重开 → 直接续玩，不新建会话；
 *   - 换关卡重开 → 旧会话标记 abandoned，避免“多关卡并行刷分”；
 *   - 完成/失败 → 写 board_results（按 session 幂等）并记录证据链摘要。
 */
export function createBoardService(levels: BoardLevel[] = boardLevels, store: BoardStore = createMemoryBoardStore()) {
  const byId = new Map(levels.map((level) => [level.id, level]));
  const active = new Map<string, BoardActive>();
  const loaded = new Set<string>();

  function requireLevel(levelId: string): BoardLevel {
    const level = byId.get(levelId);
    if (!level) throw httpError(404, 'BOARD_LEVEL_NOT_FOUND', '板端关卡不存在。');
    return level;
  }

  function chain(previous: string, pid: string, facts: BoardFacts): string {
    return createHash('sha256').update(`${previous}|${pid}|${JSON.stringify(facts)}`).digest('hex');
  }

  async function ensureLoaded(userId: string): Promise<void> {
    if (loaded.has(userId)) return;
    loaded.add(userId);
    const record = await store.findRunning(userId);
    if (!record) return;
    const level = byId.get(record.levelId);
    if (!level) {
      await store.save({ ...record, status: 'abandoned', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return;
    }
    active.set(userId, { sessionId: record.id, level, run: record.run, startedAt: record.startedAt, digest: createHash('sha256').update(record.id).digest('hex') });
  }

  async function persist(session: BoardActive) {
    const level = session.level;
    const score = scoreOf(level, session.run);
    const stars = session.run.status === 'passed' ? starsFor(score) : 0;
    session.run = { ...session.run, updatedAt: new Date().toISOString() };
    const record = {
      id: session.sessionId,
      userId: '',
      levelId: level.id,
      status: session.run.status,
      run: session.run,
      score,
      stars,
      startedAt: session.startedAt,
      finishedAt: session.run.status === 'running' ? null : new Date().toISOString(),
      updatedAt: session.run.updatedAt,
    };
    return { score, stars, record };
  }

  async function commit(userId: string, session: BoardActive) {
    const { record } = await persist(session);
    record.userId = userId;
    // 只有通过/失败才写成绩；放弃的局只更新会话状态，不进排行榜
    if (session.run.status === 'passed' || session.run.status === 'failed') {
      await store.finish(record, {
        chapter: session.level.chapter,
        kind: session.level.kind,
        hints: session.run.hintsUsed,
        failures: session.run.failedAttempts,
        digest: session.digest,
      });
      active.delete(userId);
      loaded.delete(userId);
      return;
    }
    await store.save(record);
    if (session.run.status === 'abandoned') {
      active.delete(userId);
      loaded.delete(userId);
    }
  }

  return {
    levels,
    chapters: boardChapters,
    level: requireLevel,
    current(userId: string): BoardActive | null {
      return active.get(userId) ?? null;
    },
    /** 冷启动或重启后，从持久层把进行中的关卡载回内存（断点续玩） */
    ensureLoaded,
    screenOf(userId: string) {
      const session = active.get(userId);
      return session ? boardScreen(session.level, session.run) : null;
    },
    async start(userId: string, levelId: string): Promise<BoardRunView> {
      const level = requireLevel(levelId);
      await ensureLoaded(userId);
      const running = active.get(userId);
      if (running && running.level.id === levelId) return viewOf(running.level, running.run);
      if (running) {
        running.run = { ...running.run, status: 'abandoned', updatedAt: new Date().toISOString() };
        await commit(userId, running);
      }
      const previous = await store.findRunning(userId);
      if (previous) await store.save({ ...previous, status: 'abandoned', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const run = createRun(level, randomUUID());
      const now = new Date().toISOString();
      const session: BoardActive = { sessionId: run.sessionId, level, run, startedAt: now, digest: createHash('sha256').update(run.sessionId).digest('hex') };
      active.set(userId, session);
      loaded.add(userId);
      const { record } = await persist(session);
      await store.create({ ...record, userId });
      return viewOf(level, run);
    },
    async evidence(userId: string, pid: string, facts: BoardFacts): Promise<EvidenceOutcome> {
      await ensureLoaded(userId);
      const session = active.get(userId) ?? null;
      if (!session) return { ok: false, error: 'EXAM_NOT_ACTIVE' };
      const outcome = submitEvidence(session.level, session.run, pid, boardFactsSchema.parse(facts));
      if (outcome.error) return { ok: false, error: outcome.error === 'PROBE_MISMATCH' ? 'PROBE_MISMATCH' : 'RUN_FINISHED', view: viewOf(session.level, session.run) };
      session.run = outcome.run;
      session.digest = chain(session.digest, pid, facts);
      await commit(userId, session);
      const view = viewOf(session.level, session.run);
      return { ok: true, result: outcome.result, view, finished: session.run.status !== 'running' };
    },
    async answer(userId: string, optionId: string): Promise<BoardRunView> {
      await ensureLoaded(userId);
      const session = active.get(userId);
      if (!session) throw httpError(409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      const outcome = submitQuizAnswer(session.level, session.run, optionId);
      if (outcome.error) throw httpError(409, 'BOARD_NOT_ACTIVE', '这一关已经结束。');
      session.run = outcome.run;
      await commit(userId, session);
      return viewOf(session.level, session.run);
    },
    async hint(userId: string): Promise<BoardRunView> {
      await ensureLoaded(userId);
      const session = active.get(userId);
      if (!session) throw httpError(409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
      session.run = useHint(session.run);
      await commit(userId, session);
      return viewOf(session.level, session.run);
    },
    async abandon(userId: string): Promise<void> {
      await ensureLoaded(userId);
      const session = active.get(userId);
      if (!session) {
        const record = await store.findRunning(userId);
        if (record) await store.save({ ...record, status: 'abandoned', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return;
      }
      session.run = { ...session.run, status: 'abandoned', updatedAt: new Date().toISOString() };
      await commit(userId, session);
    },
    leaderboard(scope: 'individual' | 'class', classId: string | null, limit = 50) {
      return store.leaderboard(scope, classId, limit);
    },
    results(userId: string) {
      return store.resultsOf(userId);
    },
  };
}

export type BoardService = ReturnType<typeof createBoardService>;

export async function registerBoardRoutes(app: FastifyInstance, ctx: AppContext, service: BoardService) {
  const idParam = (params: unknown) => z.object({ id: z.string().max(80) }).parse(params).id;

  app.get('/api/board/chapters', async (req) => {
    await ctx.requireUser(req);
    return { data: service.chapters };
  });

  app.get('/api/board/levels', async (req) => {
    await ctx.requireUser(req);
    return { data: service.levels.map(publicBoardLevel) };
  });

  app.get('/api/board/levels/:id', async (req) => {
    await ctx.requireUser(req);
    return { data: publicBoardLevel(service.level(idParam(req.params))) };
  });

  app.get('/api/board/sessions/current', async (req) => {
    const user = await ctx.requireUser(req);
    await service.ensureLoaded(user.id);
    const session = service.current(user.id);
    return { data: session ? viewOf(session.level, session.run) : null };
  });

  app.post('/api/board/sessions', async (req) => {
    const user = await ctx.requireUser(req);
    const body = z.object({ levelId: z.string().max(80) }).strict().parse(req.body);
    return { data: await service.start(user.id, body.levelId) };
  });

  app.post('/api/board/sessions/evidence', async (req) => {
    const user = await ctx.requireUser(req);
    const body = z.object({ pid: z.string().min(2).max(40), facts: boardFactsSchema }).strict().parse(req.body);
    const outcome = await service.evidence(user.id, body.pid, body.facts);
    if (outcome.error === 'EXAM_NOT_ACTIVE') throw httpError(409, 'BOARD_NOT_ACTIVE', '当前没有进行中的板端关卡。');
    if (outcome.error === 'PROBE_MISMATCH') throw httpError(409, 'PROBE_MISMATCH', '提交的考察项与当前进度不一致。');
    if (outcome.error) throw httpError(409, 'BOARD_FINISHED', '这一关已经结束。');
    return { data: outcome };
  });

  app.post('/api/board/sessions/answer', async (req) => {
    const user = await ctx.requireUser(req);
    const body = z.object({ optionId: z.string().min(1).max(4) }).strict().parse(req.body);
    return { data: await service.answer(user.id, body.optionId) };
  });

  app.post('/api/board/sessions/hint', async (req) => {
    const user = await ctx.requireUser(req);
    return { data: await service.hint(user.id) };
  });

  app.post('/api/board/sessions/abandon', async (req) => {
    const user = await ctx.requireUser(req);
    await service.abandon(user.id);
    return { data: { ok: true } };
  });

  app.get('/api/board/leaderboard', async (req) => {
    const user = await ctx.requireUser(req);
    const query = z.object({ scope: z.enum(['individual', 'class']).default('individual'), classId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    if (query.scope === 'class') {
      if (!query.classId) throw httpError(400, 'CLASS_REQUIRED', '班级榜需要提供 classId。');
      await ctx.assertClassAccess(user, query.classId);
    }
    return { data: await service.leaderboard(query.scope, query.classId ?? null, query.limit) };
  });

  app.get('/api/board/results', async (req) => {
    const user = await ctx.requireUser(req);
    return { data: await service.results(user.id) };
  });
}
