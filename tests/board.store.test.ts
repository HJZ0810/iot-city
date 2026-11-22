import test from 'node:test';
import assert from 'node:assert/strict';
import { boardLevels } from '../packages/content/src/index.ts';
import type { BoardFacts } from '../packages/shared/src/index.ts';
import { createBoardService } from '../services/api/src/board/index.ts';
import { createMemoryBoardStore } from '../services/api/src/board/store.ts';

/**
 * 持久化语义：断点续玩、换关放弃、幂等结算、榜单聚合、证据链。
 * 用内存实现跑，SQL 实现与之同接口（生产走 createSqlBoardStore）。
 */

const steady = (): BoardFacts => ({
  uptimeMs: 6000,
  pins: [
    { pin: 4, mode: 'out', level: 1, edges: 6 },
    { pin: 5, mode: 'out', level: 1, edges: 1 },
    { pin: 6, mode: 'out', level: 1, edges: 1 },
    { pin: 7, mode: 'out', level: 0, edges: 0 },
  ],
  pwm: [],
  adc: [],
  keys: [],
  reports: [],
  errors: [],
});

test('断点续玩：服务重启后进行中的关卡能从持久层恢复', async () => {
  const store = createMemoryBoardStore();
  const first = createBoardService(boardLevels, store);
  await first.start('u1', 'board-b1-01');
  const outcome = await first.evidence('u1', 'p-steady', steady());
  assert.equal(outcome.result?.passed, true);
  assert.equal(outcome.view?.currentProbeIndex, 1);

  // 模拟服务重启：新的 service 实例，共享同一个存储
  const second = createBoardService(boardLevels, store);
  assert.equal(second.current('u1'), null, '新进程内存里还没有会话');
  await second.ensureLoaded('u1');
  const resumed = second.current('u1');
  assert.ok(resumed, '应从持久层恢复');
  assert.equal(resumed!.level.id, 'board-b1-01');
  assert.equal(resumed!.run.currentProbeIndex, 1, '进度必须保留');
  assert.equal(resumed!.run.results[0]?.probeId, 'p-steady');
});

test('完成即入库：结果只写一次，榜单取最好成绩', async () => {
  const store = createMemoryBoardStore();
  const service = createBoardService(boardLevels, store);
  await service.start('u1', 'board-b1-01');
  await service.evidence('u1', 'p-steady', steady());
  const finish = await service.evidence('u1', 'p-blink', steady());
  assert.equal(finish.finished, true);
  assert.equal(finish.view?.score, 1000);
  assert.equal(service.current('u1'), null, '完成后释放内存会话');

  const results = await service.results('u1');
  assert.equal(results.length, 1, '一次通关只产生一条成绩');
  assert.equal(results[0]!.score, 1000);

  // 同一关再打一次、分数更低：成绩表两条，但榜单只取最高分
  await service.start('u1', 'board-b1-01');
  await service.hint('u1');
  await service.evidence('u1', 'p-steady', steady());
  await service.evidence('u1', 'p-blink', steady());
  const all = await service.results('u1');
  assert.equal(all.length, 2);
  const board = await service.leaderboard('individual', null, 10);
  assert.equal(board.length, 1, '同一用户只占一行');
  assert.equal(board[0]!.score, 1000, '榜单取最高分');
  assert.equal(board[0]!.attempts, 2);
});

test('换关卡会放弃旧局，不会出现两关并行刷分', async () => {
  const store = createMemoryBoardStore();
  const service = createBoardService(boardLevels, store);
  await service.start('u1', 'board-b1-01');
  await service.start('u1', 'board-b1-02');
  const running = await store.findRunning('u1');
  assert.equal(running?.levelId, 'board-b1-02', '只应保留最新一关');
  const results = await service.results('u1');
  assert.equal(results.length, 0, '被放弃的关卡不计成绩');
  const reopened = await service.start('u1', 'board-b1-02');
  assert.equal(reopened.currentProbeIndex, 0);
  assert.equal((await store.findRunning('u1'))?.id, running?.id, '同关卡重开应续玩而新建');
});

test('答题关与功能验收关分别结算', async () => {
  const store = createMemoryBoardStore();
  const service = createBoardService(boardLevels, store);
  await service.start('u2', 'board-b1-04');
  const view = await service.answer('u2', 'B');
  assert.equal(view.status, 'passed');
  assert.equal(view.score, 1000);
  assert.equal(view.stars, 3);
  const results = await service.results('u2');
  assert.equal(results[0]?.levelId, 'board-b1-04');

  await service.start('u2', 'board-b1-04');
  const wrong = await service.answer('u2', 'A');
  assert.equal(wrong.status, 'failed');
  assert.equal(wrong.score, 0, '答错不得分');
});

test('证据链摘要随每次上报变化，可用于教师复核', async () => {
  const store = createMemoryBoardStore();
  const service = createBoardService(boardLevels, store);
  await service.start('u3', 'board-b1-01');
  await service.ensureLoaded('u3');
  const before = service.current('u3')!.digest;
  assert.match(before, /^[a-f0-9]{64}$/);
  await service.evidence('u3', 'p-steady', steady());
  const after = service.current('u3')!.digest;
  assert.match(after, /^[a-f0-9]{64}$/);
  assert.notEqual(before, after, '每次证据都应推进摘要');
});

test('班级榜按 scope 过滤（内存实现下验证参数传递不报错）', async () => {
  const store = createMemoryBoardStore();
  const service = createBoardService(boardLevels, store);
  await service.start('u1', 'board-b1-04');
  await service.answer('u1', 'B');
  const individual = await service.leaderboard('individual', null, 10);
  assert.equal(individual[0]?.rank, 1);
  const klass = await service.leaderboard('class', 'class-1', 10);
  assert.ok(Array.isArray(klass));
});
