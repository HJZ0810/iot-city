import test from 'node:test';
import assert from 'node:assert/strict';
import { boardLevels, boardChapters, getBoardLevel } from '../packages/content/src/index.ts';
import { BOARD_PROFILE, type BoardFacts, type BoardProbe } from '../packages/shared/src/index.ts';
import { gradeProbe, scoreProbes } from '../services/api/src/board/grader.ts';
import { MAX_PROBE_ATTEMPTS, createRun, scoreOf, submitEvidence, submitQuizAnswer, useHint, viewOf } from '../services/api/src/board/runner.ts';
import { boardScreen } from '../services/api/src/board/screen.ts';

/** 按探针期望构造一份“正确实现”的硬件证据，用来证明断言可满足、阈值不自相矛盾。 */
function factsFor(probe: BoardProbe): BoardFacts {
  const facts: BoardFacts = { uptimeMs: 6000, boot: 'poweron', pins: [], pwm: [], adc: [], keys: [], reports: [], errors: [] };
  const pin = (target: number) => facts.pins.find((p) => p.pin === target);
  const ensurePin = (target: number) => {
    const existing = pin(target);
    if (existing) return existing;
    const created = { pin: target, mode: 'out' as const, level: 0 as 0 | 1, edges: 0 };
    facts.pins.push(created);
    return created;
  };
  const dhtRanges: Array<{ field: 'temperature' | 'humidity'; min: number; max: number }> = [];
  for (const assertion of probe.expect) if (assertion.type === 'dht') dhtRanges.push({ field: assertion.field, min: assertion.min, max: assertion.max });

  for (const assertion of probe.expect) {
    switch (assertion.type) {
      case 'pin-level':
        ensurePin(assertion.pin).level = assertion.value;
        break;
      case 'pin-edges':
        ensurePin(assertion.pin).edges = assertion.min + 2;
        break;
      case 'pwm':
        facts.pwm.push({ pin: assertion.pin, hz: assertion.hz, duty: assertion.duty ?? 50 });
        break;
      case 'adc':
        facts.adc.push({ pin: assertion.pin, mv: (assertion.min + assertion.max) / 2 });
        break;
      case 'key':
        facts.keys.push({ key: assertion.key, presses: assertion.presses });
        break;
      case 'dht': {
        const range = dhtRanges.find((r) => r.field === assertion.field)!;
        const value = (range.min + range.max) / 2;
        facts.dht = { ok: true, ...(facts.dht ?? {}), ...(assertion.field === 'temperature' ? { temperature: value } : { humidity: value }) };
        break;
      }
      case 'strip':
        facts.strip = { count: assertion.count, first: { ...assertion.first } };
        break;
      case 'wifi':
        facts.wifi = { mode: assertion.mode ?? 'sta', rssi: assertion.rssiMin !== undefined ? assertion.rssiMin + 5 : -55, ip: '192.168.1.27' };
        break;
      case 'report': {
        const value = assertion.min !== undefined && assertion.max !== undefined ? (assertion.min + assertion.max) / 2 : (assertion.min ?? 0);
        facts.reports.push({ k: assertion.key, v: value, ts: 1 });
        break;
      }
      case 'uptime':
        facts.uptimeMs = Math.max(facts.uptimeMs, assertion.minMs + 1000);
        break;
    }
  }
  // 第二轮：为带交叉校验的上报补齐“对应的硬件事实”，否则正确实现也会被判成凭空填数
  for (const assertion of probe.expect) {
    if (assertion.type !== 'report' || !assertion.cross) continue;
    const report = facts.reports.find((r) => r.k === assertion.key)!;
    const source = assertion.cross.source;
    if (source === 'dht.temperature') facts.dht = { ok: true, ...(facts.dht ?? {}), temperature: report.v };
    else if (source === 'dht.humidity') facts.dht = { ok: true, ...(facts.dht ?? {}), humidity: report.v };
    else if (source === 'adc.mv') facts.adc = [{ pin: BOARD_PROFILE.pins.light, mv: report.v }];
    else if (source === 'wifi.rssi') facts.wifi = { mode: 'sta', rssi: Math.round(report.v), ip: '192.168.1.27' };
    else if (source.startsWith('keys.')) {
      const key = source.slice(5) as BoardFacts['keys'][number]['key'];
      facts.keys = [...facts.keys.filter((k) => k.key !== key), { key, presses: Math.round(report.v) }];
    }
  }
  return facts;
}

