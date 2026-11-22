import type { BoardRunStatus } from '../../../../packages/shared/src/board.ts';
import type { Database } from '../db.ts';
import { json } from '../db.ts';
import type { BoardRunState } from './runner.ts';

/** 板端关卡的持久化记录：一个问题一行，run 里带完整进度，因此重启后可续玩。 */
export interface BoardSessionRecord {
  id: string;
  userId: string;
  levelId: string;
  status: BoardRunStatus;
  run: BoardRunState;
  score: number;
  stars: number;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface BoardFinishMeta {
  chapter: number;
  kind: string;
  hints: number;
  failures: number;
  /** 证据摘要：用于教师事后复核“这次判定依据是哪一帧证据” */
  digest: string;
}

export interface BoardLeaderboardRow {
  rank: number;
  name: string;
  score: number;
  stars: number;
  attempts: number;
}

export interface BoardResultRow {
  levelId: string;
  score: number;
  stars: number;
  createdAt: string;
}

export interface BoardStore {
  create(record: BoardSessionRecord): Promise<void>;
  save(record: BoardSessionRecord): Promise<void>;
  findRunning(userId: string): Promise<BoardSessionRecord | null>;
  findById(id: string, userId: string): Promise<BoardSessionRecord | null>;
  /** 完成/失败时落库：写 results（按 session_id 幂等）并更新会话状态 */
  finish(record: BoardSessionRecord, meta: BoardFinishMeta): Promise<void>;
  leaderboard(scope: 'individual' | 'class', classId: string | null, limit: number): Promise<BoardLeaderboardRow[]>;
  resultsOf(userId: string): Promise<BoardResultRow[]>;
}

interface SessionDbRow {
  id: string;
  user_id: string;
  level_id: string;
  status: BoardRunStatus;
  run: BoardRunState | string;
  score: number;
  stars: number;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

const toRecord = (row: SessionDbRow): BoardSessionRecord => ({
  id: row.id,
  userId: row.user_id,
  levelId: row.level_id,
  status: row.status,
  run: json(row.run),
  score: Number(row.score),
  stars: Number(row.stars),
  startedAt: String(row.started_at),
  finishedAt: row.finished_at ? String(row.finished_at) : null,
  updatedAt: String(row.updated_at),
});

export function createSqlBoardStore(db: Database): BoardStore {
  return {
    async create(record) {
      await db.execute(
        'INSERT INTO board_sessions(id,user_id,level_id,status,run,score,stars,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',
        [record.id, record.userId, record.levelId, record.status, JSON.stringify(record.run), record.score, record.stars, new Date(record.startedAt)],
      );
    },
    async save(record) {
      await db.execute('UPDATE board_sessions SET status=?,run=?,score=?,stars=?,finished_at=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [
        record.status,
        JSON.stringify(record.run),
        record.score,
        record.stars,
        record.finishedAt ? new Date(record.finishedAt) : null,
        record.id,
      ]);
    },
    async findRunning(userId) {
      const rows = await db.query<SessionDbRow>("SELECT * FROM board_sessions WHERE user_id=? AND status='running' ORDER BY updated_at DESC LIMIT 1", [userId]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findById(id, userId) {
      const rows = await db.query<SessionDbRow>('SELECT * FROM board_sessions WHERE id=? AND user_id=?', [id, userId]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async finish(record, meta) {
      await db.execute(
        'INSERT IGNORE INTO board_results(id,session_id,user_id,level_id,chapter,kind,score,stars,hints,failures,evidence_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [`br-${record.id}`, record.id, record.userId, record.levelId, meta.chapter, meta.kind, record.score, record.stars, meta.hints, meta.failures, meta.digest],
      );
      await db.execute('UPDATE board_sessions SET status=?,run=?,score=?,stars=?,finished_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=?', [
        record.status,
        JSON.stringify(record.run),
        record.score,
        record.stars,
        record.id,
      ]);
    },
    async leaderboard(scope, classId, limit) {
      const sql =
        scope === 'class'
          ? "SELECT u.nickname AS name,MAX(r.score) AS score,MAX(r.stars) AS stars,COUNT(*) AS attempts FROM board_results r JOIN users u ON u.id=r.user_id JOIN class_members m ON m.user_id=r.user_id AND m.class_id=? GROUP BY r.user_id,u.nickname ORDER BY score DESC,attempts ASC LIMIT ?"
          : 'SELECT u.nickname AS name,MAX(r.score) AS score,MAX(r.stars) AS stars,COUNT(*) AS attempts FROM board_results r JOIN users u ON u.id=r.user_id GROUP BY r.user_id,u.nickname ORDER BY score DESC,attempts ASC LIMIT ?';
      const rows = await db.query<{ name: string; score: number; stars: number; attempts: number }>(sql, scope === 'class' ? [classId, limit] : [limit]);
      return rows.map((row, index) => ({ rank: index + 1, name: row.name, score: Number(row.score), stars: Number(row.stars), attempts: Number(row.attempts) }));
    },
    async resultsOf(userId) {
      const rows = await db.query<{ level_id: string; score: number; stars: number; created_at: string }>('SELECT level_id,score,stars,created_at FROM board_results WHERE user_id=? ORDER BY created_at DESC LIMIT 200', [userId]);
      return rows.map((row) => ({ levelId: row.level_id, score: Number(row.score), stars: Number(row.stars), createdAt: String(row.created_at) }));
    },
  };
}

/** 内存实现：单元测试与本地无数据库时使用，语义与 SQL 版一致。 */
export function createMemoryBoardStore(): BoardStore {
  const sessions = new Map<string, BoardSessionRecord>();
  const results = new Map<string, { record: BoardSessionRecord; meta: BoardFinishMeta }>();
  return {
    async create(record) {
      sessions.set(record.id, structuredClone(record));
    },
    async save(record) {
      sessions.set(record.id, structuredClone(record));
    },
    async findRunning(userId) {
      const found = [...sessions.values()].filter((s) => s.userId === userId && s.status === 'running').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return found ? structuredClone(found) : null;
    },
    async findById(id, userId) {
      const found = sessions.get(id);
      return found && found.userId === userId ? structuredClone(found) : null;
    },
    async finish(record, meta) {
      sessions.set(record.id, structuredClone(record));
      if (!results.has(record.id)) results.set(record.id, { record: structuredClone(record), meta });
    },
    async leaderboard(scope, _classId, limit) {
      const best = new Map<string, { name: string; score: number; stars: number; attempts: number }>();
      for (const { record } of results.values()) {
        const current = best.get(record.userId);
        if (!current) best.set(record.userId, { name: record.userId, score: record.score, stars: record.stars, attempts: 1 });
        else {
          current.attempts += 1;
          current.score = Math.max(current.score, record.score);
          current.stars = Math.max(current.stars, record.stars);
        }
      }
      return [...best.values()]
        .sort((a, b) => b.score - a.score || a.attempts - b.attempts)
        .slice(0, limit)
        .map((row, index) => ({ rank: index + 1, ...row }));
    },
    async resultsOf(userId) {
      return [...results.values()].filter((r) => r.record.userId === userId).map((r) => ({ levelId: r.record.levelId, score: r.record.score, stars: r.record.stars, createdAt: r.record.finishedAt ?? r.record.updatedAt }));
    },
  };
}
