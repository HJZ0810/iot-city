import type { BoardFacts, BoardLevel, BoardProbeResult, BoardRunStatus, BoardRunView } from '../../../../packages/shared/src/index.ts';
import { gradeProbe, scoreProbes, starsFor } from './grader.ts';

/** 同一条探针连续失败 3 次判定关卡失败，避免无限重试刷分。 */
export const MAX_PROBE_ATTEMPTS = 3;

export interface BoardRunState {
  sessionId: string;
  levelId: string;
  status: BoardRunStatus;
  currentProbeIndex: number;
  results: BoardProbeResult[];
  attempts: Record<string, number>;
  failedAttempts: number;
  hintsUsed: number;
  quizAnswer?: { correct: boolean; optionId: string; at: string };
  startedAt: string;
  updatedAt: string;
}

export type RunnerError = 'RUN_FINISHED' | 'PROBE_MISMATCH' | 'NO_PROBES' | 'NOT_QUIZ';

export interface SubmitOutcome {
  run: BoardRunState;
  result?: BoardProbeResult;
  error?: RunnerError;
}

export function createRun(level: BoardLevel, sessionId: string, now = new Date()): BoardRunState {
  if (level.kind === 'quiz' && !level.screenQuiz) throw new Error('quiz level requires screenQuiz');
  return {
    sessionId,
    levelId: level.id,
    status: 'running',
    currentProbeIndex: 0,
    results: [],
    attempts: {},
    failedAttempts: 0,
    hintsUsed: 0,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** 提交一条探针的证据：只有“当前考察项”的证据才被接受，且校验 pid 防止错位提交。 */
export function submitEvidence(level: BoardLevel, run: BoardRunState, pid: string, facts: BoardFacts, now = new Date()): SubmitOutcome {
  if (run.status !== 'running') return { run, error: 'RUN_FINISHED' };
  const probe = level.probes[run.currentProbeIndex];
  if (!probe) return { run: { ...run, status: 'passed', updatedAt: now.toISOString() }, error: 'NO_PROBES' };
  if (probe.id !== pid) return { run, error: 'PROBE_MISMATCH' };

  const result = gradeProbe(probe, facts);
  const attempts = { ...run.attempts, [probe.id]: (run.attempts[probe.id] ?? 0) + 1 };
  const next: BoardRunState = {
    ...run,
    attempts,
    failedAttempts: run.failedAttempts + (result.passed ? 0 : 1),
    results: [...run.results.filter((r) => r.probeId !== probe.id), result],
    updatedAt: now.toISOString(),
  };

  if (result.passed) {
    next.currentProbeIndex = run.currentProbeIndex + 1;
    if (next.currentProbeIndex >= level.probes.length) next.status = 'passed';
  } else if ((attempts[probe.id] ?? 0) >= MAX_PROBE_ATTEMPTS) {
    next.status = 'failed';
  }
  return { run: next, result };
}

/** 屏上答题：一次机会，答错即失败并给出解析（解析由调用方从关卡取出后下发）。 */
export function submitQuizAnswer(level: BoardLevel, run: BoardRunState, optionId: string, now = new Date()): SubmitOutcome {
  if (run.status !== 'running') return { run, error: 'RUN_FINISHED' };
  if (level.kind !== 'quiz' || !level.screenQuiz) return { run, error: 'NOT_QUIZ' };
  const correct = level.screenQuiz.answer === optionId;
  const next: BoardRunState = {
    ...run,
    status: correct ? 'passed' : 'failed',
    quizAnswer: { correct, optionId, at: now.toISOString() },
    failedAttempts: run.failedAttempts + (correct ? 0 : 1),
    updatedAt: now.toISOString(),
  };
  return { run: next };
}

export function useHint(run: BoardRunState, now = new Date()): BoardRunState {
  return { ...run, hintsUsed: run.hintsUsed + 1, updatedAt: now.toISOString() };
}

export function scoreOf(level: BoardLevel, run: BoardRunState): number {
  if (level.kind === 'quiz') {
    if (run.status !== 'passed') return 0;
    return Math.max(0, 1000 - run.hintsUsed * 40);
  }
  return scoreProbes(run.results, run.hintsUsed, run.failedAttempts - (run.status === 'failed' ? 1 : 0));
}

export function viewOf(level: BoardLevel, run: BoardRunState): BoardRunView {
  const probe = level.probes[run.currentProbeIndex];
  const score = scoreOf(level, run);
  return {
    sessionId: run.sessionId,
    levelId: level.id,
    title: level.title,
    kind: level.kind,
    status: run.status,
    currentProbeIndex: run.currentProbeIndex,
    totalProbes: level.probes.length,
    ...(probe && run.status === 'running' ? { currentProbe: { id: probe.id, title: probe.title, description: probe.description, windowMs: probe.windowMs } } : {}),
    results: run.results,
    score,
    stars: run.status === 'passed' ? starsFor(score) : 0,
    hintsUsed: run.hintsUsed,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}