/** 让证据在某一方面明显出错，用来证明“错的实现会被判负”。 */
function violate(probe: BoardProbe, facts: BoardFacts): BoardFacts {
  const broken: BoardFacts = structuredClone(facts);
  const first = probe.expect[0]!;
  switch (first.type) {
    case 'pin-level': {
      const target = broken.pins.find((p) => p.pin === first.pin)!;
      target.level = first.value === 1 ? 0 : 1;
      break;
    }
    case 'pin-edges': {
      broken.pins.find((p) => p.pin === first.pin)!.edges = Math.max(0, first.min - 1);
      break;
    }
    case 'pwm':
      broken.pwm.find((p) => p.pin === first.pin)!.hz = first.hz * 3;
      break;
    case 'adc':
      broken.adc.find((p) => p.pin === first.pin)!.mv = first.max + 200 > 5000 ? Math.max(0, first.min - 100) : first.max + 200;
      break;
    case 'key':
      broken.keys.find((k) => k.key === first.key)!.presses = Math.max(0, first.presses - 1);
      break;
    case 'dht':
      if (first.field === 'temperature') broken.dht = { ...broken.dht!, temperature: first.max + 5 };
      else broken.dht = { ...broken.dht!, humidity: first.max + 5 };
      break;
    case 'strip':
      // 颜色容差可能被故意放宽（例如只校验数量），这里改数量一定能判负
      broken.strip!.count = first.count + 1;
      break;
    case 'wifi':
      broken.wifi = { mode: 'off', rssi: -110, ip: '0.0.0.0' };
      break;
    case 'report':
      // 有上限就顶穿上限；只有下限就压到下限以下，确保一定判负
      broken.reports = [{ k: first.key, v: first.max !== undefined ? first.max + 1000 : (first.min ?? 0) - 1, ts: 1 }];
      break;
    case 'uptime':
      broken.uptimeMs = 0;
      break;
  }
  return broken;
}

test('板端内容：20 关结构与引脚一致性', () => {
  assert.equal(boardLevels.length, 20);
  assert.equal(boardChapters.length, 5);
  assert.equal(new Set(boardLevels.map((l) => l.id)).size, 20, '关卡 id 必须唯一');
  assert.deepEqual(boardLevels.map((l) => l.number), Array.from({ length: 20 }, (_, i) => i + 1), '编号必须连续');
  const knownPins = new Set<number>([...BOARD_PROFILE.pins.led, ...Object.values(BOARD_PROFILE.pins.key), BOARD_PROFILE.pins.buzzer, BOARD_PROFILE.pins.relay, BOARD_PROFILE.pins.light, BOARD_PROFILE.pins.dht, BOARD_PROFILE.pins.strip]);

  for (const level of boardLevels) {
    assert.ok(level.hints.length >= 1, `${level.id} 缺少提示`);
    assert.ok(level.objective.length >= 1, `${level.id} 缺少任务目标`);
    if (level.kind === 'quiz') {
      assert.ok(level.screenQuiz, `${level.id} 缺少屏上题面`);
      assert.equal(level.probes.length, 0, `${level.id} 答题关不应有探针`);
    } else {
      assert.ok(level.probes.length >= 1, `${level.id} 缺少探针`);
      assert.ok(level.starterCode.includes('HCP.begin'), `${level.id} 起始代码必须接入 SDK`);
      for (const probe of level.probes) {
        for (const assertion of probe.expect) {
          const pin = 'pin' in assertion ? assertion.pin : undefined;
          if (pin !== undefined) assert.ok(knownPins.has(pin), `${level.id}/${probe.id} 使用了原理图上不存在的引脚 GPIO${pin}`);
        }
      }
    }
  }
  assert.equal(getBoardLevel('board-b5-14')?.kind, 'debug');
});

test('板端判题：每条探针都能被“正确实现”通过，也能被“错误实现”判负', () => {
  let probes = 0;
  for (const level of boardLevels) {
    for (const probe of level.probes) {
      probes++;
      const good = gradeProbe(probe, factsFor(probe));
      assert.ok(good.passed, `${level.id}/${probe.id} 正确证据未通过：${good.checks.filter((c) => !c.passed).map((c) => c.detail).join('；')}`);
      const bad = gradeProbe(probe, violate(probe, factsFor(probe)));
      assert.equal(bad.passed, false, `${level.id}/${probe.id} 错误证据竟然通过`);
      assert.ok(bad.feedback.length > 4, `${level.id}/${probe.id} 失败时应给出反馈`);
    }
  }
  assert.ok(probes >= 15, `探针总数应覆盖主要外设，实际 ${probes}`);
  // 覆盖率：板子的关键外设都要被至少一种断言考察到
  const types = new Set(boardLevels.flatMap((level) => level.probes.flatMap((probe) => probe.expect.map((a) => a.type))));
  for (const required of ['pin-level', 'pin-edges', 'pwm', 'adc', 'key', 'dht', 'strip', 'wifi', 'report', 'uptime'] as const) {
    assert.ok(types.has(required), `没有任何探针考察 ${required}`);
  }
});

test('板端判题：上报值必须与硬件实测交叉一致', () => {
  const level = getBoardLevel('board-b2-07')!;
  const probe = level.probes.find((p) => p.id === 'p-report')!;
  const honest = factsFor(probe);
  honest.dht = { ok: true, temperature: 24.5, humidity: 55 };
  honest.reports = [{ k: 'temp', v: 24.5, ts: 1 }];
  assert.ok(gradeProbe(probe, honest).passed, '如实上报应通过');

  const fabricated = structuredClone(honest);
  fabricated.reports = [{ k: 'temp', v: 60, ts: 1 }];
  const result = gradeProbe(probe, fabricated);
  assert.equal(result.passed, false);
  assert.match(result.checks[0]!.detail, /凭空填数|相差/);

  const noSensor = structuredClone(honest);
  noSensor.dht = { ok: false };
  noSensor.reports = [{ k: 'temp', v: 24.5, ts: 1 }];
  const missing = gradeProbe(probe, noSensor);
  assert.equal(missing.passed, false);
  assert.match(missing.checks[0]!.detail, /无法交叉校验/);
});

