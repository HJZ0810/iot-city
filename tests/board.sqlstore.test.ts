import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqlBoardStore, type BoardSessionRecord } from '../services/api/src/board/store.ts';
import { createRun } from '../services/api/src/board/runner.ts';
import { getBoardLevel } from '../packages/content/src/index.ts';

/**
 * SQL 版存储的形状测试：本机没有 MySQL，无法验证语法，
 * 但可以验证「占位符数量与参数数量一致」「语句类型正确」「行映射正确」这三类最容易犯的错。
 */

const level = getBoardLevel('board-b1-01')!;

class Recorder {
  calls: Array<{ sql: string; values: unknown[] }> = [];
  rows: unknown[] = [];
  async query(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    return this.rows as never;
  }
  async execute(sql: string, values: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    return { affectedRows: 1 };
  }
  async transaction<T>(fn: (tx: Recorder) => Promise<T>) {
    return fn(this);
  }
}

const record = (): BoardSessionRecord => {
  const run = createRun(level, 'sess-sql-1');
  return { id: run.sessionId, userId: 'u1', levelId: level.id, status: 'running', run, score: 0, stars: 0, startedAt: run.startedAt, finishedAt: null, updatedAt: run.updatedAt };
};

const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

test('SQL 存储：会话写入与更新的占位符和参数一一对应', async () => {
  const db = new Recorder();
  const store = createSqlBoardStore(db as never);
  const item = record();

  await store.create(item);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0]!.sql, /^INSERT INTO board_sessions/);
  assert.equal(placeholders(db.calls[0]!.sql), db.calls[0]!.values.length, '占位符与参数数量必须一致');
  assert.equal(db.calls[0]!.values.length, 8);
  assert.equal(db.calls[0]!.values[3], 'running');
  assert.ok(db.calls[0]!.values[7] instanceof Date, '开始时间应以 Date 传入，避免时区字符串被 MySQL 拒绝');

  db.calls = [];
  await store.save({ ...item, status: 'abandoned', finishedAt: new Date().toISOString() });
  assert.match(db.calls[0]!.sql, /^UPDATE board_sessions SET status=\?/);
  assert.equal(placeholders(db.calls[0]!.sql), db.calls[0]!.values.length);
  assert.equal(db.calls[0]!.values.length, 6);
});

test('SQL 存储：结算语句幂等且带证据摘要', async () => {
  const db = new Recorder();
  const store = createSqlBoardStore(db as never);
  const item = { ...record(), status: 'passed' as const, score: 1000, stars: 3, finishedAt: new Date().toISOString() };
  await store.finish(item, { chapter: 1, kind: 'firmware', hints: 0, failures: 0, digest: 'a'.repeat(64) });

  assert.equal(db.calls.length, 2, '一条写成绩、一条更新会话');
  assert.match(db.calls[0]!.sql, /^INSERT IGNORE INTO board_results/);
  assert.equal(placeholders(db.calls[0]!.sql), db.calls[0]!.values.length);
  assert.equal(db.calls[0]!.values.length, 11);
  assert.equal(db.calls[0]!.values[10], 'a'.repeat(64));
  assert.match(db.calls[1]!.sql, /^UPDATE board_sessions SET status=\?/);
  assert.equal(placeholders(db.calls[1]!.sql), db.calls[1]!.values.length);
});

test('SQL 存储：行映射把 snake_case 与 JSON 还原成记录', async () => {
  const db = new Recorder();
  const item = record();
  db.rows = [
    {
      id: item.id,
      user_id: 'u1',
      level_id: level.id,
      status: 'running',
      run: JSON.stringify(item.run),
      score: 0,
      stars: 0,
      started_at: '2026-10-21T11:00:00.000Z',
      finished_at: null,
      updated_at: '2026-10-21T11:01:00.000Z',
    },
  ];
  const store = createSqlBoardStore(db as never);
  const loaded = await store.findRunning('u1');
  assert.ok(loaded);
  assert.equal(loaded!.userId, 'u1');
  assert.equal(loaded!.run.levelId, level.id);
  assert.equal(loaded!.finishedAt, null);
  assert.match(db.calls[0]!.sql, /status='running'/);
});

test('SQL 存储：榜单与成绩映射', async () => {
  const db = new Recorder();
  db.rows = [
    { name: '甲', score: '1000', stars: '3', attempts: '2' },
    { name: '乙', score: '920', stars: '3', attempts: '1' },
  ];
  const store = createSqlBoardStore(db as never);
  const board = await store.leaderboard('individual', null, 50);
  assert.deepEqual(board, [
    { rank: 1, name: '甲', score: 1000, stars: 3, attempts: 2 },
    { rank: 2, name: '乙', score: 920, stars: 3, attempts: 1 },
  ]);
  assert.equal(db.calls[0]!.values.length, 1);

  db.calls = [];
  await store.leaderboard('class', 'class-1', 20);
  assert.equal(db.calls[0]!.values.length, 2, '班级榜需要 classId 与 limit');
  assert.match(db.calls[0]!.sql, /class_members/);

  db.calls = [];
  db.rows = [{ level_id: 'board-b1-01', score: 1000, stars: 3, created_at: '2026-10-21 11:00:00' }];
  const results = await store.resultsOf('u1');
  assert.equal(results[0]!.levelId, 'board-b1-01');
  assert.equal(results[0]!.score, 1000);
});