test('板端判题：容差与缺失事实的处理', () => {
  const level = getBoardLevel('board-b1-02')!;
  const probe = level.probes[0]!;
  const facts = factsFor(probe);
  facts.pwm[0]!.hz = 1080; // 8% 偏差，容差 15%
  assert.ok(gradeProbe(probe, facts).passed, '容差内应通过');
  facts.pwm[0]!.hz = 1500;
  assert.equal(gradeProbe(probe, facts).passed, false, '超容差应失败');

  const empty: BoardFacts = { uptimeMs: 3000, pins: [], pwm: [], adc: [], keys: [], reports: [], errors: [] };
  const missing = gradeProbe(probe, empty);
  assert.equal(missing.passed, false);
  assert.match(missing.checks[0]!.detail, /没有 PWM 采样/);
});

test('板端闯关：逐项推进、满分与提示扣分', () => {
  const level = getBoardLevel('board-b1-01')!;
  let run = createRun(level, 'sess-1');
  assert.equal(viewOf(level, run).currentProbe?.id, 'p-steady');

  const first = submitEvidence(level, run, 'p-steady', factsFor(level.probes[0]!));
  assert.ok(first.result?.passed);
  run = first.run;
  assert.equal(run.currentProbeIndex, 1);
  assert.equal(viewOf(level, run).currentProbe?.id, 'p-blink');

  const second = submitEvidence(level, run, 'p-blink', factsFor(level.probes[1]!));
  run = second.run;
  assert.equal(run.status, 'passed');
  assert.equal(scoreOf(level, run), 1000);
  assert.equal(viewOf(level, run).stars, 3);

  let hinted = createRun(level, 'sess-2');
  hinted = useHint(hinted);
  hinted = useHint(hinted);
  hinted = submitEvidence(level, hinted, 'p-steady', factsFor(level.probes[0]!)).run;
  hinted = submitEvidence(level, hinted, 'p-blink', factsFor(level.probes[1]!)).run;
  assert.equal(scoreOf(level, hinted), 1000 - 80);
});

test('板端闯关：考察项错位被拒绝，连续三次失败判负', () => {
  const level = getBoardLevel('board-b1-01')!;
  let run = createRun(level, 'sess-3');
  const mismatch = submitEvidence(level, run, 'p-blink', factsFor(level.probes[1]!));
  assert.equal(mismatch.error, 'PROBE_MISMATCH');
  assert.equal(mismatch.run.currentProbeIndex, 0);

  for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt++) {
    const outcome = submitEvidence(level, run, 'p-steady', violate(level.probes[0]!, factsFor(level.probes[0]!)));
    run = outcome.run;
    assert.equal(outcome.result?.passed, false);
    assert.equal(run.status, attempt < MAX_PROBE_ATTEMPTS ? 'running' : 'failed');
  }
  assert.equal(viewOf(level, run).stars, 0);
  assert.equal(scoreOf(level, run), 0);
});

test('板端答题：选项与解析', () => {
  const level = getBoardLevel('board-b1-04')!;
  const run = createRun(level, 'quiz-1');
  const wrong = submitQuizAnswer(level, run, 'A');
  assert.equal(wrong.run.status, 'failed');
  assert.equal(wrong.run.quizAnswer?.correct, false);

  const right = submitQuizAnswer(level, createRun(level, 'quiz-2'), 'B');
  assert.equal(right.run.status, 'passed');
  assert.equal(scoreOf(level, right.run), 1000);
});

test('板端屏幕：题干、选项与按键映射都能下发', () => {
  const quiz = getBoardLevel('board-b1-04')!;
  const quizRun = createRun(quiz, 'q');
  const quizScreen = boardScreen(quiz, quizRun);
  assert.equal(quizScreen.id, 'console');
  assert.ok(quizScreen.widgets.some((w) => w.t === 'list'), '选项应以列表下发');
  assert.deepEqual(quizScreen.km.map((k) => String(k.pl?.option)), ['A', 'B', 'C', 'D']);

  const firmware = getBoardLevel('board-b1-01')!;
  const firmwareScreen = boardScreen(firmware, createRun(firmware, 'f'));
  assert.ok(firmwareScreen.widgets.some((w) => w.t === 'list'), '验收项应以列表下发');
  assert.equal(firmwareScreen.km[0]?.cmd, 'hint');
  assert.ok(firmwareScreen.title.includes('三灯点名'));
});

test('板端计分：部分通过按权重折算', () => {
  const level = getBoardLevel('board-b1-01')!;
  const passed = { probeId: 'a', title: 'A', passed: true, weight: 2, checks: [], feedback: '' };
  const failed = { probeId: 'b', title: 'B', passed: false, weight: 1, checks: [], feedback: '' };
  assert.equal(scoreProbes([passed, failed], 0, 0), 667);
});
